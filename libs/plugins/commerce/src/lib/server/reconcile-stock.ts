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

import { type PluginJobHostGate } from '@aglyn/aglyn/server'
import { firebaseAdmin, notifyHostManagers } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/**
 * THE MISSING-DECREMENT DETECTOR (AGL-2358).
 *
 * Every order-minting branch of `billing-webhook.ts` commits the order in a
 * transaction and decrements stock AFTER it, and every branch guards on a
 * replay flag that transaction set — `created` for cart and buy-now,
 * `flipped` for the draft/POS-card branch, the invoice-id guard for a
 * subscription cycle. So a process that dies in the window between the two
 * loses the decrement PERMANENTLY: Stripe redelivers, the guard says the
 * order already exists, and the handler returns without ever reaching the
 * stock write. The merchant has a paid order and an untouched shelf, and
 * before this nothing anywhere recorded that they had diverged.
 *
 * `/api/billing/webhook`'s own claim marker makes the same window wider, not
 * narrower: AGL-2157 decided that an event which throws mid-dispatch KEEPS
 * its claim — deliberately, because re-running the dispatch could double-apply
 * a gift-card spend or a coupon redemption — and told staff to "reconcile by
 * hand". This is the thing they reconcile with. It is also the only detector
 * for the death AGL-2157 cannot catch at all: a timeout, an OOM or a deploy
 * kill unwinds no stack, so that route's `catch` never runs and no staff
 * notice is ever raised.
 *
 * WHY A DETECTOR AND NOT THE FIX. The two real fixes were both weighed and
 * both rejected for this side of the Sept 1 freeze:
 *
 *  - Folding the decrement into the order transaction would restructure the
 *    checkout path's largest and most contended transaction, days before
 *    launch, on the path that takes money. The cart branch alone would have
 *    to pull N product reads into a transaction that currently reads two
 *    documents, and every contended retry would then re-run order numbering.
 *  - A second replay flag with a re-entry path is worse, not better. The
 *    `created` guard is not protecting the decrement — it is protecting
 *    licence-key assignment, coupon redemption counters, gift-card balances,
 *    receipt email and contact ingestion, all behind ONE flag. Any re-entry
 *    past it needs every one of those to become individually idempotent
 *    first, which is precisely the "per-EFFECT idempotency sweep" AGL-2157
 *    named as the real fix and deferred for the same reason.
 *
 *    And the flag is not even the only lock. Deleting it does not make a
 *    redelivery decrement: `cartRef.delete()` runs between the guard and the
 *    inventory loop, so the second delivery iterates an empty cart. A
 *    resumable path would additionally have to stop reading the cart and
 *    start reading the order's own `lineItems`. That is measured, not
 *    assumed — `stock-decrement-reconciliation.spec.ts` pins it.
 *
 * This is read-only against orders, products and the ledger. The only thing
 * it writes is its own report marker, in a collection nothing else touches.
 */

/**
 * The statuses an order can only be in if its stock decrement was ATTEMPTED.
 *
 * `pending` is excluded because it is the pre-payment state of a draft link
 * and a POS card sale — neither has decremented yet, and both are supposed to
 * look exactly like this. `cancelled` and `refunded` are excluded because
 * `cancel-order.ts` and `refund.ts` write `reason: 'cancellation'` /
 * `'refund'` rows and may have released the units already; a sale row missing
 * from an order that has been through a release is a question this detector
 * cannot answer from the ledger alone, and guessing would be worse than
 * staying quiet.
 */
const DECREMENTED_STATUSES: ReadonlySet<string> = new Set([
  'paid',
  'partially_fulfilled',
  'fulfilled',
  'delivered',
])

/**
 * How long an order gets to finish its own decrement before it counts as
 * diverged. The decrement runs milliseconds to seconds after the order
 * commits, so ten minutes is far past any healthy webhook — and a beat that
 * flagged an order the webhook was still working on would report a divergence
 * that fixed itself, which is the fastest way to make a signal ignored.
 */
const DEFAULT_GRACE_MS = 10 * 60 * 1000

export interface MissingSaleDecrement {
  hostId: string
  orderId: string
  /** The merchant-facing sequential number, when the doc carries one. */
  orderNumber: number | null
  orderStatus: string
  orderCreatedAtMs: number
  productId: string
  /** Live product name — the order's snapshot name is used as a fallback. */
  productName: string
  variantId: string
  /** Units the order says were sold, and the shelf therefore still holds. */
  quantity: number
}

export interface StockReconciliationResult {
  ordersScanned: number
  /** Orders that reached the ledger comparison (post status/grace filter). */
  ordersChecked: number
  missing: MissingSaleDecrement[]
  /**
   * The ledger read hit its limit before reaching back as far as the oldest
   * order considered, so orders older than the ledger window were DROPPED
   * rather than judged against rows that were never read.
   *
   * Recorded and reported rather than swallowed, for the AGL-2321 reason:
   * `siteSizeTruncated` exists because a number that is silently a lower
   * bound is worse than one that says so. A truncated pass under-reports; it
   * must never be read as "all matched".
   */
  ledgerTruncated: boolean
}

/**
 * Compares one host's recently-decremented orders against the
 * `reason: 'sale'` rows joined to them, and reports the lines whose decrement
 * is missing.
 *
 * Reads are bounded and cheap in the healthy case: two collection queries per
 * host, and a product read ONLY for a line that already looks divergent.
 *
 * Two equality-free queries so the automatic single-field indexes answer them
 * (the `cancel-order.ts` rule): `orderBy(createdAtMs desc).limit()` and
 * `orderBy(atMs desc).limit()`, with the status test applied in memory over
 * the handful of documents that come back.
 */
export async function reconcileHostStockDecrements(options: {
  firestore: any
  hostRef: any
  hostId: string
  nowMs?: number
  graceMs?: number
  orderLimit?: number
  ledgerLimit?: number
}): Promise<StockReconciliationResult> {
  const {
    hostRef,
    hostId,
    nowMs = Date.now(),
    graceMs = DEFAULT_GRACE_MS,
    orderLimit = 100,
    ledgerLimit = 500,
  } = options
  const empty: StockReconciliationResult = {
    ordersScanned: 0,
    ordersChecked: 0,
    missing: [],
    ledgerTruncated: false,
  }
  const orderSnapshot = await hostRef
    .collection('orders')
    .orderBy('createdAtMs', 'desc')
    .limit(orderLimit)
    .get()
    .catch(() => null)
  if (!orderSnapshot) return empty
  const orderDocs: any[] = orderSnapshot.docs ?? []
  const settledBefore = nowMs - graceMs
  let candidates = orderDocs
    .map((doc) => ({
      id: String(doc.id),
      status: String(doc.get('status') ?? ''),
      createdAtMs: Number(doc.get('createdAtMs') ?? 0),
      number: doc.get('number') == null ? null : Number(doc.get('number')),
      lineItems: (doc.get('lineItems') ?? []) as CommerceModel.OrderLineItem[],
    }))
    .filter(
      (order) =>
        DECREMENTED_STATUSES.has(order.status) &&
        order.createdAtMs > 0 &&
        order.createdAtMs <= settledBefore,
    )
  if (!candidates.length) {
    return { ...empty, ordersScanned: orderDocs.length }
  }
  const ledgerSnapshot = await hostRef
    .collection('inventoryAdjustments')
    .orderBy('atMs', 'desc')
    .limit(ledgerLimit)
    .get()
    .catch(() => null)
  if (!ledgerSnapshot) {
    return { ...empty, ordersScanned: orderDocs.length }
  }
  const ledgerDocs: any[] = ledgerSnapshot.docs ?? []
  // `orderId|productId` -> the variant ids that order's sale rows name.
  const soldVariants = new Map<string, Set<string>>()
  let oldestLedgerMs = Number.POSITIVE_INFINITY
  for (const row of ledgerDocs) {
    const atMs = Number(row.get('atMs') ?? 0)
    if (atMs > 0) oldestLedgerMs = Math.min(oldestLedgerMs, atMs)
    if (row.get('reason') !== 'sale') continue
    const orderId = String(row.get('orderId') ?? '')
    const productId = String(row.get('productId') ?? '')
    if (!orderId || !productId) continue
    const key = `${orderId}|${productId}`
    const seen = soldVariants.get(key) ?? new Set<string>()
    seen.add(String(row.get('variantId') ?? ''))
    soldVariants.set(key, seen)
  }
  // A ledger read that hit its limit says nothing about anything older than
  // its oldest row. Those orders are dropped, not judged.
  const ledgerTruncated =
    ledgerDocs.length >= ledgerLimit &&
    Number.isFinite(oldestLedgerMs) &&
    candidates.some((order) => order.createdAtMs < oldestLedgerMs)
  if (ledgerTruncated) {
    candidates = candidates.filter(
      (order) => order.createdAtMs >= oldestLedgerMs,
    )
  }
  const missing: MissingSaleDecrement[] = []
  const productCache = new Map<string, CommerceModel.HostProduct | null>()
  for (const order of candidates) {
    for (const line of order.lineItems ?? []) {
      const productId = String(line?.productId ?? '')
      const quantity = Number(line?.quantity ?? 0)
      if (!productId || quantity <= 0) continue
      // A digital or service line never decrements — `decrementVariantStock`
      // refuses an untracked variant — so its missing sale row is the correct
      // outcome and must not cost a product read on every pass. The line's
      // own purchase-time snapshot answers this; anything else falls through
      // to the live tracked-ness test below.
      if (line?.productType === 'digital' || line?.productType === 'service') {
        continue
      }
      const sold = soldVariants.get(`${order.id}|${productId}`)
      const declaredVariantId = line?.variantId ? String(line.variantId) : ''
      if (declaredVariantId && sold?.has(declaredVariantId)) continue
      if (!declaredVariantId && sold?.size) continue
      // Only now is a product read worth taking: this line already looks
      // divergent, and the live product is what says whether it could ever
      // have decremented at all.
      if (!productCache.has(productId)) {
        const productDoc = await hostRef
          .collection('products')
          .doc(productId)
          .get()
          .catch(() => null)
        productCache.set(
          productId,
          productDoc?.exists
            ? CommerceModel.liftLegacyProduct(productDoc.data() as any)
            : null,
        )
      }
      const product = productCache.get(productId)
      // A product deleted since the sale is the `unresolvedLines` case the
      // webhook already reports on the order itself (AGL-2149). Nothing here
      // can tell whether its variant was tracked, so it is left alone.
      if (!product) continue
      const variantId =
        declaredVariantId || String(product.variants[0]?.id ?? '')
      if (!variantId) continue
      // Re-asked for a line that named no variant: the ledger row records the
      // RESOLVED id, so the default variant has to be resolved before the
      // absence means anything.
      if (!declaredVariantId && sold?.has(variantId)) continue
      const tracked = product.variants.some(
        (variant) => variant.id === variantId && variant.inventory != null,
      )
      // An untracked variant is a shelf nobody is counting. Its sale row is
      // absent by design, and this is also the one place the detector can be
      // wrong in the merchant's favour: tracking turned ON after the sale
      // makes an order that correctly never decremented look divergent. The
      // window is bounded by `orderLimit` and the report says what it is.
      if (!tracked) continue
      missing.push({
        hostId,
        orderId: order.id,
        orderNumber: order.number,
        orderStatus: order.status,
        orderCreatedAtMs: order.createdAtMs,
        productId,
        productName: String(product.name ?? line?.name ?? 'Product'),
        variantId,
        quantity,
      })
    }
  }
  return {
    ordersScanned: orderDocs.length,
    ordersChecked: candidates.length,
    missing,
    ledgerTruncated,
  }
}

/**
 * Reports a host's divergences to its managers, once per order.
 *
 * The marker in `hosts/{hostId}/inventoryReconciliation/{orderId}` is the only
 * write this whole pass makes, and it lives in a collection nothing else on
 * the platform reads or writes — the detector must not be able to affect the
 * money path it is watching. Without it a beat would re-nag every hour about
 * an order the merchant has already corrected, and an alert that repeats
 * forever is one that gets muted.
 */
export async function reportMissingSaleDecrements(
  hostId: string,
  missing: readonly MissingSaleDecrement[],
): Promise<number> {
  if (!missing.length) return 0
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const byOrder = new Map<string, MissingSaleDecrement[]>()
  for (const row of missing) {
    byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row])
  }
  let reported = 0
  for (const [orderId, lines] of byOrder) {
    const markerRef = hostRef.collection('inventoryReconciliation').doc(orderId)
    const marker = await markerRef.get().catch(() => null)
    // A read that FAILED is not a marker that is absent. Skipping here costs
    // one delayed report; treating it as absent would re-notify every pass
    // for as long as the read kept failing.
    if (!marker || marker.exists) continue
    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    const label =
      lines[0].orderNumber == null ? orderId : `#${lines[0].orderNumber}`
    await markerRef
      .set({
        orderId,
        reportedAtMs: Date.now(),
        lines: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
        })),
      })
      .catch(() => undefined)
    reported += 1
    console.error('commerce stock decrement missing', {
      hostId,
      orderId,
      lines: lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    })
    void notifyHostManagers(hostId, {
      type: 'content.lowStock',
      title: `Stock never came off the shelf — order ${label}`,
      body:
        `Order ${label} is ${lines[0].orderStatus} but ${units} unit` +
        `${units === 1 ? '' : 's'} of ` +
        `${lines.map((line) => line.productName).join(', ')} were never ` +
        'taken off the count, so the storefront is still offering stock ' +
        'that has been sold. Adjust the count by hand.',
      link: `/${hostId}/products`,
    })
  }
  return reported
}

export interface StockReconciliationScan {
  hosts: number
  ordersScanned: number
  missingLines: number
  reportedOrders: number
  truncatedHosts: number
  /** Hosts left unreconciled because they are locked (AGL-2495). */
  skippedLocked: number
}

/**
 * The platform beat: the most recent orders across every host, grouped by
 * host and reconciled one host at a time.
 *
 * Ordered by `createdAtMs` and NOT filtered by status, because an equality
 * filter plus an ordering is a composite index and the ordering alone is a
 * field override — the same trade `cancel-order.ts` takes. Every order writer
 * in the plugin stamps `createdAtMs` (cart, buy-now, draft, POS cash, POS
 * card, subscription cycle), so nothing is invisible to the ordering.
 */
export async function scanStockDecrements(
  /** The lockdown gate, injected by the caller (AGL-2495). Not optional. */
  gate: PluginJobHostGate,
  options?: {
    orderLimit?: number
    nowMs?: number
  },
): Promise<StockReconciliationScan> {
  const firestore = firebaseAdmin.app().firestore()
  const snapshot = await firestore
    .collectionGroup('orders')
    .orderBy('createdAtMs', 'desc')
    .limit(options?.orderLimit ?? 300)
    .get()
    .catch((error: unknown) => {
      console.error('commerce stock reconciliation scan failed', error)
      return null
    })
  const scan: StockReconciliationScan = {
    hosts: 0,
    ordersScanned: 0,
    missingLines: 0,
    reportedOrders: 0,
    truncatedHosts: 0,
    skippedLocked: 0,
  }
  if (!snapshot) return scan
  const hostIds = new Set<string>()
  for (const doc of (snapshot.docs ?? []) as any[]) {
    const hostRef = doc.ref?.parent?.parent
    // `hosts/{hostId}/orders` is the only shape this collection group has
    // today; the check is what keeps that true if a second one appears.
    if (!hostRef || hostRef.parent?.id !== 'hosts') continue
    hostIds.add(String(hostRef.id))
  }
  scan.hosts = hostIds.size
  for (const hostId of hostIds) {
    // LOCKDOWN (AGL-2495). This pass posts a console notification and stamps
    // the order timeline, so it is a write for the host — and on a site taken
    // down for abuse or a legal order, telling its managers about stock is
    // both a mutation and a message the takedown was meant to stop.
    //
    // SKIPPED, NOT DROPPED: the reconciliation is a DETECTOR with no cursor.
    // It re-derives everything from the last N orders on every beat, so a
    // host skipped now is reconciled in full on the first hourly beat after
    // the lift, and nothing it would have found is lost by waiting.
    if (await gate.isLocked(hostId)) {
      scan.skippedLocked += 1
      continue
    }
    const result = await reconcileHostStockDecrements({
      firestore,
      hostRef: firestore.collection('hosts').doc(hostId),
      hostId,
      ...(options?.nowMs == null ? {} : { nowMs: options.nowMs }),
    })
    scan.ordersScanned += result.ordersScanned
    scan.missingLines += result.missing.length
    if (result.ledgerTruncated) scan.truncatedHosts += 1
    scan.reportedOrders += await reportMissingSaleDecrements(
      hostId,
      result.missing,
    )
  }
  return scan
}
