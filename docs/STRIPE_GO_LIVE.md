# Stripe go-live runbook

Everything needed for tenants to start subscribing. Pricing lives in code
(`libs/aglyn/src/lib/app-utils/plan-entitlements.ts` → `PLAN_PRICING`); this
runbook wires Stripe to it.

## 1. Create products, prices, and the webhook (one command)

```bash
STRIPE_SECRET_KEY=sk_live_... node tools/scripts/setup-stripe.mjs \
  --webhook-url https://<console-domain>/api/billing/webhook
```

Idempotent — prices are keyed by `lookup_key` (`aglyn_{plan}_v2` monthly,
`aglyn_{plan}_v2_yearly` annual, plus `_extra_host` variants; plans:
starter/pro/business/advanced), so re-running reuses them.

**Grandfathering (AGL-307):** the original `aglyn_{plan}` prices are left
untouched — existing subscriptions keep billing at their old price until
the tenant changes plans, at which point checkout uses the v2 prices. Do
not archive the old prices while any subscription references them.
The script prints the env block to paste into the console app's environment
(Vercel project settings):

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`
- `STRIPE_PRICE_*_EXTRA_HOST` (consumed when the extra-host purchase path lands, AGL-39 follow-on)
- `STRIPE_WEBHOOK_SECRET`

### `STRIPE_PRICE_*` are deliberately NOT `sensitive` (AGL-1362)

A price id is an identifier, not a credential — it rides in every checkout
session. Storing one as `type=sensitive` buys nothing and costs the ability to
answer "is production pointed at the right price?", because Vercel never
decrypts a sensitive value: it comes back as an **empty string**. That is a bad
trade when a wrong price id means billing the wrong amount, or not billing at
all. So all 66 of them are stored `type=encrypted` (Vercel's default, still
decryptable by anyone with project access). **Re-adding one as `sensitive`
re-opens the gap.**

The real secrets stay unreadable: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`CRON_SECRET`, `TOKEN_SIGNING_SECRET`. The first two are **team-shared**
variables, which `vercel env ls` and `GET /v9/projects/{id}/env` do not list at
all — check `GET /v1/env?teamId=…` (linkage field `projectId`, singular,
holding an array) before concluding one is missing. Editing a shared variable
can drop every project link, so leave them alone.

To audit what production is pointed at, with no deploy and no writes:

```bash
# what the build actually sees — plaintext for everything non-sensitive
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v3/env/pull/$VERCEL_CONSOLE_PROJECT_ID/production?teamId=$VERCEL_TEAM_ID"

# what Stripe says those ids should be, keyed by lookup_key — GET only
STRIPE_SECRET_KEY=sk_live_… node tools/scripts/setup-stripe.mjs --dry-run
```

The two must agree key for key. ⚠️ `?decrypt=true` on the **list** endpoint
decrypts nothing — it returns ciphertext for `encrypted` and `''` for
`sensitive`. Per-variable `GET /v1/projects/{id}/env/{envId}` is what actually
returns plaintext.

## 2. How the flow works once envs are set

1. Billing page → Upgrade → `POST /api/billing/checkout` (Firebase ID token)
   → Stripe Checkout session with `orgId` + `plan` in subscription
   metadata (AGL-445) → redirect.
2. Stripe → `POST /api/billing/webhook` (signature-verified) on
   subscription created/updated/deleted → the org doc gets
   `plan`/`stripeCustomerId`/`subscription`; plan falls back to the price id
   mapping when metadata is missing (dashboard edits).
3. Entitlement enforcement activates per org **only when `org.plan` is
   set** (dark launch) — nothing changes for existing accounts until they
   check out or staff assigns a plan.

## 3. Verify

- `stripe listen --forward-to localhost:4200/api/billing/webhook` +
  `stripe trigger customer.subscription.created` in test mode, or a real
  test-mode checkout from the Billing page.
- Confirm the tenant doc (`tenants/{uid}`) shows the plan and the Billing
  page chip flips from "no subscription".

## 4. Related, not blocking

- Firestore rules deploy (`firebase deploy --only firestore:rules`) —
  webhook writes use the admin SDK and bypass rules, but the console reads
  tenant docs under the new scoped rules.
- Customer portal (self-service cancel/downgrade) is not built yet; the
  Free card is intentionally non-purchasable.

## 5. Metered usage billing (AGL-41)

**What the code does** (AGL-1280): only usage **beyond the plan's included
storage, bandwidth and form submissions** is priced, at our cost × 1.30. The
bands come from `PLAN_ENTITLEMENTS` — `hostLimit × storagePerHostMb`,
`bandwidthGb` converted to page views, `hostLimit × formSubmissionsPerMonth`
— and each meter is independent. Plans whose `meteredInfraPassThrough` is
false (free, enterprise) are billed nothing however much they use. This
matches the published pricing terms; it did not before, when every unit was
priced from zero.

**Nothing bills until step 1 below is done in the Stripe dashboard.** The
rollup emits meter events, but with no metered price attached to a
subscription product, Stripe records them and charges no one.

1. In Stripe, create a **Billing Meter** with event name
   `aglyn_metered_usage` (or set `STRIPE_METER_EVENT_NAME`), aggregation
   "sum" over `value`, and attach a metered price (per-unit $0.01 — the
   event value is billed **cents**) to each plan's subscription product.
2. Set `CRON_SECRET` and schedule `POST /api/billing/report-usage` with the
   `x-cron-secret` header monthly (e.g. Vercel cron on the 1st); it rolls
   up the previous month per tenant into `tenants/{id}/usageRollups/{month}`
   and emits one idempotent meter event per tenant (value = the OVERAGE at
   cost × 1.30, in cents, plus the dataset/API/contact plan overages).
3. The Billing page shows the same month-to-date estimate to tenants, from
   the same function, so the card and the invoice cannot disagree.
4. Optional usage email (AGL-98): set `RESEND_API_KEY` and
   `USAGE_EMAIL_FROM`, then schedule `POST /api/billing/usage-email` (same
   `x-cron-secret` header) after the rollup; it emails each plan-gated
   tenant one summary per month and stamps `emailedAt` on the rollup.
5. **Validate the rate table** (`METERED_UNIT_RATES_USD` in
   `apps/console/utils/usage-metering.ts`) against a real Firebase + Vercel
   invoice month.

   **Done once, against LIST rates, 2026-08-09 (AGL-1280) — and it still
   needs redoing against a real invoice.** There was no paid month to
   measure: GCP's July 2026 invoice totalled **$0.03**, with every storage
   and egress SKU inside the free tier, and the Vercel team is on **Hobby**,
   which produces no invoice at all. Two rates were wrong and both were
   corrected, because the markup is applied to the figures in that table —
   so a wrong rate does not make us expensive, it makes the published
   "cost + 30%" claim false:

   | rate | was | now | basis |
   | -- | -- | -- | -- |
   | `storagePerGbMonth` | $0.03 | **$0.026** | GCS Standard US multi-region list — the SKU actually on our invoice |
   | `perPageView` | $0.0001 | **$0.0001** (kept) | validated +2% against a real 627 KB cold tenant page load |
   | `perFormSubmission` | $0.0005 | **$0.00005** | ~12 Firestore reads + ~9 writes + 1 invocation; no email, no reCAPTCHA |

   `ORG_COGS_UNIT_RATES_USD` in `plan-entitlements.ts` carries the same three
   figures and was changed with it — they must never drift.

   **Re-validate this table once a real paid month exists**, i.e. once the
   Vercel team is off Hobby and GCP usage clears the free tier. Until then
   the rates are list-derived estimates, not measurements.
6. **One metered price PER BILLING INTERVAL — set both env vars or neither.**
   Stripe forbids mixed `recurring.interval` on one subscription, so AGL-1340
   originally attached the monthly `aglyn_metered_usage` to monthly checkouts
   only, and annual customers accrued meter events that reached no invoice.
   AGL-1280 closed that: `aglyn_metered_usage_yearly` now exists on the SAME
   meter, same product, also $0.01/unit.

   | interval | lookup key | env var | live price id |
   | -- | -- | -- | -- |
   | monthly | `aglyn_metered_usage` | `STRIPE_PRICE_METERED` | `price_1TyhiDDYHP4psn7hRvgSrIvO` |
   | annual | `aglyn_metered_usage_yearly` | `STRIPE_PRICE_METERED_YEARLY` | `price_1U2eZLDYHP4psn7h2EQGEnvV` |

   Checkout and the plan switch pick the price matching the plan's interval
   and skip only when that one is unset. Setting just one means that
   interval's customers silently accrue usage that reaches no invoice — the
   routes warn on exactly that asymmetry, and on nothing else.

   Neither price encodes a rate: the rollup posts an already-computed value
   in **cents**, so changing `METERED_UNIT_RATES_USD` never makes them stale.

   ⚠️ **Setting these makes money move.** Do it only against a deployment
   that already carries the current rate table — verify the bytes at
   `origin/production`, not the branch name. A monthly→annual plan switch
   re-prices the metered item in the same update; `clear_usage` is NOT
   needed (verified against a test-mode subscription — usage lives on the
   meter, not on the item).

   The Billing card's annual caption was updated with the yearly price
   (`components/billing/billing-metered-estimate.component.tsx`) and now states
   the settlement *cadence* rather than claiming the subscription "carries no
   metered item today". It keys off the subscription's own interval, because it
   is a client component and cannot read the env var — which is the other
   reason to set both prices or neither.

7. **Attaching the metered item is not the same as every subscription having
   one** (AGL-1352). Only checkout and the in-app plan switch attach it.
   Everything that changes a subscription on Stripe's side — the customer
   portal, a hand edit in the dashboard — reports back through the webhook,
   and every subscription created *before* these prices were set has no
   metered item at all. Such a subscription is paying, entitled, and bills no
   usage overage whatsoever, with no visible symptom: plan, entitlements and
   invoice all look correct.

   The webhook therefore back-fills the item (`utils/server/metered-backfill.ts`).
   **When** it does is a money decision, controlled by `STRIPE_METERED_BACKFILL`:

   | value | behaviour |
   | -- | -- |
   | *(unset)* / `boundary` | attach only within 72h of a period start — DEFAULT |
   | `immediate` | attach as soon as the item is seen missing |
   | `off` | attach nothing |

   ⚠️ **A mid-period attach retroactively prices the whole period.** Stripe
   aggregates a meter over the *item's* billing period, and an item added
   mid-period inherits the subscription's period start — so it bills every
   event already recorded in that period, including any computed under rates
   that have since been corrected. `boundary` exists so the item's window
   starts empty; a renewal emits `customer.subscription.updated`, so the window
   comes round every cycle without a cron. Its cost is at most one unmetered
   period, which on an annual plan is a year — switch to `immediate` once no
   pre-correction events remain on the meter.

   Enterprise is deliberately excluded: it bills on a negotiated ad-hoc price,
   and adding usage billing to a signed agreement is not a bug fix.

8. **Audit the population, not just the code.**

   ```
   STRIPE_SECRET_KEY=sk_… node tools/scripts/audit-metered-coverage.mjs
   ```

   Read-only (GET only). Reports paying subscriptions with no metered item,
   metered items whose interval does not match the plan, and whether the
   customer portal is allowed to change plans — enabling
   `subscription_update` there opens a subscription-mutating path with one
   dashboard click and no code review. Exits non-zero when anything is
   flagged, so it can run as a scheduled check.

   Its CI counterpart is `apps/console/specs/metered-coverage.spec.ts`, which
   fails the build if a *new* route creates or re-prices a subscription
   without resolving the metered price. That spec guards the code; the script
   guards the data.

9. **Org-library storage is measured but not charged** (AGL-1473), until
   `BILL_ORG_LIBRARY_STORAGE_FROM` names a month.

   The media library has two scopes and the counter follows the scope: a site
   upload moves `hosts/{id}/counters/media`, an org DAM upload moves
   `orgs/{id}/counters/media`. **Both are enforced** against the plan's storage
   cap — the upload route reads the same document it increments. Only the host
   side was ever summed by `report-usage`, `usage-alerts` and the COGS rollup,
   so org-library bytes were gated at upload and then dropped before anything
   priced them. Type-blind: images, PDFs and ZIPs were equally unbilled.

   The measurement is now unconditional. `report-usage` folds the org library
   into `storageGb` and `costUsd` — those feed `orgMonthlyCogsUsd`, and
   under-reporting our own cost makes the discount guardrail more generous —
   and records the split as `orgLibraryStorageGb` plus `orgLibraryBilled` on
   each `orgs/{id}/usage/{month}` document. `usage-alerts` includes it in the
   media-storage warning, because a warning is not a charge and the bytes are
   already enforced.

   | value | behaviour |
   | -- | -- |
   | *(unset)* | measured, recorded, **charged to nobody** — DEFAULT |
   | `YYYY-MM` | that month's invoice and every later one include org-library bytes |
   | anything else | fails closed: charges nothing |

   ⚠️ **Setting this starts billing for bytes customers have already stored.**
   It is a month rather than a boolean precisely because the rollup can be
   re-run for any closed month — a boolean flipped mid-September would
   re-price a January re-run at January's accumulated bytes. Every month before
   the configured one bills exactly what it billed the first time; that is a
   property of the mechanism, not of anyone's care, and
   `apps/console/utils/usage-metering.spec.ts` pins it.

   **Measured 2026-08-13, against production:** four orgs hold **24.8 MB** of
   org-scope media between them, 99.9% of it in one *enterprise* org — which
   does not meter infra overage at all. The two `starter` orgs holding any are
   five orders of magnitude below their 2 GB included band. So turning this on
   today changes **no org's bill by a single cent**, which makes now the
   cheapest moment it will ever be to turn on.

   ### Zach's decision, 2026-08-17 (AGL-1886) — and its condition

   Asked which date this should carry, Zach chose **immediately**, and added a
   condition in his own words: *"also give overage protection and usage
   alerts, so customers don't get a surprise bill."* The condition is not
   garnish — billing turns on only when the protection ships with it.

   **Shipped (AGL-1886), all of it before this variable is set:**

   - The alert can fire at all. `usage-alerts` gained an `orgLibraryStorage`
     check against the library's OWN allowance. The pre-existing org-wide
     media check could never warn about an org-library overage on any plan
     with more than one site: uploads are enforced per scope against
     `storagePerHostMb`, the check compared a summed total to
     `hostLimit × storagePerHostMb`, and on Pro a *full* library reads as 33%
     of the band. An alert that cannot fire reads as coverage.
   - Thresholds are config (`USAGE_ALERT_APPROACH_PCT`, default 80; cap at
     100) and fail TO the default on anything malformed.
   - **Overage protection is a SOFT cap with an acknowledged opt-in**, bounded
     by a monthly ceiling (`org.storageOverage`, written only by
     `/api/billing/storage-overage`). Past the included allowance an upload is
     refused with the price named until a manager opts in, and refused again
     at the ceiling they set. An org that never opts in cannot be billed a
     cent of storage overage, because the bytes were never accepted — see
     `apps/console/utils/storage-overage.ts` for the full hard-vs-soft
     reasoning. Free still hard-bands (no subscription to bill on).
   - The Billing card shows the library's usage **against its own allowance**,
     before any invoice.
   - The rollup records `orgLibraryBilledFrom` verbatim beside
     `orgLibraryBilled`, so a month's audit document says why it billed.

   **THE REMAINING STEP IS ZACH'S**, because setting it starts real invoices:

   ```
   vercel env add BILL_ORG_LIBRARY_STORAGE_FROM production   # value: 2026-08
   ```

   (`2026-08` = the month this shipped. Use the month of the deploy, never an
   earlier one — an earlier month is the one input that would reach backwards.)
