# CP-02D — Task execution selection and configuration preview

Date: 2026-10-25. Base: `7cdd7fb`; branch: `codex/cp02d-execution-preview`.

Reused the existing prompt editor commit `858b814` as local cherry-pick `638358f`.
The editor remains connected to the existing project prompt endpoints.

## Delivered behavior

Task detail Plan and Start dialogs can opt into CP-02C snapshots. Operators
choose compatible role templates and exact positive revision numbers, including
historical revisions. Built-in role prompts remain available. Leaving snapshot
mode off preserves existing request bodies and workflow behavior.

`POST /tasks/:id/execution-preview` uses the shared request schema and CP-02C
configuration capture inside a repeatable-read transaction. Capture enforces
task ownership, same-project/role prompt revisions, enabled provider/agent/team
eligibility and active-phase binding. Preview performs no writes or dispatch.
The browser response schema allowlists role, agent ID, provider key/kind, model,
permission, configured budget/command ceilings and the selected prompt text.
System prompts, configuration values, provider credentials, memory and artifact
contents are excluded from that response.

Start sends only the selected template IDs/revisions through the existing plan
or run route. That route revalidates eligibility and captures the authoritative
snapshot transactionally before enqueue. Preview does not authorize execution,
reserve spend or freeze configuration between preview and start. Remaining spend
and live revocation/policy can further narrow invocation limits. No new policy
override or broader permission is accepted.

Queries are keyed by task, mode, planning option and exact selections. Changing
a revision removes the prior result and disables start while the next preview
loads or fails. Late responses cannot replace the active selection. Invalid
revision numbers block submission; start failures retain choices and show an
inline error. Pending submission blocks duplicate starts and dialog dismissal.

## Verification

- Focused API unit/capture checks: 16 passed.
- Focused UI regressions: 4 passed, covering legacy mode, historical selection,
  out-of-order responses, failed rendering, invalid revisions and retained state.
- PostgreSQL preview/workflow checks: 11 passed (4 unit + 7 integration).
  Preview leaves workflow count unchanged, never enqueues, rejects foreign tasks,
  excludes private fields, and retains existing immutable snapshot behavior.
- Root lint and typecheck: exit 0. Production build: exit 0, all packages/apps
  and 33 Next pages. Next's existing multiple-lockfile warning remains.
- The initial sandbox build could not read the parent user-directory link;
  the approved external build passed. Vitest similarly required approved access
  outside the sandbox to load its configuration.
- Unrestricted root tests twice hit existing five-second worker-test timeouts
  and then closed sibling IPC channels. First run overlapped build tracing;
  second run did not. Assertions and timeouts were not changed.
- All workspace suites passed with
  `corepack pnpm --workspace-concurrency=1 -r run test --maxWorkers=2`:
  **857 passed / 7 skipped**, exit 0. Snapshot, phase, team and prompt PostgreSQL
  integration suites ran. The seven optional one-use migration-forward suites
  were not enabled; no schema migration was added by this slice.
- Initial six-viewport browser run: 8 passed / 4 failed. The new task dialog
  fit every viewport, but its underlying task page grid let the tabs widen the
  page below 1024px. Added `min-w-0` to both grid columns. The browser assertion
  remains in place as regression coverage. Web rebuild passed after the repair.
- Final Playwright: **12 passed**, exit 0. Both editor and execution scenarios
  ran at 1440/1024/768/430/390/375px. Plan and run each submit historical
  revision 1 while the latest revision is 2. Long template/model/prompt text
  fits; both dialog and document widths are asserted. Desktop and 375px run
  screenshots were inspected. Captures remain in ignored
  `apps/web/test-results/execution-preview-*/execution-run.png`.
- These browser tests intercept API responses and use synthetic authentication;
  they prove UI/request contracts, separately from the PostgreSQL service tests.
  No live provider, GitHub delivery or full-stack browser acceptance is claimed.
- Final root lint and `git diff --check`: exit 0. Changed source/doc formatting
  is checked before commit. Root typecheck and the final web build validate types.

Task-owned PostgreSQL 18 was initialized under `.verify-tmp/pg`, listening only
on `127.0.0.1:57453`. Only `engloop_cp02d_preview` was created; the existing
migration chain was deployed there. No schema migration is needed for this slice.
The scratch cluster and evidence logs are ignored by Git. The cluster is stopped
at handoff and its database is preserved.

## Review and remaining scope

Lead source review traced controller validation/tenant propagation, browser
projection, CP-02C capture/start behavior, request-body compatibility, query
identity, pending controls and retained failure state. The React checklist
covered hook order, query-owned server data, labels, text wrapping and safe text
rendering. No critical/high finding was identified. Independent review remains
open; this is not a claim of independent acceptance.

Next bounded TODO: output-contract validation UI through the existing prompt
validate-output route. Remaining editor gaps, independent review, live API-backed
browser acceptance, exact Git/artifact replay, scheduling and live provider/GitHub
delivery retain their existing gates. The implementation is committed locally
on the branch above; no push, PR or deployment is included.
