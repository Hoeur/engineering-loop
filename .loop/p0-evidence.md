# P0 — evidence baseline

**Date:** 2026-09-19 · **Source plan:** `docs/next-plan.md` §4
**Scope:** git evidence + browser E2E evidence. No production code changed.

---

## 1. Git history — investigated, nothing was lost

`docs/next-plan.md` §4 says: *"Do not initialize a replacement repository that
loses history."* A `git init` had already been run in this session before that
document was read, so the first job was establishing whether history existed to
lose. **It did not.** Four independent checks:

| Check | Result |
| --- | --- |
| `git fsck --lost-found` dangling **commits** | **0** — a prior repo would leave commit objects |
| `.git/objects` created before 16:40 today | **0** of 733 — every object is from this session's init |
| `git reflog --all` earliest entry | `9d58bc4 commit (initial)` — no prior HEAD |
| Sibling projects on `E:/Evalley/` | every other project has its own `.git`; this one never did |

The `.idea/vcs.xml` mapping of `$PROJECT_DIR$` as a Git root post-dates the init
(file mtime 17:03 vs. init 16:45), so it is a reaction to the new repo, not
evidence of an old one. The only GitHub URL anywhere in the project
(`Hoeur/chat-gate-frontend`) belongs to a *managed repository* EngLoop was
operating on, not to EngLoop itself.

**Conclusion:** no authoritative remote exists for EngLoop. This working copy is
the origin, and `9d58bc4` is legitimately its root commit. P0's recovery step is
not applicable; its evidence step is satisfied below.

### Git evidence record

```
branch:   master
HEAD:     a626289e88675fd6c29e1d38668b396b7deb6fbb
upstream: none (no remote configured)
remote:   none
status:   0 modified/untracked files (clean worktree)
tracked:  447 files
```

Excluded from the baseline and verified absent from every commit: `.env`,
`*.pem`, `node_modules/` (1011M), `apps/worker/workspace/` (719M),
`apps/web/.next/` (438M).

---

## 2. Browser E2E — ran, with one real gap

### Corrections to `docs/next-plan.md` §1

The document's two stated environment gaps were both partly stale:

- **"Playwright browser not configured"** — Chromium **1234 is installed**. The
  failure was a path shape: Playwright looked for `chrome-win/`, the install is
  `chrome-win64/`. Setting `PLAYWRIGHT_CHROMIUM_PATH` (which
  `playwright.config.ts` already supports) fixed it — 16/16 failures became
  13 passed / 3 failed on the first run.
- **"Global `pnpm` fails with EPERM on `C:\Users\YCT_2`"** — not reproduced. The
  EPERM encountered was on `apps/web/.next/trace`, held by an already-running
  EngLoop web server (PID 30556 → 33344, self-restarting) listening on **port
  3001**. No server needed starting; the suite was pointed at the running one.

### Reproducible command

```bash
cd apps/web
PLAYWRIGHT_CHROMIUM_PATH="C:/Users/YCT_2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://localhost:3001 \
../../node_modules/.bin/playwright test
```

### Result — all six viewports

**80 passed · 13 failed · 3 skipped** (3.1 min), across 1440, 1024, 768, 430,
390 and 375.

### The 13 failures are one environment gap, not 13 defects

Every failing test needs the **authenticated application shell**. The captured
page snapshots all show the same thing at every viewport:

```
heading "Sign in"
paragraph: Use your EngLoop account to open the control plane.
```

The suite sets `localStorage['engloop.auth.token'] = 'e2e-session'` in a
`beforeEach`, but the running server does not accept that as a session, so the
app renders `/login` instead of the shell. `AUTH_DEV_BYPASS=false` in `.env`;
that flag is consumed by `packages/config` on the **API** side, so flipping it
alone may not be the whole fix.

Failures by cause:

| Tests | Viewports | Needs |
| --- | --- | --- |
| command palette shortcut | all 6 | authenticated shell |
| collapses the sidebar | 1440, 1024, 768 | authenticated shell |
| exposes navigation at every width | 430, 390, 375 | authenticated drawer |
| empty state when API returns no tasks | 1024 only | — see flakiness below |

### Horizontal overflow — the P0 criterion — passed

All 60 overflow assertions passed (10 routes × 6 viewports), **including 375px**.
Note this was measured against the login page for unauthenticated routes, so it
is a real result for what was rendered but **not** proof that the authenticated
shell is overflow-free.

### Flakiness observed

`/insights/costs` overflow **failed** on the first single-viewport run and
**passed** in the full run; `states.spec.ts › empty state` failed only at 1024.
Both are timing-sensitive rather than deterministic. Recorded rather than
explained away.

---

## 3. P0 acceptance criteria — status

| Criterion | Status |
| --- | --- |
| Branch, upstream, remote, HEAD, status captured | **Met** |
| Repair diff reviewable against a real base revision | **Met** — `9d58bc4` |
| `pnpm lint` / `typecheck` / `test` via repo commands | **Met** — clean · clean · 409 passing |
| `pnpm build` | **Met** — see §5 |
| `pnpm test:e2e` runs on Windows | **Met**, with the documented env vars |
| All six viewports pass without uncaught errors | **Open** — awaiting API restart, see §5 |
| No horizontal scrolling | **Met** for rendered pages; unproven for the shell |
| Worktree clean, repair committed | **Met** — clean at `db4b33a` |

---

## 5. Update — 2026-09-19, after the re-index

### `pnpm build` now passes

The `.next` lock cleared on its own (the supervised web server recycled). A full
`pnpm build` ran to completion: all 11 packages, then api, worker and web. Next.js
emitted the full route table including `/quality/ui-qa`. The worktree stayed clean
— `apps/web/.next` is git-ignored.

**Caveat worth recording:** running `pnpm build` rewrote `.next` underneath the
running dev server, which returned HTTP 500 for roughly a minute before recovering
on its own. Building while that server runs is disruptive but self-healing.

### E2E re-run — blocked, not yet re-run

Root cause of the 13 failures was established (§2 above and
`.loop/plan-delivery.md`): `AuthGate` accepts any truthy token, so `e2e-session`
passes the gate; the API's 401 then clears it and redirects to `/login`. Verified
by direct request, not inferred.

Fix applied to `.env`: `AUTH_DEV_BYPASS=true` (backup at `.env.bak-p0`, git-ignored).
Preconditions verified — `founder@evalley.dev` exists with 1 organization
membership, so `resolveDevUser()` will resolve rather than return null.

**The API has not come back up.** It was last seen as PID 24724 serving 401s;
after the restart request it stopped listening on port 4000 and had not returned
after 3 minutes of polling. The six-viewport re-run needs it, because the failing
tests are exactly the ones that call the API.

### Update — API restarted, suite re-run, one real defect found

The API was brought up (`pnpm dev:api`) and confirmed serving with the dev
bypass active: `GET /api/tasks` → **200**, with a resolved `actorId` and
`organizationId` in the request log.

**Re-run result: 87 passed · 6 failed · 3 skipped** (with `--retries=2`).

That is up from 80 passed, and the 13 auth-gated failures are down to 6 — but
the remaining 6 are **one test failing at all six viewports, surviving two
retries**. Deterministic, not flaky.

#### The catch-22 in E2E authentication — root-caused

`apps/api/src/modules/auth/auth.guard.ts:25-31`:

```ts
if (header?.startsWith('Bearer ')) {
  request.user = await this.auth.verifyToken(...);   // JWT verify — fails on a fake token
} else {
  const devUser = await this.auth.resolveDevUser();  // the bypass lives ONLY here
  if (!devUser) throw AppError.unauthorized();
}
```

The dev bypass applies **only when no `Authorization` header is sent**. Proven
directly:

```
curl localhost:4000/api/tasks                                   → 200
curl -H "Authorization: Bearer e2e-session" localhost:4000/api/tasks → 401
```

So the suite is caught between two requirements:

- `AuthGate` (`apps/web/components/auth/auth-gate.tsx`) redirects to `/login`
  unless `localStorage['engloop.auth.token']` is **truthy**.
- `api-client.ts:71` forwards that token as `Bearer`, and any token the API
  cannot verify produces a 401 → `notifyUnauthorized()` → token cleared →
  `/login`.

A probe test confirmed both horns: **with** a fake token the API 401s; **without**
a token `AuthGate` blocks at the gate. `AUTH_DEV_BYPASS=true` alone cannot fix
this.

Real credentials were not obtainable: the seeded demo password
(`engloop-dev-password`) is rejected, because this database was created with
`bootstrap:real` using credentials only the operator holds. No passwordless
dev-token endpoint exists — `/api/auth/login` is the only public auth route.

#### Options — operator decision

1. **A `storageState` fixture.** Log in once with real `bootstrap:real`
   credentials, save the JWT, and have Playwright reuse it. Faithful to the real
   auth path and survives P5's removal of `AUTH_DEV_BYPASS`. Needs the operator's
   password, supplied as an environment variable — not committed.
2. **Re-seed a known dev user.** `pnpm db:seed` creates
   `founder@evalley.dev / engloop-dev-password`, which the suite could log in as.
   Changes database contents, so it is the operator's call.
3. **Let the bypass cover a sentinel token.** Have the guard treat one
   configured dev token as the bypass path. This is an app change that weakens an
   auth boundary for test convenience, and it directly contradicts P5's criterion
   that the bypass "cannot be enabled accidentally". Recorded for completeness;
   **not recommended**.

#### Everything else now passes

The other 12 previously-failing tests pass with the bypass: the sidebar collapse,
the mobile navigation drawer, and every authenticated-shell overflow assertion.
The `/insights/costs` and `states.spec.ts` flakiness did not recur under
`--retries=2`.

**Horizontal overflow at 375px now passes against the real authenticated shell**,
not just the login page — which closes the gap flagged in §3.

**To re-run once authentication is settled:**

```bash
cd apps/web
PLAYWRIGHT_CHROMIUM_PATH="C:/Users/YCT_2/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_BASE_URL=http://localhost:3001 \
../../node_modules/.bin/playwright test
```

Expect the 13 auth-gated failures to clear. The `/insights/costs` overflow and
`states.spec.ts › empty state` flakiness is independent of auth and may still
appear.

---

## 6. Update — 2026-09-20, P0 closed

Environment: Linux, fresh clone of `github.com/Hoeur/engineering-loop` at
`b327b11`, Postgres 16 + Redis 7 via `docker compose`, `pnpm db:deploy && pnpm
db:seed`, API from `pnpm --filter @engloop/api run start`, web from `next build`
with `NEXT_PUBLIC_API_URL=http://localhost:4000/api`, Playwright's own Chromium.

### Decision on §4.1 — the suite logs in for real

Option 1 (real login) with the **seed** user rather than an operator password.
`apps/web/e2e/fixtures.ts` posts `founder@evalley.dev / engloop-dev-password` to
`/api/auth/login` once per worker and stores the JWT under
`engloop.auth.token` via `addInitScript`. No app code changed for auth; the dev
bypass stays off. Login failure produces one explicit error naming the URL and
the env vars to override (`E2E_API_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`).

### First authenticated run — 94 passed · 3 failed · 2 flaky

The 13 auth-gated failures cleared and the suite exposed **real defects** the
login page had been hiding:

| Failure | Root cause | Fix |
| --- | --- | --- |
| `/` overflows 221px at 768, 311px at 430 | Dashboard `Card`s are grid items with `min-width: auto`, so a long run title forced the card past the viewport | `min-w-0` on both cards (`apps/web/app/page.tsx`) |
| `/settings` overflows 15px at 390, 30px at 375 | Same grid-item behaviour; unbreakable worktree paths and permission badges | `min-w-0` on the cards, `shrink-0` on badges (`apps/web/app/settings/page.tsx`) |
| `Tasks` link (flaky, 390) | `getByRole('link', { name: 'Tasks' })` also matched the "Tasks running 4" metric card once the dashboard finished loading | `exact: true` |
| command palette (flaky, 430/1440) | `Ctrl+K` pressed before hydration attached the listener | retry the keypress with `toPass` |

### Final result — 99 passed · 0 failed · 0 flaky · 3 skipped, twice

Two consecutive full runs across 1440, 1024, 768, 430, 390 and 375. Full gates
on the same tree: `pnpm lint` clean, 14 typecheck projects clean, **454 tests
passing**, `pnpm build` clean.

### CI workflow correction

`.github/workflows/e2e.yml` built the web app without `NEXT_PUBLIC_API_URL`, so
the browser would call a relative `/api` that the Next server does not serve.
Added `NEXT_PUBLIC_API_URL` and `E2E_API_URL` to the job env. The workflow is
schedule/dispatch only and has not been run on GitHub yet.

### P0 acceptance criteria — all met

Every row of §3 is now **Met**. §4.1 is decided above; §4.2 was closed in §5;
§4.3 is addressed by the commented E2E block in `.env.example`.

---

## 4. Open decisions

1. **How should E2E authenticate?** The suite's `localStorage` token is not
   honoured. Options: a dev-bypass session endpoint, a seeded test user with a
   real login step in `beforeEach`, or a storage-state fixture. This is a product
   decision about how the test suite is meant to authenticate, not a bug to
   guess at.
2. **`pnpm build` is blocked** by whatever holds `apps/web/.next`. It is a
   supervised, self-restarting server; stopping it is yours to do. Once stopped,
   `pnpm build` should be re-run to close that criterion.
3. **Make the browser path durable** — add `PLAYWRIGHT_CHROMIUM_PATH` to
   `.env.example`, or normalise on `playwright install`, so the next run does not
   rediscover this.
