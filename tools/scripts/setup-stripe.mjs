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

// One-command Stripe bootstrap for Aglyn subscriptions:
//
//   STRIPE_SECRET_KEY=sk_... node tools/scripts/setup-stripe.mjs \
//     [--webhook-url https://console.aglyn.io/api/billing/webhook]
//
// Idempotent: prices are keyed by lookup_key (aglyn_{plan}), so re-running
// finds the existing ones instead of duplicating. Prints the env block the
// console app needs (STRIPE_PRICE_* + STRIPE_WEBHOOK_SECRET). Prices mirror
// PLAN_PRICING in libs/aglyn/src/lib/app-utils/plan-entitlements.ts — keep
// the two in sync when pricing changes.

const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET) {
  console.error('Missing STRIPE_SECRET_KEY env var (sk_test_... or sk_live_...)')
  process.exit(1)
}

const args = process.argv.slice(2)
const webhookUrlIndex = args.indexOf('--webhook-url')
const webhookUrl =
  webhookUrlIndex !== -1 ? args[webhookUrlIndex + 1] : undefined

// Mirrors PLAN_PRICING (AGL-278/306/307). The v2 lookup keys leave the
// original aglyn_{plan} prices untouched, so existing subscriptions are
// grandfathered at their old price until the tenant changes plans.
// Add-on unit prices (AGL-525) mirror the extra*MonthlyUsd columns.
const PLANS = [
  { plan: 'starter', name: 'Aglyn Starter', usd: 25, yearlyUsd: 16 * 12, extraHostUsd: 10, extraSeatUsd: 5, extraMemberUsd: 3, extraDatasetUsd: 2 },
  { plan: 'pro', name: 'Aglyn Pro', usd: 56, yearlyUsd: 39 * 12, extraHostUsd: 8, extraSeatUsd: 4, extraMemberUsd: 2, extraDatasetUsd: 2 },
  { plan: 'business', name: 'Aglyn Business', usd: 139, yearlyUsd: 99 * 12, extraHostUsd: 5, extraSeatUsd: 3, extraMemberUsd: 1, extraDatasetUsd: 1 },
  { plan: 'advanced', name: 'Aglyn Advanced', usd: 399, yearlyUsd: 299 * 12, extraHostUsd: 4, extraSeatUsd: 2, extraMemberUsd: 1, extraDatasetUsd: 1 },
]

async function stripe(path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: params ? new URLSearchParams(params) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path}: ${payload?.error?.message ?? response.status}`)
  }
  return payload
}

async function findPriceByLookupKey(lookupKey) {
  const result = await stripe(
    `prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1`,
  )
  return result.data?.[0]
}

async function ensurePrice({
  lookupKey,
  productName,
  usd,
  planMetadata,
  interval = 'month',
  productId,
}) {
  const existing = await findPriceByLookupKey(lookupKey)
  if (existing) {
    console.log(`= ${lookupKey} already exists (${existing.id})`)
    return existing
  }
  const product = productId
    ? { id: productId }
    : await stripe('products', {
        name: productName,
        'metadata[plan]': planMetadata,
      })
  const price = await stripe('prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: String(usd * 100),
    'recurring[interval]': interval,
    lookup_key: lookupKey,
    'metadata[plan]': planMetadata,
  })
  console.log(`+ created ${lookupKey} (${price.id})`)
  return price
}

/**
 * Monthly + yearly price pair for an add-on (AGL-525): add-ons attach to
 * the org's one subscription, and Stripe allows a single interval per
 * subscription, so annual orgs need `_yearly` variants (×12, no discount).
 */
async function ensureAddonPair({ lookupBase, productName, usd, planMetadata }) {
  const monthly = await ensurePrice({
    lookupKey: lookupBase,
    productName,
    usd,
    planMetadata,
  })
  const yearly = await ensurePrice({
    lookupKey: `${lookupBase}_yearly`,
    productName,
    usd: usd * 12,
    planMetadata,
    interval: 'year',
    productId: monthly.product,
  })
  return { monthly, yearly }
}

const env = {}
for (const {
  plan, name, usd, yearlyUsd,
  extraHostUsd, extraSeatUsd, extraMemberUsd, extraDatasetUsd,
} of PLANS) {
  const base = await ensurePrice({
    lookupKey: `aglyn_${plan}_v2`,
    productName: name,
    usd,
    planMetadata: plan,
  })
  env[`STRIPE_PRICE_${plan.toUpperCase()}`] = base.id
  const yearly = await ensurePrice({
    lookupKey: `aglyn_${plan}_v2_yearly`,
    productName: name,
    usd: yearlyUsd,
    planMetadata: plan,
    interval: 'year',
    productId: base.product,
  })
  env[`STRIPE_PRICE_${plan.toUpperCase()}_YEARLY`] = yearly.id
  // Per-plan add-ons (AGL-68/112/132): env names match
  // apps/console/utils/server/billing-addons.ts.
  const addons = [
    ['extra_host', 'extra host', extraHostUsd, 'EXTRA_HOST'],
    ['extra_seat', 'extra manager seat', extraSeatUsd, 'EXTRA_SEAT'],
    ['extra_member', 'extra member seat', extraMemberUsd, 'EXTRA_MEMBER'],
    ['extra_dataset', 'extra dataset', extraDatasetUsd, 'EXTRA_DATASET'],
  ]
  for (const [slug, label, addonUsd, envKey] of addons) {
    const pair = await ensureAddonPair({
      lookupBase: `aglyn_${plan}_${slug}`,
      productName: `${name} — ${label}`,
      usd: addonUsd,
      planMetadata: plan,
    })
    env[`STRIPE_PRICE_${plan.toUpperCase()}_${envKey}`] = pair.monthly.id
    env[`STRIPE_PRICE_${plan.toUpperCase()}_${envKey}_YEARLY`] = pair.yearly.id
  }
}

if (webhookUrl) {
  const endpoint = await stripe('webhook_endpoints', {
    url: webhookUrl,
    'enabled_events[]': 'customer.subscription.created',
    'enabled_events[1]': 'customer.subscription.updated',
    'enabled_events[2]': 'customer.subscription.deleted',
    // Marketplace purchases (AGL-46).
    'enabled_events[3]': 'checkout.session.completed',
  })
  env['STRIPE_WEBHOOK_SECRET'] = endpoint.secret
  console.log(`+ webhook endpoint ${endpoint.id} → ${webhookUrl}`)
} else {
  console.log(
    '~ no --webhook-url given: create the endpoint later and set ' +
      'STRIPE_WEBHOOK_SECRET',
  )
}

// Flat add-ons priced the same on every plan: POS Pro registers
// (AGL-329) and the org-wide Event Calendar toggle (AGL-145/524).
const posAddon = await ensureAddonPair({
  lookupBase: 'aglyn_pos_register_addon',
  productName: 'Aglyn POS Pro register',
  usd: 89,
  planMetadata: 'addon',
})
env['STRIPE_PRICE_POS_REGISTER'] = posAddon.monthly.id
env['STRIPE_PRICE_POS_REGISTER_YEARLY'] = posAddon.yearly.id

const eventCalendarAddon = await ensureAddonPair({
  lookupBase: 'aglyn_event_calendar_addon',
  productName: 'Aglyn Event Calendar',
  usd: 9,
  planMetadata: 'addon',
})
env['STRIPE_PRICE_EVENT_CALENDAR'] = eventCalendarAddon.monthly.id
env['STRIPE_PRICE_EVENT_CALENDAR_YEARLY'] = eventCalendarAddon.yearly.id

console.log('\nAdd these to the console app environment:\n')
for (const [key, value] of Object.entries(env)) {
  console.log(`${key}=${value}`)
}
console.log(
  '\nSTRIPE_SECRET_KEY=(the key you used)\n' +
    'Done — the Billing page Upgrade buttons and the Add-ons card will ' +
    'hit live prices.',
)
