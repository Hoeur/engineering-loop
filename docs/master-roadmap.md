# Master Roadmap

Cross-application delivery plan for EngLoop, grouped into milestones. Task IDs
refer to [`TODO.md`](../TODO.md); the evidence behind every gap is in
[`docs/current-project-review.md`](current-project-review.md).

This roadmap starts from a **working system**, not an empty one. Milestone 0
records what already ships so later milestones are not mistaken for a rebuild.

---

## Milestone 0 — Already shipped (baseline `54910c6`)

Verified by execution on 2026-09-20: lint clean, typecheck clean across 14
projects, **455 tests passing / 0 failing**, all packages and all three apps
build.

```
Projects · repositories · epics · features · tasks
Task state machine — 20 states, validated transitions
Workflow engine — 13 steps, bounded review loop, permission gates
BullMQ queues — idempotent jobs, exclusive claims, crash-safe resume
CodingAgentProvider — Codex CLI, Claude Code CLI, opt-in mock
Deterministic verification — lint · typecheck · test · build, exit codes read
Structured review findings + bounded fix loop
Git worktree isolation + argv-array command runner
Schedules · approvals · permission levels L0–L5
Usage · cost · append-only audit log · in-app notifications
GitHub App connect · repository import · branch push · pull requests
Web — ~40 routes, six-viewport E2E
```

The brief's "first end-to-end feature" — user creates a task, API creates the
workflow, worker plans, implements in an isolated worktree, verifies, reviews,
reports back, UI shows progress — **already works.** The milestones below close
gaps in that loop rather than building it.

---

## Milestone 1 — Close the MVP agent gap

**Goal:** every agent role the brief calls MVP-required can actually execute.

```
WRK-001   Wire the DOCUMENTATION role into the workflow
```

The brief's MVP roster is Supervisor, Planner, Engineer, QA, Reviewer,
**Documentation**. The first five map to shipped steps. Documentation is
declared in `AgentRole`, supported by all three provider adapters, and
referenced by **no workflow step** — so it can never run.

Chosen as the first implementation task because it is required, unblocked, small
and additive: it follows the existing step pattern exactly and cannot regress a
shipped path.

**Exit criteria:** an approved task produces a documentation artifact; the
router provably terminates; all four gates stay green.

---

## Milestone 2 — Realtime

**Goal:** the control centre stops polling.

```
API-010   SSE event stream        ──►   WEB-010   Consume the stream
```

The brief requires realtime status updates; there is currently no WebSocket or
SSE anywhere in the codebase and the UI polls at 5–30s. SSE is chosen over
WebSocket because the flow is one-directional server→client.

**Exit criteria:** a task transition reaches a subscribed client in under a
second; tenant isolation holds on the stream; losing the stream degrades to
polling with no user-visible error.

---

## Milestone 3 — Execution safety

**Goal:** shrink the blast radius of a real model executing real commands.

```
OPS-001   Sandboxed agent execution
PKG-001   Prompt-injection scanning
```

This is the largest open risk in the repository: a real coding agent runs as the
worker's own OS user, contained only by a worktree, an allowlist, a timeout and
a budget.

Deliberately placed after Milestones 1–2 rather than first: sandboxing changes
how *every* agent runs, so it is safer to land once the agent roster is complete
and the UI can show a failing run in real time.

**Exit criteria:** an agent cannot read outside its worktree or reach an
unlisted host; a sandbox that fails to start fails the run rather than falling
back to host execution.

---

## Milestone 4 — Use the DAG, trust the numbers

**Goal:** stop wasting structure that already exists.

```
WRK-010   Parallel task execution (consume TaskDependency)
WRK-011   Coverage parsing + optional gate
```

The planner already emits dependency edges and nothing schedules on them;
`TestRun.coverage` is hardcoded `null`.

**Exit criteria:** independent tasks run concurrently under a per-project cap; a
cyclic plan is rejected at materialisation; a real coverage number is persisted
and can gate the definition of done.

---

## Milestone 5 — Real UI QA

**Goal:** the UI reviewer sees something.

```
WRK-012   Screenshot capture    [BLOCKED on Q1–Q3]
```

The step and the persistence path are already wired; only capture is missing.
Three open user decisions block it (execution model, who starts the app under
test, screenshot storage), recorded in `.loop/state.md`.

**This milestone cannot start until those three are answered.** It is sequenced
here rather than earlier for that reason alone — the work is small once
unblocked.

---

## Milestone 6 — External command surfaces

**Goal:** operate the platform from outside the web UI.

```
API-020   Telegram command centre
API-021   Email triage
API-022   Slack notifications
API-023   MCP integration
```

None of these exist today. Telegram leads because the brief specifies it as an
external command centre with an approval flow, and the `Approval` model it needs
already ships.

**Exit criteria:** an unbound Telegram user can do nothing; `/approve` is
rejected unless that user could approve in the web UI; every command is audited;
email drafts are never auto-sent.

---

## Milestone 7 — Security review and GitHub automation

```
WRK-030   Wire the SECURITY_REVIEWER role
API-030   GitHub webhook → review workflow
```

`SECURITY_REVIEWER` has the same shape of gap as DOCUMENTATION — declared,
provider-supported, unwired — but the brief explicitly defers Security past MVP,
so it follows rather than leads. Once it exists, an inbound PR webhook can drive
a full review workflow and report back to the pull request.

**Exit criteria:** a critical security finding blocks completion; webhook
delivery is idempotent and signature-verified; a PR receives the outcome.

---

## Milestone 8 — Production hardening

```
API-040   OIDC + per-resource RBAC
WRK-040   Temporal orchestrator adapter
OPS-040   Distributed tracing
```

Authentication is a dev-grade JWT with `AUTH_DEV_BYPASS`; that must not reach
production. The Temporal adapter is cheap by construction — `WorkflowOrchestrator`
is already a port and the routing policy is already a pure function, so an
adapter implements four methods and nothing else changes.

**Exit criteria:** no production path authenticates by dev token; the same
workflow completes identically under both orchestrators; a run is traceable end
to end with no secrets in any span.

---

## Sequencing rationale

```
M1 Documentation  ──►  M2 Realtime  ──►  M3 Safety  ──►  M4 DAG + coverage
                                                              │
                          M5 UI QA (blocked)  ◄────────────────┘
                                   │
                    M6 External surfaces  ──►  M7 Security + GitHub
                                                      │
                                          M8 Production hardening
```

Three rules drove this order:

1. **Unblocked before blocked.** M5 is small but waits on user decisions, so it
   cannot lead.
2. **Additive before invasive.** M1 adds a step and cannot regress a shipped
   path. M3 changes how every agent runs, so it lands once the roster is
   complete and failures are visible in real time.
3. **Required before deferred.** The brief's MVP roster comes before the roles
   it explicitly defers.

---

## Out of scope

Production Kubernetes, automatic deployment, billing and payments, multi-region
infrastructure. Interfaces and placeholders exist; implementations do not, and
nothing above adds them.
