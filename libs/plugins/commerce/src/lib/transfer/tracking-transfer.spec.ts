/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
  createTransferPolicy,
  startingTransferPolicy,
  type TransferPolicy,
} from '@aglyn/aglyn/data-transfer'
import {
  TRACKING_DEFAULT_POLICY,
  TRACKING_MATCH_KEYS,
  TRACKING_TRANSFER_FIELDS,
  matchTrackingRows,
  planTrackingRows,
  trackingExportRows,
  trackingMatchValues,
  trackingRecord,
  type StoredTrackingOrder,
  type TrackingPlannedRow,
} from './tracking-transfer'

/**
 * A file of tracking numbers, planned against its orders (AGL-3613): every
 * row is a parcel, decided against the order as the rows ABOVE it leave it,
 * and the one real conflict — a new number for an order that has already
 * shipped — is the person's to decide through the Tracking number policy.
 */

const tee = { productId: 'tee', variantId: 'm', name: 'Tee', sku: 'TEE-M', quantity: 3, unitAmountCents: 1000, productType: 'physical' }
const mug = { productId: 'mug', name: 'Mug', sku: 'MUG', quantity: 1, unitAmountCents: 1200, productType: 'physical' }

const ORDERS: Record<string, StoredTrackingOrder> = {
  open: { number: 1001, status: 'paid', lineItems: [tee, mug] as never },
  shipped: {
    number: 1002,
    status: 'fulfilled',
    lineItems: [mug] as never,
    fulfillments: [{ id: 'f-shipped', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], carrier: 'USPS', trackingNumber: 'OLD-1', atMs: 5 }],
  },
  untracked: {
    number: 1003,
    status: 'fulfilled',
    lineItems: [mug] as never,
    fulfillments: [{ id: 'f-bare', lineItemIds: [0], atMs: 5 }],
  },
  cancelled: { number: 1004, status: 'cancelled', lineItems: [mug] as never },
}

function plan(rows: Array<Record<string, unknown>>, policy: Partial<TransferPolicy> = {}) {
  const lookup = buildMatchLookup(
    Object.entries(ORDERS).map(([id, order]) => ({ id, values: trackingMatchValues(id, order) })),
    TRACKING_MATCH_KEYS,
  )
  const matches = matchTrackingRows(rows, lookup)
  const existing = new Map(Object.entries(ORDERS).map(([id, order]) => [id, trackingRecord(id, order)]))
  const result = planTrackingRows(
    {
      fields: TRACKING_TRANSFER_FIELDS,
      rows: rows.map((values, index) => ({ index, values })),
      matches,
      existing,
      policy: createTransferPolicy({ ...startingTransferPolicy(TRACKING_DEFAULT_POLICY), ...policy }),
    },
    new Map(Object.entries(ORDERS)),
  )
  return { ...result, rows: result.rows as TrackingPlannedRow[] }
}

describe('matching rows to orders', () => {
  it('finds an order by 1001, #1001 or its id, and lets one order take several parcels', () => {
    const lookup = buildMatchLookup(
      Object.entries(ORDERS).map(([id, order]) => ({ id, values: trackingMatchValues(id, order) })),
      TRACKING_MATCH_KEYS,
    )
    const outcomes = matchTrackingRows(
      [
        { orderRef: '1001', trackingNumber: 'A' },
        { orderRef: '#1001', trackingNumber: 'B' },
        { orderRef: 'open', trackingNumber: 'C' },
        { orderRef: '1001', trackingNumber: 'a' },
        { orderRef: '9999', trackingNumber: 'D' },
      ],
      lookup,
    )
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['matched', 'matched', 'matched', 'duplicateInFile', 'new'])
  })
})

describe('the plan', () => {
  it('ships what an open order still owes, and the next row of the same order ships the rest', () => {
    const { rows, summary } = plan([
      { orderRef: '1001', trackingNumber: 'P1', carrier: 'USPS', sku: 'TEE-M', quantity: 2 },
      { orderRef: '1001', trackingNumber: 'P2', carrier: 'UPS' },
    ])
    expect(rows[0]).toMatchObject({
      verdict: 'update',
      tracking: { action: 'ship', orderId: 'open', trackingNumber: 'P1', carrier: 'USPS', lineItems: [{ lineItemId: 0, quantity: 2 }] },
    })
    expect(rows[1]).toMatchObject({ verdict: 'update', tracking: { action: 'ship', orderId: 'open', trackingNumber: 'P2' } })
    expect(rows[1].tracking && 'lineItems' in rows[1].tracking ? rows[1].tracking.lineItems : undefined).toBeUndefined()
    expect(summary).toMatchObject({ update: 2, fail: 0, total: 2 })
  })

  it('refuses a second parcel when the row above already shipped everything', () => {
    const { rows } = plan([
      { orderRef: '1001', trackingNumber: 'P1' },
      { orderRef: '1001', trackingNumber: 'P2' },
    ])
    expect(rows[0].verdict).toBe('update')
    expect(rows[1]).toMatchObject({ verdict: 'fail', reason: 'resourceRule' })
  })

  it('records nothing for a tracking number the order already carries', () => {
    const { rows } = plan([{ orderRef: '1002', trackingNumber: 'old-1' }])
    expect(rows[0]).toMatchObject({ verdict: 'unchanged' })
    expect(rows[0].tracking).toBeUndefined()
  })

  it('keeps a shipped order’s tracking by default, and says how to replace it', () => {
    const { rows, warnings } = plan([{ orderRef: '1002', trackingNumber: 'NEW-1' }])
    expect(rows[0]).toMatchObject({ verdict: 'unchanged' })
    const rule = warnings.find((entry) => entry.class === 'resourceRule')
    expect(rule?.samples[0]?.detail).toMatch(/OLD-1.*Overwrite/)
  })

  it('replaces a shipped order’s tracking when the person chooses Overwrite', () => {
    const { rows } = plan([{ orderRef: '1002', trackingNumber: 'NEW-1', carrier: 'UPS' }], {
      fields: { trackingNumber: { mode: 'overwrite' } },
    })
    expect(rows[0]).toMatchObject({
      verdict: 'update',
      tracking: {
        action: 'replace',
        fulfillmentId: 'f-shipped',
        trackingNumber: 'NEW-1',
        carrier: 'UPS',
        previous: { carrier: 'USPS', trackingNumber: 'OLD-1', trackingUrl: null },
      },
    })
  })

  it('fills tracking onto a shipment recorded without any, under Fill blanks', () => {
    const { rows } = plan([{ orderRef: '1003', trackingNumber: 'T-9' }], { fields: { trackingNumber: { mode: 'fillBlanks' } } })
    expect(rows[0]).toMatchObject({ verdict: 'update', tracking: { action: 'replace', fulfillmentId: 'f-bare' } })
  })

  it('honors a row the person chose to skip', () => {
    const { rows } = plan([{ orderRef: '1001', trackingNumber: 'P1' }], { rows: { 0: { action: 'skip' } } })
    expect(rows[0]).toMatchObject({ verdict: 'skip' })
  })

  it('fails a row naming no order, a cancelled order, a missing tracking number and an over-quantity', () => {
    const { rows, summary } = plan([
      { orderRef: '9999', trackingNumber: 'X' },
      { orderRef: '1004', trackingNumber: 'X' },
      { orderRef: '1001', trackingNumber: '' },
      { orderRef: '1001', trackingNumber: 'Y', sku: 'TEE-M', quantity: 4 },
      { orderRef: '1001', trackingNumber: 'Z', sku: 'NOPE' },
    ])
    expect(rows.map((row) => row.verdict)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail'])
    expect(summary).toMatchObject({ fail: 5, update: 0 })
  })
})

describe('the export', () => {
  it('writes one row per shipment that carries a tracking number', () => {
    expect(trackingExportRows('shipped', ORDERS['shipped'])).toEqual([
      expect.objectContaining({ orderRef: '1002', trackingNumber: 'OLD-1', carrier: 'USPS', quantity: 1 }),
    ])
    expect(trackingExportRows('untracked', ORDERS['untracked'])).toEqual([])
  })

  it('shows no current tracking for an order still owed parcels', () => {
    expect(trackingRecord('open', ORDERS['open'])).toMatchObject({ trackingNumber: null, orderRef: '1001' })
    expect(trackingRecord('shipped', ORDERS['shipped'])).toMatchObject({ trackingNumber: 'OLD-1' })
  })
})
