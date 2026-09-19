# EngLoop Next Delivery Plan

**Updated:** 2026-09-19  
**Purpose:** Convert the current verified codebase into a production-ready engineering control plane through bounded, evidence-backed delivery phases.

## 1. Current verified baseline

The tenant-isolation and workflow-safety repair is complete.

- Task, workflow, step, and agent cancellation use conditional database claims.
- Agent creation and completion serialize with cancellation through the task row lock.
- Terminal workflow decisions supersede active sibling workflows and their child execution.
- Agent stop audits are persisted in the same transaction as parent cancellation.
- Duplicate workflow deliveries use an exclusive claim, heartbeat, and expired-lease recovery.
- Global findings, screenshots, reviews, dashboard counts, and nested aggregates use fail-closed ownership checks.
- Independent review reports zero critical, high, or medium findings.
- Lint, all 14 TypeScript projects, 49 test files with 386 tests, and every package/application build pass.

Two environment gaps remain:

1. This checkout has no `.git` directory, so branch, upstream, commit, and clean-worktree evidence cannot be produced.
2. Browser E2E was not run because the Playwright browser and base URL are not configured. Global `pnpm` also fails with `EPERM` on `C:\Users\YCT_2`, although repository-local binaries work.

## 2. Delivery principles

Every phase follows the same bounded loop:

1. Planner confirms the requirement, current implementation, threats, dependencies, and measurable acceptance criteria.
2. Implementer changes the smallest coherent surface and adds meaningful regression coverage.
3. EngLoop runs the commands and records exit codes; agent statements do not satisfy a gate.
4. An independent reviewer inspects the complete patch and reports findings by severity.
5. A verifier reruns focused checks and the full required gates on the frozen source.
6. Critical and high findings block completion. The final report records medium and low findings with an owner and target phase.

No phase is complete without:

- acceptance criteria satisfied;
- lint, typecheck, tests, and build passing;
- required E2E or live-provider evidence captured;
- independent review complete;
- zero critical and high findings;
- clean worktree and commit evidence, once Git metadata is restored.

## 3. Priority sequence

| Priority | Phase | Outcome | Dependency |
| --- | --- | --- | --- |
| P0 | Restore evidence baseline | Git and browser evidence become reproducible | None |
| P1 | Sandboxed agent execution | Untrusted agents run with OS-level containment | P0 |
| P2 | Real provider and GitHub delivery | Codex-to-PR path is proven live | P0, preferably P1 |
| P3 | Real UI QA and live updates | Operators see and verify current execution state | P0, P2 |
| P4 | Durable and parallel orchestration | Work survives outages and uses task dependencies safely | P1, P2 |
| P5 | Production access and notifications | OIDC, resource authorization, and actionable alerts | P0 |
| P6 | Quality and prompt-injection gates | Coverage and untrusted-content controls block unsafe completion | P1, P2 |

## 4. Phase P0 — restore the evidence baseline

### Objective

Make repository state and browser behavior independently verifiable before expanding runtime capability.

### Work

- Recover the original `.git` metadata or create a fresh clone from the authoritative remote. Do not initialize a replacement repository that loses history.
- Confirm the checked-out branch, remote URL, upstream, HEAD commit, and worktree status.
- Reapply or verify the current repair patch against that authoritative checkout.
- Fix the Windows command path so the repository scripts do not depend on the failing global `pnpm` launcher.
- Configure `PLAYWRIGHT_CHROMIUM_PATH` or install the repository-approved browser runtime.
- Configure the E2E base URL and supervised web server startup.
- Run Playwright at 1440, 1024, 768, 430, 390, and 375 pixels.
- Capture console errors, failed requests, screenshots, and horizontal-overflow results.

### Acceptance criteria

- `git status --short`, branch, upstream, remote, and HEAD are captured in the verification record.
- The repair diff is reviewable against a real base revision.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` run through repository-supported commands on Windows.
- All six Playwright viewports pass without uncaught page errors or horizontal scrolling.
- The worktree is clean and the repair is committed, or an explicit no-commit decision is recorded.

## 5. Phase P1 — sandboxed agent execution

### Objective

Replace worker-user execution with one isolated runtime per agent run.

### Work

- Introduce an execution-runtime port owned by `apps/worker` and implemented outside the provider adapters.
- Start one container or equivalent isolated process boundary per run.
- Mount only the assigned worktree and required read-only tooling.
- Apply CPU, memory, process-count, disk, and wall-clock limits.
- Deny network access by default; use an explicit hostname and port allowlist per provider or task.
- Pass credentials through short-lived runtime secrets without writing them to the worktree, logs, artifacts, or agent context.
- Terminate the full process group on timeout, budget exhaustion, task cancellation, workflow supersession, or worker shutdown.
- Persist runtime identity, limits, exit reason, and resource use in the audit trail.

### Acceptance criteria

- An agent cannot read a sibling worktree, repository store, worker environment, or host credential file.
- An agent cannot launch a non-allowlisted executable or connect to a non-allowlisted destination.
- CPU, memory, disk, process, timeout, and cancellation limits are proven by integration tests.
- A killed worker leaves no running child container or process after recovery.
- Provider behavior and structured output contracts remain unchanged.

## 6. Phase P2 — real provider and GitHub delivery

### Objective

Prove one complete production-like task from planning through a real pull request.

### Work

- Validate the Codex adapter against the installed live CLI, including authentication, argv, streamed events, structured output, sessions, cancellation, usage, and cost.
- Run the same contract suite against Claude Code so provider differences remain inside `packages/agent-sdk`.
- Exercise GitHub App installation-token minting against a controlled repository.
- Clone or fetch, create the isolated worktree, implement a small task, run all gates, push the branch, and open a pull request.
- Ingest installation, repository, push, and pull-request webhooks and prove delivery deduplication.
- Verify secrets and tokens are absent from logs, artifacts, prompts, database responses, and generated commits.

### Acceptance criteria

- A non-demo task reaches a real GitHub pull request with a valid URL and remote branch.
- The pull request diff matches the reviewed worktree diff.
- Duplicate webhook delivery does not duplicate state transitions or pull requests.
- Provider cancellation stops the live CLI and late output cannot mutate terminal state.
- Usage, token, duration, and cost telemetry reconcile with provider output.

## 7. Phase P3 — real UI QA and live run updates

### Objective

Give operators current, testable execution state without polling delays or mocked screenshots.

### Work

- Replace live-run polling with authenticated SSE unless bidirectional WebSocket communication is proven necessary.
- Stream workflow, step, agent, command, test, review, approval, cost, and cancellation events.
- Add reconnect cursors and replay so a browser resumes without gaps or duplicate events.
- Run Playwright from the worker against the assigned environment and persist real screenshots.
- Feed screenshots, console errors, failed requests, and layout evidence to the `UI_REVIEWER` role.
- Retain TanStack Query as the canonical server-state cache and reconcile streamed events into it.

### Acceptance criteria

- The live-run screen reflects a committed event within two seconds.
- Reconnection resumes from the last event without loss or duplication.
- UI review uses real screenshots at the required target widths.
- Loading, empty, error, cancellation, and terminal states are covered.
- No screen scrolls horizontally at 375 pixels.

## 8. Phase P4 — durable and parallel orchestration

### Objective

Support long-running workflows, human waits, and independent task execution without losing safety guarantees.

### Work

- Implement the existing `WorkflowOrchestrator` port with Temporal.
- Preserve the pure workflow decision function and database state machine.
- Define idempotency keys and activity retry policy for every external side effect.
- Convert approvals and schedules into durable signals and timers.
- Consume `TaskDependency` edges and schedule only dependency-ready tasks.
- Add organization and project concurrency caps, fair queuing, and cost-pressure throttling.
- Define cancellation propagation from project to task, workflow, step, agent, command, and provider.

### Acceptance criteria

- API, worker, Redis, and Temporal restarts do not duplicate steps or external side effects.
- Human approval can wait across deployments and resume exactly once.
- A dependency DAG runs independent tasks concurrently and never starts a blocked dependent task.
- Concurrency and cost caps are enforced atomically.
- BullMQ and Temporal pass the same orchestrator contract tests during migration.

## 9. Phase P5 — production authentication, authorization, and notifications

### Objective

Replace development login with auditable user identity and resource-level access control.

### Work

- Add OIDC login with secure callback state, session rotation, logout, and account linking.
- Define a static server-side permission matrix for organization, project, repository, task, agent, approval, audit, and configuration actions.
- Derive roles from authenticated membership; callers cannot submit their effective role.
- Add explicit status and permission guards for destructive and high-cost actions.
- Implement email and Slack notification providers behind `NotificationProvider`.
- Add user channel preferences, delivery attempts, deduplication, retry policy, and failure visibility.

### Acceptance criteria

- `AUTH_DEV_BYPASS` is disabled in production and cannot be enabled accidentally.
- Cross-organization and cross-project access tests cover every read and mutation family.
- The permission matrix is enforced in services, not only controllers or the UI.
- Approval, failure, budget, security, and human-review notifications are delivered once and audited.

## 10. Phase P6 — quality thresholds and prompt-injection defense

### Objective

Turn coverage and untrusted-content risk into explicit completion gates.

### Work

- Parse supported coverage formats and persist normalized totals and changed-line coverage.
- Add project-level coverage thresholds and a documented failure policy.
- Identify every untrusted input boundary: task text, repository content, issue bodies, pull-request text, webhooks, provider output, and generated artifacts.
- Label untrusted content in agent context and separate instructions from data.
- Detect and record suspicious instruction patterns without treating detection alone as proof of compromise.
- Require human review for high-risk instruction conflicts, credential requests, or attempts to weaken command and filesystem policy.

### Acceptance criteria

- Coverage thresholds are deterministic and block finalization when unmet.
- Changed-line calculations are reproducible from the reviewed base commit.
- Prompt-injection regression fixtures cannot alter system policy, allowed paths, commands, budgets, or approval requirements.
- Security decisions and overrides are visible in the audit trail.

## 11. Recommended first delivery slice

Start with **P0 only**. It is the smallest phase that converts the current strong implementation evidence into a fully reviewable repository and browser baseline.

The first task should be:

> Recover or clone the authoritative Git repository, apply the verified repair without losing history, configure the repository-local Playwright runtime, and produce a clean full-gate plus six-viewport E2E report.

Do not begin sandbox implementation until that task has a reviewable base commit, clean worktree evidence, and a reproducible E2E command.

## 12. Deferred scope

Keep these outside the next delivery sequence unless product requirements change:

- production Kubernetes rollout;
- multi-region infrastructure;
- automatic deployment to customer environments;
- billing and payments;
- broad UI redesign unrelated to execution safety or operator evidence.

