# Agent provider abstraction

## The interface

```ts
interface CodingAgentProvider {
  readonly key: string;
  readonly name: string;
  readonly kind: AgentProviderKind;
  readonly capabilities: ProviderCapabilities;

  startRun(context: AgentTaskContext): Promise<AgentRunResult>;
  resumeRun(sessionId: string, context: AgentContinuationContext): Promise<AgentRunResult>;
  cancelRun(runId: string): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
}
```

This is the only seam between EngLoop's business logic and any vendor. Nothing
outside `packages/agent-sdk/src/providers/` names Codex or Claude Code.

## Role resolution

Roles are never hardcoded to a provider. Resolution walks an override chain:

```mermaid
flowchart LR
  R[Role e.g. IMPLEMENTER] --> P{project.roleAssignments}
  P -->|hit| AG[Agent row → provider]
  P -->|miss| O{project-scoped agent for role}
  O -->|miss| ORG{org-scoped agent for role}
  ORG -->|miss| D[organization.defaultProviderKey<br/>or AGENT_DEFAULT_PROVIDER]
  AG --> RUN[provider.startRun]
  D --> RUN
```

Configure it per organization or per project — the Agent Team screen writes
`project.roleAssignments`.

## Adapters

| Adapter                   | Kind          | State                                                                                                                                                             |
| ------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MockAgentProvider`       | `MOCK`        | **Fully implemented.** Simulates planning, implementation, review, fixing, latency, failure injection and findings. Requires no credentials.                      |
| `CodexAgentProvider`      | `CODEX`       | Implemented with stdin requests, OpenAI-compatible JSON Schema output, session/usage decoding and workspace-write sandboxing.                                     |
| `ClaudeCodeAgentProvider` | `CLAUDE_CODE` | Implemented with stdin requests, JSON result envelopes, session/usage decoding, schema validation and role-based permissions (below). Serves every workflow role. |

Both CLI adapters extend `CliCodingAgentProvider`, which owns the safety rules:
allowlisted executable, isolated cwd, timeout, structured-output validation. A
new CLI agent only supplies its argv builders.

## Claude Code permissions

Headless Claude Code (`claude -p`) cannot ask for permission, so the adapter
decides per role, and its explicit rules override the operator's own Claude
settings:

| Roles                                                    | Flags                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architect, planner, code/security/performance reviewers  | `--disallowedTools Edit Write MultiEdit NotebookEdit Bash` — read-only                                                                                                   |
| Implementer, backend/frontend/database/devops developers | `--permission-mode acceptEdits` — edits inside the task worktree (its working directory)                                                                                 |
|                                                          | `--allowedTools` — `git status/diff/log/show`, the lockfile install (`npm ci`, `pnpm install --frozen-lockfile`, …) and the `lint`, `typecheck`, `test`, `build` scripts |

Nothing else runs without a prompt, and a prompt in headless mode is a refusal:
no `git commit`/`push` (EngLoop commits), no dependency changes, no network tools.
Claude Code also refuses a chained command (`a && b`) unless every part matches.

On Windows, point `CLAUDE_CODE_CLI_PATH` at the native `claude.exe` (for example
`C:/Users/<you>/.local/bin/claude.exe`): the worker never uses a shell, so the npm
`claude.cmd` shim cannot be started.

## Credentials: API key first, CLI login second

The worker decides what each CLI bills (`apps/worker/src/provider-auth.ts`):

| Provider    | Key in `.env`       | Handed to the CLI as                 | Without a key                                    |
| ----------- | ------------------- | ------------------------------------ | ------------------------------------------------ |
| Codex       | `OPENAI_API_KEY`    | `CODEX_API_KEY` (+ `OPENAI_API_KEY`) | the `codex login` in `CODEX_HOME` (ChatGPT plan) |
| Claude Code | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY`                  | the `claude` login (Claude subscription)         |

`codex exec` reads `CODEX_API_KEY` ahead of any stored login, and headless Claude
Code always uses `ANTHROPIC_API_KEY` when it is set, so a configured key wins and a
subscription's usage limit cannot stop a run. Clear the key to fall back to the
login. The worker logs the choice at startup (`worker.started` → `providerAuth`).

## Never trust the output

Every response passes through the role's Zod schema twice — once inside the CLI
adapter and once in `AgentExecutor` — before any workflow state changes:

```ts
const parsed = parseSafely(ROLE_OUTPUT_SCHEMAS[role], result.output);
if (!parsed.ok) throw new AgentOutputInvalidError(provider.key, parsed.issues, raw);
```

Invalid output becomes an `AGENT_OUTPUT_INVALID` failure. It never becomes state.

## Adding a provider

1. Implement `CodingAgentProvider` (or extend `CliCodingAgentProvider`).
2. Declare `capabilities.roles`.
3. Register it in `apps/worker/src/context.ts`.
4. Add the provider kind to the real-bootstrap allowlist and configure its credential in the worker process environment.
5. Assign it to a role on the Agent Team screen.

No other file changes.

---

## Switching from the mock to a real CLI agent

Three things decide which provider serves a role, in this order:

1. the project's `roleAssignments` (an agent id per role),
2. an enabled `Agent` row for that role in the organization,
3. the organization's `defaultProviderKey`, falling back to `AGENT_DEFAULT_PROVIDER`.

Real mode does not seed an agent team. Configure the organization default with
`pnpm bootstrap:real`; optional agent rows can then override individual roles.

```bash
# .env
AGENT_DEFAULT_PROVIDER=codex
CODEX_CLI_PATH=/absolute/path/to/codex
CODEX_MODEL=gpt-6-astra
OPENAI_API_KEY=sk-...                # billed per token; empty = the codex login
COMMAND_ALLOWLIST=...,codex           # the CLI must be allowlisted to be spawned

pnpm bootstrap:real                  # upserts the real organization/provider
```

`GET /health` on the worker reports each runtime adapter. Resolution fails
closed if the configured key is absent or cannot serve the role; it never
substitutes another provider. Mock mode is an explicit, offline-only opt-in.

### What a real run costs

The real bootstrap accepts Codex and Claude Code — both serve every mandatory
workflow role (architect, planner, implementer, code reviewer).

One historical task through plan → implement → verify → review → PR on `sonnet`,
against a small repository, measured rather than estimated:

| Role          | Tokens    | Cost      | Wall clock  |
| ------------- | --------- | --------- | ----------- |
| Architect     | 570.7k    | $0.23     | 1m 28s      |
| Planner       | 220.5k    | $0.11     | 43s         |
| Implementer   | 601.1k    | $0.23     | 1m 13s      |
| Code reviewer | 337.9k    | $0.17     | 1m 1s       |
| **Total**     | **1.73M** | **$0.73** | **~4m 30s** |

Token counts and cost come from the CLI's own result envelope, not from the
local pricing table — `AGENT_COST_BUDGET_USD` is therefore enforced against real
spend.
