---
name: engloop-local-ui-testing
description: Run offline EngLoop UI workflows with seeded authentication and the mock agent provider.
---

# Offline UI workflow testing

Use an isolated local database and repository fixture. Read AGENTS.md and
.env.example before starting; never enable development bypass in production.

## Runtime setup

- Install workspace dependencies, generate Prisma, and build packages using
  the repository blueprint.
- Start dependencies with `docker compose up -d postgres redis`.
- Run `pnpm db:deploy` and, on an isolated development database, `pnpm db:seed`.
- Configure `AUTH_DEV_BYPASS=true`, `AUTH_DEV_USER_EMAIL` to the seeded owner,
  `AGENT_ENABLE_MOCK=true`, and `AGENT_DEFAULT_PROVIDER=mock`.
- Start API, worker, and web with `pnpm dev:api`, `pnpm dev:worker`, and
  `pnpm dev:web`, ensuring each receives the development environment.
- Typical URLs: web http://localhost:3000, API :4000, worker :4100.

## Workflow testing

- Projects may only offer GitHub import rather than local-project creation.
  If offline, provision an isolated local repository/project fixture as setup;
  disclose this limitation rather than presenting it as UI project creation.
- Open the project detail page, select **New task**, fill Title, Objective and
  Description, then **Create and start**.
- Attached repositories start with ARCHITECT, followed by PLANNER and IMPLEMENTER.
- Max attempts 1 bounds the test but mock review requests can put the workflow
  into Waiting For Human; this does not demonstrate full delivery completion.
- Settings → Audit supports project and action filtering. Metadata is not shown;
  inspect persisted rows read-only when checking exact metadata or provider
  sessions/messages. Do not infer provider spawn from a generic "started" audit
  summary alone.
- No-op fixture checks validate workflow routing only, not implementation quality.

## Devin Secrets Needed

None for isolated seeded authentication and mock-provider testing.
Real GitHub import and real LLM provider testing require their normal credentials.
