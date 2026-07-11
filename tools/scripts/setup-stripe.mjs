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
const PLANS = [
  { plan: 'starter', name: 'Aglyn Starter', usd: 25, yearlyUsd: 16 * 12, extraHostUsd: 10 },
  { plan: 'pro', name: 'Aglyn Pro', usd: 56, yearlyUsd: 39 * 12, extraHostUsd: 8 },
  { plan: 'business', name: 'Aglyn Business', usd: 139, yearlyUsd: 99 * 12, extraHostUsd: 5 },
  { plan: 'advanced', name: 'Aglyn Advanced', usd: 399, yearlyUsd: 299 * 12, extraHostUsd: 4 },
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

const env = {}
for (const { plan, name, usd, yearlyUsd, extraHostUsd } of PLANS) {
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
  const extra = await ensurePrice({
    lookupKey: `aglyn_${plan}_extra_host`,
    productName: `${name} — extra host`,
    usd: extraHostUsd,
    planMetadata: plan,
  })
  env[`STRIPE_PRICE_${plan.toUpperCase()}_EXTRA_HOST`] = extra.id
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

// POS Pro register add-on (AGL-329).
const posAddon = await ensurePrice({
  lookupKey: 'aglyn_pos_register_addon',
  productName: 'Aglyn POS Pro register',
  usd: 89,
  planMetadata: 'addon',
})
env['STRIPE_PRICE_POS_REGISTER'] = posAddon.id

console.log('\nAdd these to the console app environment:\n')
for (const [key, value] of Object.entries(env)) {
  console.log(`${key}=${value}`)
}
console.log(
  '\nSTRIPE_SECRET_KEY=(the key you used)\n' +
    'Done — the Billing page Upgrade buttons will create live checkouts.',
)
