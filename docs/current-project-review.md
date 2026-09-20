# Current Project Review

**Date:** 2026-09-20
**Reviewed commit:** `54910c6`
**Method:** full read-only inspection, then the four gates executed locally.
Every status below is either quoted from source or taken from a command's exit
code. Nothing here is inferred from documentation alone — where a document and
the code disagreed, the code won and the disagreement is recorded.

---

## Project type

**All three applications, in one pnpm monorepo.**

The brief anticipated a single repository to be classified as FRONTEND, API or
WORKER. That classification does not apply: this repository is the whole
platform. The product name is **EngLoop**.

| Brief's name         | Actual location | Stack                                           |
| -------------------- | --------------- | ----------------------------------------------- |
| `ai-cowork-frontend` | `apps/web`      | Next.js 15 App Router, React 19, TS, Tailwind 3 |
| `ai-cowork-api`      | `apps/api`      | NestJS 11, Prisma 6, PostgreSQL, Zod            |
| `ai-cowork-worker`   | `apps/worker`   | Node 20 + tsx, BullMQ 5, Redis                  |

Plus eleven shared packages under `packages/`.

---

## Current stack

- **Package manager:** pnpm 10.28.0 workspaces; Node >= 20.11.
- **Language:** TypeScript 5.9, `strict` everywhere. `any` is an ESLint error.
- **Database:** PostgreSQL via Prisma 6.16, running **engine-free**
  (see `docs/adr/0001-engine-free-prisma.md`).
- **Queue:** BullMQ 5.58 on Redis (ioredis).
- **Validation:** Zod 3.25, shared between web, API and worker.
- **Testing:** Vitest (unit/integration), Playwright (E2E, six viewports).
- **CI:** GitHub Actions — `.github/workflows/ci.yml`, `e2e.yml`.

---

## Existing architecture

One direction of flow, enforced structurally:

```
web ──REST──► api ──enqueue──► redis ──job──► worker ──► postgres
                │                                          │
                └───────────────── reads ──────────────────┘
```

Two properties are load-bearing and hold in the code as written:

1. **The API cannot execute anything.** It has no process spawn and no git
   access. The worker is the only component that touches a working copy. This is
   what makes independent verification structural rather than a convention.
2. **The routing policy is a pure function.** `decideEngineeringStep(state) →
   decision` in `packages/workflow/src/engineering-workflow.ts` has no IO, no
   clock and no randomness, so it is directly unit-testable — including a test
   that drives the loop to completion and fails if it does not terminate.

Execution is one queue job per step, so a crash resumes where it stopped. BullMQ
sits behind a `WorkflowOrchestrator` port.

---

## Existing features

Verified present in source:

- Organizations, projects, repositories, epics, features, tasks, comments.
- Task state machine — 20 states, validated transitions, written **only** by
  `TaskTransitionService` (API) or `TaskTransitions` (worker).
- Workflow engine — 13 step definitions, bounded review loop, permission gates.
- BullMQ queues with idempotent jobs, exclusive claims, heartbeats and
  expired-lease recovery.
- Agent provider abstraction (`CodingAgentProvider`) with Codex CLI, Claude Code
  CLI and an opt-in mock adapter.
- Deterministic verification: the system itself runs lint, typecheck, test and
  build and reads the exit codes.
- Structured review findings by severity, with a bounded fix loop.
- Git worktree isolation and a command runner using `spawn(cmd, args[])`.
- Schedules (BullMQ repeatable jobs), approvals, permission levels L0–L5.
- Usage records, cost records, append-only audit log, in-app notifications.
- GitHub App connect, repository import, branch push, pull request creation.
- Web: ~40 routes — dashboard, projects, kanban board, task detail, live run,
  agents, automation, quality, insights, inbox, settings.

---

## Existing modules

`apps/api/src/modules/` — 28 domain modules: agent-providers, agent-runs,
agents, approvals, artifacts, audit, auth, cost, dashboard, epics, features,
git, github, health, inbox, memory, notifications, organizations, projects,
repositories, reviews, schedules, tasks, tests, usage, users, webhooks,
workflows.

`apps/worker/src/` — processors (agent, review, scheduler, tests, workflow),
services (agent-executor, audit-writer, check-commands, context-builder,
credential-resolver, git-manager, plan-materializer, provider-credential-store,
review-engine, task-transitions, test-runner, usage-recorder), and
`workflow/steps/` — one file per step.

`packages/` — types, schemas, workflow, git, agent-sdk, db, logger, ui, config,
testing, github.

---

## Database

`packages/db/prisma/schema.prisma`, 1507 lines: **39 models, 37 enums.**

Models include User, Organization, OrganizationMember, Project, Repository,
GitHubInstallation, RepositoryCredential, Epic, Feature, Task, TaskDependency,
TaskComment, AgentProvider, Agent, AgentConfiguration, AgentRun, AgentMessage,
WorkflowDefinition, WorkflowRun, WorkflowStep, GitWorktree, GitBranch, Commit,
PullRequest, TestRun, TestResult, ReviewRun, ReviewFinding, Screenshot,
Artifact, Schedule, ProjectMemory, ArchitectureDecision, UsageRecord,
CostRecord, Notification, Approval, AuditLog, WebhookEvent.

Rules that are enforced, not just documented:

- Every schema enum must exist in `packages/types/src/enums.ts` with identical
  members — `packages/db/test/enum-parity.spec.ts` fails the build otherwise.
- Money is `Decimal(12, 6)`, never `Float`.
- Four migrations, plus `applied-datamodel.prisma` as the diff baseline.

The domain model already covers every entity the brief asks for, under different
names in three cases: the brief's `Workflow` is `WorkflowDefinition`, its
`ToolCall`/`LLMCall` are covered by `AgentRun` + `AgentMessage` + `UsageRecord`,
and its `KnowledgeEntry` is `ProjectMemory` + `ArchitectureDecision`.

---

## Authentication

Dev-grade JWT (`jose`) with a guard, plus `AUTH_DEV_BYPASS` for browser access.
Credentials are AES-256-GCM encrypted at rest; provider endpoints return
`hasCredential`, never the value. **There is no OIDC and no per-resource RBAC.**
Tenant isolation is enforced by fail-closed ownership checks and has dedicated
test suites (`tenant-isolation.*.spec.ts`, `tenant-integrity.services.spec.ts`).

---

## Realtime

**Not implemented.** There is no WebSocket, no SSE and no `EventSource` anywhere
in the codebase — a grep for all three returns only two unrelated matches in the
demo seed. The web app polls with TanStack Query `refetchInterval` between
5s and 30s (`apps/web/lib/queries.ts`).

This is the single largest gap against the brief, which asks for realtime status
updates in the UI.

---

## Testing

Verified by execution on 2026-09-20, not quoted from a document:

| Suite                | Files  | Tests                    |
| -------------------- | ------ | ------------------------ |
| `apps/api`           | 15     | 131                      |
| `apps/worker`        | 13     | 90                       |
| `apps/web`           | 11     | 47                       |
| `packages/db`        | 3      | 51                       |
| `packages/git`       | 6      | 38                       |
| `packages/workflow`  | 2      | 38                       |
| `packages/agent-sdk` | 2      | 25                       |
| `packages/schemas`   | 2      | 18                       |
| `packages/config`    | 1      | 9                        |
| `packages/github`    | 2      | 8                        |
| **Total**            | **51** | **455 passed, 0 failed** |

Playwright E2E: 3 specs (`navigation`, `states`, `command-palette`) across
1440/1024/768/430/390/375. Not run in this pass — it needs a live server and
browser binaries.

---

## CI/CD

`ci.yml` runs install → prisma generate → build packages → lint → typecheck →
test → build apps on every PR and push to main. `e2e.yml` runs Playwright.
Deployment is deliberately absent — noted in the workflow file itself.

---

## Security

Implemented:

- Agent execution treated as untrusted: isolated worktree per run, allowlisted
  executables, `spawn(cmd, args[])` with **no shell string and no `shell: true`**,
  execution timeout with process-group kill, token budget, cost budget.
- Agents never receive a path inside `workspace/repositories/`.
- AES-256-GCM credential encryption; secrets never returned by the API.
- Append-only audit log for agent start/stop, commands, transitions, git
  actions, approvals, review decisions and configuration changes.
- Permission levels gate the loop; a project below `LEVEL_2_CODE` plans and then
  stops visibly with an approval request rather than silently skipping a gate.
- `packages/config/src/env.ts` rejects placeholder secrets at boot.

Documented as **absent** in `docs/security.md`, and confirmed absent in code:
network policy for agent processes, per-run resource limits, container
sandboxing, per-resource RBAC, prompt-injection scanning.

---

## Observability

`AgentRun` captures provider, model, timings, token counts, cost, status and
error. `UsageRecord` and `CostRecord` track spend; `AuditLog` is append-only.
`packages/logger` provides structured logging with correlation context. The web
app exposes agent-runs, costs, usage, delivery and agent-performance screens.

Missing against the brief: no distributed tracing, and no log aggregation.

---

## Known issues

1. **`docs/architecture.md` was stale.** Its Mermaid diagram marked the Codex
   and Claude Code adapters `-.not wired in MVP.->`, while `README.md` and
   `packages/agent-sdk/src/providers/` show both implemented and the Claude Code
   adapter running for real. A reader trusting the diagram would conclude the
   platform cannot run a real agent. **Corrected in this pass.**
2. **UI QA captures nothing.** `apps/worker/src/workflow/steps/ui-qa.ts` wires
   the path to `ReviewEngine.persistUi` but screenshot capture is unimplemented,
   so the step always skips with "No screenshots captured". The step is
   deliberately `optional`, so this degrades a run rather than failing it.
3. **Three open decisions block that work** (`.loop/state.md`): the execution
   model for capture, who starts the app under test, and screenshot storage.
   These are user decisions, recorded as blockers rather than guessed.
4. **`TestRun.coverage` is always `null`** — written literally as `null` in
   `apps/worker/src/workflow/steps/verify.ts:132` and
   `apps/worker/src/processors/review.processor.ts:71`.
5. **Pull requests for `LOCAL` repositories are placeholder rows.** Real PRs go
   through the GitHub App; the local path is explicitly marked and never retains
   an `OPEN` placeholder that could be mistaken for delivery.

---

## Technical debt

Unusually low, and this is a measured claim rather than an impression:

- **Four** `TODO`/`FIXME`/`HACK`/`XXX` markers exist in the entire source tree,
  and **all four are false positives** — they are prose describing the product's
  own "plan and TODOs" feature, not debt markers.
- No dead-code or duplicate-module clusters were found.
- Dependencies are pinned to exact versions in all three apps.

The debt that does exist is *acknowledged absence*, not decay: interfaces that
exist without implementations (notification channels, sandboxing, billing), each
documented as such.

---

## Missing features

Measured against the brief.

**Absent entirely:**

| Gap                                | Evidence                                |
| ---------------------------------- | --------------------------------------- |
| Realtime transport (WebSocket/SSE) | no match anywhere in source             |
| Telegram integration               | no implementation; enum value only      |
| Email integration                  | no implementation; interface only       |
| MCP integration                    | no match anywhere in source             |
| Slack notifications                | `NotificationProvider` interface only   |
| Prompt-injection defence           | no scanner                              |
| Container sandboxing               | documented as absent                    |
| OIDC / per-resource RBAC           | dev JWT only                            |

**Declared but not wired into the workflow:**

| Gap                            | Evidence                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCUMENTATION` agent role     | declared in `AgentRole` and handled by the mock, but **no workflow step referenced it** and **neither CLI adapter declared the capability** |
| `SECURITY_REVIEWER` agent role | declared in `AgentRole`, capability declared by all three adapters, but no workflow step references it                                      |

Both roles are listed by the brief: Documentation as MVP-required, Security as
deferrable.

The Documentation gap was deeper than a missing step. `AgentProviderRegistry`
throws `ProviderUnavailableError` for any role a provider does not declare in
`capabilities.roles`, and **neither the Codex nor the Claude Code adapter listed
`DOCUMENTATION`** — so adding the step alone would have produced a role that
failed on every run. Both halves are fixed in WRK-001, and a regression test now
asserts the capability on both adapters.

`SECURITY_REVIEWER` does **not** share that second problem: all three adapters
already declare it, so wiring its step is a smaller change.

**Built but unused:**

| Gap                      | Evidence                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Parallel task execution  | `TaskDependency` rows are created by `plan-materializer.ts` and read only for display; no scheduler consumes the edges |
| Coverage gates           | `TestRun.coverage` hardcoded `null`                                                                                   |

---

## Duplicate / dead code

None found. Specifically checked: no duplicated DTO definitions (Zod schemas are
shared from `packages/schemas`), no parallel enum declarations (parity is
test-enforced), no unused workspace packages — all eleven are imported by at
least one app.

`apps/api/dist/` and other build output exists on disk from the build performed
during this review; it is gitignored and not part of the source tree.

---

## Architecture risks

1. **Unsandboxed agent execution — highest.** A real coding model now executes
   as the worker's own OS user. Containment is a git worktree, an allowlisted
   executable, a timeout and a cost budget. There is no container, no resource
   cap and no egress restriction. The blast radius of a hostile or confused
   agent is the worker host.
2. **No prompt-injection defence.** Repository content and agent output are
   schema-validated as *data*, which is correct and already prevents a whole
   class of problems — but nothing scans a task description or a fetched file
   for instructions aimed at the agent.
3. **Polling will not scale to live runs.** A 5-second interval across many
   concurrent runs multiplies into constant load, and still shows a stale UI.
4. **Serial execution wastes the DAG.** The planner already emits dependency
   edges; ignoring them makes a multi-task plan slower than it needs to be.
5. **Single-writer discipline depends on convention at one point.** `task.status`
   is correctly restricted to two services, but that rule is enforced by review,
   not by the type system.

---

## Recommended improvements

In priority order, with reasoning.

1. **Wire the `DOCUMENTATION` role into the workflow.** Required by the brief,
   already supported by every provider, unblocked by any open question, and
   small. Highest value per unit of risk in the repository.
2. **Realtime transport (SSE).** Replaces 5–30s polling. SSE over WebSocket
   because the data flow is one-directional server→client, which needs no
   duplex channel and survives proxies more simply.
3. **Container sandboxing for agent runs.** The largest open security risk.
4. **Resolve the three UI QA blockers, then implement capture.** Needs user
   decisions first; guessing them would waste the work.
5. **Consume `TaskDependency` edges** for parallel execution with a per-project
   concurrency cap.
6. **Coverage parsing and a changed-lines threshold** as a definition-of-done
   gate.
7. **Telegram command centre**, then email triage — both are brief requirements
   with zero current implementation.
8. **OIDC and per-resource RBAC** before any multi-tenant production use.
9. **Prompt-injection scanning** of task descriptions and fetched repository
   content.

---

## Summary

This is a mature, disciplined codebase, not a skeleton. It already implements
the architecture the brief specifies — provider abstraction, bounded retry
loops, permission gates, worktree isolation, audit logging — and in several
places exceeds it, notably by making the routing policy a pure function and by
refusing to mark a task complete on an agent's claim.

The correct action is **not** to rebuild. It is to close a small number of
specific gaps, starting with the Documentation role, which is required, absent
from the workflow, and unblocked.

---

## Changes made in this pass

Two things changed after the inspection above was written.

**1. `docs/architecture.md` corrected.** Its diagram marked the Codex and Claude
Code adapters as not wired; both are implemented. The diagram now shows them as
the real execution path and the mock as opt-in for offline tests.

**2. WRK-001 implemented** — the `DOCUMENTATION` role is wired into the
workflow. See [`TODO.md`](../TODO.md) for the task record.

The baseline moved from **455** to **475 passing tests / 0 failing**, with lint,
typecheck and build green throughout:

| Suite                | Before | After   |
| -------------------- | ------ | ------- |
| `packages/workflow`  | 38     | **44**  |
| `packages/agent-sdk` | 25     | **28**  |
| `apps/worker`        | 90     | **101** |
| **Total**            | 455    | **475** |

One finding is worth recording because it changes how the remaining role gaps
should be estimated: wiring a role is **two** changes, not one. The step must
exist *and* the provider must declare the role in `capabilities.roles`, because
`AgentProviderRegistry.resolve` throws `ProviderUnavailableError` otherwise.
Neither CLI adapter declared `DOCUMENTATION`, so the step would have failed on
every run. A test now asserts the capability on both adapters, and it was
confirmed to fail when the declaration is removed.
