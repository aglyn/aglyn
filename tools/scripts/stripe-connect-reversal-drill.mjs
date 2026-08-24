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

// The AGL-1956 transfer-reversal drill — TEST MODE ONLY.
//
//   node tools/scripts/stripe-connect-reversal-drill.mjs [--fail=<mutation>]
//
// `reverseSubscriptionTaxToPlatform` pulls the sales tax on a Stripe Tax
// subscription cycle back out of the merchant's transfer. Two of its design
// choices rest on Stripe behaviour that CANNOT be read off the documentation
// with confidence, so they are measured here instead:
//
//   GAP 1  a refund with `reverse_transfer=true` meeting a transfer this code
//          has ALREADY partially reversed — does Stripe cap the extra
//          reversal, error, or over-reverse and drive the account negative?
//
//   GAP 2  is a 4xx stored under the `Idempotency-Key` and replayed? If it is,
//          a reversal that failed once can NEVER succeed under a fixed key,
//          and Aglyn silently keeps owing a state money it never clawed back.
//
// ── WHAT THIS MEASURED (2026-08-24, test mode) ──────────────────────────────
//
// GAP 1 — STRIPE CAPS. It does not error and does not over-reverse.
//   tax reversal 825 → FULL refund 11325 → amount_reversed 11325 (capped)
//   tax reversal 825 → refund 5000       → amount_reversed 5825
//   reversal 11000   → refund 5000       → amount_reversed 11325 (capped)
//   So `refund.ts` needs no new error handling. What this code must never do
//   is ASK for more than the transfer has left — that request does 400.
//
// GAP 2 — THE 4xx IS CACHED, and Stripe's docs say otherwise.
//   The docs state results are saved only once an endpoint begins executing,
//   and that validation failures are not saved. Measured, a refused reversal
//   replayed under the same key returned the SAME 400 with
//   `Idempotent-Replayed: true`, and the same key with a CORRECTED body was
//   refused with `idempotency_error` while the transfer stayed at
//   `amount_reversed=0`. The observation is what the code follows: the key
//   carries an attempt number, and the no-double-reversal guarantee lives on
//   the Firestore claim plus adopt-by-metadata instead.
//
// ── FALSIFICATION ───────────────────────────────────────────────────────────
// A harness that cannot fail proves nothing.
//
//   --fail=stable-key   retry the failed reversal under the SAME key rather
//                       than a fresh one → the retry must be REFUSED, which is
//                       the whole reason the production key carries an attempt

const args = process.argv.slice(2)
const MUTATION = (args.find((a) => a.startsWith('--fail=')) ?? '').slice(7)
const VALID = ['', 'stable-key']
if (!VALID.includes(MUTATION)) {
  console.error(`Unknown --fail=${MUTATION}. Valid: ${VALID.slice(1).join(', ')}`)
  process.exit(2)
}

const fs = await import('node:fs')
const ENV = 'apps/console/.env.development.local'
if (!process.env.STRIPE_SECRET_KEY && fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = /^STRIPE_SECRET_KEY=(.*)$/.exec(line.trim())
    if (m) process.env.STRIPE_SECRET_KEY = m[1].trim().replace(/^["']|["']$/g, '')
  }
}

// ── The mode guard ──────────────────────────────────────────────────────────
//
// NEVER TRUST A COMMENT OR AN ENV NAME. `apps/console/.env.production.local`
// carries `STRIPE_SECRET_KEY=sk_live_…` under a header reading "# Stripe (TEST
// MODE)", and AGL-2401 reports the LIVE secret is set in Vercel's development
// AND preview environments too. The key's own prefix is the only trustworthy
// signal, and it is checked before any call.
const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET || !SECRET.startsWith('sk_test_')) {
  console.error(
    'REFUSING TO RUN: STRIPE_SECRET_KEY does not start with `sk_test_`.\n' +
      `  resolved prefix: ${String(SECRET).slice(0, 8)}…\n` +
      '  This drill CREATES connected accounts, CHARGES cards, REVERSES\n' +
      '  transfers and REFUNDS. Against a live key that is real money.',
  )
  process.exit(2)
}

async function stripe(pathname, params, headers) {
  const res = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
      ...headers,
    },
    body: params ? new URLSearchParams(params) : undefined,
  })
  return {
    ok: res.ok,
    status: res.status,
    body: await res.json(),
    replayed: res.headers.get('idempotent-replayed'),
  }
}

const results = []
function assert(leg, claim, condition, detail) {
  results.push({ leg, ok: Boolean(condition) })
  console.log(`${condition ? '  ✓' : '  ✗'} [${leg}] ${claim}${detail ? `\n        ${detail}` : ''}`)
}
const legTitle = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`)
const errText = (r) => `${r.body?.error?.code ?? r.body?.error?.type}: ${r.body?.error?.message}`

const TAX = 825
const GROSS = 11325

async function connectedAccount() {
  const r = await stripe('accounts', {
    type: 'custom',
    country: 'US',
    email: 'agl1956-drill@example.com',
    'capabilities[transfers][requested]': 'true',
    'capabilities[card_payments][requested]': 'true',
    business_type: 'individual',
    'individual[first_name]': 'Drill',
    'individual[last_name]': 'Merchant',
    'individual[email]': 'agl1956-drill@example.com',
    'individual[phone]': '+15555555555',
    'individual[ssn_last_4]': '0000',
    'individual[id_number]': '000000000',
    'individual[dob][day]': '1',
    'individual[dob][month]': '1',
    'individual[dob][year]': '1980',
    'individual[address][line1]': 'address_full_match',
    'individual[address][city]': 'Austin',
    'individual[address][state]': 'TX',
    'individual[address][postal_code]': '78701',
    'individual[address][country]': 'US',
    'business_profile[url]': 'https://aglyn.com',
    'business_profile[mcc]': '5734',
    'tos_acceptance[date]': String(Math.floor(Date.now() / 1000)),
    'tos_acceptance[ip]': '8.8.8.8',
    external_account: 'btok_us_verified',
  })
  if (!r.ok) throw new Error(`account: ${errText(r)}`)
  return r.body.id
}

/** A destination charge shaped exactly like a storefront sale. */
async function destinationCharge(account) {
  const pi = await stripe('payment_intents', {
    amount: String(GROSS),
    currency: 'usd',
    'payment_method_types[]': 'card',
    payment_method: 'pm_card_visa',
    confirm: 'true',
    application_fee_amount: '227',
    'transfer_data[destination]': account,
  })
  if (!pi.ok) throw new Error(`charge: ${errText(pi)}`)
  const charge = await stripe(`charges/${pi.body.latest_charge}`)
  return { chargeId: charge.body.id, transferId: charge.body.transfer }
}

const transferState = async (id) => (await stripe(`transfers/${id}`)).body

const ACCOUNT = await connectedAccount()
console.log(`connected account: ${ACCOUNT}`)

// ═══════════════════════════════════════════════════════════════════════════
legTitle('TOPOLOGY — the subscription shape transfers the WHOLE charge')
{
  // The refund/reversal interaction is a property of the Charge→Transfer
  // graph, so the legs below use direct destination charges. That is only
  // legitimate if the SUBSCRIPTION shape produces the same graph, which is
  // what `reverseSellerShare` and this fix both assume. Measured, not assumed.
  const product = await stripe('products', { name: 'AGL-1956 drill' })
  const price = await stripe('prices', {
    unit_amount: '10000',
    currency: 'usd',
    'recurring[interval]': 'month',
    product: product.body.id,
  })
  const customer = await stripe('customers', {
    payment_method: 'pm_card_visa',
    'invoice_settings[default_payment_method]': 'pm_card_visa',
  })
  const sub = await stripe('subscriptions', {
    customer: customer.body.id,
    'items[0][price]': price.body.id,
    application_fee_percent: '2',
    'transfer_data[destination]': ACCOUNT,
    'expand[]': 'latest_invoice',
  })
  const invoiceId = sub.body.latest_invoice?.id ?? sub.body.latest_invoice
  const invoice = await stripe(`invoices/${invoiceId}`)
  const chargeId = invoice.body.charge ?? invoice.body.payments?.data?.[0]?.payment?.charge
  const charge = await stripe(`charges/${chargeId}`)
  const transfer = await transferState(charge.body.transfer)
  assert(
    'topology',
    'a subscription cycle transfers the whole charge (fee taken at the destination)',
    transfer.amount === charge.body.amount,
    `charge ${charge.body.id} amount=${charge.body.amount}; transfer ${transfer.id} amount=${transfer.amount}`,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
legTitle('GAP 1 — a refund meeting an already partially-reversed transfer')
for (const scenario of [
  { name: 'FULL refund', preReverse: TAX, refund: null },
  { name: 'PARTIAL refund under the remainder', preReverse: TAX, refund: 5000 },
  { name: 'PARTIAL refund OVER the remainder', preReverse: 11000, refund: 5000 },
]) {
  const { chargeId, transferId } = await destinationCharge(ACCOUNT)
  await stripe(
    `transfers/${transferId}/reversals`,
    { amount: String(scenario.preReverse), 'metadata[aglynTaxInvoiceId]': 'drill' },
    { 'Idempotency-Key': `drill-pre-${transferId}` },
  )
  const before = await transferState(transferId)
  const refund = await stripe('refunds', {
    charge: chargeId,
    ...(scenario.refund ? { amount: String(scenario.refund) } : {}),
    reverse_transfer: 'true',
    refund_application_fee: 'true',
  })
  const after = await transferState(transferId)
  assert(
    'gap1',
    `${scenario.name}: Stripe accepts it rather than erroring`,
    refund.ok,
    refund.ok
      ? `refund ${refund.body.id}; reversed ${before.amount_reversed} → ${after.amount_reversed}`
      : errText(refund),
  )
  assert(
    'gap1',
    `${scenario.name}: the extra reversal is CAPPED at the transfer, never over`,
    after.amount_reversed <= after.amount,
    `amount_reversed=${after.amount_reversed} transfer.amount=${after.amount}`,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
legTitle('GAP 2 — is a 4xx stored under the Idempotency-Key and replayed?')
{
  const { transferId } = await destinationCharge(ACCOUNT)
  const KEY = `agl1956-drill-${Date.now()}`
  const tooMuch = { amount: '999999', 'metadata[aglynTaxInvoiceId]': 'drill' }

  const first = await stripe(`transfers/${transferId}/reversals`, tooMuch, {
    'Idempotency-Key': KEY,
  })
  assert('gap2', 'a reversal beyond the remainder is refused', !first.ok, errText(first))

  const replay = await stripe(`transfers/${transferId}/reversals`, tooMuch, {
    'Idempotency-Key': KEY,
  })
  assert(
    'gap2',
    'THE 4xx IS CACHED — the same key replays the stored failure',
    replay.replayed === 'true',
    `Idempotent-Replayed: ${replay.replayed}; status ${replay.status}`,
  )

  // The retry. Production uses a FRESH key per attempt; `--fail=stable-key`
  // reuses the first one, which is what the old design did.
  const retryKey = MUTATION === 'stable-key' ? KEY : `${KEY}-2`
  const retry = await stripe(
    `transfers/${transferId}/reversals`,
    { amount: String(TAX), 'metadata[aglynTaxInvoiceId]': 'drill' },
    { 'Idempotency-Key': retryKey },
  )
  assert(
    'gap2',
    'a corrected retry under a FRESH key actually executes',
    retry.ok,
    retry.ok ? `reversal ${retry.body.id} amount=${retry.body.amount}` : errText(retry),
  )
  if (!retry.ok) {
    console.log(
      '        ↑ under a STABLE key Stripe answers `idempotency_error`, so the\n' +
        '          reversal could never succeed and Aglyn keeps owing the state.',
    )
  }

  // And the guarantee that must NOT regress: replaying a SUCCESSFUL reversal
  // under its own key returns the same object rather than moving money twice.
  const okKey = `${KEY}-ok`
  const body = { amount: '100', 'metadata[aglynTaxInvoiceId]': 'drill-ok' }
  const one = await stripe(`transfers/${transferId}/reversals`, body, {
    'Idempotency-Key': okKey,
  })
  const two = await stripe(`transfers/${transferId}/reversals`, body, {
    'Idempotency-Key': okKey,
  })
  assert(
    'gap2',
    'replaying a SUCCESSFUL reversal returns the same object, moving nothing',
    one.ok && two.ok && one.body.id === two.body.id,
    `${one.body.id} === ${two.body.id}; Idempotent-Replayed: ${two.replayed}`,
  )
}

const failed = results.filter((r) => !r.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} assertions held` +
    (MUTATION ? `  (mutation: --fail=${MUTATION})` : ''),
)
process.exit(failed.length && !MUTATION ? 1 : 0)
