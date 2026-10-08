# CP-02A — Explicit project teams and phase role coverage

Date: 2026-10-08. Base: `59b8ee6`. Branch: `codex/cp02a-team-coverage`.
Status: implemented, independently reviewed and verified.

## Implemented behavior

Projects can configure an explicit roster of up to 100 unique existing agents,
including multiple agents for the same role. Agent roles, budgets, permissions
and AgentConfiguration remain the existing domain; roster membership grants no
organization administration or execution permissions.

- `GET /api/projects/:projectId/team` returns configured state, team version,
  safe member summaries, eligibility and per-role coverage.
- `PUT /api/projects/:projectId/team` replaces the entire roster using
  `{ expectedVersion, agentIds }`. Only organization owners/admins may write.
- `GET /api/projects/:projectId/phases/:phaseId/role-coverage` reports required
  role coverage and missing roles for that project's phase.

Shared strict Zod validation caps and deduplicates IDs. Replacement locks the
tenant-scoped project with FOR NO KEY UPDATE, checks the expected version,
validates same-organization enabled agents scoped globally or to this project,
and requires enabled same-organization providers. Membership, configured state,
version and audit commit together. Audit failure rolls everything back. An
unchanged roster with the current expected version is a no-op; stale versions
return CONFLICT. Reads hide malformed foreign membership metadata and omit
credential fields, prompts and arbitrary configuration values.

Configured projects resolve a valid preferred member from roleAssignments,
otherwise the lowest-ID eligible project member, then organization member.
The worker never falls back outside the roster or to a default provider for an
uncovered role. Its PROJECT_TEAM_ROLE_UNCOVERED error prevents agent invocation.
The existing Agent Team endpoint uses the same configured selection ordering,
checks project tenant scope and excludes disabled agents/providers. Unconfigured
worker resolution retains its legacy behavior.

## Additive migration

`20261008105857_cp02a_project_team` adds Project.teamConfigured default false,
Project.teamVersion default zero, and ProjectTeamMember with a composite primary
key, reverse agent index and cascading project/agent foreign keys. It does not
change domain enums or existing agent configurations. Existing projects keep
legacy selection until explicitly configured.

The migration was generated with `pnpm db:migrate cp02a_project_team` and applied
only to `engloop_cp02a_9665` on the task-owned local PostgreSQL container.
The final empty-database forward proof uses `engloop_cp02a_9665_forward_final`.
It applies prior migrations, inserts legacy project configuration, agents,
providers, an ACTIVE phase, IMPLEMENTING task and RUNNING workflow, then applies
the new migration. All existing values/history survive, new fields use defaults,
and membership duplicate/FK constraints reject invalid inserts. Scratch databases
are preserved; no deployment or seed data was changed.

## Review and verification

Planner, implementer, independent reviewer, verifier and lead participated.
Independent final source review and final test refinement review found zero
critical/high findings. Lead inspected the diff and generated SQL.

- API PostgreSQL integration: 5 passed, exit 0. Tenant/project isolation,
  manager authorization, invalid members, same-role multiplicity, safe responses,
  provider disablement, coverage, idempotence, stale/concurrent writes and audit
  rollback are covered. The final typed-spy rerun also passed 5/5, zero skips,
  exit 0 after the build's last Prisma generation completed.
- Worker PostgreSQL selection: 2 passed, exit 0. Outside preferences, deterministic
  members, valid preferences, disabled agents/providers, missing roles, explicit
  empty rosters and legacy compatibility are covered.
- Expanded forward migration proof: 1 passed, exit 0, zero skips.
- Shared schema suite: 51 passed, exit 0, including 2 roster validation tests.
- Initial worker unit suite: 150 passed, exit 0, with 9 optional prior-phase
  integration cases skipped; the new team PostgreSQL cases passed separately.
- Final root lint and typecheck passed, exit 0. Root `pnpm test` passed,
  exit 0: 690 tests passed, with 52 optional database tests skipped. CP-02A's
  7 PostgreSQL cases and expanded forward proof ran separately with zero skips.
  Production `pnpm build` passed, exit 0, including all 33 Next pages. The
  pre-existing Next workspace-root/multiple-lockfile warning remains informational.
  Final `git diff --check` passed, exit 0.

Validation uses bundled Node 24.19.0 and pinned pnpm 10.28.0. Initial typecheck
setup lacked DATABASE_URL; subsequent generation uses the explicit scratch URL.
A rollback test's invalid partial AuditService cast was replaced by a real
instance with a typed Vitest spy. A PostgreSQL assertion was corrected to the
documented enum coverage order. An independent retry raced Prisma generation
and failed before collection; final retries are serialized after build. No
production behavior or check requirements were weakened for these corrections.

## Remaining scope and Git handoff

Coverage is advisory; it does not activate, accept or schedule a phase. Roster
and agent settings are resolved at invocation time until CP-02C adds immutable
execution snapshots. This slice does not make existing runs reproducible after
configuration edits. Prompt templates/revisions are next in CP-02B; editors
remain CP-02D, scheduling CP-03 and evidence-gated acceptance CP-06. P1/P2 live
runtime and GitHub delivery prerequisites remain open.

No frontend code changed. Browser E2E and live provider execution were not run;
PostgreSQL tests exercise actual roster storage and worker selection. The existing
web unit suite and production build passed as part of the root gates. Changes
are committed locally on `codex/cp02a-team-coverage`, with a clean worktree;
nothing was pushed/deployed. The task-owned PostgreSQL container is stopped
after checks, preserving the scratch databases. Docker Desktop and unrelated
containers are left alone.
