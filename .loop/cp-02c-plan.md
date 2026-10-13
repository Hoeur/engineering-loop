# CP-02C — Opt-in immutable execution configuration

Base: `e8f1280` on `codex/cp02c-execution-snapshots`.

## Bounded contract

Add optional `execution` to the existing task plan/run requests. Omission keeps
the legacy path; `{}` opts into a versioned configuration snapshot. Explicit
prompt selections bind role, template and exact revision, never implicit latest.

Capture task/project/phase contract, safe repository metadata and check commands,
active memory content/version, team role resolution, effective model/system
prompt/limits/permission, supported configuration references and prior artifact
IDs/content hashes in the transaction creating the workflow. Audit in that
transaction; dispatch only after commit. No credential/configuration JSON reads.

Consume frozen inputs in workflow steps and agent context. Preserve current
status, cancellation, spending and revocation; current policy can only narrow
permissions and limits. Same-run validated planner output can add required checks
and criteria. Store the complete invocation context before resolving credentials
or calling the provider, with database-enforced snapshot immutability.

## Acceptance and validation

- Snapshot and audit exist before queue dispatch; invalid selection/audit failure
  leaves no workflow or queued job. Concurrent starts create one active run.
- Edits cannot replace captured task, prompt, model, memory or execution policy.
  Disabled/foreign/ineligible agents and providers cannot execute or fall back.
- Preserve planner-added checks and legacy planning. Malformed present snapshots
  fail closed. New fields preserve existing rows through an additive migration.
- Prove snapshot and invocation immutability with PostgreSQL; exercise real worker
  context and workflow routing using an in-process test provider.
- Root lint/typecheck/test/build, independent review and a clean local commit.

## Boundaries

No scheduler/leases/outbox (CP-03), new UI (CP-02D), phase acceptance (CP-06),
live provider/GitHub execution (P1/P2), or deployment. Configuration snapshots
do not pin Git commit/worktree bytes before queueing or make mutable artifact
storage replayable. Repository guidance is collected and stored when the worker
prepares an invocation. Raw AgentConfiguration/provider JSON is not consumed by
the current invocation path and is deliberately excluded; only configuration
version references and explicitly effective safe settings are captured.

Codex cannot implement a narrowed executable policy with its current adapter:
snapshot-enabled runs reject such policies before credentials/invocation.
Existing baseline runtime containment remains experimental P1 work. Token/cost
limits use existing provider accounting; atomic spend reservations and hard
mid-invocation resource enforcement are outside this slice.
