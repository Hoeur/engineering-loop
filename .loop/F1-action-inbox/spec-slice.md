# F1a — Action Inbox, read-only slice

**Parent:** `./spec.md` (full F1) · **Status:** in progress
**Deliverable before P3 and P5.**

## Problem

Full F1 is blocked on P3 (live events) and P5 (auth/authz). But the *aggregation*
— the part that makes six scattered decision surfaces into one list — needs
neither. This slice ships that: a polled, read-only `/inbox` with filtering and
deep links.

## In scope

- `GET /inbox` aggregating four sources that exist today and need no new schema:
  pending approvals, `NEEDS_HUMAN_REVIEW` tasks, failed workflow runs, and open
  blocking findings (CRITICAL/HIGH).
- Filtering by project, type and severity.
- A deep link per item to its source record.
- Full tenant isolation, fail-closed, one regression test per source.
- `/inbox` web page with loading, empty and error states, no 375px overflow.

## Explicitly NOT in scope — and why

| Deferred | Blocked by |
| --- | --- |
| Claim / reassign | P5 — `Task` has no human assignee; adding one without authenticated identity is premature |
| Snooze | P5 — per-user state needs a real user |
| `@mentions` | P5 — cannot validate organization membership |
| Live updates | P3 — polling via TanStack Query is correct until then |
| Budget alerts | product decision — no threshold defined (80%? 100%? per project or task?) |
| SLA `dueAt` / acknowledged | product decision — no record carries a due date |
| Approve / reject / retry actions | this is a **read-only** slice; actions belong with P5's authorization |

Mentions and budget alerts are two of full F1's six sources, so this slice
aggregates **four of six**. That is stated rather than hidden: it is not "F1 done".

## Acceptance criteria

- [ ] `GET /inbox` returns items from all four sources with `type`, `sourceId`,
      `projectId`, `severity`, `title`, `firstSeenAt` and `deepLink`.
- [ ] **Computed from source records** — no inbox table. A test resolves an
      approval through `ApprovalsService` and asserts the next `GET /inbox` omits
      it, with no reconciliation step in between.
- [ ] `firstSeenAt` is the **source record's** timestamp, never query time, so an
      item's age does not reset on first view.
- [ ] A task that is both `NEEDS_HUMAN_REVIEW` and has a pending approval yields
      exactly **two** items (two distinct decisions), never three.
- [ ] Filters by project, type and severity compose.
- [ ] **One isolation test per source** (four): a cross-organization row must be
      absent. Style: `tenant-isolation.services.spec.ts`.
- [ ] Every source query goes through the existing `owned*Where` builders in
      `apps/api/src/common/tenant-ownership.ts` — no new bespoke filter.
- [ ] `/inbox` renders loading, empty and error states; no horizontal scroll at
      375px; uses `packages/ui` primitives.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. Baseline **409 passing** —
      a drop is a regression.

## Constraints

- No schema change. If this slice needs a migration, it has grown past its scope.
- Read-only: no mutations, so no new authorization surface before P5.
- Untrusted content (finding text, task titles) renders as text, never HTML.
