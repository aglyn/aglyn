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

import { sanitizeEventParams } from '@aglyn/aglyn/app-utils/analytics-events'

/**
 * Server-to-server GA4 delivery via the Measurement Protocol (AGL-1561) —
 * used for `purchase`, and only for `purchase`.
 *
 * ## Why revenue is sent from the server and nothing else is
 *
 * The obvious alternative is a client-side `purchase` on the post-checkout
 * return page. It is simpler, and it is wrong for money:
 *
 * - **The return page is not reached reliably.** Stripe redirects back after
 *   payment, and a customer who closes the tab, loses signal, or gets a bank
 *   3DS interstitial that lands somewhere else has still paid us. Their
 *   revenue would simply never appear.
 * - **Ad blockers drop it**, and they are over-represented in exactly the
 *   developer audience Aglyn sells to. Under-reported revenue is worse than
 *   no revenue reporting, because it looks like data.
 * - **`?status=success` carries no amount and no session id** (verified: the
 *   hosted checkout return URL sets only `status`, and nothing in the app
 *   reads it), so a client event could not state what was actually charged.
 *   It would also re-fire on a refresh or a back-navigation.
 * - The authoritative amount, currency and transaction id already exist,
 *   server-side, in the Stripe webhook — the same place the subscription
 *   mirror is written. Reporting revenue from anywhere else means reporting
 *   a second, weaker version of a number we already hold.
 *
 * `begin_checkout` stays client-side, because intent genuinely is a browser
 * event and its loss to an ad blocker costs a funnel step, not a dollar.
 *
 * ## The `client_id` problem, stated plainly
 *
 * The Measurement Protocol REQUIRES a `client_id`, and a server has no way to
 * know the browser's. Whatever is supplied decides whether the purchase joins
 * the user's existing GA session — and therefore whether revenue can be
 * attributed to the campaign that produced it, which is the entire point of
 * the exercise.
 *
 * So the browser's real `client_id` is captured when checkout STARTS and
 * carried on the Stripe object's metadata (`ga_client_id`), and read back
 * here. When it is present, the purchase lands on the same GA user and
 * session as the marketing click that produced it.
 *
 * When it is absent — an older checkout session, a customer whose consent or
 * ad blocker meant gtag never ran, or a subscription renewal months later
 * with no browser involved at all — {@link sendGa4Purchase} falls back to a
 * synthesized id derived from the Stripe customer. That records the revenue
 * correctly but attributes it to a synthetic, sessionless user: the money is
 * right, the channel is unknown. This is a deliberate trade (revenue truth
 * beats attribution completeness) and NOT a silent one — the fallback is
 * counted in the returned result so it can be alarmed on if it ever becomes
 * the common case.
 *
 * ## Failure posture
 *
 * Fire-and-forget, swallowing everything. The webhook route claims each
 * Stripe event in a `stripeEvents` doc BEFORE running handlers and deletes
 * the claim on any throw, so a thrown error here would un-claim the event and
 * make Stripe redeliver it — turning a missing analytics hit into a repeated
 * billing side effect. Analytics must never be able to do that.
 */

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect'
const SEND_TIMEOUT_MS = 3000

export interface Ga4PurchaseItem {
  item_id: string
  item_name: string
  item_category?: string
  price?: number
  quantity?: number
}

export interface Ga4PurchaseInput {
  /** Stripe object id — invoice or checkout session. GA de-duplicates on it. */
  transactionId: string
  /** Whole currency units, NOT cents. */
  value: number
  /** ISO 4217, upper-cased by the caller or here. */
  currency: string
  items: Ga4PurchaseItem[]
  billingInterval?: 'monthly' | 'annual'
  /**
   * The browser's GA `client_id`, captured at checkout start and carried on
   * Stripe metadata. Absent for renewals and for customers whose gtag never
   * ran; see the module comment.
   */
  clientId?: string | null
  /** Opaque Firebase uid. The one identifier GA is allowed to hold. */
  userId?: string | null
  /** Stripe customer id — used ONLY to synthesize a fallback client id. */
  stripeCustomerId?: string | null
}

export interface Ga4SendResult {
  sent: boolean
  /** True when no real browser client id was available. */
  synthesizedClientId: boolean
  reason?: string
}

/**
 * A stable, opaque stand-in for a browser client id.
 *
 * GA expects the `<random>.<timestamp>` shape. Determinism matters more than
 * realism: the same Stripe customer must map to the same synthetic user on
 * every renewal, or one paying customer becomes a crowd of one-purchase
 * strangers and ARPA is nonsense. Derived by a cheap non-cryptographic hash —
 * this is a bucketing key, not a secret, and the Stripe customer id it comes
 * from never leaves this function.
 */
export function synthesizeClientId(stripeCustomerId: string): string {
  let hash = 0
  for (let i = 0; i < stripeCustomerId.length; i += 1) {
    hash = (hash * 31 + stripeCustomerId.charCodeAt(i)) >>> 0
  }
  // Fixed second component: a real timestamp would make the id move between
  // renewals, which is precisely what determinism is here to prevent.
  return `${hash}.1000000000`
}

/**
 * Send one `purchase` to GA4. Never throws.
 *
 * Returns a result rather than void so the caller can log the fallback rate;
 * nothing about the return value should change billing behaviour.
 */
export async function sendGa4Purchase(
  input: Ga4PurchaseInput,
): Promise<Ga4SendResult> {
  const measurementId = process.env.GA4_MEASUREMENT_ID || ''
  const apiSecret = process.env.GA4_API_SECRET || ''
  // Absent config is the normal state on self-hosted deployments and in
  // development — not an error, and not worth a log line per payment.
  if (!measurementId || !apiSecret) {
    return { sent: false, synthesizedClientId: false, reason: 'not-configured' }
  }
  const clientId =
    input.clientId ||
    (input.stripeCustomerId ? synthesizeClientId(input.stripeCustomerId) : '')
  if (!clientId) {
    return { sent: false, synthesizedClientId: false, reason: 'no-client-id' }
  }
  const synthesizedClientId = !input.clientId

  // The same sanitizer the browser path uses, applied again here. The inputs
  // are Stripe-derived rather than hand-written, and a Stripe product name is
  // one `metadata` edit away from carrying a customer's name.
  const params = sanitizeEventParams({
    transaction_id: input.transactionId,
    currency: String(input.currency || 'USD').toUpperCase(),
    value: input.value,
    ...(input.billingInterval
      ? { billing_interval: input.billingInterval }
      : {}),
    items: input.items,
  })

  try {
    const response = await fetch(
      `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(
        measurementId,
      )}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          // Opaque uid only — it is what stitches this purchase to the
          // console's client-side events, which set the same user_id.
          ...(input.userId ? { user_id: input.userId } : {}),
          // Analytics-only posture (AGL-1538): Google Signals and ads
          // personalization are OFF on the property, and this asserts the
          // same thing per hit so a future dashboard change cannot quietly
          // opt our server-side revenue into ads personalization.
          non_personalized_ads: true,
          events: [{ name: 'purchase', params }],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          tag: 'AGL-1561:ga4-purchase',
          status: response.status,
          transactionId: input.transactionId,
        }),
      )
      return {
        sent: false,
        synthesizedClientId,
        reason: `http-${response.status}`,
      }
    }
    return { sent: true, synthesizedClientId }
  } catch (error) {
    // Swallowed on purpose — see the module comment: a throw here would
    // un-claim the Stripe event and cause a redelivery.
    console.warn(
      JSON.stringify({
        tag: 'AGL-1561:ga4-purchase',
        error: error instanceof Error ? error.message : 'unknown',
        transactionId: input.transactionId,
      }),
    )
    return { sent: false, synthesizedClientId, reason: 'network' }
  }
}
