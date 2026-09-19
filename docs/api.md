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
