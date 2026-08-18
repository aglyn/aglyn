# HANDOFF — 2026-08-18 (the /release push, wave 1–3)

## ✅ READ FIRST

`main` is at **`3d87e0817`**, everything pushed, tree essentially clean. `origin/production` trails
main by the night's work — **no promotion has run yet this session**. Rules / indexes / TTL drift are
all **zero** (checked this session): live matches HEAD on firestore, storage and RTDB; 43 composite +
19 field overrides match. `check:legal-drift` still reports **8 DIFFERS** — that is the Google-Docs
side being stale (AGL-1647), not a live-page defect.

## ⚑ ZACH PRE-AUTHORIZED BATCH PROMOTIONS FOR THIS PUSH

Asked and answered 2026-08-17: gate each batch in the pinned worktree, open the main→production PR,
real-merge, verify DEPLOYED, run stacked deploys from the promoted SHA, report evidence after.
**Scoped to the Sept-1 release push only** — the default (`no-auto-production-pr`) resumes after
launch. Every other promotion rule still binds: gate first, batch, never squash, verify deployed.

## ⚑ FOUR ZACH DECISIONS MADE THIS SESSION — the long form is in Linear, the durable copy in memory

1. **AGL-1775 POS register add-on → ENFORCE PER-HOST** (he passed on the free re-document option).
   `seatAddons.posRegisters` becomes an org pool each host draws from. **First task is a production
   query**: orgs with `posRegisters > 0` AND multiple hosts running registers. Empty set (likely,
   pre-beta) ⇒ ships clean, no grandfathering, no comms. /pricing copy (AGL-1279) must match.
2. **Org-library storage → BILL FROM TODAY, but with overage protection + usage alerts** — his words,
   "so customers don't get a surprise bill". **AGL-1886.** Not retroactive. ⚠️ The existing
   `usage-alerts` route reads HOST counters only, so an org over allowance purely in the org library
   is *structurally unwarnable* — fix that read BEFORE billing turns on, or the alert reads as
   coverage while being unable to fire.
3. **AGL-1794 lost disputes → THE MERCHANT EATS IT.** Reverse the transfer on
   `charge.dispute.closed` + `status:'lost'` ONLY. Marketplace half landed (`ed458b73e`, AGL-1554);
   commerce merchant-notification landed (`3ed5751b9`). **The merchant-agreement clause is the
   critical path** and is in the legal batch. `on_behalf_of` deliberately NOT taken.
4. **The legal publication batch publishes WITHOUT his review** (he waived it), and the first nonzero
   marketplace purchase runs **"Zach drives, Claude stages"** — stage to the Stripe pay step, he
   clicks Pay, then verify split/refund/payout legs.

## LANDED THIS SESSION (verify, don't trust — every one of these is a claim)

- `a9870b71d` **AGL-1873 — the best find of the night**: draft orders and reservation deposits were
  the only session-creating commerce routes that never re-asked the org's plan. A free or lapsed org
  kept both doors open, and both price `application_fee_amount` through `resolveTransactionFeePct`,
  which is **0% on free** — those sales paid Aglyn nothing.
- `ae217fba3` + `3d87e0817` **AGL-1860 Aglyn Assist phase 1** — docs-grounded in-console helper.
  Verified this session: `release_assist` `defaultEnabled: false`, panel returns null when not
  visible, loading state fails SAFE (hidden). **The flag must not flip until the privacy disclosure
  publishes** (it is section 2 of the legal batch).
- `e3dcc8f7d` + `a09a1cc64` **AGL-1863** retention funnel (survey → downsell → bounded winback) and
  its reachability; `64482fca6` **AGL-1862** end-of-cycle downgrades / instant upgrades.
- `c1b313190` **AGL-1811** — a quarterly TX return is computable (`GET /api/admin/tax-return`), and
  `platformRevenue` now has a real erasure tripwire (emulator spec runs a live `eraseOrg`).
- `78b342581` **AGL-1872** — GA4 purchases were reported tax-INCLUSIVE; post-tax-launch that books
  the Comptroller's money as revenue. Now netted, refunds scale exactly.
- `57131598e` deepmerge-ts 7→8 (**AGL-1861**), verified in an isolated worktree against all five v8
  breaking changes. ⚠️ It taught a lesson: the shared checkout's working tree still held the PRE-bump
  `package.json` with `node_modules` on 7.1.5 — agents were about to test a tree that didn't match
  itself. **After any dependency merge, reconcile the shared checkout.**

## SMOKE SWEEP — 40 of ~137 processed, 29 Done, 0 broken fixes found

Batches 1 and 2 finished (12/20 and 17/20 Done). The `awaiting-smoke` pool was **~137, not the 78**
the old handoff claimed — never trust a written-down count. Blocked remainders name their exact
unblocker. Batches 3 (AGL-1324…1375) and 4 (AGL-1283…1323) were interrupted by API limits and need
re-running; batch 3 had reached AGL-1374.

## 🚨 THE OPERATIONAL LESSON OF THIS SESSION: COMMIT EVERY PIECE IMMEDIATELY

Two full agent waves were killed mid-flight by API limits (a Fable-5 tier limit, then a session limit
resetting 11:30pm CDT). **Wave 2 lost nothing that mattered because every agent had been ordered to
commit and push each coherent piece rather than batch to the end** — five commits were already
banked when they died. Wave 1 lost a completed 20-issue Linear pass because it held results in
context. Give every agent that instruction verbatim; it is the difference between a survivable
interruption and a lost hour.

Recovery recipe that worked: unique local commits pushed via a temp worktree cherry-pick (the shared
tree was too dirty to rebase), then `git reset --mixed origin/main` to dedupe patch-identical
commits while preserving the working tree.

## ZACH-ONLY (surfaced, not blocking)

1. **~5 minutes of on-device checks** closes three issues: AGL-1417 (cancel a passkey sign-in),
   AGL-1416 (SSO from the normal multi-account Chrome profile), AGL-1415 (Google account chooser).
2. **AGL-1548** nonzero legs — the $0 drill is DONE; what remains is card capture → 80/20 split →
   refund → payout, staged for his click.
3. **AGL-1620** E2ETEST100 drill coupon expires **2026-08-21**.
4. Ruling signature (`Platform Docs/Legal/TX_PRIVATE_LETTER_RULING_REQUEST_…md`); §151.0242 publisher
   certification text before the first real plugin sale.
5. Webfile **RT974186** is assigned (2026-08-17) — the mailed-notice dependency is CLEARED. Residual:
   confirm on the next correspondence whether the *officer* mailing address got the RA swap (AGL-1812).
6. AGL-1506/1573 need a drill API key only he can mint; AGL-1133 needs the 07-31 roster ratified.
7. **AGL-1777** — `main`/`production` have NO branch protection. NX CI stays `disabled_manually`
   (AGL-1776); no workflow builds PRs.

## STANDING RULES (unchanged)

Push to `main` immediately; batch ONLY production PRs; real merge commit, never squash, no
intermediate branches; verify deployed (Vercel CLI prints to STDERR). `--only` explicit paths; never
`add -A`/stash/amend; this environment AUTO-STAGES new files, and `--only` bounds the file LIST, not
the lines — check `git diff` per file for other agents' work. Never swap a shared file to prove a
red. Never format a shared checkout. localhost Stripe key is LIVE. Two nx processes in one checkout
rmSync each other's `dist` — single-project runs only. Firestore: `undefined` rejected; `update()`
NOT_FOUND vs `set(merge)` conjures; converters run on PARTIAL writes. Test doubles model real
semantics. **Make every guard fail on purpose.** Decompose every count. Confirm Linear ids with
`get_issue` BEFORE citing.

## GATE RECIPE

Isolated worktree at `/private/tmp/aglyn-gate/wt` — OUTSIDE the shared scratchpad. Real `node_modules`
(APFS clone `cp -Rc`; a symlink breaks Turbopack), `npm ci --prefix apps/docs` AND
`--prefix cloud/functions`, private npm cache, `NX_DAEMON=false`, exit codes to files, and END with a
deliberate cross-project import proving `@nx/enforce-module-boundaries` fires. The gate must run
tests AND lint, not just build.

---

## ⚑ Session close 2026-08-18 — read this before spawning anything

### Zach decisions captured this session (act on these, they are not open questions)

- **The business phone is `512-222-8232`** — the Google Voice line, NOT his personal cell
  `(737) 600-6900`, which must never reach a public record. Readable directly from Google Voice under
  Google account slot **`/u/4/`**; do not ask him for it again. This unblocks AGL-2035 (`/legal/dmca`
  publishes no phone → §512(c)(2) non-compliant) and the designated-agent filing.
- **The DMCA filing is at <https://dmca.copyright.gov>** — account, $6, 3-year term. Every value to
  type is assembled on AGL-1983. Zach's part is account creation, the attestation checkbox and
  payment; an agent can drive the three form pages from there.
- **Approved: delete the five test-mode `stripeEvents` rows** from production. Verify each id against
  the TEST key before deleting (that is the check that can fail); the guard half of AGL-2040 is a
  separate agent's — do not touch the webhook code.
- **Shared env before project env, always.** `vercel env ls` cannot see team-shared vars; a shared var
  must be LINKED, never duplicated at project scope. Zach caught exactly that shadowing on the GA4
  vars earlier today.

### ⚠️ Do not lose: `.claude/commands/release.md` now carries the RESTATED mandate

Commit `3695fc02d`. Zach restated the full directive on 2026-08-18 and it **grew** — seven new
directives, most notably the **free/hobby tier hard cap**, **usage alerts + budgets modelled on Google
Cloud**, **self-host polish with branding/identity moved to env vars**, **enterprise/agency white-label
audit**, and **"a capability is not a feature until the console exposes it."** The 2026-08-17 version was
summarised once and lost a directive; the block is verbatim now and each phrase was grep-verified.
Never paraphrase it.

### Push discipline that mattered

`git push` was rejected (main moves constantly) and `git rebase` refused because other agents hold
dirty files. **Do not stash and do not autostash** — the working answer was a detached worktree at an
absolute `/private/tmp` path, cherry-pick, push, then `git reset --soft origin/main` to realign local
main without touching the index or anyone's worktree. Confirm the blast radius with
`git show --stat` afterwards, every time.

### Still in flight at session close — reconcile before assuming any of it landed

Six background agents were mid-run: the promotion gate on a ~10-commit batch (contains the **live
Billing fix**, AGL-1991 — billing was broken on every org in production), marketing authoring (blog
link + TikTok), the permissive catch-all (AGL-2038), the livemode guard (AGL-2040), self-host
DMCA/operator identity, and the shared-env + `stripeEvents` cleanup agent. **Re-derive their state from
git and Linear — do not trust this list as an outcome.** Roughly 13 held commits sit across 7 worktrees
awaiting the current promotion.
