# 03 — Feed UI_REVIEWER with real capture output

**Plan:** `.loop/plan-real-ui-qa.md` · **Depends on:** 01, 02 · **Status:** not started

## Problem

`UI_REVIEWER` is the last role still pinned to the mock
(`packages/agent-sdk/src/providers/mock.ts:139` — `reviewUi()`). With task 02
producing real `Screenshot` rows, the step can build a real `uiReviewInput` and
send it to a configured provider, exactly as the other reviewer roles already do.

## Acceptance criteria

- [ ] The `UI_QA` step builds a `uiReviewInput` (`packages/schemas/src/agent-contracts.ts:323`)
      from the `Screenshot` rows written in task 02 — real ids, pages, viewports,
      dimensions, storage paths, console errors and failed requests. No synthetic
      values.
- [ ] The role resolves through the normal provider configuration path, like
      `CODE_REVIEWER` does. The mock is reachable only when mock execution is
      explicitly enabled, never as a silent default.
- [ ] Provider output is validated against `ROLE_OUTPUT_SCHEMAS.UI_REVIEWER`
      before persistence; invalid output fails the step with a clear error rather
      than writing partial findings.
- [ ] `screenshotId` on a returned finding is validated to reference a
      `Screenshot` row from **this** run. A hallucinated or foreign id is rejected
      or nulled, never stored as a dangling reference. Asserted by a test.
- [ ] Token usage and cost are recorded through the existing `usage-recorder`
      path, and the run respects the task's token and cost budgets.
- [ ] Agent start/stop is written to the audit log, consistent with every other
      role.
- [ ] A test with mock execution enabled still passes end to end, so offline
      testing is not broken by this change.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.

## Constraints

- Provider output is **untrusted data**. Schema-validate it; never treat a field
  as a path, command, or instruction.
- Vendor names stay inside `packages/agent-sdk/src/providers/`.
- Screenshots are images: whatever the provider receives (path, base64, or URL)
  must match what that provider actually accepts — verify against the adapter
  rather than assuming.

## Out of scope

Web UI rendering (task 04) · auto-fixing UI findings · prompt-injection scanning
of page content (roadmap #11).

## Notes

Confirm how the Claude Code adapter accepts image input before designing the
payload — the request-file mechanism described in `docs/agent-provider.md` was
built for text, and this is the first role that needs to send pixels.
