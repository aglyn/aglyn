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
 * THE SYNC LOG, WHICH IS ALSO THE EXTERNAL-ID MAP (AGL-3614).
 *
 * `orgs/{orgId}/accountingSyncItems/{itemId}`: one document per thing that
 * becomes a ledger document — a sale, its fee, a refund, a fee given back,
 * a payout, a day's summary. The id is derived from the source
 * (`sale_{hostId}_{orderId}`), so an event delivered twice — the event seam
 * delivers at least once — lands on the same document and is queued once.
 * Once posted, the item holds the ledger's id for it (`providerDocId`): that
 * is the `{orderId → providerId}` map, and the reason a re-sync never posts a
 * second copy.
 *
 * Each item carries the snapshot it posts, so a retry posts exactly what the
 * first attempt tried to.
 *
 * Indexes: `(status, nextAttemptAtMs)` for the queue, `(status, updatedAtMs)`
 * for the "needs attention" list, `(mode, status, summaryDate)` for the daily
 * summary — all in `cloud/firestore.indexes.json`.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  dateInZone,
  formatMoney,
  normalizeCurrency,
  toCents,
} from '../model/accounting-money'
import type {
  AccountingOrderSnapshot,
  AccountingPayoutSnapshot,
  AccountingRefundSnapshot,
} from '../model/accounting-sources'
import {
  feeExternalId,
  feeRefundExternalId,
  orderExternalId,
  orderLabel,
  payoutExternalId,
  refundExternalId,
} from '../model/accounting-transforms'
import {
  ACCOUNTING_SYNC_ITEMS_COLLECTION,
  type AccountingMapping,
  type AccountingProviderId,
  type AccountingSyncItemView,
  type AccountingSyncKind,
  type AccountingSyncStatus,
} from '../model/accounting.types'
import type { AccountingPosting } from '../model/accounting-transforms'

/** The stored item. Server-only: the snapshot never reaches a client. */
export interface AccountingSyncItemRecord {
  id: string
  orgId: string
  kind: AccountingSyncKind
  /** `per-order` items post one by one; `summary` items wait for their day's journal. */
  mode: 'per-order' | 'summary'
  sourceId: string
  externalId: string
  label: string
  status: AccountingSyncStatus
  attempts: number
  /** Bumped by a person's retry, so a fresh idempotency key is used. */
  generation: number
  nextAttemptAtMs: number
  lastError: string | null
  errorCode: string | null
  provider: AccountingProviderId | null
  providerDocId: string | null
  providerDocType: string | null
  amountCents: number
  currency: string
  occurredAtMs: number
  /** `YYYY-MM-DD` in the mapping's zone, for a summary-mode item. */
  summaryDate: string | null
  /** The summary item a summary-mode member was gathered into. */
  summaryItemId: string | null
  /** For a sale or refund: the sale item it depends on. */
  dependsOn: string | null
  order?: AccountingOrderSnapshot
  refund?: AccountingRefundSnapshot
  payout?: AccountingPayoutSnapshot
  summary?: { date: string; currency: string; postings: AccountingPosting[]; memberIds: string[]; orderCount: number }
  /** A backfilled refund: the refunds it already counts happened before this. */
  coversUntilMs?: number
  createdAtMs: number
  updatedAtMs: number
  syncedAtMs: number | null
}

export function syncItemsCollection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return firestore.collection('orgs').doc(orgId).collection(ACCOUNTING_SYNC_ITEMS_COLLECTION)
}

/** A Firestore-safe document id from its parts. */
export function syncItemId(kind: AccountingSyncKind, ...parts: string[]): string {
  return [kind, ...parts.map((part) => String(part ?? '').replace(/[^A-Za-z0-9_-]/g, '-'))].join('_').slice(0, 1400)
}

export const saleItemId = (order: Pick<AccountingOrderSnapshot, 'hostId' | 'orderId'>) =>
  syncItemId('sale', order.hostId, order.orderId)
export const feeItemId = (order: Pick<AccountingOrderSnapshot, 'hostId' | 'orderId'>) =>
  syncItemId('fee', order.hostId, order.orderId)
export const refundItemId = (refund: AccountingRefundSnapshot) =>
  syncItemId('refund', refund.order.hostId, refund.refundId)
export const feeRefundItemId = (refund: AccountingRefundSnapshot) =>
  syncItemId('fee-refund', refund.order.hostId, refund.refundId)
export const payoutItemId = (payout: Pick<AccountingPayoutSnapshot, 'payoutId'>) => syncItemId('payout', payout.payoutId)

/** A row as the console page reads it. */
export function toSyncItemView(record: AccountingSyncItemRecord): AccountingSyncItemView {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    externalId: record.externalId,
    status: record.status,
    attempts: record.attempts,
    nextAttemptAtMs:
      record.status === 'pending' && record.nextAttemptAtMs < SUMMARY_MEMBER_NEVER_DUE ? record.nextAttemptAtMs : null,
    lastError: record.lastError,
    providerDocId: record.providerDocId,
    amountCents: record.amountCents,
    currency: record.currency,
    occurredAtMs: record.occurredAtMs,
    updatedAtMs: record.updatedAtMs,
  }
}

/** The `nextAttemptAtMs` of an item only a daily journal posts. */
export const SUMMARY_MEMBER_NEVER_DUE = Number.MAX_SAFE_INTEGER

function baseItem(input: {
  id: string
  orgId: string
  kind: AccountingSyncKind
  mode: AccountingSyncItemRecord['mode']
  sourceId: string
  externalId: string
  label: string
  amountCents: number
  currency: string
  occurredAtMs: number
  summaryDate: string | null
  dependsOn: string | null
  nowMs: number
}): AccountingSyncItemRecord {
  return {
    id: input.id,
    orgId: input.orgId,
    kind: input.kind,
    mode: input.mode,
    sourceId: input.sourceId,
    externalId: input.externalId,
    label: input.label,
    status: 'pending',
    attempts: 0,
    generation: 0,
    // A summary-mode sale or refund never comes due on its own: its day's
    // journal posts it. Far in the future keeps it out of the queue's query.
    nextAttemptAtMs: input.mode === 'summary' && input.kind !== 'summary' ? SUMMARY_MEMBER_NEVER_DUE : input.nowMs,
    lastError: null,
    errorCode: null,
    provider: null,
    providerDocId: null,
    providerDocType: null,
    amountCents: input.amountCents,
    currency: normalizeCurrency(input.currency),
    occurredAtMs: input.occurredAtMs,
    summaryDate: input.summaryDate,
    summaryItemId: null,
    dependsOn: input.dependsOn,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    syncedAtMs: null,
  }
}

/** Whether `ms` falls before the mapping's start date, in its zone. */
export function beforeStartDate(ms: number, mapping: AccountingMapping): boolean {
  return Boolean(mapping.startDate) && dateInZone(ms, mapping.timeZone) < String(mapping.startDate)
}

const summaryDateFor = (ms: number, mapping: AccountingMapping) =>
  mapping.syncMode === 'daily-summary' ? dateInZone(ms, mapping.timeZone) : null

/** The items a paid order becomes: its sale, and its fee when it carried one. */
export function itemsForPaidOrder(
  order: AccountingOrderSnapshot,
  mapping: AccountingMapping,
  nowMs: number,
): AccountingSyncItemRecord[] {
  const mode = mapping.syncMode === 'daily-summary' ? 'summary' : 'per-order'
  const summaryDate = summaryDateFor(order.paidAtMs, mapping)
  const sale: AccountingSyncItemRecord = {
    ...baseItem({
      id: saleItemId(order),
      orgId: order.orgId,
      kind: 'sale',
      mode,
      sourceId: order.orderId,
      externalId: orderExternalId(order),
      label: orderLabel(order),
      amountCents: toCents(order.totals.totalCents),
      currency: order.currency,
      occurredAtMs: order.paidAtMs,
      summaryDate,
      dependsOn: null,
      nowMs,
    }),
    order,
  }
  const items = [sale]
  // In a summary the fee is one of the sale's postings, not its own document.
  if (mode === 'per-order' && toCents(order.totals.feeCents) > 0) {
    items.push({
      ...baseItem({
        id: feeItemId(order),
        orgId: order.orgId,
        kind: 'fee',
        mode,
        sourceId: order.orderId,
        externalId: feeExternalId(order),
        label: `${PLATFORM_BRAND_NAME} fee on ${orderLabel(order).toLowerCase()}`,
        amountCents: toCents(order.totals.feeCents),
        currency: order.currency,
        occurredAtMs: order.paidAtMs,
        summaryDate: null,
        dependsOn: null,
        nowMs,
      }),
      order,
    })
  }
  return items
}

/** The items a refund becomes: the refund, and the fee given back when there was one. */
export function itemsForRefund(
  refund: AccountingRefundSnapshot,
  mapping: AccountingMapping,
  nowMs: number,
): AccountingSyncItemRecord[] {
  const mode = mapping.syncMode === 'daily-summary' ? 'summary' : 'per-order'
  const order = refund.order
  const items: AccountingSyncItemRecord[] = [
    {
      ...baseItem({
        id: refundItemId(refund),
        orgId: order.orgId,
        kind: 'refund',
        mode,
        sourceId: refund.refundId,
        externalId: refundExternalId(refund),
        label: `Refund on ${orderLabel(order).toLowerCase()}`,
        amountCents: toCents(refund.amountCents),
        currency: order.currency,
        occurredAtMs: refund.refundedAtMs,
        summaryDate: summaryDateFor(refund.refundedAtMs, mapping),
        dependsOn: saleItemId(order),
        nowMs,
      }),
      refund,
    },
  ]
  if (mode === 'per-order' && toCents(refund.feeRefundedCents) > 0) {
    items.push({
      ...baseItem({
        id: feeRefundItemId(refund),
        orgId: order.orgId,
        kind: 'fee-refund',
        mode,
        sourceId: refund.refundId,
        externalId: feeRefundExternalId(refund),
        label: `${PLATFORM_BRAND_NAME} fee returned on ${orderLabel(order).toLowerCase()}`,
        amountCents: toCents(refund.feeRefundedCents),
        currency: order.currency,
        occurredAtMs: refund.refundedAtMs,
        summaryDate: null,
        dependsOn: saleItemId(order),
        nowMs,
      }),
      refund,
    })
  }
  return items
}

/** The item a payout becomes: one transfer, in either mode. */
export function itemForPayout(payout: AccountingPayoutSnapshot, nowMs: number): AccountingSyncItemRecord {
  return {
    ...baseItem({
      id: payoutItemId(payout),
      orgId: payout.orgId,
      kind: 'payout',
      mode: 'per-order',
      sourceId: payout.payoutId,
      externalId: payoutExternalId(payout),
      label: `Payout of ${formatMoney(payout.amountCents, payout.currency)}`,
      amountCents: toCents(payout.amountCents),
      currency: payout.currency,
      occurredAtMs: payout.arrivedAtMs,
      summaryDate: null,
      dependsOn: null,
      nowMs,
    }),
    payout,
  }
}

/**
 * Writes items that do not exist yet; one that does is left exactly as it
 * is, which is what makes a redelivered event a no-op. Answers how many were
 * new.
 */
export async function createSyncItems(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  items: readonly AccountingSyncItemRecord[],
): Promise<number> {
  let created = 0
  for (const item of items) {
    try {
      await syncItemsCollection(firestore, orgId).doc(item.id).create(item)
      created += 1
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  }
  return created
}

/** Firestore's ALREADY_EXISTS, from the Admin SDK or the emulator. */
export function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS'
}

/** A stored item read defensively. */
export function readSyncItem(id: string, data: Record<string, unknown> | undefined): AccountingSyncItemRecord | null {
  if (!data || typeof data['kind'] !== 'string') return null
  const record = data as unknown as AccountingSyncItemRecord
  return {
    ...record,
    id,
    attempts: Number(record.attempts) || 0,
    generation: Number(record.generation) || 0,
    nextAttemptAtMs: Number(record.nextAttemptAtMs) || 0,
  }
}

/** Every attempt after a failure waits longer: 2, 4, 8 … minutes, at most 12 hours, ±20%. */
export const SYNC_BACKOFF_BASE_MS = 2 * 60 * 1000
export const SYNC_BACKOFF_MAX_MS = 12 * 60 * 60 * 1000
/** After this many failed attempts an item stops retrying and asks a person. */
export const SYNC_MAX_ATTEMPTS = 8

export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempts - 1)
  const base = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** exponent)
  const jitter = 1 + (random() * 0.4 - 0.2)
  return Math.round(Math.min(SYNC_BACKOFF_MAX_MS, base * jitter))
}
