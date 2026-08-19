# AGL-1370 — `totalSiteSizeMb` and `bandwidthGb`: enforce, meter, or unpublish

Status: decided and **half implemented**. Filed out of AGL-1367's quota sweep.

The code half of the execution list below is landed: the plan card's `· {n}
site` clause (step 1), the console usage meter's site-size row (step 2), and
the dead `siteSize` check in the usage-alerts cron (step 4) are gone; the
entitlement, the rollup measurement and the staff override editor stay (step
5), as does everything to do with `bandwidthGb`.

**Outstanding: step 3**, the marketing `/pricing` comparison row. It is
besigner work — the "Total site size" row appears in both the desktop table
and the mobile per-plan list, so two canvas edits plus a revalidate.

## Verdict up front

The issue treats the two numbers as one problem. They are two different
problems, and only one of them is real.

- **`bandwidthGb` is already metered.** It is not decoration and it is not
  unenforced — it is the *included band* of the page-view meter, and going
  past it already costs money. The issue's premise is wrong here. **Keep it,
  fix one line of console copy.**
- **`totalSiteSizeMb` is decoration, and worse than the issue thought.** It
  is not merely unenforced: on every plan it is **structurally unreachable**,
  so even the warning email it was built to power can never fire. **Remove
  it from both surfaces.**

Neither answer is "add a wall". Recommended change is copy-only.

## Facts established

### `bandwidthGb` is the page-view band — it is not a second name, it is the band

`apps/console/utils/usage-metering.ts:135-137` converts it directly into the
included page-view allowance:

```ts
pageViews:
  (entitlements.bandwidthGb * 1024 * 1024 * 1024) /
  ESTIMATED_PAGE_TRANSFER_BYTES,
```

That value is subtracted in `estimateMonthlyUsageCost` (`:201`), priced at
`perPageView`, marked up 1.3, and emitted as the Stripe meter event by
`apps/console/app/api/billing/report-usage/route.ts`. So `bandwidthGb`
already **decides money on every metered plan**.

`docs/STRIPE_GO_LIVE.md:95-98` states it in as many words — the included
bands are "`hostLimit × storagePerHostMb`, **`bandwidthGb` converted to page
views**, `hostLimit × formSubmissionsPerMonth`".

The published `/pricing` copy is already honest about this. The metered rate
table's first row is literally:

> **Page views (bandwidth + reads)** — $0.13 / 1,000

and the section lead-in reads:

> On Starter through Agency plans, page views, form submissions, and site
> storage past the amount your plan includes are metered at our
> infrastructure cost plus a 30% margin. You are not cut off when you go past
> a band — the overage is itemized on your invoice.

So on `/pricing`, "Bandwidth / mo — 5 GB … 20 TB" is a **band**, sitting next
to a section that says bands are metered and names bandwidth as the thing the
page-view meter prices. That is one coherent story already.

**Answer to "does `bandwidthGb` duplicate metered page views?"** — Yes, they
are the same resource, but it is not a double charge and not a second cap.
Page views are the *unit*; `bandwidthGb` is the *band* expressed in the unit
customers understand. One is derived from the other by a single constant
(`ESTIMATED_PAGE_TRANSFER_BYTES`, 600 KB), used in both directions — forward
in `usage-metering.ts:136`, backward in `usage-alerts/route.ts:119-120`.

The only place it reads as an unbacked cap is the **console plan card**
(`billing-plan-cards.component.tsx:284-286`), which renders a bare
`5 GB bandwidth` line with none of the band/meter framing `/pricing` carries.

### `totalSiteSizeMb` is unreachable on every plan

It is a different resource from `storagePerHostMb`. It measures the
**published canvas payload** — the `nodes` field of each screen's and
layout's current version — summed org-wide by `orgSiteSizeBytes`
(`report-usage/route.ts:97-127`). `plan-entitlements.ts:35-36` says so:
"storage-per-host is media storage and exceeds the published total-site-size
cap by design."

Its complete reader set is three call sites, and none of them refuses
anything:

| Reader | What it does |
| -- | -- |
| `report-usage/route.ts:275,330` | measures it, writes `siteSizeMb` to the rollup |
| `usage-alerts/route.ts:139,197-201` | warns at 80% / 100% |
| `billing-usage.component.tsx:287-292` | draws a meter |

Grep confirms no other reader exists anywhere — not in `apps/tenant`, not in
`libs/tenant`, not in `libs/plugins`, not in the Firestore rules.

**The decisive fact:** a per-document wall already exists one level down.
`measure-node-map.ts:29` refuses any node map over `NODE_MAP_MAX_BYTES =
900_000` (AGL-678), enforced on save in
`use-besigner-document.ts:397`. Site size is measured over at most
`min(screensPerHost, 200) + min(sharedLayoutsPerHost, 50)` documents per host
(the `.limit()` calls in `orgSiteSizeBytes`). So the maximum value the
measurement can *ever* produce is bounded, and it is nowhere near the cap:

| Plan | Max measurable | Advertised cap | % of cap |
| -- | -- | -- | -- |
| Free | 5.1 MB | 100 MB | 5.1% |
| Starter | 24 MB | 1 GB | 2.3% |
| Pro | 386 MB | 5 GB | 7.5% |
| Business | 2.1 GB | 25 GB | 8.4% |
| Scale | 3.1 GB | 37.5 GB | 8.4% |
| Advanced | 5.2 GB | 50 GB | 10.5% |
| Agency | 21 GB | 100 GB | 20.9% |

That is the *theoretical ceiling* with every published document at the
900 KB refusal threshold. Real payloads run ~10–30 KB, so a real Free site
sits near **0.1%** of its 100 MB cap.

The alert threshold is 80% (`usage-alerts/route.ts:214`). **No plan can
reach it.** The warning email AGL-1107 built has never fired and cannot fire.

### What each number would mean if enforced

- **`totalSiteSizeMb`** — the refusing operation would be *publishing a
  screen*, and the customer would see their site frozen: no further content
  changes until they delete pages. There is no incremental degradation and
  no upgrade-in-place. This is the harshest possible refusal in the product,
  attached to the cheapest resource we sell (Firestore document bytes, which
  do not appear as a distinguishable line on the GCP invoice — the whole
  platform's July storage billed inside the free tier).
- **`bandwidthGb`** — the refusing operation would be *serving a tenant
  page*, i.e. taking a paying customer's public website offline mid-month.
  This directly contradicts the sentence published on `/pricing` tonight.

### Do the surfaces contradict each other?

Partially, and not where the issue expected.

- `/pricing` publishes **both** rows in its comparison table: "Total site
  size" (100 MB → 100 GB) and "Bandwidth / mo" (5 GB → 20 TB). Verified
  against the live page HTML, not inferred.
- The metered section names **three** metered items: page views, form
  submissions, site *media & file* storage. "Total site size" is not one of
  them, and is not `storagePerHostMb`. So on `/pricing` it is the third
  category the issue named — a number that is neither a band nor a cap.
- The **console plan card** compresses two unlike things into one line
  (`billing-plan-cards.component.tsx:280-286`): `250 MB storage · 100 MB
  site` then `5 GB bandwidth`. A customer cannot tell that the first is a
  metered band, the second is nothing, and the third is a metered band in
  different units.

## The three options, costed

### 1. Enforce

- **`bandwidthGb`**: rejected outright. Enforcing it means 503-ing a paying
  customer's live site, and it would falsify the "You are not cut off"
  sentence published tonight. It also *un-does* AGL-1280, which removed
  exactly this shape of double treatment from form submissions.
- **`totalSiteSizeMb`**: ~1 day (a check in the version-publish path plus a
  counter, since no cheap live total exists — the current measure is an
  O(hosts × published docs) rollup, far too expensive per publish). Cost is
  real; benefit is zero, because the cap cannot be reached. It would be a
  wall in front of a door no one can walk through.

**Cost: 1 day. Value: none. Risk: an unannounced publish-blocker.**

### 2. Meter

- **`bandwidthGb`**: already done. Zero work.
- **`totalSiteSizeMb`**: we would be billing for Firestore document bytes
  that are already inside the media-storage meter's cost basis conceptually
  and are individually negligible. It would add a fourth line to a rate table
  whose other three rows are calibrated against real infra costs; this one
  would be calibrated against nothing. **Rejected** — it makes the invoice
  longer and the rate table less honest.

**Cost: ~0.5 day. Value: negative.**

### 3. Remove from the cards

- **`totalSiteSizeMb`**: delete the card line, delete the `/pricing`
  comparison row, keep the field in `PLAN_ENTITLEMENTS` and the internal
  measurement (it is genuinely useful operationally — it is how we would
  notice a runaway canvas). Nothing enforced changes; nothing billed changes.
- **`bandwidthGb`**: do *not* remove. It is load-bearing — deleting it would
  delete the page-view band and make every metered plan bill from unit zero,
  which is precisely the AGL-1280 bug.

**Cost: ~1 hour of copy. Value: the cards stop making a claim we do not back.**

## Recommendation

**Option 3 for `totalSiteSizeMb`. Option 2 for `bandwidthGb` — already
shipped; relabel it in the console only.**

Rationale: the platform's model is *bands you pay past*, with Free the
deliberate hard-capped exception. `bandwidthGb` already fits that model
exactly and is described correctly on `/pricing`. `totalSiteSizeMb` fits no
model, protects nothing, costs nothing to exceed, and cannot be exceeded. The
honest move is not to publish it.

This keeps the promise that the metered pass-through exists so customers are
not cut off, and it removes the only genuinely unbacked number rather than
adding a wall to justify it.

## Execution

Copy changes, no enforcement work:

1. **Console plan card** — `apps/console/components/billing/billing-plan-cards.component.tsx:280-286`.
   Drop the `· {n} site` clause; relabel bandwidth as an included band, e.g.
   `5 GB bandwidth included` for metered plans, so the card matches
   `/pricing`. One component, no logic.
2. **Console usage meter** — `billing-usage.component.tsx:287-292`. Remove
   the "Total site size" row (see defect 3 below before touching the
   bandwidth row).
3. **Marketing `/pricing`** — delete the "Total site size" comparison-table
   row. Built by clicking, in the besigner; the row appears in both the
   desktop table and the mobile per-plan list, so **two** edits, then a
   revalidate. Leave "Bandwidth / mo" exactly as it is — it is correct.
4. **Usage-alerts cron** — `usage-alerts/route.ts:194-201`. Drop the
   `siteSize` check (dead — cannot fire). Keep the `bandwidth` check: it is a
   useful pre-invoice heads-up now that overage is billed.
5. **Keep** `totalSiteSizeMb` in `PLAN_ENTITLEMENTS`, the rollup measurement,
   and the staff override editor. Internal-only.
6. `plan-entitlements.spec.ts:119-122` asserts
   `storagePerHostMb > totalSiteSizeMb` and the enterprise `UNLIMITED` value.
   Both still hold if the field stays; no change needed unless it is deleted.

## Defects found in passing (not part of this decision)

All three were filed as **AGL-1371** and are **fixed**. Recorded here because
they change the execution notes above.

1. **The site-size measurement silently truncated.** `orgSiteSizeBytes` capped
   at `.limit(200)` screens and `.limit(50)` layouts per host, but Business
   and above have `screensPerHost: UNLIMITED`. Past 200 screens the number
   quietly undercounted. ~~Harmless today because nothing acts on it~~ — now
   a paged sweep to `SITE_SIZE_DOC_CEILING` (5,000 docs/host), and hitting the
   ceiling writes `siteSizeTruncated: true` onto the rollup rather than
   shrinking the figure in silence.
2. **The console meter and the cron used different numerators.** `host-usage`
   returned **per-host** site size and bandwidth and the meter rendered them
   against the **org-wide** `totalSiteSizeMb` / `bandwidthGb`, while
   `usage-alerts` and the invoice both used the **org-wide sum**. The invoice
   is the authority and it was right; the meter was the bug. Both rows are now
   org-level, rendered once in `BillingUsageComponent`.
3. **The bandwidth meter row understated by `hostLimit`.** Same root cause as
   2. The org-wide sum is computed through `orgBandwidthGb`, and the
   `bandwidthGb ⇄ pageViews` conversion all three surfaces need is one pair of
   functions in `usage-metering.ts` instead of three hand-rolled copies.

### What that means for the execution list above

- **Step 2 is now a one-line delete.** The site-size row moved to
  `BillingUsageComponent` ("Total site size (organization)") and reads
  `siteSizeMb` off the monthly rollup. Removing it is deleting that one
  `<UsageMeter>`; no measurement code goes with it.
- **The AGL-1371 work is not undone by removing the row.** The truncation fix
  lives in `orgSiteSizeBytes`, which step 5 keeps deliberately ("internal-only,
  it is how we would notice a runaway canvas"). The conversion helpers and the
  org-wide bandwidth sum serve the bandwidth row, which step 3 keeps.
- **Step 4 still stands.** The `siteSize` check in `usage-alerts` is still
  unreachable for the reason this memo gives — a bounded measurement against an
  unreachable cap — and dropping it is still the right call.
- `host-usage` no longer returns `siteSizeBytes`; its live per-site sweep had
  exactly one reader and that reader now uses the rollup.

---

## Addendum (AGL-2155): the FREE half of the verdict above was wrong

"`bandwidthGb` is already metered … going past it already costs money" is true
on every plan that carries `meteredInfraPassThrough` — and free does not. On
free the same sentence inverts: going past the band costs **us** money and the
customer nothing, because free's `perPageView` rate is `null` by design (see
`apps/console/specs/free-tier-never-billed.spec.ts`). A metered band is not an
enforcement mechanism for a plan with no meter, so on free `bandwidthGb` was
exactly the decoration this document acquitted it of being.

That left bandwidth as the one free dimension with no runtime brace at all
while every other one had one — media storage (`mediaStorageGate`), form
submissions (`checkFormSubmissionQuota`), dataset storage and API (zero bands),
contacts (a hard band). A free site that went viral served a million page views
— about **$100 of real COGS** — against a $0 invoice, with nothing anywhere
refusing a view.

AGL-2155 adds `checkBandwidthAbuseCeiling`, built on
`checkFormSubmissionAbuseCeiling`'s precedent: a containment ceiling an order
of magnitude above the included band (floor 100,000 page views/month), not a
plan gate. It is evaluated in `/api/analytics/collect` — where the counter is
already written, after the render — and stamps `hosts/{id}.bandwidthCeiling`,
which the tenant loader reads off a host document it already loads. The render
path therefore pays **no extra Firestore read**, which is the objection that
kept this open.

Crossing it flags the host and escalates to staff on every plan. It changes
what visitors see only where the overage is **uncompensated** — i.e. free —
because taking a paying customer's site off the air would trade a bill they
agreed to for an outage they did not. Whether a paying host past its own
ceiling should also be degraded is left open: it is the single
`bandwidthCeilingDegradesRender` predicate.
