# CP-02D — Configuration editors and preview

Date: 2026-10-15. Base: `97dc504` (merged CP-02C).

## First bounded slice: project prompt editor

Reuse the existing phase, task, agent and team surfaces. Add project prompt
configuration to the project detail page using CP-02B's existing tenant-scoped
APIs. No database, API authorization, worker or execution-policy changes.

Acceptance:

- Owners/admins create supported role prompts and append immutable revisions.
- Shared schemas reject unsupported placeholders and oversized bodies.
- Readers can fetch exact historical text and render saved revisions against
  same-project tasks through the server's allowlisted preview context.
- Concurrent edits keep the original expected revision and retain the draft
  after conflicts. Historical text cannot be edited in place.
- Loading, empty, error, pending and retry states are visible. Controls have
  labels and long text fits the six target viewports.
- Preview results cannot follow the user into a different task or revision.
- Existing run actions remain compatible; saving/previewing starts no work.

Validation: frontend behavior/route regressions, root lint/typecheck/test/build,
six-viewport browser contract scenario, rendered screenshot inspection and source
review. Record any unavailable independent or live acceptance separately.

## Follow-up slices

- Implemented 2026-10-25: execution selection on task plan/run selects exact compatible role revisions,
  opts into CP-02C snapshots and shows safe execution configuration before
  explicit submission. The existing prompt preview endpoint only renders text;
  it is not an execution-settings preview or execution authorization. The new
  task execution-preview endpoint reuses CP-02C capture without writes and
  returns an allowlisted browser projection. Start recaptures configuration;
  this preview does not reserve budgets or pin settings between preview and start.
  See [execution evidence](cp-02d-execution-evidence.md).
- Output-contract validation UI using the existing validate-output endpoint.
- Remaining phase/task/agent editor gaps, independent review and real API-backed
  browser acceptance. Do not close CP-02D from the first UI slice.

CP-02C Git/artifact replay, CP-03 scheduling and P1/P2 live delivery gates remain
open on their existing tracks.
