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

import type { CatalogOffer, PluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import type { PluginStockLevelRequest, PluginStockLevels } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { SEND_MAX_ATTEMPTS, STOCK_FULL_INTERVAL_MS } from '../constants'
import { inventoryOrderId } from '../model/inventory-sync'
import { ProviderError } from '../providers/http'
import type { InventorySystemProvider, SystemOrderRequest, SystemStockChange } from '../providers/provider'
import { createMemoryInventoryStore, type MemoryInventoryStore } from '../testing/memory-store'
import { createEngine, retryDelayMs, type SourcedProductWriterLike } from './engine'
import { emptyConnection, productLinkId, type StoredConnection, type StoredOrder } from './store'

const HOST = 'host-1'
const T0 = Date.UTC(2026, 9, 7, 12)

function fakeSystem(overrides: Partial<InventorySystemProvider> = {}): InventorySystemProvider & {
  created: SystemOrderRequest[]
  adjusted: SystemStockChange[][]
} {
  const created: SystemOrderRequest[] = []
  const adjusted: SystemStockChange[][] = []
  return {
    id: 'cin7-core',
    created,
    adjusted,
    account: async () => ({ accountName: 'Acme' }),
    locations: async () => [{ id: 'Main', name: 'Main' }],
    stock: async () => [],
    adjustStock: async (_credential, input) => {
      adjusted.push(input.changes)
    },
    products: async () => ({ products: [], nextCursor: null }),
    productIdsBySku: async (_credential, skus) => new Map(skus.map((sku) => [sku, `pid-${sku}`])),
    createProduct: async (_credential, product) => ({ id: `new-${product.sku}` }),
    customerExists: async () => true,
    findOrder: async () => null,
    createOrder: async (_credential, request) => {
      created.push(request)
      return { id: 'sale-1', number: 'SO-1' }
    },
    cancelOrder: async () => 'canceled',
    ...overrides,
  }
}

function connection(patch: Partial<StoredConnection> = {}): StoredConnection {
  return {
    ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'cin7-core', nowMs: T0 }),
    status: 'active',
    connectedAtMs: T0,
    sealedCredential: 'sealed',
    orderCustomer: 'Web Sales',
    sendOrders: true,
    ...patch,
  }
}

function handOff(patch: Partial<StoredOrder> = {}): StoredOrder {
  return {
    orgId: 'org-1',
    hostId: HOST,
    recordId: 'order-1',
    provider: 'cin7-core',
    connectionId: HOST,
    displayRef: '#1042',
    reference: 'AG1042-abcdef12',
    status: 'queued',
    lines: [{ lineIndex: 0, sku: 'TEE-M', name: 'Tee', quantity: 2, unitAmountCents: 1999 }],
    skippedLines: [],
    snapshot: {
      orderedAtMs: T0,
      currency: 'USD',
      buyerName: 'Ada',
      buyerEmail: 'ada@example.com',
      shippingAddress: null,
      shippingCents: 500,
      discountCents: 0,
      taxCents: 0,
      totalCents: 4498,
    },
    externalId: null,
    externalNumber: null,
    note: null,
    cancelRequested: false,
    active: true,
    nextRunAtMs: T0,
    leaseUntilMs: 0,
    attempts: 0,
    createdAtMs: T0,
    updatedAtMs: T0,
    ...patch,
  }
}

function offer(sku: string, quantity: number | null, patch: Partial<CatalogOffer> = {}): CatalogOffer {
  return {
    id: `prod-${sku}`,
    groupId: `prod-${sku}`,
    hasVariants: false,
    productId: `prod-${sku}`,
    variantId: '',
    sku,
    productName: sku,
    title: sku,
    description: '',
    path: `/products/${sku}`,
    additionalImageUrls: [],
    priceMinor: 1500,
    availability: 'in_stock',
    quantity,
    kind: 'physical',
    subscriptionOnly: false,
    options: {},
    shipping: [],
    ...patch,
  }
}

function setup(options: {
  system?: ReturnType<typeof fakeSystem>
  connection?: Partial<StoredConnection>
  offers?: CatalogOffer[]
  writer?: SourcedProductWriterLike
  siteOpen?: boolean
} = {}) {
  let now = T0
  const store = createMemoryInventoryStore()
  const system = options.system ?? fakeSystem()
  const applied: PluginStockLevelRequest[] = []
  const levels: PluginStockLevels = {
    setAvailable: async (request) => {
      applied.push(request)
      return request.levels.map((level) => ({
        sku: level.sku,
        outcome: level.sku === 'GHOST' ? 'unknown_sku' : level.sku === 'FLAKY' ? 'failed' : 'updated',
      }))
    },
  }
  const catalog: PluginProductCatalog = {
    store: async () => ({ hostId: HOST, name: 'Shop', origin: null, currency: 'USD', productPagesServed: true, carrierPricedCountries: [] }),
    page: async () => ({ offers: options.offers ?? [], nextCursor: null }),
  }
  store.connections.set(HOST, connection(options.connection))
  const engine = createEngine({
    now: () => now,
    store,
    provider: () => system,
    credential: async () => ({ provider: 'cin7-core', accountId: 'a', apiKey: 'k' }),
    stockLevels: () => levels,
    catalog: () => catalog,
    productWriter: () => options.writer,
    siteOpen: async () => options.siteOpen ?? true,
  })
  return {
    store,
    system,
    engine,
    applied,
    tick: (ms: number) => {
      now += ms
    },
  }
}

const ORDER_ID = inventoryOrderId(HOST, 'order-1')
const order = (store: MemoryInventoryStore) => store.orders.get(ORDER_ID) as StoredOrder

describe('sending orders (AGL-3642)', () => {
  it('sends a queued order once, with the system’s product ids, and counts it', async () => {
    const { store, system, engine } = setup()
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('sent')
    expect(system.created).toHaveLength(1)
    expect(system.created[0]).toMatchObject({
      reference: 'AG1042-abcdef12',
      customer: 'Web Sales',
      lines: [{ sku: 'TEE-M', productId: 'pid-TEE-M', quantity: 2, unitAmountCents: 1999 }],
      shippingCents: 500,
    })
    expect(order(store)).toMatchObject({ status: 'sent', active: false, externalId: 'sale-1', externalNumber: 'SO-1' })
    expect(store.connections.get(HOST)?.totals.ordersSent).toBe(1)
    // A second run finds nothing to do.
    await expect(engine.runOrder(ORDER_ID, { force: true })).resolves.toBe('idle')
    expect(system.created).toHaveLength(1)
  })

  it('adopts an order an attempt that timed out already made, instead of sending it twice', async () => {
    const system = fakeSystem({ findOrder: async () => ({ id: 'sale-9', number: 'SO-9' }) })
    const { store, engine } = setup({ system })
    store.orders.set(ORDER_ID, handOff({ attempts: 1 }))
    await engine.runOrder(ORDER_ID)
    expect(system.created).toHaveLength(0)
    expect(order(store)).toMatchObject({ status: 'sent', externalId: 'sale-9' })
  })

  it('stops at once, with the reason, when the system lacks a SKU', async () => {
    const system = fakeSystem({ productIdsBySku: async () => new Map() })
    const { store, engine } = setup({ system })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('failed')
    expect(order(store)).toMatchObject({ status: 'failed', active: false })
    expect(order(store).note).toContain('TEE-M')
    expect(store.connections.get(HOST)?.totals.ordersFailed).toBe(1)
    expect(store.logs.get(HOST)?.[0].kind).toBe('error')
  })

  it('asks for the customer before sending when none is chosen', async () => {
    const { store, system, engine } = setup({ connection: { orderCustomer: '' } })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('failed')
    expect(system.created).toHaveLength(0)
    expect(order(store).note).toMatch(/customer for web orders/i)
  })

  it('retries a transient failure with backoff, then stops and asks the merchant', async () => {
    const system = fakeSystem({
      createOrder: async () => {
        throw new ProviderError('transient', 'Cin7 Core had a problem (502)')
      },
    })
    const { store, engine, tick } = setup({ system })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('retry')
    expect(order(store)).toMatchObject({ status: 'queued', attempts: 1, nextRunAtMs: T0 + retryDelayMs(1), leaseUntilMs: 0 })
    for (let attempt = 2; attempt <= SEND_MAX_ATTEMPTS; attempt += 1) {
      tick(retryDelayMs(attempt))
      await engine.runOrder(ORDER_ID)
    }
    expect(order(store)).toMatchObject({ status: 'failed', active: false, attempts: SEND_MAX_ATTEMPTS })
  })

  it('turns the connection to connect-again on a refused key, and the order waits uncounted', async () => {
    const system = fakeSystem({
      findOrder: async () => {
        throw new ProviderError('auth', 'refused')
      },
    })
    const { store, engine } = setup({ system })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('waiting')
    expect(store.connections.get(HOST)?.status).toBe('reconnect')
    expect(order(store)).toMatchObject({ status: 'queued', attempts: 0, active: true })
    // While the connection waits, the order waits too.
    await expect(engine.runOrder(ORDER_ID, { force: true })).resolves.toBe('waiting')
  })

  it('holds the whole connection when the system asks to slow down', async () => {
    const system = fakeSystem({
      productIdsBySku: async () => {
        throw new ProviderError('rate-limit', 'slow down', { retryAfterMs: 90_000 })
      },
    })
    const { store, engine } = setup({ system })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('waiting')
    expect(store.connections.get(HOST)?.holdUntilMs).toBe(T0 + 90_000)
    expect(order(store)).toMatchObject({ attempts: 0, nextRunAtMs: T0 + 90_000 })
  })

  it('never runs one order in two places at once', async () => {
    const { store, engine } = setup()
    store.orders.set(ORDER_ID, handOff({ leaseUntilMs: T0 + 60_000 }))
    await expect(engine.runOrder(ORDER_ID, { force: true })).resolves.toBe('leased_elsewhere')
  })

  it('waits while the site is locked or no longer entitled', async () => {
    const { store, system, engine } = setup({ siteOpen: false })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('waiting')
    expect(system.created).toHaveLength(0)
  })
})

describe('canceling orders (AGL-3642)', () => {
  it('cancels an order never sent without calling create, after checking the system has none', async () => {
    const { store, system, engine } = setup()
    store.orders.set(ORDER_ID, handOff({ cancelRequested: true, note: 'The order was canceled.' }))
    await expect(engine.runOrder(ORDER_ID)).resolves.toBe('canceled')
    expect(system.created).toHaveLength(0)
    expect(order(store)).toMatchObject({ status: 'canceled', active: false })
  })

  it('voids a sent order in the system', async () => {
    const cancelled: string[] = []
    const system = fakeSystem({
      cancelOrder: async (_credential, held) => {
        cancelled.push(held.id)
        return 'canceled'
      },
    })
    const { store, engine } = setup({ system })
    store.orders.set(ORDER_ID, handOff({ status: 'sent', externalId: 'sale-1', cancelRequested: true }))
    await engine.runOrder(ORDER_ID)
    expect(cancelled).toEqual(['sale-1'])
    expect(order(store)).toMatchObject({ status: 'canceled', active: false })
  })

  it('tells the merchant to cancel in a system whose API cannot', async () => {
    const system = fakeSystem({ cancelOrder: async () => 'unsupported' })
    const { store, engine } = setup({ system, connection: { provider: 'brightpearl', orderCustomer: '207' } })
    store.orders.set(ORDER_ID, handOff({ provider: 'brightpearl', status: 'sent', externalId: '501', externalNumber: '501', cancelRequested: true }))
    await engine.runOrder(ORDER_ID)
    expect(order(store)).toMatchObject({ status: 'sent', active: false })
    expect(order(store).note).toContain('Cancel it in Brightpearl')
  })
})

describe('stock from the system (AGL-3642)', () => {
  it('sets the store’s counts from the system’s, less what is queued and unsent', async () => {
    const system = fakeSystem({
      stock: async () => [
        { sku: 'TEE-M', productId: 'p-1', available: 10, onHand: 12 },
        { sku: 'GHOST', productId: 'p-2', available: 1, onHand: 1 },
      ],
    })
    const { store, engine, applied } = setup({ system, connection: { stockSource: 'system' } })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runStock(HOST)).resolves.toBe('synced')
    expect(applied[0]).toEqual({
      hostId: HOST,
      source: 'Cin7 Core',
      levels: [
        { sku: 'TEE-M', quantity: 8 },
        { sku: 'GHOST', quantity: 1 },
      ],
    })
    expect(store.connections.get(HOST)?.stock).toMatchObject({ skus: 2, updated: 1, unknown: 1, direction: 'system' })
  })

  it('writes only what changed between full syncs, and everything once a day', async () => {
    const system = fakeSystem({ stock: async () => [{ sku: 'TEE-M', productId: 'p-1', available: 5, onHand: 5 }] })
    const { engine, applied, tick } = setup({ system, connection: { stockSource: 'system' } })
    await engine.runStock(HOST)
    tick(60 * 60 * 1000)
    await engine.runStock(HOST)
    expect(applied).toHaveLength(1)
    tick(STOCK_FULL_INTERVAL_MS)
    await engine.runStock(HOST)
    expect(applied).toHaveLength(2)
  })

  it('tries a count that did not land again on the next run', async () => {
    const system = fakeSystem({ stock: async () => [{ sku: 'FLAKY', productId: 'p-1', available: 5, onHand: 5 }] })
    const { store, engine, applied, tick } = setup({ system, connection: { stockSource: 'system' } })
    await expect(engine.runStock(HOST)).resolves.toBe('failed')
    expect(store.connections.get(HOST)?.lastCounts).toEqual({})
    tick(60 * 60 * 1000)
    await engine.runStock(HOST)
    expect(applied).toHaveLength(2)
  })

  it('does nothing while counts are not synced', async () => {
    const { store, engine, applied } = setup()
    await expect(engine.runStock(HOST)).resolves.toBe('skipped')
    expect(applied).toHaveLength(0)
    expect(store.connections.get(HOST)?.stockLeaseUntilMs).toBe(0)
  })
})

describe('stock from the store (AGL-3642)', () => {
  it('adjusts the system’s counts by the difference, counting queued orders as still on its shelf', async () => {
    const system = fakeSystem({
      stock: async () => [
        { sku: 'TEE-M', productId: 'p-1', available: 10, onHand: 12 },
        { sku: 'CAP', productId: 'p-2', available: 4, onHand: 4 },
        { sku: 'SYS-ONLY', productId: 'p-3', available: 4, onHand: 4 },
      ],
    })
    const { store, engine } = setup({
      system,
      connection: { stockSource: 'store', locationId: 'Main' },
      offers: [offer('TEE-M', 5), offer('CAP', 4), offer('STORE-ONLY', 1), offer('UNTRACKED', null)],
    })
    store.orders.set(ORDER_ID, handOff())
    await expect(engine.runStock(HOST)).resolves.toBe('synced')
    // TEE-M: the store holds 5 and 2 are paid and unsent → 7 at the system.
    expect(system.adjusted).toEqual([[{ sku: 'TEE-M', productId: 'p-1', delta: -3, onHand: 12 }]])
    expect(store.connections.get(HOST)?.stock).toMatchObject({ updated: 1, unchanged: 1, unknown: 1 })
  })

  it('a second run with nothing changed adjusts by nothing', async () => {
    let available = 10
    const system = fakeSystem({
      stock: async () => [{ sku: 'TEE-M', productId: 'p-1', available, onHand: available }],
      adjustStock: async (_credential, input) => {
        available += input.changes[0].delta
      },
    })
    const { engine, tick } = setup({ system, connection: { stockSource: 'store', locationId: 'Main' }, offers: [offer('TEE-M', 6)] })
    await engine.runStock(HOST)
    expect(available).toBe(6)
    tick(STOCK_FULL_INTERVAL_MS + 1)
    await engine.runStock(HOST, { force: true })
    expect(available).toBe(6)
  })

  it('needs a location to push counts to', async () => {
    const { store, engine } = setup({ connection: { stockSource: 'store', locationId: null } })
    await expect(engine.runStock(HOST)).resolves.toBe('failed')
    expect(store.connections.get(HOST)?.lastError).toMatch(/location/i)
  })

  it('counts a refused batch and goes on with the rest', async () => {
    const skus = Array.from({ length: 150 }, (_, index) => `S${index}`)
    let call = 0
    const system = fakeSystem({
      stock: async () => skus.map((sku) => ({ sku, productId: sku, available: 0, onHand: 0 })),
      adjustStock: async () => {
        call += 1
        if (call === 1) throw new ProviderError('invalid', 'bad line')
      },
    })
    const { store, engine } = setup({ system, connection: { stockSource: 'store', locationId: 'Main' }, offers: skus.map((sku) => offer(sku, 1)) })
    await expect(engine.runStock(HOST)).resolves.toBe('failed')
    expect(store.connections.get(HOST)?.stock).toMatchObject({ updated: 50, failed: 100 })
  })
})

describe('products (AGL-3642)', () => {
  it('makes store products the system lacks, and links those it has', async () => {
    const system = fakeSystem({ productIdsBySku: async () => new Map([['CAP', 'sys-cap']]) })
    const made: string[] = []
    system.createProduct = async (_credential, product) => {
      made.push(product.sku)
      return { id: `new-${product.sku}` }
    }
    const { store, engine } = setup({ system, connection: { productSync: 'export' }, offers: [offer('TEE-M', 1), offer('CAP', 1), offer('', 1)] })
    await expect(engine.runProducts(HOST)).resolves.toBe('synced')
    expect(made).toEqual(['TEE-M'])
    expect(store.connections.get(HOST)?.products).toMatchObject({ created: 1, unchanged: 1, failed: 0 })
    // Linked: a second run makes nothing.
    await engine.runProducts(HOST, { force: true })
    expect(made).toEqual(['TEE-M'])
  })

  it('refuses to make products in Brightpearl', async () => {
    const { store, engine } = setup({ connection: { provider: 'brightpearl', productSync: 'export' }, offers: [offer('TEE-M', 1)] })
    await expect(engine.runProducts(HOST)).resolves.toBe('failed')
    expect(store.connections.get(HOST)?.lastError).toMatch(/made in Brightpearl/)
  })

  it('imports the system’s products as drafts through the product writer, once per version', async () => {
    const writes: Array<Parameters<SourcedProductWriterLike['upsertSourced']>[0]> = []
    const writer: SourcedProductWriterLike = {
      upsertSourced: async (write) => {
        writes.push(write)
        return { outcome: write.productId ? 'updated' : 'created', productId: 'prod-1', variants: [{ key: 'p-1', variantId: 'var-1' }] }
      },
    }
    let version = 'v1'
    const system = fakeSystem({
      products: async () => ({
        products: [{ id: 'p-1', sku: 'TEE-M', name: 'Tee', description: '', priceMinor: 1999, weightGrams: 200, barcode: null, version, active: true }],
        nextCursor: null,
      }),
    })
    const { store, engine } = setup({ system, writer, connection: { productSync: 'import' } })
    await engine.runProducts(HOST)
    expect(writes[0]).toMatchObject({
      hostId: HOST,
      status: 'draft',
      prices: true,
      content: false,
      product: { sourceKey: 'cin7-core:p-1', variants: [{ key: 'p-1', sku: 'TEE-M', priceMinor: 1999, available: true }] },
    })
    const link = store.links.get(productLinkId(HOST, 'cin7-core', 'p-1'))
    expect(link).toMatchObject({ productId: 'prod-1', variantId: 'var-1', version: 'v1' })
    expect(store.connections.get(HOST)?.productsSinceMs).toBe(T0)
    await engine.runProducts(HOST, { force: true })
    expect(writes).toHaveLength(1)
    version = 'v2'
    await engine.runProducts(HOST, { force: true })
    expect(writes[1]).toMatchObject({ productId: 'prod-1', recreate: false })
  })

  it('leaves a product the merchant deleted deleted', async () => {
    const writer: SourcedProductWriterLike = { upsertSourced: async () => ({ outcome: 'missing' }) }
    const system = fakeSystem({
      products: async () => ({
        products: [{ id: 'p-1', sku: 'TEE-M', name: 'Tee', description: '', priceMinor: 1999, weightGrams: null, barcode: null, version: 'v2', active: true }],
        nextCursor: null,
      }),
    })
    const { store, engine } = setup({ system, writer, connection: { productSync: 'import' } })
    store.links.set(productLinkId(HOST, 'cin7-core', 'p-1'), {
      orgId: 'org-1',
      hostId: HOST,
      provider: 'cin7-core',
      direction: 'import',
      externalId: 'p-1',
      sku: 'TEE-M',
      version: 'v1',
      productId: 'prod-1',
      variantId: 'var-1',
      error: null,
      updatedAtMs: T0,
    })
    await engine.runProducts(HOST)
    expect(store.links.get(productLinkId(HOST, 'cin7-core', 'p-1'))).toMatchObject({ error: 'deleted', version: 'v2' })
  })

  it('stops at the plan’s product allowance and says so', async () => {
    const writer: SourcedProductWriterLike = { upsertSourced: async () => ({ outcome: 'plan_limit', limit: 25 }) }
    const system = fakeSystem({
      products: async () => ({
        products: [{ id: 'p-1', sku: 'A', name: 'A', description: '', priceMinor: 100, weightGrams: null, barcode: null, version: 'v', active: true }],
        nextCursor: null,
      }),
    })
    const { store, engine } = setup({ system, writer, connection: { productSync: 'import' } })
    await engine.runProducts(HOST)
    expect(store.connections.get(HOST)?.lastError).toMatch(/allows 25 products/)
  })

  it('imports nothing without a price in the store’s currency', async () => {
    const writer: SourcedProductWriterLike = { upsertSourced: jest.fn() }
    const system = fakeSystem({
      products: async () => ({
        products: [{ id: 'p-1', sku: 'A', name: 'A', description: '', priceMinor: null, weightGrams: null, barcode: null, version: 'v', active: true }],
        nextCursor: null,
      }),
    })
    const { store, engine } = setup({ system, writer, connection: { productSync: 'import' } })
    await expect(engine.runProducts(HOST)).resolves.toBe('failed')
    expect(writer.upsertSourced).not.toHaveBeenCalled()
    expect(store.connections.get(HOST)?.products.failed).toBe(1)
  })

  it('keeps its place when a rate limit cuts a run short', async () => {
    let calls = 0
    const system = fakeSystem({
      products: async (_credential, input) => {
        calls += 1
        if (calls === 2) throw new ProviderError('rate-limit', 'slow', { retryAfterMs: 30_000 })
        return { products: [], nextCursor: input.cursor ? null : 'page-2' }
      },
    })
    const writer: SourcedProductWriterLike = { upsertSourced: jest.fn() }
    const { store, engine } = setup({ system, writer, connection: { productSync: 'import' } })
    await expect(engine.runProducts(HOST)).resolves.toBe('failed')
    expect(store.connections.get(HOST)).toMatchObject({ productsCursor: 'page-2', holdUntilMs: T0 + 30_000, productsDueAtMs: T0 + 30_000 })
  })
})
