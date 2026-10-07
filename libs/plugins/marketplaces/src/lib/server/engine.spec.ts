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

import type { PluginChannelOrder, PluginChannelOrders } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import type { CatalogOffer, PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { LISTING_RETRY_MS, ORDERS_POLL_MS } from '../constants'
import { DEFAULT_SETTINGS, type MarketplaceId } from '../model/marketplaces'
import { ProviderError } from '../providers/http'
import type {
  ListingPush,
  ListingSyncOptions,
  MarketplaceApp,
  MarketplaceOrder,
  MarketplaceProvider,
  ShipmentConfirmation,
} from '../providers/provider'
import { createMemoryMarketplaceStore, type MemoryMarketplaceStore } from '../testing/memory-store'
import type { MarketplacesConfig } from './config'
import { createEngine, listingPrice, listingQuantity } from './engine'
import { emptyConnection, marketplaceOrderDocId, type StoredConnection } from './store'

const HOST = 'host1'
const ID = `${HOST}_ebay`
const APP: MarketplaceApp = { clientId: 'id', clientSecret: 'secret', sandbox: false, extra: { ruName: 'ru' } }
const T0 = 1_800_000_000_000

function offer(id: string, overrides: Partial<CatalogOffer> = {}): CatalogOffer {
  return {
    id,
    groupId: id,
    hasVariants: false,
    productId: id,
    variantId: 'default',
    sku: id.toUpperCase(),
    productName: `Product ${id}`,
    title: `Product ${id}`,
    description: 'A product',
    path: `/products/${id}`,
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    additionalImageUrls: [],
    priceMinor: 2000,
    availability: 'in_stock',
    quantity: 10,
    kind: 'physical',
    subscriptionOnly: false,
    options: {},
    shipping: [],
    ...overrides,
  }
}

function marketOrder(id: string, overrides: Partial<MarketplaceOrder> = {}): MarketplaceOrder {
  return {
    externalId: id,
    displayRef: `#${id}`,
    state: 'unshipped',
    fulfilledByMarketplace: false,
    placedAtMs: T0 - 1000,
    updatedAtMs: T0 - 1000,
    currency: 'USD',
    lines: [{ externalLineId: `${id}-L1`, sku: 'A', title: 'Product a', quantity: 1, unitPriceMinor: 2000 }],
    shippingMinor: 0,
    taxMinor: 0,
    discountMinor: 0,
    totalMinor: 2000,
    fees: [{ label: 'eBay fees', amountMinor: 260 }],
    buyerName: 'Pat',
    shipTo: null,
    ...overrides,
  }
}

interface Harness {
  store: MemoryMarketplaceStore
  clock: { now: number }
  offers: CatalogOffer[]
  pages: MarketplaceOrder[][]
  listOrdersCalls: Array<{ sinceMs: number; cursor: string | null }>
  pushes: Array<{ pushes: ListingPush[]; options: ListingSyncOptions }>
  confirmations: ShipmentConfirmation[]
  acknowledged: string[]
  imported: PluginChannelOrder[]
  cancelled: string[]
  fees: Array<{ recordId: string; fees: unknown }>
  provider: MarketplaceProvider & Record<string, any>
  seller: PluginChannelOrders & Record<string, any>
  engine: ReturnType<typeof createEngine>
  config: MarketplacesConfig
}

function harness(options: { marketplace?: MarketplaceId; settings?: Partial<StoredConnection['settings']> } = {}): Harness {
  const marketplace = options.marketplace ?? 'ebay'
  const id = `${HOST}_${marketplace}`
  const store = createMemoryMarketplaceStore()
  const clock = { now: T0 }
  const h = {
    store,
    clock,
    offers: [offer('a'), offer('b', { quantity: null })],
    pages: [[]] as MarketplaceOrder[][],
    listOrdersCalls: [],
    pushes: [],
    confirmations: [],
    acknowledged: [],
    imported: [],
    cancelled: [],
    fees: [],
  } as unknown as Harness
  h.provider = {
    id: marketplace,
    authorizeUrl: () => 'https://consent',
    exchangeCode: jest.fn(),
    refresh: jest.fn(),
    account: jest.fn(),
    syncListings: jest.fn(async (_app, _credential, pushes: readonly ListingPush[], syncOptions: ListingSyncOptions) => {
      h.pushes.push({ pushes: [...pushes], options: syncOptions })
      return pushes.map((push) => ({ sku: push.sku, outcome: 'updated' as const, externalId: `x-${push.sku}` }))
    }),
    listOrders: jest.fn(async (_app, _credential, query) => {
      h.listOrdersCalls.push(query)
      const index = query.cursor ? Number(query.cursor) : 0
      return { orders: h.pages[index] ?? [], nextCursor: index + 1 < h.pages.length ? String(index + 1) : null }
    }),
    confirmShipment: jest.fn(async (_app, _credential, confirmation: ShipmentConfirmation) => {
      h.confirmations.push(confirmation)
      return 'confirmed' as const
    }),
  }
  let number = 1000
  h.seller = {
    importOrder: jest.fn(async (order: PluginChannelOrder) => {
      if (order.currency !== 'USD') return { outcome: 'refused' as const, reason: 'Wrong currency.' }
      h.imported.push(order)
      number += 1
      return {
        outcome: 'created' as const,
        recordId: `rec-${order.externalOrderId}`,
        displayRef: `#${number}`,
        lines: order.lines.map((line, lineIndex) => ({ lineIndex, externalLineId: line.externalLineId })),
        shortfalls: [],
        unmatched: [],
      }
    }),
    cancelOrder: jest.fn(async (request) => {
      h.cancelled.push(request.recordId)
      return { outcome: 'cancelled' as const, restockedUnits: 1 }
    }),
    recordFees: jest.fn(async (request) => {
      h.fees.push({ recordId: request.recordId, fees: request.fees })
      return 'recorded' as const
    }),
  }
  h.config = {
    keyring: {} as never,
    apps: { amazon: APP, ebay: APP, etsy: APP, tiktok: APP, walmart: APP, faire: APP },
  }
  const catalog: PluginProductCatalog = {
    store: async () => ({ hostId: HOST, name: 'Shop', origin: 'https://shop.example.com', currency: 'USD', productPagesServed: true, carrierPricedCountries: [] }),
    page: async () => ({ offers: h.offers, nextCursor: null }),
  }
  h.engine = createEngine({
    now: () => clock.now,
    store,
    config: () => h.config,
    provider: () => h.provider,
    credential: async (_id, connection) => ({ accessToken: 'token', account: connection.account }),
    catalog: () => catalog,
    channelOrders: () => h.seller,
    siteOpen: async () => true,
  })
  void store.patchConnection(id, {
    ...emptyConnection({ orgId: 'org1', hostId: HOST, marketplace, sandbox: false, nowMs: T0 }),
    status: 'active',
    connectedAtMs: T0 - 60_000,
    ordersSinceMs: T0 - 3_600_000,
    settings: { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) },
  })
  return h
}

describe('listing arithmetic (AGL-3638)', () => {
  it('holds back the buffer, never below zero, and stands in for an untracked count', () => {
    const settings = { ...DEFAULT_SETTINGS, stockBuffer: 2, untrackedQuantity: 7 }
    expect(listingQuantity({ quantity: 10 }, settings)).toBe(8)
    expect(listingQuantity({ quantity: 1 }, settings)).toBe(0)
    expect(listingQuantity({ quantity: null }, settings)).toBe(7)
  })

  it('prices from the selling price, adjusted by a whole percent', () => {
    expect(listingPrice({ priceMinor: 2000 }, 15)).toBe(2300)
    expect(listingPrice({ priceMinor: 2000, salePriceMinor: 1500 }, 0)).toBe(1500)
    expect(listingPrice({ priceMinor: 999 }, -10)).toBe(899)
  })
})

describe('a connection run: orders (AGL-3638)', () => {
  it('imports a paid order once however often its page is read, and marks every listing due', async () => {
    const h = harness()
    h.pages = [[marketOrder('1001')]]
    expect(await h.engine.runConnection(ID, { force: true })).toBe('synced')
    expect(h.imported).toHaveLength(1)
    expect(h.imported[0]).toMatchObject({
      hostId: HOST,
      channel: { id: 'ebay', label: 'eBay' },
      externalOrderId: '1001',
      lines: [{ externalLineId: '1001-L1', sku: 'A', quantity: 1, unitPriceCents: 2000 }],
      fees: [{ label: 'eBay fees', amountCents: 260 }],
      testMode: false,
    })
    const record = h.store.orders.get(marketplaceOrderDocId(HOST, 'ebay', '1001'))
    expect(record).toMatchObject({ status: 'imported', recordId: 'rec-1001', lines: [{ lineIndex: 0, externalLineId: '1001-L1' }] })
    expect(record?.active).toBe(false)
    h.clock.now += ORDERS_POLL_MS
    await h.engine.runConnection(ID, { force: true })
    expect(h.imported).toHaveLength(1)
    const connection = h.store.connections.get(ID)!
    expect(connection.orders.imported).toBe(1)
    expect(connection.ordersSinceMs).toBe(T0 + ORDERS_POLL_MS)
    expect(h.store.logs.get(ID)?.some((entry) => entry.kind === 'order_imported')).toBe(true)
  })

  it('reads back from the last read less an overlap, and resumes a page cursor on the next run', async () => {
    const h = harness()
    h.pages = Array.from({ length: 7 }, (_, index) => [marketOrder(`p${index}`)])
    await h.engine.runConnection(ID, { force: true })
    expect(h.listOrdersCalls[0]).toEqual({ sinceMs: T0 - 3_600_000 - 30 * 60 * 1000, cursor: null })
    expect(h.imported).toHaveLength(5)
    const after = h.store.connections.get(ID)!
    expect(after.ordersPage).toEqual({ cursor: '5', sinceMs: T0 - 3_600_000 - 30 * 60 * 1000, startedAtMs: T0 })
    expect(after.ordersDueAtMs).toBe(T0)
    h.clock.now += 1000
    await h.engine.runConnection(ID)
    expect(h.imported).toHaveLength(7)
    expect(h.store.connections.get(ID)!.ordersPage).toBeNull()
    expect(h.store.connections.get(ID)!.ordersSinceMs).toBe(T0)
  })

  it('leaves what the marketplace ships itself, what is not paid, and what shipped before it was read', async () => {
    const h = harness()
    h.pages = [
      [
        marketOrder('fba', { fulfilledByMarketplace: true }),
        marketOrder('pending', { state: 'pending' }),
        marketOrder('shipped', { state: 'shipped' }),
        marketOrder('cad', { currency: 'CAD' }),
      ],
    ]
    await h.engine.runConnection(ID, { force: true })
    expect(h.imported).toHaveLength(0)
    expect(h.store.orders.get(marketplaceOrderDocId(HOST, 'ebay', 'pending'))).toBeUndefined()
    expect(h.store.orders.get(marketplaceOrderDocId(HOST, 'ebay', 'cad'))).toMatchObject({ status: 'refused', note: 'Wrong currency.' })
    expect(h.store.connections.get(ID)!.orders.skipped).toBe(3)
    // Read again: nothing is counted or logged twice.
    await h.engine.runConnection(ID, { force: true })
    expect(h.store.connections.get(ID)!.orders.skipped).toBe(3)
  })

  it('cancels an imported order the marketplace canceled, and puts its stock back on every channel', async () => {
    const h = harness()
    h.pages = [[marketOrder('1001')]]
    await h.engine.runConnection(ID, { force: true })
    h.pages = [[marketOrder('1001', { state: 'canceled' })]]
    h.clock.now += 1000
    await h.engine.runConnection(ID, { force: true })
    expect(h.cancelled).toEqual(['rec-1001'])
    expect(h.store.orders.get(marketplaceOrderDocId(HOST, 'ebay', '1001'))?.status).toBe('canceled')
    expect(h.store.connections.get(ID)!.listingsDirtyAtMs).toBe(h.clock.now)
  })

  it('acknowledges an order where the marketplace must hear it was taken', async () => {
    const h = harness({ marketplace: 'walmart' })
    h.provider.acknowledgeOrder = jest.fn(async (_app: unknown, _credential: unknown, order: MarketplaceOrder) => {
      h.acknowledged.push(order.externalId)
    })
    h.pages = [[marketOrder('PO1')]]
    await h.engine.runConnection(`${HOST}_walmart`, { force: true })
    expect(h.acknowledged).toEqual(['PO1'])
    expect(h.store.orders.get(marketplaceOrderDocId(HOST, 'walmart', 'PO1'))).toMatchObject({ acknowledged: true, active: false })
  })

  it('turns the connection to connect again when the marketplace refuses the grant', async () => {
    const h = harness()
    h.provider.listOrders = jest.fn(async () => {
      throw new ProviderError('auth', 'eBay refused the connection: expired')
    })
    expect(await h.engine.runConnection(ID, { force: true })).toBe('reconnect')
    expect(h.store.connections.get(ID)).toMatchObject({ status: 'reconnect', lastError: 'eBay refused the connection: expired' })
  })

  it('waits as long as a rate limit asks, and backs off on anything else', async () => {
    const h = harness({ settings: { listingMode: 'off' } })
    h.provider.listOrders = jest.fn(async () => {
      throw new ProviderError('rate-limit', 'slow down', { retryAfterMs: 180_000 })
    })
    expect(await h.engine.runConnection(ID, { force: true })).toBe('failed')
    expect(h.store.connections.get(ID)!.ordersDueAtMs).toBe(T0 + 180_000)
    h.provider.listOrders = jest.fn(async () => {
      throw new ProviderError('transient', 'eBay had a problem (503)')
    })
    await h.engine.runConnection(ID, { force: true })
    expect(h.store.connections.get(ID)).toMatchObject({ failures: 2, lastError: 'eBay had a problem (503)' })
    expect(h.store.connections.get(ID)!.ordersDueAtMs).toBe(T0 + 10 * 60 * 1000)
  })

  it('does nothing for a site that may not run it now', async () => {
    const h = harness()
    const engine = createEngine({
      now: () => h.clock.now,
      store: h.store,
      config: () => h.config,
      provider: () => h.provider,
      credential: async () => ({ accessToken: 't', account: {} }),
      catalog: () => undefined,
      channelOrders: () => h.seller,
      siteOpen: async () => false,
    })
    expect(await engine.runConnection(ID, { force: true })).toBe('closed')
    expect(h.provider.listOrders).not.toHaveBeenCalled()
  })
})

describe('a connection run: listings (AGL-3638)', () => {
  it('sends each listing its units less the buffer, prices only when asked, and only what changed', async () => {
    const h = harness({ settings: { stockBuffer: 1, untrackedQuantity: 4 } })
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes).toHaveLength(1)
    expect(h.pushes[0].options).toEqual({ publish: false, prices: false })
    expect(h.pushes[0].pushes.map((push) => [push.sku, push.quantity])).toEqual([
      ['A', 9],
      ['B', 4],
    ])
    expect(h.pushes[0].pushes[0]).toMatchObject({ productUrl: 'https://shop.example.com/products/a', currency: 'USD' })
    expect(h.store.connections.get(ID)!.listings).toMatchObject({ offers: 2, updated: 2 })
    // Nothing moved: nothing is sent.
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes).toHaveLength(1)
    expect(h.store.connections.get(ID)!.listings).toMatchObject({ unchanged: 2, updated: 0 })
    // A sale moves one count: only that listing is sent.
    h.offers[0] = { ...h.offers[0], quantity: 3 }
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes[1].pushes.map((push) => [push.sku, push.quantity])).toEqual([['A', 2]])
  })

  it('sends adjusted prices when asked, and publishes only where the marketplace allows it', async () => {
    const h = harness({ settings: { syncPrices: true, priceAdjustPercent: 10, listingMode: 'publish' } })
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes[0].options).toEqual({ publish: true, prices: true })
    expect(h.pushes[0].pushes[0].priceMinor).toBe(2200)
    const etsy = harness({ marketplace: 'etsy', settings: { listingMode: 'publish' } })
    await etsy.engine.runConnection(`${HOST}_etsy`, { force: true })
    expect(etsy.pushes[0].options.publish).toBe(false)
    const faire = harness({ marketplace: 'faire', settings: { syncPrices: true } })
    await faire.engine.runConnection(`${HOST}_faire`, { force: true })
    expect(faire.pushes[0].options.prices).toBe(false)
  })

  it('lists only goods that ship and sell once, under the merchant’s SKU or the offer id', async () => {
    const h = harness()
    h.offers = [
      offer('a', { sku: undefined }),
      offer('svc', { kind: 'service' }),
      offer('sub', { subscriptionOnly: true }),
      offer('dup', { sku: 'A' }),
    ]
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes[0].pushes.map((push) => push.sku)).toEqual(['a'])
  })

  it('records refusals and missing listings, and tries them again only after a while', async () => {
    const h = harness()
    h.provider.syncListings = jest.fn(async (_app: unknown, _credential: unknown, pushes: readonly ListingPush[]) => {
      h.pushes.push({ pushes: [...pushes], options: { publish: false, prices: false } })
      return pushes.map((push) =>
        push.sku === 'A'
          ? { sku: push.sku, outcome: 'failed' as const, message: 'Category needs a brand' }
          : { sku: push.sku, outcome: 'not_listed' as const },
      )
    })
    await h.engine.runConnection(ID, { force: true })
    expect(h.store.connections.get(ID)!.listings).toMatchObject({ failed: 1, notListed: 1 })
    const chunks = Object.values(h.store.listingState.get(ID) ?? {})
    const entries = Object.assign({}, ...chunks)
    expect(entries['a']).toMatchObject({ s: 'A', o: 'failed', m: 'Category needs a brand', q: 10 })
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes).toHaveLength(1)
    h.clock.now += LISTING_RETRY_MS
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes).toHaveLength(2)
  })

  it('zeroes a listing whose product left the catalog, once', async () => {
    const h = harness()
    await h.engine.runConnection(ID, { force: true })
    h.offers = [h.offers[1]]
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes[1].pushes).toEqual([expect.objectContaining({ sku: 'A', quantity: 0 })])
    await h.engine.runConnection(ID, { force: true })
    expect(h.pushes).toHaveLength(2)
  })

  it('keeps listings due when a sale marked them while the run was working', async () => {
    const h = harness()
    h.provider.syncListings = jest.fn(async (_app: unknown, _credential: unknown, pushes: readonly ListingPush[]) => {
      // A sale elsewhere lands mid-run.
      await h.store.markListingsDue(HOST, h.clock.now)
      return pushes.map((push) => ({ sku: push.sku, outcome: 'updated' as const }))
    })
    await h.engine.runConnection(ID, { force: true })
    const after = h.store.connections.get(ID)!
    expect(after.listingsDueAtMs).toBe(T0)
    expect(after.dueAtMs).toBe(T0)
    expect(after.leaseUntilMs).toBe(0)
  })
})

describe('an imported order’s run (AGL-3638)', () => {
  async function imported(h: Harness, overrides: Partial<MarketplaceOrder> = {}) {
    h.pages = [[marketOrder('1001', { lines: [
      { externalLineId: 'L1', sku: 'A', title: 'A', quantity: 2, unitPriceMinor: 1000 },
      { externalLineId: 'L2', sku: 'B', title: 'B', quantity: 1, unitPriceMinor: 1000 },
    ], ...overrides })]]
    await h.engine.runConnection(ID, { force: true })
    return marketplaceOrderDocId(HOST, 'ebay', '1001')
  }
  const queue = (h: Harness, id: string, key: string, shipment: Record<string, unknown>) =>
    h.store.patchOrder(id, {
      shipments: { [key]: { lines: [{ lineIndex: 0, quantity: 2 }], carrier: 'UPS', trackingNumber: '1Z999', trackingUrl: null, atMs: T0, state: 'pending', message: null, attempts: 0, ...shipment } as never },
      active: true,
      nextRunAtMs: h.clock.now,
    })

  it('confirms a shipment with the marketplace’s own line ids', async () => {
    const h = harness()
    const id = await imported(h)
    await queue(h, id, 'f1', { lines: [{ lineIndex: 0, quantity: 2 }, { lineIndex: 1, quantity: 1 }] })
    expect(await h.engine.runOrder(id)).toBe('done')
    expect(h.confirmations).toEqual([
      expect.objectContaining({
        externalOrderId: '1001',
        lines: [
          { externalLineId: 'L1', quantity: 2 },
          { externalLineId: 'L2', quantity: 1 },
        ],
        carrier: 'UPS',
        trackingNumber: '1Z999',
        reference: 'rec-1001:f1',
      }),
    ])
    expect(h.store.orders.get(id)?.shipments['f1']).toMatchObject({ state: 'confirmed' })
    expect(h.store.orders.get(id)?.active).toBe(false)
    expect(h.store.connections.get(ID)!.shipments.confirmed).toBe(1)
  })

  it('says why a shipment without tracking, or one the marketplace refused, was not confirmed', async () => {
    const h = harness()
    const id = await imported(h)
    await queue(h, id, 'f1', { trackingNumber: null })
    await h.engine.runOrder(id)
    expect(h.store.orders.get(id)?.shipments['f1']).toMatchObject({ state: 'failed', message: expect.stringContaining('No tracking number') })
    h.provider.confirmShipment = jest.fn(async () => {
      throw new ProviderError('invalid', 'Invalid tracking number')
    })
    await queue(h, id, 'f2', {})
    await h.engine.runOrder(id)
    expect(h.store.orders.get(id)?.shipments['f2']).toMatchObject({ state: 'failed', message: 'Invalid tracking number', attempts: 1 })
    expect(h.store.connections.get(ID)!.shipments.failed).toBe(2)
  })

  it('retries a confirmation that failed for a moment, with a growing wait', async () => {
    const h = harness()
    const id = await imported(h)
    h.provider.confirmShipment = jest.fn(async () => {
      throw new ProviderError('transient', 'eBay had a problem (503)')
    })
    await queue(h, id, 'f1', {})
    expect(await h.engine.runOrder(id)).toBe('waiting')
    const after = h.store.orders.get(id)!
    expect(after.shipments['f1']).toMatchObject({ state: 'pending', attempts: 1 })
    expect(after.active).toBe(true)
    expect(after.nextRunAtMs).toBe(T0 + 5 * 60 * 1000)
  })

  it('keeps a shipment queued while the run worked', async () => {
    const h = harness()
    const id = await imported(h)
    await queue(h, id, 'f1', {})
    h.provider.confirmShipment = jest.fn(async () => {
      await queue(h, id, 'f2', {})
      return 'confirmed' as const
    })
    await h.engine.runOrder(id)
    const after = h.store.orders.get(id)!
    expect(after.shipments['f1'].state).toBe('confirmed')
    expect(after.shipments['f2'].state).toBe('pending')
    expect(after.active).toBe(true)
  })

  it('reads the marketplace’s fees until it states them, and records them on the order', async () => {
    const h = harness({ marketplace: 'amazon' })
    let known = false
    h.provider.orderFees = jest.fn(async () => (known ? [{ label: 'Commission', amountMinor: 300 }] : null))
    h.pages = [[marketOrder('113-1', { fees: null })]]
    await h.engine.runConnection(`${HOST}_amazon`, { force: true })
    const id = marketplaceOrderDocId(HOST, 'amazon', '113-1')
    expect(h.store.orders.get(id)).toMatchObject({ active: true, fees: null })
    await h.engine.runOrder(id, { force: true })
    expect(h.fees).toEqual([])
    known = true
    await h.engine.runOrder(id, { force: true })
    expect(h.fees).toEqual([{ recordId: 'rec-113-1', fees: [{ label: 'Commission', amountCents: 300 }] }])
    expect(h.store.orders.get(id)).toMatchObject({ active: false, fees: [{ label: 'Commission', amountMinor: 300 }] })
  })
})
