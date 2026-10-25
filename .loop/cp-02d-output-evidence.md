# CP-02D — Saved prompt output validation evidence

Date: 2026-10-25. Base: `2fd766c`; branch: `codex/cp02d-output-validation`.
Contract: [output validation plan](cp-02d-output-plan.md).

## Delivered behavior

Project prompts now expose **Validate sample output** on saved current and
historical revisions. Readers may validate without receiving prompt-edit rights.
The panel parses JSON locally, rejects empty/malformed/oversized input before
sending it, retains input on failures and identifies the role/revision on success.
Pending submission disables duplicates. Editing input resets validation state;
switching prompt/revision remounts the panel, so late responses cannot follow
the operator into different input or revision context.

The existing tenant-scoped
`POST /projects/:projectId/prompts/:templateId/revisions/:revision/validate-output`
still reads that exact saved revision and checks its role against the current
application output schema. Success remains
`{ valid: true, templateId, revision, role }`. Contract failures retain HTTP 422,
`VALIDATION_FAILED` and the existing message, adding optional
`error.details.issues: Array<{ path: string[], message: string }>`.
At most 20 issues are returned; array offsets are string path segments. Only
path/message fields are copied, rather than the entire schema error or input.
Non-schema failures retain the generic error without issue details.

The shared schema package now owns the 200,000-character output bound and error
projection. Extracting errors alongside their originating schemas avoids an
ESM/CJS Zod constructor mismatch found by the HTTP integration regression.

This is output-shape validation. It does not invoke agents, save task evidence,
accept work, change permissions, persist workflow state or freeze historical
executable output schemas. No migration is needed.

## Executed verification

- Focused frontend: 11 tests passed, covering local rejection and retained input,
  exact request routing, safe field errors, retry, duplicate suppression, stale
  results after editing, reader access and late results after revision changes.
- PostgreSQL HTTP prompt suite: 8 tests passed, including structured required
  fields and nested document paths, existing ownership/authorization and immutable
  revision behavior. The first run caught missing issue details across module
  formats; error extraction was repaired and the same assertions then passed.
- Shared regression checks error projection is bounded to 20 issues and copies
  only path/message fields; non-schema errors have no projected issues.
- Root `corepack pnpm lint`: exit 0, zero warnings.
- Root `corepack pnpm typecheck`: exit 0 across all packages/apps.
- Root `corepack pnpm build`: exit 0, packages/apps and all 33 Next pages.
  Existing Next multiple-lockfile/workspace-root warning remains informational.
- All workspace suites via
  `corepack pnpm --workspace-concurrency=1 -r run test --maxWorkers=2`:
  **863 passed / 7 skipped**, exit 0. PostgreSQL phase/team/prompt/snapshot suites
  ran. The seven optional one-use migration-forward suites were not enabled.
  This retains the bounded-concurrency strategy used for the preceding slice;
  no timeout, assertion or existing test was weakened.
- Playwright real API scenario: **6 passed / 0 skipped**, exit 0, at
  1440/1024/768/430/390/375px. The scenario uses normal seeded login and real
  API/PostgreSQL responses without interception. It verifies local parse failure
  sends no request, server 422 field errors retain input, server 201 success,
  success invalidation on edit and exact historical-revision validation.
  Document width is asserted at every viewport.
- Desktop and 375px output-panel screenshots were inspected. Text and controls
  fit; large JSON scrolls within the textarea. Captures are retained in ignored
  `apps/web/test-results/prompt-output-validation-*/output-validation.png`.

## Local verification environment

Unit/integration data used the separate `engloop_output_tests_8816` database in
the task-owned `engloop-8816-postgres` container on loopback port 55416. Existing
migrations were applied there; the running demo database was not reset.

The browser fixture is a new local **Output validation demo** project, containing
the **Output validation example** DOCUMENTATION template at revisions 1 and 2.
Project ID: `cmvnkz9wr0000dku21x5ukh08`. The fixture remains available for inspection.
The API and web were restarted to load the changes; the worker remains running.
No real provider or GitHub workflow execution was invoked.

To rerun the live browser scenario against that running local setup, set
`E2E_OUTPUT_PROJECT_ID` to the fixture ID and `PLAYWRIGHT_SKIP_WEBSERVER=1`, then
run `pnpm --filter @engloop/web exec playwright test e2e/prompt-output-validation.spec.ts`.
Without an explicit fixture ID this opt-in browser scenario is skipped. The
fixture must contain the named template with saved revisions 1 and 2.

## Review and handoff

Lead source review checked revision/tenant binding, additive error-envelope
compatibility, shared bounds, query-owned server state, draft/result lifecycle,
safe text rendering, labels and error announcements. No open critical/high
finding was identified by that review. This is not independent review.

CP-02D remains partial: remaining editor gaps need reconciliation, and independent
review plus broader API-backed configuration/execution acceptance remain open.
The next planning step is that reconciliation before CP-03A readiness work.
Scheduling, artifact replay, phase acceptance and live provider/GitHub delivery
retain their existing gates. Changes are committed locally; no push/PR/deployment
is included in this slice.
