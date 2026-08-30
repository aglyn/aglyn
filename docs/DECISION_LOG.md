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

## 2026-08-30 — The saved-form catalog becomes a plan allowance; Advanced and above are uncapped

- **Decided by:** the account owner — forms belong on the pricing tables, the marketing site, the billing dashboard and the add-ons surface, with Enterprise unlimited and "50 is tiny for Agency and Enterprise".
- **Scope:** packaging
- **Evidence:** `OrgEntitlements.formsPerHost`, new; `PLAN_ENTITLEMENTS[*].formsPerHost` = 0 / 50 / 200 / 500 / 1,000 / Unlimited / Unlimited / Unlimited; enforced at `apps/console/app/api/hosts/resources/route.ts` (`quotaKey`, inside the create transaction); `libs/aglyn/src/lib/app-utils/forms.ts` (`FORMS_MAX_PER_HOST` is now a listing bound, not a ceiling); published by `tools/marketing/pricing-copy/tables.json` and `apps/console/components/billing/*`; competitor table in Drive → Pricing & Packaging → 05-Pricing-Decision-Log.

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

| Plan | Saved forms / site | Nearest metering comparator |
|---|---|---|
| Free | — | HubSpot/Typeform/Mailchimp give free forms; see the open question below |
| Starter $25 | 50 | Wix Core 10 @ $29 · Jotform Bronze 25 @ $39 |
| Pro $56 | 200 | Wix Business Elite 75 @ $159 · Jotform Gold 100 @ $129 |
| Business $139 | 500 | past every published competitor number |
| Scale $249 | 1,000 | — |
| Advanced $399 | Unlimited | matches the tier's "headroom on every limit" posture |
| Agency $799 | Unlimited | — |
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
