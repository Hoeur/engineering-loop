# CP-01C — Phase lifecycle and edit protections

Date: 2026-10-08
Base: `c14554a`, branch `codex/cp01c-task-dag`, managed `1d1b` checkout.

## Bounded contract

- Add persisted `ProjectPhaseStatus`: DRAFT, ACTIVE, ACCEPTED. Existing phases
  become DRAFT; task membership, task statuses and workflow history are preserved.
- Owner/Admin can activate a DRAFT phase only after every explicit prerequisite
  is ACCEPTED. Activation freezes its planning contract; it does not enqueue,
  start, schedule or change any task workflow.
- Owner/Admin can reopen ACTIVE as DRAFT only when linked tasks have no active
  status, workflow (including WAITING_FOR_HUMAN), or pending/running agent.
  Shared active-task policy includes PR_READY. Identical lifecycle requests are
  no-ops without duplicate audits or timestamp changes.
- ACTIVE/ACCEPTED metadata, dependencies, position and membership are protected.
  Moving a task out of a locked source phase is blocked, as is deleting a draft
  that would shift a locked phase. Draft rearrangements keep unchanged locked
  phase positions and timestamps intact.
- ACCEPTED is reserved for the CP-06 evidence gate. There is no public acceptance
  writer and strict CRUD schemas reject status injection. An accepted phase
  cannot be reopened through this API. Dependent activation therefore stays
  blocked until its prerequisites have been accepted by the future gate.
- Lifecycle/membership transactions lock the owned project with FOR NO KEY
  UPDATE. Reopening locks member tasks before checking execution, so competing
  workflow/agent starts and task transitions serialize with the idle check.
  Starts after reopening remain valid legacy behavior. Audits commit with writes.
- Web controls show shared status badges, confirm activation/reopen, preserve
  failed/unsaved edits, disable locked mutations, and invalidate TanStack caches.

This protects phase configuration, not immutable execution snapshots or task
artifacts. Task metadata/dependencies and legacy workflow entry points retain
their existing behavior. Revisions, acceptance evaluation, scheduling and phase
advancement remain CP-02/03/05/06 work.

## Implementation and migration

Routes: POST `/projects/:projectId/phases/:phaseId/activate` and `/reopen`,
with authenticated manager membership and no request body. All responses use
the existing envelope. New failures use shared ApiErrorCode constants.

Migration `20261008050403_add_project_phase_lifecycle` was generated through
`pnpm db:migrate`, then applied only to the task-owned scratch database. It adds
the enum, defaulted column and `(projectId, status)` index. No data reset.
The phase service was split into policy/lifecycle responsibilities and stays
below 400 lines. Existing phase DAG checks and task DAG hardening remain intact.

## Review and focused proof

Backend and frontend implementers, independent reviewer and lead verifier
participated using engineering-loop, Next software-engineer, React best-practices
and local UI-testing guidance. Frozen review found no critical/high findings.

- Lifecycle PostgreSQL integration: 14 passed. Covers prerequisites, accepted
  immutability, source/destination moves, indirect position shifts, no-ops, audit
  rollback, manager/tenant checks, execution states and competing task starts.
- Existing phase PostgreSQL integration + policy tests: 14 passed.
- Shared schema tests: 4 passed; enum parity: 40 passed.
- Forward migration: 1 passed on fresh `engloop_lifecycle_forward`. Existing
  phase rows gain only DRAFT; IMPLEMENTING task and RUNNING workflow rows remain
  unchanged. The test refuses a nonempty database instead of resetting it.
- Focused web tests: 19 passed; full isolated web rerun: 82 passed.
- First browser attempt passed two widths; four hit the default 30-second whole
  scenario timeout. The extended contract/metadata/lifecycle scenario now has a
  bounded 90-second timeout; individual assertion timeouts and checks are unchanged.
- Initial full tests inherited the scratch UI's NEXT_PUBLIC_API_URL, conflicting
  with an existing api-client unit test's default `/api` expectation. Isolated web
  tests passed without that override; the final full suite clears it. No source
  assertions were weakened. Earlier API suites were aborted by the web failure.
- The first production build inherited NODE_ENV=development from the scratch
  service helper and failed prerendering Next's error page. Final build explicitly
  uses NODE_ENV=production. No application source changes were needed for these
  verification-environment corrections.

## Verification environment and handoff

Only task-owned PostgreSQL `engloop-cp01c-postgres` (57432), Redis
`engloop-lifecycle-redis` (57379), API (4400) and web (3300) were used. Scratch
seeded authentication was real JWT login with dev bypass disabled; mock provider
was configured and no worker/provider execution was started. Browser fixtures
are retained/archived by the existing test cleanup; no user data was migrated.

The host Node selection had changed to 16, so commands prepend the bundled Node
24 runtime and invoke pinned Corepack pnpm 10.28.0 explicitly. Hoisted dependencies
are retained. No runtime/toolchain policy or repository dependency versions changed.

Final repository gates passed: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, and `git diff --check`. The full suite passed 686 tests with three
optional forward-migration tests skipped; the new forward-migration proof passed
separately on its fresh database. The production build generated all 33 web pages.
The existing Next workspace-root warning remains informational.

The real API/browser scenario passed all six viewports in 49.3 seconds: 1440,
1024, 768, 430, 390 and 375 pixels, including console and horizontal-overflow
checks. Independent final review found no critical/high findings.

API/web processes were stopped after verification. Both task-owned Docker
services are stopped with their data preserved. Changes are committed locally
on `codex/cp01c-task-dag`; publication is a separate action.

CP-01D active-phase planner work remains next; this does not close the full
CP-01 acceptance or P1/P2 runtime prerequisites.
