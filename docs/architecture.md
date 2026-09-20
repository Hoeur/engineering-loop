# Architecture

EngLoop is an engineering control plane: it coordinates coding agents, verifies
their work independently, and keeps the decisions, evidence and cost auditable.

## System shape

```mermaid
flowchart LR
  subgraph Client
    WEB[apps/web<br/>Next.js App Router]
  end
  subgraph ControlPlane["Control plane"]
    API[apps/api<br/>NestJS REST]
  end
  subgraph Execution
    WORKER[apps/worker<br/>BullMQ workers]
  end
  subgraph Data
    PG[(PostgreSQL)]
    REDIS[(Redis)]
  end
  subgraph Providers["Coding agents"]
    CODEX[Codex CLI]
    CLAUDE[Claude Code CLI]
    MOCK[Mock]
  end

  WEB -->|REST + envelope| API
  API --> PG
  API -->|enqueue| REDIS
  REDIS -->|jobs| WORKER
  WORKER --> PG
  WORKER -->|CodingAgentProvider| CODEX
  WORKER -->|CodingAgentProvider| CLAUDE
  WORKER -.opt-in, offline tests only.-> MOCK
  WORKER -->|git + commands| WT[(workspace/worktrees)]
```

All three adapters implement `CodingAgentProvider` and are selected by
configuration, not by code. The mock is **disabled by default** and enabled only
by `AGENT_ENABLE_MOCK` for offline testing — real execution is the default path.

The API cannot spawn a process or touch a working copy. The worker is the only
component that can. That split is what makes "the platform verifies, the agent
merely claims" a structural property rather than a convention.

## Layering

```mermaid
flowchart TD
  T[packages/types<br/>enums · events · envelope]
  S[packages/schemas<br/>Zod contracts]
  W[packages/workflow<br/>state machine · router · port]
  G[packages/git<br/>runner · git · worktrees]
  A[packages/agent-sdk<br/>provider interface · adapters]
  D[packages/db<br/>Prisma]
  API[apps/api]
  WK[apps/worker]
  WEB[apps/web]

  S --> T
  W --> T
  W --> S
  A --> S
  A --> G
  API --> W
  API --> A
  API --> D
  WK --> W
  WK --> A
  WK --> D
  WEB --> S
  WEB --> W
```

Nothing in `packages/` depends on an app. `agent-sdk` knows nothing about tasks;
`workflow` knows nothing about Prisma; `web` never imports the database client.

## Request lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant W as Web
  participant A as API
  participant Q as Redis / BullMQ
  participant K as Worker
  participant DB as PostgreSQL

  U->>W: Start ENG-101
  W->>A: POST /tasks/:id/run
  A->>DB: create WorkflowRun (idempotencyKey)
  A->>Q: enqueue workflow.start (jobId = key)
  A-->>W: 202 { success, data: run }
  Q->>K: workflow.start
  loop one step per job
    K->>DB: read run + steps → derive state
    K->>K: definition.decide(state)  (pure)
    K->>DB: persist step, agent run, results
    K->>Q: enqueue workflow.advance
  end
  K->>DB: run SUCCEEDED / WAITING_FOR_HUMAN / FAILED
  W->>A: GET /workflow-runs/:id (poll)
```

## Key decisions

| Decision                                        | Why                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Provider abstraction (`CodingAgentProvider`)    | No business logic names a vendor; adding Gemini is one adapter plus a row. |
| Deterministic verification in the worker        | An agent's "tests pass" is a claim; exit codes are evidence.               |
| Pure routing function (`decideEngineeringStep`) | Replayable, unit-testable, and portable to Temporal unchanged.             |
| Orchestrator port                               | BullMQ is an adapter, not an assumption.                                   |
| One step per queue job                          | Crash-safe, individually retriable, resumable after restart.               |
| Enums defined once in `@engloop/types`          | Parity with Prisma is enforced by a test, not by discipline.               |
