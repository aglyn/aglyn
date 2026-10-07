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

/**
 * WHERE A SALE ENTERS THE SYNC (AGL-3614): commerce's order events, read
 * into the plugin's own snapshots and QUEUED — nothing more.
 *
 * Commerce raises `order.paid`, `order.refunded` and `order.cancelled`
 * through the plugin event outbox (AGL-3611), which a TENANT job drains, so
 * this module runs in the tenant runtime. That is why it is apart from the
 * engine: it writes sync items and reads the connection's mapping, and never
 * opens a grant, reads a credential or calls a ledger. Posting happens on
 * the console's tick (`sync-job.ts`), the only place that holds the key.
 *
 * Delivery is at least once. Every item's id is derived from its source (the
 * order, the refund), and a document that already exists is left alone, so a
 * redelivered event queues nothing the second time.
 *
 * The payload is commerce's public order view (`GET /v1/sites/{siteId}/
 * orders/{orderId}`); the fields read are restated here, as a subscriber in
 * another plugin does, rather than imported.
 */

import { toCents } from '../model/accounting-money'
import type {
  AccountingOrderSnapshot,
  AccountingPayoutSnapshot,
  AccountingRefundSnapshot,
} from '../model/accounting-sources'
import {
  ACCOUNTING_CONNECTIONS_COLLECTION,
  EMPTY_ACCOUNTING_MAPPING,
  type AccountingMapping,
} from '../model/accounting.types'
import {
  beforeStartDate,
  createSyncItems,
  itemForPayout,
  itemsForPaidOrder,
  itemsForRefund,
  readSyncItem,
  saleItemId,
  syncItemId,
  syncItemsCollection,
} from './sync-store'

/** The order as commerce's events carry it: the fields the sync reads. */
export interface CommerceOrderEventOrder {
  id: string
  number?: number | null
  status?: string | null
  channel?: string | null
  currency?: string | null
  customerEmail?: string | null
  customerName?: string | null
  lineItems?: unknown
  totals?: {
    itemsCents?: number
    shippingCents?: number
    taxCents?: number
    discountCents?: number
    totalCents?: number | null
    feeCents?: number
  }
  refundedCents?: number
  /**
   * Which tax regime the sale carried: `stripe-automatic` when Stripe Tax
   * computed it under Aglyn's registrations, `manual` or `none` otherwise,
   * `null` on an order from before it was recorded.
   */
  taxMode?: string | null
}

/** The tax regime under which Aglyn, as marketplace facilitator, holds and remits the tax. */
export const MARKETPLACE_TAX_MODE = 'stripe-automatic'

/** `order.paid` and `order.cancelled`. */
export interface CommerceOrderEventPayload {
  order: CommerceOrderEventOrder
}

/** `order.refunded`: what THIS refund moved. */
export interface CommerceOrderRefundedEventPayload extends CommerceOrderEventPayload {
  refund: { id: string | null; amountCents: number; lineItemIds?: number[]; full?: boolean }
}

/** The envelope fields the intake reads. */
export interface AccountingEventEnvelope<Payload> {
  id: string
  hostId: string
  orgId: string | null
  occurredAtMs: number
  payload: Payload
}

export interface AccountingIntakeDeps {
  firestore: () => FirebaseFirestore.Firestore
  now: () => number
}

/** The mapping of the organization's connection, or `null` when it has none. */
export async function readOrgMapping(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<{ mapping: AccountingMapping; seenTaxKeys: string[] } | null> {
  const snapshot = await firestore.collection('orgs').doc(orgId).collection(ACCOUNTING_CONNECTIONS_COLLECTION).limit(2).get()
  const docs = snapshot.docs
    .map((doc) => doc.data() as { mapping?: AccountingMapping; connectedAtMs?: number; seenTaxKeys?: string[] })
    .sort((a, b) => Number(b.connectedAtMs ?? 0) - Number(a.connectedAtMs ?? 0))
  const record = docs[0]
  if (!record) return null
  return {
    mapping: { ...EMPTY_ACCOUNTING_MAPPING, ...(record.mapping ?? {}) },
    seenTaxKeys: Array.isArray(record.seenTaxKeys) ? record.seenTaxKeys : [],
  }
}

/** The site's organization: the envelope's, or the site document's. */
export async function orgOfHost(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  known: string | null,
): Promise<string | null> {
  if (known) return known
  const host = await firestore.collection('hosts').doc(hostId).get()
  const orgId = host.exists ? host.get('orgId') : null
  return typeof orgId === 'string' && orgId ? orgId : null
}

/** Commerce's order view → the sync's snapshot. */
export function snapshotFromOrderEvent(
  order: CommerceOrderEventOrder,
  context: { orgId: string; hostId: string; occurredAtMs: number },
): AccountingOrderSnapshot {
  const totals = order.totals ?? {}
  const lines = Array.isArray(order.lineItems) ? (order.lineItems as Array<Record<string, unknown>>) : []
  // A Stripe Tax sale's tax is Aglyn's to remit and never reaches the
  // merchant's account, so it is neither the merchant's liability nor money
  // in their clearing account: the sale is posted without it.
  const taxCents = toCents(totals.taxCents)
  const marketplaceTaxCents = order.taxMode === MARKETPLACE_TAX_MODE ? taxCents : 0
  return {
    orgId: context.orgId,
    hostId: context.hostId,
    orderId: String(order.id),
    number: typeof order.number === 'number' ? order.number : null,
    currency: typeof order.currency === 'string' && order.currency ? order.currency : 'usd',
    paidAtMs: context.occurredAtMs,
    channel: typeof order.channel === 'string' ? order.channel : null,
    customerName: typeof order.customerName === 'string' ? order.customerName : null,
    customerEmail: typeof order.customerEmail === 'string' ? order.customerEmail : null,
    lines: lines.map((line) => ({
      name: String(line['name'] ?? 'Item'),
      variantLabel: typeof line['variantLabel'] === 'string' ? (line['variantLabel'] as string) : null,
      sku: typeof line['sku'] === 'string' ? (line['sku'] as string) : null,
      quantity: Number(line['quantity'] ?? 0),
      unitAmountCents: toCents(line['unitAmountCents']),
    })),
    totals: {
      itemsCents: toCents(totals.itemsCents),
      shippingCents: toCents(totals.shippingCents),
      taxCents: taxCents - marketplaceTaxCents,
      discountCents: toCents(totals.discountCents),
      totalCents: Math.max(0, toCents(totals.totalCents) - marketplaceTaxCents),
      feeCents: toCents(totals.feeCents),
    },
    // Storefront prices are tax-exclusive: the tax is added at checkout.
    taxInclusive: false,
    taxKey: null,
    ...(marketplaceTaxCents > 0 ? { marketplaceTaxCents } : {}),
  }
}

/**
 * The part of a refund that comes out of the merchant's account. A refund
 * gives the buyer back their tax too; on a Stripe Tax sale that share is
 * Aglyn's, reversed from Aglyn's balance, so the merchant's refund is the
 * amount in proportion to what the sale paid them (`totals.totalCents`, the
 * tax already taken out).
 */
export function merchantShareOfRefund(order: AccountingOrderSnapshot, amountCents: number): number {
  const amount = toCents(amountCents)
  const marketplaceTax = toCents(order.marketplaceTaxCents)
  if (marketplaceTax <= 0 || amount <= 0) return amount
  const merchantTotal = toCents(order.totals.totalCents)
  const paid = merchantTotal + marketplaceTax
  return Math.min(merchantTotal, Math.round((amount * merchantTotal) / paid))
}

/**
 * The platform fee a refund gave back. Every storefront refund is made with
 * `refund_application_fee`, so Stripe returns the fee in proportion to the
 * amount refunded.
 */
export function feeRefundedFor(order: AccountingOrderSnapshot, amountCents: number): number {
  const total = toCents(order.totals.totalCents)
  const fee = toCents(order.totals.feeCents)
  if (total <= 0 || fee <= 0 || amountCents <= 0) return 0
  return Math.min(fee, Math.round((fee * amountCents) / total))
}

// ── Queueing ──────────────────────────────────────────────────────────────

/**
 * A paid order: its sale (and fee) are queued — unless the workspace has no
 * connection, or the sale is before the start date the mapping names.
 */
export async function enqueueOrderPaid(deps: AccountingIntakeDeps, order: AccountingOrderSnapshot): Promise<number> {
  const firestore = deps.firestore()
  const connection = await readOrgMapping(firestore, order.orgId)
  if (!connection) return 0
  if (beforeStartDate(order.paidAtMs, connection.mapping)) return 0
  return createSyncItems(firestore, order.orgId, itemsForPaidOrder(order, connection.mapping, deps.now()))
}

/** A refund: queued behind its sale. One whose sale is before the start date is not. */
export async function enqueueOrderRefunded(
  deps: AccountingIntakeDeps,
  refund: AccountingRefundSnapshot,
): Promise<number> {
  const firestore = deps.firestore()
  const connection = await readOrgMapping(firestore, refund.order.orgId)
  if (!connection) return 0
  const items = syncItemsCollection(firestore, refund.order.orgId)
  const sale = await items.doc(saleItemId(refund.order)).get()
  if (!sale.exists) {
    // A sale before the start date belongs to books that already hold it,
    // and so does its refund.
    if (beforeStartDate(refund.order.paidAtMs, connection.mapping)) return 0
    // A sale that never arrived: queue it now, from the refund's own copy.
    await enqueueOrderPaid(deps, refund.order)
  }
  // A backfilled refund already counts every refund up to its own time.
  const backfilled = await items.doc(syncItemId('refund', refund.order.hostId, `backfill-${refund.order.orderId}`)).get()
  if (backfilled.exists && Number(backfilled.get('coversUntilMs') ?? 0) >= refund.refundedAtMs) return 0
  return createSyncItems(firestore, refund.order.orgId, itemsForRefund(refund, connection.mapping, deps.now()))
}

/**
 * A cancelled order. Money that moved is reversed by its refund, which
 * arrives as its own event; what a cancel changes here is a sale that has not
 * posted yet, which is skipped rather than posted and then reversed.
 */
export async function enqueueOrderCancelled(
  deps: AccountingIntakeDeps,
  order: Pick<AccountingOrderSnapshot, 'orgId' | 'hostId' | 'orderId'>,
): Promise<boolean> {
  const firestore = deps.firestore()
  const ref = syncItemsCollection(firestore, order.orgId).doc(saleItemId(order))
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const item = readSyncItem(ref.id, snapshot.exists ? snapshot.data() : undefined)
    if (!item || item.status !== 'pending' || item.summaryItemId) return false
    transaction.update(ref, {
      status: 'skipped',
      lastError: 'The order was cancelled before it was posted.',
      updatedAtMs: deps.now(),
    })
    return true
  })
}

/** A payout that landed: one transfer from clearing to the bank. */
export async function enqueuePayout(deps: AccountingIntakeDeps, payout: AccountingPayoutSnapshot): Promise<number> {
  const firestore = deps.firestore()
  const connection = await readOrgMapping(firestore, payout.orgId)
  if (!connection) return 0
  if (beforeStartDate(payout.arrivedAtMs, connection.mapping)) return 0
  return createSyncItems(firestore, payout.orgId, [itemForPayout(payout, deps.now())])
}

// ── The event subscribers ─────────────────────────────────────────────────

/** `order.paid` → its sale and fee, queued. */
export async function onOrderPaid(
  deps: AccountingIntakeDeps,
  envelope: AccountingEventEnvelope<CommerceOrderEventPayload>,
): Promise<number> {
  const order = envelope.payload?.order
  if (!order?.id) return 0
  const firestore = deps.firestore()
  const orgId = await orgOfHost(firestore, envelope.hostId, envelope.orgId)
  if (!orgId) return 0
  const snapshot = snapshotFromOrderEvent(order, { orgId, hostId: envelope.hostId, occurredAtMs: envelope.occurredAtMs })
  if (snapshot.totals.totalCents <= 0) return 0
  return enqueueOrderPaid(deps, snapshot)
}

/** `order.refunded` → the refund and the fee it gave back, queued behind the sale. */
export async function onOrderRefunded(
  deps: AccountingIntakeDeps,
  envelope: AccountingEventEnvelope<CommerceOrderRefundedEventPayload>,
): Promise<number> {
  const order = envelope.payload?.order
  const refund = envelope.payload?.refund
  const amountCents = toCents(refund?.amountCents)
  if (!order?.id || amountCents <= 0) return 0
  const firestore = deps.firestore()
  const orgId = await orgOfHost(firestore, envelope.hostId, envelope.orgId)
  if (!orgId) return 0
  // The sale's own snapshot when it was queued, so the refund reverses the
  // sale as it was posted; the event's copy of the order otherwise.
  const sale = await syncItemsCollection(firestore, orgId).doc(saleItemId({ hostId: envelope.hostId, orderId: order.id })).get()
  const fromSale = sale.exists ? (sale.get('order') as AccountingOrderSnapshot | undefined) : undefined
  const snapshot =
    fromSale ?? snapshotFromOrderEvent(order, { orgId, hostId: envelope.hostId, occurredAtMs: envelope.occurredAtMs })
  const merchantCents = merchantShareOfRefund(snapshot, amountCents)
  if (merchantCents <= 0) return 0
  return enqueueOrderRefunded(deps, {
    order: snapshot,
    // Stripe's refund id; the envelope's id, stable across redeliveries, for one without.
    refundId: refund?.id ? String(refund.id) : envelope.id,
    amountCents: merchantCents,
    refundedAtMs: envelope.occurredAtMs,
    feeRefundedCents: feeRefundedFor(snapshot, merchantCents),
  })
}

/** `order.cancelled` → a sale not yet posted is skipped. */
export async function onOrderCancelled(
  deps: AccountingIntakeDeps,
  envelope: AccountingEventEnvelope<CommerceOrderEventPayload>,
): Promise<boolean> {
  const order = envelope.payload?.order
  if (!order?.id) return false
  const firestore = deps.firestore()
  const orgId = await orgOfHost(firestore, envelope.hostId, envelope.orgId)
  if (!orgId) return false
  return enqueueOrderCancelled(deps, { orgId, hostId: envelope.hostId, orderId: order.id })
}
