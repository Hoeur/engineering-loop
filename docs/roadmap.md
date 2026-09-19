# Roadmap

## Shipped in this MVP

Project, repository, epic, feature and task management · validated task state
machine · workflow engine with a bounded review loop · BullMQ execution ·
provider abstraction with a complete mock · deterministic verification ·
structured review findings · git worktree isolation · secure command runner ·
scheduling · usage and cost tracking · audit log · approvals and permission
levels · the full dashboard, board, task detail, live run, agent, automation,
quality and insights screens.

Also shipped since: the **Claude Code adapter runs for real** — envelope
unwrapping, session ids, and token/cost telemetry taken from the CLI rather than
estimated, with the response schema serialised into the agent's request file.

## Next — highest value first

1. **Sandboxed agent execution.** One container per run with CPU, memory and
   disk caps and an egress allowlist. Today an agent runs as the worker's own
   user; the containment is a git worktree, an allowlisted executable, a timeout
   and a cost budget. Now that a real model executes there, this is the largest
   open risk.
2. **Verify the Codex adapter** against a live CLI the way Claude Code was: the
   argv and the JSONL event parsing are written from documentation only.
3. **GitHub App authentication.** Mint installation tokens, push branches, open
   real pull requests, ingest webhooks into the existing `WebhookEvent` intake.
   Pull requests are currently local rows (`local: true`, `url: null`).
4. **Real UI QA.** Drive Playwright against the running app, capture the three
   viewport screenshots, collect console and network errors, feed the
   `UI_REVIEWER` role — the only role still pinned to the mock.
5. **Live run streaming.** Replace TanStack polling (10–20s intervals) with SSE
   or WebSocket so a running step updates as it happens.
6. **Temporal adapter.** Implement `WorkflowOrchestrator` against Temporal for
   durable timers and human-in-the-loop signals.
7. **Parallel task execution.** `TaskDependency` edges are created by the plan
   materialiser but nothing consumes them: tasks run one at a time. Respect the
   edges and add a per-project concurrency cap.
8. **Coverage gates.** `TestRun.coverage` is written as `null`. Parse the
   coverage output and let a project require a threshold on changed lines as a
   definition-of-done gate.
9. **Real authentication and RBAC.** OIDC plus per-resource authorization. A
   dev-token login exists; `AUTH_DEV_BYPASS` is how the browser authenticates.
10. **Notification channels.** Only `InAppNotificationProvider` is wired. Email
    and Slack sit behind the existing `NotificationProvider` interface.
11. **Prompt-injection defence.** Repository content and agent output are treated
    as data and schema-validated, but nothing yet scans a task description or a
    fetched file for instructions aimed at the agent.

## Deliberately out of scope for now

Production Kubernetes · automatic deployment · billing and payments ·
multi-region infrastructure. Interfaces and placeholders exist; implementations
do not.
