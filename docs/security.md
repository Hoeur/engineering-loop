# Security

Agent execution is treated as untrusted input. So are task descriptions and
the guidance files fetched from a repository under test.

## Implemented controls

| Control                          | Implementation                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolated workspace per run       | `WorktreeManager` — one `git worktree` per task                                                                                                                                                                                                                                          |
| No shell interpolation           | `spawn(cmd, args[], { shell: false })`                                                                                                                                                                                                                                                   |
| Command allowlist                | `CommandRunner.assertAllowed`, from `COMMAND_ALLOWLIST`                                                                                                                                                                                                                                  |
| Environment allowlist            | Only listed vars reach a child process                                                                                                                                                                                                                                                   |
| Execution timeout                | SIGTERM then SIGKILL on the process group                                                                                                                                                                                                                                                |
| Output cap                       | `COMMAND_MAX_BUFFER_BYTES`, truncation flagged                                                                                                                                                                                                                                           |
| Token budget                     | Per-agent `maxTokens`, falling back to `AGENT_TOKEN_BUDGET`; enforced in the CLI adapter against the run's real usage                                                                                                                                                                    |
| Cost budget                      | Per-agent `maxCostUsd`, falling back to `AGENT_COST_BUDGET_USD`; also checked before each run, where `BUDGET_EXCEEDED` stops the loop                                                                                                                                                    |
| Retry bound                      | Per-step `maxAttempts`, per-task `maxAttempts`, `maxReviewCycles`                                                                                                                                                                                                                        |
| Output validation                | Zod at the adapter boundary and again in `AgentExecutor`                                                                                                                                                                                                                                 |
| Prompt-injection scan            | `scanAgentContext` (`@engloop/agent-sdk`) runs over the role input and fetched `AGENTS.md`/`.ai/*` before credentials are resolved or the execution runtime is prepared; HIGH findings fail the run closed (`AGENT_INPUT_INJECTION`), every finding is an `INJECTION_DETECTED` audit row |
| Encrypted repository credentials | AES-256-GCM; ciphertext, IV and auth tag stored separately                                                                                                                                                                                                                               |
| GitHub App tokens                | Minted per request, never stored; git pushes get one repository + `contents: write`; tokens travel in git config env, never argv or remote URLs                                                                                                                                          |
| Encrypted provider credentials   | AES-256-GCM per organization; set in the UI by owners/admins, decrypted only in the worker, never returned by the API                                                                                                                                                                    |
| Log redaction                    | `REDACTED_PATHS` in `@engloop/logger`                                                                                                                                                                                                                                                    |
| Permission levels                | Enforced inside the workflow router before each step                                                                                                                                                                                                                                     |
| Audit trail                      | Append-only `AuditLog` for every controlled action                                                                                                                                                                                                                                       |

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

- **Advanced RBAC** — org roles exist; per-resource authorization does not.

## Agent sandbox (OPS-001)

With `AGENT_EXECUTION_RUNTIME=container` (the default, and the only value
accepted in production) every CLI agent run gets its own Docker container from
`docker/agent-sandbox.Dockerfile`, created by `ContainerExecutionRuntime`:

| Control     | Enforcement                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Filesystem  | Only the run's worktree (`/workspace`) and a per-run scratch dir are mounted; image read-only  |
| Identity    | Non-root uid (root refused), `--cap-drop ALL`, `no-new-privileges`, `--init`                   |
| Resources   | `--cpus`, `--memory` with no swap, `--pids-limit`, size-capped tmpfs `/tmp` and `HOME`         |
| Time        | Wall-clock deadline per run; timeout, cancellation and shutdown kill the whole container       |
| Network     | `--network none`; a provider's API is reachable only via a per-run CONNECT proxy and allowlist |
| Credentials | Passed as `docker exec --env NAME`: never in argv, `docker inspect`, the worktree or logs      |
| Host logins | Never mounted; a run without a stored org API key fails with `AGENT_SANDBOX_UNAVAILABLE`       |
| Fail closed | A sandbox that cannot start fails the run; there is no fallback to host execution              |
| Recovery    | On start the worker removes containers and networks labelled with its `AGENT_SANDBOX_OWNER`    |

The run's audit trail records the runtime id, image, applied limits, exit reason
(`COMPLETED`, `CANCELLED`, `TIMEOUT`, `MEMORY_LIMIT`, `SHUTDOWN`), peak memory,
OOM kills and denied egress destinations. A run stopped by a limit fails with
`AGENT_RUNTIME_LIMIT`. `apps/worker/test/container-runtime.docker.spec.ts` proves
each control against a real Docker daemon (CI job `sandbox`).

`AGENT_EXECUTION_RUNTIME=host` keeps the `HOST_PROCESS` adapter for local
development: it runs agents as the worker user, records `isolated: false`, and
provides none of the controls above.

Residual gaps:

- **Worktree disk usage** is not capped: a host bind mount cannot be sized by
  Docker. Put `WORKSPACE_ROOT` on a quota-limited filesystem.
- **Egress** is allowlisted by hostname and resolved by the proxy; there is no IP
  pinning, so an allowlisted name that resolves to an internal address is reachable.
- **Docker access** is root-equivalent on the host. The worker must run where the
  daemon sees `WORKSPACE_ROOT` at the same path; the bundled compose worker has no
  socket, so CLI agent runs there fail closed.
- **Deterministic test gates** (`TestRunner`) still run on the host as the worker user.
- **In-sandbox git**: the worktree's `.git` link target is not mounted, so the agent
  cannot run git; Codex gets `--skip-git-repo-check`. EngLoop commits on the host.
- The pinned Codex and Claude Code CLIs have not yet been exercised inside the
  sandbox with live keys; that is P2's first real run.

## Reporting

Security findings surface as `ReviewFinding` rows with `category: SECURITY` and
appear on the Quality → Security screen.
