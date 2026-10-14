/**
 * @jest-environment node
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

import { createMemoryMarketplaceStore } from '../testing/memory-store'
import { onOrderFulfilled, onStockMoved } from './intake'
import { emptyConnection, marketplaceOrderDocId, type StoredMarketplaceOrder } from './store'

const HOST = 'host1'
const T0 = 1_800_000_000_000
const deps = (store = createMemoryMarketplaceStore()) => ({ store, now: () => T0 })

const record = (overrides: Partial<StoredMarketplaceOrder> = {}): StoredMarketplaceOrder => ({
  orgId: 'org1',
  hostId: HOST,
  marketplace: 'etsy',
  connectionId: `${HOST}_etsy`,
  externalOrderId: '3311',
  displayRef: '3311',
  recordId: 'rec-1',
  status: 'imported',
  note: null,
  lines: [{ lineIndex: 0, externalLineId: 'T1' }],
  acknowledged: true,
  currency: 'USD',
  fees: null,
  feesFollowUntilMs: 0,
  shipments: {},
  sandbox: false,
  active: false,
  nextRunAtMs: 0,
  leaseUntilMs: 0,
  createdAtMs: T0,
  updatedAtMs: T0,
  ...overrides,
})

const fulfilled = (channel = 'marketplace', recordId = 'rec-1') => ({
  id: 'evt1',
  event: 'order.fulfilled',
  hostId: HOST,
  payload: {
    order: { id: recordId, channel },
    fulfillment: {
      id: 'ful1',
      lines: [{ lineItemId: 0, quantity: 1 }],
      carrier: 'USPS',
      trackingNumber: ' 9400 ',
      trackingUrl: null,
      at: '2026-10-07T12:00:00.000Z',
    },
  },
})

describe('order events (AGL-3638)', () => {
  it('queues a shipment of a marketplace order to confirm, once', async () => {
    const d = deps()
    const id = marketplaceOrderDocId(HOST, 'etsy', '3311')
    await d.store.createOrder(id, record({ shipments: { old: { state: 'confirmed' } as never } }))
    expect(await onOrderFulfilled(d, fulfilled())).toBe('queued')
    const stored = d.store.orders.get(id)!
    expect(stored.shipments['ful1']).toEqual({
      lines: [{ lineIndex: 0, quantity: 1 }],
      carrier: 'USPS',
      trackingNumber: '9400',
      trackingUrl: null,
      shippingCostCents: null,
      atMs: Date.parse('2026-10-07T12:00:00.000Z'),
      state: 'pending',
      message: null,
      attempts: 0,
    })
    expect(stored.shipments['old']).toEqual({ state: 'confirmed' })
    expect(stored).toMatchObject({ active: true, nextRunAtMs: T0 })
    expect(await onOrderFulfilled(d, fulfilled())).toBe('already')
  })

  it('keeps what the shipment’s label cost, in whole cents, to send where a marketplace takes it (AGL-3693)', async () => {
    const d = deps()
    const id = marketplaceOrderDocId(HOST, 'faire', 'bo_1')
    await d.store.createOrder(id, record({ marketplace: 'faire', externalOrderId: 'bo_1' }))
    const event = fulfilled()
    ;(event.payload.fulfillment as Record<string, unknown>).labelCostCents = 845
    expect(await onOrderFulfilled(d, event)).toBe('queued')
    expect(d.store.orders.get(id)!.shipments['ful1'].shippingCostCents).toBe(845)

    const other = marketplaceOrderDocId(HOST, 'faire', 'bo_2')
    await d.store.createOrder(other, record({ marketplace: 'faire', externalOrderId: 'bo_2', recordId: 'rec-2' }))
    const fractional = fulfilled('marketplace', 'rec-2')
    ;(fractional.payload.fulfillment as Record<string, unknown>).labelCostCents = 8.45
    await onOrderFulfilled(d, fractional)
    expect(d.store.orders.get(other)!.shipments['ful1'].shippingCostCents).toBeNull()
  })

  it('keeps a hand-entered shipping cost, free shipping included, for Faire (AGL-3705)', async () => {
    // The console's fulfill dialog stores what the merchant typed in the same
    // field a label's cost goes in, so it arrives here the same way.
    const d = deps()
    const id = marketplaceOrderDocId(HOST, 'faire', 'bo_3')
    await d.store.createOrder(id, record({ marketplace: 'faire', externalOrderId: 'bo_3', recordId: 'rec-3' }))
    const free = fulfilled('marketplace', 'rec-3')
    ;(free.payload.fulfillment as Record<string, unknown>).labelCostCents = 0
    expect(await onOrderFulfilled(d, free)).toBe('queued')
    expect(d.store.orders.get(id)!.shipments['ful1'].shippingCostCents).toBe(0)
  })

  it('ignores an order no marketplace sold', async () => {
    const d = deps()
    expect(await onOrderFulfilled(d, fulfilled('online'))).toBe('ignored')
    expect(await onOrderFulfilled(d, fulfilled('marketplace', 'unknown'))).toBe('ignored')
  })

  it('marks every live connection of the site due when stock moves', async () => {
    const d = deps()
    for (const [marketplace, status, listingMode] of [
      ['ebay', 'active', 'link'],
      ['etsy', 'paused', 'link'],
      ['faire', 'active', 'off'],
    ] as const) {
      await d.store.patchConnection(`${HOST}_${marketplace}`, {
        ...emptyConnection({ orgId: 'org1', hostId: HOST, marketplace, sandbox: false, nowMs: 0 }),
        status,
        settings: { listingMode } as never,
        dueAtMs: T0 + 999,
      })
    }
    await onStockMoved(d, { id: 'e', event: 'order.paid', hostId: HOST, payload: {} })
    expect(d.store.connections.get(`${HOST}_ebay`)).toMatchObject({ listingsDirtyAtMs: T0, dueAtMs: T0 })
    expect(d.store.connections.get(`${HOST}_etsy`)!.dueAtMs).toBe(T0 + 999)
    expect(d.store.connections.get(`${HOST}_faire`)!.dueAtMs).toBe(T0 + 999)
  })
})
