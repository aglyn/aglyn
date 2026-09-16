#!/usr/bin/env node
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

/**
 * THE AI OVERAGE TEST-CLOCK DRILL (AGL-3011).
 *
 * Takes one one-off overage invoice through every outcome the design has to
 * survive — paid, declined, retried, paid by hand, voided, disputed — on a
 * Stripe TEST CLOCK, and reports what Stripe actually did at each step.
 *
 * ## Why a drill and not a unit test
 *
 * `usage-invoice.spec.ts` pins what we SEND. Only Stripe can answer what it
 * accepts: whether a `price_data` line takes automatic tax at the account's
 * pinned API version, which payment method a one-off `charge_automatically`
 * invoice actually charges, whether the account's Smart Retries apply to
 * one-off invoices, what happens to an invoice under the minimum charge, and
 * how quickly invoice search indexes a new invoice. Every one of those is a
 * question the design lists as open, and every one of them is answered here.
 *
 * ## It writes, so it asks first
 *
 * Nothing runs without `--run`. The default prints the plan — every call it
 * would make, in order — and touches nothing. `--run` is refused outright
 * for a live key: a drill's whole method is creating charges and failing
 * them, and doing that on the live account would bill real cardholders.
 *
 *   node tools/scripts/ai-overage-test-clock-drill.mjs            # the plan
 *   STRIPE_SECRET_KEY=sk_test_… node tools/scripts/…drill.mjs --run
 *
 * The test clock is advanced by this script, and every object it creates is
 * attached to it, so the whole rehearsal can be deleted with the clock.
 */

const args = process.argv.slice(2)
const RUN = args.includes('--run')
const SECRET = process.env.STRIPE_SECRET_KEY ?? ''
const API_VERSION = '2024-06-20'
const PRODUCT = process.env.STRIPE_PRODUCT_AI_OVERAGE ?? ''

/**
 * The one guard that matters. `sk_live` keys are refused before anything
 * else is read, so a mistyped shell does not become a charge on a customer.
 */
function refuseLiveKey() {
  if (SECRET.startsWith('sk_live') || SECRET.startsWith('rk_live')) {
    console.error(
      'REFUSED: this drill creates and fails charges. It runs against a ' +
        'TEST key only. Set STRIPE_SECRET_KEY to an sk_test_… key.',
    )
    process.exit(2)
  }
}

/** Each step, in the order the design's §2.4 list asks them. */
const PLAN = [
  ['clock', 'Create a test clock at the 1st of a month'],
  ['customer', 'Create a customer attached to the clock, with a US address'],
  ['card', 'Attach pm_card_visa and make it the customer default'],
  ['charge-paid', 'Invoice $25 of overage; finalize and pay — expect paid'],
  ['tax', 'Read automatic_tax.status and the tax line on the paid invoice'],
  ['which-card', 'Read the charge to confirm WHICH payment method was used'],
  ['search', 'Search invoices by metadata[chargeId]; time how long it indexes'],
  ['charge-failed', 'Swap to pm_card_chargeCustomerFail and invoice $25 again'],
  ['retry', 'Advance the clock a day at a time; record every retry attempt'],
  ['pay-by-hand', 'Pay the failed invoice from the API, as Billing would'],
  ['void', 'Invoice $25 again, then void it; read the resulting status'],
  ['uncollectible', 'Invoice $25 again and mark it uncollectible'],
  ['tiny', 'Invoice $0.40 and record what Stripe does with it'],
  ['dispute', 'Charge a disputable card and open a dispute on it'],
  ['settings', 'Read the account API version, the endpoint version and the retry policy'],
]

function printPlan() {
  console.log('AI overage test-clock drill — PLAN ONLY, nothing was called.\n')
  for (const [id, what] of PLAN) console.log(`  ${id.padEnd(15)} ${what}`)
  console.log(
    '\nEach step records what Stripe answered, which is the half a unit ' +
      'test cannot hold.\nRe-run with --run and a TEST key to execute it.',
  )
  if (!PRODUCT) {
    console.log(
      '\nSTRIPE_PRODUCT_AI_OVERAGE is unset. Create the test-mode product ' +
        'first:\n  STRIPE_SECRET_KEY=sk_test_… node tools/scripts/setup-stripe.mjs',
    )
  }
}

async function stripe(path, params, idempotencyKey) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Stripe-Version': API_VERSION,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(params && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

/** Every answer, printed at the end as the record the design asked for. */
const findings = []
function record(step, answer) {
  findings.push({ step, answer })
  console.log(`  ${step.padEnd(15)} ${JSON.stringify(answer)}`)
}

/** One overage invoice, created the way the plugin creates it. */
async function invoiceOverage(customerId, chargeId, amountCents) {
  const metadata = {
    'metadata[orgId]': 'org-drill',
    'metadata[pluginId]': 'ai',
    'metadata[kind]': 'ai-overage',
    'metadata[chargeId]': chargeId,
    'metadata[month]': '2026-10',
  }
  const key = `aiov-org-drill-${chargeId}`
  const item = await stripe(
    'invoiceitems',
    {
      customer: customerId,
      'price_data[product]': PRODUCT,
      'price_data[currency]': 'usd',
      'price_data[unit_amount]': String(amountCents),
      'price_data[tax_behavior]': 'exclusive',
      description: `AI credits past your included band — 2026-10 (${chargeId})`,
      ...metadata,
    },
    `${key}:invoiceitem`,
  )
  if (!item.ok) return { ok: false, stage: 'invoiceitem', payload: item.payload }
  const invoice = await stripe(
    'invoices',
    {
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: 'false',
      'automatic_tax[enabled]': 'true',
      ...metadata,
    },
    `${key}:invoice`,
  )
  if (!invoice.ok) return { ok: false, stage: 'invoice', payload: invoice.payload }
  const id = invoice.payload.id
  const finalized = await stripe(
    `invoices/${id}/finalize`,
    { auto_advance: 'false' },
    `${key}:finalize`,
  )
  if (!finalized.ok) {
    return { ok: false, stage: 'finalize', invoiceId: id, payload: finalized.payload }
  }
  const paid = await stripe(`invoices/${id}/pay`, {}, `${key}:pay`)
  return {
    ok: paid.ok,
    stage: 'pay',
    invoiceId: id,
    status: paid.payload?.status ?? finalized.payload?.status ?? null,
    automaticTax: finalized.payload?.automatic_tax?.status ?? null,
    taxCents: finalized.payload?.tax ?? null,
    totalCents: finalized.payload?.total ?? null,
    charge: paid.payload?.charge ?? null,
    error: paid.payload?.error?.message ?? null,
    intentStatus: paid.payload?.error?.payment_intent?.status ?? null,
  }
}

async function attachCard(customerId, token, clockAdvanceNote) {
  const method = await stripe('payment_methods', {
    type: 'card',
    'card[token]': token,
  })
  if (!method.ok) return { ok: false, payload: method.payload }
  const attached = await stripe(`payment_methods/${method.payload.id}/attach`, {
    customer: customerId,
  })
  if (!attached.ok) return { ok: false, payload: attached.payload }
  const updated = await stripe(`customers/${customerId}`, {
    'invoice_settings[default_payment_method]': method.payload.id,
  })
  return {
    ok: updated.ok,
    paymentMethodId: method.payload.id,
    note: clockAdvanceNote ?? null,
  }
}

async function run() {
  if (!SECRET) {
    console.error('STRIPE_SECRET_KEY is not set. This drill needs a TEST key.')
    process.exit(2)
  }
  if (!PRODUCT) {
    console.error(
      'STRIPE_PRODUCT_AI_OVERAGE is not set. Run setup-stripe.mjs against ' +
        'the test account first, then export the product id it prints.',
    )
    process.exit(2)
  }
  console.log('AI overage test-clock drill — RUNNING against the test account.\n')

  // The account's own settings, read first: every later answer has to be
  // read against the version that produced it.
  const account = await stripe('account')
  record('settings', {
    accountApiVersion: account.payload?.api_version ?? null,
    pinnedByThisDrill: API_VERSION,
  })
  const endpoints = await stripe('webhook_endpoints?limit=10')
  record('endpoints', {
    versions: (endpoints.payload?.data ?? []).map((e) => e.api_version),
    events: (endpoints.payload?.data ?? []).map((e) => (e.enabled_events ?? []).length),
  })

  const clock = await stripe('test_helpers/test_clocks', {
    frozen_time: String(Math.floor(Date.parse('2026-10-01T12:00:00Z') / 1000)),
    name: 'AGL-3011 overage drill',
  })
  if (!clock.ok) {
    console.error('Could not create a test clock:', clock.payload?.error?.message)
    process.exit(1)
  }
  record('clock', { id: clock.payload.id })

  const customer = await stripe('customers', {
    name: 'AGL-3011 drill',
    email: 'drill@example.com',
    test_clock: clock.payload.id,
    'address[line1]': '1 Test Street',
    'address[city]': 'Austin',
    'address[state]': 'TX',
    'address[postal_code]': '78701',
    'address[country]': 'US',
  })
  if (!customer.ok) {
    console.error('Could not create a customer:', customer.payload?.error?.message)
    process.exit(1)
  }
  record('customer', { id: customer.payload.id })

  record('card', await attachCard(customer.payload.id, 'tok_visa'))

  // 1. The ordinary case: a $25 threshold charge that goes through.
  const paid = await invoiceOverage(customer.payload.id, '2026-10-001', 2_500)
  record('charge-paid', paid)
  record('tax', {
    automaticTax: paid.automaticTax,
    taxCents: paid.taxCents,
    totalCents: paid.totalCents,
  })
  if (paid.charge) {
    const charge = await stripe(`charges/${paid.charge}`)
    record('which-card', {
      paymentMethod: charge.payload?.payment_method ?? null,
      brand: charge.payload?.payment_method_details?.card?.brand ?? null,
      last4: charge.payload?.payment_method_details?.card?.last4 ?? null,
    })
  }

  // 2. How long the search index takes — the reconcile sweep depends on it.
  const searchStarted = Date.now()
  let searchHits = 0
  for (let attempt = 0; attempt < 6 && searchHits === 0; attempt += 1) {
    const search = await stripe(
      `invoices/search?query=${encodeURIComponent("metadata['chargeId']:'2026-10-001'")}&limit=1`,
    )
    searchHits = (search.payload?.data ?? []).length
    if (searchHits === 0) await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  record('search', { found: searchHits > 0, afterMs: Date.now() - searchStarted })

  // 3. The declining card.
  record('card-fail', await attachCard(customer.payload.id, 'tok_chargeCustomerFail'))
  const failed = await invoiceOverage(customer.payload.id, '2026-10-002', 2_500)
  record('charge-failed', failed)

  // 4. Retries. Advancing the clock is what makes Stripe's own schedule run.
  if (failed.invoiceId) {
    for (const days of [1, 3, 5, 7]) {
      const at = Math.floor(Date.parse('2026-10-01T12:00:00Z') / 1000) + days * 86_400
      const advanced = await stripe(`test_helpers/test_clocks/${clock.payload.id}/advance`, {
        frozen_time: String(at),
      })
      if (!advanced.ok) break
      // The clock advances asynchronously; poll until it is ready again.
      for (let i = 0; i < 30; i += 1) {
        const state = await stripe(`test_helpers/test_clocks/${clock.payload.id}`)
        if (state.payload?.status === 'ready') break
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      const invoice = await stripe(`invoices/${failed.invoiceId}`)
      record('retry', {
        days,
        status: invoice.payload?.status ?? null,
        attempts: invoice.payload?.attempt_count ?? null,
        nextAttempt: invoice.payload?.next_payment_attempt ?? null,
      })
    }
    // 5. Paid by hand, the way Billing's "Pay invoice" does it.
    await attachCard(customer.payload.id, 'tok_visa')
    const byHand = await stripe(`invoices/${failed.invoiceId}/pay`, {})
    record('pay-by-hand', {
      ok: byHand.ok,
      status: byHand.payload?.status ?? null,
      error: byHand.payload?.error?.message ?? null,
    })
  }

  // 6. Voided, and written off.
  const toVoid = await invoiceOverage(customer.payload.id, '2026-10-003', 2_500)
  if (toVoid.invoiceId) {
    const voided = await stripe(`invoices/${toVoid.invoiceId}/void`, {})
    record('void', { ok: voided.ok, status: voided.payload?.status ?? null })
  }
  const toWriteOff = await invoiceOverage(customer.payload.id, '2026-10-004', 2_500)
  if (toWriteOff.invoiceId) {
    const written = await stripe(
      `invoices/${toWriteOff.invoiceId}/mark_uncollectible`,
      {},
    )
    record('uncollectible', { ok: written.ok, status: written.payload?.status ?? null })
  }

  // 7. Under Stripe's minimum charge — the close-out's floor case.
  const tiny = await invoiceOverage(customer.payload.id, '2026-10-005', 40)
  record('tiny', {
    ok: tiny.ok,
    stage: tiny.stage,
    status: tiny.status ?? null,
    error: tiny.error ?? tiny.payload?.error?.message ?? null,
  })

  // 8. A dispute, which resets the ladder and pauses accrual.
  record('card-dispute', await attachCard(customer.payload.id, 'tok_createDispute'))
  const disputed = await invoiceOverage(customer.payload.id, '2026-10-006', 2_500)
  record('dispute', {
    ok: disputed.ok,
    invoiceId: disputed.invoiceId ?? null,
    charge: disputed.charge ?? null,
    note: 'charge.dispute.created follows asynchronously; read it on the endpoint',
  })

  console.log('\n--- findings ---')
  console.log(JSON.stringify(findings, null, 2))
  console.log(
    `\nDelete the rehearsal with:\n  curl -X DELETE ` +
      `https://api.stripe.com/v1/test_helpers/test_clocks/${clock.payload.id} ` +
      `-u "$STRIPE_SECRET_KEY:"`,
  )
}

refuseLiveKey()
if (RUN) {
  await run()
} else {
  printPlan()
}
