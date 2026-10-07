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
 * BACKFILL FROM A START DATE (AGL-3614).
 *
 * Events bring every sale from the moment a ledger is connected. The sales
 * BEFORE that — from the start date the mapping names up to the connection —
 * are read once from the stored orders of the workspace's sites, a page at a
 * time on the console's tick, and queued exactly as an event would have
 * queued them. A sale already queued is left as it is (the item id is the
 * order's), so a backfill over a window the events also reached posts
 * nothing twice.
 *
 * A refund before the backfill ran is read off the order's refunded total:
 * one refund for all of it, dated at the order's last refund on its
 * timeline. That refund records the moment it was read (`coversUntilMs`),
 * and a refund event for the same order from before that moment is not
 * queued again.
 *
 * The orders are read through commerce's order history service
 * (`commerce.orderHistory`), in the public shape its events carry, never
 * from commerce's storage: this plugin restates the contract by id, and a
 * deployment without commerce's reader leaves the backfill waiting.
 */

import {
  definePluginServiceContract,
  resolvePluginService,
} from '@aglyn/aglyn/plugin-manager/plugin-services'
import { toCents } from '../model/accounting-money'
import type { AccountingOrderSnapshot, AccountingRefundSnapshot } from '../model/accounting-sources'
import { connectionRef, type AccountingConnectionRecord } from './connection-store'
import type { AccountingEngineDeps } from './sync-engine'
import { enqueueOrderPaid } from './sync-engine'
import { feeRefundedFor, merchantShareOfRefund, snapshotFromOrderEvent, type CommerceOrderEventOrder } from './sync-intake'
import { createSyncItems, itemsForRefund, syncItemId } from './sync-store'

/** Where a backfill stands, on the connection document. */
export interface AccountingBackfillState {
  fromMs: number
  /** Orders created at or after this were reached by events. */
  untilMs: number
  hostIds: string[]
  hostIndex: number
  cursorMs: number
  done: boolean
  queued: number
}

/** Orders read per page. */
const PAGE = 100

/** One order of commerce's history: the fields this plugin reads, restated. */
export interface CommerceOrderHistoryEntry {
  id: string
  createdAtMs: number
  paidAtMs: number | null
  lastRefundAtMs: number | null
  taxInclusive: boolean
  taxRateId: string | null
  order: CommerceOrderEventOrder
}

/** Commerce's order history reader, restated by its contract id. */
export interface CommerceOrderHistoryReader {
  listOrders(request: { hostId: string; fromMs: number; untilMs: number; limit: number }): Promise<CommerceOrderHistoryEntry[]>
}

export const COMMERCE_ORDER_HISTORY = definePluginServiceContract<CommerceOrderHistoryReader>('commerce.orderHistory', {
  multiple: false,
})

/** A history entry → the sync's snapshot, or `null` for one that was never paid. */
export function snapshotFromHistoryEntry(
  orgId: string,
  hostId: string,
  entry: CommerceOrderHistoryEntry,
): AccountingOrderSnapshot | null {
  if (entry.paidAtMs === null || !entry.order?.id) return null
  const snapshot = snapshotFromOrderEvent(entry.order, { orgId, hostId, occurredAtMs: entry.paidAtMs })
  if (snapshot.totals.totalCents <= 0) return null
  return { ...snapshot, taxInclusive: entry.taxInclusive === true, taxKey: entry.taxRateId ?? null }
}

/** The refund a backfilled order already carries, or `null`. */
export function backfillRefund(
  order: AccountingOrderSnapshot,
  entry: Pick<CommerceOrderHistoryEntry, 'order' | 'lastRefundAtMs'>,
  nowMs: number,
): (AccountingRefundSnapshot & { coversUntilMs: number }) | null {
  // What came back to the buyer, less a Stripe Tax sale's tax, which was Aglyn's.
  const refunded = Math.min(merchantShareOfRefund(order, toCents(entry.order?.refundedCents)), order.totals.totalCents)
  if (refunded <= 0) return null
  return {
    order,
    refundId: `backfill-${order.orderId}`,
    amountCents: refunded,
    refundedAtMs: entry.lastRefundAtMs ?? order.paidAtMs,
    // Every refund gives the platform fee back in proportion (`refund_application_fee`).
    feeRefundedCents: feeRefundedFor(order, refunded),
    coversUntilMs: nowMs,
  }
}

/** Starts (or restarts) a backfill from `fromMs` up to the connection. */
export async function startBackfill(
  firestore: FirebaseFirestore.Firestore,
  connection: AccountingConnectionRecord,
  fromMs: number,
): Promise<AccountingBackfillState> {
  const hosts = await firestore.collection('hosts').where('orgId', '==', connection.orgId).get()
  const state: AccountingBackfillState = {
    fromMs,
    untilMs: connection.connectedAtMs,
    hostIds: hosts.docs.map((doc) => doc.id).sort(),
    hostIndex: 0,
    cursorMs: fromMs,
    done: fromMs >= connection.connectedAtMs,
    queued: 0,
  }
  await connectionRef(firestore, connection.orgId, connection.provider).update({ backfill: state })
  return state
}

/** One page of a backfill; answers how many items it queued. */
export async function runBackfillStep(
  deps: AccountingEngineDeps,
  connection: AccountingConnectionRecord & { backfill?: AccountingBackfillState },
): Promise<number> {
  const state = connection.backfill
  if (!state || state.done) return 0
  const firestore = deps.firestore()
  const hostId = state.hostIds[state.hostIndex]
  const ref = connectionRef(firestore, connection.orgId, connection.provider)
  if (!hostId) {
    await ref.update({ 'backfill.done': true })
    return 0
  }
  const reader = resolvePluginService(COMMERCE_ORDER_HISTORY)
  // Commerce's reader is registered by its console declarations; until it
  // is, the backfill waits where it stands.
  if (!reader) return 0
  const page = await reader.listOrders({ hostId, fromMs: state.cursorMs, untilMs: state.untilMs, limit: PAGE })
  let queued = 0
  for (const entry of page) {
    const order = snapshotFromHistoryEntry(connection.orgId, hostId, entry)
    if (!order) continue
    queued += await enqueueOrderPaid(deps, order)
    const refund = backfillRefund(order, entry, deps.now())
    if (refund) {
      const items = itemsForRefund(refund, connection.mapping, deps.now()).map((item) =>
        item.kind === 'refund' ? { ...item, id: syncItemId('refund', hostId, refund.refundId), coversUntilMs: refund.coversUntilMs } : item,
      )
      queued += await createSyncItems(firestore, connection.orgId, items)
    }
  }
  const last = page[page.length - 1]
  const lastMs = last ? Number(last.createdAtMs) : state.cursorMs
  let next: Partial<AccountingBackfillState>
  if (page.length < PAGE) {
    next = { hostIndex: state.hostIndex + 1, cursorMs: state.fromMs, done: state.hostIndex + 1 >= state.hostIds.length }
  } else {
    // A full page all at one instant would read itself forever; step past it.
    next = { cursorMs: lastMs > state.cursorMs ? lastMs : state.cursorMs + 1 }
  }
  await ref.update({
    ...Object.fromEntries(Object.entries(next).map(([key, value]) => [`backfill.${key}`, value])),
    'backfill.queued': state.queued + queued,
  })
  return queued
}
