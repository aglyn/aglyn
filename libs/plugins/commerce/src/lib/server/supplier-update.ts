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
import { escapeHtml } from '../utils/escape-html'
import { createHmac, timingSafeEqual } from 'crypto'
import { tokenSigningSecret } from './download'
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

/**
 * WHICH supplier is posting (AGL-2455), and the observation that makes the
 * issue's "structural blocker" not structural after all.
 *
 * The order document holds ONE `supplierToken` field, so the issue's reading
 * was that scoping lines per supplier would strand every other supplier's lines
 * permanently: only the last token written could authenticate, and the others
 * would have no valid credential at all. That reading is right about the stored
 * field and wrong about the token.
 *
 * The token is not a random secret that has to be stored to be known. It is
 * `HMAC(hostId:orderId:supplierId)` under `TOKEN_SIGNING_SECRET`
 * (`billing-webhook.ts`), a pure function of three identifiers the order
 * already carries — `supplierId` is stamped onto every line at purchase time.
 * So the expected token for EVERY supplier on the order can be re-derived here
 * and compared, which both identifies the poster and lets every supplier
 * authenticate. No schema change, no migration, no map.
 *
 * Every candidate is compared even after a match, so the work done is a
 * function of the order's supplier count and not of which supplier posted.
 *
 * Returns `null` when nothing matches; the stored-scalar fallback is the
 * caller's, because only it knows whether that fallback is ambiguous.
 */
function resolvePostingSupplier(
  hostId: string,
  orderId: string,
  order: CommerceModel.HostOrder,
  presented: string,
): string | null {
  let secret: string
  try {
    secret = tokenSigningSecret()
  } catch {
    // Unset secret: no token could have been MINTED either, so there is nothing
    // to derive. Fall through to the stored scalar rather than throwing a 500
    // at a supplier who cannot do anything about it.
    return null
  }
  let matched: string | null = null
  for (const supplierId of CommerceModel.orderSupplierIds(order)) {
    const expected = createHmac('sha256', secret)
      .update(`${hostId}:${orderId}:${supplierId}`)
      .digest('hex')
      .slice(0, 32)
    if (tokenMatches(expected, presented)) matched = supplierId
  }
  return matched
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
  // Firestore reserves `__…__` ids and `.doc()` throws SYNCHRONOUSLY on one,
  // which fell into the catch below and answered 500 to what is a 400
  // (AGL-2455). `fulfill-order.ts` has had this guard since it shipped; this is
  // the sibling route that did not.
  if (/^__.*__$/.test(hostId) || /^__.*__$/.test(orderId)) {
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
        const order = CommerceModel.liftLegacyOrder(orderSnapshot.data() as any)
        // ONE SUPPLIER SHIPS ONE SUPPLIER'S LINES (AGL-2455).
        //
        // `lineItemIds` used to be every index on the order and the status was
        // written as the literal `'fulfilled'`, so the first supplier to post
        // marked the whole order shipped — lines they had never seen included —
        // and the second supplier's POST met a 409. The buyer was told
        // everything shipped with one carrier and one tracking number.
        const suppliers = CommerceModel.orderSupplierIds(order)
        const postingSupplier = resolvePostingSupplier(
          hostId,
          orderId,
          order,
          token,
        )
        let myLines: number[]
        if (postingSupplier) {
          myLines = CommerceModel.supplierLineItemIds(order, postingSupplier)
        } else if (tokenMatches(orderSnapshot.get('supplierToken'), token)) {
          // The STORED scalar matched but no supplier on the order derives to
          // it — an order whose lines carry no `supplierId`, which is every
          // order routed before that field was stamped.
          //
          // With at most one supplier there is only one door, so claiming every
          // line is the same answer this route has always given and is right.
          // With TWO OR MORE, the scalar cannot say whose token it is, and
          // guessing would either close lines a supplier never shipped (the
          // defect) or strand them (the naive fix). REFUSED LOUDLY instead:
          // the merchant fulfils from the console, where they can see the
          // lines, and the message says so rather than leaving them to work it
          // out from an order that silently went quiet.
          if (suppliers.length > 1) {
            return {
              status: 409,
              body: {
                error:
                  'This order has more than one supplier and the link cannot ' +
                  'say which of them you are. Nothing was changed. Please ask ' +
                  'the merchant to record this shipment from their console.',
              } as any,
            }
          }
          myLines = (order.lineItems ?? []).map((_line, index) => index)
        } else {
          return { status: 403, body: { error: 'Invalid token' } as any }
        }
        if (myLines.length === 0) {
          return {
            status: 409,
            body: { error: 'No lines on this order are yours' } as any,
          }
        }
        const coveredBefore = CommerceModel.coveredLineItemIds(order)
        if (myLines.every((index) => coveredBefore.has(index))) {
          // Every line of theirs is already shipped: a redelivered POST, or the
          // supplier pressing the emailed button twice. Refused rather than
          // appending a second copy of the same fulfillment — the same rule
          // `fulfill-order.ts` applies to a retried click.
          return {
            status: 409,
            body: {
              error:
                suppliers.length > 1
                  ? 'Your lines on this order are already marked shipped'
                  : `Order is already ${order.status}`,
            } as any,
          }
        }
        const coveredAfter = new Set([...coveredBefore, ...myLines])
        // COMPUTED, not written as a literal. `partially_fulfilled` has been in
        // `ORDER_TRANSITIONS` since orders shipped and nothing ever wrote it.
        const nextStatus = CommerceModel.statusAfterFulfilling(
          order,
          coveredAfter,
        )
        // Re-asked inside the transaction that writes, as AGL-2268 established:
        // a supplier POST racing a refund must not write over `refunded`. Only
        // when the status actually MOVES — a second supplier posting onto an
        // already `partially_fulfilled` order changes nothing about the status
        // and must not be refused by a table that has no self-edge.
        if (
          nextStatus !== order.status &&
          !CommerceModel.canTransitionOrder(order.status, nextStatus)
        ) {
          return {
            status: 409,
            body: { error: `Order is already ${order.status}` } as any,
          }
        }
        const fulfillment: CommerceModel.OrderFulfillment = {
          id: `supplier-${Date.now().toString(36)}`,
          lineItemIds: myLines,
          ...(carrier ? { carrier } : {}),
          ...(trackingNumber ? { trackingNumber } : {}),
          atMs: Date.now(),
        }
        const remaining = (order.lineItems ?? []).filter(
          (_line, index) => !coveredAfter.has(index),
        ).length
        transaction.set(
          orderRef,
          {
            status: nextStatus,
            fulfillments: [...(order.fulfillments ?? []), fulfillment],
            timeline: CommerceModel.appendOrderEvent(
              order,
              nextStatus,
              `Supplier shipped ${myLines.length} of ${
                (order.lineItems ?? []).length
              } line${(order.lineItems ?? []).length === 1 ? '' : 's'}` +
                (trackingNumber
                  ? ` — ${carrier || 'tracking'} ${trackingNumber}`
                  : '') +
                (remaining > 0
                  ? `. ${remaining} line${remaining === 1 ? '' : 's'} still to ship.`
                  : ''),
            ),
          },
          { merge: true },
        )
        return {
          status: 200,
          body: { ok: true, lineItemIds: myLines, orderStatus: nextStatus } as any,
          order,
          nextStatus,
          remaining,
        }
      })
    if (outcome.status !== 200) {
      return res.status(outcome.status).json(outcome.body)
    }
    // The merchant is told what is STILL OUTSTANDING (AGL-2455). "Supplier
    // shipped #1042" on an order where one of three suppliers has posted reads
    // as done, which is the same misreport the status literal made — the
    // merchant would stop watching an order that is two thirds unshipped.
    const outstanding = Number((outcome as any).remaining ?? 0)
    void notifyHostManagers(hostId, {
      type: 'content.order',
      title: `Supplier shipped ${CommerceModel.formatOrderNumber(
        outcome.order as CommerceModel.HostOrder,
        orderId,
      )}${outstanding > 0 ? ` — ${outstanding} line${outstanding === 1 ? '' : 's'} still to ship` : ''}`,
      ...(trackingNumber ? { body: `${carrier} ${trackingNumber}` } : {}),
      link: `/${hostId}/products`,
    })
    return res.status(200).json(outcome.body)
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Update failed' })
  }
}
