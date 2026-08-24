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

import type { AnalyticsEventParams } from '@aglyn/aglyn/app-utils/analytics-events'

/**
 * The two `purchase` derivations for a PAID BOOKING (AGL-2481), kept in one
 * file precisely because they are different numbers and must stay that way.
 *
 * The bookings plugin sent no analytics event of any kind. Its billing webhook
 * computed real money and spent it on a contact record and a confirmation
 * email, so booking revenue was invisible in Aglyn's GA4 property AND in the
 * merchant's — the second of which does not read as "not measured", it reads
 * as a 100% abandonment rate on every service a merchant sells.
 *
 * Commerce and marketplace already settled every question this raises, and
 * nothing here is invented:
 *
 * | | Aglyn's property | the merchant's property |
 * |---|---|---|
 * | sender | server, Measurement Protocol | browser, the merchant's `gtag` |
 * | `value` | platform NET — our fee | GROSS ex-tax — what they sold |
 * | our fee | IS the value | NOT subtracted; their cost of sale |
 * | tax | excluded, no `tax` param | excluded, no `tax` param |
 *
 * ## Why the split is the whole point
 *
 * Reporting the same figure into both properties is the expensive mistake, in
 * either direction. Gross into OUR property would make one $95 massage read as
 * $95 of Aglyn revenue beside a $95 subscription, and every combined total,
 * ARPA and revenue audience becomes nonsense (AGL-1639). Platform net into the
 * MERCHANT's property would show them a few percent of their real revenue
 * (AGL-1641). Each number is right in exactly one place.
 *
 * Nothing is double-counted across the two because they are two different
 * GA4 properties, measuring two different businesses, and the figures are
 * disjoint by construction: ours is the fee, theirs is the sale less the fee's
 * base. Within each property GA4 de-duplicates on `transaction_id`, and both
 * senders use the Stripe Checkout Session id — the same key the webhook's own
 * idempotency turns on.
 */

/** Money, to two decimals. A float sum of cents produces `59.99999999999999`. */
function toAmount(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * AGLYN's revenue on a paid booking, in cents — the fee we actually charged.
 *
 * ## The measured value, not a rate re-applied
 *
 * `server.ts` resolves the take rate from the org's plan and stamps the
 * resulting `application_fee_amount` onto the session as `metadata.feeCents`.
 * That stamp is what this reads. It is deliberately NOT re-derived here from
 * the plan and the price, for the same reason AGL-2315 refused to re-derive it
 * at refund time: the rate follows the plan and the plan moves, so a later
 * derivation reports a share that was never taken.
 *
 * This is the "records a constant instead of the measured value" trap in its
 * exact local form — the one that would look right in every test written
 * against a single-tier fixture, and silently report the same revenue for
 * every merchant on the platform. The figure comes off the Stripe object or it
 * does not exist.
 *
 * Returns 0 on the 0%-rate tiers, where `'0'` is a real recorded answer rather
 * than a missing one. The caller drops the event rather than sending
 * `value: 0` — see {@link shouldSendBookingPlatformPurchase}.
 */
export function bookingPlatformNetCents(object: any): number {
  return Math.max(0, Math.round(Number(object?.metadata?.feeCents ?? 0)))
}

/**
 * Whether Aglyn earned anything reportable on this booking.
 *
 * A `purchase` carrying `value: 0` is not a truthful record of a free
 * transaction — it is a row that drags ARPA down and inflates the purchase
 * COUNT, which is the denominator of conversion rate. On a 0%-fee tier the
 * merchant genuinely sold something and Aglyn genuinely earned nothing, and
 * "nothing" is better said by the absence of a revenue event than by a
 * zero-valued one. Mirrors `buildStorefrontPurchaseParams`, which returns null
 * on a non-positive value for the same reason.
 */
export function shouldSendBookingPlatformPurchase(object: any): boolean {
  return bookingPlatformNetCents(object) > 0
}

/**
 * The GA-safe projection of a paid booking (AGL-2481). Deliberately NOT the
 * booking document: this crosses the wire to a guest's browser, so it can only
 * hold what a `purchase` needs. `email`, `name`, `timezone` and the appointment
 * times are absent by construction rather than by a `delete` somebody has to
 * remember — the same discipline as `StorefrontPurchaseSource`.
 *
 * `feeCents` is absent too, and that is not an oversight: a guest has no
 * business learning Aglyn's take rate on their hairdresser.
 */
export interface BookingPurchaseSource {
  /** Stripe Checkout Session id. GA4 de-duplicates on it. */
  transactionId: string
  /** Stripe's `amount_total`, verbatim — service plus the merchant's tax. */
  paidAmountCents: number
  /** The merchant's own service tax, from the session metadata. */
  taxCents: number
  serviceId: string
  serviceName: string
}

/**
 * Build the `purchase` a TENANT SITE reports to the MERCHANT's GA4 property.
 *
 * ## Whose revenue this is
 *
 * The merchant's, gross of our fee. On their own site the merchant is the
 * seller; Aglyn's cut is not a share of this sale from their side, it is a cost
 * of making it. So `bookingPlatformNetCents` is NOT subtracted here — this is
 * the exact inverse of the figure the server sends to our property, and the
 * inversion is deliberate (AGL-1641).
 *
 * ## Tax is excluded, and no `tax` param is sent
 *
 * A booking's tax is the merchant's own configured flat rate, which Terms
 * §10.7 does not reach (AGL-1956) — so it stays theirs to remit, and what was
 * collected is money held for an authority rather than revenue. `value` is
 * therefore ex-tax, and no GA4 `tax` param rides beside it — beside an ex-tax
 * `value` that param asserts a relationship that does not hold and invites the
 * subtraction that removes tax a second time (AGL-1639/AGL-1641 both declined
 * it, and the asymmetry with `shipping` there is not an inconsistency to tidy).
 *
 * ## No `shipping` param at all
 *
 * Commerce always sends `shipping`, including as 0, because on a storefront 0
 * is a true statement about an order that carried none. A booking is an
 * appointment: there is no shipping concept to be zero. `shipping` is optional
 * on the taxonomy's `purchase` for exactly this case — "a plan or a marketplace
 * purchase has no shipping to report and omits it" — and a booking omits it for
 * the same reason. Sending 0 would put every service business in a shipping
 * report they are not in.
 *
 * ## Why `value` derives from `amount_total`
 *
 * `paidAmountCents` is Stripe's `amount_total` verbatim, so it reconciles with
 * the charge by construction. The booking document stores no price to re-derive
 * from, and a service price edited between session creation and webhook
 * delivery would make any re-derivation disagree with what the guest actually
 * paid.
 *
 * `taxCents` is the merchant's own rate as charged. It has to come from the
 * session metadata rather than from Stripe's tax fields: the rate rides as an
 * ordinary `line_items[1]` Stripe is never told is tax (the AGL-1711
 * construction, which is what keeps the figure the MERCHANT's), so
 * `total_details.amount_tax` reads 0 on a booking that really did charge tax.
 * Reading Stripe's field would report tax-inclusive gross — the AGL-1639
 * overstatement, live.
 *
 * Returns `null` when there is nothing truthful to send. A dropped event is a
 * gap in the merchant's report; a fabricated one is a wrong number in it, and
 * the second is worse.
 */
export function buildBookingPurchaseParams(
  source: BookingPurchaseSource,
): AnalyticsEventParams['purchase'] | null {
  const transactionId = String(source?.transactionId ?? '').trim()
  if (!transactionId) return null

  const paidAmountCents = Math.round(Number(source?.paidAmountCents ?? 0))
  // Clamped, so a negative cannot be ADDED back into the value by subtraction.
  const taxCents = Math.max(0, Math.round(Number(source?.taxCents ?? 0)))
  const netOfTaxCents = paidAmountCents - taxCents
  if (!Number.isFinite(netOfTaxCents) || netOfTaxCents <= 0) return null

  return {
    transaction_id: transactionId,
    // No currency is stored on a booking and the session is opened in USD;
    // `buildStorefrontPurchaseParams` takes the same default so a merchant
    // running both plugins sees one currency across both revenue lines.
    currency: 'USD',
    value: toAmount(netOfTaxCents),
    items: [
      {
        // The SERVICE id, so a merchant can read revenue per service. The
        // name is the merchant's own content on the merchant's own property,
        // which is why it is sent here and withheld from ours.
        item_id: String(source?.serviceId ?? ''),
        item_name: String(source?.serviceName ?? ''),
        // NO `item_category`, matching the storefront items (docs/ANALYTICS.md,
        // "The event map"). In a MERCHANT's property a constant category is a
        // column with one value in it, and their real service categories are
        // not on this payload. It would be actively worse than useless for a
        // merchant running both plugins: products would carry no category and
        // bookings would carry one, so the dimension would be half-populated
        // for a reason GA cannot distinguish from missing data.
        //
        // OUR property is the opposite case and does set it — there `booking`
        // sits beside `subscription` and `marketplace` and separates three
        // real revenue lines.
        price: toAmount(netOfTaxCents),
        quantity: 1,
      },
    ],
    // No `billing_interval`: a booking is not a subscription.
    // No `shipping`: see above.
  }
}

/**
 * Reduce a stored booking to the wire shape above. Server-side only — it reads
 * fields the projection exists to withhold.
 */
export function toBookingPurchaseSource(
  transactionId: string,
  booking: Record<string, any>,
): BookingPurchaseSource {
  return {
    transactionId,
    paidAmountCents: Number(booking?.['paidAmountCents'] ?? 0),
    taxCents: Number(booking?.['taxCents'] ?? 0),
    serviceId: String(booking?.['serviceId'] ?? ''),
    serviceName: String(booking?.['serviceName'] ?? ''),
  }
}
