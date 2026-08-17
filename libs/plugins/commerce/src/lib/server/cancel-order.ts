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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveTrackedRestockLines } from './restock-flag'

/**
 * Cancelling an order RELEASES its stock (AGL-1808) — the opposite of what the
 * reversal doors do, and for a structural reason rather than a preference.
 *
 * AGL-1797 refused to increment on a refund or a chargeback because the goods
 * may well be gone: a refund with no return, or a shopper who kept the item and
 * took the money, leaves stock that incrementing would INVENT. It flags and
 * lets the merchant answer. Cancellation carries no such question, and the
 * guarantee is `ORDER_TRANSITIONS`:
 *
 *     pending: ['paid', 'cancelled'],
 *     paid:    ['partially_fulfilled', 'fulfilled', 'cancelled', 'refunded'],
 *     partially_fulfilled | fulfilled | delivered: no 'cancelled'
 *
 * so a cancelled order was never fulfilled and nothing ever shipped. The units
 * are still on the shelf; the only wrong number is ours.
 *
 * THE GUARANTEE HAD TO BE ENFORCED BEFORE IT COULD BE RELIED ON, and that is
 * why this is a handler rather than a few lines in the console. The transition
 * table said the right thing but nothing consulted it on the way IN: the order
 * dialog cancelled with a client `updateDoc`, and `canTransitionOrder` only
 * decided whether to render the button. The Firestore rules impose no status
 * machine — an order update is allowed to any admin or editor — so a dialog
 * held open while the order shipped in another tab (or any other client) could
 * write `cancelled` straight onto a `fulfilled` order, and an automatic
 * increment behind that would restock goods already in the post. Re-asking the
 * transition INSIDE the transaction that writes the status is what turns the
 * comment into a guarantee, and it is what makes the release safe.
 *
 * `pending` RELEASES NOTHING, which is the other half the issue's premise
 * missed. Stock is decremented when the money lands, not when the order is
 * written: `draft-order.ts` and the POS card path both open a `pending` order
 * and decrement only in the webhook that pays it. Incrementing on a cancelled
 * `pending` order would invent inventory exactly the way AGL-1797 refused to —
 * so only a `paid` order, the one status reachable here whose sale provably
 * decremented, releases anything.
 *
 * ONE LEDGER, NOT A SECOND STOCK WRITER. The increment goes through
 * `adjustVariantInventory` and logs an `InventoryAdjustment` per line, the same
 * pair the sale paths and the products hub's "Adjust stock" write, with the new
 * `cancellation` reason and the `orderId`. An increment with no ledger row
 * would leave the hub's stock history unable to explain a count that moved on
 * its own — the mirror of AGL-1797's argument against writing a row for stock
 * that had NOT moved.
 *
 * ONLY WHAT THE SALE DECREMENTED comes back: `resolveTrackedRestockLines`, the
 * helper AGL-1797 already built, applies the sale path's own
 * `variant.inventory != null` test to the products as they stand now. A store
 * that tracks no stock gets a plain cancellation and no adjustment rows.
 *
 * IT FAILS THE CANCEL RATHER THAN LOSING THE RELEASE. `flagOrderRestock`
 * swallows its errors because the money had already moved and the flag was a
 * postscript; here the status flip and the stock write are one act, so they
 * share a transaction and a failure leaves the order uncancelled for the
 * merchant to retry. A cancelled order whose stock never came back is the
 * original bug.
 *
 * ONCE. The transaction's own read is the guard: a second cancel — a retried
 * request, two admins clicking together — finds `cancelled`, which
 * `canTransitionOrder` cannot leave, and returns without touching stock. Two
 * increments of the same units is the failure mode this shape exists to
 * prevent, and it is measured rather than asserted (`cancel-order.spec.ts`).
 *
 * NOT YET REACHED FROM THE CONSOLE (AGL-1818). `order-detail-dialog`'s
 * `handleCancel` still writes `status: 'cancelled'` with a client `updateDoc`,
 * and that file belonged to a concurrent agent (AGL-1806) when this was
 * written — so the swap is filed rather than smuggled into their working tree.
 * Until it lands this route answers nobody and the stock bug is still live.
 */
export const cancelOrderHandler: PluginApiHandler = async (req, res) => {
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

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    // The role the CLIENT write already had, not a stricter one. Order updates
    // fall through the rules' host catch-all, which admits `admin` and
    // `editor` — narrowing to admin here would take the cancel button away
    // from editors who have always had it, and widening it past what the rules
    // allow would make this endpoint the way around them.
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
      // A redelivered click, or the second of two admins. Answered as success
      // because it IS the state the caller asked for — reporting 409 here
      // teaches an admin that the cancel failed and invites a third attempt —
      // but nothing is written, so the units are released exactly once.
      if (order.status === 'cancelled') {
        return {
          status: 200,
          body: { ok: true, alreadyCancelled: true, released: 0, units: 0 },
        }
      }
      if (!CommerceModel.canTransitionOrder(order.status, 'cancelled')) {
        return {
          status: 409,
          body: { error: `Orders in "${order.status}" cannot cancel` },
        }
      }

      // `paid` is the only status reachable here whose sale decremented; see
      // the header. Reads happen before any write, as a transaction requires.
      const { lines, products } =
        order.status === 'paid'
          ? await resolveTrackedRestockLines(hostRef, order, (ref) =>
              transaction.get(ref),
            )
          : {
              lines: [],
              products: new Map<string, CommerceModel.HostProduct>(),
            }

      const atMs = Date.now()
      // Grouped by product, because two lines of one product (two variants, or
      // the same variant twice) are two deltas against ONE document: writing
      // them separately would compute both from the same read and land only
      // the last, silently dropping units.
      const byProduct = new Map<string, CommerceModel.OrderRestockLine[]>()
      for (const line of lines) {
        byProduct.set(line.productId, [
          ...(byProduct.get(line.productId) ?? []),
          line,
        ])
      }
      for (const [productId, productLines] of byProduct) {
        const product = products.get(productId)
        if (!product) continue
        let variants = product.variants
        for (const line of productLines) {
          variants = CommerceModel.adjustVariantInventory(
            { variants },
            line.variantId,
            line.quantity,
            // The bucket the sale came out of, for a location-tracked store
            // (AGL-286). Absent on every path that decremented the flat count,
            // where `adjustVariantInventory` puts it back the same way.
            order.locationId || undefined,
          )
        }
        // `update()`, not `set(…, { merge: true })` as the sale paths use: the
        // transaction has just read this product, so it exists, and a product
        // deleted under us must not be conjured back as a stub holding nothing
        // but a variants array.
        transaction.update(hostRef.collection('products').doc(productId), {
          variants,
          inventory: CommerceModel.productInventory({ variants }),
          updatedAtMs: atMs,
        })
        for (const line of productLines) {
          transaction.create(hostRef.collection('inventoryAdjustments').doc(), {
            productId,
            variantId: line.variantId,
            delta: line.quantity,
            reason: 'cancellation',
            orderId,
            ...(order.locationId ? { locationId: order.locationId } : {}),
            atMs,
          } satisfies CommerceModel.InventoryAdjustment)
        }
      }

      const units = lines.reduce((sum, line) => sum + line.quantity, 0)
      const patch: Record<string, unknown> = {
        status: 'cancelled',
        timeline: CommerceModel.appendOrderEvent(
          order,
          'cancelled',
          units > 0
            ? `${units} ${units === 1 ? 'unit' : 'units'} returned to stock`
            : undefined,
          atMs,
        ),
      }
      // An open restock question about THIS order's stock, raised by a partial
      // refund before the cancellation (AGL-1797). The units it asked about are
      // the ones just put back, so leaving it open would invite the merchant to
      // restock them a second time from the order dialog — the double-count
      // that flag exists to avoid. Answered with what actually happened.
      if (units > 0 && order.restockCheck && !order.restockCheck.resolution) {
        patch.restockCheck = {
          ...order.restockCheck,
          resolution: 'restocked',
          resolvedAtMs: atMs,
          resolvedBy: decoded.uid,
        } satisfies CommerceModel.OrderRestockCheck
      }
      transaction.update(orderRef, patch)
      return {
        status: 200,
        body: { ok: true, released: lines.length, units },
      }
    })
    return res.status(outcome.status).json(outcome.body)
  } catch (error) {
    // Nothing landed — the transaction is all-or-nothing — so the order is
    // still open and the merchant can try again. Deliberately NOT the swallow
    // `flagOrderRestock` uses: there the money had already moved and only a
    // postscript was at risk; here a swallowed failure is a cancelled order
    // whose stock never came back, which is the bug this closes.
    console.error('cancelOrder failed', error)
    return res.status(500).json({ error: 'Cancel failed' })
  }
}
