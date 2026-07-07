# Stripe go-live runbook

Everything needed for tenants to start subscribing. Pricing lives in code
(`libs/aglyn/src/lib/app-utils/plan-entitlements.ts` → `PLAN_PRICING`); this
runbook wires Stripe to it.

## 1. Create products, prices, and the webhook (one command)

```bash
STRIPE_SECRET_KEY=sk_live_... node tools/scripts/setup-stripe.mjs \
  --webhook-url https://<console-domain>/api/billing/webhook
```

Idempotent — prices are keyed by `lookup_key` (`aglyn_starter`, `aglyn_pro`,
`aglyn_business`, plus `_extra_host` variants), so re-running reuses them.
The script prints the env block to paste into the console app's environment
(Vercel project settings):

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`
- `STRIPE_PRICE_*_EXTRA_HOST` (consumed when the extra-host purchase path lands, AGL-39 follow-on)
- `STRIPE_WEBHOOK_SECRET`

## 2. How the flow works once envs are set

1. Billing page → Upgrade → `POST /api/billing/checkout` (Firebase ID token)
   → Stripe Checkout session with `tenantId` + `plan` in subscription
   metadata → redirect.
2. Stripe → `POST /api/billing/webhook` (signature-verified) on
   subscription created/updated/deleted → tenant doc gets
   `plan`/`stripeCustomerId`/`subscription`; plan falls back to the price id
   mapping when metadata is missing (dashboard edits).
3. Entitlement enforcement activates per tenant **only when `tenant.plan` is
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

## 5. Metered usage billing (AGL-41, optional)

1. In Stripe, create a **Billing Meter** with event name
   `aglyn_metered_usage` (or set `STRIPE_METER_EVENT_NAME`), aggregation
   "sum" over `value`, and attach a metered price (per-unit $0.01 — the
   event value is billed **cents**) to each plan's subscription product.
2. Set `CRON_SECRET` and schedule `POST /api/billing/report-usage` with the
   `x-cron-secret` header monthly (e.g. Vercel cron on the 1st); it rolls
   up the previous month per tenant into `tenants/{id}/usageRollups/{month}`
   and emits one idempotent meter event per tenant (value = cost × 1.30 in
   cents).
3. The Billing page shows the same month-to-date estimate to tenants.
4. **Validate the rate table** (`METERED_UNIT_RATES_USD` in
   `libs/aglyn/.../usage-metering.ts`) against a real Firebase + Vercel
   invoice month before attaching the metered price in live mode.
