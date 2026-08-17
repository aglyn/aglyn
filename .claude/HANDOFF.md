# HANDOFF — 2026-08-15 (post-promotion, batch-5)

## ✅ READ FIRST — TWO PROMOTIONS TODAY, BOTH VERIFIED DEPLOYED

**Production: `6f5c8b52e`** — PR **#853**, direct from `main`, **18 commits**, gated at `051450a2f`,
merged (not squashed), drift **zero** at PR-create and merge. Before it, PR **#852** (61 commits,
gated at `57192ff30`, drift zero) landed `85ffedddc`. Both verified Ready on Vercel and probed live
(the cancel route answers 401 = exists + refuses unauthenticated).

**Rules deployed** from `932559b60` (AGL-1795 narrowing — staff client writes to
`plan`/`entitlements`/`releaseFlags` denied on BOTH staff branches; the org-override route is the only
writer). **Indexes deployed** from `85ffedddc`: four collection-group overrides
(`bookings.startsAtMs`, `checkouts.status`, `restockAlerts.notifiedAtMs`, `orders.paymentIntentId`)
all READY — abandoned-cart recovery, restock email and booking reminders run in production for the
first time ever. The deploy no longer deletes the live TTL policies (AGL-1801 fixed the file first).

## 🎯 TEXAS TAX IS LAUNCH-READY (verified, not assumed)

- Comptroller registration filed 08/14 (DLN 26226940010); **first taxable sales date 2026-09-01**.
  Sales & Use account EXISTS but was never linked to eSystems — assign flow needs the **Webfile RT
  number** from the mailed notice (Zach owed; or call 800-442-3453).
- **Stripe: TX registration `taxreg_1U5FqBDYHP4psn7hdEihD9lK` active.** Account default tax code is
  `txcd_10103001` (SaaS). Live calculation verified the **80% data-processing base**: $100 @ Jarrell
  (8.25%) → $6.60 tax.
- Marketplace checkout taxed (AGL-1544); self-serve taxed since AGL-1133/1537; **enterprise route
  taxed both modes + `platformRevenue/{invoiceId}` recording** (AGL-1811, `50aba4505`/`c2e24f4d0`);
  merchant manual tax now **recurs** on subscription renewals via real Tax Rates (AGL-1751).
- Live webhook endpoint `we_1TuaNvDYHP4psn7hmNkYMbEU` carries **10 events** including
  `charge.dispute.created/closed` + `charge.refunded` (reconciled via
  `setup-stripe.mjs --reconcile-events --webhook-url …` — the flag WITHOUT the URL is a silent no-op).
- Resubscribe was broken (`tax_id_collection` + existing customer 400s) — fixed `b01b5ca81`,
  reproduced against test-mode Stripe first (AGL-1823).
- **Private letter ruling request** (`Platform Docs/Legal/TX_PRIVATE_LETTER_RULING_REQUEST_…md`) is
  consistent with the verified system behaviour; needs Zach's read-through + signature, exhibits,
  send to tax.help@cpa.texas.gov. Position: data processing, 80%; interim = collect at 80%, Aglyn
  eats any shortfall if ruled otherwise.
- `platformRevenue` must stay OUT of the GDPR erasure sweep (statutory retention).

## OWED TO ZACH (only he can)

1. **AGL-1548** — no real paid marketplace purchase has ever completed. Tax is now verified
   end-to-end; this is the last gap before a real sale.
2. **Webfile RT number** → finish the eSystems assign + the AGL-1812 amendment (NAICS→513210 per
   Zach; mailing/officer addresses → registered agent; outlet address stays).
3. **AGL-1821** — attach tax rates to EXISTING live merchant subscriptions (raises what customers pay).
4. **AGL-1794** — who eats a lost dispute on destination charges (policy + merchant agreement).
5. **AGL-1620** — E2ETEST100 drill expires **2026-08-21**. AGL-1617/1533 launch runbook.
6. Ruling signature (above). Post-deploy staff smoke for AGL-1795 (staff `setDoc` of `plan` refused).
7. **AGL-1777** — `main`/`production` have NO branch protection; force-push to production possible.
8. NX CI stays `disabled_manually` by Zach's decision (AGL-1776). `firebase-hosting-pull-request.yml`
   also disabled — **no workflow builds PRs**. Six gates (typecheck, generated-file checks,
   revenue-truth, app-router-graph, nx affected) still run nowhere; moving them = re-enable decision.

## ACTIVE WORKFLOWS (all fault-injected, all can fail)

`rules-drift.yml`, `index-drift.yml` (TTL-aware — the naive field filter MISSES TTL policies and
would tell you to run the deploy that deletes them), `tools-guards.yml` (7 pure-node guards),
retired-colour census + self-test. eslint now applies 72 rules to 193 `.mjs` files that had ZERO
(`scopeTo()` had overwritten the preset's glob — every prior "eslint clean" on tools/ was vacuous).

## GATE RECIPE THAT ACTUALLY WORKS

Isolated worktree at `/private/tmp/aglyn-gate/wt` — OUTSIDE the shared scratchpad (a session's
scratchpad is shared and an agent deleted the gate worktree from it once). Real `node_modules`
(APFS clone `cp -Rc`; a symlink breaks Turbopack), `npm ci --prefix apps/docs` AND
`--prefix cloud/functions` (two standalone packages), private npm cache (shared `~/.npm` races to
exit 243 while a pipe shows 0), `NX_DAEMON=false`, exit codes to files, and END with a deliberate
cross-project import proving `@nx/enforce-module-boundaries` fires (`run2.sh` there does all this).
TWO nx processes in one checkout rmSync each other's `dist` — never run `nx run-many --all` in the
shared checkout while agents work.

## STANDING RULES (unchanged, still binding)

Push to `main` immediately; batch ONLY production PRs; PR `main`→`production`, real merge commit,
never squash, no intermediate branches; promotion needs Zach's word; verify deployed (Vercel CLI
prints its table to STDERR — `2>/dev/null` eats it). `--only` explicit paths; never `add -A`/stash/
amend; this environment AUTO-STAGES new files. Never swap a shared file to prove a red. localhost
Stripe key is LIVE. Firestore: `undefined` rejected; `update()` NOT_FOUND vs `set(merge)` conjures;
`.doc('')` throws sync, reserved ids fail at the SERVICE; import shared helpers from the LEAF (specs
mock barrels). Test doubles must model real semantics. Decompose every red/green count. Confirm
Linear ids via `get_issue` BEFORE citing (three agents wrote predicted ids this week).

## IN FLIGHT AT HANDOFF (check `git log` — they may have landed)

Order-dialog cluster (AGL-1806 restock answer / AGL-1820 refund-guard UI / AGL-1810 drawer wording),
AGL-1813 (billing-staff writable keys per-key analysis), AGL-1807 (buy-now stock decrements skip the
inventoryAdjustments ledger), AGL-1725 (28 tenant image sinks → the allowlist AGL-1726 needs).
Queued next: AGL-1819 (fulfill/delivered client writes — same stale-dialog shape as the cancel fix,
routes first, rules last).
