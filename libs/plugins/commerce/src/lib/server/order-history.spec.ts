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

// The reader's Admin SDK handle is never reached by these specs.
jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

import { orderHistoryEntry } from './order-history'

describe('order history entries (AGL-3614)', () => {
  const stored = {
    status: 'fulfilled',
    number: 12,
    createdAtMs: 1_000,
    customerName: 'Ada',
    lineItems: [{ name: 'Mug', quantity: 1, unitAmountCents: 1000 }],
    totals: { itemsCents: 1000, shippingCents: 0, taxCents: 80, discountCents: 0, totalCents: 1080, feeCents: 30 },
    refundedCents: 400,
    taxRateId: 'txr_1',
    timeline: [
      { atMs: 1_000, event: 'paid' },
      { atMs: 5_000, event: 'refund' },
      { atMs: 9_000, event: 'refunded' },
      { atMs: 12_000, event: 'note' },
    ],
  }

  it('hands out the public order view with when it was paid and last refunded', () => {
    const entry = orderHistoryEntry('o-1', stored)
    expect(entry).toMatchObject({
      id: 'o-1',
      createdAtMs: 1_000,
      paidAtMs: 1_000,
      lastRefundAtMs: 9_000,
      taxInclusive: false,
      taxRateId: 'txr_1',
    })
    expect(entry.order).toMatchObject({ id: 'o-1', object: 'order', number: 12, refundedCents: 400 })
    expect(entry.order.totals).toMatchObject({ totalCents: 1080, feeCents: 30 })
  })

  it('says an order was never paid when it is pending, or cancelled with nothing refunded', () => {
    expect(orderHistoryEntry('o-2', { ...stored, status: 'pending' }).paidAtMs).toBeNull()
    expect(orderHistoryEntry('o-3', { ...stored, status: 'cancelled', refundedCents: 0 }).paidAtMs).toBeNull()
    expect(orderHistoryEntry('o-4', { ...stored, status: 'cancelled' }).paidAtMs).toBe(1_000)
  })

  it('has no refund date for an order never refunded', () => {
    expect(orderHistoryEntry('o-5', { ...stored, refundedCents: 0, timeline: [] }).lastRefundAtMs).toBeNull()
  })
})
