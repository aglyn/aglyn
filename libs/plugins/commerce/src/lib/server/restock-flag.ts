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

/**
 * Stock left off the shelf by a reversed order (AGL-1797).
 *
 * The checkout webhook decrements variant inventory on a sale and NOTHING put
 * it back — not `refund.ts`, not the lost-dispute handler (AGL-1787) — so a
 * fully reversed order left the merchant's count permanently one lower than
 * their shelf, compounding with every return.
 *
 * THIS FLAGS. IT DOES NOT RELEASE, and that is the decision.
 *
 * "Increment on reversal" is the obvious fix and it is wrong in two of the
 * three cases it would fire on:
 *
 *  - a **returned** item does come back, but only once it is RECEIVED, and no
 *    fulfilment event records receipt — `OrderFulfillment` has no returned
 *    state, so the moment an automatic increment would need does not exist;
 *  - a **refund with no return** (goodwill, damaged, lost in post) leaves the
 *    goods gone. Incrementing there invents inventory the merchant does not
 *    have, and that is strictly worse than the bug it replaces: the bug
 *    under-counts and refuses a sale that could have been made, while the
 *    "fix" over-counts and TAKES a sale that cannot be filled;
 *  - a **chargeback** is the clearest do-not-restock case there is. The shopper
 *    kept the item and took the money, and `product_not_received` — the most
 *    common reason code — asserts the goods shipped.
 *
 * The quantities are not knowable either, on a partial. A refund is requested
 * as an AMOUNT (`refund.ts` takes `amountCents` and nothing else) and no
 * reversal anywhere records which lines it covered, so "$17 of a $62 order"
 * selects no line. That is a real blocker for any automatic behaviour and it
 * is recorded rather than papered over: `quantity` is the units the line SOLD,
 * an upper bound, and `fullyReversed` says whether it is a tight one.
 *
 * So the merchant is asked. They are the only party who knows whether the
 * goods came back, and by the time they read this they know it.
 *
 * WHAT IS DELIBERATELY NOT BUILT HERE. No stock writer and no
 * `InventoryAdjustment` row: the products hub's "Adjust stock" already writes
 * the variant counts and logs the adjustment with a reason, so a second writer
 * for one number would be a re-implementation, not an extension. And an
 * adjustment row for stock that has NOT moved would corrupt the very ledger
 * that hub renders as history. This writes the question; the existing action
 * answers it.
 *
 * WHERE THE MERCHANT SEES IT. The order timeline, which the console order
 * dialog already renders, so this needs no UI change to be visible at all. The
 * `restockCheck` record beside it is the structured half a badge and a
 * one-click action read; that console work is filed, not smuggled in.
 *
 * NO NOTIFICATION. A refund is initiated BY an admin in the console, so telling
 * them about their own click is noise, and the chargeback door already sends a
 * manager notification for the dispute itself — a second one for the same event
 * would train them to ignore both.
 *
 * ONLY WHAT THE SALE DECREMENTED IS FLAGGED. Tracking lives on the product
 * variant, not the order line, so this reads the products and applies the sale
 * path's own test (`variant.inventory != null`). A store that tracks no stock
 * therefore gets NO flag rather than a prompt it can never act on, which is the
 * difference between a signal and noise. It costs a handful of reads on an
 * event as rare as a reversal.
 *
 * The `inventoryAdjustments` ledger was the tempting shortcut here and it is
 * not usable: the buy-now/subscription sale path decrements stock without
 * writing a row (`billing-webhook.ts`, the `productId` branch), so the ledger
 * has holes the order's own line items do not.
 *
 * FAILURES ARE SWALLOWED, like `recordContactRefund`'s. The money has already
 * moved and the order already records it; a flag that cannot be written must
 * not fail a refund that has left the merchant's account.
 */
export async function flagOrderRestock(options: {
  hostId: string
  orderId: string
  /** Which door the money left by. Only the wording differs. */
  kind: 'refund' | 'chargeback'
  /**
   * True only for the write that moved the order INTO `refunded` — the same
   * signal `recordContactRefund` takes, decided by the caller from the status
   * transition it made rather than from the total it read, because
   * `fullyRefunded` is not a once-only signal (AGL-1754).
   */
  closedTheOrder: boolean
}): Promise<void> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(options.hostId)
    const orderRef = hostRef.collection('orders').doc(options.orderId)
    const snapshot = await orderRef.get()
    if (!snapshot.exists) return
    const order = CommerceModel.liftLegacyOrder(
      (snapshot.data() ?? {}) as never,
    )
    // Once per open question. A second partial on an order already flagged and
    // still unanswered adds nothing the merchant does not have; one they
    // already ANSWERED is a new question, because stock moved since.
    if (order.restockCheck && !order.restockCheck.resolution) return

    const lines = await trackedRestockLines(hostRef, order)
    // Nothing was ever decremented for this order, so nothing is missing from
    // the shelf. Writing a prompt here would be the noise that teaches a
    // merchant to ignore the ones that matter.
    if (lines.length === 0) return

    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    const flaggedAtMs = Date.now()
    const record: CommerceModel.OrderRestockCheck = {
      kind: options.kind,
      lines,
      units,
      fullyReversed: options.closedTheOrder,
      flaggedAtMs,
    }
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(orderRef)
      if (!fresh.exists) return
      const current = CommerceModel.liftLegacyOrder(
        (fresh.data() ?? {}) as never,
      )
      // Re-asked inside the transaction that writes it, so two reversals
      // settling at once cannot both flag — the same mechanism AGL-1754 used to
      // make its status flip observable exactly once, and the reason this is
      // not a bare `set(…, { merge: true })`.
      if (current.restockCheck && !current.restockCheck.resolution) return
      // `update()`, and the whole `restockCheck` map at that. A merge recurses,
      // so a re-flag after a merchant answered would inherit the previous
      // `resolution`/`resolvedAtMs` and read as already handled while asking a
      // brand-new question. `update()` replaces a nested map wholesale, which
      // is the semantics this wants, and the transaction has just proven the
      // document exists so it cannot `NOT_FOUND`.
      transaction.update(orderRef, {
        restockCheck: record,
        timeline: CommerceModel.appendOrderEvent(
          current,
          'restock-check',
          `${units} ${units === 1 ? 'unit' : 'units'} may need restocking` +
            (options.kind === 'chargeback'
              ? ' — the shopper kept the goods unless they came back'
              : '') +
            (options.closedTheOrder ? '' : ' (partial reversal, at most)'),
          flaggedAtMs,
        ),
      })
    })
  } catch (error) {
    console.error('flagOrderRestock failed', error)
  }
}

/**
 * The order's lines whose stock the sale actually took off the shelf.
 *
 * The test is the sale path's own — `variant.inventory != null` on the variant
 * that sold — read from the product as it stands NOW, because that is the
 * count a restock would be applied to. A product deleted since the sale, or a
 * variant removed from it, therefore drops out: there is no number left to put
 * anything back into.
 *
 * Products are read once each, so a three-line order of the same product costs
 * one read rather than three.
 */
async function trackedRestockLines(
  hostRef: FirebaseFirestore.DocumentReference,
  order: CommerceModel.HostOrder,
): Promise<CommerceModel.OrderRestockLine[]> {
  const products = new Map<string, CommerceModel.HostProduct | null>()
  const lines: CommerceModel.OrderRestockLine[] = []
  for (const line of order.lineItems ?? []) {
    const productId = String(line?.productId ?? '')
    const quantity = Math.round(Number(line?.quantity ?? 0))
    if (!productId || !(quantity > 0)) continue
    // Firestore reserves `__…__` document ids and `.doc()` throws on one
    // SYNCHRONOUSLY, which no `.catch()` on the returned promise would see. A
    // single corrupt line item must not cost the whole flag.
    if (/^__.*__$/.test(productId)) continue
    if (!products.has(productId)) {
      const snapshot = await hostRef
        .collection('products')
        .doc(productId)
        .get()
        .catch(() => null)
      products.set(
        productId,
        snapshot?.exists
          ? CommerceModel.liftLegacyProduct((snapshot.data() ?? {}) as never)
          : null,
      )
    }
    const product = products.get(productId)
    if (!product) continue
    const variantId = line.variantId ?? product.variants?.[0]?.id
    const tracked = (product.variants ?? []).some(
      (variant) => variant.id === variantId && variant.inventory != null,
    )
    if (!variantId || !tracked) continue
    lines.push({
      productId,
      variantId,
      quantity,
      ...(line.name ? { name: line.name } : {}),
      ...(line.variantLabel ? { variantLabel: line.variantLabel } : {}),
    })
  }
  return lines
}
