# EngLoop Master Roadmap

This roadmap distinguishes code that exists from behavior that still needs live validation or new
implementation.

## Milestone 1 — Usable vertical slice

- **MVP-001:** create a task in the frontend, start the existing workflow with planning enabled,
  and open the returned live run.
- Existing backend foundation: task/workflow persistence, BullMQ enqueue/advance, isolated
  worktrees, planner, implementer, deterministic checks, code review, bounded fixes, finalization.
- Exit: focused UI regression tests pass and one real local provider run is captured end to end.

## Milestone 2 — Planner DAG execution

- **WORKER-001:** consume the child tasks and dependency rows already produced by the planner.
- Add concurrency limits, dependency release, cancellation propagation, crash recovery, and parent
  aggregation.
- Exit: a branched plan executes independent children concurrently and joins deterministically.

## Milestone 3 — Complete agent team

- **WORKER-002:** add a real QA role agent and documentation role agent around the existing
  deterministic gates.
- Decide whether a supervisor agent adds value beyond the current deterministic workflow router.
- Exit: every claimed role has an actual invocation, validated output, persisted evidence, and
  bounded failure policy.

## Milestone 4 — Realtime control plane

- **REALTIME-001:** tenant-scoped SSE or WebSocket workflow events into TanStack Query caches.
- Retain polling as recovery/fallback rather than describing it as realtime push.
- Exit: run status updates promptly, reconnects catch up, and authorization tests prevent
  cross-organization data exposure.

## Milestone 5 — Real integrations

- Validate Codex and Claude Code against their installed CLIs and current output formats.
- Validate GitHub App installation auth, repository import, branch push, pull request creation, and
  webhook reconciliation against a real repository.
- Add notification providers only after delivery and permission policies are defined.

## Milestone 6 — Production hardening

- Per-run container/VM isolation, resource quotas, and egress policy.
- OIDC, full per-resource RBAC, secret rotation, retention, backup/restore, and incident controls.
- Deployment approvals, staged releases, operational SLOs, and trace correlation.

## Explicitly deferred from MVP-001

- Pushed realtime via SSE/WebSocket.
- A real QA role agent (deterministic command checks exist today).
- A documentation agent workflow stage.
- A supervisor role agent (deterministic routing exists today).
- Execution of planner-created child tasks as a dependency DAG.
- Security, DevOps, UI-specialist, research, email, and advanced scheduling expansion.
