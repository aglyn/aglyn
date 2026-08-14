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
 * `purchase`, and the one activation event no browser can witness.
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
 * ## The second sender: `site_published` from a scheduled publish (AGL-1589)
 *
 * Everything above argues for keeping the server-side surface as small as
 * possible, and {@link sendGa4SitePublished} is the one other event that has
 * no browser to fire it: a SCHEDULED publish is applied by a cron beat (or by
 * an ISR regeneration) at a moment when the author is asleep. Until AGL-1589
 * that path could not make a page reachable at all, so it was not an
 * activation and nothing was sent; now that it registers the routing entry, a
 * scheduled FIRST publish is a route going live and `publishScreenRoute`'s
 * client-side `site_published` — the headline activation metric — would miss
 * it. It is sent HERE for the same reason revenue is: the alternative is not
 * a weaker event, it is no event.
 *
 * The rest of the activation funnel stays client-side. This is not a general
 * server-side analytics channel and should not become one.
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
 * realism: the same `seed` must map to the same synthetic user every time, or
 * one paying customer becomes a crowd of one-purchase strangers and ARPA is
 * nonsense. Derived by a cheap non-cryptographic hash — this is a bucketing
 * key, not a secret, and the seed it comes from never leaves this function.
 *
 * The seed is whatever identifies the actor the events belong to on the
 * surface doing the sending: the Stripe customer for revenue, the host id for
 * a scheduled publish (AGL-1589). Both are opaque to GA — only the hash is
 * ever transmitted.
 */
export function synthesizeClientId(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  // Fixed second component: a real timestamp would make the id move between
  // renewals, which is precisely what determinism is here to prevent.
  return `${hash}.1000000000`
}

interface Ga4Credentials {
  measurementId: string
  apiSecret: string
}

/**
 * Absent config is the normal state on self-hosted deployments and in
 * development — not an error, and not worth a log line per event. It is also
 * the current state of the TENANT deployment (AGL-1589): neither variable is
 * set on the aglyn-tenant Vercel project (checked 2026-08-14), so
 * `sendGa4SitePublished` no-ops there until they are added, exactly as
 * intended. See docs/ANALYTICS.md.
 */
function ga4Credentials(): Ga4Credentials | null {
  const measurementId = process.env.GA4_MEASUREMENT_ID || ''
  const apiSecret = process.env.GA4_API_SECRET || ''
  if (!measurementId || !apiSecret) return null
  return { measurementId, apiSecret }
}

/**
 * POST one already-sanitized event. Never throws — see the module comment on
 * failure posture; the callers run inside a Stripe webhook claim and inside a
 * publish executor, and in both a throw would have a side effect far worse
 * than a missing analytics hit.
 */
async function postGa4Event(options: {
  credentials: Ga4Credentials
  eventName: string
  params: Record<string, unknown>
  clientId: string
  userId?: string | null
  /** Structured-log fields for the two failure lines (tag + subject). */
  log: Record<string, unknown>
}): Promise<{ sent: boolean; reason?: string }> {
  const { credentials, eventName, params, clientId, userId, log } = options
  try {
    const response = await fetch(
      `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(
        credentials.measurementId,
      )}&api_secret=${encodeURIComponent(credentials.apiSecret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          // Opaque uid only — it is what stitches this event to the
          // console's client-side events, which set the same user_id.
          ...(userId ? { user_id: userId } : {}),
          // Analytics-only posture (AGL-1538): Google Signals and ads
          // personalization are OFF on the property, and this asserts the
          // same thing per hit so a future dashboard change cannot quietly
          // opt our server-side events into ads personalization.
          non_personalized_ads: true,
          events: [{ name: eventName, params }],
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    )
    if (!response.ok) {
      console.warn(JSON.stringify({ ...log, status: response.status }))
      return { sent: false, reason: `http-${response.status}` }
    }
    return { sent: true }
  } catch (error) {
    console.warn(
      JSON.stringify({
        ...log,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    )
    return { sent: false, reason: 'network' }
  }
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
  const credentials = ga4Credentials()
  if (!credentials) {
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

  // Swallows everything — see the module comment: a throw here would un-claim
  // the Stripe event and cause a redelivery.
  const result = await postGa4Event({
    credentials,
    eventName: 'purchase',
    params,
    clientId,
    userId: input.userId,
    log: {
      tag: 'AGL-1561:ga4-purchase',
      transactionId: input.transactionId,
    },
  })
  return { ...result, synthesizedClientId }
}

/**
 * Send one `site_published` for a route that went live with no browser
 * involved (AGL-1589). Never throws.
 *
 * ## Why this is allowed to be a synthetic user
 *
 * The client id is derived from the HOST — the site whose route went live —
 * and not from the author, because the author is not present: a scheduled
 * publish is applied by the cron beat minutes or hours after anybody clicked
 * anything, and the browser that wrote the schedule is long gone. There is no
 * session to join and nothing to attribute.
 *
 * Deriving it from the host rather than randomly is what keeps the metric
 * honest in the one direction it can be dishonest. "% who publish a site"
 * counts USERS, so a random id per publish would let one site scheduling ten
 * publishes look like ten activated customers — the same inflation
 * `publishScreenRoute` avoids by firing only when a route goes live. One host
 * is one synthetic user, forever, however many of its screens go live on a
 * timer.
 *
 * ## One param, deliberately
 *
 * `first_publish` and nothing else, matching the browser event (AGL-1588).
 * The host id is a resource identifier bought for nothing, and the rest of the
 * metric is answered by the event alone; the id is used only as the hash seed
 * and never transmitted.
 *
 * The caller decides `first_publish` from the routing map it read before
 * registering the entry, through the same `isFirstPublishedRoute` the console
 * uses — a dimension is only worth registering if every sender means the same
 * thing by it, and this sender is the one nobody can watch happen.
 */
export async function sendGa4SitePublished(input: {
  /** Host uid the route went live on — hashed into a client id, never sent. */
  hostId: string
  /**
   * Whether the host had no live route at all before this one. Omit when it
   * genuinely cannot be determined — the param is optional and an absent
   * breakdown value beats an invented one.
   */
  firstPublish?: boolean
}): Promise<Ga4SendResult> {
  const credentials = ga4Credentials()
  if (!credentials) {
    return { sent: false, synthesizedClientId: false, reason: 'not-configured' }
  }
  if (!input.hostId) {
    return { sent: false, synthesizedClientId: false, reason: 'no-client-id' }
  }
  const result = await postGa4Event({
    credentials,
    eventName: 'site_published',
    // Sanitized like every other payload even though it carries one boolean —
    // the guarantee should hold because the sanitizer ran, not because the
    // author of this call happened to pass nothing identifying. It also drops
    // `first_publish` when it is undefined, which is how "not determined"
    // stays distinct from `false`.
    params: sanitizeEventParams({ first_publish: input.firstPublish }),
    clientId: synthesizeClientId(input.hostId),
    log: { tag: 'AGL-1589:ga4-site-published' },
  })
  // Always synthetic here: there is no browser client id to have missed.
  return { ...result, synthesizedClientId: true }
}
