# CP-02D — Saved prompt output validation

Date: 2026-10-25. Base: `2fd766c`; branch: `codex/cp02d-output-validation`.

Add a JSON output panel to current and historical saved prompt revisions using
the existing tenant-scoped validate-output route. Readers may validate without
editing prompts. Validation checks the current role output schema only; it
does not invoke an agent, persist acceptance or change workflow/task state.

Acceptance:

- Empty, malformed and oversized JSON fails locally without a request.
- Valid JSON is submitted to the exact project/template/revision endpoint.
- Server contract errors expose bounded field paths/messages and retain input.
- Pending submission disables duplicate submits. Editing JSON invalidates
  previous results; switching saved revisions resets the panel. Late responses
  cannot overwrite the active input/revision.
- Success identifies the role and saved revision, without implying work passed.
- Form labels, error announcements, retry and six-viewport layout are verified.
- Preserve existing API error code/message; return only path/message issue data.

Verification: focused UI/shared/API checks; PostgreSQL HTTP contract tests in a
separate task-owned database; live API-backed six-viewport browser scenario;
root lint/typecheck/tests/build; source review; evidence and local commit.

No migration, execution routing, permission expansion, phase acceptance,
scheduler, live provider or GitHub delivery is included. Remaining editor gaps
and independent review remain separate from this bounded UI slice.
