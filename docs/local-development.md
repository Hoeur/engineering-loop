# Local development

## Prerequisites

- Node.js 20.11+ (22 recommended)
- pnpm 9+ (`corepack enable`)
- Docker + Docker Compose
- git
- A working Codex or Claude Code CLI and its credentials

## First run

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis
pnpm db:deploy            # applies prisma/migrations/0_init on first run
pnpm bootstrap:real       # creates the real owner, organization and provider
pnpm dev                  # web :3000 · api :4000 · worker :4100
```

Infrastructure only, apps on the host — the usual development loop:

```bash
docker compose up -d postgres redis
pnpm db:deploy && pnpm bootstrap:real
pnpm dev
```

Open <http://localhost:3000>. Swagger is at <http://localhost:4000/api/docs>.

Sign in with the owner email/password supplied through the
`ENGLOOP_BOOTSTRAP_*` environment values. `AUTH_DEV_BYPASS` and
`AGENT_ENABLE_MOCK` both default to `false`; enable them only for an intentional
offline/demo run.

Provider credentials are not accepted through the API. Authenticate the CLI in
the worker's operating-system account (`codex login`) or set the corresponding
worker process environment variable.

## Everyday commands

```bash
pnpm dev            # every app in watch mode
pnpm dev:api        # one app
pnpm build          # packages, then apps
pnpm lint           # ESLint, zero warnings
pnpm typecheck      # tsc --noEmit everywhere
pnpm test           # Vitest across the workspace
pnpm test:e2e       # Playwright (start the web app first)
pnpm db:studio      # browse the database
pnpm docker:logs    # tail container logs
pnpm docker:reset   # stop and delete volumes
make help           # the same targets via Make
```

## Running the real loop

1. Open a task on the board (for example `ENG-104`).
2. Press **Start**.
3. Watch **Open live run** — the timeline advances step by step.

The selected CLI provider receives a structured role contract over stdin,
works in an isolated worktree, and returns schema-validated output. EngLoop
itself runs the configured checks and records their exit codes before review.

## Connecting a real repository

```bash
curl -X POST http://localhost:4000/api/projects/<projectId>/repositories \
  -H 'authorization: Bearer <token-from-api-auth-login>' \
  -H 'content-type: application/json' \
  -d '{
    "name": "my-service",
    "provider": "LOCAL",
    "localPath": "/absolute/path/to/my-service",
    "defaultBranch": "main",
    "commands": { "lint": "pnpm lint", "typecheck": "pnpm typecheck", "unit": "pnpm test", "build": "pnpm build" }
  }'
```

The worker clones or reuses that repository under `workspace/repositories/` and
creates a worktree per task. Real commands run against the worktree.

## Connecting GitHub

EngLoop talks to GitHub as a **GitHub App**. Create one under GitHub → Settings →
Developer settings → GitHub Apps → **New GitHub App**, with:

| Setting                                                | Value                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Callback URL (the **first** one listed)                | `http://localhost:<WEB_PORT>/projects/github/callback`                    |
| Request user authorization (OAuth) during installation | On                                                                        |
| Webhook                                                | Off for local development — GitHub cannot reach `localhost`               |
| Repository permissions                                 | Contents: Read and write · Pull requests: Read and write · Metadata: Read |

Keep the permissions to those three: the repository listing uses an installation
token that carries every permission the App has.

Then fill in the GitHub block of `.env`:

- `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` — the App's General page.
- `GITHUB_APP_SLUG` — the last segment of `https://github.com/apps/<slug>`.
- `GITHUB_APP_PRIVATE_KEY` — **Generate a private key** downloads a `.pem`. Put its
  contents in double quotes on one line with `\n` escapes. It is _not_ the client secret.
- `GITHUB_WEBHOOK_SECRET`, `GITHUB_OAUTH_STATE_SECRET` — random, 32+ characters each:
  `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
- `GITHUB_OAUTH_CALLBACK_URL` — the callback URL from the table above.

Apply migrations (`pnpm db:deploy`) and restart `pnpm dev` — configuration is read
at boot. Then open **Projects → Connect GitHub**. If the App is not installed yet,
GitHub installs it; if it already is (for example, installed from github.com),
GitHub only confirms who you are. Either way you return to Projects, where
**Import from GitHub** lists the repositories the installation can reach.

## Troubleshooting

| Symptom                                                  | Cause                                                                     | Fix                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| "Cannot reach the EngLoop API"                           | API or database down                                                      | `pnpm docker:up`, check `pnpm docker:logs`                                     |
| `PrismaClientInitializationError`                        | Client not generated                                                      | `pnpm db:generate`                                                             |
| Prisma engine download fails                             | Restricted network                                                        | Allow `binaries.prisma.sh`, or run migrations from a machine that can reach it |
| Worker starts, nothing happens                           | Redis unreachable                                                         | Check `REDIS_HOST` / `REDIS_PORT`; `GET /api/health` reports it                |
| Checks report "skipped"                                  | No `commands` on the repository                                           | Add them via `PATCH /api/repositories/:id`                                     |
| "GitHub App integration is not configured"               | A GitHub value in `.env` is missing, or the API predates the edit         | Fill in all eight values and restart `pnpm dev`                                |
| GitHub callback: "did not return the authorization code" | OAuth during installation is off                                          | Enable "Request user authorization (OAuth) during installation" on the App     |
| API exits with `Cannot find module './common/...'`       | `apps/api/dist` was emptied by a failed `nest build` while `pnpm dev` ran | Restart `pnpm dev`; its watcher rebuilds `dist` from scratch                   |
