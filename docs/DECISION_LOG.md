# Decision Log

The record of **pricing, packaging and policy decisions that bind code** — who
decided, when, and what evidence proves it. Append-only, newest first.

It exists because the change-control rule had nothing behind it. The rule in
`00-Pricing-Source-of-Truth` says a price or entitlement change must move
*together* across six places, the last being the Pricing Decision Log — and for
nine days nothing enforced that, so the whole retention/packaging arc
(AGL-1859 / AGL-1862 / AGL-1863) landed with no entry naming any of it
(AGL-1908). Worse, on 2026-08-24 the unenforced rule started **blocking real
work**: an agent found a live entitlement leak and declined to close it partly
because "AGL-1908's change-control rule requires publication legs I cannot do",
with no artifact anywhere saying what had already been decided.

---

## Repo or Drive — which half is which

Two documents, one decision. Get this backwards and you will either edit the
wrong copy or trust a green check that never looked at anything.

| | This file (`docs/DECISION_LOG.md`) | `Platform Docs/Pricing & Packaging/05-Pricing-Decision-Log` |
|---|---|---|
| Lives in | the **repo** (public) | **Google Drive**, shared drive |
| Holds | the index: decision, date, decider, evidence, scope | the full record: reasoning, arithmetic, alternatives considered, blast radius |
| Authority for a **pricing** decision | ❌ — points at Drive | ✅ **source of truth**, gdoc-first |
| Read by CI | ✅ `npm run check:decision-log` | ❌ — CI has no Drive credentials |
| Covered by `check:no-tax-identifiers` | ✅ | ❌ — it scans **tracked git files** and nothing else |

**Consequences worth stating plainly:**

* **Drive is outside every repo guard.** `check:no-tax-identifiers`,
  `check:contact-addresses`, `check:brand-literals` — all of them sweep
  `git ls-files`. Nothing on the shared drive is scanned by any of them.
* **This repo is PUBLIC.** No taxpayer numbers, account identifiers, keys or
  personal data in a file **or in a commit message**. The guard reads files
  only; a commit message had to be rewritten on 2026-08-24 before it was
  pushed. Sensitive identifiers live in Linear or Drive, never here.
* **gdoc-first** for anything that is also published: write the Drive document
  and the published page first, then bring the repo into line. Never the
  reverse. Same rule the legal documents run on
  (`apps/console/constants/legal-documents.ts`).
* Anything scoped `pricing` in this file **must** exist as a same-dated entry in
  the Drive log; `check:decision-log` asserts it whenever Drive is mounted, and
  says so out loud when it is not.

---

## The change-control rule, and what actually enforces it

Verbatim from `00-Pricing-Source-of-Truth` → "Change-control rule":

> Any price or entitlement change must move **together** across:
> `PLAN_PRICING` / `PLAN_ENTITLEMENTS` (code) → `setup-stripe.mjs` re-run
> (Stripe live + test) → Figma "Pricing · Demo · Sales" → `aglyn.com/pricing`
> **(hand-authored — must be edited)** → this doc + the Decision Log.

| Leg | Enforced by | Notes |
|---|---|---|
| code ↔ the locked pin ↔ Stripe live | `npm run check:pricing-drift` | the `LOCKED` pin is a second, deliberate copy |
| the generated `/pricing` compare table | `npm run check:pricing-tables` | plus `apps/console/specs/published-pricing-table-parity.spec.ts` |
| **a decision is on record** | **`npm run check:decision-log`** | this file; the leg AGL-1908 was filed about |
| `setup-stripe.mjs` | ⛔ **nothing** | a hand-maintained fourth copy of the price set |
| Figma "Pricing · Demo · Sales" | ⛔ **nothing** | frame `92:107` is known stale — see 2026-08-18 below |
| `aglyn.com/pricing` | ⛔ **nothing automatic** | hand-authored besigner content on the `aglyn-marketing` host; AGL-1885's pass runs against the **live page after** a republish |

`check:decision-log` compares the **parsed values** of `PLAN_PRICING`,
`PLAN_ENTITLEMENTS`, both metered rate tables, `METERED_MARKUP` and the two
add-on constants between `origin/production` and the working tree. If any of
them moved and this file did not move with them, it exits 1 and names the keys.
Comments and refactors move freely — a path-level guard would have demanded a
pricing decision for `d393d34a9`, a docblock, and a guard people route around is
worse than none.

**To add an entry:** copy the shape below. All three fields are required and the
guard refuses an entry missing any of them — *"Decided by"* is what separates a
decision from an opinion, *"Evidence"* is what lets the next reader check it
rather than believe it, and a log that records a **guess** as a decision is
worse than no log.

```md
## YYYY-MM-DD — one line saying what was decided

- **Decided by:** who, when, and how they were asked
- **Scope:** pricing | packaging | policy | legal | tax | commerce (comma-separated)
- **Evidence:** commit SHAs, file paths, Linear ids
```

⚠️ Recording a decision here **is not** deciding one. Nothing in this file may
introduce a price or an entitlement the account owner has not chosen.

---

## 2026-09-11 — The CRM is paid-only: every section locks on Free, and the whole CRM opens from Starter

- **Decided by:** the account owner, 2026-09-11 — the CRM is for paying subscribers and no part of it is on Free, one gate in place of a view-only Leads mode; beta.118 held until it ships. Supersedes the 2026-09-10 entry below (Free opens on Leads, view-only), which never shipped, and the 2026-09-05 line that Free keeps the contacts list.
- **Scope:** pricing
- **Evidence:** `featureFlag: 'crm'` on the CRM console extension in `libs/plugins/crm/src/lib/plugin.ts`, composed into every section's lock by `resolveHubSections` in `apps/console/utils/plugin-hub-sections.ts` and drawn beside the shell's upgrade notice by `apps/console/components/plugin-hub-rail.component.tsx` (`libs/plugins/crm/src/lib/plugin.spec.ts`, `apps/console/specs/plugin-hub-sections.spec.ts`); every `crm/*` route refusing 403 `plan_required` / `crm` after authorization through `libs/plugins/crm/src/lib/server/suite-gate.ts`, with capture, `crm/erase-person` and the contacts and leads files of `/api/crm/export` exempt (`company-delete.spec.ts`, `contact-email-history.spec.ts`, `org-activity.spec.ts`, `recipe-routes.spec.ts`, `apps/console/specs/crm-export-is-complete.spec.ts`); `contacts` joining the CRM resources of `/v1` in `apps/console/utils/api-v1-resources.ts` (`api-v1-crm-resources.spec.ts`); client creates and updates of a lead, a contact and a segment asking `orgCarriesCrmSuite` in `cloud/firebase-firestore.rules` (`cloud/rules-tests/firestore-rules.test.mjs`, `crm-suite-rules-drift.spec.ts`); Settings → Privacy exporting contacts and leads and filing an erasure by address on every plan (`apps/console/components/settings/org-privacy-card.component.tsx`, `org-privacy-card.spec.tsx`, `libs/plugins/crm/src/lib/server/erase-person.spec.ts`); `tools/e2e/crm-free-plan.e2e.mjs`; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2851, AGL-2839.

**No price, band or cap moves.** What moves is what a Free workspace reaches: no part of the
CRM. On Free every CRM section — Leads, Contacts, Companies, Deals, Tasks, Reports, Fields and
Settings — is drawn locked beside the upgrade notice, a bare `/crm` shows that notice, and every
CRM read and write is refused in the console, its routes, `/v1` and client writes
(`plan_required`, code `crm`), staff included. Starter and above with a live subscription get
the whole CRM. Capture is unchanged and does not depend on the plan. Exporting everyone a
workspace holds and erasing a person stay on every plan, outside the CRM, in Settings → Privacy.
Free's hard 100-record band still caps capture; the records overage ladder, the one-to-one email
caps (Free 0) and `release_crm` on for every workspace are unchanged.

---

## 2026-09-10 — On Free, the CRM opens on Leads, read-only; Contacts join the suite from Starter

- **Decided by:** the account owner, 2026-09-10, answering AGL-2790 — on a plan without the CRM suite the people a site captures are leads to read rather than contacts to edit; asked to choose, Leads view-only with Contacts locked, and beta.118 held until it ships. Supersedes the 2026-09-05 line that Free keeps the contacts list.
- **Scope:** pricing
- **Evidence:** `CRM_CONSOLE_SECTIONS` in `libs/plugins/crm/src/lib/components/crm-console-sections.ts` (Contacts declares `featureFlag: 'crm'`, Leads none) with the rail-by-plan cases in `apps/console/specs/plugin-hub-sections.spec.ts`; the read-only Leads section, lead page, bulk bar and activity log in `leads-section.tsx`, `lead-properties-card.tsx`, `lead-detail-page.tsx`, `leads-bulk-bar.tsx` and `record-activity-card.tsx`, with their specs; `crm/contact-update` refusing every field in `libs/plugins/crm/src/lib/server/contact-update.ts` (`contact-update.spec.ts`) and `/v1/contacts` creates, updates and merges in `apps/console/utils/api-v1-resources.ts` (`api-v1-contact-crm-fields.spec.ts`, `api-v1-contact-merge.spec.ts`); the leads block of `cloud/firebase-firestore.rules`, where create, update and delete ask for the suite (`cloud/rules-tests/firestore-rules.test.mjs`); `submissionFilesLead` in `libs/aglyn/src/lib/app-utils/form-lead-routing.ts` (`apps/tenant/specs/form-submit-free-plan-leads.spec.ts`); `tools/e2e/crm-free-plan.e2e.mjs`; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2790.

**No price, band or cap moves.** What moves is what a Free workspace reaches in the CRM.
Leads is the one section it opens: the list, a lead's page, export and erasure, and no
edit of any kind. Contacts, Companies, Deals, Tasks, Reports, Fields and Settings are
locked, and every contact edit and every lead write is refused by the routes and the
rules. Every live form on a plan without the suite is a lead surface, asked at capture
time of the org's effective plan, so what a Free site captures lands where Free can see
it; paid plans keep per-form lead routing. Free's hard 100-record band, the records
overage, the one-to-one email caps, and export and erasure on every plan are unchanged.

---

## 2026-09-10 — The CRM opens to every workspace, and its release flag is renamed `release_crm`

- **Decided by:** the account owner, 2026-09-10 — release the CRM in this promotion, and name its flag for the whole hub rather than its first section. Lifts the 2026-09-07 hold on the flag; AGL-2680, the precondition this log attached to the flip, was settled 2026-09-08.
- **Scope:** pricing
- **Evidence:** `RELEASE_FLAGS` in `libs/aglyn/src/lib/app-utils/release-flags.ts` (`release_crm`, `defaultEnabled: true`) and `cloud/firebase-remoteconfig.template.json` (`"enabled":true`), held together by `release-flags-template.spec.ts`; the Remote Config template published at the promotion (`release_crm` on, `release_contacts` removed); the `release_contacts` entry dropped from `apps/console/constants/docs-release-flags.ts` and the rolling-out disclosures taken down from the six pages it watched, as `docs-release-flags.spec.ts` requires of a flag that is on; production read at the flip — 12 organizations, no September rollup past its records band, `contactsOverageWithheldUsd` 0 on every one; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2772.

**No price, band or cap moves.** The records overage `report-usage` withheld while the
flag was off now reaches the invoice of any paid organization past its band — none is,
so the flip bills nothing today. The daily digest, task reminders and inbound filing
now send for organizations whose plan carries the suite, and a non-staff member can
export. A staff override can still hold one organization off, and that organization's
overage stays withheld. Earlier entries keep the name `release_contacts`, the flag's
name when they were written.

---

## 2026-09-09 — The bandwidth conversion is re-paired with the re-pegged rate: a GB is 1,035 page views, not 1,748

- **Decided by:** the account owner, 2026-09-09, on the standing instruction that neither a monthly nor an annual plan may put the platform under water at any utilization. Re-pair the two constants; do not touch a price or a band.
- **Scope:** pricing
- **Evidence:** `ESTIMATED_PAGE_TRANSFER_BYTES` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts` `600 * 1024` → **`1012.8 * 1024`**, the same basis `METERED_UNIT_RATES_USD.perPageView` and `ORG_COGS_UNIT_RATES_USD.perPageView` are calibrated against and the same `pricedForKb` recorded in `tools/tenant-page-budget.json`; a new pairing comparison in `tools/scripts/lib/page-view-rate-calibration.mjs` (`conversionMispriced`) reported by `npm run check:page-view-rate`, with forced reds in both directions and a positive control in `page-view-rate-calibration.test.mjs`; margins re-pinned in `apps/console/specs/tier-margin-floor.spec.ts` (53/53) and the unpaired ladder pinned there as a mutation; `check:page-view-rate`, `check:pricing-drift` and `check:pricing-tables` green; no `PLAN_PRICING` and no `PLAN_ENTITLEMENTS` value moved; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2712.

**No charged price moves and no band moves.** What moves is the number of page
views a gigabyte of included bandwidth converts to, and the customer-facing
consequence is stated plainly below.

**The defect.** `perPageView` is what a page view costs and
`ESTIMATED_PAGE_TRANSFER_BYTES` is what the same page view weighs. They are one
physical measurement in two units, and a `bandwidthGb` band is priced by
neither alone but by their quotient — `(1 GB ÷ bytes) × dollars`, the cost of a
gigabyte. A heavier page costs more per view and buys fewer views per gigabyte;
the two are supposed to cancel. The re-peg earlier the same day moved only the
first, so the page's weight was counted twice:

| | cost of 1 GB of included bandwidth |
|---|---|
| 600 KB at $0.0001 — what the 2026-09-07 bands were sized against | $0.17476 |
| 600 KB at $0.00016153846 — the unpaired state | **$0.28231** (×1.615) |
| 1012.8 KB at $0.00016153846 — paired | **$0.16724** (×0.957) |

At $0.28231 every paid tier read negative at 100% of every band, at the annual
price net of Stripe: Starter -3.6%, Pro -34.1%, Business -19.8%, Scale -16.6%,
Advanced -11.1%, Agency -14.3%. That was a modeling error and not an economic
one — no page, price or band had changed — and it is why **no band was cut a
second time**. Cutting one would have taken allowance away from customers to
pay for a bug.

**The ladder, at 100% of every band, net of Stripe.** Annual and monthly, after
the pairing:

| Plan | Annual, before | Annual, after | Monthly, after |
|---|---|---|---|
| Starter | -3.6% | **+32.3%** | +54.6% |
| Pro | -34.1% | **+2.8%** | +30.9% |
| Business | -19.8% | **+1.7%** | +28.9% |
| Scale | -16.6% | **+2.0%** | +28.6% |
| Advanced | -11.1% | **+2.2%** | +25.9% |
| Agency | -14.3% | **+2.6%** | +20.7% |

At the 25% utilization the 2026-09-07 resize was argued on, the annual ladder
reads 73.2–80.8% and clears the 75% contribution floor at the per-site COGS
figure every production org actually carries. The floor is not a claim about
100% of every band at once: that is a ceiling, and the rule there is zero.

**100% is the worst case, and that was checked rather than assumed.** Past a
band every axis either bills above cost or refuses: page views, storage and
form submissions meter at cost × 1.3 on every paid plan; contacts, campaign
email, dataset storage, API requests and assist credits carry retail overage
rates above their modeled cost; workflow and action runs have no rate and are
walled before the run; seats and the one-to-one email cap are hard bands. The
bandwidth abuse ceiling does not open a hole — on a metered plan it flags and
escalates without degrading the render, and the traffic keeps billing. No
self-serve tier carries an `UNLIMITED` cost band; Enterprise's every band has
been a finite fallback since 2026-09-07.

**The customer-facing consequence, stated plainly.** The gigabyte bands are the
promise and none of them moved. What moved is the page-view allowance behind
them, which falls **40.75%** because each view is now accounted at 1012.8 KB
instead of 600 KB:

| | included page views, before | after |
|---|---|---|
| Free 2 GB | 3,495 | 2,071 |
| Starter 50 GB | 87,381 | 51,766 |
| Pro 125 GB | 218,453 | 129,415 |
| Business 185 GB | 323,311 | 191,535 |
| Scale 290 GB | 506,812 | 300,244 |
| Advanced 345 GB | 602,931 | 357,187 |
| Agency 1,540 GB | 2,691,345 | 1,594,399 |

**Yes, a customer can see less than before, and it is the correction rather
than a take-back.** A Pro site between 129,415 and 218,453 views a month now
begins paying the $0.21/1,000 pass-through where it previously did not. Before
this change the meter granted 1.69× the bandwidth the GB label sold: those
218,453 views of a 1012.8 KB page are about **211 GB** of real traffic against
a 125 GB label, because the band was divided by a page weight the platform
stopped serving months ago. The label was the promise, and the label
is now true. The same conversion runs the other way on the console meter and
the usage-alerts cron, so the same traffic renders as more gigabytes than it
did yesterday: the traffic did not change, the accounting figure did.
`apps/docs/.../billing-and-plans/bandwidth.md` carried the old figure as a
published billing convention and says all of this now.

The derived protections move with it, in views, and are unchanged in
gigabytes. Free's cap still engages at 1× its 2 GB band, which is 2,071 views
rather than 3,495. The abuse ceiling is still 3× the band — Starter 155,299
views, Agency 4,783,196 — and still floors at 100,000 views, which is now 96.6
GB rather than 57.2 GB and therefore a slightly larger give on Free.

**What stops it recurring.** `check:page-view-rate` now recovers a page weight
from each of the two constants and refuses them if they differ by more than a
tenth of a KB, printing the cost of a gigabyte both ways. It lives in that gate
rather than in a new one deliberately: that is the gate a re-peg has to turn
green, and a separate script is one more thing a rate change can ship without
running. Mutating either constant alone exits 1 with the two weights named.

---

## 2026-09-09 — The page-view rate is re-pegged to a 1012.8 KB page: $0.13 → $0.21 per 1,000

- **Decided by:** the account owner, 2026-09-09, asked whether the weight reduction had closed the gap or whether the re-peg held over from earlier the same day was now owed. Re-peg, and set the basis above the measured page so the next correction is downward.
- **Scope:** pricing
- **Evidence:** `METERED_UNIT_RATES_USD.perPageView` and `ORG_COGS_UNIT_RATES_USD.perPageView` both 0.0001 → **0.00016153846**; published `$0.13 / 1,000` → **`$0.21 / 1,000`**, regenerated into `tools/marketing/pricing-copy/tables.json`; `tools/tenant-page-budget.json` `wireCalibration` now `pricedForKb` 1012.8, `measuredKb` 976.1, `acceptedWeightRatio` 0.9638 against a 0.96376 actual (both re-measured hours later — see the amendment below); `npm run check:page-view-rate`, `check:pricing-drift` and `check:pricing-tables` green; the Sept-1 pin in `tools/scripts/check-pricing-drift.mjs` moved with the decision; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2711.

**A charged price moves.** This is a customer-facing increase on one metered
line: every 1,000 page views past a plan's included band bills $0.21 instead of
$0.13, a 61.5% rise on that line. It touches no plan price, no other meter and
no included band.

**Why now.** The standing 2026-08-30 rule was to reduce the page weight rather
than reprice the promise, and the entry above this one held the re-peg for
exactly that reason. The reduction has since landed and shipped in
v1.0.0-beta.103 — the route's eager first-paint JavaScript fell 410.4 → 255.3 KB
gzip — and a fresh measurement says the page is still far above the 627 KB the
rate was calibrated for. The condition that decision set is met, so the hold
expires with it.

**The measurement.** Taken 2026-09-09 against production, playwright-core
driving Chrome Beta 154 headless, a fresh browser context per run, no scroll,
settling until the network went quiet, counting first-party `encodedBodySize` as
served:

- **976.1 KB** on the recorded basis — document, script and images — stable to
  0.0 KB across three runs at 2560x1209 and two at 1280x720.
- A control run on the PREVIOUS build with the same instrument read
  979.7–1001.8 KB against the 1010.3 KB recorded from that build by a different
  instrument, so the instrument reproduces the recorded basis within ~3% and the
  drop is the page rather than the tooling.
- Split at first contentful paint, the same load is **122.6–158.2 KB up to FCP**
  and **1012.9 KB at settle** across 80 requests. The basis previously recorded
  as "first paint" is in fact the settle figure, and it is settle that the rate
  must price: every visitor pays it.
- The eager route chunks fell 410.4 → 255.3 KB gzip while the settle total
  barely moved, because much of the reduction was `next/dynamic` **deferral**
  rather than deletion. The bytes still arrive. That is the reason the peg is
  taken against settle and not against the route's own chunk total.

**Why the basis is 1012.8 KB and not 976.1.** The basis is set deliberately
ABOVE the measured page, so the meter prices 1012.8 KB against a page weighing
976.1 — a ratio of 0.9638. Charging under cost can only be corrected by charging
more, which is a price rise; charging slightly over can be corrected by charging
less, which is not. The headroom buys the room to move in the easy direction.
1012.8 KB is also the weight at which the published figure lands on a round
$0.21 per 1,000 at the unchanged per-KB cost the 2026-08-09 calibration fixed —
the cost model did not move, only the weight it is applied to.

**The gap is closed, and the guard now says so.** `check:page-view-rate` was
built to hold an under-priced rate at the size it was last reviewed at, and its
`acknowledgedShortfall` recorded a ratio of 1.62. That field is gone. Its
replacement, `acceptedWeightRatio`, is refused above 1: the state where the rate
prices less page than it serves cannot be re-entered by editing a number in a
JSON file, and a page that grows back into the headroom is red before it gets
there.

**Amended the same day: the page fell to 748.5 KB and the rate stayed.** Hours
after this decision the deferral work in AGL-2710 shipped and a re-measure on
the same instrument read **748.5 KB**, putting the 1012.8 KB basis 35% above the
page rather than 3.6% above it. The owner reviewed the new figure and kept
$0.21, on the reasoning recorded above — it is easy to charge less later and
hard to charge more — and on the observation that repricing twice in one day is
the churn measure-once-price-once exists to prevent. No rate moved and no band
moved; `measuredKb` is 748.5 and `acceptedWeightRatio` 0.7391 against a 0.739040
actual.

What the surplus costs is recorded rather than left to be rediscovered: at
748.5 KB the true cost is $0.000119378 per view, so the billed rate is 1.76x
true cost against a published claim of 1.30x. That is the argument for lowering
it once the page settles, and lowering is margin-neutral because
`ESTIMATED_PAGE_TRANSFER_BYTES` is the paired half (AGL-2712).

---

## 2026-09-09 — The page-view rate is re-measured at 1010.3 KB and deliberately not re-pegged

- **Decided by:** the account owner, 2026-09-09, asked whether to correct `perPageView` now that the measured page is 1.61x the weight it is priced for. Hold the price and reduce the weight instead, per the standing 2026-08-30 rule.
- **Scope:** pricing
- **Evidence:** re-measured on production v1.0.0-beta.101 — `aglyn.com/` at first paint is 1010.3 KB of first-party encoded bytes in a visible signed-in tab at 2560x1209, corroborated at 1006.1 KB in an anonymous context, cross-route RSC prefetch excluded; recorded in `tools/tenant-page-budget.json` with `measuredKb` 1010.3, `sourceGraphBytes` 1304783 and `acknowledgedShortfall` 1.62 against a 1.6113 actual; `npm run check:page-view-rate` green; `METERED_UNIT_RATES_USD.perPageView` and `ORG_COGS_UNIT_RATES_USD.perPageView` both still 0.0001 and `/pricing` still states $0.13 / 1,000; margins re-pinned in `apps/console/specs/tier-margin-floor.spec.ts`; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2706.

**No charged price moves.** What moves is the record. The rate has been priced
for a 627 KB page since it was calibrated; the page is 1010.3 KB, so the meter
runs at roughly -19% margin against the published $0.13 / 1,000.

The re-peg was computed and held: cost $0.000161, published $0.2093 / 1,000.
Shipping it now would be a customer-facing price change that a successful page-weight
reduction — in progress — would immediately have to walk back. Re-peg only if that
reduction lands and the page is still over 627 KB, and then measure once and price once.

Two findings worth carrying forward:

- **Composition changed more than size.** The old basis was 1054.3 KB with 792.4 KB
  of JavaScript; it is now ~1010 KB with ~958 KB of JavaScript. The rate is exposed
  to our own bundle, not to customer content.
- **Cross-route prefetch must not be counted.** A scrolled reading came to 1928.7 KB,
  of which ~919 KB was Next.js prefetching other routes as the footer's links entered
  the viewport. Those routes bill as their own page views, so counting them here would
  charge for the same bytes twice. The 1338.9 KB "scrolled" figure recorded on
  2026-08-30 most likely carries the same inflation.

## 2026-09-08 — Campaign email begins at Pro; Starter's band stays 0, and the sending-domain entitlements stay with it

- **Decided by:** the account owner, 2026-09-08, asked whether to restore Starter's 500-send band — removed on 2026-08-31 by three commits carrying no Linear id and no entry here — or to ratify the removal. Ratify it, with the revisit condition recorded beside it.
- **Scope:** packaging
- **Evidence:** `PLAN_ENTITLEMENTS.starter.emailSendsPerMonth = 0` and `PLAN_PRICING.starter.extraEmailSendsUsdPer1k = null` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`, set by `55f728b50` and `1eb666afb`; `features.customSendingDomain` / `features.dedicatedSendingDomain` from Pro, set by `4c06a5a55`; per-tier refusal proven in `libs/plugins/marketing/src/lib/server/campaign-send.spec.ts` (38/38); `npm run check:pricing-tables` reconciliation clean; the live `/pricing` compare row read back from the published nodes of screen version `f5K2cG9xXE`; Stripe live `price_1TuaFuDYHP4psn7hXw4sxU1w` / `price_1TuaFvDYHP4psn7hAQ4q3Gcy` unchanged at $25 and $192; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2679, and AGL-2680 for the question this leaves open.

**No charged price moves, and no entitlement moves.** What moves is the record.
Starter's campaign band has been 0 since 2026-08-31; until today nothing said
who decided that.

| | Locked 2026-08-18 | In force |
|---|---|---|
| Starter campaign emails / mo | 500 | **0** |
| Starter email overage, per 1,000 | $2.50 | **—** (no rate can price a zero band) |
| `customSendingDomain` | Agency and above, via `whiteLabel` | **Pro** |
| `dedicatedSendingDomain` | Pro | Pro |

### Why the removal is ratified rather than reversed

Starter carries no custom sending domain, so its campaign mail would leave on
the platform's shared pool under `p=reject`. The 2026-08-30 decision lowered
Advanced's and Agency's allowances on exactly that ground — one tenant's spam
run lands on the reputation every other tenant sends from — and set the
condition for raising any allowance again: abuse controls proven, domain
warm-up done, the capacity affordable and justifiable. **Nothing has met that
condition since**, and Starter is the cheapest paid tier, which makes it the
least-vetted door in the product.

Cost is not the argument and was never offered as one: the 500-send band was
about $0.45 a month of provider spend against a $16 annual-per-month price.
`55f728b50` recorded the margin effect as 61.5% → 63.3% at full band
utilization, which is a consequence of the decision and not a reason for it.

`4c06a5a55` is ratified on its own merits. It corrected an inversion: the
sending shape that costs the platform nothing — a domain the customer owns and
publishes records for — was gated at `whiteLabel`, while the shape that costs a
provider slot and three zone records was the default from Pro up.

### The condition for raising it

**A floor to raise, not a permanent shape** — the same words the 2026-08-30
entry used, and the same test. When the abuse controls are proven and warm-up
is done, Starter gets a band. Until then it is 0, and a tier that cannot send
says so rather than advertising a ration of zero.

### What this changes

- **Stripe: nothing.** There is no per-feature entitlement and no email-overage
  price object in the account; Starter's two price objects are untouched.
- **`aglyn.com/pricing`: nothing.** The 2026-09-07 republish already carried the
  row on all nine surfaces it appears on — one desktop compare build and eight
  mobile tab panels.
- **The console** stops printing `0 campaign emails/mo` on Starter's plan card,
  its comparison grid row and the current-plan chip. A band of zero now reads as
  the absence it is, matching the one-to-one row beside it.
- **The four responsive `/pricing` Figma frames still draw 500.** Declared in
  `FRAME_STALE_CELLS` in `tools/marketing/build-pricing-tables.mts`; the
  reconciler stays green and the divergence expires when the frames are edited.

### What it leaves open

Starter may send 50 one-to-one emails a day — about 1,500 a month, three times
the band removed — on the same shared pool, because that cap was sized against
COGS rather than against the reputation posture this decision rests on. The
one-to-one path also does not go through the new-workspace ramp that governs
campaigns. AGL-2680 carries it; it should be settled before `release_contacts`
is turned on.

---

## 2026-09-07 — The three `a1e8aaaca` rates are ratified: extra site $8 above Starter, dataset storage $0.36, CRM records $0.40 on Advanced and Agency

- **Decided by:** the account owner, 2026-09-07, asked whether to keep the three rates `a1e8aaaca` shipped on 2026-08-30 without an entry or to revert them to the 2026-08-18 lock's figures. Keep them; the Drive Pricing Decision Log entry of the same date carries the line-margin arithmetic behind each.
- **Scope:** pricing
- **Evidence:** `PLAN_PRICING[*].extraHostMonthlyUsd` (10 · 8 · 5 · 8 · 8 · 8, Starter → Agency), `extraDataGbMonthlyUsd` (0.36 on every paid plan) and `extraContactsUsdPer1k` (1 · 0.75 · 0.5 · 0.4 · 0.4 · 0.4) in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`, set by `a1e8aaaca` and `82c10f0f7`; `npm run check:pricing-drift` 92/92 in sync at 15:30Z, Stripe live `aglyn_{scale,advanced,agency}_extra_host` at $8; `tools/scripts/setup-stripe.mjs` and `apps/console/specs/published-pricing-table-parity.spec.ts` brought onto the same figures; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2652.

**Three charged rates are confirmed where the code and Stripe already have
them.** Nothing moves in code or in Stripe; what moves is the record, and the
one surface that still said otherwise — the extra-site row of
`aglyn.com/pricing`, which the reconciliation note below had left at $5 · $4
· $3 as the single row where the page and the code disagreed.

| Rate | Lock (2026-08-18) | Ratified |
|---|---|---|
| Extra site, per month (Starter → Agency) | $10 · $8 · $5 · $5 · $4 · $3 | $10 · $8 · $5 · **$8 · $8 · $8** |
| Extra dataset storage, per GB-month | $0.25 | **$0.36** |
| CRM records, per 1,000 over the band (Starter → Agency) | $1 · $0.75 · $0.50 · $0.40 · $0.25 · — | $1 · $0.75 · $0.50 · $0.40 · **$0.40 · $0.40** |

### Why each rate is where it is

- **The extra-site ladder stops descending because it was inverted against
  its own cost.** Storage and form submissions are per-host bands, so buying
  a host adds that tier's bands to the org's included allowance; under a
  ladder that descends with the tier, the tiers granting the most per host
  charged the least for one. Business stays $5 because it grants the
  smallest bands of the four.
- **$0.36 is the 50% line margin on dataset storage** against the $0.18 per
  GB-month Firestore stored-data cost; $0.25 carried 28%, close enough to the
  infrastructure pass-through's 23% that a retail add-on and a cost
  pass-through read as the same kind of number. This is the dataset line;
  the $0.0338 metered storage rate is untouched.
- **$0.40 is the floor of the records ladder, not another step down.**
  Against `perContactMonth` of $0.20 per 1,000, $0.25 was a 20% line margin
  on a retail price. Agency carries a rate because its band became finite
  in `82c10f0f7`, and a finite band with no rate is usage past a bound that
  is silently free — the 2026-08-21 rule run in reverse.

### What this changes, and what it does not

- **Stripe: nothing.** The live price objects have charged $8 since
  2026-08-31 and the drift check has said so on every run. `setup-stripe.mjs`
  still carried $5 / $4 / $3 and Agency $799 / $649, and is corrected in the
  same commit so a re-run cannot re-mint retired prices.
- **`aglyn.com/pricing`:** the extra-site cells go $5 · $4 · $3 → $8 · $8 ·
  $8 on Scale, Advanced and Agency. The parity spec's was/now assertion for
  that row collapses into one `toEqual`; `docs/PRICING_SURFACES.md` records
  the republish.
- **Existing customers:** no stored price changes hands. Live Stripe holds
  no Scale, Advanced or Agency subscription carrying an extra-host item; the
  dataset-storage overage has billed at $0.36 since the rollup first read
  the constant, and the records overage is still withheld from invoices
  while `release_contacts` is off.

---

## 2026-09-07 — Storefront membership subscriptions carry the processing pass-through

- **Decided by:** the account owner (AGL-2655) — the pass-through at cost that `/pricing` promises for one-time sales applies to recurring sales too
- **Scope:** pricing
- **Evidence:** `resolveSubscriptionFeePercent` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`; `libs/aglyn/src/lib/app-utils/subscription-processing-pass-through.spec.ts` and `libs/plugins/commerce/src/lib/server/checkout-subscription-fee-pass-through.spec.ts`; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log

**No advertised platform rate moves** — a 0% tier is still a 0% platform take. What
changes is that a storefront **subscription** now recovers Stripe's processing cost
the way a one-time sale has since 2026-08-19 (AGL-2152). Until now a membership sold
on a 0% tier went out with no fee parameter at all, and Aglyn paid Stripe's cost on
every cycle out of its own balance.

A Stripe Subscription accepts only `application_fee_percent` (two decimals, no cents
amount), so the fixed 30¢ is folded into the rate: `(rate × amount + fixed) ÷ amount`,
rounded **up** to the next hundredth of a percent, on top of the plan's own percent,
and sized on the recurring goods (tax and shipping excluded, the AGL-2317 basis). The
constants are the one-time path's own (`STOREFRONT_PROCESSING_PERCENT`, 6% + 30¢), so
repointing them moves both surfaces together. At those rates a $10 membership carries
9%, $25 carries 7.2% and $100 carries 6.3%; Business digital (2%) at $100 carries 8.3%.
Every tier carries it, mirroring the one-time rule exactly.

A subscription sold before this is carried onto the new figure by the renewal
re-price (AGL-2289) at its next paid invoice — no backfill. The staff revenue page
nets the pass-through out of subscription cycles as it does one-time sales.

## 2026-09-07 — AI assist credits past the included band are sold at the plan rate; an org may refuse at the band instead

- **Decided by:** the account owner, 2026-09-07, by directive, answering AGL-2653 — sell the overage by default and give the org a control to refuse at the band.
- **Scope:** pricing
- **Evidence:** `PLAN_PRICING.extraAssistCreditsUsdPer1k` ($3.00 Pro → $2.00 Agency, unchanged; `null` on Free, Starter and Enterprise); `libs/aglyn/src/lib/app-utils/assist-credits.ts` (`assistBandRefuses`, `assistMonthOverage`); `libs/tenant/data/admin/src/lib/server/assist-usage.ts` (`reserveAssistMessage`); `apps/console/app/api/billing/report-usage/route.ts`; `apps/console/app/api/billing/assist-overage/route.ts`; `cloud/firebase-firestore.rules`; `libs/aglyn/src/lib/app-utils/plan-entitlements.spec.ts` (the band-with-rate guard); the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2653.

**No charged rate moves.** The per-1,000 assist overage rates have been on
`PLAN_PRICING` and on `aglyn.com/pricing` ("AI assist, per 1,000 credits over
the included band") since the assist bands were sized; what changes is that
the platform now collects them. Until this entry `reserveAssistMessage`
refused every plan at its band, so the advertised rate was never billed.

### What was decided

- **Sold by default.** On every plan with a rate — Pro, Business, Scale,
  Advanced, Agency — an exchange past the included band is reserved, answered,
  and its credits are billed on the monthly invoice at
  `extraAssistCreditsUsdPer1k`, rounded to the cent beside the contacts, API
  and dataset-storage overages. The provider spend itself stays out of
  `billedCents`, priced into COGS exactly as before.
- **The org may refuse at the band.** `orgs/{orgId}.assistOverage.hardCap`
  (absent by default, read strictly as `=== true`) is the org's own switch.
  On, the assistant refuses at the band with a **402** that names the switch
  — "Stop AI assist at the included band", under Billing → Usage — and quotes
  the plan's rate. Written only through `/api/billing/assist-overage`
  (`billing.manage`, Admin SDK, audited to `adminAudit`), and denied to every
  client in the rules beside `storageOverage`.
- **Plans with no rate are unchanged.** Enterprise's band is contractual and
  stays a wall whatever the switch says; Free and Starter have no band. The
  switch cannot be turned on there (409), so a control that does nothing is
  never offered. Turning it off is always available.
- **The switch is read at the gate, never at the sweep.** `report-usage`
  bills what landed past the band; with the switch on that is at most the one
  exchange that crossed the line. A flip on the 1st cannot erase a month.
- **The operator ceiling.** `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD` still binds
  when set explicitly, on both sides of the switch, and refuses in its own
  words. The $40 repo default remains a backstop for orgs with no band only;
  an org buying overage is bounded by the entitled monthly message cap.

### The guard, widened

`plan-entitlements.spec.ts` now pairs `assistCreditsPerMonth` with
`extraAssistCreditsUsdPer1k` and `emailSendsPerMonth` with
`extraEmailSendsUsdPer1k`: a positive band on a self-serve plan requires a
rate, a band of zero forbids one, and Enterprise carries none. Email had the
same shape and the same rate table, so it was covered in the same pass.

## 2026-09-07 — Enterprise's bands become finite fallbacks at twice Agency's; every numeric entitlement takes a per-org override; workflow and action runs carry a cost

- **Decided by:** Zach, 2026-09-07, by directive, on the pricing soundness audit of the same day — an Enterprise org provisioned without per-org figures was the one org on the platform whose worst-case cost had no bound on any axis; the fallback is now finite, an agreement raises it, and runs stop reading as free. The Drive Pricing Decision Log entry of the same date carries the arithmetic.
- **Scope:** pricing
- **Evidence:** `PLAN_ENTITLEMENTS.enterprise`, `ENTERPRISE_EMAIL_SENDS_PER_MONTH`, `ENTERPRISE_ASSIST_CREDITS_PER_MONTH`, `ORG_COGS_UNIT_RATES_USD.perRun`, `orgMonthlyCogsUsd`'s `runs` line, `bandwidthCeilingDegradesRender` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`; the key-by-key relation and the override-precedence proof in `libs/aglyn/src/lib/app-utils/plan-entitlements.spec.ts`; the ninth cost axis in `apps/console/specs/tier-margin-floor.spec.ts`; `docs/PRICING_SURFACES.md` → *Enterprise has no price here, but it has bands*; AGL-2654.

**No charged price moves.** Enterprise has no list price and gains no rate;
no self-serve figure moves. What moves is **packaging** on the one custom-priced
tier, and the **cost model** every tier is judged by.

### What was decided

1. **Enterprise's bands are finite fallbacks: Agency's band × 2 on every
   axis Agency bounds**, and `UNLIMITED` only where Agency is already
   unlimited. Sites 200, storage 120 GB a site, bandwidth 3,080 GB, form
   submissions 50,000 a site, CRM records 1,000,000, one-to-one email 2,000 a
   day, campaign email 260,000 (from the 250,000 default), workflow runs
   4,000,000, action runs 2,000,000, API calls 10,000,000, seats 200 (max
   1,000), collaborators 500 a site (max 2,000), datasets 4,000 (max 10,000),
   dataset storage 1,000 GB, assist 116,000 credits, POS registers 40,
   inventory locations 100. `formsPerHost` stays the flat ceiling every plan
   carries (2026-08-30). `meteredInfraPassThrough` stays `false` and every
   rate stays the sentinel, so the fallbacks are **caps**: past one the gate
   refuses, exactly as Free's does. A contracted per-org value still wins.
2. **A per-org `entitlements.*` override is honored on every numeric axis**
   — the mechanism that existed for campaign email, saved forms and assist is
   the mechanism for all of them, proved key by key. It is how an agreement's
   numbers are written, and why a finite fallback is safe to hold.
3. **Workflow and action runs carry a unit cost of $0.000012** — about 12
   Firestore reads, 2 writes and a moment of compute per run at nam5 and
   Fluid-compute list prices, derived from the run paths because nothing
   measurable exists (runs execute inside the request that fired the event,
   Cloud Logging carries no per-run entry, and the project logged no run in
   the 14 days to this date). It is COGS, not a price: no plan bills runs. It
   enters `orgMonthlyCogsUsd`, the staff margin surfaces and the whole-plan
   guard, where it takes the last of the room the bandwidth resize left —
   Agency's 3,000,000 runs are $36 a month that read as nothing before.
4. **The bandwidth abuse ceiling no longer degrades an Enterprise site.** It
   keyed on "does not meter", which Enterprise shares with Free; with a
   finite band that would have taken a contracted customer's site off the
   air three times past a default nobody chose. It still trips, flags the
   host and pages staff.

### The guardrail

With the runs term, every band at 100%, at the annual price net of Stripe:
Starter 30.0%, Pro 0.4%, Business 0.3%, Scale 0.8%, Advanced 1.3%, Agency
1.5% (monthly 53.1 / 29.3 / 27.9 / 27.8 / 25.3 / 19.9). Business's headroom
is $0.27 a month; a run rate above $0.0000147 would take it under.

### What does not change

Every price. Every self-serve band. `meteredInfraPassThrough` on every plan.
The Enterprise feature set (SSO and white-label on the plan). The form abuse
ceiling.

---

## 2026-09-07 — The margin invariant is held at the annual price, net of Stripe, with the CRM terms; five bandwidth bands come down to what that price carries; the bandwidth abuse ceiling is 3× the band

- **Decided by:** Zach, 2026-09-07, by directive, on the pricing soundness audit of the same day — the platform's invariant, that a customer cannot cost more than they pay by using exactly what they were sold, is held at the **annual** price (the yearly price ÷ 12), net of Stripe's 2.9% + 30¢ (the fixed part amortized over the one annual charge), with the CRM seat term ($0.06 a collaborator-month) and the one-to-one email term (the daily cap × 30 × $0.0009) counted, at the modeled page-view rate — the 627 KB `perPageView` calibration stays as it is. The Drive Pricing Decision Log entry of the same date carries the cost model and the arithmetic.
- **Scope:** pricing
- **Evidence:** `PLAN_ENTITLEMENTS[*].bandwidthGb` and `BANDWIDTH_ABUSE_CEILING_MULTIPLE` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`; the whole-plan guard in `apps/console/specs/tier-margin-floor.spec.ts`, which now prices the annual price net of Stripe with the two CRM terms, pins every tier at both prices, and carries the mutation at the 2026-09-05 bands; `apps/console/specs/published-pricing-table-parity.spec.ts` → *Bandwidth / mo*; `tools/marketing/pricing-copy/tables.json` (regenerated); `apps/docs/docs/workspace-and-billing/billing-and-plans/bandwidth.md`; AGL-2651.

**No charged price moves.** Plan prices, add-on prices, both fee ladders, the
three metered pass-through rates and every retail overage ladder are what the
2026-08-18 lock and the 2026-08-31 Agency entry left them. What moves is
**packaging**: five included bandwidth bands, and a containment multiple that
was never a price.

### What was decided

1. **The invariant is stated at the annual price, net of Stripe, over every
   cost the platform can name.** The guard that stood until today judged the
   monthly price, gross of the processing fee, and summed the metered axes
   alone; it read +10.0 / +10.9 / +8.3 / +6.7 / +9.1% on Pro through Agency.
   At the annual price, net of the fee, with the seat and one-to-one email
   terms of the 2026-09-05 decision added, the same bands read −44.1 / −36.5 /
   −37.5 / −33.9 / −19.4%, and at the monthly price Pro and Advanced were
   already negative (−1.7%, −1.2%).
2. **Bandwidth comes down to what the annual price carries.** Pro 225 → 125
   GB, Business 400 → 185 GB, Scale 700 → 290 GB, Advanced 1,000 → 345 GB,
   Agency 3,000 → 1,540 GB (the page reads "1.54 TB"). Free (2 GB) and Starter
   (50 GB) do not move — Starter was never under water. Bandwidth is 58–70% of
   every paid tier's cost and the only lever that moves the number; every
   other band stays where the 2026-08-30 and 2026-09-05 entries put it.
   Metered plans keep serving past the band and bill at the unchanged $0.13
   per 1,000 views.
3. **The bandwidth abuse ceiling is 3× the band, from 10×.** A cap, not a
   price: it flags a site and pages staff, and on a metered plan it changes
   nothing a visitor sees. Lower because the meter under it is priced for a
   627 KB page while the platform serves 1,054 KB — past the band every 1,000
   views bills $0.13 and costs about $0.17 — so the tail a plan can run up
   before anyone looks is a loss that grows with the traffic; at 10× that tail
   was open-ended on Agency. The 100,000-view floor and the form ceiling's 10×
   are unchanged.

### The guardrail

`apps/console/specs/tier-margin-floor.spec.ts` asserts, over
`PLAN_ENTITLEMENTS`, `PLAN_PRICING`, `ORG_COGS_UNIT_RATES_USD` and
`netOfProcessorFee`, that no paid tier is negative at 100% of every band at
the annual price, and pins the figures at both prices. With every band at
100%: Starter 30.0% annual / 53.1% monthly, Pro 0.7 / 29.5, Business 1.5 /
28.8, Scale 2.5 / 29.0, Advanced 4.4 / 27.5, Agency 4.9 / 22.6. Thin on
purpose — the bands were cut to what the price carries and no further,
because every gigabyte cut is capacity the customer no longer has.

The same guard pins what the OTHER page-view rate says: at the 1,054 KB page
the platform actually serves ($0.000168 a view at the calibration's own
per-KB basis) every paid tier is negative at the annual price again — Starter
−7.2%, Pro −37.5%, Business −20.8%, Scale −16.8%, Advanced −9.4%, Agency
−12.6% — and positive at the monthly one. Recorded as a fact beside the
decision, not as a decision: the bands were sized at the modeled rate, and
closing that gap is a page-weight or a rate decision that this entry does not
make.

### What does not change

Every price. `perPageView` and the two other pass-through rates, and the
+30% markup on them. The Free and Starter bands. The storage, form, records,
campaign email, one-to-one email, seat, dataset, API and assist bands on every
tier. `meteredInfraPassThrough` on every plan. The form abuse ceiling.

---

## 2026-09-07 — Reconciliation note: `aglyn.com/pricing` republished to the bands the code enforces (not a decision)

- **Decided by:** nobody — a record; the session that republished the page, under the 2026-09-05 rule that the code is authoritative where an older figure disagrees. No charged price moves and nothing here is a new decision.
- **Scope:** pricing
- **Evidence:** screen `v0clP6xQl-`, version `zj-21jtrPG`, published 2026-09-07 12:54Z; `PLAN_ENTITLEMENTS` and `PLAN_PRICING` at `c224b7382` (v1.0.0-beta.77); `apps/console/specs/published-pricing-table-parity.spec.ts`, whose `PUBLISHED` literals were re-transcribed from the page the same day; the same-dated entry in Drive → Pricing & Packaging → 05-Pricing-Decision-Log; AGL-2656.

**No charged price moves.** The page was carrying figures the code had stopped
enforcing on 2026-08-30 and 2026-08-31, and the CRM launch republish brought
it onto the code. This entry exists so the was → now of every row is on
record in the repo, next to the spec that pins the now.

### What the page shows now (7 self-serve columns; Enterprise reads "Talk to us")

| Row (page label) | Was | Now (= the code) |
|---|---|---|
| Storage per site | 250 MB · 2 · 10 · 50 · 75 · 100 · 200 GB | 250 MB · 2 · 10 · 20 · 30 · 40 · 60 GB |
| Bandwidth / mo | 5 GB · 50 · 250 · 1 TB · 2.5 · 5 · 20 TB | 2 GB · 50 · 225 · 400 · 700 GB · 1 TB · 3 TB |
| Form submissions / mo → **per site** (relabeled) | 20 · 200 · 1,000 · 10,000 · 50,000 · 100,000 · Unlimited | 20 · 200 · 1,000 · 8,000 · 25,000 · 40,000 · 25,000 |
| Contacts included → **CRM records included (contacts, companies & deals)** | 100 · 1,000 · 10,000 · 100,000 · 500,000 · 1,000,000 · Unlimited | 100 · 1,000 · 10,000 · 50,000 · 100,000 · 150,000 · 500,000 |
| **CRM suite: leads, companies, deals & tasks** (new row) | — | — · ✓ from Starter; Enterprise ✓ |
| **One-to-one emails / day** (new row) | — | — · 50 · 150 · 200 · 300 · 500 · 1,000 |
| Email sends / mo → **Campaign emails / mo** | — · 500 · 5,000 · 50,000 · 100,000 · 125,000 · 250,000 | — · — · 5,000 · 25,000 · 40,000 · 65,000 · 130,000 |
| Add-on: Contacts → **CRM records, per 1,000 over the included band** (Starter → Agency) | $1 · $0.75 · $0.50 · $0.40 · $0.25 · — | $1 · $0.75 · $0.50 · $0.40 · $0.40 · $0.40 |
| Add-on: Extra dataset storage, per GB-month (Starter → Agency) | $0.25 ×6 | $0.36 ×6 |
| Add-on: Extra site, per month (Starter → Agency) | $10 · $8 · $5 · $5 · $4 · $3 | **unchanged, deliberately** — the code says $8 on Scale, Advanced and Agency; open as AGL-2652 |
| Plan cards and room-to-grow strips | Starter "500 campaign emails/mo"; Scale strip "2.5 TB · 100,000"; Advanced "125,000"; Agency "250,000"; Enterprise "unlimited campaign emails" | Starter "CRM: leads, companies, deals & tasks"; Business "25,000 campaign emails/mo"; Scale strip "700 GB bandwidth · 40,000 campaign emails/mo"; Advanced "65,000"; Agency "130,000"; Enterprise "campaign email volume by agreement" |

Everything else on the page — prices, seats, datasets, records per dataset,
workflows, products, POS, both fee ladders, API, and the metered rates $0.13 /
$0.065 / $0.0338 — already equaled the code and is untouched.

### Why the code won over the two 2026-08-30 Drive entries

The Drive log's two 2026-08-30 entries, "Infrastructure bands are resized to
what the price can carry, and Agency is repriced" and "Advanced and Agency
email allowances come down to what the platform can deliver" (the second is
mirrored below), were superseded the same day by commits that never got an
entry of their own:

- `82c10f0f7` took bandwidth to 400 / 700 / 1,000 / 3,000 GB and the contacts
  bands to 50,000 / 100,000 / 150,000 / 500,000, and `72aa20742` took Pro to
  225 GB — the first entry's own invariant, no tier negative at 100% of its
  bands, is what forced the second cut. Storage and form bands match that
  entry as written.
- `b8ab5837f` took campaign emails on Business → Agency to 25,000 / 40,000 /
  65,000 / 130,000 and gave Enterprise a finite 250,000 default; `55f728b50`
  (2026-08-31) took Starter to 0, because a campaign band obliges a per-site
  sending domain.
- `a1e8aaaca` moved dataset storage $0.25 → $0.36, extra host $5 / $4 / $3 →
  $8 and the Advanced / Agency contacts rate to $0.40 with **no entry** in
  either log. Those three are open as AGL-2652; the page shows $0.36 because
  `checkDataStorageQuota` already bills it, and keeps $5 / $4 / $3 because the
  extra-site figure has not been decided.

Open owner decisions this note does not make: AGL-2651 (plans negative at
100% of their bands at the annual price — bandwidth), AGL-2652 (the three
`a1e8aaaca` rates), AGL-2653 (assist overage), AGL-2654 (Enterprise fallbacks
and runs cost), AGL-2655 (membership subscriptions and Stripe's fee).

---

## 2026-09-05 — CRM records band, the CRM suite gate and one-to-one email caps

- **Decided by:** Zach, 2026-09-05, by directive — the CRM must never run negative, must hold an 80% gross margin at full utilization, and is available only from a minimum tier. The figures below were chosen under that directive and are recorded as the decision; the Drive Pricing Decision Log entry of the same date carries the cost model and the arithmetic.
- **Scope:** pricing
- **Evidence:** `PLAN_ENTITLEMENTS[*].features.crm` (`false` on Free, `true` from Starter), `PLAN_ENTITLEMENTS[*].crmEmailsPerDay`, `checkCrmRecordsQuota` and `checkCrmEmailQuota` in `libs/aglyn/src/lib/app-utils/plan-entitlements.ts`; `countCrmRecords` in `libs/tenant/data/admin/src/lib/server/crm-records.ts`; the CRM-axis margin guard in `apps/console/specs/tier-margin-floor.spec.ts`; AGL-2611.

**No charged price moves.** Plan prices, add-on prices, both fee ladders, the
three metered pass-through rates and the contacts overage ladder are what the
2026-08-18 lock and the 2026-08-31 Agency entry left them. What moves is
**packaging**: which tiers include the CRM suite, what the contacts band
counts, and one new bounded quantity with a per-plan cap.

### What was decided

1. **The CRM suite is included from Starter.** `features.crm` is `false` on
   Free and `true` on every other plan. Free keeps the **Contacts** section —
   the list, tags, notes, segments, CSV import and export, which is the capture
   projection the email audiences read — and sees Leads, Companies, Deals,
   Tasks, Reports and Fields locked with the console's standard upgrade
   affordance. The CRM automation steps refuse into the run history, the
   `crm:*` REST resources answer `plan_required`, and the two CRM dashboard
   cards do not render. Starter rather than Pro because the field prices a CRM
   seat at $14–25 a month and Starter with the suite included is the
   competitive entry; gating higher hands the small-business buyer to a free
   CRM elsewhere.
2. **The contacts band becomes the CRM records band.** `contactsPerHost` keeps
   its persisted key and its numbers (100 · 1,000 · 10,000 · 50,000 · 100,000 ·
   150,000 · 500,000 · Unlimited) and now counts **contacts + companies +
   deals**. Overage meters at the unchanged `extraContactsUsdPer1k` ladder,
   still withheld from invoices while `release_contacts` is off. Free's hard
   band refuses the 101st record across the three collections. Tasks and
   activities are not counted; the activity log is capped at 5,000 entries per
   record (`CRM_ACTIVITIES_PER_RECORD_CEILING`).
3. **One-to-one email is capped per organization per UTC day:** Free 0 ·
   Starter 50 · Pro 150 · Business 200 · Scale 300 · Advanced 500 · Agency
   1,000 · Enterprise unlimited. A hard pace with no overage rate on any tier;
   every send still counts on the `emailSends` cost meter. The caps are the
   counts at which every plan holds an 80% CRM-axis margin at its **annual**
   price with the whole day spent — not a usability figure.
4. **No new seat add-on.** A CRM user is an organization member, already
   priced by the seat and collaborator add-ons; a per-seat CRM SKU would charge
   the same person twice.

### The guardrail

`apps/console/specs/tier-margin-floor.spec.ts` asserts, over
`PLAN_ENTITLEMENTS`, `PLAN_PRICING` and `ORG_COGS_UNIT_RATES_USD`, that no
priced plan's CRM-axis cost at 100% utilization —
`contactsPerHost × perContactMonth + membersPerHost × $0.06 +
crmEmailsPerDay × 30 × perEmailSend` — exceeds 20% of its annual monthly
price, and pins the figures: Starter $1.73 of $16, Pro $6.65 of $39, Business
$18.40 of $99, Scale $32.60 of $179, Advanced $49.50 of $299, Agency $142.00
of $1,049. `libs/aglyn/src/lib/app-utils/plan-entitlements.spec.ts` asserts
that a band with no overage rate is either unlimited or refused at the line,
so neither the Free records band nor any tier's email cap can be silently
exceeded.

### What does not change

The Free contacts band, the overage ladder, the `release_contacts` withholding,
the dynamic-list materializer budget, the 5,000-row import ceiling, the bounded
report windows and the API rate limits are all as they were. The cost model's
`perContactMonth` ($0.20 per 1,000) stands; a company or a deal costs less to
hold than a contact, so counting them at the contacts rate over-covers them.

---

## 2026-08-31 — The dedicated sending subdomain becomes an entitlement, so one org can be granted one

- **Decided by:** the account owner — the gate moves to the mechanism every other capability uses, which makes a per-org grant real rather than a field nothing reads.
- **Scope:** packaging
- **Evidence:** `dedicatedSendingDomain` is `false` on Free and Starter and `true` from Pro up, which is the same ladder the plan floor described. The staff override route writes `entitlements.features` from `Object.keys(PLAN_ENTITLEMENTS.free.features)`, so adding the key is what makes the grant writable at all.

**No charged price moves and no plan's default capability moves.** Every tier
carries exactly what it carried before.

### What changes

The claim path read the org's `plan` word against a floor, so a per-org grant
of this capability was inert: staff could write it, the write succeeded, an
audit row was recorded, and nothing consulted it. Read through
`checkEntitlement`, the same document decides the answer.

Two consequences follow from resolving the whole org rather than one field:

- **A grant takes effect.** A Starter org staff have granted may request a
  dedicated subdomain without being moved to Pro — which is the support case
  this gate meets most often, and which previously cost the account a repricing
  that also moved eight quotas.
- **A dead subscription revokes.** `resolveEffectivePlan` reads a canceled or
  unpaid subscription down to `free`, so an org that stops paying stops
  claiming NEW subdomains. Sites it already holds keep theirs: the pinned-label
  early return sits above the gate, and a downgrade has never repossessed a
  name that has earned sending reputation.

### What does not change

The grant is not a way past the ceiling. A claim is still one of three
conditions — a merchant asks, the org carries the capability, and
`AGLYN_SENDING_DOMAIN_CAPACITY` has room — and a site refused at any of them
sends on the shared pool rather than not at all. `whiteLabel` does not move;
it stays Agency and Enterprise, and the parity assertion that fails if the
sending gates are ever conflated with the brand gate stays green.

`DEDICATED_SENDING_DOMAIN_MIN_PLAN` survives only as the name an upsell
quotes, and is now derived from `PLAN_ENTITLEMENTS` rather than declared beside
it, so the tier a refusal names cannot disagree with the tier the gate
enforces.

---

## 2026-08-31 — A dedicated sending subdomain is requested, not issued

- **Decided by:** the account owner — degrading to the pool at the ceiling is an improvement and not the same thing as scaling, so the demand curve moves rather than only the failure mode.
- **Scope:** packaging
- **Evidence:** three code paths claimed a platform subdomain with nobody asking — `provisionHost` at site creation, `claimOrgSendingDomains` from the billing webhook's plan transition, and `claimUnprovisionedHosts` from the console sweep. All three were gated on the plan, so demand for a bounded resource tracked paying customers. Resend's self-serve ceiling is 1,100 domains and five are used today.

**No price and no entitlement value moves.** `customSendingDomain` and
`DEDICATED_SENDING_DOMAIN_MIN_PLAN` are both unchanged; what changes is when a
subdomain is claimed.

### What the earlier entry got right, and what it did not fix

Making an unverified platform subdomain fall back to the pool turned a ceiling
from an outage into a degradation, which was worth doing on its own — a paying
site refused every message, receipts included, between claim and verification.

It did not make the count scale. `D` still grew automatically with every
paying customer, so at 100,000 hosts with 10% paying the demand is 10,000
domains against roughly 1,095 of headroom. The failure that leaves is a promise
problem rather than an outage: customers past the ceiling are silently pooled
after being sold reputation isolation, and nothing tells them or us which ones
they are.

### The asymmetry, applied one layer down

A customer-owned domain costs the platform zero records in its own zone and no
place in the re-verification sweep, and now starts at Pro. A platform subdomain
costs a provider slot, three zone records and a permanent sweep entry — and
gives the merchant **no branding benefit over a pool member**, only isolation.
Handing out the expensive one automatically while the free one had to be found
is the same inversion the entitlement change corrected a layer up.

So the subdomain is offered rather than issued:

- The three automatic claim paths are removed. `claimOrgSendingDomains` and
  `claimUnprovisionedHosts` are deleted rather than gated, because both existed
  only to claim without being asked.
- `ensureHostSendingDomain` is renamed `requestHostSendingDomain` and takes a
  required `requestedBy`. The rename is the structural half: `ensure…` invites
  a defensive call, and a process has no honest value for `requestedBy`.
- Pro's default is the pool for transactional mail, with a domain the merchant
  owns as the promoted route to isolation and an issued subdomain as the answer
  for somebody who cannot publish DNS.

### The merchant is not left stuck

Marketing still needs a domain of the site's own, so the refusal a Pro merchant
meets now names both routes and points at the card, and the card carries the
offer directly under the identity readout. Both were required: a refusal naming
a control that is not on screen is the same dead end as no control at all.

### The ceiling is watchable before it binds

`atCapacity` alone is observable only once it has already cost something, and
the remedy is a billing change plus a config deploy. The provisioning route now
reports `remaining` and `used` as a `0`–`1` share alongside it, and the sweep
warns from 80% spent — a share because deployments differ by two orders of
magnitude, with the absolute count beside it because a share is unreadable at
an allowance of 10.

### The resulting curve

`4 + R + C`, where `R` is subdomains merchants requested — bounded by the
ceiling AND no longer growing with anything automatic — and `C` is customers
who brought their own, which costs our zone nothing. Zone records are `12 + 3R`.
Nothing in it is a function of host count or of paying-customer count.

---
## 2026-08-31 — Agency is $1,299/mo and $1,049 annual, and the pin catches up to it

- **Decided by:** the account owner, confirming the raise made under the authorization to fix tier margins — Agency was the worst margin on the ladder and the most underpriced against the field.
- **Scope:** pricing
- **Evidence:** `PLAN_PRICING.agency.basePriceMonthlyUsd` 799 → 1299 and `basePriceAnnualMonthlyUsd` 649 → 1049 in `a1e8aaaca`; Stripe `aglyn_agency_v2` $1,299 and `aglyn_agency_v2_yearly` $12,588, both new objects since a Stripe price is immutable and the $799 pair is archived; `npm run check:pricing-drift`.

**A charged price moves.** This is the first entry since the Sept-1 lock that says so, and the lock is not being weakened — the pin moves *with* this record, which is the procedure the lock defines rather than an exception to it.

Agency included 100 hosts, 20 TB of bandwidth and an unbounded form-submission band against $799. Bandwidth is the driver: one GB is 1,748 page views at `ESTIMATED_PAGE_TRANSFER_BYTES`, so 20 TB alone measured about $3,495/month of platform cost against a $799 subscription. The bands came down in the same change; the price had to move as well because the two were set in different places at different times and nothing had ever multiplied one by the other.

$1,299 still undercuts every comparable: Duda charges roughly $1,396–1,493/mo for 100 sites, BigCommerce Enterprise starts at $1,499, Shopify Plus at $2,300.

Every customer-facing surface now carries $1,299: the `/pricing` body, and the page's SEO description, which is a separate hand-edited field that propagates into `<meta name="description">`, `og:description` and `twitter:description`. The description trailed the body for several hours — a page can read correctly while every search result and shared link still quotes the old price. `docs/PRICING_SURFACES.md` lists all nine places a price change has to reach, which of them nothing can check, and why one request against the live page is not enough to confirm a publish.

## 2026-08-31 — A custom sending domain starts at Pro, and the platform subdomain becomes best-effort

- **Decided by:** the account owner — the cheap shape is unlocked down the ladder and the expensive one is made degradable, so the platform's domain count stops growing with paying sites.
- **Scope:** packaging
- **Evidence:** the sending model has three shapes (`docs/design/email-sending-domains.md` §"What the model is instead"). The shared pool is flat — 4 provider domains and 12 DNS records at any number of sites. A **customer-owned** domain costs one provider slot and **zero** records in our zone, because the customer publishes them. A **dedicated platform subdomain** costs a provider slot, three records in our zone and a permanent place in the re-verification sweep, per site. Resend's self-serve ceiling is 1,100 domains (Scale's 1,000 plus a one-time +100 add-on toggle, not a repeatable per-100 purchase); five are used today.

**No charged price moves.** This adds a capability to Pro and above; every
price stays where the Sept-1 lock put it.

### The inversion

The option that costs the platform nothing was gated on `whiteLabel` — Agency
and Enterprise — while the option that costs it a slot, three records and a
recurring check was the default from Pro up. At 100,000 hosts with 10% paying
that is 10,000 dedicated domains against a 1,095-domain headroom, 30,000 zone
records, and about ten hours of Vercel's 50-records-per-minute creation limit.

Both halves are corrected:

- **`customSendingDomain`** is a new entitlement, held from Pro up, and it is
  what the two sending routes read. It is deliberately **not** `whiteLabel`:
  that flag replaces the Aglyn brand across every surface — product name, logo,
  colors, support URL, console chrome, favicon — and widening it would hand Pro
  a set of unrelated Agency features. Sending as your own name is one narrow
  consequence of white-labeling, not the whole of it. `whiteLabel` itself is
  untouched and stays Agency and Enterprise.
- **The dedicated subdomain becomes an optimization on top of the pool.** A
  site whose subdomain has not verified — the ceiling reached, a zone write
  failed, the sweep not yet run — sends its transactional mail on the pool and
  keeps sending it.

### What the second half fixes, which was a live defect

A claim pins `hosts/{id}.sendingDomain` before any vendor is called, and the
resolver read that as a merchant's SELECTION. So between the claim and a
successful verification a **paying** site refused every message it sent,
receipts included, while a free site — never issued a subdomain, so never
holding a selection — sent on the pool perfectly well. Capacity exhaustion
would have converted a purchasing decision into an outage for exactly the tiers
that pay.

The line the resolver now draws is **whose domain it is**, not whether one is
verified. A customer's own unverified domain still refuses outright: there the
merchant published DNS and told us what their recipients would see, and sending
as somebody else is not a degraded way of honoring that. A platform subdomain is
a name we chose, provisioned and pointed the site at, so there is no instruction
to contradict. Marketing is unchanged and still refuses on the pool, because one
merchant's complaint rate must not be charged against every other site's
password resets.

### The resulting cost curve

Domain count is `4 + (customers who bring their own) + (dedicated subdomains
issued, bounded by AGLYN_SENDING_DOMAIN_CAPACITY)`. Only the middle term grows,
it grows with willingness to pay rather than with signups, and it costs nothing
in our zone. The ceiling on the last term is now safe to enforce: reaching it
costs delivery isolation, never receipts.

---

## 2026-08-28 — Fourteen commits cited issue ids that never existed; history stands and a guard refuses the next one

- **Decided by:** the account owner — the history is not rewritten, the citations are corrected in place, and the issue-creation freeze holds.
- **Scope:** policy, tooling
- **Evidence:** AGL-2500; `tools/scripts/check-linear-ids.mjs`, `tools/scripts/linear-issue-ceiling.json`; commits `363d03156`…`b14b3c3b3`

Fourteen commits on `main` cite **AGL-2508–2521** against a workspace whose
highest issue is **AGL-2499**. The ids reached source comments as well, where
they outlive the commit message that carried them. A commit citing a
non-existent issue is worse than one citing none: citing none says there is no
ticket, while citing AGL-2515 says there is context to find and sends the
reader to a 404 — so the reader concludes their own access is broken, and the
cost is paid by every future reader instead of once by the author.

**History is not rewritten.** `main` is shared and 84 commits were already
unpushed; rewriting them to fix a comment would cost more than the comment is
worth. The citations are corrected where they live, and
`npm run check:linear-ids` refuses the next one — comparing against a **cached
ceiling** checked into the repo rather than the Linear API, because
`LINEAR_API_KEY` is set nowhere and a guard built on a credential nobody has
set is born inert.

⛔ **A fabricated id may not be made real by creating the issue.** The
issue-creation freeze stands. Retag the work to the issue that genuinely covers
it, or drop the tag.

⚠️ A **second, worse** form of this exists and the guard cannot see it: commits
citing ids that *do* resolve and look correct, but describe unrelated work.
Those are found by blame, not by a ceiling — 84 of the 356 references to
**AGL-1476–1490** were written by those commits and 250 are legitimate, so a
find-and-replace over the range corrupts correct citations.

⚠️ It is **not confined to that range**. `AGL-2501` (Components page: real table
and Create button) carried the entire console list-pagination arc, and
`AGL-2306` (a rejected plugin version stays advertised) was cited by the
citation guard itself. Both now have real issues — AGL-2501 and AGL-2500.

## 2026-08-30 — The saved-form catalog: a per-plan ladder was built, then withdrawn for one flat ceiling

⚠️ **Read the amendment at the end of this entry before acting on anything in
the middle of it.** The ladder described below was built, published, and then
withdrawn the same day on the evidence it had itself gathered. The competitor
table is the reason the ladder is gone and is the durable part of this entry.

- **Decided by:** the account owner. First that the catalog should be a per-plan allowance published on every pricing surface, with the top tiers uncapped; then, on reading the vendor comparison this work produced, that the axis should not be priced per tier at all.
- **Scope:** packaging
- **Evidence:** `OrgEntitlements.formsPerHost` exists and is enforced, but does not vary by plan: `FORMS_PER_HOST_CEILING = 500` on every plan carrying `reusableComponents`, and `0` on Free. Enforced at `apps/console/app/api/hosts/resources/route.ts` (`quotaKey`, inside the create transaction). Published on the billing usage meters and the staff entitlement editor; **not** on the pricing tables and **not** on the plan cards. `FORMS_MAX_PER_HOST` in `libs/aglyn/src/lib/app-utils/forms.ts` is a listing window, never a ceiling.

**No charged price moves.** This adds an allowance and raises a ceiling; every
price stays where the Sept-1 lock put it.

`FORMS_MAX_PER_HOST = 50` was one flat number for all eight plans, on no price
list and in no document. It is now `formsPerHost`, a per-site catalog size the
plan decides.

### The two form dimensions, and why the count is not the lever

`formSubmissionsPerMonth` already exists, is already tiered
(20 / 200 / 1k / 10k / 50k / 100k / Unlimited / Unlimited), and is already
metered at cost × 1.30. **It is untouched.** What moves is the other axis: how
many saved form DEFINITIONS one site may hold.

Verified against live vendor pricing pages on 2026-08-30:

| Vendor | What they gate | Numbers |
|---|---|---|
| Squarespace | nothing — no form count, no submission cap; only form *analytics* is tiered | — |
| Webflow | submissions on the FREE tier only; paid plans advertise "unlimited form submissions"; features (file upload) are the paid lever | 50 on Starter, unlimited above |
| HubSpot | neither — forms are free and unlimited; the meter is marketing contacts | 1k / 2k / 10k contacts |
| Typeform | responses per month; "Number of forms — Unlimited" on every tier, stated verbatim | 100 / 1k / 10k responses |
| Mailchimp | neither — "as many forms as needed per audience"; contacts and sends are billed | — |
| Wix | **form count**, tightly | 4 / 10 / 25 / 75 |
| Jotform | form count AND submissions — a form-first product where the form is the billable unit | 5 / 25 / 50 / 100 forms |

Five of seven cap form count at nothing at all. Webflow, historically the
poster child for per-plan submission caps, has abandoned that lever above its
free tier. Only Wix meters form count among website builders, and its numbers
are tight enough to be a known friction point.

**So the count is set as an abuse ceiling that a real customer never meets, not
as a lever.** It is generous against both vendors that do meter it, and it
disappears entirely from Advanced up.

⚠️ **The table below is the WITHDRAWN proposal**, kept because the comparator
column is the working that led to dropping it. The shipped number is one flat
500 on every plan in it.

| Plan | Saved forms / site (withdrawn) | Nearest metering comparator |
|---|---|---|
| Free | — | HubSpot/Typeform/Mailchimp give free forms; see the open question below |
| Starter $25 | 50 | Wix Core 10 @ $29 · Jotform Bronze 25 @ $39 |
| Pro $56 | 200 | Wix Business Elite 75 @ $159 · Jotform Gold 100 @ $129 |
| Business $139 | 500 | past every published competitor number |
| Scale $249 | 1,000 | — |
| Advanced $399 | Unlimited | matches the tier's "headroom on every limit" posture |
| Agency $1,299 | Unlimited | — |
| Enterprise | Unlimited | contract-bound |

**Nobody loses capacity.** Starter is set at exactly the flat 50 every plan had,
so the change only ever grants.

### Where it is enforced, and where it deliberately is not

The allowance refuses the CREATE of the next form, inside the transaction that
counts, and nothing else. A site whose allowance is spent — including one that
spent it by downgrading — keeps every form it built, editable and readable, and
every one of them keeps collecting. Submissions are metered revenue on their own
band, so a catalog ceiling that reached them would refuse the customer's leads
and the platform's billing in the same request.

⛔ **The catalog is not an `over-limit.ts` capacity and must not become one.**
Sites, manager seats and datasets are there because holding past a downgrade
means holding capacity the org is no longer entitled to, and the remedy is to
release some. Forms have no such remedy: they grandfather, in full, forever.

### What this deliberately did NOT do

- **No submissions change.** The bands and the metered rate are a charged price
  and are frozen. The comparison did not suggest moving them.
- **No forms add-on.** Extra forms are not sold, so no new price exists.
- **`reusableComponents` still gates access.** Free resolves to 0 because that
  entitlement is Starter-and-above and refuses the create before the count is
  reached. The number publishes what Free actually gets rather than a promise
  the route declines.

### Open question for the account owner

**Should Free get a small saved-form catalog?** Every free tier in the
comparison set offers forms — HubSpot and Mailchimp make free forms the
acquisition lever that fills the metered resource they actually bill. Free sites
here already accept 20 submissions a month from an unbound form on a page, so the
capability is half-present; what they cannot do is SAVE one as a reusable
definition. Granting it means moving the form entity off `reusableComponents`,
which is a packaging change on a published feature-matrix row and needs a
decision, not an implementation.

### Amended the same day — the ladder is withdrawn

**What happened, plainly.** The ladder above was designed, implemented and
published across the entitlements table, the plan cards, the usage meters, the
staff editor and the generated pricing tables. Building it required surveying
what the field actually charges for, and that survey is the competitor table
above: of seven vendors, five cap saved-form COUNT at nothing whatsoever,
Webflow abandoned the lever above its free tier, and the only two that meter it
are Wix and Jotform — the latter a form-first product where a form IS the
billable unit. The work's own conclusion was that the count is an abuse ceiling
rather than a marketing lever. The account owner read that and decided not to
price it per tier.

So the ladder is gone and the mechanism stays.

**The shape: one flat ceiling, not "unlimited".** `formsPerHost` resolves to
`FORMS_PER_HOST_CEILING = 500` on every plan that can build a form at all, and
to `0` on Free. It rides an entitlement key rather than a bare platform
constant for two concrete reasons: `checkQuota` is where a refusal can happen
inside the transaction that counts, and a per-org `entitlements.formsPerHost`
override is how one contract gets a larger catalog without moving the number
everyone else is measured against.

Unlimited-on-every-paid-plan was the alternative and was rejected. Unbounded
creation of form definitions is a storage and write vector that no price tier
makes safe, and removing the ceiling from the entitlement would have pushed it
back onto `FORMS_MAX_PER_HOST` — the page size of two listing reads. That
coupling is precisely the defect described below: one number serving as both a
customer-facing ceiling and a query bound means any future change to the page
size silently changes what customers may hold.

500 is generous by construction: five times Jotform's largest published tier
(100) and more than six times Wix's (75), and past any catalog a real site
builds. It is deliberately BELOW the 1,000-row listing window, so the window
always has headroom over the ceiling.

**Removed from the pricing surfaces.**

- The `Saved forms per site` row is gone from `tools/marketing/build-pricing-tables.mts` and from the generated `tools/marketing/pricing-copy/tables.json`. A limit identical on all eight plans differentiates nothing, and eight matching cells invite a reader to hunt for a difference that is not there.
- The `EXPECTED_MISSING` declaration that had been added for that row is gone with it. That map is checked in BOTH directions — an entry that stops diverging fails — so leaving it would have broken `check:pricing-tables`.
- The plan-card line no longer prints the catalog size. It prints the submissions band alone, which is genuinely tiered, genuinely metered and genuinely charged. The ceiling is still shown where it means something: on the per-site usage meters, beside that site's own count.

`check:pricing-tables` and `check:feature-matrix` are both clean.

**Kept, deliberately.**

- The enforcement path: `quotaKey: 'formsPerHost'` through `checkQuota`, inside the counting transaction.
- The rule that a ceiling refuses only the CREATION of the next form. Forms already built are never deleted, hidden or disabled, and a site above its ceiling keeps collecting submissions on every form it has. This is the standing capacity rule — a limit binds ALLOCATION, never ACCESS — and it is about future paying customers, not about legacy data.
- The decision NOT to add forms to `over-limit.ts`, for its stated reason: there is nothing to release. A flat ceiling strengthens this — the number is now identical on both sides of any downgrade, so a plan change cannot strand a catalog at all.
- `formSubmissionsPerMonth`, untouched. Tiered, metered, and part of a charged price.

**No charged price moves.**

### A defect the flattening exposed: a read bound worn as a cap

`FORMS_MAX_PER_HOST` was a hard `limit()` on two reads whose comments both
described it as a flat platform cap — the besigner entity picker and the inbox
submissions filter. While three plans resolved to unlimited, that was simply
false: a site could create more forms than either list could show, and both
would present the short list as the whole list with nothing on screen saying
otherwise. This is the defect class this codebase keeps meeting — **a read that
cannot see something reports the same thing as the thing not existing.**

Raising the constant does not fix it; it picks a larger number to be wrong at.
The flat ceiling removes the everyday case (500 held, 1,000 readable), but a
per-org override can still exceed the window, so the invariant is written
against the disclosure rather than the number:

- The inbox filter reads one document PAST the window, which is the only way truncation is knowable, shows at most a window's worth, and says "Showing the first 1,000 forms" when it cut the list. `inbox-paging.spec.tsx` pins both directions — it must say so when cut, and must NOT say so when the whole catalog fits.
- The entity-picker provider's comment no longer claims a flat cap. The picker fed from it still owes the same disclosure; that surface is another owner's.
- `forms.spec.ts` now requires the window to sit STRICTLY above the largest allowance, so the two numbers cannot silently collapse into one.

### Open question for the account owner — still open, and now sharper

**Should Free get a small saved-form catalog?** With the ladder gone, "forms are
the same on every plan" and "Free gets none" sit oddly together. Free resolves
to `0` not by a packaging choice but because the form entity rides
`reusableComponents`, which starts at Starter.

The comparison set argues one way. HubSpot and Mailchimp both make free forms
the acquisition lever that fills the metered resource they actually bill —
contacts and sends — and forms are exactly that shape here, since what this
platform meters is submissions. A Free site already accepts 20 submissions a
month from an unbound `Form` node on a page, so the capability is half-present
already; what a Free site cannot do is SAVE one as a reusable definition.

**This is the owner's call and was not decided here.** Granting it means moving
the form entity off `reusableComponents`, which is a packaging change on a
published feature-matrix row.

---

## 2026-08-30 — Advanced and Agency email allowances come down to what the platform can deliver

- **Decided by:** the account owner — Agency sold 1,000,000 campaign emails a month against a 360,000 deliverable ceiling, and the repair is to lower the allowance rather than buy capacity that abuse controls have not yet earned.
- **Scope:** pricing
- **Evidence:** `PLAN_ENTITLEMENTS.advanced.emailSendsPerMonth` (250,000 → 125,000); `PLAN_ENTITLEMENTS.agency.emailSendsPerMonth` (1,000,000 → 250,000); `libs/shared/util/email/src/lib/send-ceilings.spec.ts` → *R3 holds for the plans we actually sell*; full reasoning in Drive → Pricing & Packaging → 05-Pricing-Decision-Log

**No charged price moves.** Two entitlements come DOWN; every price stays where the Sept-1 lock put it.

One org may claim a quarter of the 2,000/hour platform rate — 500/hour, so 360,000 in a 30-day month is everything it could physically send. Agency's allowance needed about 2,000 hours inside a 720-hour month. Nobody had hit it because there are no customers, but an agency using what it bought would have been throttled to roughly a third with no explanation on any screen.

Advanced moves too, even though 250,000 was already deliverable: leaving it while Agency fell to 250,000 makes the two identical on this dimension across a 2× price step. The pair keeps a 2× step, and Agency sits at 69% of the ceiling — headroom for bursts, retries and warm-up.

Both are floors to raise once abuse controls are tested and the capacity is justifiable. `enterprise` stays `UNLIMITED` deliberately: it is contract-bound, and a number in the entitlement table would be fiction.

A guard now reads the shipped table rather than a number invented in the test file — which is why the model could be proven correct while the plans oversold.

---

## 2026-08-26 — CDN delivery moves to every plan; the feature matrix becomes a tracked, generated document

- **Decided by:** the account owner — the CDN path is the cheaper one to serve, so gating it raised the cost of the tier that pays nothing; the feature matrix becomes a tracked, generated document in the same pass.
- **Scope:** packaging
- **Evidence:** `PLAN_ENTITLEMENTS.free.features.mediaCdn`; `docs/feature-matrix.md` (generated); `npm run check:feature-matrix`; full reasoning in Drive → Pricing & Packaging → 05-Pricing-Decision-Log

**No charged price moves.** A feature moves DOWN into Free.

The gate had the economics backwards, because "no CDN" is not an absent feature
— it is a **different, more expensive delivery path**. Without the entitlement a
site serves absolute `firebasestorage.googleapis.com` URLs, so every visitor
pulls the **full-size original** from Storage egress with **no shared edge
cache**; the same entitlement covers responsive variants, so the ungated path
lost on bytes-per-request *and* origin-requests-per-byte at once. The free tier
was the most expensive tier we run, and the gate was what made it so.

⚠️ **The counterweight is real and was accepted, not missed:** this removes a
rung from the paid ladder. What paid tiers keep selling is storage quota, large
video uploads and the higher bands — not the delivery path.

**The matrix half.** These documents tracked prices; nothing owned the feature
matrix, which is why `mediaCdn` could be gated, published on `/pricing`, drawn
in Figma, and recorded in no pricing document at all. It is now generated from
`PLAN_ENTITLEMENTS` and CI-checked, because a hand-kept 8×34 table drifts on
the first change nobody mirrors — the exact failure being fixed.

---

## 2026-08-24 — Aglyn **is** a marketplace facilitator; commerce and plugin selling ship Sept 1

- **Decided by:** the account owner — Aglyn accepts marketplace-facilitator status, and commerce plus plugin selling ship on Sept 1. Gating storefront payments off for the beta was offered and **rejected**; do not re-propose it.
- **Scope:** packaging, tax, commerce
- **Evidence:** `f6131ace9`, `f7e5465f5`, `76cd31488` (AGL-1956); `npm run check:facilitator-charge-shape`; `CommerceModel.destinationChargeParams()` in `libs/plugins/commerce/src/lib/model/commerce-connect-transfer.ts`; Texas registration under AGL-1811

Every buyer-facing charge is a **destination charge** on Aglyn's own platform
account — `destinationChargeParams()` emits
`payment_intent_data[transfer_data][destination]`, and `Stripe-Account` /
`on_behalf_of` appear **nowhere in executable code**. Funds settle into Aglyn's
balance first and transfer out.

⚠️ **So Aglyn is the merchant of record, not the tenant.** Aglyn eats chargebacks
from its own balance and the shopper sees `AGLYN` on the statement. The design
that would have made the *merchant* the merchant of record is **direct** charges
(a `Stripe-Account` header, the Shopify shape) and that is not what was built.
Anyone reading "merchant of record = the merchant" into this decision has it
backwards, and every tax consequence follows from the real shape: facilitated
tenant sales count toward **Aglyn's own** economic-nexus thresholds.

⛔ The Texas taxpayer number is recorded in Linear. It must never appear in this
repo, in a file or in a commit message.

## 2026-08-24 — `LEGAL_DOCUMENT_VERSION` stays `v1` until launch; the hashes still move

- **Decided by:** the account owner — nothing has released, so no v2 exists to supersede a v1 nobody has accepted. Changes land inside v1 and the hashes are re-pinned.
- **Scope:** legal, change-control
- **Evidence:** `apps/console/constants/legal-documents.ts:75` and its docblock; `npm run check:legal-snapshots`

Pre-release with zero accepted acceptances, a `v2` would assert a version
history that never happened. Substantive changes fold **into** v1.

**The half that is not suspended:** the clickwrap hashes are still re-pinned
whenever the published text changes, and the re-captured bytes are archived over
`Acceptance-Snapshots/v1/<key>.txt` on Drive in the same pass. "Stay on v1" moves
the *label*, not the pin — a stale pin breaks clickwrap in the worse direction.
Re-acceptance itself stays.

⛔ Do not edit a legal document or a legal page from this file's authority.
Gdoc-first, and several are mid-publication.

## 2026-08-24 — Advertising consent is narrowed back to explicit opt-in

- **Decided by:** conformance to the **published** Privacy/Cookie policy, which is the authority — not a new product decision. Implemented under AGL-1649.
- **Scope:** policy, consent
- **Evidence:** `b42c1b071` (advertising requires an explicit yes, as the published policy states), preceded by `ca324b4e6`

Consent had been widened so advertising rode along with a broader grant; the
published policy promises an explicit yes. Recorded here so the next reader who
finds the switch narrower than some tag documentation assumes has an answer that
is not "someone tightened it."

## 2026-08-24 — Under a read-only lockdown the analytics counters keep counting; host automations do not fire

- **Decided by:** an agent, recorded in-repo at the time — **not** an owner decision. Stands until contradicted.
- **Scope:** packaging, billing
- **Evidence:** `87dd09687` (AGL-1627); `apps/docs/docs/staff-console/lockdown.md` → "The analytics beacon, which a read-only lock splits in half"

It belongs in a *packaging* log rather than a security one because those same
counters are the meter. `/api/billing/report-usage` reads the same
`hosts/{id}/analytics/{day}` documents that decide the **free plan's bandwidth
band** and arm the **abuse ceiling**. A lock that froze them would under-bill a
site that is still being served and quietly disarm a protection. The write half
— firing host automations from inside a route named "analytics" — is exactly
what a read-only lock is for, and it stops.

## 2026-08-23 — The site-member / lead abuse ceiling is platform-wide, **not** a plan dimension

- **Decided by:** the account owner, from four options — a flat, generous abuse ceiling. Alert-only was declined explicitly: detection without protection.
- **Scope:** packaging
- **Evidence:** `aa29892e5`, `e32a93ea1` (AGL-1529); `libs/aglyn/src/lib/app-utils/visitor-record-ceiling.ts`

`hosts/{hostId}/siteMembers` and `hosts/{hostId}/leads` are written by anonymous
visitors on a public site and were bounded by nothing — the per-(host, IP) rate
limiter fails soft and bounds the **rate**, not the total.

⛔ **Do not add it to `PLAN_ENTITLEMENTS`.** the reasoning has to survive into
the code: a platform-wide ceiling keeps *"unlimited member accounts on every
plan"* literally true, **because an abuse control is not something we sell**.
AGL-889's "unlimited on every plan" is a pricing promise and `/pricing` must stay
true under the Sept-1 lock. Same instrument already approved twice — AGL-1655
(forms) and AGL-2155 (bandwidth).

## 2026-08-21 — Agency's contacts overage rate is removed; its band is unlimited

- **Decided by:** the account owner — the band is unlimited, so the overage rate is dropped rather than left advertising a fee that cannot be charged
- **Scope:** pricing
- **Evidence:** Drive Pricing Decision Log, entry `2026-08-21`

Not an exception to the lock: an unlimited band has no "over", so the advertised
rate was unreachable and nobody was ever charged it. A false advertisement, not
a mis-charge. Full arithmetic in the Drive entry.

## 2026-08-20 — Lodging and service tax become merchant-settable, default off

- **Decided by:** the account owner (AGL-1969, AGL-2028)
- **Scope:** pricing, tax
- **Evidence:** Drive Pricing Decision Log, entry `2026-08-20`

The merchant sets the rate; Aglyn computes, records and stamps it, and the copy
says plainly that determining what they owe is theirs. Ships the mechanism
without Aglyn taking a tax position. **Default-off means no existing merchant's
charge changes**, so the Sept-1 lock holds.

## 2026-08-19 — The margin lock is lifted for exactly three leaks, and for nothing else

- **Decided by:** the account owner, selecting **all three** options — each leak is a path that sells something below what it costs to deliver, and the floor is set at break-even rather than at a chosen number
- **Scope:** pricing
- **Evidence:** AGL-2152, AGL-2111, AGL-2343; Drive Pricing Decision Log, three entries dated `2026-08-19`

The three: the physical-goods transaction fee (0% on a destination charge is a
loss, not a break-even), cash/folio POS tenders recording no fee (the fee
attaches to the **sale**, not the tender), and the absent marketplace listing
minimum (the fixed 30¢ component dominates a small order).

⚠️ This is a **narrow, explicit exception**. The standard set is * not
losing money* — derived from break-even arithmetic, not a round number. The
rest of the lock holds: visibility may change, **the charged price may not**.

## 2026-08-19 — The free tier hard-caps at three workspaces per person, with a staff-console control

- **Decided by:** the account owner — three per person, with a staff-console control to raise it. It serves the standing requirement that the free tier hard-caps so it always actually stays free.
- **Scope:** packaging
- **Evidence:** `81c432500` (AGL-2265)

The limit is **stored and staff-editable**, not a constant behind a redeploy.
Two traps this area has already hit: a create-time quota can be laundered (lower
the count, create, restore), and a loading default that answers as a real value.

## 2026-08-18 — The Sept-1 launch price set is LOCKED

- **Decided by:** the account owner — the whole set is locked as listed; the partial-lock and hold-the-republish alternatives were offered and declined
- **Scope:** pricing
- **Evidence:** Drive Pricing Decision Log, entry `2026-08-18`; the `LOCKED` pin in `tools/scripts/check-pricing-drift.mjs`; `apps/console/specs/published-pricing-table-parity.spec.ts`; AGL-1885

Figures live in the Drive entry, in the `LOCKED` pin, and on `/pricing`. They are
deliberately **not** restated here — a second copy of a price is the copy that
goes stale, which is why `check:pricing-drift` refuses one in `apps/docs` too.

Three riders that keep being rediscovered as if they were bugs:

1. **The boundary.** Tier *visibility* may change and how prominently a tier is
   shown may change. **What is charged may not.** That is the line the retention
   work (AGL-1859) runs inside.
2. **`/pricing` publishes TWO different per-GB-month prices, and both are
   correct.** `storagePerGbMonth` (metered infra pass-through,
   `apps/console/utils/usage-metering.ts`) and `extraDataGbMonthlyUsd` (the
   dataset storage add-on retail rate, `plan-entitlements.ts`) are different
   quantities and are indistinguishable from the page alone. ⛔ Neither is a
   drift to "fix". Confirm which constant you are holding before editing any
   per-GB figure anywhere.
3. **Figma frame `92:107` is the stale artifact, not the site.** It still carries
   the pre-correction metered rates, and its form-submission figure is **off by
   10×**. ⛔ The live page is right. An audit that treats Figma as ground truth
   and "corrects" the site would move a locked customer-facing price by an order
   of magnitude. Diff **layout** against Figma, never prices.

Also standing: `METERED_UNIT_RATES_USD` and `ORG_COGS_UNIT_RATES_USD` carry the
same three figures and must never drift apart; no grandfathering or price-lock
language may appear anywhere (ToS §§4.7 / 5.5 / 6.5); and any winback coupon is
`duration: once` or a short `repeating`, **never `forever`** (the AGL-1735
lesson, enforced by `assertBoundedWinbackCoupon`).

---

# Open decisions

Not decided. Listed here because each one is **blocked on the log existing** —
they are packaging or disclosure calls whose change-control legs could not be
described until there was somewhere to describe them. ⚠️ None of these may be
resolved by an agent; each needs the account owner.

### Entry scheduling: is it `scheduledPublishing`, or deliberately free?

**Screen and layout scheduling is entitlement-gated. Collection-entry scheduling
is not — on any path.** Verified 2026-08-24 (AGL-1859), and the read-time flip
re-verified independently for this entry:
`libs/tenant/runtime/src/lib/get-collection-content.ts:250` updates a due entry
to `status: 'published'` at render time, and the file contains no entitlement
check at all — it never loads the org, so it structurally cannot make one. The
console write (`content/page.tsx`) is a client-direct `updateDoc`, the Firestore
rules are role-only, and bundle import restores `publishAt` through a second,
separately-gated entry point (`app/api/_lib/site-export.ts`).

So a free org can schedule blog posts today and they will publish, while
`scheduledPublishing` is a paid entitlement. Closing it is an **entitlement**
change — this log's change-control rule applies in full — and it revokes a live
capability from orgs that may be relying on it, on the eve of a public beta.

⚠️ Trap for whoever closes it: `resolveOrgEntitlements(null)` resolves to **free**
defaults, so a gate on a read path that fails to load the org would silently stop
a paying customer's scheduled posts. The fail direction is closed, and that is a
content outage.

**The open question: does entry scheduling count as `scheduledPublishing`, or
is it a free capability on purpose?**

### The marketplace take rate is undisclosed on `/pricing`

`resolveMarketplaceFeePct` charges **20% on paid plans and 30% on Free**
(`libs/aglyn/src/lib/app-utils/plan-entitlements.ts:184`, `:257` … `:692`,
resolver at `:2391`). `release_marketplace` is on in production and commerce
ships launch day, and the page does not say it. A seller finds out at settlement.

Disclosure is besigner click-work on the `aglyn-marketing` host — publication-first,
not a repo change — plus a Drive Decision Log entry. **Blocked on the account
owner:** the copy, and whether the Free-plan 30% is disclosed as such.

### `/pricing` tier visibility — the republish itself

AGL-1859 §1's console half shipped (`e37e4e98b`: lower tiers collapse behind a
disclosure, upgrades stay one-click). The `/pricing` half is hand-authored
besigner content and no repo change can do it (AGL-2261). Until it happens
AGL-1885's post-republish reconciliation — the pass that reads the **live** page,
which is the only thing that proves what the edit produced — cannot run.

### The re-acceptance banner copy

Carried into AGL-1908's brief as a requirement: re-acceptance stays, but the
banner must not imply the user never agreed. ⚠️ **Recorded as a question, not a
decision** — no quote stands behind it, and the console's current no record of your acceptance copy is literally true pre-launch. Needs his read
before any wording moves, and any change is gdoc-first if it touches a legal page.

### Event Calendar packaging

`eventCalendar` is false on every plan including Advanced; only the add-on
enables it. Bundle it into Advanced, or keep it add-on-only? Open in the Drive
Source of Truth's alignment table; `/pricing` currently documents the behaviour
without pre-empting the call.
