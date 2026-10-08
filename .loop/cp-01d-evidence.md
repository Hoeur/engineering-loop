# CP-01D — Bounded active-phase planner

Date: 2026-10-08
Base: `532ff46`, branch `codex/cp01c-task-dag`, managed `1d1b` checkout.

## Implemented contract

The existing task planning workflow selects scoped planning when its parent has
a phase. It requires that phase to be ACTIVE in the same project before invoking
the planner. Unphased tasks retain their legacy planning contract.

Scoped planner input carries project objective, requirements, non-goals and
criteria, plus the active phase name, objective, deliverables, criteria and
required roles. Output must echo the exact phase ID and phase `updatedAt` version.
The provider JSON contract preserves this binding and owner roles through every
parse boundary, including stored PLAN output before CREATE_TASKS.

Scoped plans contain 1–20 tasks. Each requires a nonblank bounded objective,
an enum owner role, nonempty bounded acceptance criteria and required checks.
Suggested files use repository-relative paths; traversal, absolute paths, control
characters, Git metadata and repository checkout roots are rejected. Existing DAG
validation rejects cycles, self edges, duplicates and out-of-range indexes.
Files remain advisory and roles remain ownership metadata, with no added command,
file, agent-selection or authorization permissions.

Materialization locks the project before the parent task, rereads the current
parent and phase within the transaction, and checks ACTIVE status and the exact
phase/version binding before any writes. Children inherit current parent context,
phase membership and owner roles. Parent plan, task sequence, children, dependency
edges and audit rows commit together. Audit failures abort all of them.

This is a worker admission path for new planned children in an active phase;
human CRUD/membership protections from CP-01C still apply. It leaves phase
configuration unchanged and creates BACKLOG tasks without starting child workflows.

## Migration and compatibility

Migration `20261008074541_add_planned_task_owner_role` was generated with
`pnpm db:migrate` and applied only to the task-owned scratch database. It adds
nullable `Task.ownerRole` using the existing AgentRole enum. Existing rows keep
null owner roles. Task detail responses expose the scalar through existing API
serialization; no web screen or API endpoint was changed.

The isolated forward proof applies prior migrations to an explicitly empty DB,
inserts an ACTIVE phase, IMPLEMENTING task and RUNNING workflow, then applies
the new migration. Only the null role column is added; all existing values and
phase/workflow history are preserved. The test refuses nonempty databases.

## Review and verification

Engineering-loop planner, implementer, independent reviewer and lead verifier
participated. Frozen source review found no critical or high findings.

- Scoped schema tests: 18 passed.
- Worker materializer and planning step unit tests: 14 passed.
- Provider mock and CLI tests: 33 passed, including actual CLI request/schema
  serialization and output parsing with a mocked command executor.
- PostgreSQL integration: 9 passed. Covers successful same-phase children and
  edges; DRAFT/ACCEPTED rejection; changed contract, moved parent and foreign tenant;
  competing project writer recheck; audit-failure rollback; unphased compatibility.
- Additive forward-migration proof: 1 passed on fresh `engloop_cp01d_forward`.

Final root `pnpm lint`, `pnpm typecheck`, `pnpm test` and production `pnpm build`
all passed with exit code 0. The full suite passed 724 tests with four optional
forward proofs skipped; the new forward proof passed separately on its fresh DB.
All 33 web pages were generated. The existing Next workspace-root warning remains
informational. `git diff --check` passed. Browser acceptance is not required for this slice:
there are no UI changes, and no live provider or worker queue run is claimed.

## Environment and remaining scope

Checks use bundled Node 24 with pinned Corepack pnpm 10.28.0. Only the task-owned
PostgreSQL container `engloop-cp01c-postgres` on 57432 is used; Redis, API, browser
and worker services were not started. Seed/user data was not reset. Scratch
databases are preserved after verification. PostgreSQL is stopped after checks.
Changes are committed locally on `codex/cp01c-task-dag`; publication is separate.

Initial focused checks needed rebuilt shared-schema exports; an invalid new audit
enum reference was corrected to the existing CONFIGURATION_CHANGED action.
An early lint pass ran before the final path validation edit and rejected a
control-character regex; the final implementation uses character code checks
without disabling lint rules. No tests or gates were weakened.

The phase version binds the phase configuration only. Project/task revisions,
immutable full-input snapshots, cancellation fencing and durable queue
deduplication remain CP-02/03. Existing CREATE_TASKS replay behavior is unchanged.
Phase acceptance and prerequisite advancement remain CP-06. P1/P2 live runtime
and delivery prerequisites remain open. Next product slice: CP-02A team membership
and required role coverage. No deployment or publication is included.
