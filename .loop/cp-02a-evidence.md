# CP-02A — Explicit project teams and required role coverage

Date: 2026-10-13
Status: implementation and local regression gates delivered; browser acceptance
and independent review remain open. No publication or deployment is claimed.

## Baseline and scope

The checkout began clean, detached at `59b8ee6`, the merge of PR #10. The current
plan includes CP-01C phase lifecycle and CP-01D bounded active-phase planning.
Work is on `codex/cp02a-team-membership`. There were no unrelated tracked or
untracked edits to preserve at the start; the patch contains only this slice.

An earlier unpublished CP-02A commit (`593673b`) was verified locally and used
to retain its opt-in roster selection contract, deterministic worker selection,
legacy team view scoping and associated regression coverage. This continuation
adds project/phase requirements, configuration references, idle edit protection,
the project team UI and HTTP/schema/frontend coverage on the merged baseline.

## Domain and API contract

`ProjectTeamMember` links projects to existing Agent records; its composite
primary key prevents duplicate membership and both foreign keys cascade on
deletion. Multiple members may share a role. No duplicate agent/configuration
model, new enum, provider credential or inferred permission is introduced.

Two additive migrations add membership, empty project required roles,
`teamConfigured=false` and `teamVersion=0`. Existing agents, configurations,
phase requirements, assignments, tasks and run history remain unchanged.
Migrations were generated with `pnpm db:migrate` and deployed only to the
task-owned scratch database. The applied datamodel snapshot matches the schema.

- `GET /projects/:projectId/team` returns explicit member IDs, eligible project
  and organization candidates, active AgentConfiguration ID/version references,
  project required/covered/missing roles and phase coverage. Phase requirements
  combine project required roles with the existing phase required roles.
- `PUT /projects/:projectId/team` requires `{ expectedVersion, memberIds,
  requiredRoles }` through the strict shared schema. Only organization owners
  and administrators may replace a team. Role names grant no authority.
- A stale edit returns `CONFLICT` with the current team version. A changed team
  atomically replaces members, requirements, opt-in status/version and audit.
  A matching configured no-op does not increment its version or audit again.
- Foreign tenant/project agents, disabled agents and disabled/foreign providers
  cannot be selected. Invalid writes and audit failures do not partially apply.
- Active phases, active task states, pending/running/waiting workflows and
  pending/running agent runs prevent team edits with `PHASE_LOCKED`.
  Project/task locks serialize phase changes and workflow starts; shared
  agent/provider row locks make eligibility checks wait for concurrent edits.
- Coverage is current configuration information, not acceptance or run evidence.
  An incomplete draft team may be saved and displays its missing roles.

## Selection and UI

Unconfigured projects retain legacy provider resolution. Configured projects
only select enabled, same-organization agents/providers within their explicit
roster and project scope. Existing preferred assignments are honored only when
eligible roster members. Fallback member choice is deterministic. An uncovered
requested role fails with `PROJECT_TEAM_ROLE_UNCOVERED`; an empty configured
team does not silently fall back to the default provider.

The legacy `/agents/team` shape stays compatible and now applies tenant,
eligibility and configured-roster filters. Team edits do not alter Agent budgets,
commands, permission levels, prompts or AgentConfiguration values.

The project detail page includes membership/requirements editing and project/
phase coverage with loading, empty, error, retry, locked and read-only states.
Disabled members can be removed but cannot be newly selected. Failed saves
preserve draft selections; pending saves disable inputs. The editor keeps its
original version after refetches, preventing stale edits from overwriting another
administrator's changes. TanStack Query owns server state, with invalidation
after phase, team, agent and provider edits plus a polling fallback.

No credentials, provider configuration contents, prompts or permission fields
appear in the new team payload. Saving activates roster selection for future
invocations but starts no workflow or provider process.

## Verification

Final root lint and typecheck passed with exit code 0. Root tests passed with
exit code 0: 736 passed, 45 optional tests skipped. The team API and worker
PostgreSQL suites ran within that root suite; optional historical DB/forward
suites remain opt-in. The new forward proof passed separately (1 test).
Production build passed with exit code 0 and generated all 33 pages. The existing
Next workspace-root warning remains informational. `git diff --check` passed.
Focused API, worker, schema, UI and forward-migration checks passed during
implementation. The existing phase CRUD/planning/lifecycle PostgreSQL integration
suites passed alongside the team API tests, preserving merged CP-01C behavior.
The final compatibility rerun passed 26 phase CRUD/planning/lifecycle tests.

The forward proof on a fresh empty database preserves existing agents,
configurations, ACTIVE phase, IMPLEMENTING task and RUNNING workflow while
adding empty/default team fields. Duplicate and nonexistent member references
are rejected by database constraints. The proof refuses nonempty databases.

The six-viewport Playwright scenario is present in
`apps/web/e2e/project-team.spec.ts`; `playwright test ... --list` discovers all six
viewports. It covers membership/requirements, missing coverage, disabled
selection, saved payload/permissions, activation/reopening locks, clearing and
375px overflow. **It has not been executed.** Automatic approval review rejected
both local web-server startup commands with only `blocked by policy`; no browser
success, screenshot or visual QA is claimed.

Lead static review checked authorization, transaction/lock ordering, credential
projection, legacy selection, schema/UI version bindings and scoped diffs.
Independent review remains required by the delivery plan and is not claimed.

## Environment and remaining work

Only task-created `engloop-cp02a-postgres` (57433) and `engloop-cp02a-redis`
(57380) containers were used. Scratch DBs `engloop_cp02a`,
`engloop_cp02a_forward`, `engloop_cp02a_version_forward` and `engloop_cp02a_ui`
are retained. Only the dedicated UI database was seeded; no existing user DB was
reset. API ran locally for setup and was stopped; no worker/provider invocation
was started. Task containers are stopped after checks. No remote server was used.

The checkout initially needed its pinned dependencies installed. Migration
generation initially failed before the scratch database became available;
schema validation/build succeeded and generation/deployment passed after local
setup. One simultaneous test/build rerun timed out in unchanged GitHub helper
tests; final gates run sequentially with unchanged timeouts.
The UI test URL initially carried into an existing API-client unit test, which
expects a relative URL. Clearing that variable for tests fixed the environment;
it is exported only for the production browser build. No test was weakened.

CP-02B prompt templates/revisions, CP-02C immutable execution snapshots and
CP-02D complete prompt/task/agent editors and execution preview remain open.
The existing agent edit routes remain unchanged except team-view selection;
reproducibility after configuration edits is not claimed. Concurrent scheduler
leases and evidence-based phase acceptance remain CP-03 and CP-06.

Changes are committed locally on `codex/cp02a-team-membership`; no push or PR
creation is included. CP-02A remains unchecked pending browser acceptance and
independent review, even though implementation and local non-browser gates pass.
