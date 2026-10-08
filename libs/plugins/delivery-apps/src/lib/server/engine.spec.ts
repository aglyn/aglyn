/**
 * @jest-environment node
 */
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

import type {
  PluginChannelOrder,
  PluginChannelOrderRefund,
  PluginChannelOrders,
} from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import type { CatalogOffer, PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { AUTO_COMPLETE_MS, LEASE_MS } from '../constants'
import { DEFAULT_STORE_SETTINGS, type DeliveryServiceId } from '../model/delivery-apps'
import { ProviderError } from '../providers/http'
import type { DeliveryEvent, DeliveryProvider, IncomingOrder, Menu, OrderRef } from '../providers/provider'
import { memoryDeliveryStore } from '../testing/memory-store'
import { createEngine } from './engine'
import { itemKey, orderDocId, storeDocId, type StoredStore } from './store'

const HOST = 'host1'
const NOW = 1_800_000_000_000

/** A scripted service: records each call, and fails the next ones it is told to. */
function fakeProvider(service: DeliveryServiceId, options: { ready?: boolean } = {}) {
  const calls: Array<{ call: string; ref?: OrderRef; detail?: unknown }> = []
  const failures: Partial<Record<'accept' | 'reject' | 'ready' | 'menu', unknown[]>> = {}
  let onAccept: (() => Promise<void>) | null = null
  const maybeFail = (call: 'accept' | 'reject' | 'ready' | 'menu') => {
    const next = failures[call]?.shift()
    if (next) throw next
  }
  const provider: DeliveryProvider = {
    id: service,
    verify: () => true,
    parse: async () => [],
    accept: async (ref, prepMinutes) => {
      calls.push({ call: 'accept', ref, detail: prepMinutes })
      if (onAccept) await onAccept()
      maybeFail('accept')
    },
    reject: async (ref, reason) => {
      calls.push({ call: 'reject', ref, detail: reason })
      maybeFail('reject')
    },
    ...(options.ready === false
      ? {}
      : {
          ready: async (ref: OrderRef) => {
            calls.push({ call: 'ready', ref })
            maybeFail('ready')
          },
        }),
    publishMenu: async (externalStoreId: string, menu: Menu) => {
      calls.push({ call: 'menu', detail: { externalStoreId, menu } })
      maybeFail('menu')
    },
  }
  return {
    provider,
    calls,
    fail: (call: 'accept' | 'reject' | 'ready' | 'menu', error: unknown) => (failures[call] = [...(failures[call] ?? []), error]),
    duringAccept: (work: () => Promise<void>) => (onAccept = work),
  }
}

/** A seller that keeps one shelf: each import takes units, each cancel puts them back. */
function fakeSeller() {
  const shelf = new Map<string, number>([['burger:default', 10]])
  const imports: PluginChannelOrder[] = []
  const cancels: string[] = []
  const refunds: PluginChannelOrderRefund[] = []
  const completes: string[] = []
  let refuse: string | null = null
  let completedStatus: string | null = null
  const records = new Map<string, { units: Array<[string, number]>; refunded: number; cancelled: boolean; total: number }>()
  const seller: PluginChannelOrders = {
    importOrder: async (order) => {
      if (refuse) return { outcome: 'refused', reason: refuse }
      const recordId = `${order.channel.id}-${order.externalOrderId}`
      const lines = order.lines.map((line, lineIndex) => ({ lineIndex, externalLineId: line.externalLineId }))
      if (records.has(recordId)) return { outcome: 'already', recordId, displayRef: '#1001', lines }
      imports.push(order)
      const units: Array<[string, number]> = []
      const unmatched: number[] = []
      order.lines.forEach((line, index) => {
        const key = line.productId ? `${line.productId}:${line.variantId}` : null
        if (!key || !shelf.has(key)) return void unmatched.push(index)
        shelf.set(key, (shelf.get(key) ?? 0) - line.quantity)
        units.push([key, line.quantity])
      })
      records.set(recordId, { units, refunded: 0, cancelled: false, total: order.totalCents })
      return { outcome: 'created', recordId, displayRef: '#1001', lines, shortfalls: [], unmatched }
    },
    cancelOrder: async ({ recordId }) => {
      cancels.push(recordId)
      const record = records.get(recordId)
      if (!record) return { outcome: 'no_such_record' }
      if (completedStatus) return { outcome: 'not_cancellable', status: completedStatus }
      if (record.cancelled) return { outcome: 'already' }
      record.cancelled = true
      for (const [key, units] of record.units) shelf.set(key, (shelf.get(key) ?? 0) + units)
      return { outcome: 'cancelled', restockedUnits: record.units.reduce((sum, [, units]) => sum + units, 0) }
    },
    recordFees: async () => 'recorded',
    completeOrder: async ({ recordId }) => {
      completes.push(recordId)
      completedStatus = 'fulfilled'
      return { outcome: 'completed' }
    },
    recordRefund: async (request) => {
      refunds.push(request)
      const record = records.get(request.recordId)
      if (!record) return { outcome: 'no_such_record' }
      record.refunded = Math.min(record.total, record.refunded + request.amountCents)
      return { outcome: 'recorded', refundedCents: record.refunded, restockedUnits: request.restock.reduce((sum, entry) => sum + entry.quantity, 0) }
    },
  }
  return {
    seller,
    shelf,
    imports,
    cancels,
    refunds,
    completes,
    refuseWith: (reason: string | null) => (refuse = reason),
  }
}

const offer = (overrides: Partial<CatalogOffer>): CatalogOffer => ({
  id: 'burger',
  groupId: 'burger',
  hasVariants: false,
  productId: 'burger',
  variantId: 'default',
  productName: 'Classic Burger',
  title: 'Classic Burger',
  description: 'Beef, cheddar',
  path: '/products/burger',
  additionalImageUrls: [],
  priceMinor: 1200,
  availability: 'in_stock',
  quantity: 10,
  kind: 'physical',
  subscriptionOnly: false,
  options: {},
  shipping: [],
  ...overrides,
})

const catalog: PluginProductCatalog = {
  store: async () => ({ hostId: HOST, name: 'Corner Grill', origin: null, currency: 'USD', productPagesServed: true, carrierPricedCountries: [] }),
  page: async ({ cursor }) =>
    cursor
      ? { offers: [offer({ id: 'gift', productId: 'gift', title: 'Gift card', kind: 'digital' })], nextCursor: null }
      : {
          offers: [
            offer({ productType: 'Food > Burgers', imageUrl: 'https://cdn.example.com/b.jpg' }),
            offer({ id: 'melt', productId: 'melt', title: 'Patty Melt', productType: 'Food > Burgers', availability: 'out_of_stock', salePriceMinor: 1100, sku: 'MELT-1' }),
            offer({ id: 'fries', productId: 'fries', title: 'Fries', priceMinor: 400 }),
          ],
          nextCursor: 'page-2',
        },
}

function incoming(overrides: Partial<IncomingOrder> = {}): IncomingOrder {
  return {
    externalOrderId: 'dd-1',
    externalRef: 'A1B2',
    storeIds: ['store-7'],
    placedAtMs: NOW - 60_000,
    pickupAtMs: NOW + 15 * 60_000,
    currency: 'USD',
    lines: [
      { externalLineId: 'l1', externalItemId: 'aglyn:burger:default', name: 'Classic Burger', quantity: 2, unitPriceCents: 1300, options: ['Cheese'], instructions: null },
      { externalLineId: 'l2', externalItemId: 'FRY-1', name: 'Fries', quantity: 1, unitPriceCents: 400, options: [], instructions: null },
    ],
    subtotalCents: 3000,
    taxCents: 240,
    discountCents: 0,
    totalCents: 3240,
    customerName: 'Jamie R.',
    instructions: null,
    handoff: 'courier',
    ...overrides,
  }
}

function setup(options: { autoAccept?: boolean; siteOpen?: boolean; ready?: boolean } = {}) {
  let clock = NOW
  const store = memoryDeliveryStore()
  const service = fakeProvider('doordash', { ready: options.ready })
  const seller = fakeSeller()
  let open = options.siteOpen ?? true
  const storeId = storeDocId('doordash', 'store-7')
  const stored: StoredStore = {
    orgId: 'org1',
    hostId: HOST,
    service: 'doordash',
    externalStoreId: 'store-7',
    settings: { ...DEFAULT_STORE_SETTINGS, autoAccept: options.autoAccept === true, prepMinutes: 20 },
    connectedAtMs: NOW - 1000,
    connectedBy: 'u1',
    updatedAtMs: NOW - 1000,
    itemMatches: {},
    unmatched: {},
    menu: { publishedAtMs: null, items: 0, error: null },
  }
  store.stores.set(storeId, stored)
  const engine = createEngine({
    now: () => clock,
    store,
    provider: (id) => (id === 'doordash' ? service.provider : null),
    sandbox: () => false,
    channelOrders: () => seller.seller,
    catalog: () => catalog,
    siteOpen: async () => open,
  })
  const id = orderDocId('doordash', 'dd-1')
  return {
    engine,
    store,
    service,
    seller,
    storeId,
    id,
    order: () => store.orders.get(id),
    tick: (ms: number) => (clock += ms),
    close: () => (open = false),
    created: (order = incoming()) => engine.handleEvents('doordash', [{ kind: 'created', order }]),
  }
}

describe('an order arrives (AGL-3644)', () => {
  it('waits on the register as new, with nothing taken off the shelf, once however often it is sent', async () => {
    const t = setup()
    await expect(t.created()).resolves.toEqual({ outcome: 'handled', applied: 1 })
    await expect(t.created()).resolves.toEqual({ outcome: 'handled', applied: 0 })
    expect(t.order()).toMatchObject({ status: 'new', active: true, hostId: HOST, orgId: 'org1', recordId: null, customerName: 'Jamie R.' })
    expect(t.seller.imports).toHaveLength(0)
    expect(t.service.calls).toHaveLength(0)
  })

  it('answers unknown_store for a store linked to no site, or a site that no longer takes orders', async () => {
    const t = setup()
    await expect(t.created(incoming({ storeIds: ['nobody'] }))).resolves.toEqual({ outcome: 'unknown_store' })
    t.close()
    await expect(t.created()).resolves.toEqual({ outcome: 'unknown_store' })
    expect(t.store.orders.size).toBe(0)
  })

  it('matches the store by any id the service gives it', async () => {
    const t = setup()
    await t.created(incoming({ storeIds: ['dd-internal-id', 'store-7'] }))
    expect(t.order()?.storeId).toBe(t.storeId)
  })

  it('leaves an order no one can make unread', async () => {
    const t = setup()
    await expect(t.created(incoming({ lines: [] }))).resolves.toEqual({ outcome: 'handled', applied: 0 })
    expect(t.store.orders.size).toBe(0)
  })

  it('accepts at once when the store says so: recorded, the units taken, the service told with the prep time', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    expect(t.order()).toMatchObject({ status: 'accepted', recordId: 'doordash-dd-1', displayRef: '#1001', pending: null })
    expect(t.seller.shelf.get('burger:default')).toBe(8)
    expect(t.service.calls).toEqual([{ call: 'accept', ref: { externalOrderId: 'dd-1', externalStoreId: 'store-7', recordId: 'doordash-dd-1' }, detail: 20 }])
  })
})

describe('accept (AGL-3644)', () => {
  it('records the store order with each line placed: our menu id, a merchant match, else the id as a SKU', async () => {
    const t = setup()
    await t.created(
      incoming({
        lines: [
          ...incoming().lines,
          { externalLineId: 'l3', externalItemId: 'shake-9', name: 'Shake', quantity: 1, unitPriceCents: 500, options: [], instructions: null },
        ],
      }),
    )
    t.store.stores.get(t.storeId)!.itemMatches[itemKey('shake-9')] = {
      externalItemId: 'shake-9',
      name: 'Shake',
      productId: 'shake',
      variantId: 'vanilla',
      title: 'Shake — Vanilla',
    }
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({ outcome: 'done', message: null })
    const imported = t.seller.imports[0]
    expect(imported).toMatchObject({
      channel: { id: 'doordash', label: 'DoorDash' },
      externalOrderId: 'dd-1',
      shippingCents: 0,
      taxCents: 240,
      totalCents: 3240,
      shippingAddress: null,
      handoff: 'courier',
      fees: null,
    })
    expect(imported.lines).toEqual([
      { externalLineId: 'l1', sku: null, productId: 'burger', variantId: 'default', name: 'Classic Burger (Cheese)', quantity: 2, unitPriceCents: 1300 },
      { externalLineId: 'l2', sku: 'FRY-1', name: 'Fries', quantity: 1, unitPriceCents: 400 },
      { externalLineId: 'l3', sku: null, productId: 'shake', variantId: 'vanilla', name: 'Shake', quantity: 1, unitPriceCents: 500 },
    ])
  })

  it('keeps the items that matched no product for the merchant to match', async () => {
    const t = setup()
    await t.created()
    await t.engine.act(t.id, 'accept')
    expect(t.order()?.lines.map((line) => line.matched)).toEqual([true, false])
    expect(Object.values(t.store.stores.get(t.storeId)!.unmatched)).toEqual([{ externalItemId: 'FRY-1', name: 'Fries', lastSeenAtMs: NOW }])
  })

  it('leaves the order new, with the seller’s reason, when the store will not record it', async () => {
    const t = setup()
    await t.created()
    t.seller.refuseWith('This order is in CAD, and the store sells in USD.')
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({ outcome: 'refused', message: 'This order is in CAD, and the store sells in USD.' })
    expect(t.order()).toMatchObject({ status: 'new', error: 'This order is in CAD, and the store sells in USD.', leaseUntilMs: null })
    expect(t.service.calls).toHaveLength(0)
  })

  it('is accepted here and sent again by the job when the service does not answer', async () => {
    const t = setup()
    await t.created()
    t.service.fail('accept', new ProviderError('transient', 'DoorDash had a problem (503)'))
    const outcome = await t.engine.act(t.id, 'accept')
    expect(outcome).toEqual({ outcome: 'done', message: 'Accepted here. DoorDash has not confirmed it yet; it is sent again automatically.' })
    expect(t.order()).toMatchObject({ status: 'accepted', pending: { call: 'accept', attempts: 1 }, error: 'DoorDash had a problem (503)' })
    expect(t.order()?.nextRunAtMs).toBeGreaterThan(NOW)
    // Ready is held until the service has the acceptance.
    await expect(t.engine.act(t.id, 'ready')).resolves.toMatchObject({ outcome: 'refused' })

    t.tick(60_000)
    await expect(t.engine.runDue(t.id)).resolves.toBe('retried')
    expect(t.order()).toMatchObject({ status: 'accepted', pending: null, error: null, nextRunAtMs: null })
    // One store order, however many times the service was asked.
    expect(t.seller.imports).toHaveLength(1)
    expect(t.service.calls.filter((call) => call.call === 'accept')).toHaveLength(2)
  })

  it('cancels the store order and puts its units back when the service will not take the acceptance', async () => {
    const t = setup()
    await t.created()
    t.service.fail('accept', new ProviderError('invalid', 'Order is no longer pending'))
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({
      outcome: 'refused',
      message: 'DoorDash would not take the acceptance: Order is no longer pending',
    })
    expect(t.order()).toMatchObject({ status: 'cancelled', active: false })
    expect(t.seller.cancels).toEqual(['doordash-dd-1'])
    expect(t.seller.shelf.get('burger:default')).toBe(10)
  })

  it('sends one acceptance when two cashiers tap at once', async () => {
    const t = setup()
    await t.created()
    t.store.orders.get(t.id)!.leaseUntilMs = NOW + LEASE_MS
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({ outcome: 'busy' })
    expect(t.service.calls).toHaveLength(0)
  })

  it('puts the units back when the service cancels while the acceptance is on its way', async () => {
    const t = setup()
    await t.created()
    t.service.duringAccept(async () => {
      await t.engine.handleEvents('doordash', [{ kind: 'cancelled', externalOrderId: 'dd-1', storeIds: ['store-7'], reason: 'Customer canceled' }])
    })
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({ outcome: 'refused', message: 'DoorDash canceled this order.' })
    expect(t.order()).toMatchObject({ status: 'cancelled', active: false, leaseUntilMs: null })
    expect(t.seller.shelf.get('burger:default')).toBe(10)
  })

  it('refuses an order already accepted, rejected or gone', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await expect(t.engine.act(t.id, 'accept')).resolves.toEqual({ outcome: 'refused', message: 'This order is accepted.' })
    await expect(t.engine.act('doordash_missing', 'accept')).resolves.toEqual({ outcome: 'no_such_order' })
  })
})

describe('reject (AGL-3644)', () => {
  it('tells the service why, and takes nothing off the shelf', async () => {
    const t = setup()
    await t.created()
    await expect(t.engine.act(t.id, 'reject', { reason: 'An item is out of stock' })).resolves.toEqual({ outcome: 'done', message: null })
    expect(t.service.calls).toEqual([{ call: 'reject', ref: expect.objectContaining({ externalOrderId: 'dd-1', recordId: null }), detail: 'An item is out of stock' }])
    expect(t.order()).toMatchObject({ status: 'rejected', active: false })
    expect(t.seller.imports).toHaveLength(0)
  })

  it('is sent again with the same reason when the service does not answer', async () => {
    const t = setup()
    await t.created()
    t.service.fail('reject', new ProviderError('transient', 'down'))
    await t.engine.act(t.id, 'reject', { reason: 'The kitchen is too busy' })
    expect(t.order()).toMatchObject({ status: 'rejected', active: false, pending: { call: 'reject', reason: 'The kitchen is too busy' } })
    t.tick(60_000)
    await t.engine.runDue(t.id)
    expect(t.service.calls.map((call) => call.detail)).toEqual(['The kitchen is too busy', 'The kitchen is too busy'])
    expect(t.order()).toMatchObject({ pending: null, nextRunAtMs: null })
  })

  it('refuses an accepted order: it is cancelled on the service', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await expect(t.engine.act(t.id, 'reject')).resolves.toEqual({
      outcome: 'refused',
      message: 'This order is already accepted. Cancel it with the service instead.',
    })
  })
})

describe('ready and picked up (AGL-3644)', () => {
  it('tells the service it is ready, and closes it as picked up two hours on', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await t.engine.act(t.id, 'ready')
    expect(t.service.calls.map((call) => call.call)).toEqual(['accept', 'ready'])
    expect(t.order()).toMatchObject({ status: 'ready', readyAtMs: NOW, nextRunAtMs: NOW + AUTO_COMPLETE_MS })
    t.tick(AUTO_COMPLETE_MS - 1)
    await expect(t.engine.runDue(t.id)).resolves.toBe('skipped')
    t.tick(1)
    await expect(t.engine.runDue(t.id)).resolves.toBe('completed')
    expect(t.order()).toMatchObject({ status: 'picked_up', active: false, nextRunAtMs: null })
    expect(t.seller.completes).toEqual(['doordash-dd-1'])
  })

  it('marks it ready here alone for a service that takes no "ready"', async () => {
    const t = setup({ autoAccept: true, ready: false })
    await t.created()
    await t.engine.act(t.id, 'ready')
    expect(t.order()?.status).toBe('ready')
    expect(t.service.calls.map((call) => call.call)).toEqual(['accept'])
  })

  it('records the courier’s pickup on the store order', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await expect(t.engine.act(t.id, 'picked_up')).resolves.toEqual({ outcome: 'done', message: null })
    expect(t.seller.completes).toEqual(['doordash-dd-1'])
    expect(t.order()).toMatchObject({ status: 'picked_up', active: false })
    await expect(t.engine.act(t.id, 'picked_up')).resolves.toMatchObject({ outcome: 'refused' })
  })

  it('leaves the job nothing to do for a site that stopped taking orders', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await t.engine.act(t.id, 'ready')
    t.close()
    t.tick(AUTO_COMPLETE_MS)
    await expect(t.engine.runDue(t.id)).resolves.toBe('skipped')
    expect(t.order()).toMatchObject({ status: 'ready', nextRunAtMs: null })
  })
})

describe('the service’s changes (AGL-3644)', () => {
  const cancel = (reason = 'Customer canceled'): DeliveryEvent => ({ kind: 'cancelled', externalOrderId: 'dd-1', storeIds: ['store-7'], reason })

  it('cancels a new order with nothing to put back, and an accepted one with its units back', async () => {
    const t = setup()
    await t.created()
    await t.engine.handleEvents('doordash', [cancel()])
    expect(t.order()).toMatchObject({ status: 'cancelled', active: false, error: 'Customer canceled' })
    expect(t.seller.cancels).toEqual([])

    const u = setup({ autoAccept: true })
    await u.created()
    expect(u.seller.shelf.get('burger:default')).toBe(8)
    await expect(u.engine.handleEvents('doordash', [cancel(), cancel()])).resolves.toEqual({ outcome: 'handled', applied: 1 })
    expect(u.seller.shelf.get('burger:default')).toBe(10)
    expect(u.order()?.status).toBe('cancelled')
  })

  it('leaves a picked-up order as it is when the service cancels it later', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await t.engine.act(t.id, 'ready')
    await t.engine.act(t.id, 'picked_up')
    await t.engine.handleEvents('doordash', [cancel('Order never arrived')])
    expect(t.order()?.status).toBe('picked_up')
    expect(t.seller.cancels).toEqual([])
  })

  it('records the service’s refund of what is owed when the store order was already fulfilled', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    // Fulfilled from the order dialog, while the register still shows it open.
    await t.seller.seller.completeOrder?.({ hostId: HOST, recordId: 'doordash-dd-1', note: '' })
    await t.engine.handleEvents('doordash', [cancel()])
    expect(t.seller.refunds).toEqual([
      { hostId: HOST, recordId: 'doordash-dd-1', refundId: 'cancel:dd-1', amountCents: 3240, reason: 'Customer canceled', restock: [] },
    ])
    expect(t.order()?.status).toBe('cancelled')
  })

  it('records an adjustment once: the money, and the removed units back while the order is still here', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    const adjusted = incoming({ lines: [incoming().lines[0]], subtotalCents: 2600, taxCents: 208, totalCents: 2808 })
    const event: DeliveryEvent = { kind: 'updated', eventId: 'adj-1', order: adjusted }
    await t.engine.handleEvents('doordash', [event, event])
    expect(t.seller.refunds).toEqual([
      {
        hostId: HOST,
        recordId: 'doordash-dd-1',
        refundId: 'adj-1',
        amountCents: 432,
        reason: 'DoorDash took 1 × Fries off the order',
        restock: [{ lineIndex: 1, quantity: 1 }],
      },
    ])
    expect(t.order()).toMatchObject({ totalCents: 2808, refundedCents: 432, eventIds: ['adj-1'] })
    expect(t.order()?.lines.map((line) => line.externalLineId)).toEqual(['l1'])
  })

  it('puts nothing back for an adjustment after pickup', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    await t.engine.act(t.id, 'picked_up')
    const adjusted = incoming({ lines: [incoming().lines[0]], totalCents: 2808 })
    await t.engine.handleEvents('doordash', [{ kind: 'updated', eventId: 'adj-2', order: adjusted }])
    expect(t.seller.refunds[0]).toMatchObject({ amountCents: 432, restock: [] })
  })

  it('applies a change to an order not yet accepted without the store order', async () => {
    const t = setup()
    await t.created()
    await t.engine.handleEvents('doordash', [{ kind: 'updated', eventId: 'adj-3', order: incoming({ totalCents: 2000 }) }])
    expect(t.seller.refunds).toEqual([])
    expect(t.order()).toMatchObject({ totalCents: 2000, refundedCents: 0, status: 'new' })
  })

  it('reads an update for an order it never saw as the order', async () => {
    const t = setup()
    await t.engine.handleEvents('doordash', [{ kind: 'updated', eventId: 'adj-4', order: incoming() }])
    expect(t.order()?.status).toBe('new')
  })

  it('records the service’s refund on the store order, once', async () => {
    const t = setup({ autoAccept: true })
    await t.created()
    const refund: DeliveryEvent = { kind: 'refunded', externalOrderId: 'dd-1', storeIds: ['store-7'], refundId: 'r-1', amountCents: 400, reason: 'Missing fries' }
    await t.engine.handleEvents('doordash', [refund, refund])
    expect(t.seller.refunds).toEqual([
      { hostId: HOST, recordId: 'doordash-dd-1', refundId: 'r-1', amountCents: 400, reason: 'Missing fries', restock: [] },
    ])
    expect(t.order()).toMatchObject({ refundedCents: 400, eventIds: ['r-1'] })
  })
})

describe('the menu and item search (AGL-3644)', () => {
  it('sends physical products by category, sold-out ones unavailable, at their selling price', async () => {
    const t = setup()
    await expect(t.engine.publishMenu(t.storeId)).resolves.toEqual({ ok: true, items: 3 })
    const sent = t.service.calls[0].detail as { externalStoreId: string; menu: Menu }
    expect(sent.externalStoreId).toBe('store-7')
    expect(sent.menu).toEqual({
      name: 'Corner Grill',
      currency: 'USD',
      categories: [
        {
          id: 'aglyn-category-1',
          name: 'Burgers',
          items: [
            { externalItemId: 'aglyn:burger:default', name: 'Classic Burger', description: 'Beef, cheddar', priceCents: 1200, imageUrl: 'https://cdn.example.com/b.jpg', available: true },
            { externalItemId: 'aglyn:melt:default', name: 'Patty Melt', description: 'Beef, cheddar', priceCents: 1100, imageUrl: null, available: false },
          ],
        },
        {
          id: 'aglyn-category-2',
          name: 'Menu',
          items: [{ externalItemId: 'aglyn:fries:default', name: 'Fries', description: 'Beef, cheddar', priceCents: 400, imageUrl: null, available: true }],
        },
      ],
    })
    expect(t.store.stores.get(t.storeId)?.menu).toEqual({ publishedAtMs: NOW, items: 3, error: null })
  })

  it('keeps the service’s refusal on the store', async () => {
    const t = setup()
    t.service.fail('menu', new ProviderError('invalid', 'Item price is required'))
    await expect(t.engine.publishMenu(t.storeId)).resolves.toEqual({ ok: false, message: 'DoorDash did not take the menu: Item price is required' })
    expect(t.store.stores.get(t.storeId)?.menu.error).toBe('DoorDash did not take the menu: Item price is required')
  })

  it('finds offers by name or SKU through the whole catalog', async () => {
    const t = setup()
    await expect(t.engine.searchCatalog(HOST, 'melt')).resolves.toEqual([{ productId: 'melt', variantId: 'default', title: 'Patty Melt', sku: 'MELT-1' }])
    await expect(t.engine.searchCatalog(HOST, '')).resolves.toHaveLength(3)
    await expect(t.engine.searchCatalog(HOST, 'gift')).resolves.toEqual([])
  })
})
