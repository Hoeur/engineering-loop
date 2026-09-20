# Current Project Review

## Project Type

EngLoop is a TypeScript monorepo containing all three application types: a Next.js frontend, a
NestJS control-plane API, and a BullMQ execution worker. Shared packages hold contracts, workflow
policy, persistence, git operations, provider adapters, logging, configuration, and UI primitives.

## Current Stack

- Next.js 15, React 19, TanStack Query, Tailwind CSS, and shared Radix-based UI primitives.
- NestJS 11 REST API with Zod request contracts and OpenAPI documentation.
- Node.js/TypeScript BullMQ worker backed by Redis.
- PostgreSQL through Prisma 6 and the `@prisma/adapter-pg` driver adapter.
- Vitest for unit/integration tests and Playwright for responsive browser tests.
- pnpm workspaces, Dockerfiles, Docker Compose, and GitHub Actions.

## Existing Architecture

The runtime boundary is `web -> API -> Redis queue -> worker -> PostgreSQL -> API -> web`. The web
does not import the database package. The API persists control-plane state and enqueues work but
does not execute commands. The worker owns agent processes, command execution, worktrees, git, and
workflow step persistence. Shared Zod schemas and domain enums are used across process boundaries.

## Existing Features and Modules

- Projects, repositories, epics, features, tasks, comments, dependencies, and Kanban views.
- Workflow definitions/runs/steps, bounded retries and review cycles, cancellation, and approvals.
- Agent/provider configuration, role assignment, run history, token usage, cost, and audit records.
- Isolated git worktrees, branch/commit/PR records, deterministic lint/typecheck/test/build checks.
- Dashboard, inbox, schedules, notifications, project memory, architecture decisions, quality,
  agent, workflow, task, and insights screens.
- API modules for auth, organizations/users, projects/repositories, tasks/workflows, agents,
  approvals, reviews/tests/artifacts, audit/usage/cost, schedules/notifications, GitHub, webhooks,
  memory, dashboard, inbox, and health.

## Integrations

- Codex and Claude Code are runtime CLI adapters registered by the worker. Both use structured
  output decoding, isolated working directories, timeouts, and schema validation. Claude applies
  role-based tool permissions; Codex runs with `workspace-write` sandboxing. Mock remains an
  explicit adapter for offline/demo use and UI QA seed data.
- GitHub App authorization, repository import, installation-token use, branch push, PR creation,
  and webhook intake exist. A live end-to-end GitHub delivery is still an operational validation
  item.
- Email, Slack, Telegram, Gmail, and MCP integrations are not implemented.

## Database

`packages/db/prisma/schema.prisma` contains the canonical PostgreSQL model. It includes users and
organizations, project hierarchy, tasks/dependencies, providers/agents/runs, workflow runs/steps,
git entities, tests/reviews/findings, artifacts, schedules, memory, usage/cost, notifications,
approvals, audit logs, and webhook events. Migration and enum-parity checks are part of the repo.

## Authentication and Permissions

The API issues signed JWTs after password verification and applies a global auth guard. The browser
stores its bearer token client-side. A non-production `AUTH_DEV_BYPASS` exists. Project permission
levels gate workflow actions, but production identity-provider integration and complete
per-resource RBAC are not implemented.

## Realtime

There is no pushed WebSocket or SSE transport. The frontend currently refreshes server state with
TanStack Query polling; the live run detail polls every five seconds. Domain events are published
inside the backend, but they are not a browser realtime channel.

## Testing and CI/CD

Vitest suites cover packages and applications. Playwright covers responsive frontend states. The
main GitHub Actions workflow runs install, Prisma generation, package build, lint, typecheck,
tests, and app builds. A scheduled/manual E2E workflow starts PostgreSQL, Redis, the API, and the
web app before Playwright. Deployment is intentionally absent from CI.

## Security and Observability

Commands use argv arrays and an executable allowlist rather than shell strings. Agent runs use
worktrees, timeouts, token/cost budgets, schema-validated output, encrypted provider credentials,
and audit records. Structured logs, usage, cost, runs, test results, review findings, and audit
events are persisted. OS/container isolation, resource quotas, egress controls, OIDC, and complete
RBAC remain open.

## Known Issues, Technical Debt, and Missing Features

- Task creation has no caller-supplied idempotency key. If `POST /tasks` commits but its response is
  lost, the browser cannot distinguish that ambiguous outcome from a failed create; a later manual
  retry can create a second task. The dialog's synchronous lock prevents duplicate local submits,
  but it cannot recover an unknown server outcome.
- Planner output is materialized as child tasks and dependency rows, but the workflow does not
  schedule or execute that child DAG; the parent task continues through one implementation path.
- Core verification is deterministic command execution, not a real `QA` role agent. UI QA has an
  `UI_REVIEWER` step, but screenshot capture is not implemented and seeded data pins that role to
  mock.
- `DOCUMENTATION` exists in the role enum but no documentation-agent workflow step executes it.
- There is no supervisor agent; the deterministic workflow engine owns routing.
- Frontend updates are polling-based, not SSE/WebSocket push.
- Coverage values are not collected into the completion gate.
- Agent containment is a worktree plus process controls, not a container or VM sandbox.
- The Prisma schema still contains stale comments describing GitHub installation fields as
  placeholders even though GitHub App support now exists.

## Duplicate or Dead Code

No broad duplicate/dead-code removal was performed during this review. Generated migration
datamodel copies intentionally mirror the canonical schema and must not be treated as duplicate
application code. A dedicated static analysis pass is required before deleting anything.

## Recommended Improvements

1. Add server-supported idempotency and recovery for task creation.
2. Finish and validate MVP-001 as a real local run with the configured CLI provider.
3. Add a durable scheduler for planner-created child-task dependency graphs.
4. Add pushed workflow events while retaining polling as a fallback.
5. Implement explicit QA and documentation stages, or keep naming the current deterministic checks
   and code reviewer accurately.
6. Add process/container isolation, egress/resource controls, OIDC, and full resource authorization
   before production use.
