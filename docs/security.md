# Security

Agent execution is treated as untrusted input.

## Implemented controls

| Control                          | Implementation                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated workspace per run       | `WorktreeManager` — one `git worktree` per task                                                                                                 |
| No shell interpolation           | `spawn(cmd, args[], { shell: false })`                                                                                                          |
| Command allowlist                | `CommandRunner.assertAllowed`, from `COMMAND_ALLOWLIST`                                                                                         |
| Environment allowlist            | Only listed vars reach a child process                                                                                                          |
| Execution timeout                | SIGTERM then SIGKILL on the process group                                                                                                       |
| Output cap                       | `COMMAND_MAX_BUFFER_BYTES`, truncation flagged                                                                                                  |
| Token budget                     | Per-agent `maxTokens`, falling back to `AGENT_TOKEN_BUDGET`; enforced in the CLI adapter against the run's real usage                           |
| Cost budget                      | Per-agent `maxCostUsd`, falling back to `AGENT_COST_BUDGET_USD`; also checked before each run, where `BUDGET_EXCEEDED` stops the loop           |
| Retry bound                      | Per-step `maxAttempts`, per-task `maxAttempts`, `maxReviewCycles`                                                                               |
| Output validation                | Zod at the adapter boundary and again in `AgentExecutor`                                                                                        |
| Encrypted repository credentials | AES-256-GCM; ciphertext, IV and auth tag stored separately                                                                                      |
| GitHub App tokens                | Minted per request, never stored; git pushes get one repository + `contents: write`; tokens travel in git config env, never argv or remote URLs |
| Encrypted provider credentials   | AES-256-GCM per organization; set in the UI by owners/admins, decrypted only in the worker, never returned by the API                           |
| Log redaction                    | `REDACTED_PATHS` in `@engloop/logger`                                                                                                           |
| Permission levels                | Enforced inside the workflow router before each step                                                                                            |
| Audit trail                      | Append-only `AuditLog` for every controlled action                                                                                              |

## Permission levels

| Level             | Agents may                                   |
| ----------------- | -------------------------------------------- |
| `LEVEL_0_OBSERVE` | Inspect only                                 |
| `LEVEL_1_PLAN`    | Inspect and produce plans/TODOs              |
| `LEVEL_2_CODE`    | Modify isolated worktrees                    |
| `LEVEL_3_PR`      | Commit, push, open pull requests _(default)_ |
| `LEVEL_4_MERGE`   | Merge approved pull requests                 |
| `LEVEL_5_DEPLOY`  | Trigger deployment _(not implemented)_       |

The router returns `WAIT_FOR_HUMAN` rather than skipping a gate, so a project
below `LEVEL_2_CODE` plans and then stops, visibly.

## Placeholders — not implemented

These are modelled but **not** enforced. Do not describe them as protections:

- **Network policy** for agent processes — no egress restriction is applied.
- **Resource limits** (CPU, memory, disk) — no cgroup or container per run.
- **Sandboxing** — agents run as the worker user, inside the worker container.
- **Advanced RBAC** — org roles exist; per-resource authorization does not.

Before running untrusted agents against real repositories, run the worker in a
locked-down container with an egress allowlist and per-run resource caps.

The worker now routes CLI providers through the `HOST_PROCESS` execution-runtime
adapter. It scopes each run's worktree, executable, timeout, credential
environment and cancellation handle, and records `isolated: false` in its
descriptor. This is lifecycle and secret isolation inside one worker process;
it does not change any placeholder above into an implemented containment
control.

## Reporting

Security findings surface as `ReviewFinding` rows with `category: SECURITY` and
appear on the Quality → Security screen.
