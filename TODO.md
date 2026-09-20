# AI Cowork TODO

## P0 — Foundation

### MVP-001 — Create and run an engineering task from the frontend

Priority: P0

Project: frontend + existing API/worker contracts

Description: Provide one safe vertical slice from task creation to the live workflow-run screen.
The frontend creates the task once, starts the existing engineering workflow with planning enabled,
and follows the returned workflow run. It must preserve the created task if starting fails.

Dependencies:

- Existing `POST /tasks` contract.
- Existing `POST /tasks/:id/run` contract and BullMQ orchestrator.
- Existing engineering workflow and live run detail route.

Tasks:

- [x] Create the task through a TanStack Query mutation.
- [x] Start that exact task through `POST /tasks/:id/run` with workflow
      `engineering-task`, `skipPlanning: false`, and `force: false`.
- [x] Navigate to `/engineering/runs/:workflowRunId` after the start response.
- [x] Show distinct creating and workflow-starting states.
- [x] Preserve a link and retry action for the created task when workflow start fails.
- [x] Add regression coverage for successful composition and partial failure without duplicate
      creation.
- [ ] Validate the complete path against running PostgreSQL, Redis, API, worker, web, and a real
      configured Codex or Claude Code CLI.
- [ ] Replace frontend polling with pushed workflow events (SSE or WebSocket), retaining a polling
      fallback.
- [ ] Execute planner-created child tasks according to their persisted dependency DAG.
- [ ] Add a real QA role agent; deterministic command checks currently provide the QA gate.
- [ ] Add a documentation-agent workflow step.
- [ ] Add a supervisor role only if agent-owned routing is deliberately chosen; today the
      deterministic workflow engine is the supervisor.

Acceptance criteria:

- One submit creates exactly one task and immediately requests one workflow run with planning
  enabled.
- A successful start opens the returned live workflow-run route.
- A start failure states that the task exists, links to it, and can retry starting it without
  creating another task.
- Server mutations and invalidation live in TanStack Query hooks.
- Focused frontend regression tests pass.
- The documents describe polling and existing provider adapters without claiming missing agents or
  child-DAG execution are complete.

### API-001 — Idempotent task creation and ambiguous-response recovery

Priority: P0

Project: API + frontend

Description: Make retries of `POST /tasks` safe when the server may have committed the task but the
client did not receive the response. The current in-memory submit lock prevents repeated local
events only; it cannot resolve a timeout or connection loss after commit.

Dependencies:

- Existing `POST /tasks` contract.
- A persisted, organization-scoped idempotency record or equivalent unique request key.

Tasks:

- [ ] Accept a client-generated idempotency key for task creation.
- [ ] Persist the key and created task atomically.
- [ ] Return the original task when the same key and payload are retried.
- [ ] Reject reuse of a key with a different payload.
- [ ] Keep the key stable across frontend retry/recovery attempts.
- [ ] Add API and frontend tests for a committed task followed by a lost response and retry.

Acceptance criteria:

- Repeating the same create request after an ambiguous response returns one task, not a duplicate.
- Concurrent requests with the same key create at most one task.
- A mismatched payload for an existing key fails with a stable conflict error.
- Organization ownership is enforced for every idempotency lookup.
- Audit records identify the original creation and later replay without logging secrets.

## P1 — Core

### WORKER-001 — Execute planner-created child DAG tasks

Priority: P1

Project: worker + API

Dependencies:

- MVP-001
- Existing `PlanMaterializer` task and dependency records

Tasks:

- [ ] Define runnable/blocked child-task semantics.
- [ ] Schedule dependency-free children with a per-project concurrency limit.
- [ ] Unlock dependents only after prerequisite completion.
- [ ] Aggregate child outcomes into the parent workflow.
- [ ] Add cancellation, retry, and crash-recovery tests.

Acceptance criteria:

- Independent children may run concurrently within the configured limit.
- No child runs before all dependencies complete.
- Parent status is derived from durable child state after worker restart.

### WORKER-002 — Add explicit QA and documentation stages

Priority: P1

Project: worker + agent SDK

Dependencies:

- WORKER-001

Tasks:

- [ ] Define schema contracts for QA and documentation outputs.
- [ ] Invoke a configured `QA` role without replacing deterministic exit-code checks.
- [ ] Invoke a configured `DOCUMENTATION` role after accepted implementation.
- [ ] Persist outputs and show them on the run detail screen.

Acceptance criteria:

- QA agent findings cannot override failed deterministic checks.
- Documentation output is validated, attributable, and persisted.
- Both stages have bounded retry and human-review behavior.

## P2 — Integrations

### REALTIME-001 — Push workflow progress to the browser

Priority: P2

Project: API + frontend

Dependencies:

- MVP-001

Tasks:

- [ ] Choose SSE or WebSocket and document reconnect/auth semantics.
- [ ] Publish tenant-scoped workflow changes.
- [ ] Update TanStack Query caches from events.
- [ ] Keep interval polling as a degraded fallback.

Acceptance criteria:

- A running step appears without waiting for the polling interval.
- Reconnect catches up without duplicate or cross-tenant events.

## P3 — Automation

### SUPERVISOR-001 — Decide whether a supervisor agent is needed

Priority: P3

Project: workflow + worker

Dependencies:

- WORKER-001

Tasks:

- [ ] Compare agent-owned routing with the existing deterministic state machine.
- [ ] Define authority, budgets, audit events, and safe fallback before implementation.

Acceptance criteria:

- Any supervisor proposal preserves deterministic safety gates and bounded execution.

## P4 — Advanced

### HARDEN-001 — Production execution isolation and identity

Priority: P4

Project: platform

Dependencies:

- Real-provider and GitHub end-to-end validation

Tasks:

- [ ] Container or VM isolation per run.
- [ ] CPU, memory, disk, and network egress controls.
- [ ] OIDC and complete resource-level RBAC.
- [ ] Production deployment approvals and observability.

Acceptance criteria:

- Agent processes cannot access unrelated repositories, host secrets, or unrestricted networks.
- Every privileged operation is authorized and audited.
