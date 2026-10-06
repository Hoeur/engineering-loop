# CP-01B — Editable project and phase delivery contracts

Date: 2026-10-06
Checkout: `E:\Evalley\Engineer loop`; CP-01A dirty changes preserved.
Status: implemented and validated. Not full CP-01 acceptance or repository definition of done.

## Bounded contract

- Project contract: objective, requirements, non-goals and acceptance criteria.
- Phase contract: objective, deliverables, acceptance criteria, required existing
  AgentRole values and explicit prerequisite phase IDs.
- Organization members read; Owner/Admin explicitly edit; mutation and audit
  commit together. Empty lists/null objective clear values; omitted patch fields
  preserve values.
- Dependencies reference only phases in the same project. Reject duplicate/self/
  cross-project/tenant/cyclic edges, including concurrent reciprocal edits.
  Do not silently remove prerequisites when deleting a depended-on phase.
- Existing task status, workflow execution and CP-01A membership behavior remain
  intact. Phase order is presentation order, not implicit dependency order.
- No activation, acceptance engine, scheduler, config revisions or run snapshots.
  Draft contract edits are not inputs to currently running workflows.

## Plan and responsibilities

Planner: read-only contract discovery and independent final review.
Backend implementer: shared schemas/types, additive migration, API transactions,
pure dependency policy and regression/live database tests.
Frontend implementer: query service/hooks and responsive contract editors/read
views, tests and real API browser acceptance.
Lead: integration, isolated services, full gates and evidence reconciliation.
Engineering-loop, Next software-engineer and local UI-testing guidance used.
Maximum three bounded repair cycles; preserve unrelated images/plans/worktrees.

## Acceptance and verification

Persist project and three phase contracts, reload them, change/clear values,
assign required roles and prerequisite links, reject invalid graph edits without
partial updates. Protect manager-only writes and tenant isolation. Verify additive
migration preserves existing CP-01A phase/task membership and defaults.
Run schema/enum parity, focused units/PostgreSQL integration, full lint/typecheck/
test/build, six responsive browser widths, and independent review.

## Verified results

- Shared schema tests: 4/4 passed; dependency policy: 4/4 passed.
- API policy + real PostgreSQL integration: 24/24 passed. This includes same-project
  constraints, cycle rejection, reciprocal-edit concurrency, audit rollback,
  no-op handling, dependency-only timestamps and required-prerequisite deletion.
- Forward migration + enum parity: 40/40 passed, independently rerun on fresh
  `engloop_cp01b_forward_resume`. Existing project/phase/task status and membership
  survived; new defaults checked; named SQL CHECK and compound FKs exercised.
  Prisma cannot represent the CHECK; an empty snapshot diff alone is not proof.
- Full `pnpm typecheck`: exit 0; full `pnpm test`: exit 0. Optional live suites
  skip without explicit database URLs; the phase suites ran separately above.
- Root `pnpm lint`: exit 1, 284 pre-existing warnings in `.claude/worktrees`,
  zero errors. Active checkout lint excluding `.claude/**`: exit 0.
- Independent frozen review: no critical/high/medium blockers. Lead fixes and
  review covered empty-object dependency timestamp updates, custom SQL CHECK,
  touch-target size and preserved form entries after rejected writes.
- Browser harness initially read contract before save settled (textarea matched
  objective text). Added wait for the read-only Edit contract control without
  weakening persistence assertions. Focused real-API 375px rerun passed.
- Six-viewport real API browser acceptance: 6/6 passed (46.4s), widths 1440,
  1024, 768, 430, 390 and 375; horizontal overflow at most 1px. Project contract
  save/readback/reload, phase metadata/roles/dependencies, rejected cyclic edit
  preserving unsaved input, corrected edit and legacy task membership all passed.
  Phase fixtures removed in reverse prerequisite order, test projects archived,
  scratch task records retained because there is no project/task deletion API.
- Schema versus migration snapshot: empty diff, exit 0; `git diff --check`: exit 0.
- Full production build: exit 0 (packages, API, worker and web).

Existing root lint contamination remains a separately reported gate, not
permission to edit unrelated checkouts. Local services use only task-owned
PostgreSQL/Redis on ports 56432/56379 and API/web on 4400/3300. No user database
was migrated or seeded during this slice.
No commit/push was requested during implementation. The user later authorized
publication of CP-01A/B and README changes; see Git history.

Owned API/web processes and task PostgreSQL/Redis containers stopped after checks;
scratch data retained for inspection, not deleted. Existing CP-01A images and
unrelated worktree edits preserved. Root lint still prevents
claiming the repository definition of done.

Next bounded slice: CP-01C remaining task DAG and phase lifecycle/edit protections.
Phase metadata graph integrity is now covered by CP-01B; activation and acceptance
are still absent, and versioned configuration/parallel scheduling remain CP-02/03.
