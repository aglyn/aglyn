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
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('orders')
      .doc(sessionId)
      .get()

    res.setHeader('Cache-Control', 'no-store')

    if (!snapshot.exists) {
      // Retryable: almost always the webhook race above, not a bad id.
      return res.status(404).json({ error: 'Not found', retryable: true })
    }
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
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Lookup failed' })
  }
}
