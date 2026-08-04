---
description: Promote the 36-commit backlog the moment Vercel's window clears, then flip CSP to enforcing (AGL-523) with the evidence already gathered, and verify the four In Review issues in production
---

Pick up from `/promote-and-enforce` on 2026-08-03. **The whole session was
blocked on one deploy that never became available.** Nothing here is stuck on
research — it is stuck on a deployment slot.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`. Standing permission to promote is granted.

## 1. The promotion — check first, it may still be closed

`main` was **36 commits** ahead at handoff and the window was rate-limited for
the entire session (~4 h of checks, `failure` every time).

```bash
gh api repos/aglyn/aglyn/commits/$(git rev-parse origin/production)/status --jq '.state'
```

If that is still `failure` with "Deployment rate limited", **wait — do not
merge more.** Merging while limited is what stranded the CSP work in the first
place: `origin/production` sat 5 commits ahead of the live build all day, which
is why `?csp=enforce` read as a no-op on production and looked like a bug.

**A merged production PR is not a deploy.** Always check containment against the
sha of the **READY** deployment, never the branch. The last READY console
deployment at handoff was `b021ddf0e` (2026-08-03 19:22Z) while
`origin/production` was `5238127dc`.

The burst that caused this ran 15:21–20:06Z on 2026-08-03, with deployments
starting ~03:26Z. Expect headroom some time after that on the 4th. One
promotion, then stop.

## 2. AGL-523 — the flip, and it now has evidence

This is the highest-value thing waiting, and most of the work is done. **Do not
re-derive the decision — it was measured.**

A local production build (worktree + emulators) ran the same signed-in flow
under both policies:

| policy | violations |
| -- | -- |
| enforcing `script-src 'self' https: blob: 'nonce-…'` | **1** |
| report-only `'strict-dynamic'` | **70–71** |

**So `strict-dynamic` is not viable — stay on `'self' https: blob:`.** Nonce
propagation does not reach Next's chunk loads, so `'self'` going inert takes the
whole bundle with it.

The single enforcing violation is `script-src / eval`, and it is benign:
`Function("return function*() {}")` inside a `try/catch` — `is-generator-
function`'s feature probe. Blocked, it is caught and returns `false`. **No
`'unsafe-eval'` is needed.**

Also already verified locally, on a real production build: `nextWouldSeeNonce:
true`, 52 scripts all carrying one nonce, zero `$undefined`, sign-in hydrating
with no console errors.

### What is left, in order

1. **Deploy, then read the collector.** New this session:
   `/api/csp-report` plus `report-uri` + `report-to` + a `Reporting-Endpoints`
   header, on both policies. Read it with a Vercel runtime-log query for
   `AGL-523:csp-violation`. Before trusting a low count, **post a synthetic
   report and confirm it appears** — a zero from a collector you have not
   proven is the exact false all-clear this endpoint exists to end.
2. **Click-test the besigner canvas** with `?csp=enforce` (sets an httpOnly
   cookie; `?csp=off` clears it). **This is the one thing local could not
   reach** — both besigner routes 404'd in the production-mode local setup even
   with fixtures seeded and both route files present. Realm-plugin `blob:`
   imports are the risk; note the enforcing policy allows `blob:` explicitly
   while `strict-dynamic` would make it inert. Also worth a pass: marketplace,
   admin, a checkout.
3. **Flip the default to enforcing** in `apps/console/middleware.ts` — one line,
   `enforcing` currently defaults to the cookie check.
4. **Delete `/csp-check` and the `?csp=` opt-in** once it is on for everyone.

**Do not extend the collector to the tenant.** See AGL-1228 — measured: a live
tenant page has 33 `<script>` tags and **zero** nonces, so under its report-only
`strict-dynamic` policy every script violates on every page load of every
published site. Pointing a collector there floods the log with one known defect.

## 3. Verify the four In Review issues in production

All four land on the same deploy and none has been exercised against real data.

- **AGL-1160** — sitemap/RSS. Confirm `<loc>` uses the site's own origin, not
  the requesting host, and that `Cache-Control` is `s-maxage=60,
  stale-while-revalidate=60`. Check a custom-domain site and a `.aglyn.app` one.
- **AGL-1161** — publish a component used through a layout and through another
  component; confirm both sets of screens drop. Watch for
  `AGL-1161:component-scan-truncated`.
- **AGL-1217** — request verification on a listing, check the staff queue's new
  third bucket, decline with a reason, confirm the publisher notification and
  that the cooldown holds.
- **AGL-1152** is already **Done** — measured, closed, no action.

## 4. Needs Zach, not research

- **AGL-1213** — the design changed. "Verify the origin of reCAPTCHA solutions"
  is **CHECKED**, and that key is the **App Check** provider, not Firebase Auth.
  The console reads Firestore client-side, so **every white-label domain must be
  on a 9-entry reCAPTCHA allowlist or all its reads are denied.** Four options
  are on the issue; none is picked. This is a commercial ceiling, not a detail.
- **AGL-734** — delete the stale Google Cloud DNS zone. One action in the GCP
  console; risk measured as gone.
- **AGL-1148** — commit to an uptime percentage.
- **AGL-1104** — compliance posture.
- **AGL-1133 item 5** — what a collaborator may see of another member's contact
  details.
- **AGL-1132** — console embedded checkout is behind `release_native_checkout`,
  default off; the storefront half is undone.

## 5. Still open, filed with measurements

- **AGL-1226 — URGENT, still live.** Every `/product/*` page on the marketing
  site 500s: `MUI error #7`, digest `2268404015`, reproducible, `x-vercel-cache:
  MISS` every time, control `/` returns 200. Public and reachable from
  navigation. **The other session's area (AGL-1167) — check before touching.**
- **AGL-1225** — the tenant render spends 3–4 s in the loader, warm as well as
  cold. Phase budget attached. `composeScreenNodes` is 1.4–1.6 s of it.
- **AGL-1228** — the tenant's report-only CSP can never be satisfied. Note it
  names a second cause the middleware comment misses: the shadowing bug AGL-523
  fixed on the console is independently sufficient, so fixing only that will
  leave the scripts unnonced and look like the fix failed.

## The other session

Still **running** at handoff, not archived — it committed throughout
(AGL-1223, AGL-1167, AGL-1227, AGL-1224). It owns `tools/marketing/**`,
`libs/besigner/**`, the media picker, and it had `nx serve console` on :4200
using `apps/console/.next`.

- **Always `git commit --only <your files>`.** Something auto-stages here —
  `apps/console/public/__slots-tmp.json` and `__pour-tmp.js` appeared staged
  more than once. Never `git add -A`.
- **Never `git stash`** — read the failure instead.
- Do not run a build in the main worktree; it will clobber their `.next`. Use
  `git worktree add --detach` + `cp -Rc node_modules` (APFS clone, ~40 s, near
  zero disk).

## Lessons this session paid for

**Every confident inference was wrong until measured.** Six times:

- `preLoadBootMs` was going to be ~7.8 s of lambda init. It is **1.8 s** — most
  of the "missing" time was the doubled render, already fixed.
- AGL-1152 was going to hand off to AGL-1151. **AGL-1151 was already Done**, and
  measured client JS, not the server module graph.
- AGL-1160 was going to use a cache tag. **`revalidateTag` cannot reach a CDN**,
  and the CDN is the only layer a crawler sees.
- AGL-1213's question was about Firebase Auth authorized domains. **The key is
  App Check's.**
- The tenant's report-only CSP looked like a quiet observer. It reports **every
  script on every page load**.
- Enforcing CSP looked like it blanked the besigner canvas. **The control blanked
  identically** — a 404, not CSP. That one was ninety seconds from being written
  up as fact.

**A control that cannot fail is not a control.** A "0 CSP violations" reading
came from a log file that was empty because the server was piped through `tail`,
which buffers to EOF. Prove a zero with a positive control before trusting it,
and pair it with a negative one so it can fail in both directions.

**Check the module boundary before designing.** `scope:app` may not depend on
`aglyn:addons`, so AGL-1217's policy had to go in core. Confirmed by making the
violation deliberately and watching the lint fire — a clean pass was not
evidence, because the eslint run emits an unrelated stack trace.

**Reuse the reader, not just the scanner.** AGL-1161 could have quietly
reintroduced AGL-1223's bug: node trees have two storage forms, and a private
second reader that handled one would have reported "used nowhere" on a
correctness path.
