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
  buildTransferPlan,
  matchLookupKey,
  normalizeMatchValue,
  resolveFieldPolicy,
  resolveRecordPolicy,
  withTransferResourceFindings,
  type BuildTransferPlanInput,
  type MatchKeySpec,
  type MatchLookup,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferField,
  type TransferFieldChange,
  type TransferPlan,
  type TransferPlanSummary,
  type TransferPolicyDefaults,
  type TransferResourceFinding,
} from '@aglyn/aglyn/data-transfer'
import {
  ORDER_STATUS_LABELS,
  formatOrderNumber,
  liftLegacyOrder,
  type HostOrder,
  type OrderFulfillment,
} from '../model/commerce-orders'
import { fulfillmentIsActive, orderLineFulfillmentStates } from '../model/order-fulfillment'
import {
  fulfillmentWithTracking,
  normalizeTrackingNumber,
  shippingOrderNumber,
  shippingOrderRefs,
} from '../model/order-shipping-export'

/*
 * TRACKING NUMBERS AS A FILE (AGL-3613): what Pirate Ship's shipment export,
 * Shippo's and EasyPost's reports, or any spreadsheet of parcels brings back
 * — an order and the tracking number of the parcel that left for it — made
 * into the order's shipments. Pure; the server half is `tracking.server.ts`.
 *
 * ## A row is a parcel, and a parcel is recorded once
 *
 * Rows are matched to orders by the order number the export wrote (`1042`,
 * `#1042`, or the order's ID). Several rows may name one order — one per
 * parcel — so a row is a duplicate only when it repeats an order AND a
 * tracking number together. A tracking number the order already carries is
 * `unchanged`, so the same file imported twice records nothing twice.
 *
 * ## What a row does to its order
 *
 * - The order still has units to ship: the row SHIPS them, recorded through
 *   the console's own shipment (`recordOrderShipment`) and emailed to the
 *   buyer. A row with a SKU (and a quantity) ships that line; one without
 *   ships everything left.
 * - The order has nothing left to ship: this is the CONFLICT, and the
 *   person decides it on the Conflicts step through the Tracking number
 *   field's choice. Keep existing (the start) leaves the shipment as it is;
 *   Overwrite replaces its tracking; Fill blanks adds tracking only to a
 *   shipment recorded without any.
 * - A pending, cancelled or refunded order is refused, by name.
 *
 * Nothing here creates an order: a row naming no order fails with the
 * number it named.
 */

export const TRACKING_FIELD = {
  orderRef: 'orderRef',
  trackingNumber: 'trackingNumber',
  carrier: 'carrier',
  service: 'service',
  trackingUrl: 'trackingUrl',
  sku: 'sku',
  quantity: 'quantity',
  status: 'status',
  shippedAt: 'shippedAt',
} as const

export const TRACKING_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: TRACKING_FIELD.orderRef,
    label: 'Order',
    group: 'parcel',
    type: 'text',
    required: true,
    matchKey: true,
    description: 'The order number the shipping export wrote (1042 or #1042), or the order’s ID.',
    aliases: [
      'order',
      'order id',
      'order number',
      'order #',
      'order no',
      'order_number',
      'order_id',
      'orderid',
      'reference',
      'reference 1',
      'reference1',
      'ref',
      'external order id',
      'invoice number',
    ],
  },
  {
    id: TRACKING_FIELD.trackingNumber,
    label: 'Tracking number',
    group: 'parcel',
    type: 'text',
    required: true,
    maxLength: 60,
    aliases: ['tracking', 'tracking #', 'tracking no', 'tracking code', 'tracking_code', 'tracking_number', 'tracking id'],
  },
  {
    id: TRACKING_FIELD.carrier,
    label: 'Carrier',
    group: 'parcel',
    type: 'text',
    maxLength: 40,
    aliases: ['provider', 'shipping carrier', 'carrier name'],
  },
  {
    id: TRACKING_FIELD.service,
    label: 'Service',
    group: 'parcel',
    type: 'text',
    description: 'Read for the timeline; the carrier and the number are what the buyer is sent.',
    aliases: ['shipping service', 'service level', 'servicelevel', 'mail class'],
  },
  {
    id: TRACKING_FIELD.trackingUrl,
    label: 'Tracking link',
    group: 'parcel',
    type: 'url',
    description: 'Used instead of the carrier’s own tracking page when given. https only.',
    aliases: ['tracking url', 'tracking_url', 'tracking_url_provider', 'public_url', 'tracking page'],
  },
  {
    id: TRACKING_FIELD.sku,
    label: 'SKU',
    group: 'items',
    type: 'text',
    description: 'Ships only this item of the order. Blank ships everything still to ship.',
    aliases: ['item sku', 'product sku'],
  },
  {
    id: TRACKING_FIELD.quantity,
    label: 'Quantity',
    group: 'items',
    type: 'integer',
    description: 'How many of the SKU’s units this parcel holds. Blank ships every unit left.',
    aliases: ['qty', 'item quantity', 'units'],
  },
  { id: TRACKING_FIELD.status, label: 'Order status', group: 'order', type: 'text', readOnly: true },
  { id: TRACKING_FIELD.shippedAt, label: 'Shipped', group: 'order', type: 'datetime', readOnly: true },
]

export const TRACKING_TRANSFER_GROUPS = [
  { id: 'parcel', label: 'Parcel' },
  { id: 'items', label: 'Items' },
  { id: 'order', label: 'Order' },
]

export const TRACKING_MATCH_KEYS: readonly MatchKeySpec[] = [{ fieldId: TRACKING_FIELD.orderRef, normalizer: 'trim' }]

/**
 * Where the Conflicts step starts: a matched order is updated (shipped), a
 * row naming no order is never made into one, and a tracking number an
 * already-shipped order holds is KEPT until the person chooses otherwise.
 */
export const TRACKING_DEFAULT_POLICY: TransferPolicyDefaults = {
  record: { onMatch: 'update', onNew: 'skip', onAmbiguous: 'ask' },
  fields: { [TRACKING_FIELD.trackingNumber]: { mode: 'keepExisting', blank: 'leave' } },
  note:
    'A row ships what its order still has to ship. For an order that has already shipped, choose ' +
    'Overwrite for Tracking number to replace its tracking, or keep what it has.',
}

/** What `apply` does for one planned row. */
export type TrackingDecision =
  | {
      action: 'ship'
      orderId: string
      carrier: string
      trackingNumber: string
      trackingUrl?: string
      /** Absent ships everything still to ship. */
      lineItems?: Array<{ lineItemId: number; quantity: number }>
    }
  | {
      action: 'replace'
      orderId: string
      fulfillmentId: string
      carrier: string
      trackingNumber: string
      trackingUrl?: string
      previous: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null }
    }

/** A planned row with what it will do to its order. */
export type TrackingPlannedRow = PlannedTransferRow & { tracking?: TrackingDecision }

/** An order as the plan and the records read it. */
export type StoredTrackingOrder = Partial<HostOrder> & { createdAtMs?: number }

const iso = (ms: unknown): string | null => {
  const value = Number(ms)
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null
}

const cell = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

/** The order's latest active shipment, the one a replacement tracking number lands on. */
export function latestShipment(order: Pick<HostOrder, 'fulfillments'>): OrderFulfillment | undefined {
  return (order.fulfillments ?? [])
    .filter((entry) => fulfillmentIsActive(entry))
    .reduce<OrderFulfillment | undefined>((latest, entry) => (!latest || entry.atMs >= latest.atMs ? entry : latest), undefined)
}

const unitsLeft = (order: Pick<HostOrder, 'lineItems' | 'fulfillments'>): number =>
  orderLineFulfillmentStates(order)
    .filter((state) => state.requiresShipping)
    .reduce((sum, state) => sum + state.remainingQuantity, 0)

/**
 * An order as the import's records name it: its numbers, and the tracking a
 * row would conflict with — the latest shipment's, but only once nothing is
 * left to ship. An order still owed parcels has no "current" tracking: the
 * next row is a new parcel, not a change to an old one.
 */
export function trackingRecord(id: string, stored: StoredTrackingOrder): Record<string, unknown> {
  const order = liftLegacyOrder(stored)
  const open = unitsLeft(order) > 0
  const latest = open ? undefined : latestShipment(order)
  return {
    id,
    orderRef: shippingOrderNumber(order, id),
    trackingNumber: latest?.trackingNumber ?? null,
    carrier: latest?.carrier ?? null,
    trackingUrl: latest?.trackingUrl ?? null,
    service: null,
    sku: null,
    quantity: null,
    status: ORDER_STATUS_LABELS[order.status] ?? order.status,
    shippedAt: iso(latest?.atMs),
  }
}

/** The values an order is found by: `1042`, `#1042` and its ID. */
export function trackingMatchValues(id: string, stored: StoredTrackingOrder): Record<string, unknown> {
  return { id, orderRef: shippingOrderRefs(stored, id) }
}

/** One export row per shipment an order carries, newest last. */
export function trackingExportRows(id: string, stored: StoredTrackingOrder): Array<Record<string, unknown>> {
  const order = liftLegacyOrder(stored)
  return (order.fulfillments ?? [])
    .filter((entry) => fulfillmentIsActive(entry) && entry.trackingNumber)
    .map((entry) => ({
      id,
      orderRef: shippingOrderNumber(order, id),
      trackingNumber: entry.trackingNumber ?? null,
      carrier: entry.carrier ?? null,
      trackingUrl: entry.trackingUrl ?? null,
      service: null,
      sku: null,
      quantity: (entry.lines ?? []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0) || null,
      status: ORDER_STATUS_LABELS[order.status] ?? order.status,
      shippedAt: iso(entry.atMs),
    }))
}

/**
 * Which order each row names, the import's own way: by order number through
 * the lookup, with a duplicate only when a row repeats an EARLIER row's
 * order and tracking number together. The core's rule — any repeated key is
 * a duplicate — would refuse the second parcel of every two-parcel order.
 */
export function matchTrackingRows(
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
  lookup: MatchLookup,
): RowMatchOutcome[] {
  const seen = new Map<string, number>()
  return rows.map((values, index): RowMatchOutcome => {
    const ref = normalizeMatchValue('trim', values[TRACKING_FIELD.orderRef])
    if (!ref) return { kind: 'new' }
    const via = { fieldId: TRACKING_FIELD.orderRef, value: ref }
    const ids = lookup.get(matchLookupKey(TRACKING_FIELD.orderRef, ref)) ?? []
    if (ids.length > 1) return { kind: 'ambiguous', recordIds: [...ids], via }
    if (!ids.length) return { kind: 'new' }
    const parcel = `${ids[0]}\u0000${normalizeTrackingNumber(values[TRACKING_FIELD.trackingNumber])}`
    const first = seen.get(parcel)
    if (first !== undefined && normalizeTrackingNumber(values[TRACKING_FIELD.trackingNumber])) {
      return { kind: 'duplicateInFile', firstRow: first, via }
    }
    seen.set(parcel, index)
    return { kind: 'matched', recordId: ids[0], via }
  })
}

const SHIPPABLE_STATUSES = new Set(['paid', 'partially_fulfilled', 'fulfilled', 'delivered'])

function summaryOf(rows: readonly PlannedTransferRow[]): TransferPlanSummary {
  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return summary
}

function change(fieldId: string, before: unknown, after: unknown): TransferFieldChange {
  return { fieldId, before: before ?? null, after, mode: 'overwrite', source: 'default', rule: 'written' }
}

/**
 * The dry run: the core's plan for the policy, warnings and acknowledgements,
 * then each matched row decided against its order as the file leaves it —
 * units shipped by an earlier row of the same file are not shipped twice.
 * `orders` holds every matched order, read once.
 */
export function planTrackingRows(
  input: BuildTransferPlanInput,
  orders: ReadonlyMap<string, StoredTrackingOrder>,
): TransferPlan {
  const core = buildTransferPlan(input)
  const field = input.fields.find((entry) => entry.id === TRACKING_FIELD.trackingNumber)
  const valuesByIndex = new Map(input.rows.map((row) => [row.index, row.values]))
  const findings: TransferResourceFinding[] = []
  /** Units left per order and line, as the rows above have left them. */
  const left = new Map<string, Map<number, number>>()
  /** Orders whose last units a row above shipped, by that row. */
  const closedBy = new Map<string, number>()
  /** Shipments a row above already re-tracked. */
  const replaced = new Set<string>()

  const refuse = (row: TrackingPlannedRow, detail: string, fieldId?: string): TrackingPlannedRow => {
    findings.push({ row: row.index, detail, ...(fieldId ? { fieldId } : {}) })
    return { ...row, verdict: 'fail', reason: 'resourceRule', diff: [] }
  }

  const rows = core.rows.map((planned): TrackingPlannedRow => {
    const row: TrackingPlannedRow = { ...planned }
    const values = valuesByIndex.get(row.index) ?? {}
    const ref = cell(values[TRACKING_FIELD.orderRef])
    if (row.match.kind === 'new') {
      return ref
        ? refuse(row, `No order ${ref} on this site. A tracking file records parcels for orders; it never creates one.`, TRACKING_FIELD.orderRef)
        : refuse(row, 'The row names no order.', TRACKING_FIELD.orderRef)
    }
    if (row.match.kind !== 'matched') return row
    if (row.verdict === 'skip' || resolveRecordPolicy(input.policy, row.index).action === 'skip') {
      return { ...row, verdict: 'skip', reason: row.reason ?? 'skippedByChoice', diff: [] }
    }
    const orderId = row.match.recordId
    const stored = orders.get(orderId)
    if (!stored) return { ...row, verdict: 'fail', reason: 'matchedRecordMissing', diff: [] }
    const order = liftLegacyOrder(stored)
    const label = formatOrderNumber(order, orderId)
    const trackingNumber = cell(values[TRACKING_FIELD.trackingNumber]).slice(0, 60)
    if (!trackingNumber) return refuse(row, `No tracking number for order ${label}.`, TRACKING_FIELD.trackingNumber)
    if (!SHIPPABLE_STATUSES.has(order.status)) {
      return refuse(row, `Order ${label} is ${ORDER_STATUS_LABELS[order.status]?.toLowerCase() ?? order.status}; nothing on it ships.`)
    }
    if (fulfillmentWithTracking(order, trackingNumber)) {
      return { ...row, verdict: 'unchanged', diff: [], reason: undefined }
    }
    const carrier = cell(values[TRACKING_FIELD.carrier]).slice(0, 40)
    const trackingUrl = cell(values[TRACKING_FIELD.trackingUrl]) || undefined
    const states = orderLineFulfillmentStates(order)
    const remaining =
      left.get(orderId) ??
      new Map(states.filter((state) => state.requiresShipping).map((state) => [state.lineItemId, state.remainingQuantity]))
    left.set(orderId, remaining)
    const unitsOpen = [...remaining.values()].reduce((sum, units) => sum + units, 0)

    if (unitsOpen > 0) {
      const sku = cell(values[TRACKING_FIELD.sku]).toLowerCase()
      let lineItems: Array<{ lineItemId: number; quantity: number }> | undefined
      if (sku) {
        const lineItemId = (order.lineItems ?? []).findIndex(
          (line, index) => (line.sku ?? '').trim().toLowerCase() === sku && (remaining.get(index) ?? 0) > 0,
        )
        if (lineItemId < 0) return refuse(row, `Order ${label} has no item with SKU ${cell(values[TRACKING_FIELD.sku])} left to ship.`, TRACKING_FIELD.sku)
        const open = remaining.get(lineItemId) ?? 0
        const asked = values[TRACKING_FIELD.quantity]
        const quantity = asked === null || asked === undefined || cell(asked) === '' ? open : Math.floor(Number(asked))
        if (!Number.isInteger(quantity) || quantity <= 0) {
          return refuse(row, `The quantity for order ${label} must be a whole number above zero.`, TRACKING_FIELD.quantity)
        }
        if (quantity > open) {
          return refuse(row, `Order ${label} has only ${open} of SKU ${cell(values[TRACKING_FIELD.sku])} left to ship, not ${quantity}.`, TRACKING_FIELD.quantity)
        }
        lineItems = [{ lineItemId, quantity }]
        remaining.set(lineItemId, open - quantity)
      } else {
        for (const key of remaining.keys()) remaining.set(key, 0)
      }
      if ([...remaining.values()].every((units) => units === 0)) closedBy.set(orderId, row.index)
      return {
        ...row,
        verdict: 'update',
        reason: undefined,
        diff: [change(TRACKING_FIELD.trackingNumber, null, trackingNumber), ...(carrier ? [change(TRACKING_FIELD.carrier, null, carrier)] : [])],
        tracking: {
          action: 'ship',
          orderId,
          carrier,
          trackingNumber,
          ...(trackingUrl ? { trackingUrl } : {}),
          ...(lineItems ? { lineItems } : {}),
        },
      }
    }

    // Nothing left to ship. Shipped by a row ABOVE in this file: that row's
    // parcel took everything, so this one has nothing to hold.
    const closer = closedBy.get(orderId)
    if (closer !== undefined) {
      return refuse(
        row,
        `Row ${closer + 1} already ships everything left on order ${label}. To split an order across parcels, give each parcel’s SKU and Quantity.`,
      )
    }
    const latest = latestShipment(order)
    if (!latest) return refuse(row, `Order ${label} has nothing to ship.`)
    if (replaced.has(latest.id)) {
      return refuse(row, `An earlier row already replaces the tracking on order ${label}.`)
    }
    const mode = field ? resolveFieldPolicy(input.policy, row.index, field).mode : 'keepExisting'
    const hasTracking = Boolean(cell(latest.trackingNumber))
    const writes = mode === 'overwrite' || (mode === 'fillBlanks' && !hasTracking)
    if (!writes) {
      findings.push({
        row: row.index,
        fieldId: TRACKING_FIELD.trackingNumber,
        value: trackingNumber,
        detail: hasTracking
          ? `Order ${label} already shipped with tracking ${latest.trackingNumber}; it is kept. Choose Overwrite for Tracking number to replace it.`
          : `Order ${label} already shipped without tracking; choose Fill blanks or Overwrite for Tracking number to add it.`,
      })
      return { ...row, verdict: 'unchanged', diff: [], reason: undefined }
    }
    replaced.add(latest.id)
    return {
      ...row,
      verdict: 'update',
      reason: undefined,
      diff: [
        { ...change(TRACKING_FIELD.trackingNumber, latest.trackingNumber ?? null, trackingNumber), mode },
        ...(carrier ? [change(TRACKING_FIELD.carrier, latest.carrier ?? null, carrier)] : []),
      ],
      tracking: {
        action: 'replace',
        orderId,
        fulfillmentId: latest.id,
        carrier: carrier || latest.carrier || '',
        trackingNumber,
        ...(trackingUrl ? { trackingUrl } : {}),
        previous: {
          carrier: latest.carrier ?? null,
          trackingNumber: latest.trackingNumber ?? null,
          trackingUrl: latest.trackingUrl ?? null,
        },
      },
    }
  })

  const decided: TransferPlan = { ...core, rows, summary: summaryOf(rows) }
  return withTransferResourceFindings(decided, findings)
}
