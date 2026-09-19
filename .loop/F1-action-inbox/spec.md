# F1 — Action Inbox

**Source:** EngLoop New Feature TODO Roadmap, F1
**Stated dependencies:** P3 (live events), P5 (auth/authz)
**Status:** specced, **blocked** — see §Dependencies

## Problem

Decisions that need a human are scattered across six screens. A pending approval,
a `NEEDS_HUMAN_REVIEW` task, a failed workflow, a blocking finding, a budget
alert and a mention each live in their own place, so the only way to know what is
waiting is to go looking. `/inbox` gives one list of everything awaiting a person,
computed from the records that already hold that state.

## Dependencies — read before starting

Neither stated dependency exists yet. P0 is not closed (E2E authentication,
`.loop/p0-evidence.md` §5), and P1–P6 have not started.

**This spec is written now so it is ready when they land, not because it can
start.** Two of its criteria are deliberately written to degrade rather than
block:

- **Without P3**, the inbox polls through TanStack Query like every other screen.
  The streaming criterion is marked P3-gated. Nothing else in F1 needs it.
- **Without P5**, "assignment" has no authenticated human identity to attach to
  beyond the existing dev principal, and `@mentions` cannot validate organization
  membership properly. The mention and claim criteria are P5-gated.

A **polled, unassigned** inbox — read-only aggregation with filtering and deep
links — is deliverable before either phase. If that slice is wanted, split it out
rather than relaxing the criteria below.

## What already exists — verify, do not rebuild

Every source record F1 aggregates is already in the schema:

| Inbox item | Source | Location |
| --- | --- | --- |
| Pending approvals | `Approval` where `status = PENDING` | `schema.prisma:1432` |
| Human-review tasks | `Task` where `status = NEEDS_HUMAN_REVIEW` | `TaskStatus` enum |
| Failed workflows | `WorkflowRun` / `WorkflowStep` failure state | existing |
| Blocking findings | `ReviewFinding` where severity CRITICAL/HIGH, status OPEN | `schema.prisma:1206` |
| Budget alerts | `CostRecord` vs. project `costBudgetUsd` | `schema.prisma:1385` |
| Mentions | `TaskComment` | `schema.prisma:753` |

Tenant scoping is also already built: `ownedApprovalWhere`, `ownedFindingWhere`,
`ownedWorkflowRunWhere` in `apps/api/src/common/tenant-ownership.ts`. **Use
them.** They are fail-closed — a row needs at least one owner and every populated
owner must be in the same tenant — and the rules are covered by
`tenant-integrity.services.spec.ts` (918 lines).

### The one genuine schema gap

**`Task` has no human assignee.** It has `assignedAgentId` (an `Agent`) and
`createdById`, but nothing assigning a task to a *person*. F1's claim, reassign
and "assigned follow-ups" features all require this. Adding it is part of F1 and
needs a migration — note that `WorkflowStepKey` in task 01 showed Prisma enums and
`applied-datamodel.prisma` must both be updated, or the next generated migration
re-emits the change.

## Acceptance criteria

### Aggregation

- [ ] `GET /inbox` returns items from all six sources in one response, each
      carrying type, severity, source id, project, age, and a deep link.
- [ ] **Items are computed from the source records.** No second table mirrors
      their state. Asserted by a test that resolves a source record and shows the
      item disappears from the next `GET /inbox` with no reconciliation step.
- [ ] Every unresolved approval and every `NEEDS_HUMAN_REVIEW` task appears
      **exactly once** — no duplicate when a task has both a pending approval and
      human-review status.
- [ ] Filtering by project, type, severity, age and assignment; filters compose.
- [ ] Pagination follows the existing `packages/schemas` envelope conventions.

### Tenant isolation — non-negotiable

- [ ] Every source query goes through the existing `owned*Where` builders.
- [ ] A cross-organization source id returns `NOT_FOUND`, not `FORBIDDEN`, matching
      `tenant-isolation.services.spec.ts`.
- [ ] A regression test in that file's style covers **each** of the six sources.
      Six aggregated sources is six chances to leak; one shared test is not enough.

### Actions

- [ ] Claim, reassign, snooze, comment, approve, reject, retry, and open-source
      each act on the **source record**, through its existing service and lifecycle
      guards — never by mutating an inbox row.
- [ ] **Concurrent claims produce exactly one owner.** Proven by a test driving two
      simultaneous claims, in the style of the conditional-claim pattern already
      used for workflow cancellation (`workflow-engine.integrity.spec.ts`).
- [ ] Snooze is per-user and time-bounded; a snoozed item returns after expiry
      without a background job.
- [ ] Approve/reject reuse `ApprovalsService` rather than re-implementing the
      transition.
- [ ] Every action writes an audit record, consistent with existing decisions.

### Mentions — P5-gated

- [ ] `@mentions` in task comments store structured member ids, not raw text.
- [ ] A mention of a non-member, or a member of another organization, is rejected
      — it must not silently create an unreachable notification.
- [ ] Mention notifications go through the existing `NotificationProvider`
      (`apps/api/src/modules/notifications`), not a new channel.

### SLA timestamps

- [ ] First-seen, due, acknowledged and resolved are tracked per item.
- [ ] First-seen is derived from the source record's own timestamp, so an item
      does not reset its age when the inbox is first queried.

### UI

- [ ] Loading, empty, error, and terminal states — the project requires no screen
      be blank (`states.spec.ts`).
- [ ] **No horizontal scrolling at 375px**, and the primary actions are completable
      on mobile. Covered by `apps/web/e2e` at the existing six-viewport matrix.
- [ ] Uses `packages/ui` primitives and `.ai/ui-guidelines.md`.

### Streaming — P3-gated

- [ ] Inbox items update through P3's live-event stream, reconciled into TanStack
      Query as the canonical cache. **Until P3 lands, polling is correct** and this
      criterion is deferred, not failed.

### Gates

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass. The test
      baseline is **409 passing**; a drop is a regression.
- [ ] `pnpm test:e2e` passes at all six viewports.

## Constraints

- **Read paths are tenant-scoped and fail-closed from the first commit.** Six
  sources aggregated into one endpoint is the highest-risk isolation surface in
  the product so far.
- The API reads and mutates through services; it does not spawn processes.
- Comment bodies and mention text are **untrusted content** — render as text,
  never as HTML.
- Budget alerts read `CostRecord`; do not recompute costs in the inbox.

## Out of scope

Email/Slack delivery of inbox items (P5's notification providers) · a mobile app ·
bulk actions across items · custom user-defined inbox rules · SLA *enforcement*
(F1 records the timestamps; acting on them is separate).

## Open question

**Is a pre-P3/P5 slice wanted?** A polled, read-only inbox with filtering and deep
links is deliverable now and would be the first F-feature to reach users. It gives
up claim/reassign (no human assignee without P5) and live updates (P3). Worth
deciding before the dependencies land, not after.
