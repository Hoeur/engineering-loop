# CP-02D — Guarded configuration editor evidence

Date: 2026-10-27. Base: `a698fda`; branch: `codex/cp02-configuration-editors`.
Contract: [editor continuation plan](cp-02d-editors-plan.md).

## Delivered

Task detail now exposes **Edit task** for requirements, objective, description,
criteria, notes, suggested files, type, priority, risk, required checks and attempt
limit. The shared PATCH schema requires the loaded `expectedUpdatedAt`, actual
changes and supported fields. Status, phase and parent changes use their existing
separate routes. Server-side ownership, project/task locks, idle-state and evidence
guards apply even when UI controls are bypassed. Accepted-phase, live/queued,
executed and parent-with-planned-children tasks cannot be edited directly.
Changes clear the current planner projection and preserve historical runs and
snapshots. Reference validation and the audit share the update transaction.

Standalone check creation now locks/re-reads the task before selecting required
checks and persisting the run. Concurrent task edits and check/workflow creation
therefore observe a consistent ordering. Existing early tenant rejection remains.

Agent Configurations exposes **New agent** and **Edit agent** to owners/admins,
alongside existing limit-only controls. Creation supports organization or project
scope. Editing supports role/provider/model, name, enabled state, prompt,
permission/command ceilings and limits. Existing scope stays fixed. The new
administrator-only `GET /agents/:id/editor` projects only required settings:
provider credentials/configuration, free-form agent configuration and run contents
are excluded. General edits require `expectedUpdatedAt`; limit-only and explicit
disable calls retain their existing compatibility. Relevant active task/workflow/
agent/check/review state blocks structural execution-setting edits. Creation,
update and audits are atomic; audit metadata lists changed fields, not prompts.

Both forms validate through shared schemas, retain drafts/original baselines on
conflict, offer explicit saved-state reload, show retryable errors, and prevent
duplicate/pending submissions. Background agent-query errors preserve mounted
drafts. Server data remains in TanStack Query. Non-interactive DataTable mobile
cards now use a div so action buttons are not nested inside a button.

## Executed verification

- Root `corepack pnpm lint`: exit 0, zero warnings.
- Root `corepack pnpm typecheck`: exit 0 across all packages/apps, after the final
  implementation changes.
- Root `corepack pnpm build`: exit 0, all packages/apps and 33 Next pages.
  The web was subsequently rebuilt successfully for scratch API port 4095.
  Next's existing parent-lockfile/workspace-root warning remains informational.
- Full workspace tests:
  `corepack pnpm --workspace-concurrency=1 -r run test --maxWorkers=2`:
  **914 passed / 7 optional migration-forward tests skipped**, exit 0.
  Phase/team/prompt/snapshot PostgreSQL suites were enabled. No migration is added;
  the seven one-use forward proofs were not enabled on a populated database.
- New coverage: 23 task/schema service regressions, 10 PostgreSQL editor cases,
  7 task-form cases, 9 agent-form cases and 2 mobile-card cases. Existing card
  assertions now verify card count/content instead of requiring inert buttons.
  Existing tenant mutation assertions are preserved.
- PostgreSQL proof includes concurrent task/agent writers, task edit/start and
  edit/check-creation races, audit-failure rollback, foreign ownership, queued and
  accepted-phase locks, administrator enforcement, disabled provider/foreign scope
  rejection, live execution-setting locks and explicit revocation. Editor reads
  and mutation responses exclude seeded credential/configuration markers; prompt
  contents are absent from audits.
- Real-API Playwright:
  `corepack pnpm --filter @engloop/web exec playwright test --config playwright.editors.config.ts`:
  **12 passed / 0 skipped**, exit 0, at 1440/1024/768/430/390/375px.
  Normal seeded JWT login, real HTTP/PostgreSQL responses, no request interception.
  Task requirement saves, server 409 draft retention, explicit reload, queued UI
  locks and direct PATCH rejection pass. Agent creation, settings reads, server
  409 draft retention, reload and limit edits pass. Every viewport checks page
  width and zero uncaught page errors.
- Desktop and 375px task/agent dialog screenshots were inspected. Controls/text
  fit; long forms scroll internally with reachable action buttons. Captures remain
  in ignored `apps/web/test-results/configuration-editors-*/` directories.
- `git diff --check` passed. Source review covered transaction/lock order, tenant
  ownership, version checks, live-state policy, provider projection, atomic audit,
  draft lifecycle, safe text rendering, pending controls and React accessibility.
  No open critical/high finding was identified by this lead review. This is not
  independent review.

## Verification repairs and environment

The first workspace runs found a stale card-button assertion and an old tenant
mutation mock path. Card tests now assert the intended non-interactive structure;
the task service preserves its early ownership check and still rechecks ownership
under lock. No tenant assertion, timeout or required check was weakened. A new
agent guard initially used RunStatus for TestRun; integration/type checks caught
it and the guard now uses CheckStatus. Scratch containers were restarted after
they had been stopped during verification; subsequent DB checks passed.

The first browser configuration used browser-blocked port 4045. It was replaced
with 4095 and the web rebuilt. The next run passed all task scenarios and caught
an agent-test locator that expected a name without its role suffix; correcting
that locator produced the final 12/12 run without changing application behavior.

Only task-owned containers `engloop-4c45-editors-postgres` (55445) and
`engloop-4c45-editors-redis` (56345) were used. PostgreSQL 18 database
`engloop_editors` was newly created, migrated and seeded; existing demo databases
were not reset. API 4095 and web 3045 were owned/stopped by Playwright with
`reuseExistingServer: false`; the explicit config refuses a different database.
Set `E2E_EDITORS_ACCEPTANCE=1`, the scratch DATABASE_URL, API/web/Redis variables,
fixture JWT/encryption secrets, `AUTH_DEV_BYPASS=false`, and
`PLAYWRIGHT_CHROMIUM_PATH` when rerunning. Browser build API URL must match 4095.
No worker, provider execution, GitHub delivery or deployment was invoked.

## Remaining scope

This closes the bounded requirements/general-agent editor slice, not CP-02.
Repository/epic/feature/assignee selection controls remain separate task editor
work. Independent review, broader controlled mock plan/run snapshot acceptance,
immutable Git/artifact replay and historical executable output schemas remain
open, as do CP-03 scheduling, CP-05 running-work revision application, CP-06 phase
acceptance and P1/P2 runtime/live delivery. Earlier evidence files retain their
historical claims; this continuation and the active plan record current progress.

Changes are committed locally on the branch above. Publication, CI and deployment
are not part of this handoff. Scratch data and ignored verification logs are kept
for inspection; task-owned containers are stopped after verification.
