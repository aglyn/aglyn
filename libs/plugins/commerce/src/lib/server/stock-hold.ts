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
import { randomUUID } from 'crypto'

/**
 * Reserve-then-settle for STOCK (AGL-2356).
 *
 * The I/O half of `model/commerce-stock-holds.ts` — read that file first; it
 * carries the decision this one implements, including why the hold does not
 * touch `inventory` and why a lapsed hold is a release.
 *
 * This is the AGL-2453 promotion-slot shape applied to the one counter that
 * moves real goods, with two differences that matter:
 *
 *   1. **A cart holds N products, so the hold is ONE transaction over all of
 *      them.** Firestore serialises the whole set, so a two-product cart either
 *      reserves both or reserves neither — a partial reservation would charge a
 *      shopper for a basket the store cannot fill, which is the failure this
 *      issue exists to prevent, arriving through the fix.
 *   2. **The release needs an index.** A promotion hold is released against the
 *      one document named in the session metadata; a cart hold spans documents
 *      Stripe never hears about. `hosts/{hostId}/stockHolds/{holdKey}` is
 *      written INSIDE the same transaction as the holds it names, so the index
 *      cannot disagree with the reservations, and the session carries only the
 *      key.
 */

/** One reserved line, already resolved to a real variant. */
export interface StockHoldLine {
  productId: string
  variantId: string
  quantity: number
}

/**
 * Why a reservation could not be taken.
 *
 * - `sold-out` — the units are not there, or are spoken for by another live
 *   checkout. The one refusal a shopper is told about by name.
 * - `missing` — the product document is gone, deleted between the pricing
 *   loop's read and this transaction.
 * - `error` — Firestore refused. The checkout is REFUSED rather than allowed
 *   through unreserved: passing a shopper to Stripe on a reservation that
 *   could not be taken is exactly the defect this file closes.
 */
export type StockHoldRefusal = 'sold-out' | 'missing' | 'error'

/**
 * A two-member union with `reason` and `productName` present on BOTH members
 * rather than an intersection, for the reason `PromotionSlotOutcome` records:
 * discriminated-union narrowing does not reach through an intersection under
 * this repo's compiler settings (`strictNullChecks` is off repo-wide), and the
 * intersection form fails to compile at every call site.
 */
export type StockHoldOutcome =
  | {
      ok: true
      reason?: undefined
      productName?: undefined
      /**
       * The key the hold was stored under, or `''` when nothing needed
       * reserving (every line untracked or backorder). Carried in the session
       * metadata so the webhook can release exactly this reservation; its
       * absence is what tells the webhook there is nothing to release.
       */
      holdKey: string
      /** Drop the reservation. Best-effort and never throws. */
      release: () => Promise<void>
    }
  | { ok: false; reason: StockHoldRefusal; productName: string }

/**
 * A stable per-attempt hold key — the same rule as `promotionHoldKey`.
 *
 * `claim.stripeKey` when the client sent an Idempotency-Key, so a retry of one
 * attempt re-claims its OWN units rather than being refused by them. When it
 * did not, a fresh random key per request — NOT `String(claim.stripeKey)`,
 * which yields the literal `'null'` and would make every keyless shopper on the
 * site share one reservation, each reading the other's hold as their own retry
 * and both passing a shelf of one.
 */
export function stockHoldKey(stripeKey: string | null): string {
  return stripeKey || `anon-${randomUUID()}`
}

/** Two lines of one product COMPOUND — a cart holds variants, not products. */
function groupLines(lines: StockHoldLine[]): Map<string, Map<string, number>> {
  const byProduct = new Map<string, Map<string, number>>()
  for (const line of lines) {
    const quantity = Math.round(Number(line?.quantity) || 0)
    if (!line?.productId || !line?.variantId || quantity <= 0) continue
    const variants = byProduct.get(line.productId) ?? new Map<string, number>()
    variants.set(line.variantId, (variants.get(line.variantId) ?? 0) + quantity)
    byProduct.set(line.productId, variants)
  }
  return byProduct
}

/**
 * Reserve every line, or refuse.
 *
 * The re-check and the write are ONE transaction over the SAME documents, which
 * is the whole fix: the old code read the shelf with a plain `.get()` at
 * session creation and the webhook decremented it minutes later without ever
 * re-asking, so N shoppers all read `inventory: 1` and all passed.
 * `Transaction.get()` takes a lock on each product document, so contending
 * checkouts SERIALISE — the loser re-runs its callback against the winner's
 * committed hold and is refused.
 *
 * Lines with nothing to reserve — an untracked variant, a `backorder` product —
 * write nothing at all, exactly as an uncapped promotion does. A cart made
 * entirely of those returns an empty `holdKey` and the session carries no
 * reservation, so the digital-goods storefront is byte-identical to what it was
 * before this issue.
 */
export async function holdStock(options: {
  firestore: any
  hostRef: any
  holdKey: string
  lines: StockHoldLine[]
  nowMs?: number
  /** Label for the failure log; never shown to a shopper. */
  label: string
}): Promise<StockHoldOutcome> {
  const { firestore, hostRef, holdKey, lines, label } = options
  const nowMs = options.nowMs ?? Date.now()
  const expiresAtMs = nowMs + CommerceModel.STOCK_HOLD_TTL_MS
  const byProduct = groupLines(lines)
  const noop: StockHoldOutcome = {
    ok: true,
    holdKey: '',
    release: async () => undefined,
  }
  if (byProduct.size === 0) return noop

  // try/catch and NOT a trailing `.catch()`. A `runTransaction` that is
  // missing or throws synchronously — a broken client, or a test double that
  // never modelled one — never returns a promise for a `.catch()` to attach to,
  // so the throw escapes the guard and becomes a 500 from the caller's own
  // catch. That is still a refusal and never an unreserved sale, but it is a
  // refusal this function was supposed to have named.
  let outcome: any
  try {
    outcome = await firestore.runTransaction(async (transaction: any) => {
      const productIds = [...byProduct.keys()]
      // ALL READS BEFORE ANY WRITE, which Firestore requires and which is also
      // what makes the set atomic: every document is locked before the first
      // decision is taken against any of them.
      const snapshots = await Promise.all(
        productIds.map((productId) =>
          transaction.get(hostRef.collection('products').doc(productId)),
        ),
      )
      const writes: Array<{ ref: any; value: Record<string, unknown> }> = []
      const heldProductIds: string[] = []
      for (let index = 0; index < productIds.length; index++) {
        const productId = productIds[index]
        const snapshot = snapshots[index]
        if (!snapshot?.exists) {
          return { kind: 'missing' as const, productName: '' }
        }
        const product = CommerceModel.liftLegacyProduct(snapshot.data() as any)
        const wanted = byProduct.get(productId) as Map<string, number>
        const units: Record<string, number> = {}
        for (const [variantId, quantity] of wanted) {
          // `== null` is the test, never `!available` — `0` is a legitimate
          // answer here and `strictNullChecks` is off repo-wide.
          if (!CommerceModel.stockIsReservable(product, variantId, nowMs)) {
            continue
          }
          if (
            !CommerceModel.canReserveStock(
              product,
              variantId,
              quantity,
              nowMs,
              // This attempt's own prior hold does not stand in its way: a
              // retry must re-claim what it already reserved, or the second
              // press of the same button refuses the shopper their own units.
              holdKey,
            )
          ) {
            return {
              kind: 'sold-out' as const,
              productName: String(product?.name ?? ''),
            }
          }
          units[variantId] = quantity
        }
        if (Object.keys(units).length === 0) continue
        // Lapsed holds are removed by SENTINEL, never by writing back a locally
        // pruned copy of the map: `set(…, { merge: true })` DEEP-merges nested
        // maps, so an object with the key removed leaves the stored key exactly
        // where it was. Correctness does not depend on this sweep — every read
        // prunes again — but without it the document grows one dead key per
        // abandoned checkout, forever, on the one document class in this plugin
        // that is already the largest.
        const live = CommerceModel.pruneStockHolds(
          (snapshot.data() as any)?.stockHolds,
          nowMs,
        )
        const swept: Record<string, unknown> = {}
        for (const stale of Object.keys(
          (snapshot.data() as any)?.stockHolds ?? {},
        )) {
          if (stale !== holdKey && !live[stale]) {
            swept[stale] = firebaseAdmin.firestore.FieldValue.delete()
          }
        }
        writes.push({
          ref: hostRef.collection('products').doc(productId),
          value: {
            stockHolds: {
              ...swept,
              // A whole-object write for THIS key, not a nested merge: the
              // retry of an attempt whose cart shrank must not keep reserving
              // the line it dropped, and a deep merge of `units` would.
              [holdKey]: { expiresAtMs, units },
            },
          },
        })
        heldProductIds.push(productId)
      }
      if (writes.length === 0) return { kind: 'nothing-to-hold' as const }
      for (const write of writes) {
        transaction.set(write.ref, write.value, { merge: true })
      }
      // THE RELEASE INDEX, in the same transaction as the reservations it
      // names. Written last so it can never name a product whose hold did not
      // commit; read by id (never queried) on `checkout.session.expired` and at
      // settlement, so it needs no index of its own.
      transaction.set(
        hostRef.collection('stockHolds').doc(holdKey),
        {
          productIds: heldProductIds,
          lines: heldProductIds.flatMap((productId) =>
            [...(byProduct.get(productId) as Map<string, number>)].map(
              ([variantId, quantity]) => ({ productId, variantId, quantity }),
            ),
          ),
          expiresAtMs,
          createdAtMs: nowMs,
        },
        { merge: false },
      )
      return { kind: 'held' as const, productIds: heldProductIds }
    })
  } catch (error: unknown) {
    console.error('Stock hold failed', label, error)
    outcome = { kind: 'error' as const, productName: '' }
  }

  if (outcome.kind === 'nothing-to-hold') return noop
  if (outcome.kind === 'held') {
    const productIds: string[] = outcome.productIds ?? []
    return {
      ok: true,
      holdKey,
      // Captures the ids, so an in-request release costs no read. The webhook's
      // release goes through `releaseStockHold` and reads the index instead.
      release: () => dropStockHold(hostRef, holdKey, productIds),
    }
  }
  return {
    ok: false,
    reason: outcome.kind as StockHoldRefusal,
    productName: String(outcome.productName ?? ''),
  }
}

/**
 * Give the units back, given the products to give them back on.
 *
 * Bare merge-sets with the delete sentinel rather than a transaction: removing
 * one key is not a read-modify-write, and a release must not be able to fail
 * the response it is tidying up after. Swallows its own errors for the same
 * reason — the TTL still releases the units.
 */
async function dropStockHold(
  hostRef: any,
  holdKey: string,
  productIds: string[],
): Promise<void> {
  if (!holdKey) return
  // ONE try/catch around the whole thing, and not a `.catch()` per call. A
  // release runs on the refusal paths — it is the last thing a 409 does on its
  // way out — so anything it throws lands in the CALLER's catch and turns a
  // clean, deliberate refusal into a 500 the shopper cannot act on. A trailing
  // `.catch()` does not cover that: a method that is missing or throws
  // synchronously never returns a promise for one to attach to.
  //
  // Swallowed rather than surfaced because the TTL still releases the units.
  // Tidying up a reservation must not be able to fail the response it is
  // tidying up after.
  try {
    for (const productId of productIds) {
      await hostRef
        .collection('products')
        .doc(productId)
        .set(
          {
            stockHolds: {
              [holdKey]: firebaseAdmin.firestore.FieldValue.delete(),
            },
          },
          { merge: true },
        )
    }
    await hostRef.collection('stockHolds').doc(holdKey).delete()
  } catch (error: unknown) {
    console.error('Stock hold release failed', holdKey, error)
  }
}

/**
 * Release a reservation named only by its key — the webhook's door.
 *
 * Reads the index written by `holdStock`, so `checkout.session.expired` needs
 * nothing in the session but `metadata[stockHoldKey]`. A missing index doc is
 * NOT an error: it means the hold was already released, or the session predates
 * this deploy, and in both cases there is nothing to do.
 */
export async function releaseStockHold(
  hostRef: any,
  holdKey: string,
): Promise<void> {
  if (!holdKey) return
  const snapshot = await Promise.resolve()
    .then(() => hostRef.collection('stockHolds').doc(holdKey).get())
    .catch(() => null)
  const productIds: string[] = Array.isArray(snapshot?.get?.('productIds'))
    ? snapshot.get('productIds')
    : []
  await dropStockHold(hostRef, holdKey, productIds)
}
