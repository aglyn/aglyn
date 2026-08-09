/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// READ-ONLY audit: which paying subscriptions bill no usage overage (AGL-1352).
// Issues GET requests only — it writes NOTHING, to Stripe or anywhere else.
//
//   STRIPE_SECRET_KEY=sk_… node tools/scripts/audit-metered-coverage.mjs [--json]
//
// WHY THIS EXISTS
//
// A paid subscription with no metered item is invisible. The plan is right,
// the entitlements are right, the invoice looks right — the only trace is
// usage revenue that never arrives. Metered overage is what makes the
// published "infrastructure cost + 30%" commitment true and what stops an
// unmetered org consuming unbounded page views, form submissions and storage
// at flat rate. So the population has to be asked directly; no individual
// code path can answer it.
//
// `apps/console/specs/metered-coverage.spec.ts` is the companion that guards
// the CODE (every subscription-mutating route resolves the metered price).
// This one guards the DATA.
//
// WHAT IT REPORTS
//
//   unmetered   — billable subscription, paid plan, no metered item. Money.
//   mismatched  — a metered item whose interval differs from the plan's.
//                 Stripe forbids mixed recurring.interval, so this should be
//                 impossible; if it appears, something bypassed the API.
//   portal      — whether the customer portal may change plans. Enabling
//                 `subscription_update` opens a whole subscription-mutating
//                 path with one dashboard click and no code review, so its
//                 state belongs in the same report as the population.
//
// Exits non-zero when anything is flagged, so it can run as a scheduled check.

const asJson = process.argv.includes('--json')
const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) {
  console.error('Missing STRIPE_SECRET_KEY')
  process.exit(1)
}

/** GET only. There is no write path in this file, by construction. */
async function get(path) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Stripe GET ${path} failed`)
  }
  return body
}

async function* paginate(path) {
  let startingAfter = null
  for (;;) {
    const separator = path.includes('?') ? '&' : '?'
    const page = await get(
      `${path}${separator}limit=100${
        startingAfter ? `&starting_after=${startingAfter}` : ''
      }`,
    )
    for (const item of page.data) yield item
    if (!page.has_more || !page.data.length) return
    startingAfter = page.data[page.data.length - 1].id
  }
}

/**
 * A price is metered iff Stripe says it reports to a Billing Meter. Asking the
 * price itself rather than comparing against STRIPE_PRICE_METERED* is
 * deliberate: env drift is one of the things this audit needs to be able to
 * SEE. A subscription carrying the right kind of price but not the id the app
 * is configured with should still read as metered here, and the mismatch
 * should surface as configuration, not as a missing item.
 */
const isMeteredPrice = (price) =>
  Boolean(price?.recurring?.meter) || price?.recurring?.usage_type === 'metered'

/** Statuses that bill, and therefore should meter. */
const BILLABLE = new Set(['active', 'trialing', 'past_due'])

const results = {
  livemode: null,
  checked: 0,
  unmetered: [],
  mismatched: [],
  portalMayChangePlans: null,
  meteredPrices: [],
}

// The metered prices that exist on this account, for the report header.
for await (const price of paginate('prices?active=true')) {
  if (isMeteredPrice(price)) {
    results.meteredPrices.push({
      id: price.id,
      interval: price.recurring?.interval ?? null,
      meter: price.recurring?.meter ?? null,
    })
  }
}

// The portal is a subscription-mutating path that lives in the dashboard, not
// in the repo, so nothing in CI can see it change.
for await (const configuration of paginate('billing_portal/configurations')) {
  if (!configuration.is_default && results.portalMayChangePlans !== null) continue
  const enabled = configuration.features?.subscription_update?.enabled === true
  if (configuration.is_default || enabled) {
    results.portalMayChangePlans = enabled
  }
}

for await (const subscription of paginate('subscriptions?status=all')) {
  if (!BILLABLE.has(subscription.status)) continue
  results.livemode ??= subscription.livemode
  results.checked += 1
  const items = subscription.items?.data ?? []
  // The plan item carries the interval every other item must match. Anything
  // metered is excluded first, so it can never be mistaken for the plan.
  const planItem =
    items.find((item) => !isMeteredPrice(item.price) && item.price?.recurring) ??
    items[0]
  const interval = planItem?.price?.recurring?.interval ?? 'month'
  const meteredItems = items.filter((item) => isMeteredPrice(item.price))
  const row = {
    subscription: subscription.id,
    customer: subscription.customer,
    orgId: subscription.metadata?.orgId ?? null,
    plan: subscription.metadata?.plan ?? null,
    status: subscription.status,
    interval,
    periodStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString().slice(0, 10)
      : null,
    periodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString().slice(0, 10)
      : null,
    planPrice: planItem?.price?.id ?? null,
  }

  if (!meteredItems.length) {
    // `free` never has a subscription, and an enterprise deal is billed on a
    // negotiated ad-hoc price whose usage terms are in the contract — neither
    // is a finding. Everything else that pays should meter.
    if (subscription.metadata?.plan !== 'enterprise') {
      results.unmetered.push(row)
    }
    continue
  }
  const wrong = meteredItems.filter(
    (item) => item.price?.recurring?.interval !== interval,
  )
  if (wrong.length) {
    results.mismatched.push({
      ...row,
      meteredPrices: wrong.map((item) => item.price.id),
    })
  }
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log(
    `\nMETERED COVERAGE — ${
      results.livemode === true ? 'LIVE' : results.livemode === false ? 'TEST' : 'no billable subscriptions'
    } mode\n`,
  )
  console.log(
    `metered prices on the account: ${
      results.meteredPrices.map((p) => `${p.id} (${p.interval})`).join(', ') ||
      'NONE — nothing can bill usage at all'
    }`,
  )
  console.log(
    `customer portal may change plans: ${
      results.portalMayChangePlans === true
        ? 'YES — that path bypasses the in-app switch'
        : results.portalMayChangePlans === false
          ? 'no'
          : 'unknown (no configuration)'
    }`,
  )
  console.log(`billable subscriptions checked: ${results.checked}`)

  if (results.unmetered.length) {
    console.log(`\n⚠ ${results.unmetered.length} PAYING BUT UNMETERED:`)
    for (const row of results.unmetered) {
      console.log(
        `  ${row.subscription}  org=${row.orgId ?? '—'}  plan=${row.plan ?? '—'}` +
          `  ${row.interval}ly  ${row.status}  period ${row.periodStart}→${row.periodEnd}`,
      )
    }
    console.log(
      '\n  These bill NO usage overage. The webhook back-fill attaches the item\n' +
        '  at the next period boundary (AGL-1352); a period listed above that has\n' +
        '  already rolled without gaining one means the back-fill is not running.',
    )
  } else {
    console.log('\n✓ every billable paid subscription carries a metered item')
  }

  if (results.mismatched.length) {
    console.log(`\n⚠ ${results.mismatched.length} INTERVAL MISMATCH:`)
    for (const row of results.mismatched) {
      console.log(
        `  ${row.subscription}  plan is ${row.interval}ly but metered is ` +
          `${row.meteredPrices.join(', ')}`,
      )
    }
  }
  console.log('')
}

const flagged = results.unmetered.length + results.mismatched.length
process.exit(flagged > 0 ? 1 : 0)
