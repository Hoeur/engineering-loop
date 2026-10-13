# CP-02B — Project prompt templates and immutable revisions

Base: CP-02A brought forward as `3bb7ec7` from `593673b`.

Deliverable: tenant-scoped project prompt templates with append-only numbered
revisions, supported task/project/phase variables, and a fixed role output
contract. Owners/admins create and revise templates using optimistic concurrency.
Preview resolves only explicitly selected task/project/phase fields; validation
uses the existing shared role output schemas. Unknown/malformed variables,
missing phase context, invalid outputs and stale writes fail explicitly.

Configuration only: no execution binding, run snapshots, scheduling, UI editor or
custom output schema language. Those remain CP-02C/CP-02D and later slices.
Roles without an existing output schema (PRODUCT/QA) cannot create a template.
Template content is administrator-authored text, never interpolated as code.
No provider credentials or arbitrary agent configuration enter preview context.

Checks: shared parser/render/output tests, PostgreSQL tenant/authorization/
concurrency/audit rollback/history tests, additive forward migration proof,
root lint/typecheck/test/build, source review and clean committed handoff.
