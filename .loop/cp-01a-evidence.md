# CP-01A — Draft phase metadata and task membership

Date: 2026-10-06
Checkout: `E:\Evalley\Engineer loop`; base `125d115`.
Status: implemented and validated; not full CP-01 acceptance or repository definition of done.

## Scope

Add editable project phases, exact complete ordering, and link/move/unlink of
existing tasks. The project page exposes these draft-only controls to Owner/Admin;
members can read. Deleting a phase preserves tasks and clears membership.
No activation, acceptance, scheduler, team, prompt revision or run snapshot is
introduced. Existing task status and workflow transitions are not changed.

## Safety and review

Tenant-scoped project/phase/task lookups, compound same-project foreign key,
project/task row locks, active task/run guards, transaction-coupled audit writes,
unique ordering and collision-free reorder are covered by focused tests.
Idempotent membership requests do not change timestamps or emit false audit rows.

Engineering-loop skill provided bounded implementation and independent review;
Next software-engineer guidance kept server state in query hooks. Local UI testing
guidance required isolated PostgreSQL/Redis, real login and real API requests.
Reviewer corrections: invalid task status fixture, shared viewport fixture race,
and no-op membership audit records. A typed unit-case defect was also repaired.

## Isolated database proof

Task-owned PostgreSQL `engloop-cp01-pg` on 127.0.0.1:56432 and Redis
`engloop-cp01-redis` on 127.0.0.1:56379; no user database modified.
All migrations including `20261006064902_add_project_phases` deployed from empty
to `engloop_cp01`; seed then applied for browser acceptance.

Separate empty `engloop_cp01_forward` was used for baseline migrations, existing
project/task fixtures, then the new migration. Exact project/task rows survived,
new membership was NULL and phase table empty. Forward test refuses non-empty
databases and does not reset data.

- API focused units and real PostgreSQL integration: 14/14 passed.
- Forward migration and enum parity: 40/40 passed.
- Schema versus applied snapshot diff: empty migration, exit 0.
- Prisma direct Node entry invocation verified on Windows; POSIX not exercised.

## Workspace gates

- Root lint: exit 1, 284 existing warnings exclusively under nested
  `.claude/worktrees`; no errors. Those unrelated checkouts were not edited.
- Active checkout lint excluding `.claude/**`: exit 0.
- Full typecheck rerun: exit 0 after repairing new unit-case typing errors.
- First full tests: one existing Docker runtime test timed out at 5s during
  concurrent compilation; full rerun exit 0 without changing test timeouts.
  Aggregate ordinary suites: 603 passed, 7 optional live tests skipped; those live
  phase tests were separately executed against the isolated databases above.
- Six-viewport real API browser acceptance: 6/6 passed (50.1s), widths 1440,
  1024, 768, 430, 390 and 375. Create/edit/reorder/link/unlink/delete verified;
  task execution status unchanged and horizontal overflow at most 1px.
  Unique phase fixtures cleaned up; unique projects archived and fixture IDs
  attached to browser results. Project/task records retained only in scratch DB
  because the API has no deletion route for those entities.
  Command uses `E2E_PHASE_ACCEPTANCE_WRITE=1`, `PLAYWRIGHT_SKIP_WEBSERVER=1`,
  `PLAYWRIGHT_BASE_URL=http://localhost:3300`, `E2E_API_URL=http://localhost:4400/api`,
  installed Chrome via `PLAYWRIGHT_CHROMIUM_PATH`, and `--workers=1`.
  Mobile screenshot: `apps/web/test-results/project-phases-manages-dra-c6eb5-sk-execution-at-every-width-mobile-375/draft-phase-management.png`
  (ignored local test artifact; not a tracked deliverable).
- Full production build: exit 0, all packages/API/worker/web built successfully.
- Initial browser attempt used a stale API executable and returned phase-route
  404; rebuilt actual API build configuration, exit 0, then restarted before rerun.
- Independent frozen-diff review: no critical/high findings or code blockers.
  Low follow-up: phase cards eagerly fetch details (one HTTP request per phase);
  lazy or aggregate fetching should be considered before large phase boards.
- No commit/push was performed during the implementation handoff. The user later
  authorized publication of CP-01A/B and README changes; see Git history.
  Root lint remains unresolved, so repository definition of done is not met.

## Next bounded slice

CP-01B: project contract, phase objectives/deliverables/acceptance criteria, required
roles and dependency metadata with explicit human editing. Do not call CP-01
complete until CP-01C/D activation/DAG/planner acceptance is implemented and proven.
Parallel scheduling and immutable task/prompt/agent snapshots remain CP-02/03.

Owned API/web test processes and PostgreSQL/Redis test containers stopped after
acceptance. Containers and scratch data retained for repeat inspection; nothing
deleted from user databases or unrelated worktrees.
