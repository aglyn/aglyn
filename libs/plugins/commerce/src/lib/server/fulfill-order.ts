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

import * as CommerceModel from '../model'
import { createResourceUid, type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Fulfil and mark-delivered, with the transition re-asked under the write
 * (AGL-1819) — the last two order-status writes the console made with a client
 * `updateDoc`, moved behind the same shape as `cancel-order.ts`.
 *
 * THE STALE-DIALOG HOLE IS THE SAME ONE AGL-1818 CLOSED FOR CANCEL.
 * `canTransitionOrder` was consulted only to RENDER the buttons, so a dialog
 * opened on a `paid` order that was refunded (or cancelled) in another tab
 * could still write `fulfilled` straight onto it — `ORDER_TRANSITIONS` stayed
 * advisory because nothing consulted it on the way IN. Re-reading the order
 * inside the transaction that writes the status is what turns the table into
 * a guarantee; the race comes back as a 409 naming the state that refused.
 *
 * ONE ROUTE FOR THE TWO FULFILMENT-SIDE TRANSITIONS, and ONLY those. They are
 * the same act — a forward status flip plus a timeline entry, no stock moved,
 * no money moved — so they share a handler parameterized on `to`. It refuses
 * every other target with a 400 on purpose: `cancelled` releases stock under
 * its own transaction (`cancel-order.ts`) and `refunded` moves money
 * (`refund.ts`), so admitting them here would hand callers a door around
 * exactly the specifics those routes exist to enforce.
 *
 * NO STOCK MOVES HERE. The sale decremented inventory when the money landed
 * (see `cancel-order.ts`'s header); shipping the goods changes what is on the
 * shelf not at all. An open `restockCheck` — a partial refund's question,
 * flagged before the merchant ships the rest — survives untouched: the write
 * is an `update()` naming only status, fulfillments and timeline, and the
 * question is still the merchant's to answer.
 *
 * NO NOTIFICATION EITHER, matching the client write this replaces: the
 * merchant fulfilled the order themselves, and `notifyHostManagers` would
 * tell them what they just did. (`supplier-update.ts` notifies because there
 * the SUPPLIER acted and the merchant is the one who needs to hear it.)
 *
 * ONCE. A retried request — a lost response, a second click — finds the order
 * already in the target status and returns success WITHOUT writing: appending
 * a second copy of the same fulfillment is the double this guard exists to
 * stop. It reports `already: true` so the console can say so. A fulfil retried
 * after the order moved on to `delivered` in another tab is a 409 instead,
 * which is the truth: that state cannot be fulfilled (again).
 *
 * THE SERVER'S ORDER, NOT THE DIALOG'S: `lineItemIds` and the timeline append
 * are computed from the transaction's own read, so a note landed from another
 * tab survives — the client write it replaces appended to the dialog's stale
 * copy and dropped it.
 *
 * Role gate: `admin` and `editor`, the role the client write already had
 * under the rules' host catch-all — same reasoning as `cancel-order.ts`.
 */
export const fulfillOrderHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const orderId = String(body.orderId ?? '')
  if (!hostId || !orderId) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }
  // Firestore reserves `__…__` ids and `.doc()` throws SYNCHRONOUSLY on one,
  // which would surface as a 500 on a caller's typo rather than the 400 it is.
  if (/^__.*__$/.test(hostId) || /^__.*__$/.test(orderId)) {
    return res.status(400).json({ error: 'Missing hostId or orderId' })
  }
  const to = String(body.to ?? '')
  if (to !== 'fulfilled' && to !== 'delivered') {
    // Deliberately NOT a generic transition endpoint — see the header.
    return res.status(400).json({ error: 'to must be fulfilled or delivered' })
  }
  const carrier = String(body.carrier ?? '').slice(0, 40)
  const trackingNumber = String(body.trackingNumber ?? '').slice(0, 60)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const orderRef = hostRef.collection('orders').doc(orderId)

    const outcome = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef)
      if (!snapshot.exists) {
        return { status: 404, body: { error: 'Unknown order' } }
      }
      const order = CommerceModel.liftLegacyOrder(
        (snapshot.data() ?? {}) as never,
      )
      // A redelivered click, or the second of two admins. Success because it
      // IS the state the caller asked for — but nothing is written, so a
      // retry cannot append a second copy of the same fulfillment.
      if (order.status === to) {
        return { status: 200, body: { ok: true, already: true } }
      }
      if (!CommerceModel.canTransitionOrder(order.status, to)) {
        return {
          status: 409,
          body: {
            error:
              to === 'delivered'
                ? `Orders in "${order.status}" cannot be marked delivered`
                : `Orders in "${order.status}" cannot be fulfilled`,
          },
        }
      }

      const atMs = Date.now()
      const patch: Record<string, unknown> =
        to === 'fulfilled'
          ? {
              status: 'fulfilled',
              fulfillments: [
                ...(order.fulfillments ?? []),
                {
                  id: createResourceUid(),
                  lineItemIds: (order.lineItems ?? []).map(
                    (_line, index) => index,
                  ),
                  ...(carrier ? { carrier } : {}),
                  ...(trackingNumber ? { trackingNumber } : {}),
                  atMs,
                } satisfies CommerceModel.OrderFulfillment,
              ],
              timeline: CommerceModel.appendOrderEvent(
                order,
                'fulfilled',
                trackingNumber
                  ? `${carrier || 'Shipped'} ${trackingNumber}`
                  : 'Fulfilled',
                atMs,
              ),
            }
          : {
              status: 'delivered',
              timeline: CommerceModel.appendOrderEvent(
                order,
                'delivered',
                undefined,
                atMs,
              ),
            }
      transaction.update(orderRef, patch)
      return { status: 200, body: { ok: true } }
    })
    return res.status(outcome.status).json(outcome.body)
  } catch (error) {
    // Nothing landed — the transaction is all-or-nothing — so the order is
    // still where it was and the merchant can try again.
    console.error('fulfillOrder failed', error)
    return res.status(500).json({
      error: to === 'delivered' ? 'Mark delivered failed' : 'Fulfill failed',
    })
  }
}
