---
description: "SUPERSEDED 2026-08-14 — a dated 2026-08-03 session handoff kept for its lessons. Use /handoff for the current promotion flow and queue."
---

> ⚠️ **SUPERSEDED (2026-08-14) — this is a point-in-time session handoff written
> 2026-08-03, not a live runbook. For the current promotion flow, working
> agreements and queue, read `.claude/commands/handoff.md` and `.claude/HANDOFF.md`;
> where they disagree with anything below, they win.** Corrected in place:
>
> - **`aglyn-plugins` DOES deploy** (AGL-1633). It builds whenever a push range
>   touches `tools/plugin-loader/origin`, and it serves `plugins.aglyn.com` — the
>   plugin-bundle origin baked into the live tenant client bundle as
>   `loadRealmPlugins(…, {artifactsBase: "https://plugins.aglyn.com"})` (AGL-1610).
>   A promotion therefore costs **4** deployment records, not 3. Only
>   `www-aglyn-io` has genuinely stopped: measured 2026-08-14, its newest
>   production record is **12 days** old, while `aglyn-plugins` produced one an
>   hour earlier.
> - **Promotion is NOT pre-authorised.** The "standing permission" granted below
>   applied to the 2026-08-03 session only. The current agreement is that
>   **promotion needs Zach's word before it starts.**
> - **Never create an intermediate branch.** Push to `main` immediately, let a
>   batch accumulate on `main`, gate `main`'s tip, then PR `main` → `production`
>   and merge it as a **real merge commit** — never squash, never rebase, never a
>   `promote/*` branch.
> - **Sections 2 and 3 are spent.** AGL-523 closed Done on 2026-08-04, the day
>   after this file was written. Treat the whole queue and the "Needs Zach" list
>   as history and re-derive both from Linear.
>
> Still worth reading: **"Lessons this session paid for"** at the bottom.
> Everything above it is a snapshot of one day.

Pick up from `/self-serve-sso` on 2026-08-03. **Start with the promotion — it
gates two verifications that have been waiting all day.**

Work issues in Linear: **In Progress** when you start, **In Review** when it
lands, **Done** once verified in production. One conventional commit per
AGL-### on `main`. ~~Standing permission to promote is granted.~~ **Corrected
2026-08-14: promotion needs Zach's word before it starts.**

## Read this before promoting

**Batching means WAITING.** I broke this yesterday: four promotions in 86
minutes exhausted the Vercel 24h limit and left a finished CSP fix merged to
`production` but never deployed. A promotion costs **4 deployment records**
(tenant, docs, console and `aglyn-plugins`) against a ~100/day cap. Only `www`
no longer deploys; `aglyn-plugins` still **creates** a record on every promote
and then cancels it unless the push touched `tools/plugin-loader/origin`
(AGL-1633). **Default to one promotion this session.** If a question needs a
production round trip, ship the diagnostic *and* the likely fix together rather
than taking two trips.

**A merged production PR is not a deploy.** Check containment against the sha of
the **READY** deployment, never the branch:

```bash
gh api repos/aglyn/aglyn/commits/$(git rev-parse origin/production)/status --jq '.state'
```

If that says `failure` with "Deployment rate limited", the window has not
cleared. Wait rather than merging more.

## 1. Promote — ~19 commits are queued

`origin/production` was ~19 commits behind at handoff. Most are the **other
session's** besigner/marketing/media work (AGL-1211 → AGL-1221), plus mine.
Verify the diff is what you expect, then one PR `main` → `production`, merged
(never squash).

## 2. Then verify the two things that needed a deploy

**AGL-523 — CSP.** Console defaults to report-only. Confirm:

```bash
curl -s https://app.aglyn.com/csp-check | jq            # expect nextWouldSeeNonce: false
curl -s 'https://app.aglyn.com/csp-check?csp=enforce'   # expect nextWouldSeeNonce: TRUE
```

Then **click-test an armed session** — `?csp=enforce` sets an httpOnly cookie,
`?csp=off` clears it — on the **besigner canvas** above all (realm-plugin
`blob:` imports), plus marketplace, admin and a checkout. A blank canvas is the
failure to watch for. Sign-in already verified: React hydrates, reCAPTCHA and GA
execute, 50/50 scripts nonced.

Only after that is clean, flip the default to enforcing and decide whether to go
to `strict-dynamic` or stay on `'self' https: blob:`. Then **delete
`/csp-check` and the `?csp=` opt-in.**

**AGL-1152 — cold start.** Read `preLoadBootMs` from a real cold lambda:

```
Vercel runtime logs → filter "AGL-1152:render" → the line with cold:true
```

If it comes back at several seconds, the remaining ~7.8 s is lambda
initialisation, this issue hands off to **AGL-1151** (bundle size) with a number
attached, and it can close. Local runs cannot answer this — on a long-lived
server `preLoadBootMs` also counts idle time.

## 3. Then the queue, in this order

1. **AGL-1161 — component publish fan-out.** The 50-path truncation is fixed
   (`4b1120649`). The fan-out is bigger than the issue implies: the dependency
   is **transitive** (`scanComponentUsage` returns `{type:'component'}`
   dependents that are not URLs, so it needs a closure walk that terminates on
   cycles), and `/api/hosts/where-used` caps inputs at `.limit(200)` per
   collection — tolerable for advisory "what would I break", **not** for a
   correctness path that would otherwise leave pages stale and report success.
   Do it out of band.
2. **AGL-1160 — sitemap/RSS caching.** `force-dynamic` **is** load-bearing; all
   three routes read per-request host data. Next's route cache keys on the URL,
   not headers, so option 1 means resolving the host from `searchParams` alone —
   and the middleware comment says the query is unreliable **in dev**, which is
   why the header exists. Answer that first. **Drop `robots` from scope**: it
   reads zero data, cannot go stale, and its Host-header use is what makes
   custom domains emit the right sitemap URL.
3. **AGL-1217 — publishers can request Verified.** Scoped and not started. Two
   constraints: it must **not** become a `reviewStatus` value (a listing can be
   live *and* awaiting a decision), and model it as a **record, not a
   timestamp**, so a future paid offering does not force a migration.
4. **AGL-1213 — white-label session handoff.** Design written and reviewed
   against the auth code. `signInWithCustomToken` is confirmed **not** gated by
   authorized domains (firebase-js-sdk source), so the simplification holds. One
   60-second check left: whether *"Verify the origin of reCAPTCHA solutions"* is
   unchecked on the reCAPTCHA key. If it is checked, we inherit a 250-domain
   ceiling and the design changes.

## Needs Zach, not research

- **AGL-734** — delete the stale Google Cloud DNS zone. Measured: the delegation
  moved 11 days ago, every Vercel-only record resolves, but `ns-cloud-b1` still
  answers authoritatively for `aglyn.com`. Risk is gone; it is one action in the
  GCP console.
- **AGL-1148** — commit to an uptime percentage.
- **AGL-1104** — compliance posture (SOC 2 roadmap, questionnaire responses).
- **AGL-1133 item 5** — what may a collaborator see of another member's contact
  details.
- **AGL-1132** — the console embedded checkout is behind `release_native_checkout`,
  **default off**; the storefront half is entirely undone.

## The other session

It was building the **marketing website** in this same worktree all day
(besigner, theme/palette, media refs, `tools/marketing/**`). It is **archived
now**, but **its uncommitted work may still be in the tree** — check
`git status` before assuming anything is yours.

- **Always `git commit --only <your files>`.** Something auto-stages here.
- **Never `git stash`** — read the failure instead; it names the file.
- Two of its commits cite **AGL-1213** and **AGL-1217**, which are issue numbers
  I created later the same day. Its commits predate those issues, so the git
  trail points at unrelated work. Harmless, but do not be misled by it.
- If it is running again, expect it in `libs/besigner/**`, `libs/plugins/mui/**`,
  the media picker and `tools/marketing/**`. Stay out of those.

## Lessons this session paid for

**Measure; do not reason.** Every confident inference was wrong:

- `ensureAll` was "suspect #1" for the cold start — it is 0-45 ms of a 2-5 s
  render.
- The CSP nonce "verified working live" per the issue — it reached **zero**
  scripts.
- Keeping the Verified badge through a per-version revocation "was fine because
  the bytes claim withdraws" — it did not withdraw; I had to fix that first.

**Make every control discriminate.** A REST probe for the CSP nonce returned an
identical error for the test and its control, because App Check ran first — it
proved nothing. A readiness poll accepted any `200` and was satisfied by an
`[orgSlug]` catch-all on the *old* deploy. If a control cannot fail, it is not a
control.

**A local production build reproduces more than you expect.** `nx build console`
+ serving the production configuration reproduced the whole CSP nonce bug once
the response header was set the same way — which would have saved both
production round trips, and therefore the rate limit.

**Verify the premise before doing the work.** Eight Linear issues yesterday had
premises that were already stale — the fix had shipped, or the decision was
made, and nobody updated the issue. Read the code first, every time.
