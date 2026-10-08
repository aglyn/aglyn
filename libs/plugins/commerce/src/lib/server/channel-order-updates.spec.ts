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

import type { PluginChannelOrder } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { MemoryFirestore } from '../testing/memory-firestore'

const notices: Array<{ hostId: string; type: string; title: string; body: string }> = []
let store = new MemoryFirestore()

jest.mock('@aglyn/tenant-data-admin', () => ({
  notifyHostManagers: async (hostId: string, notice: any) => void notices.push({ hostId, ...notice }),
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => store }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } },
  },
}))
jest.mock('./low-stock', () => ({ alertLowStockCrossing: () => undefined }))
// Each event is staged into the transaction that writes its fact; recorded here as a document of its own.
jest.mock('./order-events', () => ({
  fulfillmentEventView: (_order: unknown, fulfillment: any) => ({ id: fulfillment.id, carrier: fulfillment.carrier ?? null }),
  stageOrderEvent: (writer: any, event: { id: string }, request: any) =>
    writer.set(store.collection('events').doc(`${request.orderId}:${request.key}`), {
      event: event.id,
      orderStatus: request.order.status,
      ...(request.extra ?? {}),
    }),
}))

import { cancelChannelOrder, channelOrderDocId, importChannelOrder } from './channel-orders'
import { completeChannelOrder, recordChannelOrderRefund } from './channel-order-updates'

const HOST = 'host1'
const NOW = 1_800_000_000_000
const deps = () => ({ firestore: () => store as never, now: () => NOW })
const ID = channelOrderDocId('doordash', 'dd-1')

function seed() {
  store = new MemoryFirestore()
  store.write(`hosts/${HOST}/settings/store`, { currency: 'USD' })
  store.write(`hosts/${HOST}/counters/orders`, { next: 7 })
  store.write(`hosts/${HOST}/products/burger`, {
    name: 'Burger',
    status: 'active',
    type: 'physical',
    variants: [{ id: 'default', sku: 'BRG', priceUsd: 12, inventory: 10 }],
  })
  store.write(`hosts/${HOST}/products/fries`, {
    name: 'Fries',
    status: 'active',
    type: 'physical',
    // Not tracked: nothing ever goes back on a shelf that is not counted.
    variants: [{ id: 'default', sku: 'FRY', priceUsd: 4 }],
  })
}

function order(overrides: Partial<PluginChannelOrder> = {}): PluginChannelOrder {
  return {
    hostId: HOST,
    channel: { id: 'doordash', label: 'DoorDash' },
    externalOrderId: 'dd-1',
    externalRef: 'A1B2',
    placedAtMs: NOW - 60_000,
    currency: 'USD',
    lines: [
      { externalLineId: 'l1', sku: null, productId: 'burger', variantId: 'default', name: 'Burger', quantity: 3, unitPriceCents: 1200 },
      { externalLineId: 'l2', sku: null, productId: 'fries', variantId: 'default', name: 'Fries', quantity: 1, unitPriceCents: 400 },
    ],
    shippingCents: 0,
    taxCents: 320,
    discountCents: 0,
    totalCents: 4320,
    fees: null,
    customerName: 'Sam D.',
    shippingAddress: null,
    testMode: false,
    handoff: 'courier',
    ...overrides,
  }
}

const burgerStock = () => (store.read(`hosts/${HOST}/products/burger`)?.['variants'] as any[])[0].inventory
const saved = () => store.read(`hosts/${HOST}/orders/${ID}`) as Record<string, any>
const ledger = () =>
  [...store.docs.entries()].filter(([path]) => path.startsWith(`hosts/${HOST}/inventoryAdjustments/`)).map(([, stored]) => stored.data)
const events = () => [...store.docs.entries()].filter(([path]) => path.startsWith('events/')).map(([, stored]) => stored.data)

beforeEach(async () => {
  notices.length = 0
  seed()
  await importChannelOrder(order(), deps())
})

describe('a courier order comes in (AGL-3644)', () => {
  it('records the hand-off on the order and tells the managers to have it ready, not to ship it', () => {
    expect(saved().channelSource).toMatchObject({ channelId: 'doordash', handoff: 'courier' })
    expect(burgerStock()).toBe(7)
    expect(notices[0].body).toContain('Have it ready for the DoorDash courier.')
    expect(notices[0].body).not.toContain('tracking')
  })
})

describe('completeChannelOrder (AGL-3644)', () => {
  it('fulfills every open unit with the channel as carrier, no tracking and nobody emailed, once', async () => {
    await expect(completeChannelOrder({ hostId: HOST, recordId: ID, note: 'Picked up by the DoorDash courier' }, deps())).resolves.toEqual({
      outcome: 'completed',
    })
    const after = saved()
    expect(after.status).toBe('fulfilled')
    expect(after.fulfillments).toEqual([
      expect.objectContaining({ carrier: 'DoorDash', notify: false, status: 'active', lines: [{ lineItemId: 0, quantity: 3 }, { lineItemId: 1, quantity: 1 }] }),
    ])
    expect(after.fulfillments[0].trackingNumber).toBeUndefined()
    expect(after.timeline.at(-1)).toMatchObject({ event: 'fulfilled', detail: 'Picked up by the DoorDash courier' })
    expect(events().filter((event) => event['event'] === 'order.fulfilled')).toHaveLength(1)

    await expect(completeChannelOrder({ hostId: HOST, recordId: ID, note: 'again' }, deps())).resolves.toEqual({ outcome: 'already' })
    expect(saved().fulfillments).toHaveLength(1)
  })

  it('refuses an order the channel cancelled, and one it never sent', async () => {
    await cancelChannelOrder({ hostId: HOST, recordId: ID, reason: 'Canceled on DoorDash' }, deps())
    await expect(completeChannelOrder({ hostId: HOST, recordId: ID, note: '' }, deps())).resolves.toEqual({
      outcome: 'not_completable',
      status: 'cancelled',
    })
    store.write(`hosts/${HOST}/orders/web-1`, { status: 'paid', channel: 'online', lineItems: [{ productId: 'burger', quantity: 1, unitAmountCents: 1200, name: 'Burger' }] })
    await expect(completeChannelOrder({ hostId: HOST, recordId: 'web-1', note: '' }, deps())).resolves.toEqual({
      outcome: 'not_completable',
      status: 'paid',
    })
    await expect(completeChannelOrder({ hostId: HOST, recordId: 'missing', note: '' }, deps())).resolves.toEqual({ outcome: 'no_such_record' })
    await expect(completeChannelOrder({ hostId: '__bad__', recordId: ID, note: '' }, deps())).resolves.toEqual({ outcome: 'no_such_record' })
  })
})

describe('recordChannelOrderRefund (AGL-3644)', () => {
  it('records an adjustment once: the money on the order, the removed units back on the shelf, the event raised', async () => {
    const request = {
      hostId: HOST,
      recordId: ID,
      refundId: 'adj-1',
      amountCents: 1296,
      reason: 'DoorDash removed 1 Burger',
      restock: [{ lineIndex: 0, quantity: 1 }],
    }
    await expect(recordChannelOrderRefund(request, deps())).resolves.toEqual({ outcome: 'recorded', refundedCents: 1296, restockedUnits: 1 })
    expect(burgerStock()).toBe(8)
    expect(saved()).toMatchObject({ status: 'paid', refundedCents: 1296, channelSource: { refundIds: ['adj-1'] } })
    expect(saved().timeline.at(-1).detail).toBe('DoorDash removed 1 Burger: 12.96 USD refunded by DoorDash. 1 unit returned to stock.')
    expect(ledger().filter((row) => row['reason'] === 'refund')).toEqual([
      expect.objectContaining({ productId: 'burger', variantId: 'default', delta: 1, orderId: ID, source: 'DoorDash' }),
    ])
    expect(events().find((event) => event['event'] === 'order.refunded')).toMatchObject({
      refund: { id: null, amountCents: 1296, lineItemIds: [0], full: false },
    })

    await expect(recordChannelOrderRefund(request, deps())).resolves.toEqual({ outcome: 'already' })
    expect(burgerStock()).toBe(8)
    expect(saved().refundedCents).toBe(1296)
  })

  it('never returns more units than the sale took, across adjustments', async () => {
    await recordChannelOrderRefund({ hostId: HOST, recordId: ID, refundId: 'a', amountCents: 0, reason: 'x', restock: [{ lineIndex: 0, quantity: 2 }] }, deps())
    const second = await recordChannelOrderRefund(
      { hostId: HOST, recordId: ID, refundId: 'b', amountCents: 0, reason: 'y', restock: [{ lineIndex: 0, quantity: 3 }] },
      deps(),
    )
    expect(second).toEqual({ outcome: 'recorded', refundedCents: 0, restockedUnits: 1 })
    expect(burgerStock()).toBe(10)
  })

  it('puts nothing back for an untracked line, and a refund of food already gone moves only money', async () => {
    const outcome = await recordChannelOrderRefund(
      { hostId: HOST, recordId: ID, refundId: 'r1', amountCents: 400, reason: 'Fries were cold', restock: [{ lineIndex: 1, quantity: 1 }] },
      deps(),
    )
    expect(outcome).toEqual({ outcome: 'recorded', refundedCents: 400, restockedUnits: 0 })
    expect(ledger().filter((row) => row['reason'] === 'refund')).toEqual([])
  })

  it('refunds the whole order to refunded, and never records past its total', async () => {
    await completeChannelOrder({ hostId: HOST, recordId: ID, note: '' }, deps())
    await recordChannelOrderRefund({ hostId: HOST, recordId: ID, refundId: 'r1', amountCents: 4000, reason: 'Missing items', restock: [] }, deps())
    const outcome = await recordChannelOrderRefund(
      { hostId: HOST, recordId: ID, refundId: 'r2', amountCents: 1000, reason: 'Late', restock: [] },
      deps(),
    )
    expect(outcome).toEqual({ outcome: 'recorded', refundedCents: 4320, restockedUnits: 0 })
    expect(saved().status).toBe('refunded')
    expect(saved().timeline.at(-1).detail).toContain('6.80 USD more than the order had left was not recorded')
    expect(events().filter((event) => event['event'] === 'order.refunded').map((event) => event['refund'])).toEqual([
      expect.objectContaining({ amountCents: 4000, full: false }),
      expect.objectContaining({ amountCents: 320, full: true }),
    ])
  })

  it('refuses what is not a refund, and an order the channel never sent', async () => {
    await expect(
      recordChannelOrderRefund({ hostId: HOST, recordId: ID, refundId: '', amountCents: 1, reason: '', restock: [] }, deps()),
    ).resolves.toEqual({ outcome: 'refused', reason: 'The refund has no id on its channel.' })
    await expect(
      recordChannelOrderRefund({ hostId: HOST, recordId: ID, refundId: 'x', amountCents: 1.5, reason: '', restock: [] }, deps()),
    ).resolves.toMatchObject({ outcome: 'refused' })
    await expect(
      recordChannelOrderRefund({ hostId: HOST, recordId: ID, refundId: 'x', amountCents: 0, reason: '', restock: [] }, deps()),
    ).resolves.toMatchObject({ outcome: 'refused' })
    store.write(`hosts/${HOST}/orders/web-1`, { status: 'paid', channel: 'online', lineItems: [] })
    await expect(
      recordChannelOrderRefund({ hostId: HOST, recordId: 'web-1', refundId: 'x', amountCents: 100, reason: '', restock: [] }, deps()),
    ).resolves.toEqual({ outcome: 'no_such_record' })
  })
})
