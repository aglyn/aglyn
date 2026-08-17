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
import type { HostOrder } from './commerce-orders'

/**
 * The GA-safe projection of a storefront order (AGL-1641). Deliberately NOT
 * `HostOrder`: this shape crosses the wire to a shopper's browser, so it can
 * only ever hold what a `purchase` event needs. `customerEmail`,
 * `customerName`, `shippingAddress` and `billingAddress` are absent by
 * construction rather than by a `delete` somebody has to remember.
 */
export interface StorefrontPurchaseSource {
  /** Stripe Checkout Session id — also the order doc id. */
  transactionId: string
  totalCents: number
  taxCents: number
  /**
   * Stripe's `total_details.amount_shipping` as the webhook stored it — or
   * `shipping_cost.amount_total` on a subscription invoice, which has no
   * `total_details`. Reported as GA4's `shipping`, NOT subtracted from
   * `value`: it is part of what the merchant sold.
   */
  shippingCents: number
  lineItems: {
    productId: string
    name: string
    quantity: number
    unitAmountCents: number
  }[]
}

/** Money, to two decimals. A float sum of cents produces `59.99999999999999`. */
function toAmount(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * Build the `purchase` a TENANT STOREFRONT reports to the MERCHANT's GA4
 * property (AGL-1641).
 *
 * ## Whose revenue this is — the decision, not an inference
 *
 * This is the exact inverse of the marketplace call in AGL-1639, and the
 * reason is the property the hit lands in. There, the GA property is OURS, the
 * platform fee IS what Aglyn was paid, and `value` had to be platform net so
 * that a marketplace sale and a subscription meant the same thing when GA
 * added them up. Here the property is the MERCHANT's — `gtag` on a tenant site
 * is loaded with `host.analytics.gaMeasurementId`, their measurement id — and
 * on their storefront the merchant is the seller. Aglyn's cut is not a share
 * of this sale from their side; it is a cost of making it.
 *
 * So `feeCents` is NOT subtracted. Subtracting it would report the merchant's
 * gross margin after our fee as though it were their sales revenue, which is
 * not a number any merchant's books, tax return or ad platform recognises.
 *
 * Getting this backwards is the expensive mistake: reporting platform net into
 * a merchant's property would show every merchant on Aglyn a revenue figure a
 * few percent of their real one.
 *
 * ## Tax is excluded, and no `tax` param is sent
 *
 * On a tenant storefront the merchant is seller of record, so tax collected is
 * money held for the state, not revenue. Every mature ecommerce integration
 * reports revenue ex-tax and so do we.
 *
 * No GA4 `tax` param either, following AGL-1639 for the same reason it applied
 * there: `value` already EXCLUDES tax, and GA4's `tax` is documented as a cost
 * associated with the transaction — a component of the value beside it. Sent
 * next to an ex-tax `value` it asserts a relationship that does not hold, and
 * invites exactly the subtraction that would double-remove it.
 *
 * ## Why `value` derives from `totalCents` and not from the parts
 *
 * `totalCents` is overwritten with Stripe's `amount_total` when the webhook
 * writes the order (`billing-webhook.ts`), so it is the one field that
 * reconciles with Stripe by construction: it is Stripe's own number, verbatim.
 *
 * `taxCents` was described here as likewise `total_details.amount_tax`, Stripe's
 * own. On the cart path it is. On the BUY-NOW path it was 0 on every order,
 * because `checkout.ts` sends manual destination tax as an ordinary
 * `line_items[1]` product line that Stripe never classifies as tax — so this
 * `value` reported tax-inclusive gross into the merchant's property, the
 * AGL-1639 overstatement, live. AGL-1711 composes the stored `taxCents` from
 * `amount_tax` plus that line-item tax, and fixes `quantity` and
 * `unitAmountCents` (hardcoded to 1 and to the whole charge) in the same place.
 * Nothing here changed: the three fields this reads are simply true now.
 *
 * The parts used NOT to reconcile, and that is why this derivation exists.
 * `computeOrderTotals` was called with `feeCents`, `taxCents` and
 * `discountCents` but **never `shippingCents`**, so a stored `OrderTotals`
 * recorded `shippingCents: 0` on every online order while the shipping the
 * shopper paid sat inside `amount_total`. Building `value` from
 * `itemsCents + shippingCents - discountCents` would therefore have silently
 * dropped all shipping revenue, understating orders that carried it and
 * leaving orders that did not looking correct. Same failure shape as the
 * AGL-1639 overstatement, opposite sign.
 *
 * AGL-1698 fixed the storage — `computeCheckoutSessionTotals` passes
 * `total_details.amount_shipping`, and the parts now sum to the total. The
 * derivation stays on `totalCents` anyway, for a reason that outlives the bug:
 * `totalCents` is Stripe's `amount_total` verbatim, whereas `itemsCents` is
 * priced from the host's product docs, so a price edit between session
 * creation and webhook delivery would make our sum disagree with the charge.
 *
 * ## A GA4 `shipping` param IS sent — and a `tax` one still is not
 *
 * These two look like an inconsistency and are not. Do not tidy them into
 * agreement in either direction (AGL-1722).
 *
 * `shipping` is a COMPONENT of the `value` reported beside it: `value` is
 * `totalCents - taxCents`, and the shipping the shopper paid is inside that
 * number. GA4's `shipping` is documented as exactly that — shipping charged
 * ON the transaction — so sending it decomposes the value rather than
 * contradicting it, and a merchant can read "of the $105 you sold, $10 was
 * shipping" without any figure being counted twice.
 *
 * `tax` is the opposite: `value` already EXCLUDES it. Sending a `tax` beside
 * an ex-tax `value` asserts a relationship that does not hold and invites the
 * subtraction that removes tax a second time. AGL-1639 and AGL-1641 both
 * declined it for that reason and this change does not disturb them.
 *
 * The param was withheld until now for a truthfulness reason that has since
 * expired twice. AGL-1641 left it out because the stored `shippingCents` was
 * structurally 0 — sending it would have asserted FREE SHIPPING on every
 * order rather than saying nothing. AGL-1698 fixed the storage but the Stripe
 * figure was still structurally 0, because no Checkout Session we created
 * declared `shipping_options`. AGL-1707 wired the merchant's configured zones
 * and rates into the cart session and AGL-1720 into the buy-now one, so
 * `amount_shipping` is a real number on both storefront paths for a merchant
 * who set shipping up. Only the plumbing was left, and it is built here:
 * `shippingCents` rides `StorefrontPurchaseSource` to the wire shape.
 *
 * A 0 now means what it says. A download ships nothing, a merchant who saved
 * no rates charges nothing, and POS and draft orders resolve no shipping — on
 * all of those `shipping: 0` is a true statement about that order, not the old
 * structural zero, so it is sent rather than omitted. Omitting it would leave
 * the merchant's shipping column sparse for a reason GA cannot tell apart from
 * "not tracked".
 *
 * ## Worked example — the spec fixture
 *
 * A $100 item, a $5 coupon, $10 shipping chosen at Stripe Checkout, $9.08 tax,
 * and a 5% Aglyn fee:
 *
 *   itemsCents            10000   line snapshot
 *   - discountCents         500   Stripe `total_details.amount_discount`
 *   + shippingCents        1000   Stripe `total_details.amount_shipping`
 *   + taxCents              908   Stripe `total_details.amount_tax`
 *   = totalCents          11408   Stripe `amount_total`, verbatim
 *   - taxCents            - 908   held for the state, not revenue
 *   = GA `value`          10500   sent as 105.00 (goods 95.00 + shipping 10.00)
 *     GA `shipping`        1000   sent as 10.00 — INSIDE the 105.00 above, a
 *                                 decomposition of it and not an addition
 *     GA `tax`               —    not sent; `value` is already ex-tax
 *
 *   feeCents                475   Aglyn's cut — NOT subtracted; the merchant's
 *                                 cost of sale, and our revenue is reported in
 *                                 OUR property by the subscription/marketplace
 *                                 `purchase`, not by this one.
 *
 * Before AGL-1698 the stored parts summed to 10408, not 11408: the 1000 gap was
 * the shipping, and it is exactly what a parts-based `value` would have lost.
 * They reconcile now, which `commerce-orders.spec.ts` pins; the guard below
 * survives as a guard, since the derivation must not drift back to the parts.
 *
 * Returns `null` when there is nothing truthful to send — no transaction id,
 * or a non-positive value. A dropped event is a gap in the merchant's report;
 * a fabricated one is a wrong number in it, and the second is worse.
 */
export function buildStorefrontPurchaseParams(
  source: StorefrontPurchaseSource,
): AnalyticsEventParams['purchase'] | null {
  const transactionId = String(source?.transactionId ?? '').trim()
  if (!transactionId) return null

  const totalCents = Math.round(Number(source?.totalCents ?? 0))
  const taxCents = Math.max(0, Math.round(Number(source?.taxCents ?? 0)))
  const netCents = totalCents - taxCents
  if (!Number.isFinite(netCents) || netCents <= 0) return null
  // Clamped like `taxCents`, and for the same reason: a negative component
  // would be subtracted out of a `value` that does not move with it.
  const shippingCents = Math.max(0, Math.round(Number(source?.shippingCents ?? 0)))

  return {
    transaction_id: transactionId,
    // No currency is stored on an order and `buildBeginCheckoutParams` takes
    // the same default, so the storefront's two ecommerce events agree.
    currency: 'USD',
    value: toAmount(netCents),
    // ALWAYS sent, including as 0. `value` is ex-tax and shipping is inside
    // it, so `shipping` describes the number beside it rather than adding to
    // it — and 0 is a true statement about an order that carried no shipping
    // (a download, a merchant who configured no rates, POS, a draft), not the
    // old structural zero. Omitting it on those would leave the merchant's
    // shipping column sparse for a reason GA cannot distinguish from "not
    // tracked".
    shipping: toAmount(shippingCents),
    items: (source?.lineItems ?? []).map((line) => ({
      // The PRODUCT id, matching `view_item` / `add_to_cart` /
      // `begin_checkout`, so GA joins all four into one per-product funnel.
      // A variant id here would break that join at the last step.
      item_id: String(line?.productId ?? ''),
      item_name: String(line?.name ?? ''),
      price: toAmount(Number(line?.unitAmountCents ?? 0)),
      quantity: Number(line?.quantity ?? 1),
    })),
    // No `billing_interval`: a storefront order is not a subscription.
  }
}

/**
 * Reduce a stored order to the wire shape above. Server-side only — it reads
 * fields the projection exists to withhold.
 */
export function toStorefrontPurchaseSource(
  transactionId: string,
  order: Pick<HostOrder, 'totals' | 'lineItems'>,
): StorefrontPurchaseSource {
  return {
    transactionId,
    totalCents: Number(order?.totals?.totalCents ?? 0),
    taxCents: Number(order?.totals?.taxCents ?? 0),
    shippingCents: Number(order?.totals?.shippingCents ?? 0),
    lineItems: (order?.lineItems ?? []).map((line) => ({
      productId: String(line?.productId ?? ''),
      name: String(line?.name ?? ''),
      quantity: Number(line?.quantity ?? 1),
      unitAmountCents: Number(line?.unitAmountCents ?? 0),
    })),
  }
}
