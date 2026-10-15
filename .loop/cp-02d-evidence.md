# CP-02D — Project prompt editor and saved text preview

Date: 2026-10-15. Base: `97dc504` (PR #13 merged CP-02C).
Branch: `codex/cp02d-prompt-editor`.
Status: first bounded CP-02D UI slice implemented and locally verified.
CP-02D remains partial; independent review and live API acceptance remain open.

## Delivered behavior

The project detail page now includes Project prompts. Owners/admins can create
supported role templates and append revisions; members can read and preview.
Shared schemas enforce names, body limits and supported placeholders. Backend
authorization and tenant checks remain the existing CP-02B implementation.

Selecting a template fetches its exact latest revision. Revision navigation
loads historical bodies without offering in-place edits. New revisions submit
the revision being edited as `expectedRevision`, even when a refetch discovers
a newer revision. Conflicts preserve the draft and expose the server message.
Reload/cancel controls support an explicit retry without silently rebasing edits.

Preview renders a saved revision against a task from the existing project board
query. The server resolves allowlisted context through the existing preview
route. Changing task/template/revision unmounts prior preview state, so late
responses do not appear as another selection's output. Prompt content is rendered
as literal text. Unsaved edits are excluded and preview starts no execution.

TanStack Query owns fetched and mutation state. React state contains form drafts
and selections. Project page composition adds only the new section; API calls
live in `apps/web/lib/project-prompts.ts`. Shared browser-safe response interfaces
live in `packages/types/src/project-prompts.ts`. No API, database, worker, runtime
permissions, credentials or existing run-action behavior changed.

## Verification

All commands below exited 0:

- Root `corepack pnpm lint`, zero warnings, including the new browser scenario.
- Root `corepack pnpm typecheck`, all packages/apps. Production build also checks
  web types, including the browser scenario added after the first typecheck.
- Root `corepack pnpm test`: **767 passed / 82 optional database tests skipped**.
  No database integration acceptance is claimed from this run. Six new tests
  cover loading/empty/errors, schema rejection, creation, conflict/draft retention,
  history, member controls, late preview isolation, literal text and encoded routes.
- Root `corepack pnpm build`: all packages/apps and 33 Next pages. Existing
  workspace-root/multiple-lockfile warning remains informational.
- `playwright test project-prompts.spec.ts --workers=2`: **6 passed**, at
  1440/1024/768/430/390/375px. Production web server on localhost:3107 was owned
  and stopped by Playwright. Chromium used the installed `chrome-win64` binary.
  The scenario creates, revises, reads history and renders a preview; it verifies
  no page overflow with long unbroken context. Screenshots are in ignored
  `apps/web/test-results/project-prompts-*/project-prompts.png`. Desktop, 430px
  and 375px captures were inspected: text wraps and controls fit. In element
  captures the existing sticky header overlays the top edge on mobile; the
  rendered form/body remain readable when scrolling normally.
- Prettier checks for new TypeScript/TSX files and `git diff --check` passed.

Browser coverage intercepts API responses and uses a synthetic local session.
It verifies UI behavior/request contracts, not real authentication, persistence,
tenant enforcement, PostgreSQL, providers or GitHub. No application database or
deployment was used. The placeholder DATABASE_URL only enabled Prisma client
generation; the initial package build failed without it, then root gates passed.

Lead source review traced CP-02B routes/response shapes, permissions, expected
revision handling, query invalidation, exact history selection and preview state
isolation. React checklist review covered hooks, query-owned server data, labels,
pending controls and safe text rendering. No open critical/high finding was
identified by that review. This is not an independent review.

## Remaining work and handoff

Next bounded implementation: task plan/run exact prompt-revision selection and
safe effective execution-settings preview, followed by output-contract validation
UI. Existing text preview is explicitly not an execution-settings snapshot or
authorization. CP-02D overall, CP-02C exact Git/artifact replay, CP-03 scheduling,
earlier independent/browser gates and P1/P2 delivery remain open.

Implementation, tests, plan and evidence are committed locally on the branch
above; no push, pull request or deployment is included in this handoff.
