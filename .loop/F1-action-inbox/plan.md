# F1 — Action Inbox · plan

**Spec:** `./spec.md` · **Baseline:** `bc56b12` (lint/typecheck clean, 409 tests)
**Status:** plan only — F1 is blocked on P3/P5; nothing here should be implemented yet.

## Approach

One read endpoint that **queries the six source tables directly** and normalises
them into a common item shape. No inbox table. Actions delegate to the existing
services so lifecycle guards and audit records are inherited rather than
duplicated.

The one piece of new persistence is what genuinely cannot be derived: a human
assignee on `Task`, and per-user snooze state.

### Decision 1 — computed, not materialised

The spec requires items to disappear when the source resolves, with no
reconciliation job. A materialised inbox table would need exactly that job, plus
a write on every state change in six subsystems. Querying sources directly makes
the requirement structural: there is no second copy to drift.

Cost: one endpoint issues six queries. Mitigated with `$transaction([...])` for
parallel reads, the pattern `tasks.service.ts` already uses for task detail.

### Decision 2 — a discriminated union, not a lowest common denominator

```ts
type InboxItem = {
  type: 'APPROVAL' | 'HUMAN_REVIEW' | 'WORKFLOW_FAILURE'
      | 'BLOCKING_FINDING' | 'BUDGET_ALERT' | 'MENTION';
  sourceId: string;
  projectId: string;
  severity: Severity;
  title: string;
  firstSeenAt: Date;      // the SOURCE record's timestamp, never "now"
  dueAt: Date | null;
  acknowledgedAt: Date | null;
  assigneeId: string | null;
  deepLink: string;
};
```

`firstSeenAt` deriving from the source is what stops an item's age resetting when
the inbox is first queried — an easy bug that would quietly corrupt SLA numbers.

### Decision 3 — dedupe by (type, sourceId)

A task can be `NEEDS_HUMAN_REVIEW` *and* have a pending approval. The spec says
each appears once. These are two different decisions, so both items are correct —
but the same approval must not appear twice from two queries. Keying on
`(type, sourceId)` makes that explicit and testable.

### Decision 4 — claim via conditional update

```ts
await prisma.task.updateMany({
  where: { id, assigneeId: null, project: { organizationId } },
  data:  { assigneeId: userId },
});
// count === 1 → this caller won; count === 0 → someone else did
```

Same conditional-claim pattern as workflow cancellation
(`workflow-engine.ts`), which `workflow-engine.integrity.spec.ts` already proves
under concurrency. Reusing a proven pattern rather than inventing a lock.

## Files to touch

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | `Task.assigneeId` + relation + index; new `InboxSnooze` model |
| `packages/db/prisma/migrations/<ts>_inbox/migration.sql` | **new** |
| `packages/db/prisma/migrations/applied-datamodel.prisma` | **must be updated too** — see risk 3 |
| `packages/schemas/src/api.ts` | `inboxItemSchema`, `listInboxQuerySchema` |
| `apps/api/src/modules/inbox/` | **new** — controller, service, module |
| `apps/api/src/common/tenant-ownership.ts` | add `ownedTaskCommentWhere` if mentions need it; reuse the rest |
| `apps/api/src/modules/inbox/inbox.service.spec.ts` | **new** — six isolation tests + dedupe + concurrent claim |
| `apps/web/app/inbox/page.tsx` | **new** |
| `apps/web/e2e/inbox.spec.ts` | **new** — six viewports, states, 375px overflow |

## Test strategy

1. **Isolation, one test per source** (six tests). A cross-org row for each of
   approvals, human-review tasks, workflow failures, findings, budget alerts and
   mentions must be absent from `GET /inbox`. Style: `tenant-isolation.services.spec.ts`.
2. **No-reconciliation proof.** Resolve an approval through `ApprovalsService`,
   then assert the next `GET /inbox` omits it — with no job run in between.
3. **Dedupe.** A task that is both `NEEDS_HUMAN_REVIEW` and has a pending approval
   yields exactly two items, never three.
4. **Concurrent claim.** Two simultaneous claims → one `count: 1`, one `count: 0`.
5. **Age integrity.** `firstSeenAt` equals the source record's timestamp, not the
   query time.
6. **E2E.** Six viewports; loading/empty/error states; no 375px overflow.

## Risks

1. **Six aggregated sources is the largest isolation surface yet.** One missed
   `owned*Where` leaks cross-tenant data through an endpoint whose whole purpose
   is breadth. Hence one isolation test per source, not one shared test.
2. **Query cost.** Six queries per request, on a screen users keep open. Needs
   indexes on the filter columns and a pagination cap. Measure before optimising.
3. **Migration snapshot drift.** Task 01 hit this: a hand-written migration left
   `applied-datamodel.prisma` stale, so the next generated migration would have
   re-emitted the change. Update both, then verify with
   `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ...`
   → "empty migration".
4. **`assigneeId` is a new authorization surface.** Assigning to a user outside the
   organization must fail closed. Test it.
5. **Snooze must not need a cron.** Store `snoozedUntil` and filter on read, so
   expiry is a query predicate rather than a scheduled job.

## Could not determine from the code

- **Budget-alert threshold.** `CostRecord` and `Project.costBudgetUsd` exist, but
  nothing defines *when* spend becomes an inbox-worthy alert (80%? 100%? per
  project or per task?). Needs a product answer.
- **Due-date policy.** The spec wants `dueAt` for SLA reporting; no existing
  record carries one. Whether it is configured per project, per item type, or
  fixed is undecided.
- **Mention notification routing** depends on P5's notification work, which has
  not started.
