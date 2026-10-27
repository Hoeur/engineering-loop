# CP-02D — Guarded task and general agent editors

Date: 2026-10-27. Base: `a698fda` (current `origin/main`).

Implement the remaining requirements editor on task detail and a general agent
create/edit dialog on Configurations. Keep server data in TanStack Query and
validate with the existing shared schemas. Preserve prompt/team/phase editors.

Task edits require the `updatedAt` value loaded by the editor. Lock the owned
project before its task, re-read status/version, validate references and write
the change and audit in one transaction. Direct edits support BACKLOG, PLAN_READY,
BLOCKED and FAILED planning tasks only. Pending/running/human-wait workflows,
pending/running agents, non-planner agent history, tests, reviews, commits, PRs,
planned children and accepted phase membership lock edits. Changes to executed
requirements need follow-up work; queued/running revision application and
cancel/restart remain CP-05. Clear the current planner projection on edits while
preserving historical runs/snapshots. No status or phase/parent mutation is
accepted by PATCH. Status transitions and membership keep their existing routes.

The task UI edits requirements, criteria, notes, suggested files, required checks,
type, priority, risk and attempt limit. Existing relationship APIs remain in place;
this slice does not add repository/epic/feature/assignee selection controls.

The agent UI creates organization-wide or project-scoped agents, and edits names,
roles, providers, models, enabled state, system prompts, permission/command
ceilings and limits. Scope is fixed after creation. Free-form configuration JSON
is excluded from update rather than silently ignored. Preserve legacy budget-only
PATCH calls while general editors supply `expectedUpdatedAt`. Structural edits
serialize with applicable project/task starts and reject live tasks, workflows,
agents, checks or reviews. Explicit disable/limit updates retain live policy
narrowing behavior. Creation/update and auditing commit atomically. Provider
credentials/configuration and prompt contents never enter change-audit metadata.

Acceptance: authorized create/edit; tenant/eligibility/state rejection; stale
draft retention and explicit reload; duplicate-submit/pending protection; shared
schema errors; real-API six-viewport coverage and screenshot inspection; task
edit/start races, concurrent editors and audit rollback on PostgreSQL; root lint,
typecheck, bounded workspace tests and production build; source review and clean
committed handoff. Broader independent review, execution/replay, scheduling,
phase gates and P1/P2 runtime/live delivery remain open.
