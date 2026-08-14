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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { toStorefrontPurchaseSource } from '../model/purchase-analytics'

/** Stripe Checkout Session ids: `cs_` + live/test prefix + base58-ish body. */
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,255}$/

/**
 * Stripe's `billing_reason` for the invoice a subscription OPENS with, as
 * opposed to the `subscription_cycle` ones that follow it (AGL-1743 stores
 * both under the subscription).
 */
const OPENING_INVOICE_REASON = 'subscription_create'

/**
 * The figures a storefront `purchase` needs, for one completed order
 * (AGL-1641).
 *
 * ## Why the client cannot compute this itself
 *
 * The obvious cheap design is to stash the cart at `begin_checkout` and replay
 * it on return, with no endpoint at all. It produces the wrong number: the
 * shopper picks their SHIPPING and may enter a promotion code on Stripe's
 * page, after the cart snapshot was taken, so a replayed cart understates
 * every order that carries shipping. The authoritative totals only exist after
 * the webhook has written the order, which is why this reads the order.
 *
 * ## What authorises the read
 *
 * The Stripe Checkout Session id, which is also the order doc id. It is
 * high-entropy and unguessable, it is handed only to the buyer — Stripe puts
 * it in the `success_url` — and it is scoped here to the host that owns the
 * order, so one storefront's id cannot address another's. This is the same
 * bearer-by-opaque-id shape as the `download` and `subscription-portal`
 * routes.
 *
 * It is still a public read, so the response is a PROJECTION built by
 * `toStorefrontPurchaseSource`, never the order document: no email, no name,
 * no shipping or billing address, and not our `feeCents` either. A buyer
 * learns only what they themselves just bought.
 *
 * ## The webhook race
 *
 * The shopper can return from Stripe before the `checkout.session.completed`
 * delivery has been processed, in which case the order does not exist yet.
 * That is answered with 404 and a `retryable` flag rather than a synthesised
 * order — the client polls briefly. Reporting a purchase we cannot yet read
 * would mean inventing the value.
 *
 * Never cached: an order that 404s during the race must not have that 404
 * stored in front of it, which is the AGL negative-cache shape that has bitten
 * host lookups before.
 *
 * ## Subscriptions answer from the INVOICE, not from an order (AGL-1746)
 *
 * A subscription sale writes no order document — deliberately, on three
 * independent pieces of evidence gathered in AGL-1732 — so the lookup above
 * missed forever on every one of them. The merchant's own GA4 property
 * therefore showed traffic and `begin_checkout` for the subscription product
 * and then no `purchase` at all, which does not read as "we do not measure
 * this": it reads as a 100% checkout abandonment rate on the product, an
 * authoritative-looking number that is wrong.
 *
 * The data to answer with exists now. AGL-1732 records the sale on
 * `subscriptions/{stripeSubscriptionId}` carrying the originating
 * `checkoutSessionId`, and AGL-1743 records every paid invoice beneath it,
 * including the opening one — kept explicitly so the ledger has no hole where
 * cycle 1 belongs, even though that cycle is deliberately not re-counted into
 * lifetime value.
 *
 * The opening INVOICE is what answers, for two reasons:
 *
 * - Its id is a natural `transaction_id`. It is Stripe's own id for the money
 *   that moved, it is unique per cycle, and it is stable — the same sale
 *   resolves to the same invoice on every poll, so a shopper who refreshes the
 *   return page cannot produce a second `purchase` under a different id. GA4
 *   de-duplicates on `transaction_id`, and that only protects us if the id is
 *   deterministic.
 * - Its `lineItems` and `totals` were built by
 *   `computeSubscriptionInvoiceOrder`, which is the helper that knows an
 *   invoice is NOT a Checkout Session: AGL-1743 found invoices carry no
 *   `total_details` whatsoever, that tax is `tax` or `total_taxes` by API
 *   version, discount is `total_discount_amounts[]`, and the fee is a real
 *   `application_fee_amount`. Reading the stored figures means this route
 *   inherits all of that instead of re-deriving it against the wrong shape.
 *
 * `value` needs no special-casing here, and that is the point of answering in
 * the same wire shape: `toStorefrontPurchaseSource` and
 * `buildStorefrontPurchaseParams` already implement the AGL-1641 storefront
 * rule, which is the INVERSE of the marketplace one. On a tenant storefront
 * the MERCHANT is the seller, so Aglyn's fee is their cost of sale rather than
 * a deduction from it and is NOT subtracted; tax is money held for the state
 * and is excluded, with no GA4 `tax` param sent beside an ex-tax `value`.
 * Getting that backwards would show every merchant a figure a few percent of
 * their real revenue.
 *
 * ## Renewals do NOT send a `purchase` — and could not
 *
 * A recurring revenue event per cycle is arguable on the merits, and the
 * argument against it on the merits is real: `purchase` is what GA4's
 * acquisition and ROAS reporting is terminated by, so firing one every month
 * would credit a single acquisition to its campaign twelve times over and
 * inflate return on ad spend by the subscriber's whole lifetime.
 *
 * But it does not come down to that, because this seam cannot carry a renewal
 * at all. This purchase is CLIENT-side by design: the hit is sent by
 * `use-storefront-purchase-event.ts` through the merchant's own `gtag`, loaded
 * with `host.analytics.gaMeasurementId`. A renewal happens months later with
 * no browser anywhere in it. Sending one would require the Measurement
 * Protocol against the merchant's property, which needs a per-host API secret
 * that this product does not collect and has nowhere to store — the same
 * conclusion `use-storefront-purchase-event.ts` reached from the other
 * direction. `ga4-measurement-protocol.ts` is not that channel: it holds one
 * global `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` pair, which is AGLYN's property
 * and reports our revenue, not the merchant's.
 *
 * So the storefront reports the subscription's FIRST payment, once, and stops
 * — mirroring AGL-1743's own decision not to re-count the opening invoice
 * anywhere the checkout session had already been counted.
 *
 * ## Why both lookups run
 *
 * A Checkout Session id does not say whether it was a one-time or a
 * subscription mode session, so a miss on the order genuinely might be either
 * the webhook race or a subscription. The subscription lookups therefore run
 * on every order miss. Both are single-field equality queries with `limit(1)`,
 * which Firestore serves from the automatic single-field indexes it maintains
 * for every field — there is no composite index here to create, and none to
 * probe.
 */
export const orderAnalyticsHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const sessionId = String(req.query.sessionId ?? '')
  if (!hostId || !sessionId) {
    return res.status(400).json({ error: 'Missing hostId or sessionId' })
  }
  // Shape-checked before it reaches Firestore: a document id is a path
  // segment, and an unvalidated one is how a lookup becomes a traversal.
  if (!SESSION_ID.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }
  try {
    const hostRef = firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
    const snapshot = await hostRef.collection('orders').doc(sessionId).get()

    res.setHeader('Cache-Control', 'no-store')

    if (snapshot.exists) {
      const order = (snapshot.data() ?? {}) as any
      // Only a PAID order is a purchase. A session can be written in another
      // state by the draft/POS paths, and reporting one as revenue would put a
      // sale in the merchant's report that has not happened.
      if (order.status !== 'paid') {
        return res.status(409).json({ error: 'Not payable' })
      }
      return res
        .status(200)
        .json(toStorefrontPurchaseSource(snapshot.id, order))
    }

    // No order. That is either the webhook race above, or a SUBSCRIPTION sale,
    // which records no order at all (AGL-1746). The subscription carries the
    // session that created it.
    const subscriptions = await hostRef
      .collection('subscriptions')
      .where('checkoutSessionId', '==', sessionId)
      .limit(1)
      .get()
    const subscription = subscriptions.docs[0]
    if (!subscription) {
      // Retryable: the race, or an id that was never ours.
      return res.status(404).json({ error: 'Not found', retryable: true })
    }
    // The money, rather than the sale record: the opening invoice is what was
    // actually collected, and its id is the transaction id.
    const invoices = await subscription.ref
      .collection('invoices')
      .where('billingReason', '==', OPENING_INVOICE_REASON)
      .limit(1)
      .get()
    const invoice = invoices.docs[0]
    if (!invoice) {
      // `checkout.session.completed` has landed and `invoice.paid` has not —
      // still the race, one webhook further along.
      return res.status(404).json({ error: 'Not found', retryable: true })
    }
    // A TRIAL opens on a $0 invoice. Nothing was charged, so there is no
    // revenue to report; this is the subscription's form of "not payable", and
    // it is terminal rather than retryable because it will never become true
    // for THIS invoice.
    if (!(Number(invoice.get('paidCents') ?? 0) > 0)) {
      return res.status(409).json({ error: 'Not payable' })
    }
    return res
      .status(200)
      .json(
        toStorefrontPurchaseSource(invoice.id, (invoice.data() ?? {}) as any),
      )
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Lookup failed' })
  }
}
