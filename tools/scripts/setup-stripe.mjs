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
//     [--webhook-url https://app.aglyn.com/api/billing/webhook] [--dry-run] \
//     [--reconcile-events]
//
// --reconcile-events subscribes an EXISTING endpoint to any event in
// WEBHOOK_EVENTS it is missing (adds only, never removes, never touches the
// URL). Without it the gap is printed and nothing is written.
//
// --dry-run resolves every lookup key and prints the env block WITHOUT
// creating anything. Use it against a LIVE key: a Stripe price cannot be
// deleted, only archived, so an accidental create is permanent (AGL-1137).
//
// Idempotent: prices are keyed by lookup_key (aglyn_{plan}), so re-running
// finds the existing ones instead of duplicating. Prints the env block the
// console app needs (STRIPE_PRICE_* + STRIPE_WEBHOOK_SECRET). Prices mirror
// PLAN_PRICING in libs/aglyn/src/lib/app-utils/plan-entitlements.ts — keep
// the two in sync when pricing changes.

import {
  CONNECT_SCOPE_METADATA_KEY,
  CONNECT_SCOPE_METADATA_VALUE,
  CONNECT_WEBHOOK_EVENTS,
  isConnectEndpoint,
  WEBHOOK_EVENTS,
} from './lib/stripe-webhook-health.mjs'

const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET) {
  console.error('Missing STRIPE_SECRET_KEY env var (sk_test_... or sk_live_...)')
  process.exit(1)
}

const args = process.argv.slice(2)
const webhookUrlIndex = args.indexOf('--webhook-url')
const webhookUrl =
  webhookUrlIndex !== -1 ? args[webhookUrlIndex + 1] : undefined

/**
 * Resolve and report; create nothing (AGL-1137).
 *
 * This script is idempotent by `lookup_key`, which makes it look safe to run
 * anywhere. It is not, against LIVE: a lookup key that does not match creates
 * a real product and price, and a Stripe price cannot be deleted afterwards —
 * only archived. So "just re-run it to refresh the env block" is a one-way
 * door on the live account.
 *
 * `--dry-run` makes the refresh safe: every price is looked up, none is
 * created, and anything missing is reported as MISSING rather than minted.
 * The printed env block is then exactly what the account already has.
 */
const DRY_RUN = args.includes('--dry-run')

/**
 * Subscribe an EXISTING endpoint to any `WEBHOOK_EVENTS` it is missing.
 *
 * Off by default because it is the one write this script makes against an
 * endpoint it did not create. The drift is REPORTED either way — a run
 * without this flag still prints what is unsubscribed, which is the part
 * three issues had to name as a manual dashboard step.
 *
 * Adds only; never removes and never touches the URL, so the deployed
 * STRIPE_WEBHOOK_SECRET is untouched and a hand-subscribed event survives.
 * Ignored under --dry-run, which reports the gap and writes nothing.
 */
const RECONCILE_EVENTS = args.includes('--reconcile-events')

/** Set when a dry run finds a lookup key with no price behind it. */
let dryRunMissing = 0

// Mirrors PLAN_PRICING (AGL-278/306/307). The v2 lookup keys leave the
// original aglyn_{plan} prices untouched, so existing subscriptions are
// grandfathered at their old price until the tenant changes plans.
// Add-on unit prices (AGL-525) mirror the extra*MonthlyUsd columns.
const PLANS = [
  { plan: 'starter', name: 'Aglyn Starter', usd: 25, yearlyUsd: 16 * 12, extraHostUsd: 10, extraSeatUsd: 5, extraMemberUsd: 3, extraDatasetUsd: 2 },
  { plan: 'pro', name: 'Aglyn Pro', usd: 56, yearlyUsd: 39 * 12, extraHostUsd: 8, extraSeatUsd: 4, extraMemberUsd: 2, extraDatasetUsd: 2 },
  { plan: 'business', name: 'Aglyn Business', usd: 139, yearlyUsd: 99 * 12, extraHostUsd: 5, extraSeatUsd: 3, extraMemberUsd: 1, extraDatasetUsd: 1 },
  // Pricing v3 (2026-07): Scale fills the $139→$399 gap; Agency sits above
  // Advanced for high-volume multi-site orgs. Keep in sync with PLAN_PRICING.
  { plan: 'scale', name: 'Aglyn Scale', usd: 249, yearlyUsd: 179 * 12, extraHostUsd: 5, extraSeatUsd: 2, extraMemberUsd: 1, extraDatasetUsd: 1 },
  { plan: 'advanced', name: 'Aglyn Advanced', usd: 399, yearlyUsd: 299 * 12, extraHostUsd: 4, extraSeatUsd: 2, extraMemberUsd: 1, extraDatasetUsd: 1 },
  { plan: 'agency', name: 'Aglyn Agency', usd: 799, yearlyUsd: 649 * 12, extraHostUsd: 3, extraSeatUsd: 2, extraMemberUsd: 1, extraDatasetUsd: 1 },
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
  if (DRY_RUN) {
    // A placeholder id rather than a throw, so one missing key does not hide
    // the state of every key after it — the whole point of a dry run is the
    // complete picture.
    dryRunMissing += 1
    console.log(`! ${lookupKey} MISSING (would be created)`)
    return { id: `<MISSING:${lookupKey}>` }
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

/**
 * Every event a handler in this repo actually reads — the checked-in record of
 * what the endpoint must carry (AGL-1798).
 *
 * The list itself lives in `lib/stripe-webhook-health.mjs` so that the script
 * which CREATES the endpoint and the audit which ASSERTS it (AGL-1906,
 * `audit-stripe-webhook-health.mjs`) cannot drift apart. Two hand-maintained
 * copies would eventually disagree, and the audit would then certify the live
 * endpoint against the wrong list — a green check reading the wrong thing.
 */

if (webhookUrl) {
  // Reuse an existing endpoint for the URL: Stripe returns the signing
  // secret only at creation, so recreating would orphan the deployed
  // STRIPE_WEBHOOK_SECRET (delete the endpoint in the dashboard to
  // rotate). Events are indexed [0..n] — mixing `[]` with `[1]`.. is
  // rejected by Stripe's form parser (AGL-533).
  const endpoints = await stripe('webhook_endpoints?limit=100')
  const existing = (endpoints.data ?? []).find(
    (endpoint) => endpoint.url === webhookUrl,
  )
  if (existing) {
    // The DRIFT is the thing to report. Skipping an existing endpoint keeps
    // its signing secret, which is right, but it also meant the event list
    // above was never compared against the live one — so a handler could be
    // dead in production while this script printed a clean "already covers".
    // Naming the gap costs no write and needs no flag (AGL-1798).
    const enabled = existing.enabled_events ?? []
    const missing = enabled.includes('*')
      ? []
      : WEBHOOK_EVENTS.filter((event) => !enabled.includes(event))
    console.log(
      `= webhook endpoint ${existing.id} already covers ${webhookUrl} — ` +
        'keeping the deployed STRIPE_WEBHOOK_SECRET',
    )
    if (missing.length === 0) {
      console.log(`  ✓ all ${WEBHOOK_EVENTS.length} events subscribed`)
    } else if (RECONCILE_EVENTS && !DRY_RUN) {
      // PATCH `enabled_events` only — never the URL, so the signing secret is
      // never orphaned. The write is the UNION, not this file: an event
      // subscribed by hand and not listed here stays subscribed. Unsubscribing
      // silently breaks a handler nothing in this repo can see, so removal
      // stays a human decision in the dashboard.
      const union = [...enabled, ...missing]
      const updated = await stripe(
        `webhook_endpoints/${existing.id}`,
        Object.fromEntries(
          union.map((event, index) => [`enabled_events[${index}]`, event]),
        ),
      )
      console.log(
        `  + subscribed ${missing.join(', ')} ` +
          `(${(updated.enabled_events ?? []).length} events now)`,
      )
    } else {
      console.log(`  ! NOT subscribed: ${missing.join(', ')}`)
      console.log(
        '    the handlers for these never run on this endpoint — re-run with ' +
          '--reconcile-events to add them (or add them in the dashboard)',
      )
    }
  } else {
    if (DRY_RUN) {
      console.log(`! webhook endpoint for ${webhookUrl} MISSING (would be created)`)
    } else {
      const endpoint = await stripe(
        'webhook_endpoints',
        Object.fromEntries([
          ['url', webhookUrl],
          ...WEBHOOK_EVENTS.map((event, index) => [
            `enabled_events[${index}]`,
            event,
          ]),
        ]),
      )
      env['STRIPE_WEBHOOK_SECRET'] = endpoint.secret
      console.log(`+ webhook endpoint ${endpoint.id} → ${webhookUrl}`)
    }
  }
  // The CONNECT destination (AGL-2122), same URL, separate event list.
  //
  // `account.updated` for a CONNECTED account is delivered only to a
  // destination created with `connect: true`. The handler that reads it —
  // `syncConnectAccountStatus`, AGL-1997's fix for merchants selling on a
  // stale `stripeChargesEnabled` — has therefore never run in production:
  // measured 2026-08-18, the live account had exactly one destination and no
  // Connect one.
  //
  // Stamped with metadata because Stripe's endpoint object states NOTHING
  // about `connect: true` when read back (verified against the live account;
  // the returned keys are api_version, application, created, description,
  // enabled_events, id, livemode, metadata, object, status, url). Without the
  // stamp the audit cannot tell the two destinations apart, and an audit that
  // inferred the type from the subscribed events would be concluding what it
  // is trying to verify.
  const connectExisting = (endpoints.data ?? []).find(
    (endpoint) => endpoint.url === webhookUrl && isConnectEndpoint(endpoint),
  )
  if (connectExisting) {
    const connectEnabled = connectExisting.enabled_events ?? []
    const connectMissing = connectEnabled.includes('*')
      ? []
      : CONNECT_WEBHOOK_EVENTS.filter((event) => !connectEnabled.includes(event))
    console.log(
      `= connect destination ${connectExisting.id} already covers ${webhookUrl}`,
    )
    if (connectMissing.length === 0) {
      console.log(
        `  ✓ all ${CONNECT_WEBHOOK_EVENTS.length} connect event(s) subscribed`,
      )
    } else if (RECONCILE_EVENTS && !DRY_RUN) {
      const union = [...connectEnabled, ...connectMissing]
      await stripe(
        `webhook_endpoints/${connectExisting.id}`,
        Object.fromEntries(
          union.map((event, index) => [`enabled_events[${index}]`, event]),
        ),
      )
      console.log(`  + subscribed ${connectMissing.join(', ')}`)
    } else {
      console.log(`  ! NOT subscribed: ${connectMissing.join(', ')}`)
    }
  } else if (DRY_RUN) {
    console.log(
      `! connect destination for ${webhookUrl} MISSING (would be created) — ` +
        'every connected merchant\'s readiness flag is stale until it exists',
    )
  } else {
    // `connect=true` is settable ONLY at creation; there is no update that
    // converts an account destination into a Connect one, which is why this
    // creates rather than reconciling the existing one.
    const connectEndpoint = await stripe(
      'webhook_endpoints',
      Object.fromEntries([
        ['url', webhookUrl],
        ['connect', 'true'],
        ['description', 'Aglyn Connect (connected-account events)'],
        [
          `metadata[${CONNECT_SCOPE_METADATA_KEY}]`,
          CONNECT_SCOPE_METADATA_VALUE,
        ],
        ...CONNECT_WEBHOOK_EVENTS.map((event, index) => [
          `enabled_events[${index}]`,
          event,
        ]),
      ]),
    )
    // A SECOND secret: Stripe signs Connect deliveries with the Connect
    // destination's own key, so the route must be given both or every
    // connected-account delivery 400s on signature — the AGL-1551 shape.
    env['STRIPE_CONNECT_WEBHOOK_SECRET'] = connectEndpoint.secret
    console.log(`+ connect destination ${connectEndpoint.id} → ${webhookUrl}`)
  }
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

// Usage-based billing meter (AGL-635). The report-usage cron posts
// `billing/meter_events` (event_name aglyn_metered_usage) carrying the
// month's billed cents; this provisions the Meter that sums them and a
// metered Price that turns each aggregated unit into 1¢ on the invoice. Both
// dataset-storage overage and customer-API-request overage ride this one
// meter. (Attaching the metered price to each org's subscription as a usage
// item — so overage actually lands on the invoice — is done at checkout/
// subscription creation, not here.)
const METER_EVENT_NAME = 'aglyn_metered_usage'
async function ensureMeter() {
  const list = await stripe('billing/meters?limit=100')
  const existing = (list.data ?? []).find(
    (m) => m.event_name === METER_EVENT_NAME && m.status === 'active',
  )
  if (existing) {
    console.log(`= meter ${METER_EVENT_NAME} already exists (${existing.id})`)
    return existing
  }
  if (DRY_RUN) {
    dryRunMissing += 1
    console.log(`! meter ${METER_EVENT_NAME} MISSING (would be created)`)
    return { id: '<MISSING:meter>' }
  }
  const meter = await stripe('billing/meters', {
    display_name: 'Aglyn metered usage',
    event_name: METER_EVENT_NAME,
    'default_aggregation[formula]': 'sum',
    'value_settings[event_payload_key]': 'value',
    'customer_mapping[type]': 'by_id',
    'customer_mapping[event_payload_key]': 'stripe_customer_id',
  })
  console.log(`+ created meter ${METER_EVENT_NAME} (${meter.id})`)
  return meter
}
const meter = await ensureMeter()
env['STRIPE_METER_ID'] = meter.id
env['STRIPE_METER_EVENT_NAME'] = METER_EVENT_NAME

// A metered price on that meter: the posted value is already in cents, so
// 1¢ per aggregated unit reproduces the billed amount exactly.
//
// ONE PER BILLING INTERVAL (AGL-1280). Stripe forbids mixed
// `recurring.interval` on a subscription, so an annual plan needs a yearly
// metered price or it carries no metered item at all — metered on paper,
// billed $0 in fact. Both prices are $0.01/unit on the SAME meter: the value
// is computed in cents by the rollup, so the interval is the only difference,
// and nothing about the rate table is encoded in either price. A rate change
// can therefore never make these stale.
//
// The two share a product. The monthly price is created first and the yearly
// one reuses `meteredPrice.product`, so re-running this never mints a second
// "Aglyn metered usage" product beside the first — the shape you get from
// creating a product unconditionally, and unfixable afterwards because a
// Stripe product with prices cannot be deleted, only archived.
let meteredProductId = null
async function ensureMeteredPrice(lookupKey, interval) {
  const existing = await findPriceByLookupKey(lookupKey)
  if (existing) {
    console.log(`= ${lookupKey} already exists (${existing.id})`)
    meteredProductId ??= existing.product
    return existing
  }
  if (DRY_RUN) {
    dryRunMissing += 1
    console.log(`! ${lookupKey} MISSING (would be created)`)
    return { id: `<MISSING:${lookupKey}>` }
  }
  // Prices are created one at a time by a sequential top-level loop; the
  // worst concurrent case would be a duplicate product create, and
  // restructuring a live-mode Stripe setup script to promise-memoize is not
  // worth that non-risk (AGL-1815).
  // eslint-disable-next-line require-atomic-updates -- sequential caller
  meteredProductId ??= (
    await stripe('products', {
      name: 'Aglyn metered usage',
      'metadata[plan]': 'metered',
    })
  ).id
  const price = await stripe('prices', {
    product: meteredProductId,
    currency: 'usd',
    unit_amount: '1',
    'recurring[interval]': interval,
    'recurring[usage_type]': 'metered',
    'recurring[meter]': meter.id,
    lookup_key: lookupKey,
    'metadata[plan]': 'metered',
  })
  console.log(`+ created ${lookupKey} (${price.id}, per ${interval})`)
  return price
}
env['STRIPE_PRICE_METERED'] = (
  await ensureMeteredPrice('aglyn_metered_usage', 'month')
).id
env['STRIPE_PRICE_METERED_YEARLY'] = (
  await ensureMeteredPrice('aglyn_metered_usage_yearly', 'year')
).id

console.log(
  DRY_RUN
    ? '\nResolved from the account (DRY RUN — nothing created):\n'
    : '\nAdd these to the console app environment:\n',
)
for (const [key, value] of Object.entries(env)) {
  console.log(`${key}=${value}`)
}
if (DRY_RUN) {
  // Loud, because the failure mode is quiet: a block containing
  // `<MISSING:…>` looks like a usable env block at a glance, and pasting it
  // swaps a dead id for a placeholder that is equally dead.
  console.log(
    dryRunMissing
      ? `\n${dryRunMissing} lookup key(s) MISSING — the block above is NOT ` +
          'safe to paste. Re-run without --dry-run to create them, ' +
          'understanding that a live Stripe price cannot be deleted, only ' +
          'archived.'
      : '\nEvery lookup key resolved. The block above is what this account ' +
          'already has, so it is safe to paste.',
  )
  process.exit(dryRunMissing ? 1 : 0)
}
console.log(
  '\nSTRIPE_SECRET_KEY=(the key you used)\n' +
    'Done — the Billing page Upgrade buttons and the Add-ons card will ' +
    'hit live prices.',
)
