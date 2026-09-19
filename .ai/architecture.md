# Architecture

## Processes

| Process       | Responsibility     | May do                                             |
| ------------- | ------------------ | -------------------------------------------------- |
| `apps/web`    | Control-plane UI   | HTTP to the API only                               |
| `apps/api`    | REST control plane | Database reads/writes, enqueue jobs                |
| `apps/worker` | Execution          | Run agents, run commands, touch git, write results |

The API is deliberately incapable of running a command or touching a working
copy. That boundary is what makes "the system verifies, the agent claims"
enforceable rather than aspirational.

## Shared packages

- `@engloop/types` — enums, domain events, API envelope. Framework-free.
- `@engloop/schemas` — Zod schemas. The only definition of every payload shape.
- `@engloop/workflow` — the task state machine, the workflow definitions and the
  orchestrator **port**. Pure: no IO, no clock, no randomness.
- `@engloop/git` — command runner, git service, worktree manager.
- `@engloop/agent-sdk` — `CodingAgentProvider`, the registry, and the adapters.
- `@engloop/db` — Prisma schema, client singleton, migrations, seed.
- `@engloop/logger` — pino with correlation-context binding and redaction.
- `@engloop/ui` — design-system primitives.
- `@engloop/config` — validated environment contract and platform constants.

## Dependency direction

```
web ──────► schemas, types, ui, workflow
api ──────► schemas, types, workflow, git, agent-sdk, db, logger, config
worker ───► schemas, types, workflow, git, agent-sdk, db, logger, config
packages ─► (only other packages; never an app)
```

Nothing in `packages/` imports from `apps/`. `agent-sdk` knows nothing about
tasks; `workflow` knows nothing about Prisma.
