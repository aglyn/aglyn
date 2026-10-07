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

import {
  buildMatchLookup,
  type BuildTransferPlanInput,
  type MatchKeySpec,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferChunk,
  type TransferPlan,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoSnapshot,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import * as Aglyn from '@aglyn/aglyn/server'
import type {
  PluginTransferResource,
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin, getOrgForHost, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { normalizeTrackingNumber, parseShippingOrderRef } from '../model/order-shipping-export'
import {
  cancelOrderFulfillment,
  recordOrderShipment,
  updateFulfillmentTracking,
} from '../server/fulfill-order'
import { NOTHING, ROW_BUDGET_MS, firestoreOf, hostRefOf, readerSeesHost, type Firestore } from './server-common'
import {
  TRACKING_DEFAULT_POLICY,
  TRACKING_MATCH_KEYS,
  matchTrackingRows,
  planTrackingRows,
  trackingExportRows,
  trackingMatchValues,
  trackingRecord,
  type StoredTrackingOrder,
  type TrackingPlannedRow,
} from './tracking-transfer'

/*
 * THE TRACKING IMPORT'S SERVER HALF (AGL-3613). The plan is
 * `planTrackingRows`; this module reads the orders it plans against, writes
 * each parcel through the order's own shipment paths and undoes them.
 *
 * - WHO: the site's admins and editors — the roles the console's Fulfill
 *   button has — on a plan that sells. Asked by the plan, the apply and the
 *   undo, each server-side.
 * - HOW: a new parcel through `recordOrderShipment`, keyed by its tracking
 *   number, so a retried chunk or a second import of the same file is one
 *   parcel; the buyer is emailed as for any shipment. A replaced tracking
 *   number through `updateFulfillmentTracking`.
 * - UNDO: a parcel this import recorded is cancelled (its units go back to
 *   unfulfilled), and a replaced tracking number is put back — each only
 *   while the shipment still holds what the import wrote; otherwise it is a
 *   conflict the person decides.
 */

const IN_MAX = 30

/** Orders a page of the shipments export reads: those that have shipped something. */
const SHIPPED_STATUSES = ['partially_fulfilled', 'fulfilled', 'delivered']

/** The member importing, checked for the role and the plan, or the refusal. */
async function shipperOf(ctx: TransferResourceContext): Promise<{ hostId: string }> {
  const hostId = ctx.hostId
  if (!hostId) throw new TransferEngineError('invalid', 400, 'Tracking numbers belong to a site; name the site.')
  const uid = ctx.actorUid
  const membership = uid ? await resolveOrgMembership(uid, ctx.orgId) : null
  const role = membership?.member ? hostRoleFor(membership.member, hostId as never) : null
  if (!uid || (role !== 'admin' && role !== 'editor')) {
    throw new TransferEngineError('forbidden', 403, 'Only a site’s admins and editors can record shipments.')
  }
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!Aglyn.checkEntitlement(owner?.org as never, 'commerce')) {
    throw new TransferEngineError('forbidden', 403, 'This site’s plan does not include selling.')
  }
  return { hostId }
}

const ordersOf = (firestore: Firestore, ctx: TransferResourceContext) => hostRefOf(firestore, ctx).collection('orders')

/** Orders by the values a file names them by: numbers through one query per 30, ids directly. */
async function findOrders(
  firestore: Firestore,
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<Map<string, FirebaseFirestore.DocumentSnapshot>> {
  const collection = ordersOf(firestore, ctx)
  const found = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  const numbers = new Set<number>()
  const ids = new Set<string>()
  for (const request of requests) {
    for (const value of request.values) {
      const ref = request.fieldId === 'id' ? { id: value } : parseShippingOrderRef(value)
      if (!ref) continue
      if (ref.number !== undefined) numbers.add(ref.number)
      if (ref.id && !ref.id.includes('/') && !/^__.*__$/.test(ref.id)) ids.add(ref.id)
    }
  }
  const numberList = [...numbers]
  for (let at = 0; at < numberList.length; at += IN_MAX) {
    const snapshot = await collection.where('number', 'in', numberList.slice(at, at + IN_MAX)).get()
    for (const doc of snapshot.docs) found.set(doc.id, doc)
  }
  const idList = [...ids].filter((id) => !found.has(id))
  for (let at = 0; at < idList.length; at += 100) {
    for (const doc of await firestore.getAll(...idList.slice(at, at + 100).map((id) => collection.doc(id)))) {
      if (doc.exists) found.set(doc.id, doc)
    }
  }
  return found
}

export async function lookupTrackingOrders(
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<TransferLookupResult> {
  const found = await findOrders(firestoreOf(), ctx, requests)
  const keys: MatchKeySpec[] = requests.map((request) => ({ fieldId: request.fieldId, normalizer: request.normalizer }))
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  const entries: Array<{ id: string; values: Record<string, unknown> }> = []
  for (const doc of found.values()) {
    const data = (doc.data() ?? {}) as StoredTrackingOrder
    records.set(doc.id, trackingRecord(doc.id, data))
    entries.push({ id: doc.id, values: trackingMatchValues(doc.id, data) })
  }
  return { lookup: buildMatchLookup(entries, keys), records }
}

/**
 * The shipments export: every order that has shipped something, newest
 * first, one row per shipment with a tracking number. The cursor is the last
 * order's `createdAtMs` and id, as the orders export pages.
 */
export async function readTrackingPage(
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options?: TransferReadOptions,
): Promise<TransferReadPage> {
  if (!readerSeesHost(ctx, options)) return NOTHING
  if (options?.filter) throw new Error('Shipments export every shipment, or those of the orders you select.')
  const firestore = firestoreOf()
  const collection = ordersOf(firestore, ctx)
  const pageSize = Math.max(1, Math.min(500, options?.pageSize ?? 200))
  let docs: FirebaseFirestore.DocumentSnapshot[]
  let next: string | null
  if (options?.ids) {
    const offset = cursor ? Number(cursor) : 0
    const ids = options.ids.slice(offset, offset + pageSize)
    docs = ids.length ? (await firestore.getAll(...ids.map((id) => collection.doc(id)))).filter((doc) => doc.exists) : []
    next = offset + ids.length < options.ids.length ? String(offset + ids.length) : null
  } else {
    const query = collection
      .where('status', 'in', SHIPPED_STATUSES)
      .orderBy('createdAtMs', 'desc')
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId(), 'desc')
    const after = cursor ? (JSON.parse(cursor) as unknown[]) : null
    const snapshot = await (after ? query.startAfter(...after) : query).limit(pageSize).get()
    docs = snapshot.docs
    const last = snapshot.docs[snapshot.docs.length - 1]
    next = last && snapshot.docs.length === pageSize ? JSON.stringify([last.get('createdAtMs') ?? null, last.id]) : null
  }
  const rows = docs.flatMap((doc) =>
    trackingExportRows(doc.id, (doc.data() ?? {}) as StoredTrackingOrder).map((record) =>
      Object.fromEntries(fieldIds.map((fieldId) => [fieldId, record[fieldId] ?? null])),
    ),
  )
  return { rows, next }
}

/** The dry run, against every matched order read once. */
export async function planTracking(ctx: TransferResourceContext, input: BuildTransferPlanInput): Promise<TransferPlan> {
  await shipperOf(ctx)
  const firestore = firestoreOf()
  const ids = [
    ...new Set(
      input.matches
        .map((match) => (match.kind === 'matched' ? match.recordId : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const collection = ordersOf(firestore, ctx)
  const orders = new Map<string, StoredTrackingOrder>()
  for (let at = 0; at < ids.length; at += 100) {
    for (const doc of await firestore.getAll(...ids.slice(at, at + 100).map((id) => collection.doc(id)))) {
      if (doc.exists) orders.set(doc.id, (doc.data() ?? {}) as StoredTrackingOrder)
    }
  }
  return planTrackingRows(input, orders)
}

/** Records one chunk's parcels, each through the order's own shipment paths. */
export async function applyTracking(
  ctx: TransferResourceContext,
  chunk: TransferChunk<PlannedTransferRow>,
  writer: TransferApplyWriter,
): Promise<TransferApplyResult> {
  const { hostId } = await shipperOf(ctx)
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []
  const fail = async (row: number, message: string) => {
    const result: TransferRowResult = { row, outcome: 'failed', reason: 'refusedValue', message }
    results.push(result)
    await writer.markApplied(result)
  }
  for (const row of chunk.rows as TrackingPlannedRow[]) {
    const earlier = await writer.alreadyApplied(row.index)
    if (earlier) {
      results.push(earlier)
      continue
    }
    if (writer.timeLeftMs() < ROW_BUDGET_MS) break
    const decision = row.tracking
    if (row.verdict !== 'update' || !decision) {
      await fail(row.index, 'A tracking file only records parcels for orders it names.')
      continue
    }
    if (decision.action === 'ship') {
      const outcome = await recordOrderShipment({
        hostId,
        orderId: decision.orderId,
        to: 'fulfilled',
        carrier: decision.carrier,
        trackingNumber: decision.trackingNumber,
        ...(decision.trackingUrl ? { trackingUrl: decision.trackingUrl } : {}),
        ...(decision.lineItems ? { lineItems: decision.lineItems } : {}),
        idempotencyKey: `tracking-import:${normalizeTrackingNumber(decision.trackingNumber)}`,
        onceByTracking: true,
      })
      if (outcome.outcome === 'recorded' || (outcome.outcome === 'already' && outcome.fulfillment)) {
        const fulfillment = outcome.fulfillment
        const result: TransferRowResult = {
          row: row.index,
          outcome: outcome.outcome === 'recorded' ? 'updated' : 'unchanged',
          recordId: decision.orderId,
        }
        // Only a parcel THIS import recorded is undone; one found already
        // there was somebody else's.
        const entry: TransferUndoEntry | undefined =
          outcome.outcome === 'recorded' && fulfillment
            ? {
                row: row.index,
                recordId: decision.orderId,
                action: 'updated',
                previous: { fulfillmentId: null },
                written: {
                  fulfillmentId: fulfillment.id,
                  trackingNumber: fulfillment.trackingNumber ?? null,
                  carrier: fulfillment.carrier ?? null,
                },
              }
            : undefined
        results.push(result)
        if (entry) undo.push(entry)
        await writer.markApplied(result, entry)
        continue
      }
      await fail(
        row.index,
        outcome.outcome === 'blocked'
          ? `The order is ${outcome.from.replace(/_/g, ' ')} and cannot be shipped.`
          : outcome.outcome === 'invalid_lines'
            ? outcome.message
            : outcome.outcome === 'no_such_order'
              ? 'The order no longer exists.'
              : 'The order has nothing left to ship.',
      )
      continue
    }
    const outcome = await updateFulfillmentTracking({
      hostId,
      orderId: decision.orderId,
      fulfillmentId: decision.fulfillmentId,
      carrier: decision.carrier,
      trackingNumber: decision.trackingNumber,
      ...(decision.trackingUrl ? { trackingUrl: decision.trackingUrl } : {}),
    })
    if (outcome.outcome === 'updated' || outcome.outcome === 'already') {
      const result: TransferRowResult = {
        row: row.index,
        outcome: outcome.outcome === 'updated' ? 'updated' : 'unchanged',
        recordId: decision.orderId,
      }
      const entry: TransferUndoEntry | undefined =
        outcome.outcome === 'updated'
          ? {
              row: row.index,
              recordId: decision.orderId,
              action: 'updated',
              previous: { fulfillmentId: decision.fulfillmentId, ...decision.previous },
              written: {
                fulfillmentId: decision.fulfillmentId,
                trackingNumber: outcome.fulfillment.trackingNumber ?? null,
                carrier: outcome.fulfillment.carrier ?? null,
              },
            }
          : undefined
      results.push(result)
      if (entry) undo.push(entry)
      await writer.markApplied(result, entry)
      continue
    }
    await fail(
      row.index,
      outcome.outcome === 'locked'
        ? `The order is ${outcome.from.replace(/_/g, ' ')}; its shipments can no longer change.`
        : 'The shipment no longer exists.',
    )
  }
  return { results, undo }
}

/**
 * Undoes one chunk, newest first: a parcel the import recorded is cancelled
 * and a tracking number it replaced is put back — while the shipment still
 * holds what the import wrote. A shipment edited since is a conflict, done
 * only when the person's decision says `revert`.
 */
export async function revertTracking(
  ctx: TransferResourceContext,
  snapshot: TransferUndoSnapshot,
  decisions?: TransferRevertDecisions,
): Promise<TransferRevertResult> {
  const { hostId } = await shipperOf(ctx)
  const firestore = firestoreOf()
  const collection = ordersOf(firestore, ctx)
  const done: TransferUndoStep[] = []
  const conflicts: TransferUndoStep[] = []
  for (const entry of [...snapshot.entries].reverse()) {
    const fulfillmentId = String(entry.written['fulfillmentId'] ?? '')
    const doc = await collection.doc(entry.recordId).get()
    const order = doc.exists ? ((doc.data() ?? {}) as Record<string, unknown>) : null
    const current = ((order?.['fulfillments'] as Array<Record<string, unknown>> | undefined) ?? []).find(
      (fulfillment) => fulfillment['id'] === fulfillmentId,
    )
    if (!doc.exists || !current || current['status'] === 'cancelled') {
      done.push({ action: 'nothing', recordId: entry.recordId, why: doc.exists ? 'alreadyReverted' : 'gone' })
      continue
    }
    const edited =
      normalizeTrackingNumber(current['trackingNumber']) !== normalizeTrackingNumber(entry.written['trackingNumber'])
    if (edited && decisions?.[entry.recordId] !== 'revert') {
      conflicts.push({
        action: 'conflict',
        recordId: entry.recordId,
        fields: ['trackingNumber'],
        values: { trackingNumber: current['trackingNumber'] ?? null },
      })
      continue
    }
    const recorded = entry.previous?.['fulfillmentId'] === null
    const outcome = recorded
      ? await cancelOrderFulfillment({ hostId, orderId: entry.recordId, fulfillmentId })
      : await updateFulfillmentTracking({
          hostId,
          orderId: entry.recordId,
          fulfillmentId,
          carrier: String(entry.previous?.['carrier'] ?? ''),
          trackingNumber: String(entry.previous?.['trackingNumber'] ?? ''),
          ...(entry.previous?.['trackingUrl'] ? { trackingUrl: String(entry.previous['trackingUrl']) } : {}),
        })
    if (outcome.outcome === 'locked') {
      conflicts.push({
        action: 'conflict',
        recordId: entry.recordId,
        fields: ['status'],
        values: { status: outcome.from },
      })
      continue
    }
    done.push(
      recorded
        ? { action: 'delete', recordId: entry.recordId }
        : {
            action: 'restore',
            recordId: entry.recordId,
            values: { trackingNumber: entry.previous?.['trackingNumber'] ?? null },
          },
    )
  }
  return { done, conflicts }
}

export const trackingTransfer: PluginTransferResource = {
  matchKeys: TRACKING_MATCH_KEYS,
  defaultPolicy: TRACKING_DEFAULT_POLICY,
  readPage: (ctx, cursor, fieldIds, options) => readTrackingPage(ctx, cursor, fieldIds, options),
  lookup: (ctx, requests) => lookupTrackingOrders(ctx, requests),
  match: (_ctx, input) => ({ outcomes: matchTrackingRows(input.rows, input.lookup) }),
  plan: (ctx, input) => planTracking(ctx, input),
  apply: (ctx, chunk, writer) => applyTracking(ctx, chunk, writer),
  revert: (ctx, snapshot, decisions) => revertTracking(ctx, snapshot, decisions),
}
