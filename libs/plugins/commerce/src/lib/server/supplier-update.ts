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

import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import { timingSafeEqual } from 'crypto'
import { type PluginApiHandler } from '@aglyn/aglyn/server'

/**
 * Constant-time compare for the per-order supplier token (AGL-2268).
 *
 * `!==` on a secret leaks its prefix through response timing, and this token is
 * a bearer credential for a route with no account behind it — the only thing
 * standing between the open internet and marking a merchant's order shipped.
 * `download.ts` has compared its own token this way since it shipped; this is
 * the sibling that did not.
 *
 * Length is compared first and OUTSIDE the constant-time call, because
 * `timingSafeEqual` throws on a length mismatch. That leaks the token's LENGTH
 * and nothing else, which is the same concession `download.ts` makes.
 */
function tokenMatches(stored: unknown, presented: string): boolean {
  const expected = typeof stored === 'string' ? stored : ''
  if (!expected || !presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

/** HTML-escape, for the confirmation page below. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] as string,
  )
}

/**
 * Supplier tracking callback (AGL-289): the routed order carried a
 * per-order token; posting (or GET-ing, for email links) tracking with
 * it fulfills the order. Token-gated — suppliers have no Aglyn account.
 */
export const supplierUpdateHandler: PluginApiHandler = async (req, res) => {
  const source = req.method === 'POST' ? { ...req.query, ...(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) } : req.query
  const hostId = String(source.hostId ?? '')
  const orderId = String(source.orderId ?? '')
  const token = String(source.token ?? '')
  const trackingNumber = String(source.trackingNumber ?? '').slice(0, 60)
  const carrier = String(source.carrier ?? '').slice(0, 40)
  if (!hostId || !orderId || !token) {
    return res.status(400).json({ error: 'Missing hostId, orderId, or token' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const orderRef = firestore
      .collection('hosts')
      .doc(hostId)
      .collection('orders')
      .doc(orderId)
    // A GET NEVER MOVES THE ORDER (AGL-2268). The supplier email carries this
    // URL, and a GET that fulfils means every link scanner, spam filter,
    // preview generator and browser prefetch on the path between us and the
    // supplier's inbox marks the order shipped — before anything shipped, and
    // with no tracking number on it. The link still works and the email is
    // unchanged: a GET renders a one-button page that POSTs the same
    // parameters, so the supplier's experience is one extra click and the
    // machines that open mail for a living take no action at all.
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html')
      const field = (name: string, value: string) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`
      return res.status(200).send(
        '<h3>Confirm this shipment</h3>' +
          '<p>Press the button to record it against the order.</p>' +
          '<form method="POST">' +
          field('hostId', hostId) +
          field('orderId', orderId) +
          field('token', token) +
          field('carrier', carrier) +
          field('trackingNumber', trackingNumber) +
          '<button type="submit">Mark as shipped</button>' +
          '</form>',
      )
    }

    // THE READ, THE TRANSITION CHECK AND THE WRITE ARE ONE ACT (AGL-2268).
    // They used to be a plain `get()`, a check, and a `set(…, {merge:true})`,
    // which is the exact stale-read hole AGL-1808/1818/1819 closed on the
    // console's own fulfil, cancel and refund routes — reopened here, on the
    // one door with no account behind it. A supplier POST racing a refund read
    // `paid`, the refund landed, and the POST then wrote `fulfilled` over
    // `refunded`. `ORDER_TRANSITIONS` says `refunded: []`, and the cost is not
    // cosmetic: `gate.ts`, `download.ts`, `membership-account.ts` and
    // `reviews.ts` all withdraw a shopper's entitlement by matching that
    // literal, so the refunded buyer got their downloads back.
    const outcome = await firebaseAdmin
      .app()
      .firestore()
      .runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef)
        if (!orderSnapshot.exists) {
          return { status: 404, body: { error: 'Unknown order' } as any }
        }
        if (!tokenMatches(orderSnapshot.get('supplierToken'), token)) {
          return { status: 403, body: { error: 'Invalid token' } as any }
        }
        const order = CommerceModel.liftLegacyOrder(orderSnapshot.data() as any)
        if (!CommerceModel.canTransitionOrder(order.status, 'fulfilled')) {
          return {
            status: 409,
            body: { error: `Order is already ${order.status}` } as any,
          }
        }
        const fulfillment: CommerceModel.OrderFulfillment = {
          id: `supplier-${Date.now().toString(36)}`,
          lineItemIds: (order.lineItems ?? []).map((_line, index) => index),
          ...(carrier ? { carrier } : {}),
          ...(trackingNumber ? { trackingNumber } : {}),
          atMs: Date.now(),
        }
        transaction.set(
          orderRef,
          {
            status: 'fulfilled',
            fulfillments: [...(order.fulfillments ?? []), fulfillment],
            timeline: CommerceModel.appendOrderEvent(
              order,
              'fulfilled',
              `Supplier shipped${trackingNumber ? ` — ${carrier || 'tracking'} ${trackingNumber}` : ''}`,
            ),
          },
          { merge: true },
        )
        return { status: 200, body: { ok: true } as any, order }
      })
    if (outcome.status !== 200) {
      return res.status(outcome.status).json(outcome.body)
    }
    void notifyHostManagers(hostId, {
      type: 'content.order',
      title: `Supplier shipped ${CommerceModel.formatOrderNumber(
        outcome.order as CommerceModel.HostOrder,
        orderId,
      )}`,
      ...(trackingNumber ? { body: `${carrier} ${trackingNumber}` } : {}),
      link: `/${hostId}/products`,
    })
    return res.status(200).json(outcome.body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Update failed' })
  }
}
