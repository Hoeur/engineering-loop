# Plan — EngLoop delivery sequence (P0–P6)

**Status:** active index · **Created:** 2026-09-19 · **Updated:** 2026-09-24
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
| P0 | Restore evidence baseline | — | **done** — all criteria met 2026-09-20 |
| P1 | Sandboxed agent execution | P0 | **in progress** — runtime seam + non-isolated `HOST_PROCESS` only |
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
| `pnpm build` | Met — `.loop/p0-evidence.md` §5 |
| `pnpm test:e2e` runs on Windows | Met, with `PLAYWRIGHT_CHROMIUM_PATH` + `PLAYWRIGHT_BASE_URL` |
| Six viewports pass without uncaught errors | Met — 99 passed / 0 flaky, twice in a row (`.loop/p0-evidence.md` §6) |
| No horizontal scrolling | Met for the authenticated shell at all six widths, after fixing two real overflows |
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

`AUTH_DEV_BYPASS=true` was tried first and does not help: the guard only applies
the bypass when **no** `Authorization` header is sent, and the web app always
sends one once a token is stored (`.loop/p0-evidence.md` §5).

**Chosen fix (shipped):** the suite logs in for real. `apps/web/e2e/fixtures.ts`
posts the seed credentials to `/api/auth/login` once per worker and plants the
returned JWT before each page loads. This is option 1 from the evidence record,
using the seed user instead of an operator password, so it also survives P5
removing the dev bypass. Credentials and API URL are overridable via
`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_API_URL`.

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

**The current P1 slice does not resolve task 02's biggest open question.** Task
02 asks whether Playwright runs in-process, as an allowlisted subprocess, or is
deferred. P1 now has an execution-runtime port, but its only adapter is
`HOST_PROCESS` with `isolated: false`; it runs children as the worker OS user.
That seam does not determine safe Playwright placement. Task 02 remains open and
must be re-planned when a future isolated runtime adapter provides a real
containment boundary.

---

---

## Feature tier — F1–F7 (new user-facing features)

**Source:** "EngLoop New Feature TODO Roadmap" · **Added:** 2026-09-19

These are user-facing features, distinct from the P0–P6 infrastructure phases.
**None is startable today** — each depends on phases that have not begun. P0 is
closed, so P1 and P5 (which depend only on P0) are the phases that unblock them.

| Feature | Stated deps | Dep status | Schema gap |
| --- | --- | --- | --- |
| F1 Action Inbox | P3, P5 | neither started | `Task` human assignee, snooze |
| F2 GitHub Issue Intake | P2, P5 | neither started | `ExternalIssue`, `ExternalIssueComment` |
| F3 PR Feedback & Merge Queue | F2, P2, P5 | blocked twice | external findings, merge queue |
| F4 Workflow Template Studio | P4, P5 | neither started | `WorkflowTemplateVersion` |
| F5 Repository Intelligence | P2, **P8** | **P8 undefined** | `RepositorySnapshot` |
| F6 Agent Evaluation Lab | P2, **P7, P8** | **P7/P8 undefined** | benchmark suites/cases/runs |
| F7 Cross-Repository Change Sets | P4, **P10** | **P10 undefined** | `ChangeSet` |

### P7, P8 and P10 are undefined

The feature roadmap's summary refers to "P0–P12", but `docs/next-plan.md` defines
only **P0–P6**. F5, F6 and F7 depend on P7, P8 and P10, for which no document
exists in this repository. Those dependencies are **unverifiable**, and are
recorded as unknown rather than guessed at. Do not infer them from
`docs/roadmap.md`.

### Verified against the code

- **F1's six sources all exist**: `Approval`, `Task.NEEDS_HUMAN_REVIEW`,
  `WorkflowRun`, `ReviewFinding`, `CostRecord`, `TaskComment`. So does its tenant
  scoping — `ownedApprovalWhere`, `ownedFindingWhere`, `ownedWorkflowRunWhere`.
  Its one real gap: **`Task` has no human assignee** (`assignedAgentId` is an
  `Agent`), which claim/reassign/assigned-follow-ups all require.
- **F2/F3**: `WebhookEvent` and `PullRequest` exist, but `PullRequest.local`
  defaults `true` with `url: null` — **no real pull request has ever been
  opened.** F3's merge queue presumes the live GitHub pipeline P2 must build first.
- **F4/F5/F6/F7**: none of `WorkflowTemplateVersion`, `RepositorySnapshot` or
  `ChangeSet` exists.

### F4 carries a specific risk worth naming now

F4 compiles user-authored templates into `decideEngineeringStep`, today a pure
function guarded by a termination test. Task 01 is the cautionary precedent:
adding **one** optional step introduced an infinite loop that only the termination
test caught. Compiling arbitrary user templates into that function is a much
larger version of the same risk, and F4's acceptance criteria are right to demand
the same termination tests.

### Specced ahead

- `.loop/F1-action-inbox/` — spec + plan written 2026-09-19. Includes a
  **pre-P3/P5 slice** question: a polled, read-only inbox with filtering and deep
  links is deliverable before either dependency, giving up claim/reassign and live
  updates. Open for a decision.

---

## Progress

- [x] P0 — closed 2026-09-20: real E2E login, six viewports green, two overflow defects fixed
- [ ] P1 — sandboxed agent execution
- [ ] P2 — real provider and GitHub delivery
- [~] P3 — UI QA step done (`94a1b76`); capture, wiring and surfacing open
- [ ] P4 — durable and parallel orchestration
- [ ] P5 — production auth, authz, notifications
- [ ] P6 — quality gates and prompt-injection defence
- [~] F1 — Action Inbox: **read-only slice shipped** (`3690191`); claim/reassign/snooze/mentions/streaming still blocked on P3/P5
- [ ] F2 — GitHub Issue Intake (blocked on P2/P5)
- [ ] F3 — PR Feedback & Merge Queue (blocked on F2/P2/P5)
- [ ] F4 — Workflow Template Studio (blocked on P4/P5)
- [ ] F5 — Repository Intelligence (blocked on P2/**P8 undefined**)
- [ ] F6 — Agent Evaluation Lab (blocked on P2/**P7, P8 undefined**)
- [ ] F7 — Cross-Repository Change Sets (blocked on P4/**P10 undefined**)

**Carry-forward notes**

### P0 → everything

- `9d58bc4` is the root commit; history was investigated and none was lost
  (`.loop/p0-evidence.md` §1). The repository now lives at
  `github.com/Hoeur/engineering-loop` (`main`), so "push" steps have a target.
- Ungated work has landed outside the P0–P6 index: provider API keys configured
  from the UI (`c6643ab`) and per-agent token/cost budgets (`9c50de5`). Neither
  is a phase deliverable; both touch surfaces P1 (credential passing) and P5
  (authorization) will need to re-verify.
- A web server runs on **port 3001**, not 3000, and is supervised — it restarts
  itself and holds `apps/web/.next`. `PLAYWRIGHT_BASE_URL=http://localhost:3001`.
- Chromium 1234 is installed at `chrome-win64/`, but Playwright looks for
  `chrome-win/`. `PLAYWRIGHT_CHROMIUM_PATH` is required until this is normalised
  — worth adding to `.env.example`.
- The E2E CI workflow (`.github/workflows/e2e.yml`) is schedule/dispatch only
  and had never been able to pass: the web build did not inline
  `NEXT_PUBLIC_API_URL`, so the browser called a relative `/api` the Next server
  does not serve. Fixed alongside the login fixture; run it via
  `workflow_dispatch` to confirm on GitHub runners.
- Two flakes were root-caused and removed rather than retried around: the
  `Tasks` link locator also matched the "Tasks running" metric card once the
  dashboard loaded (`exact: true`), and the `Ctrl+K` press could land before
  hydration attached the listener (`toPass` retry).
