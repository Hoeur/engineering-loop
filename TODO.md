# AI Cowork TODO

Derived from the inspection recorded in
[`docs/current-project-review.md`](docs/current-project-review.md) at commit
`54910c6`. Every item below is a gap that was **verified absent or unwired in
the source** — nothing here restates work that is already shipped.

Prefix key: `API-` · `WEB-` · `WRK-` (worker) · `PKG-` (shared package) ·
`OPS-` (infrastructure/CI).

Status at baseline: lint, typecheck, **455 tests** and build all pass.
After WRK-001: **475 tests**, all gates still green.

---

## P0 — Foundation

### WRK-001 — Wire the DOCUMENTATION agent role into the workflow ✅ DONE

Priority: P0
Project: worker (+ packages/workflow, packages/db)
Completed: 2026-09-20 — verified by lint, typecheck, **472 tests**, build.

Dependencies:

- none

Description:
`AgentRole.DOCUMENTATION` exists in `packages/types/src/enums.ts` and is
declared in the capability list of all three provider adapters, but **no
workflow step references it**, so the role can never execute. The brief lists
Documentation as an MVP-required agent. This is the only required-but-absent
agent role with no blocking questions.

Tasks:

- [x] Add `DOCUMENT` to `WorkflowStepKey` (types + Prisma enum, keeping
      `enum-parity.spec.ts` green)
- [x] Migration `20260920120000_workflow_step_document` + refreshed
      `applied-datamodel.prisma` so the next diff is not polluted
- [x] Add the step definition to `ENGINEERING_TASK_STEPS` — `optional: true`,
      `maxAttempts: 1`, `requiredPermission: LEVEL_1_PLAN`
- [x] Route it in `decideEngineeringStep` after review approval and before
      `PREPARE_PR`, guarded by both `done()` and `failedFinally()`
- [x] Implement `apps/worker/src/workflow/steps/document.ts`
- [x] Persist output as `Artifact` rows (`ArtifactKind.REPORT`)
- [x] Unit tests: 6 routing tests incl. two termination proofs, 11 step tests
      incl. five path-traversal rejections

Acceptance criteria:

- [x] A task reaching approval produces a documentation artifact
- [x] The router never requests the step twice after a terminal outcome
- [x] A documentation failure degrades the run, never fails a sound task
- [x] `pnpm lint`, `typecheck`, `test`, `build` all pass
- [x] Agent start/stop auditing is inherited from `agents.execute`, which every
      agent step already routes through

Notes:

- `documentationEnabled` is **opt-out** (`Project.settings.documentation.enabled`
  must be explicitly `false` to disable), unlike `uiQaEnabled` which is opt-in:
  every approved diff is worth explaining, and the step is optional so the cost
  of being wrong is a degraded run.
- Documents are stored as artifacts rather than written into the worktree. The
  diff has already been reviewed and approved by this point, so adding files to
  it would ship content no reviewer saw.

---

### OPS-001 — Sandbox agent execution

Priority: P0
Project: worker / infrastructure

Dependencies:

- none

Description:
The largest open security risk in the repository. A real coding model executes
as the worker's own OS user; containment today is a git worktree, an allowlisted
executable, a timeout and a cost budget — no container, no resource cap, no
egress restriction.

Tasks:

- [x] Add the worker-owned execution-runtime port and `HOST_PROCESS` adapter for per-run cwd,
      command, timeout, credential-environment, cancellation and cleanup scoping. This adapter runs
      as the worker OS user and is **not a sandbox**; none of the containment tasks below are
      satisfied by it.
- [ ] One container per agent run, mounting only that run's worktree
- [ ] CPU, memory and disk caps
- [ ] Egress allowlist for the agent process
- [ ] Fail closed: if the sandbox cannot start, the run fails rather than
      silently falling back to host execution
- [ ] Integration test proving host paths outside the worktree are unreachable

Acceptance criteria:

- An agent cannot read a path outside its worktree
- An agent cannot reach an unlisted network host
- Exceeding a resource cap terminates the run and records the reason
- No code path executes an agent outside the sandbox

---

### PKG-001 — Prompt-injection scanning ✅ DONE

Priority: P0
Project: packages/agent-sdk (+ worker, packages/db, packages/types, web)
Completed: 2026-09-21 — verified by lint, typecheck, **526 tests**, build.

Dependencies:

- none

Description:
Repository content and agent output are schema-validated as data, which already
prevents a class of attacks. Nothing scanned a task description or a fetched
file for instructions aimed at the agent.

Tasks:

- [x] Scanner for injection patterns in task descriptions and fetched content —
      `packages/agent-sdk/src/injection-scanner.ts`, `scanAgentContext` walks
      the role input recursively and every `guidance.files` entry
- [x] Flag rather than silently strip; record the finding — `AuditAction.
    INJECTION_DETECTED` row with pattern id, confidence, source and a bounded
      excerpt (secret-scrubbed by `AuditWriter`)
- [x] Surface as a blocking finding when confidence is high — `AgentExecutor`
      throws `InjectionBlockedError` before credentials are resolved or the
      execution runtime is prepared; the run
      ends `FAILED` with `errorCode: AGENT_INPUT_INJECTION`
- [x] Unit tests with a corpus of known injection strings — 43 scanner specs
      including a false-positive sweep over this repo's own `AGENTS.md`,
      `README.md`, `TODO.md` and `.ai/*.md`; 4 executor specs

Acceptance criteria:

- A task description containing agent-directed instructions is flagged ✅
- The scan result is auditable ✅
- No false positive blocks a normal engineering description ✅ (regression
  corpus in `packages/agent-sdk/test/injection-scanner.spec.ts`)

Decisions worth knowing:

- Detection is regex-based with three coarse confidence tiers. Only `HIGH`
  blocks (override instructions, secret exfiltration, disabling _the agent's
  own_ controls, persona hijack, chat-template delimiters). `MEDIUM`/`LOW`
  (directly addressing the model, concealment from reviewers, `curl | sh`,
  authority claims, zero-width characters) are audit-only so a reviewer sees
  them without a false positive halting the loop.
- Project memory and budgets are not scanned: they are written by operators
  through the API, not fetched from the repository.
- Follow-up (not P0): surface `INJECTION_DETECTED` rows on the task page and
  let a project raise `MEDIUM` to blocking.

---

## P1 — Core

### API-010 — Realtime transport (SSE)

Priority: P1
Project: api (+ web)

Dependencies:

- none

Description:
There is no realtime transport anywhere in the codebase. The web app polls with
`refetchInterval` between 5s and 30s across ~12 query hooks. The brief requires
realtime status updates. SSE is preferred over WebSocket: the flow is
one-directional server→client, so a duplex channel buys nothing and costs proxy
complexity.

Tasks:

- [ ] `GET /api/events/stream` as `text/event-stream`, scoped by organization
- [ ] Publish the existing domain events onto the stream
- [ ] Authenticate the stream with the current guard; fail closed on tenant
      mismatch
- [ ] Heartbeat and reconnection with `Last-Event-ID`
- [ ] Integration test: an event published for org A never reaches org B

Acceptance criteria:

- A task transition reaches a subscribed client in under one second
- A dropped connection resumes without losing events
- Tenant isolation holds on the stream
- Polling remains as a fallback when the stream is unavailable

---

### WEB-010 — Consume the event stream

Priority: P1
Project: web

Dependencies:

- API-010

Tasks:

- [ ] `useEventStream` hook wrapping `EventSource`
- [ ] Invalidate the matching TanStack query keys on each event
- [ ] Raise `refetchInterval` once the stream is healthy; restore on failure
- [ ] Connection indicator in the shell
- [ ] Tests for reconnect and fallback

Acceptance criteria:

- The live run screen updates without a manual refresh
- Losing the stream degrades to polling with no user-visible error
- No screen regresses when the stream is unavailable

---

### WRK-010 — Parallel task execution

Priority: P1
Project: worker

Dependencies:

- none

Description:
`plan-materializer.ts` already resolves the planner's `dependsOn` into real
`TaskDependency` rows, but nothing consumes the edges for scheduling — tasks run
one at a time, so a multi-task plan is slower than its DAG requires.

Tasks:

- [ ] Ready-set computation from the dependency edges
- [ ] Per-project concurrency cap
- [ ] Cycle detection that fails the plan loudly
- [ ] Tests: diamond DAG, cycle rejection, cap respected

Acceptance criteria:

- Independent tasks run concurrently
- A blocked task never starts before its dependency completes
- A cyclic plan is rejected at materialisation, not at runtime
- The cap is never exceeded

---

### WRK-011 — Coverage parsing and gate

Priority: P1
Project: worker

Dependencies:

- none

Description:
`TestRun.coverage` is written literally as `null` in
`workflow/steps/verify.ts:132` and `processors/review.processor.ts:71`.

Tasks:

- [ ] Parse coverage output from the configured test command
- [ ] Persist to `TestRun.coverage`
- [ ] Optional per-project threshold on changed lines
- [ ] Wire the threshold into the definition-of-done gates in `finalize.ts`

Acceptance criteria:

- A real coverage number is persisted
- A project below its threshold goes to `NEEDS_HUMAN_REVIEW`, never `COMPLETED`
- A project with no threshold configured behaves exactly as today

---

### WRK-012 — Real UI QA screenshot capture

Priority: P1
Project: worker
**Status: BLOCKED — needs three user decisions**

Dependencies:

- Q1 execution model (in-process / subprocess / deferred)
- Q2 who starts the app under test
- Q3 screenshot storage (base64 vs object storage)

Description:
`workflow/steps/ui-qa.ts` already wires the path to `ReviewEngine.persistUi`;
only capture is missing, so the step always skips with "No screenshots
captured". The three blockers are recorded in `.loop/state.md` and are user
decisions — guessing them would waste the implementation.

Tasks:

- [ ] Resolve Q1–Q3
- [ ] Drive Playwright against the running app
- [ ] Capture the target viewports; collect console and network errors
- [ ] Persist `Screenshot` rows
- [ ] Tests

Acceptance criteria:

- Screenshots exist for a UI-affecting task and reach the `UI_REVIEWER`
- The seam in `ui-qa.ts` is unchanged
- An unreachable app still degrades rather than failing the task

---

## P2 — Integrations

### API-020 — Telegram command centre

Priority: P2
Project: api

Dependencies:

- none

Description:
No Telegram implementation exists — only a notification-channel enum value.

Tasks:

- [ ] Bot webhook intake reusing the existing `WebhookEvent` model
- [ ] Read commands: `/status`, `/projects`, `/workflows`, `/agents`, `/logs`
- [ ] Action commands: `/pause`, `/resume`, `/retry`, `/cancel`
- [ ] Approval commands: `/approve`, `/reject`, bound to the `Approval` model
- [ ] Identity binding from Telegram user to `User`
- [ ] Rate limiting and an audit row per command

Acceptance criteria:

- An unbound Telegram user can do nothing
- `/approve` is rejected unless that user could approve in the web UI
- Every command writes an `AuditLog` row
- `/deploy` stays unavailable until deployment exists

---

### API-021 — Email triage

Priority: P2
Project: api

Dependencies:

- none

Tasks:

- [ ] Read and classify inbound mail
- [ ] Summarise and detect actionable work
- [ ] Create a task from an actionable message
- [ ] Draft replies — **never auto-send**

Acceptance criteria:

- A draft is always human-approved before sending
- Sensitive categories are never auto-replied
- Task creation from mail is auditable

---

### API-022 — Slack notification channel

Priority: P2
Project: api

Dependencies:

- none

Tasks:

- [ ] Implement `NotificationProvider` for Slack
- [ ] Per-organization channel configuration
- [ ] Retry with backoff; never block the caller

Acceptance criteria:

- Notifications deliver to the configured channel
- A Slack outage never fails a workflow step

---

### API-023 — MCP integration

Priority: P2
Project: api / worker

Dependencies:

- none

Tasks:

- [ ] MCP client behind the existing tool abstraction
- [ ] Per-server permission rules
- [ ] Surface MCP tools in the agent context

Acceptance criteria:

- An MCP tool is callable by a permitted role only
- Every call is audited

---

## P3 — Automation

### WRK-030 — Wire the SECURITY_REVIEWER role

Priority: P3
Project: worker

Dependencies:

- WRK-001 (same step-addition pattern)

Description:
Like DOCUMENTATION, the role exists and every provider declares support, but no
workflow step references it. The brief explicitly defers Security past MVP, so
this follows the Documentation step rather than leading it.

Tasks:

- [ ] `SECURITY_REVIEW` step key, migration, enum parity
- [ ] Step handler reusing `ReviewEngine`
- [ ] Route after checks pass, before code review
- [ ] Blocking findings re-enter the bounded fix loop
- [ ] Termination test

Acceptance criteria:

- A critical security finding blocks completion
- The loop remains bounded
- The step is optional and degrades on failure

---

### API-030 — GitHub webhook → workflow

Priority: P3
Project: api

Dependencies:

- none

Tasks:

- [ ] Ingest PR and push events into `WebhookEvent`
- [ ] Signature verification
- [ ] Create a review workflow from an eligible event
- [ ] Post results back as a PR comment or check

Acceptance criteria:

- An unsigned webhook is rejected
- Delivery is idempotent on redelivery
- A PR receives the review outcome

---

## P4 — Advanced

### API-040 — OIDC and per-resource RBAC

Priority: P4
Project: api

Dependencies:

- none

Tasks:

- [ ] OIDC login replacing the dev JWT
- [ ] Per-resource authorization beyond tenant scoping
- [ ] Remove `AUTH_DEV_BYPASS` from production configuration

Acceptance criteria:

- No production path authenticates by dev token
- Authorization is enforced per resource, not only per tenant

---

### WRK-040 — Temporal orchestrator adapter

Priority: P4
Project: worker

Dependencies:

- none

Description:
`WorkflowOrchestrator` is already a port; the routing policy is already a pure
function. An adapter implements four methods and nothing else changes.

Tasks:

- [ ] Implement the port against Temporal
- [ ] Durable timers and human-in-the-loop signals
- [ ] Parity tests against the BullMQ adapter

Acceptance criteria:

- The same workflow completes identically under both adapters
- `decideEngineeringStep` is unchanged

---

### OPS-040 — Distributed tracing

Priority: P4
Project: all

Tasks:

- [ ] Propagate the existing correlation context as trace spans
- [ ] Export to an OTLP collector
- [ ] Never emit secrets into a span

Acceptance criteria:

- A workflow run is traceable end to end across all three processes
- No secret appears in any exported span

---

## Delivered on the `main` line (from commit `96cd643`)

These tasks were planned and completed independently of the numbered
backlog above, and were merged in from the main checkout. They use their
own ID scheme (`MVP-`, `WORKER-`, `REALTIME-`, `SUPERVISOR-`, `HARDEN-`);
the checked items correspond to the task-creation flow already shipped in
`apps/web/components/task/new-task-dialog.tsx`. Open items here have not
been reconciled against the backlog above — where the two overlap (notably
`WORKER-002` documentation vs. `WRK-001`, and `REALTIME-001` vs. `API-010`),
the entry above is the current one.

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

- [x] Accept a client-generated idempotency key for task creation.
- [x] Persist the key and created task atomically.
- [x] Return the original task when the same key and payload are retried.
- [x] Reject reuse of a key with a different payload.
- [x] Keep the key stable across frontend retry/recovery attempts.
- [x] Add API and frontend tests for a committed task followed by a lost response and retry.

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
