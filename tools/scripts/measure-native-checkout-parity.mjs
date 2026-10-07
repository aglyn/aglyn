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

// TEST-MODE ONLY: does an in-page (`ui_mode=elements`) Checkout Session charge
// exactly what the hosted redirect charges? (AGL-3606)
//
//   node tools/scripts/measure-native-checkout-parity.mjs [--env apps/tenant/.env] [--json]
//
// Reads STRIPE_SECRET_KEY_TEST (else STRIPE_SECRET_KEY) from the environment or
// the named env file, and REFUSES anything that is not an `sk_test_` key: the
// script creates Checkout Sessions, and a live session is a real payable link.
//
// Each scenario is sent twice with byte-identical params — once as the hosted
// path sends it (account-default API version, success/cancel URLs) and once as
// `applyNativeCheckoutParams` rewrites it (`ui_mode=elements`, `return_url`,
// `Stripe-Version: 2026-03-25.dahlia`). The two `amount_total`s and
// `total_details` must match. The scenarios mirror what `checkout.ts` and
// `cart-checkout.ts` actually build: a manual tax line, `fixed_amount`
// shipping with address collection, Stripe Tax (`automatic_tax`), and the
// Connect split in both of its forms (`application_fee_amount`, and the fixed
// `transfer_data[amount]` a Stripe Tax cart uses).
//
// Every session it opens is expired before it exits, so nothing payable is
// left behind on the test account.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NATIVE_VERSION = '2026-03-25.dahlia'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index > -1 ? process.argv[index + 1] : undefined
}

function readEnvFile(path) {
  const values = {}
  try {
    for (const line of readFileSync(resolve(path), 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // An absent file is the same as an empty one; the key check below speaks.
  }
  return values
}

const fileEnv = readEnvFile(argValue('--env') ?? 'apps/tenant/.env')
const secretKey =
  process.env.STRIPE_SECRET_KEY_TEST ||
  fileEnv.STRIPE_SECRET_KEY_TEST ||
  process.env.STRIPE_SECRET_KEY ||
  fileEnv.STRIPE_SECRET_KEY ||
  ''
if (!secretKey.startsWith('sk_test_')) {
  console.error('Refusing: a TEST secret key (sk_test_…) is required.')
  process.exit(2)
}

async function stripe(method, path, params, headers = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: params ? params.toString() : undefined,
  })
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `HTTP ${response.status}`)
    error.stripe = body?.error
    throw error
  }
  return body
}

/** A test connected account able to receive a destination charge. */
async function findDestination() {
  const list = await stripe('GET', 'accounts?limit=100')
  const ready = list.data.find(
    (account) => account.capabilities?.transfers === 'active',
  )
  return ready?.id ?? null
}

function baseParams({ destination, shipping, manualTax, automaticTax, split }) {
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][price_data][currency]', 'usd')
  params.set('line_items[0][price_data][unit_amount]', '2500')
  params.set('line_items[0][price_data][product_data][name]', 'Parity probe')
  params.set('line_items[0][quantity]', '2')
  if (manualTax) {
    params.set('line_items[1][price_data][currency]', 'usd')
    params.set('line_items[1][price_data][unit_amount]', '413')
    params.set('line_items[1][price_data][product_data][name]', 'Tax (8.25%)')
    params.set('line_items[1][quantity]', '1')
  }
  if (automaticTax) params.set('automatic_tax[enabled]', 'true')
  if (shipping) {
    params.set('shipping_address_collection[allowed_countries][0]', 'US')
    params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount')
    params.set(
      'shipping_options[0][shipping_rate_data][fixed_amount][amount]',
      '799',
    )
    params.set(
      'shipping_options[0][shipping_rate_data][fixed_amount][currency]',
      'usd',
    )
    params.set(
      'shipping_options[0][shipping_rate_data][display_name]',
      'Standard',
    )
  }
  if (destination) {
    params.set('payment_intent_data[transfer_data][destination]', destination)
    if (split === 'fee') {
      params.set('payment_intent_data[application_fee_amount]', '150')
    } else {
      params.set('payment_intent_data[transfer_data][amount]', '4850')
    }
  }
  params.set('metadata[probe]', 'agl-3606-parity')
  return params
}

function hosted(params) {
  const copy = new URLSearchParams(params)
  copy.set('success_url', 'https://example.com/?order=success&session_id={CHECKOUT_SESSION_ID}')
  copy.set('cancel_url', 'https://example.com/?order=canceled')
  return copy
}

function native(params) {
  const copy = new URLSearchParams(params)
  copy.set('ui_mode', 'elements')
  copy.set('return_url', 'https://example.com/?order=success&session_id={CHECKOUT_SESSION_ID}')
  return copy
}

const opened = []

async function measure(name, options) {
  const params = baseParams(options)
  const results = {}
  for (const [path, build, headers] of [
    ['hosted', hosted, {}],
    ['elements', native, { 'Stripe-Version': NATIVE_VERSION }],
  ]) {
    try {
      const session = await stripe(
        'POST',
        'checkout/sessions',
        build(params),
        headers,
      )
      opened.push(session.id)
      results[path] = {
        amount_total: session.amount_total,
        amount_subtotal: session.amount_subtotal,
        total_details: session.total_details,
        ui_mode: session.ui_mode,
        has_client_secret: Boolean(session.client_secret),
        has_url: Boolean(session.url),
      }
    } catch (error) {
      results[path] = { error: error.message }
    }
  }
  const match =
    results.hosted?.amount_total !== undefined &&
    results.hosted.amount_total === results.elements?.amount_total &&
    JSON.stringify(results.hosted.total_details) ===
      JSON.stringify(results.elements.total_details)
  return { name, match, ...results }
}

async function main() {
  const destination = await findDestination()
  const scenarios = [
    ['manual tax + fixed shipping + application fee', { manualTax: true, shipping: true, split: 'fee' }],
    ['Stripe Tax + fixed shipping + fixed transfer', { automaticTax: true, shipping: true, split: 'amount' }],
    ['Stripe Tax, no shipping (billing address decides tax)', { automaticTax: true, split: 'amount' }],
    ['manual tax, no shipping, application fee', { manualTax: true, split: 'fee' }],
  ]
  const report = { measuredAt: new Date().toISOString(), apiVersion: NATIVE_VERSION, destination: destination ? 'test connected account' : null, scenarios: [] }
  for (const [name, options] of scenarios) {
    report.scenarios.push(await measure(name, { ...options, destination }))
  }
  // Leave nothing payable behind.
  for (const id of opened) {
    await stripe('POST', `checkout/sessions/${id}/expire`).catch(() => undefined)
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Measured ${report.measuredAt} at ${report.apiVersion}; Connect destination: ${report.destination ?? 'NONE (no test account with transfers active)'}`)
    for (const scenario of report.scenarios) {
      const line = (result) =>
        result?.error
          ? `error: ${result.error}`
          : `amount_total ${result.amount_total}, tax ${result.total_details?.amount_tax}, shipping ${result.total_details?.amount_shipping}`
      console.log(`${scenario.match ? 'MATCH ' : 'DIFFER'}  ${scenario.name}`)
      console.log(`        hosted:   ${line(scenario.hosted)}`)
      console.log(`        elements: ${line(scenario.elements)}`)
    }
  }
  process.exit(report.scenarios.every((scenario) => scenario.match) ? 0 : 1)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
