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
   invoice month before attaching the metered price in live mode.
6. **Annual subscriptions carry no metered item.** `aglyn_metered_usage` is
   a monthly price and Stripe forbids mixed `recurring.interval` on one
   subscription, so AGL-1340 attaches it to monthly checkouts only. Until a
   yearly metered price exists (or flexible billing mode is enabled), annual
   customers accrue rollups and meter events that reach no invoice. Decide
   that before telling annual customers they are metered.
