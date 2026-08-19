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
 * is recorded rather than papered over: `quantity` is at most the units the
 * line sold — capped to what the count actually gave up, see below — and
 * `fullyReversed` says whether that bound is a tight one.
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
 * The `inventoryAdjustments` ledger was the tempting shortcut for SELECTING the
 * lines and it is not usable for that: the buy-now/subscription sale path
 * decrements stock without writing a row (`billing-webhook.ts`, the
 * `productId` branch), so the ledger has holes the order's own line items do
 * not. The lines are still chosen from the order.
 *
 * IT IS READ TO BOUND THE NUMBER, THOUGH (AGL-2325), and the holes are exactly
 * why that is safe in this direction. `line.quantity` is the units the line
 * SOLD, and on a backorder product the inventory floor absorbed part or all of
 * the decrement, so the prompt named units the count never gave up. The sale
 * rows' `appliedDelta` says how many it did, and only pairs the ledger
 * DESCRIBES are capped — a line it is silent about keeps the upper bound, so a
 * hole costs an over-stated question rather than stock stranded off the shelf.
 * `saleReleaseCaps` and `capRestockLines` are shared with the cancellation
 * writer, so what this ASKS and what that RETURNS cannot drift apart.
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
    // AN ORDER THAT WAS CANCELLED HAS NO RESTOCK QUESTION LEFT (AGL-2149).
    // Until `cancelled: ['refunded']` this was unreachable — a cancelled order
    // could not refund at all — and reaching it now would be the double-count
    // this flag exists to avoid: `cancel-order.ts` already put the units back
    // and wrote the `reason: 'cancellation'` ledger rows, so a fresh "N units
    // may need restocking" prompt on top of that invites the merchant to
    // restock the same units a SECOND time. (`cancel-order.ts` handles the
    // opposite order of events — refund first, then cancel — by resolving the
    // open check with what it actually did.)
    //
    // Read from the TIMELINE, not from `order.status`: a full refund flips the
    // order to `refunded` in the transaction above this call, so by the time
    // the flag runs the cancellation is no longer the current status — but the
    // event it stamped is still there, and it is the durable record of the
    // release. A partial refund would leave `cancelled` standing and a status
    // test would catch that one case and silently miss the full one.
    //
    // The cases where the cancel released nothing are covered by the same skip:
    // a `pending` cancel and a POS card order with no `sale` ledger row never
    // decremented anything, so nothing is missing from the shelf to ask about.
    if ((order.timeline ?? []).some((event) => event.event === 'cancelled')) {
      return
    }

    const { lines } = await resolveTrackedRestockLines(
      hostRef,
      order,
      // A product this flag cannot read drops out rather than failing the
      // flag: the money has already moved. The cancellation writer (AGL-1808)
      // passes its TRANSACTION's read instead, because a line it silently
      // dropped would leave stock off the shelf it just promised to return.
      (ref) => ref.get().catch(() => null),
    )
    // Nothing was ever decremented for this order, so nothing is missing from
    // the shelf. Writing a prompt here would be the noise that teaches a
    // merchant to ignore the ones that matter.
    if (lines.length === 0) return

    // THE PROMPT COUNTS WHAT THE SHELF ACTUALLY LOST, NOT WHAT THE SALE SOLD
    // (AGL-2325). `line.quantity` is the units the line sold, and on a
    // BACKORDER product the inventory floor absorbed part or all of the
    // decrement — stock 0, three units sell, the count stays 0 — so the
    // merchant was asked to restock units the count never gave up. The same
    // `appliedDelta` treatment AGL-2149 gave the cancellation cap, from the
    // same ledger rows and through the same shared helpers, so the question
    // this asks and the units a cancellation would return cannot disagree.
    //
    // The under-prompt this could have caused is what the cap rule already
    // rules out: only pairs the ledger DESCRIBES are capped, so a line it says
    // nothing about keeps the old upper bound rather than being zeroed by a
    // ledger with holes in it. A read that FAILS degrades the same way, to no
    // caps at all — an over-stated prompt is a question the merchant can
    // answer, a missing one is stock left off the shelf for good.
    const capped = capRestockLines(
      lines,
      await readSaleReleaseCaps(hostRef, options.orderId),
    )
    // Every tracked line was absorbed by the floor, so nothing is missing from
    // the shelf and there is no question to ask.
    if (capped.length === 0) return

    const units = capped.reduce((sum, line) => sum + line.quantity, 0)
    const flaggedAtMs = Date.now()
    const record: CommerceModel.OrderRestockCheck = {
      kind: options.kind,
      lines: capped,
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
 * This order's sale-release caps, read outside any transaction (AGL-2325).
 *
 * SWALLOWS, like everything else on this path: the money has already moved,
 * and an empty map means "cap nothing", which leaves the prompt at the upper
 * bound it has always carried. One equality filter, so the automatic
 * single-field index answers it; the `reason` test runs here, over the handful
 * of rows one order has — the same query shape the cancellation writer runs
 * inside its transaction.
 */
async function readSaleReleaseCaps(
  hostRef: FirebaseFirestore.DocumentReference,
  orderId: string,
): Promise<Map<string, number>> {
  try {
    const rows = await hostRef
      .collection('inventoryAdjustments')
      .where('orderId', '==', orderId)
      .get()
    return saleReleaseCaps(
      rows.docs.filter((row) => row.get('reason') === 'sale'),
    )
  } catch (error) {
    console.error('readSaleReleaseCaps failed', error)
    return new Map()
  }
}

/**
 * Key for one product+variant pair in a release-cap map.
 *
 * The separator is U+0000 written as an ESCAPE, not as a raw byte (AGL-2355).
 * Emitted literally it made `file(1)` call the source `data`, so grep skipped
 * the whole file as binary and an AGL-2320 sweep missed a call site in it.
 * Same character at runtime. NUL is still the right separator: it cannot occur
 * in a Firestore document id, so no pair can collide.
 */
export const restockCapKey = (productId: string, variantId: string): string =>
  `${productId}\u0000${variantId}`

/**
 * How many units of each product+variant a sale ACTUALLY took off the shelf,
 * read from that order's `reason: 'sale'` ledger rows (AGL-2149).
 *
 * The variant inventory writer floors at zero, and that floor silently absorbs
 * the overshoot on a BACKORDER product: stock 0, `canPurchase` admits the sale
 * because the policy says to, three units sell, `Math.max(0, 0 + -3)` leaves
 * the count at 0. The rows carry both numbers for exactly this — `delta` stays
 * the units SOLD, which is the merchant's history, and `appliedDelta` says how
 * many the count could give up.
 *
 * The writer is deliberately NOT named here: `stock-decrement-race.spec.ts`
 * sweeps every server source for that identifier to prove no file outside its
 * allowlist hand-rolls a stock write, and it matches the bare name, so even a
 * comment mentioning it would read as a call site. This module writes no stock
 * at all — it writes the question.
 *
 * Shared by the cancellation writer, which uses it to bound how much stock
 * goes back, and by the restock flag, which uses it to bound what it CLAIMS
 * went missing (AGL-2325). Extracted rather than copied: the two must not
 * drift, because a flag that names more units than the cancellation would
 * return is the double-count both of them exist to avoid.
 */
export function saleReleaseCaps(
  saleRows: readonly { get: (field: string) => unknown }[],
): Map<string, number> {
  const caps = new Map<string, number>()
  for (const row of saleRows) {
    const productId = String(row.get('productId') ?? '')
    const variantId = String(row.get('variantId') ?? '')
    if (!productId || !variantId) continue
    const moved = Number(row.get('appliedDelta') ?? row.get('delta') ?? 0)
    // Sale rows are negative; the cap is how many units left the shelf.
    caps.set(
      restockCapKey(productId, variantId),
      (caps.get(restockCapKey(productId, variantId)) ?? 0) +
        Math.max(0, -moved),
    )
  }
  return caps
}

/**
 * Lines narrowed to what the count actually gave up, dropping any that gave up
 * nothing (AGL-2149, AGL-2325).
 *
 * ONLY PAIRS THE LEDGER DESCRIBES ARE CAPPED, and that asymmetry is the whole
 * safety argument. A pair with no row is left at the units it sold, which is
 * what keeps the pre-AGL-1807 draft links — decremented with no row at all —
 * and the buy-now path from being silently zeroed by a ledger that has holes
 * in it. So an absent ledger degrades to the old upper bound rather than to
 * saying nothing moved.
 *
 * The budget is consumed as it is spent, so two lines of the same
 * product+variant share one rather than each claiming it whole. Takes a COPY,
 * so a caller may reuse the map it passed.
 */
export function capRestockLines(
  lines: readonly CommerceModel.OrderRestockLine[],
  caps: ReadonlyMap<string, number>,
): CommerceModel.OrderRestockLine[] {
  const budgets = new Map(caps)
  const capped: CommerceModel.OrderRestockLine[] = []
  for (const line of lines) {
    const key = restockCapKey(line.productId, line.variantId)
    const budget = budgets.get(key)
    const quantity =
      budget == null ? line.quantity : Math.min(line.quantity, budget)
    if (budget != null) budgets.set(key, budget - quantity)
    if (quantity <= 0) continue
    capped.push({ ...line, quantity })
  }
  return capped
}

/** What an order's tracked lines resolved to, with the products behind them. */
export interface TrackedRestockLines {
  lines: CommerceModel.OrderRestockLine[]
  /**
   * The product doc behind each line, by product id — read once each, and
   * handed back so a caller that WRITES stock (AGL-1808) does not read them a
   * second time. Only products that contributed a line appear.
   */
  products: Map<string, CommerceModel.HostProduct>
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
 *
 * `read` is the caller's, and the choice is not cosmetic (AGL-1808): the flag
 * passes a swallowing `get()` because a product it cannot read must not fail a
 * refund that already moved, while the cancellation writer passes its
 * TRANSACTION's `get` so every product it is about to increment is read under
 * the same transaction that writes it — and so a read failure aborts rather
 * than quietly shortening the list.
 */
export async function resolveTrackedRestockLines(
  hostRef: FirebaseFirestore.DocumentReference,
  order: CommerceModel.HostOrder,
  read: (
    ref: FirebaseFirestore.DocumentReference,
  ) => Promise<{ exists?: boolean; data?: () => unknown } | null>,
): Promise<TrackedRestockLines> {
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
      const snapshot = await read(hostRef.collection('products').doc(productId))
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
  const resolved = new Map<string, CommerceModel.HostProduct>()
  for (const line of lines) {
    const product = products.get(line.productId)
    if (product) resolved.set(line.productId, product)
  }
  return { lines, products: resolved }
}
