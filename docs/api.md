# API

Base URL `http://localhost:4000/api`. Swagger UI at `/api/docs`, OpenAPI JSON at
`/api/docs-json`.

## Envelope

Success:

```json
{ "success": true, "data": {}, "meta": { "requestId": "…", "timestamp": "…" } }
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "TASK_INVALID_TRANSITION",
    "message": "Task cannot move from TESTING to COMPLETED.",
    "details": {
      "from": "TESTING",
      "to": "COMPLETED",
      "allowed": ["TEST_FAILED", "REVIEWING", "FAILED", "CANCELLED"]
    }
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

Every response carries `x-request-id` and `x-trace-id`; supply your own
`x-request-id` to correlate a client action with server logs.

## Error codes

`VALIDATION_FAILED` · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` ·
`INTERNAL_ERROR` · `DEPENDENCY_UNAVAILABLE` · `TASK_INVALID_TRANSITION` ·
`TASK_DEPENDENCY_CYCLE` · `TASK_MAX_ATTEMPTS_REACHED` · `TASK_ALREADY_RUNNING` ·
`AGENT_PROVIDER_UNAVAILABLE` · `AGENT_OUTPUT_INVALID` · `AGENT_BUDGET_EXCEEDED` ·
`AGENT_TIMEOUT` · `PERMISSION_LEVEL_TOO_LOW` · `APPROVAL_REQUIRED` ·
`COMMAND_NOT_ALLOWED` · `COMMAND_TIMEOUT` · `GIT_OPERATION_FAILED` ·
`WORKTREE_CONFLICT` · `REPOSITORY_NOT_READY`

## Endpoints

### Auth

| Method | Path          |
| ------ | ------------- |
| POST   | `/auth/login` |
| GET    | `/auth/me`    |

### Projects & repositories

| Method      | Path                                 |
| ----------- | ------------------------------------ |
| GET / POST  | `/projects`                          |
| GET / PATCH | `/projects/:id`                      |
| GET / POST  | `/projects/:id/repositories`         |
| GET         | `/projects/:id/board`                |
| POST        | `/projects/:id/role-assignments`     |
| GET         | `/repositories`, `/repositories/:id` |
| PATCH       | `/repositories/:id`                  |
| POST        | `/repositories/:id/credentials`      |

### Saved prompt output validation

`POST /projects/:projectId/prompts/:templateId/revisions/:revision/validate-output`
accepts `{ "output": <JSON value> }` and checks the exact saved prompt revision's
role against the current application output schema. Access is scoped to the
authenticated organization. It does not invoke an agent or accept work.

HTTP 201 returns `{ valid: true, templateId, revision, role }` in the success
envelope. Contract failures retain HTTP 422 and `VALIDATION_FAILED`, with optional
`error.details.issues` containing at most 20 `{ path: string[], message: string }`
entries. Array offsets are string path segments, for example
`["documents", "0", "path"]`. Non-schema failures may omit issue details.
Serialized output is bounded to 200,000 characters; other HTTP request limits
still apply. This endpoint does not provide historical executable schema replay.

### Work breakdown

| Method     | Path                          |
| ---------- | ----------------------------- |
| GET / POST | `/epics`, `/features`         |
| GET        | `/epics/:id`, `/features/:id` |

### Tasks

| Method      | Path                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| GET / POST  | `/tasks`                                                                      |
| GET / PATCH | `/tasks/:id`                                                                  |
| POST        | `/tasks/:id/transition`                                                       |
| POST        | `/tasks/:id/plan`                                                             |
| POST        | `/tasks/:id/run`                                                              |
| POST        | `/tasks/:id/cancel`                                                           |
| POST        | `/tasks/:id/retry`                                                            |
| POST        | `/tasks/:id/approve`                                                          |
| POST        | `/tasks/:id/tests`                                                            |
| POST        | `/tasks/:id/review`                                                           |
| POST        | `/tasks/:id/comments`                                                         |
| POST        | `/tasks/:id/dependencies`                                                     |
| GET         | `/tasks/:id/runs`, `/tasks/:id/tests`, `/tasks/:id/reviews`                   |
| GET         | `/tasks/:taskId/diff`, `/tasks/:taskId/commits`, `/tasks/:taskId/screenshots` |

### Agents

| Method      | Path                                  |
| ----------- | ------------------------------------- |
| GET / POST  | `/agents`                             |
| GET / PATCH | `/agents/:id`                         |
| GET         | `/agents/team`, `/agents/performance` |
| GET / POST  | `/agent-providers`                    |
| GET         | `/agent-providers/health`             |
| DELETE      | `/agent-providers/:key`               |
| GET         | `/agent-runs`, `/agent-runs/:id`      |
| POST        | `/agent-runs/:id/cancel`              |

### Execution & quality

| Method      | Path                                                 |
| ----------- | ---------------------------------------------------- |
| GET         | `/workflows`, `/workflow-runs`, `/workflow-runs/:id` |
| POST        | `/workflow-runs/:id/cancel`                          |
| GET         | `/test-runs`, `/test-runs/:id`                       |
| GET         | `/review-runs`, `/review-runs/:id`                   |
| GET / PATCH | `/review-findings`, `/review-findings/:id`           |
| GET         | `/worktrees`, `/pull-requests`                       |
| GET         | `/artifacts`, `/artifacts/:id`                       |

### Platform

| Method                      | Path                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET / POST / PATCH / DELETE | `/schedules`                                                                                            |
| POST                        | `/schedules/:id/run`                                                                                    |
| GET / POST                  | `/projects/:projectId/memory`                                                                           |
| GET                         | `/projects/:projectId/decisions` · POST `/decisions`                                                    |
| GET                         | `/usage`, `/costs`, `/costs/by-task`                                                                    |
| GET                         | `/audit-logs`                                                                                           |
| GET                         | `/notifications`, `/notifications/channels` · POST `/notifications/:id/read`, `/notifications/read-all` |
| GET                         | `/approvals`, `/approvals/permission-levels` · POST `/approvals/:id/decide`                             |
| POST                        | `/webhooks/github` · GET `/webhooks/events`                                                             |
| GET                         | `/dashboard/overview`, `/dashboard/delivery-metrics`                                                    |
| GET                         | `/health`, `/health/live`, `/health/ready`                                                              |

## Authentication

`POST /auth/login` returns a signed JWT; send it as `Authorization: Bearer …`.
In development `AUTH_DEV_BYPASS=true` resolves the seeded founder automatically,
so the dashboard works immediately after `pnpm db:seed`. The bypass refuses to
activate when `NODE_ENV=production`.

## Configuration editor contracts

`PATCH /tasks/:id` requires the exact `updatedAt` string returned by `GET /tasks/:id`:

```json
{ "expectedUpdatedAt": "2026-10-27T00:00:00.000Z", "title": "Revised planning task" }
```

Success is HTTP 200 in the normal envelope, containing the updated task. A stale
baseline returns HTTP 409 `CONFLICT`. Only idle planning tasks in BACKLOG,
PLAN_READY, BLOCKED or FAILED can change; active workflows/agents, executed
evidence, planned children and accepted phases return HTTP 409 `TASK_EDIT_LOCKED`.
Use follow-up work for changed executed requirements. Current plan projections
are cleared; historical runs and snapshots are preserved. Status, phase and
parent-task changes are not accepted here. Foreign tasks return HTTP 404
`NOT_FOUND`; malformed or empty edits return HTTP 422 `VALIDATION_FAILED`.

`POST /agents` and `PATCH /agents/:id` require authenticated OWNER or ADMIN
membership. The server derives organization ownership from the authenticated
user. Creation accepts the existing shared agent schema; provider must be
enabled and optional project scope must belong to the organization. Creation
returns HTTP 201; updates return HTTP 200, both in the normal envelope.

General agent edits require `expectedUpdatedAt` from `GET /agents/:id`:

```json
{ "expectedUpdatedAt": "2026-10-27T00:00:00.000Z", "model": "configured-model" }
```

The administrator-only `GET /agents/:id/editor` returns the settings needed by
the editor and the same version, excluding configuration JSON and run contents.

Stale edits and changes to role/provider/model/prompt/permission/commands during
applicable active work return HTTP 409 `CONFLICT`. Existing limit-only updates
and explicit disable requests remain compatible without a timestamp. Re-enabling
requires one. Scope changes and free-form configuration JSON updates are rejected
with HTTP 422 rather than silently ignored. Empty model text restores provider
default behavior; empty system-prompt text clears the override. Foreign agents
return HTTP 404, non-administrators HTTP 403, and invalid/unavailable references
HTTP 422 or 404. Writes and audits commit together. Provider credentials and
configuration are excluded from editor responses; audits record changed field
names rather than prompt/configuration contents.
