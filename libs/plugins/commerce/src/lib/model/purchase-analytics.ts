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
 * `taxCents` is likewise `total_details.amount_tax`, Stripe's own.
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
 * Still NO GA4 `shipping` param, but the reason has moved on again. It used to
 * be that no Checkout Session we created declared `shipping_options`, so Stripe
 * never offered a shipping choice and `amount_shipping` was 0 on every live
 * session — sending it would have asserted free shipping on every order.
 * AGL-1707 wired the merchant's configured zones and rates into the cart
 * session, so `amount_shipping` is now real there. What remains is unbuilt
 * plumbing rather than a truthfulness objection: `shippingCents` is stored on
 * the order but is not carried into `StorefrontPurchaseSource` or the wire
 * shape. It is worth sending now; it is tracked separately.
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

  return {
    transaction_id: transactionId,
    // No currency is stored on an order and `buildBeginCheckoutParams` takes
    // the same default, so the storefront's two ecommerce events agree.
    currency: 'USD',
    value: toAmount(netCents),
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
    lineItems: (order?.lineItems ?? []).map((line) => ({
      productId: String(line?.productId ?? ''),
      name: String(line?.name ?? ''),
      quantity: Number(line?.quantity ?? 1),
      unitAmountCents: Number(line?.unitAmountCents ?? 0),
    })),
  }
}
