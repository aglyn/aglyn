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

import { notifyHostManagers } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/**
 * THE ATOMIC STOCK DECREMENT (AGL-2320).
 *
 * Every stock write in this plugin was a read → compute → `set(…, {merge:true})`
 * of the whole `variants` array, with the read often far upstream of the write:
 * the cart branch of `billing-webhook.ts` reads its products, then runs a
 * transaction, a `cartRef.delete()`, a checkout-doc read, licence-key
 * assignment and an email send before it decrements. Two sales landing in that
 * window both computed from the same `variants` and both wrote; the later won
 * and one decrement was LOST. The ledger showed two `sale` rows while the count
 * moved once, so the shelf was short by one and the storefront went on offering
 * the unit it had already sold — the loss compounds, because phantom stock is
 * what admits the next oversell.
 *
 * `inventory` lives INSIDE the `variants` array, not at a document field path,
 * so `FieldValue.increment` is not expressible against it. That is why this was
 * filed as blocked on a data-model change. It is not the only way to make a
 * decrement safe: a transaction is. `Transaction.get()` takes a lock on the
 * product document, so two concurrent decrements SERIALIZE — the loser re-runs
 * its callback against the winner's committed state and subtracts from the real
 * remainder. The read-modify-write stays, the schema is untouched, and no
 * migration is needed. The cost is one contended retry, not one extra read.
 *
 * WHAT THIS DOES NOT DO. It does not refuse a sale. Every storefront path
 * gates on `canPurchase` when the Stripe Checkout session is created and
 * decrements minutes later in the webhook, by which time the money has moved —
 * refusing there would take payment and withhold goods. Closing the last-unit
 * oversell needs a HOLD taken at session creation and released when the session
 * expires, which is a feature with a new failure mode (an abandoned cart
 * sitting on the last unit for the session's lifetime) and is deliberately not
 * being introduced days before launch. So the oversell is made LOUD instead of
 * silent: when the fresh read proves the shelf could not cover the sale, the
 * managers are told, with the number that was actually short.
 *
 * The floor in `adjustVariantInventory` stays — a shelf count does not go
 * negative, and every reader assumes it cannot (AGL-2149). What changes is that
 * `applied` is now computed from the state the write actually lands on, so the
 * ledger's `appliedDelta` tells the truth under concurrency. Before this, two
 * concurrent sales of one unit each computed `appliedDelta: -1` from the same
 * stale `inventory: 1`, and the ledger claimed two units left a shelf that only
 * ever held one.
 */
export interface StockDecrementOutcome {
  /**
   * What the count ACTUALLY moved by — zero or negative, and never more than
   * the shelf held. The caller writes this as the ledger row's `appliedDelta`
   * (AGL-2149) when it differs from `requested`.
   */
  applied: number
  /** The units sold, negated. */
  requested: number
  /**
   * The product as read INSIDE the transaction, and the same product with the
   * committed variants. Both null when nothing was written — a missing product,
   * an untracked variant, or a failed commit. Handed to
   * `alertLowStockCrossing` as the pre/post pair, which is now the pair the
   * write actually crossed rather than one computed from an upstream read.
   */
  before: CommerceModel.HostProduct | null
  after: CommerceModel.HostProduct | null
  /**
   * The commit did not land. Distinct from `applied === 0`, which is a real
   * outcome (a deny-policy product already at zero). A caller must not write a
   * ledger row for a failed commit: a row whose count never moved is exactly
   * what makes a later cancellation hand back units nobody has.
   */
  failed: boolean
}

/**
 * Decrements one variant's stock inside a transaction and reports what the
 * shelf could actually give up. Never throws: a stock write must not fail a
 * webhook, because Stripe would redeliver and the order would be minted twice.
 */
export async function decrementVariantStock(options: {
  firestore: any
  hostRef: any
  hostId: string
  productId: string
  variantId: string
  /** Units sold; sign is ignored. */
  quantity: number
  locationId?: string
}): Promise<StockDecrementOutcome> {
  const {
    firestore,
    hostRef,
    hostId,
    productId,
    variantId,
    quantity,
    locationId,
  } = options
  const requested = -Math.abs(Math.round(Number(quantity) || 0))
  const nothing: StockDecrementOutcome = {
    applied: 0,
    requested,
    before: null,
    after: null,
    failed: false,
  }
  if (requested === 0) return nothing
  let outcome: StockDecrementOutcome
  try {
    outcome = await firestore.runTransaction(async (transaction: any) => {
      const productRef = hostRef.collection('products').doc(productId)
      const snapshot = await transaction.get(productRef)
      if (!snapshot?.exists) return nothing
      const before = CommerceModel.liftLegacyProduct(snapshot.data() as any)
      const tracked = before.variants.some(
        (variant) => variant.id === variantId && variant.inventory != null,
      )
      if (!tracked) return nothing
      const variants = CommerceModel.adjustVariantInventory(
        before,
        variantId,
        requested,
        locationId,
      )
      // Computed from the SAME read the write is derived from, inside the same
      // transaction — which is the whole point (AGL-2320).
      const applied = CommerceModel.appliedVariantInventoryDelta(
        before,
        variantId,
        requested,
        locationId,
      )
      const after = { ...before, variants }
      transaction.set(
        productRef,
        {
          variants,
          inventory: CommerceModel.productInventory(after),
        },
        { merge: true },
      )
      return { applied, requested, before, after, failed: false }
    })
  } catch (error) {
    // Swallowed like the `.catch(() => undefined)` this replaces, but no longer
    // silently: the caller skips its ledger row, and the count and the ledger
    // stay in agreement about a decrement that did not happen.
    console.error('Stock decrement failed', hostId, productId, variantId, error)
    return { ...nothing, failed: true }
  }
  // The oversell is now LOUD (AGL-2320). `content.lowStock` is deliberately
  // reused rather than a new notification type: the type union carries a label
  // map, a category and a per-user mute, and "you are out of this" is the
  // category a merchant who cares about stock is already subscribed to. A
  // backorder product selling past zero
  // is the merchant's own choice and already understood (AGL-2149), so only a
  // deny-policy shortfall is reported — that is the one the merchant did not
  // ask for and previously got no signal about at all.
  const short = outcome.applied - outcome.requested
  if (
    short > 0 &&
    outcome.before &&
    outcome.before.oversellPolicy !== 'backorder'
  ) {
    void notifyHostManagers(hostId, {
      type: 'content.lowStock',
      title: `Oversold — ${outcome.before.name}`,
      body:
        `${Math.abs(outcome.requested)} sold, ${Math.abs(outcome.applied)} ` +
        `came off the shelf. ${short} unit${short === 1 ? '' : 's'} were not ` +
        'in stock — the sale is paid and needs restocking or refunding.',
      link: `/${hostId}/products`,
    })
  }
  return outcome
}
