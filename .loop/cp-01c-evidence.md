# CP-01C — Task graph hardening

Date: 2026-10-08
Base: `b895345`, managed `1d1b` worktree.
Status: bounded graph implementation reviewed; full CP-01C remains open.

## Behavior

- API dependency writes now validate and insert in one transaction, locking the
  owned project before reading the graph and rechecking both task endpoints.
  Concurrent reciprocal requests cannot both commit. Cross-project and tenant
  references fail without writes.
- Iterative traversal checks the complete reachable graph rather than treating
  the former 500-node cutoff as success. All existing dependency types retain
  the same cycle rules. This prevents newly introduced cycles; unrelated legacy
  cycles are tolerated, not repaired or claimed absent.
- Identical duplicate requests return the original edge without another audit;
  changing an existing edge's type returns `TASK_DEPENDENCY_EXISTS`.
- Dependency insertion and its configuration audit commit or roll back together.
- Planner output rejects self/duplicate/out-of-range references and cycles,
  including disconnected and deep graphs. Valid forward/backward DAG references
  remain supported.
- The worker validates typed planner input before database access and preserves
  every valid edge. It locks the project before updating the parent task, matching
  graph writer order. `FOR NO KEY UPDATE` permits incidental project FK key-share
  locks while still serializing project counter/graph writers.

No schema migration, phase activation, acceptance engine, scheduler or runtime
configuration was added. Existing phase dependency validation remains in place.

## Review and verification

Planner, backend implementer and independent reviewer participated; lead runs
repository verification. Frozen review found no critical/high findings.

- API regression units: 13 passed.
- PostgreSQL dependency integration: 5 passed, including reciprocal/duplicate
  races, a 601-edge cycle path, endpoint ownership and audit rollback.
- Planner schema contract suite: 22 passed, including a 1,200-task graph.
- Worker materializer regressions: 5 passed.
- Both full test runs: 665 passed, 2 optional forward-migration tests skipped.
  All 17 phase/task PostgreSQL integration tests were explicitly enabled.
- Root lint passed without exclusions in this checkout, which contains no nested
  `.claude/worktrees`. This does not change other checkouts' lint configuration.
- Initial typecheck/build failed with widespread Prisma TS2742 errors under the
  desktop fallback pnpm 11.25.0. Its installed modules reported `isolated`, even
  though the repository `.npmrc` requires `node-linker=hoisted`. Reinstallation
  with pinned Corepack pnpm 10.28.0 restored hoisted modules. Final full root lint,
  typecheck and tests passed with exit 0; no source type checks were disabled.
  Installer changes to `pnpm-workspace.yaml` were reverted.
- Independent post-install verifier: schema 22, materializer 5, API units 13 and
  live PostgreSQL dependency integration 5 passed with exit 0; none skipped.
- Full production build passed with exit 0: packages, API, worker and all 33
  generated Next pages. Next reported its existing inferred workspace-root warning;
  lint runs separately at the root and passed with zero warnings.
- Final `git diff --check` passed with exit 0.

## Isolation and remaining work

Live database tests use only task-owned `engloop-cp01c-postgres`, PostgreSQL 16 on
`127.0.0.1:57432`, database `engloop_cp01c`. Existing user services/databases are
unchanged. No browser E2E rerun is required for this backend/schema-only slice.
The owned PostgreSQL container was stopped after verification; scratch database
storage is retained. No API/web processes were started for this slice.
Mixed API/materializer/task-transition concurrency is not directly exercised by
the added live suite; project-first lock order was reviewed and unit checked.

CP-01C lifecycle/activation and accepted/active phase edit protections remain
open. There is currently no persisted phase lifecycle or acceptance record;
adding an arbitrary manual accepted status would bypass the planned CP-06 gates.
CP-01D active-phase planner materialization also remains open.

## Git handoff

Changes are committed locally on `codex/cp01c-task-dag`; see Git history for the
commit identity. The commit contains only graph hardening, regression tests and
this evidence/plan update. No remote push or deployment was performed.
