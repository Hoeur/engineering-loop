# CP-02B — Project prompt templates and immutable revisions

Date: 2026-10-13. Base: `3bb7ec7` (CP-02A restored from `593673b`).
Branch: `codex/cp02b-prompt-revisions`.
Status: implemented; final verification/publication recorded below. Independent
review remains open; this record does not claim independent review completion.

## Behavior and API

All paths are beneath `/api/projects/:projectId/prompts` and use the standard
response envelope and shared Zod request validation.

- `GET /` lists safe template metadata (maximum 100 templates per project).
- `POST /` creates `{ name, role, body }` and revision 1. Owners/admins only.
- `POST /:templateId/revisions` appends `{ expectedRevision, body }`. Owners/admins
  only; old revisions are preserved, role/name stay fixed, stale writes return CONFLICT.
- `GET /:templateId/revisions/:revision` reads an exact historical revision.
- `POST /:templateId/revisions/:revision/preview` accepts `{ taskId }` and renders
  the revision using selected fields from a same-project, same-tenant task.
- `POST /:templateId/revisions/:revision/validate-output` accepts `{ output }`
  and validates the existing shared role output contract. It does not record
  evidence or accept a task/phase.

Templates use `{{task.title}}`, `{{task.description}}`, `{{task.objective}}`,
`{{task.acceptanceCriteria}}` (JSON array), `{{project.name}}`,
`{{project.objective}}`, `{{phase.objective}}` and `{{role}}`; surrounding
placeholder whitespace is supported. Missing phase context fails when referenced;
nullable objectives render as empty text. Unknown variables/malformed placeholders
fail at creation/revision. Substituted task text is literal and never recursively
expanded or evaluated. Body limit: 20000 characters; rendered limit: 100000;
output JSON limit: 200000. Revision parameters are positive PostgreSQL integers.

The role is the built-in output contract identifier, reused from
`ROLE_OUTPUT_SCHEMAS`; PRODUCT/QA do not yet have shared output schemas and are
rejected. No custom schema language or provider-settings interpolation exists.
Preview queries select only the documented fields and never load credentials,
agent configuration, budgets, arbitrary project settings or repository paths.
User-authored prompt/task text is not a secret sanitizer or execution permission.

Creation/revision lock the tenant-scoped project. Revision allocation, history,
current revision and audit are transactional; failed audits roll back the write.
One of two edits racing the same expected revision succeeds, the other conflicts.
The API exposes no revision update/delete route. Reads check ownership through
template -> project -> organization. Project deletion retains the repository's
existing cascade behavior, including its prompt records.

## Migration and data preservation

`20261013100847_cp02b_prompt_revisions` was generated with
`corepack pnpm db:migrate cp02b_prompt_revisions` and applied with
`corepack pnpm db:deploy` only to task-owned `engloop_cp02b_de11` on local
PostgreSQL. The migration adds `prompt_templates`/`prompt_revisions`, project
and template foreign keys, project list index and unique `(templateId, revision)`.
No enums or legacy columns/data change. The datamodel snapshot matches the schema.

The forward test on `engloop_cp02b_de11_forward` applied all prior migrations,
inserted a legacy project/task with settings and IMPLEMENTING state, applied this
migration, verified byte-for-byte existing row values, and proved duplicate
revision and orphan-template constraints. Both scratch databases are preserved.
No deployment, existing application database or local server configuration changed.

## Source review

Lead reviewed the routes, global auth/envelope registration, selected context,
project locking, transaction/audit failure behavior, history preservation, output
schema reuse and generated SQL. No critical/high finding identified in that
source review. The revision-route integer overflow edge was fixed and covered
by shared-schema and HTTP tests. This was a lead review, not an independent review.

## Boundaries

This is prompt configuration/preview/validation. Worker execution still uses its
existing prompts; no run selects these templates yet. CP-02C must select an exact
revision, snapshot all effective inputs atomically, pass rendered prompts through
the existing injection checks/provider path and persist the revision with the run.
Old prompt bodies survive edits, but full run reproducibility and immutable output
schema versions are not claimed. UI editors remain CP-02D; scheduling is CP-03;
phase acceptance is CP-06. P1/P2 live runtime/GitHub prerequisites remain open.

## Verification and Git handoff

- Root lint (`eslint . --max-warnings=0`, the exact `pnpm lint` script): exit 0,
  repeated after the final source/test edits. New TypeScript files pass Prettier.
- Root `corepack pnpm typecheck`: exit 0. Final API typecheck after the HTTP
  regression additions also passed, exit 0. An earlier pass ran while a new
  shared export was being added and saw stale compiled schema declarations;
  the full package rebuild/typecheck resolved it without weakening checks.
- Initial root `corepack pnpm test`: exit 0; 714 passed, 45 optional DB skips.
  This includes the real PostgreSQL forward proof (1 passed, zero skips), prompt
  API tests (5 at that point), team API tests (5) and team worker tests (2).
- Final focused prompt PostgreSQL/HTTP suite: 7 passed, zero skips, exit 0.
  It covers historical preservation, HTTP envelopes/route validation, foreign
  tenants/projects/tasks, role authorization, unresolved context, invalid output,
  racing expected revisions and audit failure rollback.
- Final root `corepack pnpm test`: 715 passed, 46 optional DB skips, exit 0.
  All 7 prompt integration/HTTP cases, 11 prompt schema cases, 5 team API cases
  and 2 team worker cases ran. The forward-proof variable was intentionally
  unset on this rerun: its database is now populated and its earlier successful
  one-use proof is preserved rather than resetting it.
- Root `corepack pnpm build`: exit 0, all packages/apps, including 33 Next pages.
  The pre-existing Next multiple-lockfile/workspace-root warning is informational.
- `git diff --check`: exit 0. The migration-lock file's line-ending notice has
  no textual SQL/configuration change.

No browser E2E/live provider invocation was needed for this backend configuration
slice; no UI or worker invocation behavior changed. Final source review is the
lead review described above; independent review remains open. Changes are
committed locally on the continuation branch; nothing was pushed/deployed.
