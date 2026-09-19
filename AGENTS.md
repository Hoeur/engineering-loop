# AGENTS.md — how to work in the EngLoop repository

Read this file before changing anything. It is the contract every agent (and
every human) works to. `.ai/*.md` holds the deeper reference material.

## 1. What this repository is

EngLoop is a multi-agent engineering **control plane**. It plans, implements,
verifies, reviews and ships code changes using coding agents, while keeping the
decisions, evidence and money auditable. It is not a chat interface.

The single most important invariant: **a claim is not evidence.** Nothing an
agent says makes a check pass, a finding resolved, or a task complete. EngLoop
runs the commands itself and reads the exit codes.

## 2. Architecture at a glance

```
apps/web      Next.js App Router — the control plane UI (no database access)
apps/api      NestJS REST API — the only writer of most domain state
apps/worker   BullMQ worker — the only process that runs commands or touches git
packages/*    Shared domain: types, zod schemas, workflow, git, agent SDK, logger
```

Data flows one way: **web → api → queue → worker → database → api → web.**
The web app never imports `@engloop/db`. The API never spawns a process.

## 3. Folder ownership

| Path                             | Owns                                                        | Never contains                  |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| `packages/types`                 | enums, event types, API envelope types                      | runtime dependencies            |
| `packages/schemas`               | every Zod schema (agent contracts + DTOs)                   | database access                 |
| `packages/workflow`              | task state machine, workflow definitions, orchestrator port | IO of any kind                  |
| `packages/git`                   | git service, worktree manager, command runner               | business logic                  |
| `packages/agent-sdk`             | provider interface, registry, adapters                      | knowledge of tasks or workflows |
| `packages/db`                    | Prisma schema, client, migrations, seed                     | HTTP concerns                   |
| `apps/api/src/modules/*`         | one domain module each                                      | filesystem or process access    |
| `apps/worker/src/workflow/steps` | one file per workflow step                                  | HTTP handlers                   |

## 4. Coding conventions

- TypeScript strict everywhere. `any` is an ESLint error; use `unknown` and narrow.
- No business logic in controllers. A controller validates, delegates, returns.
- No database access outside `apps/api` and `apps/worker` services.
- Files stay focused. If a service passes ~400 lines, split it by responsibility.
- Comments explain _why_, never _what_. Delete a comment that restates the code.
- Import domain enums from `@engloop/types`, never from `@prisma/client`, in
  anything the browser can reach.
- Use `import type` for type-only imports (enforced by ESLint).

## 5. Database rules

- `packages/db/prisma/schema.prisma` is the only schema. Change it, then run
  `pnpm db:migrate`.
- Every enum in the schema must exist in `packages/types/src/enums.ts` with the
  same members. `packages/db/test/enum-parity.spec.ts` fails the build otherwise.
- Index any column you filter or sort on. Composite indexes go in query order.
- Multi-row writes that must not half-apply go in `prisma.$transaction`.
- Money is `Decimal(12, 6)`; never `Float`.
- `task.status` is written **only** by `TaskTransitionService` (API) or
  `TaskTransitions` (worker). Both consult the shared state machine first.

## 6. API patterns

- Every response uses the envelope: `{ success, data, meta }` or
  `{ success, error: { code, message, details }, meta }`. The interceptor and the
  exception filter apply it; controllers return plain data.
- Validation uses the shared Zod schemas via `zodPipe(schema)`. Do not write a
  second DTO definition.
- Errors are `AppError` with a stable machine-readable `code` from
  `ApiErrorCode`. Never throw a bare string.
- Document each route with `@ApiOperation` and `ApiEnvelopeResponse`.
- Anything long-running is enqueued, not awaited in the request.

## 7. Frontend patterns

- Server data lives in TanStack Query only. Zustand holds UI state only.
- Every screen renders loading, empty and error states — `QueryBoundary` gives
  you all three. A blank area is a bug.
- Tables use `DataTable`, which renders a table from `md` up and stacked cards
  below. No screen may scroll horizontally at 375px.
- Status colours come from `lib/status.ts`. Never hardcode a status colour.
- Domain enums come from `@engloop/types`, so a new status appears in filters
  automatically.

## 8. Security rules

- Agent execution is untrusted. Every run gets an isolated worktree, a timeout,
  a token budget, a cost budget and an allowlisted command set.
- Commands run through `CommandRunner` with `spawn(cmd, args[])`. Never build a
  shell string; never pass `shell: true`.
- Agents never receive a path inside `workspace/repositories/`.
- Credentials are AES-256-GCM encrypted at rest and never leave the API. The
  provider endpoints return `hasCredential`, never the value.
- Every agent start/stop, command, task transition, git action, approval, review
  decision and configuration change writes an `AuditLog` row.

## 9. Test commands

```bash
pnpm lint         # ESLint, zero warnings tolerated
pnpm typecheck    # tsc --noEmit across every package and app
pnpm test         # Vitest unit + integration suites
pnpm test:e2e     # Playwright, across the six target viewports
pnpm build        # Builds every package and app
```

Add a test with the change that needs it. A bug fix without a regression test is
not finished.

## 10. Definition of done

A task is complete only when **all** of these hold:

1. The requirement and every acceptance criterion are satisfied.
2. `pnpm lint` passes.
3. `pnpm typecheck` passes.
4. `pnpm test` passes.
5. `pnpm build` passes.
6. A review has been performed.
7. Zero **critical** findings remain open.
8. Zero **high** findings remain open.
9. The worktree is clean — no uncommitted changes.
10. Changes are committed, or explicitly recorded as not requiring a commit.

`apps/worker/src/workflow/steps/finalize.ts` enforces this in code. A task that
fails any blocking gate goes to `NEEDS_HUMAN_REVIEW`, never to `COMPLETED`.
