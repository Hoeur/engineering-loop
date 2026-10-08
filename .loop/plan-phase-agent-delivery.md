# Plan — Customizable phase-based parallel agent delivery

Created: 2026-10-06
Status: CP-01A and CP-01B published. CP-01C graph hardening and phase lifecycle
protections implemented and reviewed. Current checkout gate evidence is in
[graph evidence](cp-01c-evidence.md) and
[lifecycle evidence](cp-01c-lifecycle-evidence.md). CP-01D bounded active-phase
planning is implemented and reviewed; see [planner evidence](cp-01d-evidence.md).
CP-02A team membership and role coverage is next.
Scope: project requirements → editable phases → bounded tasks → parallel role
collaboration → recorded evidence → accepted phase → next dependent phase.

## Product contract

Users can add/edit phases, tasks, prompts, agents and teams. Each execution prompt
covers one bounded task, not the whole project. The owner coordinates; planner,
designer, implementer, QA and reviewer contribute throughout the active phase.
Only work with unmet dependencies waits. An idle agent may claim another eligible
item. Participation does not require a continuously running, cost-consuming CLI.

New work can enter an active phase. Changes never silently alter a running task:
create a revision and choose next-run application or cancellation/restart of the
affected work. Every run records its input revisions and artifact/commit versions.
The system—not an agent claim—decides whether evidence satisfies acceptance.

Reference design: [customizable flow](../docs/images/engloop-customizable-phase-agent-flow-2026-10-05.png).

## Existing code to extend

| Capability | Existing source | Extension needed |
| --- | --- | --- |
| Tasks, subtasks, dependencies | `packages/db/prisma/schema.prisma`: Task, TaskDependency | Phase membership, revisions and acceptance records |
| Task CRUD and dependency routes | `apps/api/src/modules/tasks/tasks.controller.ts` | Phase-scoped editing and immutable execution snapshots |
| Agent CRUD/configuration | `apps/api/src/modules/agents`; Agent, AgentConfiguration | Effective config snapshots, team membership and prompt revisions |
| Planner child-task creation | `apps/worker/src/services/plan-materializer.ts` | Plan only active phase, validate and schedule small deliverables |
| Step-based workflow | `packages/workflow/src/engineering-workflow.ts` | Add opt-in phase/team orchestration alongside legacy workflow |
| Checks/review/finalization | `apps/worker/src/workflow/steps` | Incremental evidence tied to exact artifacts and commits |
| Runtime isolation | `apps/worker/src/execution` | Preserve isolation, limits, cancellation and cleanup per invocation |

Stack: Next.js/React, TanStack Query for server state, Zustand for UI state,
NestJS, Redis/BullMQ, PostgreSQL/Prisma, TypeScript/Zod, Docker, Git/GitHub,
Vitest and Playwright. Keep database truth in PostgreSQL; queue jobs are delivery
mechanisms, not authoritative workflow state. No platform replacement is planned.

## Relationship to the existing roadmap

This is the detailed product track for P4 orchestration plus related F4 template
configuration. It does not close P1/P2 or replace `.loop/plan-delivery.md`.
Use CP-01–CP-07 for implementation phases so they cannot be confused with P0–P6.
Domain/configuration work can proceed with mocks; live concurrent provider/GitHub
acceptance requires the remaining P1 runtime and P2 delivery prerequisites.

## Delivery sequence and TODOs

### CP-01 — Requirements and phase/task domain

Dependencies: none. First implementation slice: CP-01A, phase CRUD with task membership.

- [ ] CP-01A: Design ProjectPhase relations and shared schemas; phase CRUD,
  phase ordering and linking existing Tasks; read/write UI with loading/error/empty states.
  Implementation and gate evidence: [CP-01A evidence](cp-01a-evidence.md).
- [ ] CP-01B: Record project contract and phase objectives, deliverables, criteria,
  required roles and dependencies; support explicit human edits before activation.
  Implementation contract and gates: [CP-01B evidence](cp-01b-evidence.md).
- [x] CP-01C: Validate phase/task DAGs: reject cycles, self-dependencies,
  cross-project references and organization escapes; protect accepted/active phases.
  Task graph hardening is implemented: serialized API dependency writes, deep
  cycle checks and planner DAG validation before materialization. See
  [CP-01C graph evidence](cp-01c-evidence.md). Activation, idle-only reopening,
  active/accepted contract and membership guards, and responsive controls are in
  [lifecycle evidence](cp-01c-lifecycle-evidence.md). ACCEPTED is reserved for the
  CP-06 evidence gate; activation does not start scheduling or task execution.
- [x] CP-01D: Planner outputs bounded active-phase tasks with objective, owner role,
  dependencies, suggested files, checks and criteria. Validate before materializing.
  Phased parent tasks require ACTIVE status and a matching phase/version binding;
  generated children retain their phase and owner role. Unphased planning remains
  compatible. This creates BACKLOG tasks; scheduling and immutable input snapshots
  remain CP-03 and CP-02. See [planner evidence](cp-01d-evidence.md).

Acceptance: create/edit a project with three phases; link/edit tasks; invalid DAGs
and cross-tenant references fail; phase 2 cannot activate before its prerequisites
are accepted. Existing task workflows remain usable. Schema enum parity and
forward migration tests pass; no existing data is deleted.

### CP-02 — Editable prompts, agents and team configuration

Dependencies: CP-01.

- [ ] CP-02A: Reuse Agent/AgentConfiguration; define team membership and required
  role coverage without assuming role names imply permissions.
- [ ] CP-02B: Add prompt templates/revisions with supported variables, input context
  and output contracts. Reject unresolved variables and invalid outputs.
- [ ] CP-02C: Snapshot task, prompt, effective agent/provider settings, budgets,
  permissions and artifact revisions atomically before enqueuing an execution.
- [ ] CP-02D: Build phase/task/agent/prompt/team editors and execution preview.
  Permissions can only narrow the caller/project policy; secrets are never previewed.

Acceptance: add/edit each configuration surface; an old run remains reproducible
after edits; disabled or unauthorized agents cannot be selected; credentials never
appear in snapshots, prompts or browser responses.

### CP-03 — Ready-work scheduler and exclusive claims

Dependencies: CP-01, CP-02.

- [ ] CP-03A: Add a pure dependency-aware readiness policy in packages/workflow.
  Plan/design/test-preparation/review-contract items may start before code exists.
- [ ] CP-03B: Worker atomically claims eligible items with expiring leases,
  fencing tokens and organization/project/team concurrency limits.
- [ ] CP-03C: Persist enqueue intent transactionally; dispatch/reconcile jobs
  idempotently so DB writes and queue delivery cannot lose or duplicate work.
- [ ] CP-03D: Add edit ownership, normalized paths and conflict detection.
  Each agent uses an isolated worktree; lease conflicts restrict integration edits.

Acceptance: multiple workers racing for one item produce one valid claim;
independent items run concurrently; blocked items cannot start; no conflicting
file edits or duplicate evidence persists; expired owners cannot write late results.

### CP-04 — Collaboration and incremental integration

Dependencies: CP-03.

- [ ] CP-04A: Persist typed events/messages referencing work items and artifact
  revisions; deduplicate delivery and validate tenant/role authorization.
- [ ] CP-04B: Trigger QA/review on ready increments. Findings become scoped fix
  items with bounded retries; review contracts can run from phase start.
- [ ] CP-04C: Owner coordinates integration onto a phase branch. Review/test
  evidence references exact commits; conflicts create explicit work items.
- [ ] CP-04D: Re-run affected checks after integration; pre-integration approval
  never automatically approves a changed combined diff.

Acceptance: planner/designer/QA/reviewer contribute before full implementation
finishes; independent work continues during feedback; an increment can fail
without falsely accepting the phase; stale evidence is rejected after integration.

### CP-05 — Work board and safe live editing

Dependencies: CP-02, CP-04.

- [ ] CP-05A: Show phase progress, role activity, ready/claimed/working/review/
  accepted states, dependency blockers, budgets, findings and evidence.
- [ ] CP-05B: Add work during execution with validation and readiness scheduling.
  Edit queued work by revision; use explicit next-run or cancel/restart actions for running work.
- [ ] CP-05C: Cancel affected runs and dependent work safely; old fencing tokens
  prevent late writes. Changing an accepted phase creates a new acceptance revision.
- [ ] CP-05D: Add authenticated pushed updates with reconnect/cursor handling,
  query invalidation and polling fallback; preserve 375px responsive layouts.

Acceptance: edits cannot mutate active snapshots; a canceled revision cannot
resurrect work; users understand what was invalidated and why; reconnect restores
board state without duplicating events.

### CP-06 — Phase gates, completion and crash recovery

Dependencies: CP-04, CP-05; live recovery requires P1 readiness.

- [ ] CP-06A: Task acceptance evaluates required outputs, current check results,
  required reviews and unresolved blocking findings from persisted evidence.
- [ ] CP-06B: Phase acceptance verifies required tasks, phase criteria and
  integrated commit evidence; transition next dependent phase atomically.
- [ ] CP-06C: Preserve final completion rules: checks/review, no critical/high
  findings, clean committed worktree, and actual GitHub delivery when required.
- [ ] CP-06D: Reconcile leases/jobs/runtime containers after worker death;
  stop expired executions, restore eligible work and bound retries/spend.

Acceptance: only current evidence opens a gate; duplicate gate jobs cannot advance
twice; unresolved budgets/blockers reach human review; injected crashes do not
leave uncontrolled processes or accept stale results.

### CP-07 — Full acceptance and rollout

Dependencies: CP-01–CP-06; P1/P2 for live provider/GitHub acceptance.

- [ ] CP-07A: Mock multi-phase scenario with all required roles, concurrent work,
  fixes, config edits, cancellation and restart; capture durable evidence.
- [ ] CP-07B: Live controlled-repository scenario with real providers and GitHub
  PR; verify usage/cost, secret redaction, two-tenant isolation and runtime cleanup.
- [ ] CP-07C: Enable opt-in project mode, migration/backfill, operational docs and
  feature rollback. Keep legacy workflows available during staged adoption.

Acceptance: repeatable full scenario passes without skipped required roles or
invented evidence; restart and duplicate-event scenarios pass; independent review
has zero open critical/high findings; opt-in rollback preserves all run history.

## Task execution contract

Every implementation work item records: ID, phase, objective, bounded deliverable,
dependencies, role/owner, allowed file scope, input/output contracts, task/prompt/
agent revisions, acceptance criteria, required checks, artifact/commit refs,
budget/timeout, retry policy and evidence. Prefer extending Task before adding a
second generic WorkItem model; CP-01 design review must settle this choice.

## Verification and handoff

For each slice: regression tests for changed behavior; pnpm lint/typecheck/test/
build; migrations and enum parity when schema changes; API tenant/concurrency tests;
Playwright when UI changes; independent review; clean committed worktree or an
explicit documentation-only no-commit handoff. Record actual exit codes and
unavailable checks. Existing nested `.claude` lint contamination must be resolved
or explicitly recorded; scoped lint is not silently substituted for the root gate.

This document began as a planning-only change. CP-01A and CP-01B now have source
implementation and linked verification evidence. Their historical root lint
limitation is recorded there; the 2026-10-08 graph continuation passes unqualified
root lint in the managed checkout without nested `.claude/worktrees`. The previous
checkout's lint configuration has not been changed. Publication is recorded in Git history. The four
generated design PNGs are preserved. Migrations were applied only to isolated
test databases; no deployment was changed.
