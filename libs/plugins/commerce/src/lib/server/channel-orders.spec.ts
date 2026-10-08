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
const crossings: Array<{ hostId: string }> = []
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
jest.mock('./low-stock', () => ({
  alertLowStockCrossing: (hostId: string) => void crossings.push({ hostId }),
}))
// The event is staged into the same transaction as the order; recorded here as a document of its own.
jest.mock('./order-events', () => ({
  stageOrderEvent: (writer: any, event: { id: string }, request: any) =>
    writer.set(store.collection('events').doc(`${request.orderId}:${request.key}`), {
      event: event.id,
      orderStatus: request.order.status,
      channel: request.order.channel,
    }),
}))

import {
  cancelChannelOrder,
  channelOrderDocId,
  channelOrderProblem,
  importChannelOrder,
  recordChannelOrderFees,
} from './channel-orders'

const HOST = 'host1'
const deps = () => ({ firestore: () => store as never, now: () => 1_800_000_000_000 })

function seed(options: { teeStock?: number | null; backorder?: boolean; currency?: string } = {}) {
  store = new MemoryFirestore()
  store.write(`hosts/${HOST}/settings/store`, { currency: options.currency ?? 'USD' })
  store.write(`hosts/${HOST}/counters/orders`, { next: 1042 })
  store.write(`hosts/${HOST}/products/tee`, {
    name: 'Tee',
    slug: 'tee',
    status: 'active',
    type: 'physical',
    ...(options.backorder ? { oversellPolicy: 'backorder' } : {}),
    skus: ['tee-red', 'tee-blue'],
    variants: [
      { id: 'red', sku: 'TEE-RED', priceUsd: 20, inventory: options.teeStock === undefined ? 3 : options.teeStock, options: { Color: 'Red' } },
      { id: 'blue', sku: 'TEE-BLUE', priceUsd: 20, inventory: 5, options: { Color: 'Blue' } },
    ],
  })
  store.write(`hosts/${HOST}/products/mug`, {
    name: 'Mug',
    slug: 'mug',
    status: 'active',
    type: 'physical',
    skus: ['mug-1'],
    variants: [{ id: 'default', sku: 'MUG-1', priceUsd: 12 }],
  })
}

function order(overrides: Partial<PluginChannelOrder> = {}): PluginChannelOrder {
  return {
    hostId: HOST,
    channel: { id: 'ebay', label: 'eBay' },
    externalOrderId: '12-34567-89012',
    externalRef: '12-34567-89012',
    placedAtMs: 1_799_999_000_000,
    currency: 'USD',
    lines: [{ externalLineId: 'L1', sku: 'tee-red', name: 'Red tee', quantity: 2, unitPriceCents: 2000 }],
    shippingCents: 500,
    taxCents: 300,
    discountCents: 0,
    totalCents: 4800,
    fees: [{ label: 'eBay fees', amountCents: 640 }],
    customerName: 'Pat Buyer',
    shippingAddress: { name: 'Pat Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' },
    testMode: false,
    ...overrides,
  }
}

const variant = (product: string, id: string) =>
  (store.read(`hosts/${HOST}/products/${product}`)?.['variants'] as any[]).find((entry) => entry.id === id)
const ledger = () =>
  [...store.docs.entries()].filter(([path]) => path.startsWith(`hosts/${HOST}/inventoryAdjustments/`)).map(([, stored]) => stored.data)

beforeEach(() => {
  notices.length = 0
  crossings.length = 0
  seed()
})

describe('importChannelOrder (AGL-3638)', () => {
  it('records the order, takes its units and writes the ledger and the paid event in one write', async () => {
    const outcome = await importChannelOrder(order(), deps())
    const id = channelOrderDocId('ebay', '12-34567-89012')
    expect(outcome).toEqual({
      outcome: 'created',
      recordId: id,
      displayRef: '#1042',
      lines: [{ lineIndex: 0, externalLineId: 'L1' }],
      shortfalls: [],
      unmatched: [],
    })
    const stored = store.read(`hosts/${HOST}/orders/${id}`) as any
    expect(stored.number).toBe(1042)
    expect(stored.status).toBe('paid')
    expect(stored.channel).toBe('marketplace')
    expect(stored.livemode).toBe(true)
    expect(stored.customerEmail).toBeNull()
    expect(stored.totals).toEqual({
      itemsCents: 4000,
      shippingCents: 500,
      taxCents: 300,
      discountCents: 0,
      totalCents: 4800,
      feeCents: 0,
    })
    expect(stored.channelSource).toEqual({
      channelId: 'ebay',
      channelLabel: 'eBay',
      externalOrderId: '12-34567-89012',
      externalRef: '12-34567-89012',
      lines: [{ lineIndex: 0, externalLineId: 'L1' }],
      currency: 'USD',
      taxRemittedByChannel: true,
      fees: [{ label: 'eBay fees', amountCents: 640 }],
      feesTotalCents: 640,
    })
    expect(stored.lineItems[0]).toMatchObject({ productId: 'tee', variantId: 'red', sku: 'TEE-RED', quantity: 2, variantLabel: 'Red' })
    expect(stored.shippingAddress.country).toBe('US')
    expect(variant('tee', 'red').inventory).toBe(1)
    expect(store.read(`hosts/${HOST}/counters/orders`)?.['next']).toBe(1043)
    expect(ledger()).toEqual([
      expect.objectContaining({ productId: 'tee', variantId: 'red', delta: -2, reason: 'sale', orderId: id, source: 'eBay' }),
    ])
    expect(store.read(`events/${id}:paid`)).toEqual({ event: 'order.paid', orderStatus: 'paid', channel: 'marketplace' })
    expect(notices.map((notice) => notice.type)).toEqual(['content.order'])
    expect(notices[0].body).toContain('#1042')
  })

  it('records an order once however often it is imported', async () => {
    await importChannelOrder(order(), deps())
    const again = await importChannelOrder(order(), deps())
    expect(again).toMatchObject({ outcome: 'already', displayRef: '#1042', lines: [{ lineIndex: 0, externalLineId: 'L1' }] })
    expect(variant('tee', 'red').inventory).toBe(1)
    expect(ledger()).toHaveLength(1)
    expect(store.read(`hosts/${HOST}/counters/orders`)?.['next']).toBe(1043)
  })

  it('records the same order once when two imports race', async () => {
    const [a, b] = await Promise.all([importChannelOrder(order(), deps()), importChannelOrder(order(), deps())])
    expect([a.outcome, b.outcome].sort()).toEqual(['already', 'created'])
    expect(variant('tee', 'red').inventory).toBe(1)
    expect(ledger()).toHaveLength(1)
  })

  it('never sells the same units twice when two channels race for the last ones', async () => {
    seed({ teeStock: 2 })
    const ebay = order({ lines: [{ externalLineId: 'E1', sku: 'TEE-RED', name: 'Tee', quantity: 2, unitPriceCents: 2000 }] })
    const etsy = order({
      channel: { id: 'etsy', label: 'Etsy' },
      externalOrderId: '3311',
      externalRef: '3311',
      lines: [{ externalLineId: 'T1', sku: 'TEE-RED', name: 'Tee', quantity: 2, unitPriceCents: 2000 }],
    })
    const [first, second] = await Promise.all([importChannelOrder(ebay, deps()), importChannelOrder(etsy, deps())])
    expect(variant('tee', 'red').inventory).toBe(0)
    const shortfalls = [first, second].flatMap((outcome) => (outcome.outcome === 'created' ? outcome.shortfalls : []))
    // Exactly one of the two found the shelf empty, and it says by how much.
    expect(shortfalls).toEqual([{ lineIndex: 0, sku: 'TEE-RED', short: 2 }])
    const applied = ledger().map((row) => row.appliedDelta ?? row.delta)
    expect(applied.sort()).toEqual([-2, 0])
    expect(store.retries).toBeGreaterThan(0)
    expect(notices.some((notice) => notice.type === 'content.lowStock' && /Oversold on/.test(notice.title))).toBe(true)
  })

  it('takes a backorder product past zero without calling it an oversell', async () => {
    seed({ teeStock: 1, backorder: true })
    const outcome = await importChannelOrder(order(), deps())
    expect(outcome.outcome === 'created' && outcome.shortfalls).toEqual([])
  })

  it('records an item matching no SKU by name, with no stock moved', async () => {
    const outcome = await importChannelOrder(
      order({ lines: [{ externalLineId: 'X', sku: 'NOPE', name: 'Mystery', quantity: 1, unitPriceCents: 900 }], totalCents: 900, shippingCents: 0, taxCents: 0 }),
      deps(),
    )
    expect(outcome).toMatchObject({ outcome: 'created', unmatched: [0] })
    const stored = store.read(`hosts/${HOST}/orders/${(outcome as any).recordId}`) as any
    expect(stored.lineItems[0]).toMatchObject({ productId: '', name: 'Mystery', sku: 'NOPE' })
    expect(stored.timeline.map((event: any) => event.event)).toEqual(['paid', 'line-unmatched'])
    expect(ledger()).toEqual([])
  })

  it('uses the product the importer names, and leaves an untracked product’s count alone', async () => {
    const outcome = await importChannelOrder(
      order({ lines: [{ externalLineId: 'M', sku: null, productId: 'mug', variantId: 'default', name: 'Mug', quantity: 1, unitPriceCents: 1200 }] }),
      deps(),
    )
    expect(outcome).toMatchObject({ outcome: 'created', unmatched: [] })
    expect(ledger()).toEqual([])
  })

  it('refuses an order in a currency the store does not sell in', async () => {
    seed({ currency: 'CAD' })
    const outcome = await importChannelOrder(order(), deps())
    expect(outcome).toEqual({ outcome: 'refused', reason: 'This order is in USD, and the store sells in CAD. Ship it from eBay.' })
    expect(variant('tee', 'red').inventory).toBe(3)
  })

  it('marks a sandbox order as no money moved', async () => {
    const outcome = await importChannelOrder(order({ testMode: true }), deps())
    expect(store.read(`hosts/${HOST}/orders/${(outcome as any).recordId}`)?.['livemode']).toBe(false)
  })

  it('refuses a malformed order before reading anything', () => {
    expect(channelOrderProblem(order({ lines: [] }))).toBe('The order has no items.')
    expect(channelOrderProblem(order({ channel: { id: 'Bad Id', label: 'x' } }))).toBe('The order names no channel.')
    expect(channelOrderProblem(order({ totalCents: 1.5 }))).toBe('The order’s totals are not whole amounts.')
    expect(
      channelOrderProblem(order({ lines: [{ externalLineId: 'a', sku: 'x', name: 'x', quantity: 0, unitPriceCents: 1 }] })),
    ).toBe('An item of the order has no quantity.')
    expect(channelOrderProblem(order({ hostId: '__x__' }))).toBe('The order names no site.')
    expect(channelOrderProblem(order())).toBeNull()
  })
})

describe('cancelChannelOrder (AGL-3638)', () => {
  it('cancels an unshipped order and puts back what its sale took', async () => {
    const created = (await importChannelOrder(order(), deps())) as any
    const outcome = await cancelChannelOrder({ hostId: HOST, recordId: created.recordId, reason: 'Canceled on eBay' }, deps())
    expect(outcome).toEqual({ outcome: 'cancelled', restockedUnits: 2 })
    expect(variant('tee', 'red').inventory).toBe(3)
    const stored = store.read(`hosts/${HOST}/orders/${created.recordId}`) as any
    expect(stored.status).toBe('cancelled')
    expect(stored.timeline.at(-1).detail).toBe('Canceled on eBay. 2 units returned to stock.')
    expect(store.read(`events/${created.recordId}:cancelled`)).toMatchObject({ event: 'order.cancelled' })
    expect(await cancelChannelOrder({ hostId: HOST, recordId: created.recordId, reason: 'again' }, deps())).toEqual({
      outcome: 'already',
    })
    expect(variant('tee', 'red').inventory).toBe(3)
  })

  it('puts back only what the shelf gave up on an oversold order', async () => {
    seed({ teeStock: 1 })
    const created = (await importChannelOrder(order(), deps())) as any
    expect(variant('tee', 'red').inventory).toBe(0)
    const outcome = await cancelChannelOrder({ hostId: HOST, recordId: created.recordId, reason: 'Canceled on eBay' }, deps())
    expect(outcome).toEqual({ outcome: 'cancelled', restockedUnits: 1 })
    expect(variant('tee', 'red').inventory).toBe(1)
  })

  it('refuses once something shipped, and refuses an order no channel sold', async () => {
    const created = (await importChannelOrder(order(), deps())) as any
    const path = `hosts/${HOST}/orders/${created.recordId}`
    store.write(path, { ...store.read(path), fulfillments: [{ id: 'f1', lineItemIds: [0], atMs: 1 }] })
    expect(await cancelChannelOrder({ hostId: HOST, recordId: created.recordId, reason: 'x' }, deps())).toEqual({
      outcome: 'not_cancellable',
      status: 'paid',
    })
    store.write(`hosts/${HOST}/orders/web1`, { status: 'paid', channel: 'online', lineItems: [] })
    expect(await cancelChannelOrder({ hostId: HOST, recordId: 'web1', reason: 'x' }, deps())).toEqual({
      outcome: 'not_cancellable',
      status: 'paid',
    })
    expect(await cancelChannelOrder({ hostId: HOST, recordId: 'missing', reason: 'x' }, deps())).toEqual({
      outcome: 'no_such_record',
    })
  })
})

describe('recordChannelOrderFees (AGL-3638)', () => {
  it('records what the channel charged once it says, and nothing on other orders', async () => {
    const created = (await importChannelOrder(order({ fees: null }), deps())) as any
    const path = `hosts/${HOST}/orders/${created.recordId}`
    expect((store.read(path) as any).channelSource.fees).toBeNull()
    expect(
      await recordChannelOrderFees(
        { hostId: HOST, recordId: created.recordId, fees: [{ label: 'Commission', amountCents: 450 }, { label: 'FBA', amountCents: -3 }] },
        deps(),
      ),
    ).toBe('recorded')
    const source = (store.read(path) as any).channelSource
    expect(source.fees).toEqual([{ label: 'Commission', amountCents: 450 }])
    expect(source.feesTotalCents).toBe(450)
    expect(source.externalOrderId).toBe('12-34567-89012')
    store.write(`hosts/${HOST}/orders/web1`, { status: 'paid', channel: 'online' })
    expect(await recordChannelOrderFees({ hostId: HOST, recordId: 'web1', fees: [] }, deps())).toBe('no_such_record')
  })
})
