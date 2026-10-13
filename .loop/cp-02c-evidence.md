# CP-02C — Immutable execution configuration evidence

Date: 2026-10-13. Base: `e8f1280`.
Branch: `codex/cp02c-execution-snapshots`.
Status: **CP-02C partial** — the bounded opt-in configuration snapshot slice is
implemented, verified and independently reviewed. Exact replay boundaries remain
open as described below.

## Delivered behavior

`POST /api/tasks/:id/plan` and `/run` accept optional `execution`:

```json
{
  "execution": {
    "prompts": [{ "role": "IMPLEMENTER", "templateId": "<same-project template>", "revision": 1 }]
  }
}
```

`execution: {}` opts in without a custom template. Omission preserves existing
live-configuration behavior. Only `engineering-task` is supported. Selected
roles must be invoked by that plan/run; role selections are unique and exact
revisions must belong to the task's project and organization.

The API uses project-first/task-second locking and Serializable isolation. The
workflow, version-1 snapshot and mandatory audit commit together before queue
dispatch. Serialization conflicts return HTTP 409 `WORKFLOW_SNAPSHOT_CONFLICT`.
The existing queue-failure handling remains; durable dispatch is CP-03C.

Snapshots select safe task/project/phase fields, repository metadata/commands,
memory content/revisions, exact team agent/provider/model, system prompt,
rendered custom prompt, effective budgets/permission and configuration-version
references. Prior inline artifacts are represented by ID/creation time/SHA-256;
storage paths/content are not copied. Credential ciphertext, IV/tag, arbitrary
provider settings and AgentConfiguration values are never selected.

Workflow routing and agent context consume those saved fields. Same-run validated
PLAN output adds criteria/checks to the frozen baseline. Current cancellation,
agent/provider/team eligibility, permission narrowing and spent-cost accounting
stay live. Frozen model/prompt reach CLI start/resume transport; pinned text is
scanned before credentials. Current positive project ceilings and remaining
task spend narrow invocation cost; project budget zero retains legacy unlimited
semantics. No atomic multi-worker cost reservation is claimed.

The worker saves full invocation context, including collected guidance, to
`AgentRun.executionSnapshot` before credential/provider access. SQL triggers
reject workflow snapshot edits and permit only a single initial assignment of
an invocation snapshot while its AgentRun is RUNNING. Completion/cancellation
can still update their existing status/output fields.

Codex snapshot runs reject unsupported narrowed command policies both at capture
consumption and after applying current agent restrictions. Claude tool rules are
filtered by effective executable policy; low-permission contexts deny mutations.
This is not proof of full OS command containment: the baseline runtime remains
experimental and P1 acceptance remains open.

## PostgreSQL and migration proof

Task-owned cluster: `C:/Users/YCT_2/.codex/tmp/cp02c-f852-pg`, loopback port 57452.
Only `engloop_cp02c` and `engloop_cp02c_forward` were created/used here. No existing
application database, remote server or deployment was changed.

Generated through `corepack pnpm db:migrate cp02c_execution_snapshots`; reviewed
SQL adds nullable JSONB fields on workflow/agent runs plus explicit immutability
triggers. Applied the complete chain to the task database with `pnpm db:deploy`.
The Prisma schema and applied-datamodel snapshot match.

The separate one-use forward proof passed, zero skips: existing task/agent/run
data is preserved, added values start null, snapshots cannot be rewritten,
workflow progress and agent completion remain writable, and canceled invocations
cannot gain snapshots. The populated proof database is retained, not reset.

Focused suites: API unit 9 + PostgreSQL 6; worker unit 11 + PostgreSQL 13. The
worker proof uses real AgentExecutor/ContextBuilder/UsageRecorder and a real
WorkflowEngine advance with PostgreSQL claims; only provider invocation/one
step handler is substituted. Tests cover edits, revocation, malformed/foreign
payloads, policy and remaining-budget narrowing, cancellation and SQL triggers.
CLI SDK suite: 83 passed, including pinned start/resume model/prompt transport
and scanning system/custom prompt text.

## Independent review and repair

Planner, implementer, independent reviewer and verifier roles participated.
Independent review found planner-derived criteria/check loss, missing remaining
project-budget narrowing and captured/live Codex command-policy bypasses.
All were repaired with regressions. Final source review reported zero open
P0/P1/P2 findings in the bounded slice. Root testing additionally found legacy
plan handlers reading snapshot ownership when no snapshot existed; the legacy
branch now avoids that read and the existing phase-planner tests pass unchanged.

## Remaining scope

Full byte-for-byte Git/artifact replay is not delivered: Git commit/worktree
bytes are selected by the worker; guidance is captured at invocation, not before
enqueue. External artifacts have no immutable revision store. Effective safe
settings are frozen, while free-form provider/AgentConfiguration JSON remains
unsupported. Output schemas are fixed to version-1 application contracts; this
does not provide a historical executable schema registry across deployments.

CP-02D UI editors/preview, CP-03 scheduling/reliable dispatch, CP-06 acceptance
and CP-07 end-to-end/live rollout remain separate. No browser E2E, live provider
or GitHub delivery was performed for this backend/worker slice.

## Final gates and Git handoff

- Root `corepack pnpm lint`: exit 0, zero warnings.
- Root `corepack pnpm typecheck`: exit 0 across all packages/apps.
- Final root `corepack pnpm test`: exit 0, **836 passed / 7 skipped**. All new
  snapshot suites and historical team/phase/prompt PostgreSQL suites ran.
  The seven optional one-use forward suites were not enabled on the final run;
  the new snapshot forward proof passed separately on its empty scratch database.
- Root `corepack pnpm build`: exit 0, all packages/apps and 33 Next pages.
  The existing Next multiple-lockfile/workspace-root warning remains informational.
- `git diff --check`: exit 0. Final source independent review: zero open
  P0/P1/P2 findings. No check was weakened to obtain these results.

The initial root test run failed six unchanged legacy planning cases due to the
new ownership read on absent snapshots. The source branch was corrected, all
seven legacy planning cases passed, and the full suite then passed. Package
builds, tests and final app builds ran sequentially to avoid stale generated
Prisma/schema artifacts.

Only the task-owned PostgreSQL cluster was started for verification; it is
stopped at handoff and its two databases are preserved. Dependencies were
installed using the pinned pnpm 10.28.0 lockfile. No browser server or live
provider was started. Changes are committed locally on the continuation branch;
no push, pull request or deployment is included in this handoff.
