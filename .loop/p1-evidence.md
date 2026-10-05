# P1-A execution runtime continuation

Updated: 2026-10-05. Status: live P1-A filesystem/lifecycle gate verified; P1 remains open.
Base: `main`, `13e8b67`; no commit or publication performed.

## Implemented

- Worker selects a Docker adapter through validated configuration.
- One named/labeled container per prepared CLI run, worktree/control mounts,
  private Git metadata with the host origin removed, and container path mapping.
- Network denied, read-only root filesystem, dropped capabilities,
  no-new-privileges, bounded temporary filesystem, CPU/memory/PID flags.
- Dedicated Docker control runner; Docker is absent from the general default
  command allowlist used for repository verification.
- Stored API-key credentials; host CLI login state is not mounted. Exact key
  values are scrubbed from command output, errors, and provider output files.
- Preparation tracking, cancellation, named health-container cleanup, removal
  retries, and shutdown cleanup. Agent cleanup failure records a failed run.
- Production host CLI execution is rejected at worker composition; explicitly
  enabled production mock mode can boot but cannot invoke host CLIs. Shared
  production API/web environment validation is unaffected.
- Containers pause before host transport allocation, reads and provider decoding;
  overlapping execution is rejected. Invocation path components and output leaves
  reject links, output reads are capped at 16 MiB, and runtime-owned transport
  cleanup stays in the runtime. Failed preparation aborts the session even if
  removal fails; timeout removes the container rather than only the Docker client.

## Live P1-A gate — 2026-10-05

- Docker Desktop was started; Linux Docker client/server: `28.0.4` / `28.0.4`.
- Controlled image: `engloop-runtime-test:local`,
  `sha256:ff8247c0ca671de43f9efe462ca2708d59333e130762a5ec06caa2e58486d76f`.
  Its pinned Node base, Git and tail exercise the adapter without provider calls.
- Build: `docker build --tag engloop-runtime-test:local apps/worker/test/docker-runtime`.
- Gate: `pnpm --filter @engloop/worker run test:docker` (or the repository-local
  `vitest.cmd run --config vitest.docker.config.ts` from `apps/worker`).
- Final implementer rerun: **8/8 passed**, exit 0, 24.77 seconds.
- Lead independently reran the repository-local command after code freeze:
  **8/8 passed**, exit 0, 43.07 seconds; no managed containers remained.
- Proven: host/repository/sibling paths, Docker Desktop host aliases, Windows
  junctions and Linux symlinks cannot expose fixture secrets; assigned files and
  private Git work; create/start errors fail closed; handshaked cancellation,
  timeout, release and shutdown remove containers; malicious invocation-parent
  replacement is rejected before host output access.
- Runtime unit tests **12/12** and provider tests **15/15** passed. Independent
  review found no remaining critical/high findings in this slice.
- Final inventory of containers labeled `engloop.managed=true` was empty.
- The explicit gate fails for a missing daemon/image; ordinary unit tests do not
  imply this opt-in gate ran. See `apps/worker/test/docker-runtime/README.md`.

## Verification

Independent verifier after code freeze: live Docker **8/8 passed**, exit 0
(23.85 seconds); full typecheck exit 0; full ordinary test suite **582 passed**,
exit 0 (worker 134; agent SDK 78, including provider suite 15). Full build exit 0,
including all 33 Next pages. Final `git diff --check` exit 0 and the managed
container inventory was empty. Checks added no unexpected worktree paths.
Browser E2E was not rerun for this worker/runtime-only slice.
Checkout lint passed with `--ignore-pattern '.claude/**'`. Unqualified `pnpm lint`
fails with 284 warnings in pre-existing nested `.claude/worktrees` checkouts.
Use `pnpm --config.manage-package-manager-versions=false
--config.verify-deps-before-run=false run <script>` with the installed pnpm 11
wrapper to avoid its attempted dependency reinstall; dependencies were preserved.

## Open acceptance gates

- CPU/memory/PID flags are configured, but exhaustion integration proof remains
  open. The live gate establishes filesystem/Git/timeout/cleanup behavior only.
- No production provider runtime image is supplied or built. The configured image must
  contain the container-native Codex/Claude executables and required tooling.
- `network=none` prevents cloud provider calls. Provider egress allowlisting and
  authenticated connectivity readiness are required before real execution.
- Writable worktree/control mounts have no disk quota.
- Startup orphan recovery after abrupt worker death is not implemented.
- Broader adversarial daemon-failure/recovery coverage remains open beyond the
  startup and transport-link cases exercised by this gate.

The adapter is experimental and must not be described as production ready.
Roadmap containment tasks remain unchecked. Independent review identified these
open gates; passing unit or scoped integration tests does not close them.

## Git handoff

Verification used the pre-existing dirty primary `main` worktree based on
`13e8b67`. The user subsequently authorized committing and pushing all changes.
The P1-A runtime, tests and evidence are published together; broader P1 gates
remain open regardless of the Git publication status.
