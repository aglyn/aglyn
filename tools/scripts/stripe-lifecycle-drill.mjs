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

// The AGL-1877 subscription-lifecycle rehearsal harness — TEST MODE ONLY.
//
//   node tools/scripts/stripe-lifecycle-drill.mjs [--keep] [--fail=<mutation>]
//
// Drives the whole recurring-revenue path against a Stripe TEST CLOCK:
//
//   create → metered item attached → RENEWAL (`subscription_cycle`)
//          → upgrade → mixed-interval rejection → downgrade (interval change)
//          → explicit cancel → dunning to `past_due` → terminal state
//          → the REAL `resolveEffectivePlan` resolves the org to `free`
//
// ── WHY A TEST CLOCK ────────────────────────────────────────────────────────
// A `subscription_cycle` invoice needs either a month of waiting or a test
// clock, and test clocks are TEST MODE ONLY. The account has produced ZERO
// `subscription_cycle` invoices in its history (AGL-1877), so a renewal — the
// single riskiest unproven leg — cannot be rehearsed any other way.
//
// ── WHY THE ASSERTIONS LOOK LIKE THIS ───────────────────────────────────────
// AGL-1878 proved that `POST /v1/billing/meter_events` returns 200 for ANY
// valid customer id, whether or not the subscription carries an item priced on
// the meter. A 200 is therefore NOT evidence of billing, and neither is a
// webhook 200. Every assertion below reads the Stripe object that has to be
// true — a subscription ITEM at a known price, an invoice LINE at the metered
// price, a status word — never an HTTP code.
//
// The plan/add-on/metered identification runs through the console's OWN
// helpers (`apps/console/utils/server/billing-addons.ts`) and the Free-tier
// leg calls the REAL `resolveEffectivePlan`, so the drill exercises production
// code rather than a second implementation that could agree with itself while
// both are wrong.
//
// ── FALSIFICATION ───────────────────────────────────────────────────────────
// `--fail=<mutation>` deliberately breaks one thing so you can watch the
// matching assertion go red. A harness that cannot fail proves nothing.
//
//   --fail=no-metered      omit the metered item at create time
//                          → the renewal's metered-line assertion must RED
//   --fail=skip-cancel     never cancel the subscription
//                          → the Free-tier assertion must RED
//   --fail=mixed-interval  move the plan item to yearly and leave the metered
//                          item monthly → the interval-uniformity assertion
//                          must RED (Stripe rejects it too)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const MUTATION = (args.find((a) => a.startsWith('--fail=')) ?? '').slice(7)
const VALID_MUTATIONS = ['', 'no-metered', 'skip-cancel', 'mixed-interval']
if (!VALID_MUTATIONS.includes(MUTATION)) {
  console.error(
    `Unknown --fail=${MUTATION}. Valid: ${VALID_MUTATIONS.slice(1).join(', ')}`,
  )
  process.exit(2)
}

// ── The mode guard ──────────────────────────────────────────────────────────
//
// NEVER TRUST A COMMENT OR AN ENV NAME. `apps/console/.env.production.local`
// carries `STRIPE_SECRET_KEY=sk_live_…` under a header that reads
// "# Stripe (TEST MODE)", and AGL-2401 reports the LIVE secret is also set in
// Vercel's development AND preview environments. The only trustworthy signal
// is the key's own prefix, so that is what is checked — before any call.
const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET) {
  console.error('Missing STRIPE_SECRET_KEY. This drill requires a sk_test_ key.')
  process.exit(2)
}
if (!SECRET.startsWith('sk_test_')) {
  console.error(
    'REFUSING TO RUN: STRIPE_SECRET_KEY does not start with `sk_test_`.\n' +
      `  resolved prefix: ${SECRET.slice(0, 8)}…\n` +
      '  This harness CREATES subscriptions, CHARGES cards and CANCELS them.\n' +
      '  Against a live key that is real money. Test clocks are test-mode only.',
  )
  process.exit(2)
}

async function stripe(pathname, params, method) {
  const verb = method ?? (params ? 'POST' : 'GET')
  const response = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: verb,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: params ? new URLSearchParams(params) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
    error.stripeCode = payload?.error?.code
    error.stripeStatus = response.status
    throw error
  }
  return payload
}

// ── Assertions ──────────────────────────────────────────────────────────────
const results = []
function assert(leg, claim, condition, detail) {
  results.push({ leg, claim, ok: Boolean(condition), detail })
  const mark = condition ? '  ✓' : '  ✗'
  console.log(`${mark} [${leg}] ${claim}${detail ? `\n        ${detail}` : ''}`)
  return Boolean(condition)
}
function note(message) {
  console.log(`    · ${message}`)
}
function leg(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`)
}

// ── Production code under test ──────────────────────────────────────────────
//
// Loaded through jiti so the drill asserts with the SAME functions the console
// runs. `@aglyn/aglyn/server` is aliased straight at `plan-entitlements.ts`:
// that module exports all four symbols `billing-addons.ts` imports
// (PLAN_PRICING, SELF_SERVE_PLANS, and the two flat add-on constants), and it
// avoids dragging in the whole server barrel, which cannot load outside Next.
const { createJiti } = await import(`${REPO}/node_modules/jiti/lib/jiti.mjs`)
const jiti = createJiti(`${REPO}/tools/scripts/stripe-lifecycle-drill.mjs`, {
  interopDefault: true,
  alias: {
    '@aglyn/aglyn/server': `${REPO}/libs/aglyn/src/lib/app-utils/plan-entitlements.ts`,
  },
})
const entitlements = await jiti.import(
  `${REPO}/libs/aglyn/src/lib/app-utils/plan-entitlements.ts`,
)
const addons = await jiti.import(
  `${REPO}/apps/console/utils/server/billing-addons.ts`,
)
const { planAndIntervalFromPriceId, isMeteredPriceId, findPlanItem } = addons

// ── Price ids ───────────────────────────────────────────────────────────────
//
// Read from `apps/console/.env.development.local` unless already in the
// environment. That file is the one place holding the TEST ladder; production
// holds live ids under the same names (AGL-2432).
const DEV_ENV = `${REPO}/apps/console/.env.development.local`
if (fs.existsSync(DEV_ENV)) {
  for (const line of fs.readFileSync(DEV_ENV, 'utf8').split('\n')) {
    const match = /^(STRIPE_PRICE_[A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const PRICES = {
  starterMonthly: process.env.STRIPE_PRICE_STARTER,
  starterYearly: process.env.STRIPE_PRICE_STARTER_YEARLY,
  proMonthly: process.env.STRIPE_PRICE_PRO,
  meteredMonthly: process.env.STRIPE_PRICE_METERED,
  meteredYearly: process.env.STRIPE_PRICE_METERED_YEARLY,
}

const DAY = 86400

async function waitForClock(clockId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const clock = await stripe(`test_helpers/test_clocks/${clockId}`)
    if (clock.status === 'ready') return clock
    if (clock.status === 'internal_failure') {
      throw new Error(`test clock ${clockId} reported internal_failure`)
    }
    if (Date.now() > deadline) {
      throw new Error(`test clock ${clockId} still ${clock.status} after timeout`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function advanceTo(clockId, frozenTime) {
  await stripe(`test_helpers/test_clocks/${clockId}/advance`, {
    frozen_time: String(frozenTime),
  })
  return waitForClock(clockId)
}

/** Every distinct `recurring.interval` across a subscription's items. */
function intervalsOf(subscription) {
  return [
    ...new Set(
      (subscription.items?.data ?? []).map((i) => i.price?.recurring?.interval),
    ),
  ]
}
function meteredItemOf(subscription) {
  return (subscription.items?.data ?? []).find((i) =>
    isMeteredPriceId(i.price?.id),
  )
}

let clockId = null
const started = Date.now()

try {
  leg('Leg 0 — preflight: the prices exist and are TEST mode')
  for (const [name, id] of Object.entries(PRICES)) {
    if (!id) {
      assert('preflight', `${name} price id is configured`, false, 'env var unset')
      continue
    }
    const price = await stripe(`prices/${id}`)
    assert(
      'preflight',
      `${name} (${id}) is a TEST-mode price`,
      price.livemode === false,
      `livemode=${price.livemode} lookup_key=${price.lookup_key} amount=${price.unit_amount}`,
    )
  }
  assert(
    'preflight',
    'the metered prices are recognised by the console helper isMeteredPriceId()',
    isMeteredPriceId(PRICES.meteredMonthly) && isMeteredPriceId(PRICES.meteredYearly),
    'both intervals, via production code',
  )

  // ── The clock ─────────────────────────────────────────────────────────────
  const t0 = Math.floor(Date.now() / 1000) - 60
  const clock = await stripe('test_helpers/test_clocks', {
    frozen_time: String(t0),
    name: `AGL-1877 lifecycle drill${MUTATION ? ` [--fail=${MUTATION}]` : ''}`,
  })
  clockId = clock.id
  note(`test clock ${clockId} frozen at ${new Date(t0 * 1000).toISOString()}`)

  // ── Leg 1 — create ────────────────────────────────────────────────────────
  leg('Leg 1 — create a subscription with the metered item attached')
  const customer = await stripe('customers', {
    name: 'AGL-1877 drill (main)',
    email: `agl1877-main-${t0}@example.com`,
    test_clock: clockId,
  })
  await stripe(`payment_methods/pm_card_visa/attach`, { customer: customer.id })
  const goodPm = (
    await stripe(`customers/${customer.id}/payment_methods?type=card`)
  ).data[0]
  await stripe(`customers/${customer.id}`, {
    'invoice_settings[default_payment_method]': goodPm.id,
  })

  const createItems = {
    'items[0][price]': PRICES.starterMonthly,
  }
  if (MUTATION !== 'no-metered') {
    createItems['items[1][price]'] = PRICES.meteredMonthly
  } else {
    note('MUTATION no-metered: creating the subscription WITHOUT the metered item')
  }
  let sub = await stripe('subscriptions', {
    customer: customer.id,
    ...createItems,
    payment_behavior: 'error_if_incomplete',
    'expand[0]': 'latest_invoice',
  })

  assert('create', 'the subscription is active', sub.status === 'active', `status=${sub.status}`)
  const planItem = findPlanItem(sub.items?.data)
  assert(
    'create',
    'the console helper identifies the plan item as starter/month',
    planAndIntervalFromPriceId(planItem?.price?.id)?.plan === 'starter' &&
      planAndIntervalFromPriceId(planItem?.price?.id)?.interval === 'month',
    `plan item price=${planItem?.price?.id}`,
  )
  assert(
    'create',
    'a METERED subscription ITEM is attached (not merely a 200 from Stripe)',
    Boolean(meteredItemOf(sub)),
    `items=${(sub.items?.data ?? []).map((i) => i.price?.id).join(', ')}`,
  )
  assert(
    'create',
    'every item shares one recurring.interval',
    intervalsOf(sub).length === 1,
    `intervals=[${intervalsOf(sub).join(', ')}]`,
  )
  const firstInvoice = sub.latest_invoice
  assert(
    'create',
    'the first invoice is a `subscription_create` and it is PAID with a real charge',
    firstInvoice?.billing_reason === 'subscription_create' &&
      firstInvoice?.status === 'paid' &&
      firstInvoice?.amount_paid === 2500,
    `billing_reason=${firstInvoice?.billing_reason} status=${firstInvoice?.status} amount_paid=${firstInvoice?.amount_paid}`,
  )

  // ── Leg 2 — the renewal ───────────────────────────────────────────────────
  leg('Leg 2 — advance the clock to force a `subscription_cycle` renewal')
  // Report usage first so the renewal has something to bill, mirroring the
  // report-usage cron. The 200 this returns is explicitly NOT the assertion.
  try {
    await stripe('billing/meter_events', {
      event_name: 'aglyn_metered_usage',
      'payload[stripe_customer_id]': customer.id,
      'payload[value]': '42',
      identifier: `agl1877-drill-${t0}`,
      timestamp: String(t0),
    })
    note('posted a 42-unit meter event (a 200 here proves nothing — AGL-1878)')
  } catch (error) {
    note(`meter event rejected: ${error.message}`)
  }

  const periodEnd = sub.items.data[0].current_period_end ?? sub.current_period_end
  await advanceTo(clockId, periodEnd + DAY)
  sub = await stripe(`subscriptions/${sub.id}`)

  const invoices = await stripe(`invoices?subscription=${sub.id}&limit=20`)
  const cycleInvoice = (invoices.data ?? []).find(
    (i) => i.billing_reason === 'subscription_cycle',
  )
  assert(
    'renewal',
    'a `subscription_cycle` invoice exists — the account had produced ZERO before',
    Boolean(cycleInvoice),
    cycleInvoice
      ? `${cycleInvoice.id} status=${cycleInvoice.status} total=${cycleInvoice.total}`
      : `billing_reasons seen: ${(invoices.data ?? []).map((i) => i.billing_reason).join(', ')}`,
  )
  assert(
    'renewal',
    'the renewal invoice was actually PAID',
    cycleInvoice?.status === 'paid',
    `status=${cycleInvoice?.status} amount_paid=${cycleInvoice?.amount_paid}`,
  )
  // THE assertion AGL-1878 exists for: usage is only billable if the renewal
  // invoice carries a LINE at the metered price. No line, no revenue, ever,
  // and nothing else about the system looks wrong.
  const cycleLines = cycleInvoice
    ? (await stripe(`invoices/${cycleInvoice.id}/lines?limit=50`)).data ?? []
    : []
  const meteredLine = cycleLines.find((l) =>
    isMeteredPriceId(l.pricing?.price_details?.price ?? l.price?.id),
  )
  assert(
    'renewal',
    'the renewal invoice carries a LINE at the metered price (AGL-1878 leak)',
    Boolean(meteredLine),
    `lines: ${cycleLines
      .map((l) => `${l.pricing?.price_details?.price ?? l.price?.id}(${l.amount})`)
      .join(', ')}`,
  )
  if (meteredLine) {
    note(`metered line amount=${meteredLine.amount} — 42 units × $0.01 = 42¢ expected`)
    assert(
      'renewal',
      'the metered line bills the reported usage (42 units → 42¢)',
      meteredLine.amount === 42,
      `amount=${meteredLine.amount}`,
    )
  }

  // ── Leg 3 — upgrade ───────────────────────────────────────────────────────
  leg('Leg 3 — upgrade Starter → Pro, moving plan and metered item together')
  const upPlanItem = findPlanItem(sub.items.data)
  const upMeteredItem = meteredItemOf(sub)
  const upgradeParams = {
    'items[0][id]': upPlanItem.id,
    'items[0][price]': PRICES.proMonthly,
    proration_behavior: 'create_prorations',
  }
  if (upMeteredItem) {
    upgradeParams['items[1][id]'] = upMeteredItem.id
    upgradeParams['items[1][price]'] = PRICES.meteredMonthly
  }
  sub = await stripe(`subscriptions/${sub.id}`, upgradeParams)
  assert(
    'upgrade',
    'the plan item now sells Pro',
    planAndIntervalFromPriceId(findPlanItem(sub.items.data)?.price?.id)?.plan === 'pro',
    `plan item price=${findPlanItem(sub.items.data)?.price?.id}`,
  )
  assert(
    'upgrade',
    'the metered item SURVIVED the upgrade',
    Boolean(meteredItemOf(sub)),
    `items=${sub.items.data.map((i) => i.price?.id).join(', ')}`,
  )
  assert(
    'upgrade',
    'every item still shares one recurring.interval',
    intervalsOf(sub).length === 1,
    `intervals=[${intervalsOf(sub).join(', ')}]`,
  )

  // ── Leg 4 — the negative control ──────────────────────────────────────────
  leg('Leg 4 — negative control: Stripe must REJECT a mixed-interval subscription')
  let rejected = false
  let rejection = ''
  try {
    await stripe(`subscriptions/${sub.id}`, {
      'items[0][id]': findPlanItem(sub.items.data).id,
      'items[0][price]': PRICES.starterYearly,
      proration_behavior: 'none',
    })
  } catch (error) {
    rejected = true
    rejection = error.message
  }
  assert(
    'interval-guard',
    'moving ONLY the plan item to yearly is rejected by Stripe',
    // With no metered item there is nothing to mix, so the guard is vacuous —
    // say so rather than reporting a pass that read nothing.
    meteredItemOf(sub) ? rejected : 'vacuous',
    meteredItemOf(sub)
      ? rejection || 'Stripe ACCEPTED a mixed-interval update — assumption broken'
      : 'SKIPPED: no metered item to mix with (see --fail=no-metered)',
  )
  if (!meteredItemOf(sub)) {
    results.pop()
    console.log('  ~ [interval-guard] SKIPPED — no metered item to mix with')
  }

  // ── Leg 5 — downgrade, with an interval change ────────────────────────────
  leg('Leg 5 — downgrade Pro/month → Starter/year, both items moving together')
  const dnPlanItem = findPlanItem(sub.items.data)
  const dnMeteredItem = meteredItemOf(sub)
  const downgradeParams = {
    'items[0][id]': dnPlanItem.id,
    'items[0][price]': PRICES.starterYearly,
    proration_behavior: 'create_prorations',
  }
  if (dnMeteredItem) {
    downgradeParams['items[1][id]'] = dnMeteredItem.id
    // The mutation moves the plan to YEARLY but leaves the metered item on the
    // MONTHLY price — exactly the AGL-1340 footgun `meteredPriceId(interval)`
    // exists to make unrepresentable.
    downgradeParams['items[1][price]'] =
      MUTATION === 'mixed-interval' ? PRICES.meteredMonthly : PRICES.meteredYearly
    if (MUTATION === 'mixed-interval') {
      note('MUTATION mixed-interval: plan → yearly, metered left on the MONTHLY price')
    }
  }
  let downgradeError = null
  try {
    sub = await stripe(`subscriptions/${sub.id}`, downgradeParams)
  } catch (error) {
    downgradeError = error
    note(`Stripe refused the downgrade: ${error.message}`)
  }
  assert(
    'downgrade',
    'the downgrade was accepted and the plan item sells Starter on the YEARLY interval',
    !downgradeError &&
      planAndIntervalFromPriceId(findPlanItem(sub.items.data)?.price?.id)?.plan ===
        'starter' &&
      planAndIntervalFromPriceId(findPlanItem(sub.items.data)?.price?.id)?.interval ===
        'year',
    downgradeError
      ? `rejected: ${downgradeError.message}`
      : `plan item price=${findPlanItem(sub.items.data)?.price?.id}`,
  )
  assert(
    'downgrade',
    'the metered item moved interval WITH the plan (no mixed recurring.interval)',
    // `intervals.length === 1` alone would pass VACUOUSLY on a subscription
    // that carries no metered item at all — the exact silence AGL-1352 is
    // about. Require the item to be there before believing the interval.
    !downgradeError &&
      Boolean(meteredItemOf(sub)) &&
      intervalsOf(sub).length === 1 &&
      intervalsOf(sub)[0] === 'year',
    downgradeError
      ? `subscription unchanged: intervals=[${intervalsOf(sub).join(', ')}]`
      : `intervals=[${intervalsOf(sub).join(', ')}] metered=${meteredItemOf(sub)?.price?.id}`,
  )

  // ── Leg 6 — explicit cancel ───────────────────────────────────────────────
  leg('Leg 6 — the customer cancels')
  if (MUTATION === 'skip-cancel') {
    note('MUTATION skip-cancel: leaving the subscription ACTIVE')
  } else {
    sub = await stripe(`subscriptions/${sub.id}`, null, 'DELETE')
  }
  sub = await stripe(`subscriptions/${sub.id}`)
  assert(
    'cancel',
    'the subscription is canceled at Stripe',
    sub.status === 'canceled',
    `status=${sub.status} reason=${sub.cancellation_details?.reason}`,
  )
  assert(
    'cancel',
    'the cancellation is attributed to the customer, not a payment failure',
    sub.cancellation_details?.reason === 'cancellation_requested',
    `reason=${sub.cancellation_details?.reason}`,
  )

  // ── Leg 7 — the Free downgrade, through production code ───────────────────
  leg('Leg 7 — the org falls back to Free (real resolveEffectivePlan)')
  const effective = entitlements.resolveEffectivePlan({
    plan: 'starter',
    billingStatus: sub.status,
  })
  assert(
    'free',
    `resolveEffectivePlan({plan:'starter', billingStatus:'${sub.status}'}) === 'free'`,
    effective === 'free',
    `resolved=${effective}`,
  )

  // ── Leg 8 — dunning ───────────────────────────────────────────────────────
  leg('Leg 8 — dunning: a renewal whose card fails, driven to its terminal state')
  const dunCustomer = await stripe('customers', {
    name: 'AGL-1877 drill (dunning)',
    email: `agl1877-dun-${t0}@example.com`,
    test_clock: clockId,
  })
  await stripe('payment_methods/pm_card_visa/attach', { customer: dunCustomer.id })
  const dunGoodPm = (
    await stripe(`customers/${dunCustomer.id}/payment_methods?type=card`)
  ).data[0]
  await stripe(`customers/${dunCustomer.id}`, {
    'invoice_settings[default_payment_method]': dunGoodPm.id,
  })
  let dunSub = await stripe('subscriptions', {
    customer: dunCustomer.id,
    'items[0][price]': PRICES.starterMonthly,
    'items[1][price]': PRICES.meteredMonthly,
    payment_behavior: 'error_if_incomplete',
  })
  assert(
    'dunning',
    'the dunning subscription starts active and paid',
    dunSub.status === 'active',
    `status=${dunSub.status}`,
  )

  // Swap in a card that always fails, and detach the good one so no retry can
  // succeed — the AGL-2430 recipe.
  await stripe('payment_methods/pm_card_chargeCustomerFail/attach', {
    customer: dunCustomer.id,
  })
  const badPm = (
    await stripe(`customers/${dunCustomer.id}/payment_methods?type=card`)
  ).data.find((pm) => pm.id !== dunGoodPm.id)
  await stripe(`customers/${dunCustomer.id}`, {
    'invoice_settings[default_payment_method]': badPm.id,
  })
  await stripe(`payment_methods/${dunGoodPm.id}/detach`, {})
  note('default payment method swapped to pm_card_chargeCustomerFail, good card detached')

  const dunPeriodEnd =
    dunSub.items.data[0].current_period_end ?? dunSub.current_period_end
  let sawPastDue = false
  const timeline = []
  let cursor = dunPeriodEnd + 3600
  await advanceTo(clockId, cursor)
  dunSub = await stripe(`subscriptions/${dunSub.id}`)
  timeline.push(`renewal due → ${dunSub.status}`)
  sawPastDue ||= dunSub.status === 'past_due'

  for (let week = 1; week <= 6 && !['canceled', 'unpaid'].includes(dunSub.status); week++) {
    cursor += 7 * DAY
    await advanceTo(clockId, cursor)
    dunSub = await stripe(`subscriptions/${dunSub.id}`)
    const dunInvoices = await stripe(`invoices?subscription=${dunSub.id}&limit=5`)
    const open = (dunInvoices.data ?? []).find((i) => i.billing_reason === 'subscription_cycle')
    timeline.push(`+${week * 7}d → ${dunSub.status} (attempt ${open?.attempt_count ?? '?'})`)
    sawPastDue ||= dunSub.status === 'past_due'
  }
  for (const step of timeline) note(step)

  assert(
    'dunning',
    'the subscription entered `past_due` when the renewal charge failed',
    sawPastDue,
    `timeline: ${timeline.join(' | ')}`,
  )
  assert(
    'dunning',
    'dunning reached a terminal state rather than retrying forever',
    ['canceled', 'unpaid'].includes(dunSub.status),
    `terminal status=${dunSub.status} reason=${dunSub.cancellation_details?.reason}`,
  )
  const dunEffective = entitlements.resolveEffectivePlan({
    plan: 'starter',
    billingStatus: dunSub.status,
  })
  assert(
    'dunning',
    `a dunning-terminated org resolves to Free (status '${dunSub.status}')`,
    dunEffective === 'free',
    `resolveEffectivePlan → ${dunEffective}`,
  )
} catch (error) {
  console.error(`\n!! the drill threw: ${error.message}`)
  results.push({ leg: 'harness', claim: 'the drill ran to completion', ok: false, detail: error.message })
} finally {
  if (clockId && !KEEP) {
    try {
      await stripe(`test_helpers/test_clocks/${clockId}`, null, 'DELETE')
      console.log(`\n· deleted test clock ${clockId} (and every object on it)`)
    } catch (error) {
      console.log(`\n· could not delete test clock ${clockId}: ${error.message}`)
    }
  } else if (clockId) {
    console.log(`\n· KEEPING test clock ${clockId}`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(
  `\n${'═'.repeat(72)}\n` +
    `${results.length - failed.length}/${results.length} assertions passed` +
    `${MUTATION ? `   [--fail=${MUTATION}]` : ''}` +
    `   ${Math.round((Date.now() - started) / 1000)}s`,
)
if (failed.length) {
  console.log('\nFAILED:')
  for (const f of failed) console.log(`  ✗ [${f.leg}] ${f.claim}\n      ${f.detail}`)
}
process.exit(failed.length ? 1 : 0)
