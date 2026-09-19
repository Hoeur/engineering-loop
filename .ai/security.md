# Security

## Threat model

Agent output and agent-initiated commands are **untrusted input**. Assume a
compromised or confused agent will try to read a secret, escape its worktree, or
run something it should not.

## Controls

| Control                                   | Where                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Isolated worktree per task                | `packages/git/src/worktree-manager.ts`          |
| Command allowlist, no shell               | `packages/git/src/command-runner.ts`            |
| Environment allowlist for child processes | `command-runner.ts` `buildEnv`                  |
| Execution timeout + process-group kill    | `command-runner.ts`                             |
| Token and cost budgets per run            | `apps/worker/src/services/agent-executor.ts`    |
| Output schema validation                  | `packages/schemas` + `agent-executor.ts`        |
| Encrypted credentials (AES-256-GCM)       | `apps/api/src/infrastructure/crypto`            |
| Permission levels gating each step        | `packages/workflow/src/engineering-workflow.ts` |
| Append-only audit log                     | `AuditService` / `AuditWriter`                  |
| Log redaction                             | `packages/logger/src/redact.ts`                 |

## Rules

- Never log a credential. Add new secret-ish keys to `REDACTED_PATHS`.
- Never return a decrypted credential from an API endpoint.
- Never interpolate agent-supplied text into a command line.
- Never mark a check passed from an agent's claim.
- Placeholders (network policy, resource limits, sandbox) are documented as
  placeholders in `docs/security.md`; do not describe them as implemented.
