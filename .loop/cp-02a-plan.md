# CP-02A — Project team membership and phase role coverage

Date: 2026-10-08. Base: `59b8ee6`. Branch: `codex/cp02a-team-coverage`.
Status: implemented and verified; see [evidence](cp-02a-evidence.md).

## Bounded contract

Reuse existing Agent roles, budgets, permissions and AgentConfiguration. Add an
explicit project roster supporting multiple agents per role. Phase coverage
compares eligible members against the existing phase requiredRoles. A role name
does not grant organization administration or execution permissions.

Projects without a configured roster retain legacy provider selection. Explicit
teams select only enabled, same-organization members scoped globally or to that
project, with enabled same-organization providers. An explicit empty roster or a
missing eligible role fails closed. Coverage reports facts; it does not activate,
accept or schedule a phase.

## Acceptance criteria

- Scoped read, roster replacement and phase coverage routes use shared schemas
  and the existing API envelope.
- Only organization owners/admins replace rosters. Foreign project/organization,
  disabled agent/provider and duplicate IDs are rejected.
- Replacement uses a project row lock, required expected team version and an
  atomic audit record. Stale competing edits fail without partially changing data.
- Multiple agents can cover one role; deterministic selection prefers a valid
  assigned member, then another eligible member. No outside-roster fallback.
- Responses omit credentials and arbitrary configuration values.
- Additive migration preserves legacy project, phase, task and run history.
- Regression tests, PostgreSQL integration, forward proof, root lint/typecheck/
  test/build, independent review and a clean local commit provide evidence.

## Deferred work

CP-02B prompt revisions, CP-02C immutable execution snapshots, CP-02D editors,
CP-03 scheduling and CP-06 evidence acceptance remain open. P1/P2 live execution
and GitHub prerequisites remain open. This slice does not change deployment.
