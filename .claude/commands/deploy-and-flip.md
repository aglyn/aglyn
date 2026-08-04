---
description: The backlog is deployed and the CSP canvas click-test PASSED — flip enforcing on (AGL-523), verify the In Review issues against real data, and finish AGL-1160's caching half
---

Pick up from `/promote-and-enforce` on 2026-08-03.

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`. Standing permission to promote is granted.

## 1. The promotion LANDED — read this first

**Deployed at 2026-08-04 00:06Z as `d4855bbf3` (PR #760). All three projects
`success`.** 36 commits, everything from the previous two sessions.

The reason it took so long is worth carrying forward, because it cost most of a
session:

> **`gh api .../commits/<sha>/status` is a FROZEN RECORD, not live state.**
> Its `created_at` and `updated_at` never change after the deployment attempt
> that wrote it. I re-read the same `20:06:37Z` "Deployment rate limited"
> failure for four hours and reported "still rate limited, re-checked just now"
> every time. **The window had in fact cleared.** Nothing had tested it because
> no deployment had been attempted since.

**How to actually test the window:** attempt the deploy. There is no read-only
probe. A rate-limited attempt is cheap — it fails the status and consumes no
deployment slot. If you find yourself reporting "still blocked" more than once
off the same sha, you are reading a fossil.

Still true and still worth obeying: a promotion costs **3 deployment records**
against a ~100/day cap, and **a merged production PR is not a deploy** — check
containment against the READY deployment's sha, never the branch.

## 2. AGL-523 — READY TO FLIP. Everything that gated it is cleared.

**Do not re-derive any of this — it was all measured.** The canvas click-test
that gated the flip is DONE and it passed.

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

Also verified locally, on a real production build: `nextWouldSeeNonce: true`,
52 scripts all carrying one nonce, zero `$undefined`, sign-in hydrating with no
console errors.

### The canvas click-test — DONE on production 2026-08-04 00:18–00:20Z, PASSED

Armed a real signed-in session with `?csp=enforce`, drove the console, opened
`/zgover/hosts/demo/screens/TyE-9na1Ku/versions/xBnkO4KyZC/besigner`, then
disarmed with `?csp=off` and verified back to report-only.

**The canvas renders fully.** Layout chrome, hierarchy tree,
attributes/styles/info panels, version toolbar, and the screen's own MUI
buttons, headings and form fields. `canvasNodes: 4`,
`renderedElementCount: 18`, 149 resources. **The blank canvas did not happen.**
The rest of the console — workspaces, org pages, screens list, notifications —
is equally clean, with Firestore data loading, so App Check and the
authenticated read path are unaffected.

The collector caught exactly **one violation type across the whole session**:

```
"key":"script-src|eval|/zgover/hosts/demo/screens/…/besigner"
"source":".../chunks/2r73hd1cjm4f2.js"   "disposition":"enforce"
```

Same chunk, same `eval` as the local run. It appears on `/zgover` and the
screens list too, so it is **app-wide, not besigner-specific**. Nothing else —
no `inline`, no blocked chunks. `disposition: enforce` proves the session was
genuinely enforcing. Dedup gave one line per page rather than one per script,
and filtering produced zero extension noise from a real browser.

**The one gap: `blobResources: 0`.** No realm-trusted plugin loaded via a
`blob:` import on that screen, so that specific mechanism was never exercised.
It matters less than it would have — the risk was always `strict-dynamic`
making `blob:` inert, and the policy being kept **allows `blob:` explicitly**.
Low-risk, not unknown-risk. Still worth a deliberate pass on a host that has a
realm-trusted plugin installed.

### What is left, in order

1. **Read the collector — it is LIVE and already verified in production.**
   `Reporting-Endpoints: csp="/api/csp-report"` and
   `report-uri /api/csp-report; report-to csp` are on the deployed responses,
   and the endpoint returns 204 to both wire formats. Read it with a Vercel
   runtime-log query for `AGL-523:csp-violation`. Before trusting a low count,
   **post a synthetic report and confirm it appears** — a zero from a collector
   you have not proven is the exact false all-clear this endpoint exists to end.
   (One synthetic control entry was posted at `/__agl523-synthetic-control` on
   2026-08-04 00:09Z; ignore it, or use it as the proof the pipe works.)
2. **Optionally widen the click-test.** The canvas is done. Not yet armed and
   walked: marketplace, admin, a checkout, and — the one that would close the
   last gap — a host with a **realm-trusted plugin** installed, to exercise the
   `blob:` import path. `?csp=enforce` arms an httpOnly cookie, `?csp=off`
   clears it; **always disarm**, and verify with `/csp-check` that
   `nextWouldSeeNonce` is back to `false`.
3. **Flip the default to enforcing** in `apps/console/middleware.ts` — one line,
   `enforcing` currently defaults to the cookie check. Keep
   `script-src 'self' https: blob: 'nonce-…'`; do NOT adopt `strict-dynamic`.
4. **Delete `/csp-check` and the `?csp=` opt-in** once it is on for everyone.
5. **Cheap follow-up worth filing:** `is-generator-function` is a transitive
   dependency and is the sole remaining violation. If whatever pulls it in can
   be dropped or updated, the log goes completely quiet.

**Do not extend the collector to the tenant.** See AGL-1228 — measured: a live
tenant page has 33 `<script>` tags and **zero** nonces, so under its report-only
`strict-dynamic` policy every script violates on every page load of every
published site. Pointing a collector there floods the log with one known defect.

## 3. Verify the In Review issues against real data

Deployed but NOT yet exercised in production.

- **AGL-1160 — back to In Progress, half of it was wrong.** Measured after the
  deploy: Next/Vercel **overrides the hand-written `Cache-Control`** on these
  routes. `robots` is the control — left deliberately on the old
  `s-maxage=3600`, it returns the same `public, max-age=0, must-revalidate` as
  everything else. So the header never reached a CDN, the issue's "cached for an
  hour" premise is false, and my `s-maxage=60` change (`10b813343`) is a no-op.
  The `<loc>` origin fix (`a08bcf75f`) is real and stands. **What remains: find
  what actually caches these routes** (`x-vercel-cache: HIT` says something
  does) and measure publish-to-visible directly rather than reading a header.
  I could not get a production control for the origin fix — it needs a custom
  domain or a tenant `*.vercel.app` alias, and neither guessed alias resolves.
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

**Every confident inference was wrong until measured.** Eight times, and two
of them were my own shipped work:

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
- The deploy window looked closed for four hours. **It was open.** The status I
  kept re-reading was a fossil (see section 1).
- AGL-1160's `s-maxage=60` looked shipped because a unit test proved the route
  SETS the header. **Production replaces it.** I tested the declaration and
  never checked the effect — with a standing note in this repo warning about
  exactly that.

**A control that cannot fail is not a control.** A "0 CSP violations" reading
came from a log file that was empty because the server was piped through `tail`,
which buffers to EOF. Prove a zero with a positive control before trusting it,
and pair it with a negative one so it can fail in both directions.

**`read_console_messages` starts capturing when first CALLED, not at page load.**
Asking it for errors after a navigation returns "no console errors" whether or
not any occurred — another zero that looks like a clean run. Either reload with
tracking already active, or do what worked here: read the **server-side**
collector instead, which is an independent witness and does not depend on
browser tooling at all.

**Arm, test, DISARM.** `?csp=enforce` sets an httpOnly cookie on a real session.
Leaving it set would degrade the console for whoever owns that browser. Disarm
with `?csp=off` and verify `nextWouldSeeNonce: false` before walking away.

**Check the module boundary before designing.** `scope:app` may not depend on
`aglyn:addons`, so AGL-1217's policy had to go in core. Confirmed by making the
violation deliberately and watching the lint fire — a clean pass was not
evidence, because the eslint run emits an unrelated stack trace.

**Reuse the reader, not just the scanner.** AGL-1161 could have quietly
reintroduced AGL-1223's bug: node trees have two storage forms, and a private
second reader that handled one would have reported "used nowhere" on a
correctness path.
