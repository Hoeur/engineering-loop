# Plan — EngLoop delivery sequence (P0–P6)

**Status:** active index · **Created:** 2026-09-19
**Source:** `docs/next-plan.md`
**Supersedes:** `.loop/plan-real-ui-qa.md` as the *active* index. That plan is not
cancelled — it is rescheduled to **P3**, and its task specs stay valid.

---

## Why this index exists

`.loop/plan-real-ui-qa.md` was written before `docs/next-plan.md` and assumed UI
QA was the next feature. The delivery plan reorders it to **P3**, behind
sandboxing (P1) and live provider/GitHub delivery (P2). Running the loop off the
old index would have picked task 02 (screenshot capture) — work the delivery plan
explicitly defers, and which P1 changes the design of: once agents run inside a
sandbox, *where Playwright runs* is answered by the sandbox, not by task 02's
open question Q1.

That is the whole reason for re-indexing rather than continuing.

---

## Sequence

| Priority | Phase | Depends on | Status |
| --- | --- | --- | --- |
| P0 | Restore evidence baseline | — | **in progress** — 2 criteria open |
| P1 | Sandboxed agent execution | P0 | not started |
| P2 | Real provider and GitHub delivery | P0, preferably P1 | not started |
| P3 | Real UI QA and live run updates | P0, P2 | **partially done** — see below |
| P4 | Durable and parallel orchestration | P1, P2 | not started |
| P5 | Production auth, authz, notifications | P0 | not started |
| P6 | Quality gates and prompt-injection defence | P1, P2 | not started |

---

## P0 — restore the evidence baseline

Evidence record: `.loop/p0-evidence.md`.

| Criterion | Status |
| --- | --- |
| Branch, upstream, remote, HEAD, status captured | Met |
| Repair diff reviewable against a real base revision | Met — `9d58bc4` |
| `pnpm lint` / `typecheck` / `test` | Met — clean · clean · 409 passing |
| `pnpm build` | **Open** — was blocked by a `.next` lock; lock has since cleared, needs a re-run |
| `pnpm test:e2e` runs on Windows | Met, with `PLAYWRIGHT_CHROMIUM_PATH` + `PLAYWRIGHT_BASE_URL` |
| Six viewports pass without uncaught errors | **Open** — 13 auth-gated failures |
| No horizontal scrolling | Met for rendered pages; **unproven for the authenticated shell** |
| Worktree clean, repair committed | Met |

### The auth gap — root-caused, not guessed

The E2E suite sets `localStorage['engloop.auth.token'] = 'e2e-session'`.
`AuthGate` (`apps/web/components/auth/auth-gate.tsx`) only checks the token is
truthy, so it passes — **then** the first API call returns 401,
`api-client.ts:92` calls `notifyUnauthorized()`, the token is cleared and the
browser is redirected to `/login`. Verified directly:

```
curl -H "Authorization: Bearer e2e-session" localhost:4000/api/tasks  → HTTP 401
```

An earlier hypothesis that the gate decodes a JWT was **wrong** and is recorded
here so it is not re-derived.

**Chosen fix:** `AUTH_DEV_BYPASS=true`. `AuthService.resolveDevUser()`
(`apps/api/src/modules/auth/auth.service.ts:117`) resolves the seeded user and
refuses to activate in production. Preconditions verified: `founder@evalley.dev`
exists with 1 organization membership. Requires an API restart — the process
watches source, not `.env`.

**P5 follow-up:** this is a development bypass. P5's criterion "`AUTH_DEV_BYPASS`
is disabled in production and cannot be enabled accidentally" means the E2E suite
will need a real login or a `storageState` fixture before P5 completes. Recorded
now so it is not discovered then.

---

## P3 — what task 01 already delivered

Do not re-do this. `.loop/plan-real-ui-qa.md` task 01 shipped at commit
`94a1b76`:

- `WorkflowStepKey.UI_QA` exists and is registered in `STEP_HANDLERS`.
- The step runs after `RUN_TESTS`, before `REVIEW`, gated on `testsPassed`.
- `ReviewEngine.persistUi()` — previously dead code — is now reachable.
- Enablement: `Project.settings.uiQa.enabled`, default off.
- The step skips cleanly when no screenshots exist, rather than approving on no
  evidence.
- Migration `20260919120000_workflow_step_ui_qa`.

Still open, and now **P3 work**: `.loop/02-screenshot-capture/`,
`.loop/03-ui-reviewer-wiring/`, `.loop/04-web-surfacing/`. Their specs remain
valid; read `.loop/plan-real-ui-qa.md` §"From 01 → 02" before starting any of
them.

**P1 resolves task 02's biggest open question.** Task 02 asks whether Playwright
runs in-process, as an allowlisted subprocess, or is deferred. P1 introduces an
execution-runtime port with one isolated boundary per run — which is the answer.
Task 02 should be re-planned against that port rather than deciding independently.

---

## Progress

- [ ] P0 — 2 criteria open (build re-run, six-viewport pass)
- [ ] P1 — sandboxed agent execution
- [ ] P2 — real provider and GitHub delivery
- [~] P3 — UI QA step done (`94a1b76`); capture, wiring and surfacing open
- [ ] P4 — durable and parallel orchestration
- [ ] P5 — production auth, authz, notifications
- [ ] P6 — quality gates and prompt-injection defence

**Carry-forward notes**

### P0 → everything

- The repo has **no remote**. `9d58bc4` is the root commit; history was
  investigated and none was lost (`.loop/p0-evidence.md` §1). Any plan step that
  says "push" or "clone from the authoritative remote" has no target yet.
- A web server runs on **port 3001**, not 3000, and is supervised — it restarts
  itself and holds `apps/web/.next`. `PLAYWRIGHT_BASE_URL=http://localhost:3001`.
- Chromium 1234 is installed at `chrome-win64/`, but Playwright looks for
  `chrome-win/`. `PLAYWRIGHT_CHROMIUM_PATH` is required until this is normalised
  — worth adding to `.env.example`.
- `/insights/costs` overflow and `states.spec.ts › empty state` are **flaky**,
  not deterministic failures.
