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

import type { PluginFulfillmentHolds } from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import type {
  PluginShipmentRecords,
  PluginShipmentWrite,
  PluginShippableRecord,
  PluginTrackingUpdate,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import type { PluginStockLevelRequest } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { networkConnectionId, networkOrderId, type NetworkProviderId } from '../model/networks'
import { ProviderError } from '../providers/http'
import type { FulfillmentNetworkProvider, NetworkOrder, NetworkOrderRequest, NetworkShipment } from '../providers/provider'
import { createMemoryNetworkStore } from '../testing/memory-store'
import { createEngine, networkAddress, referenceFor } from './engine'
import { emptyConnection, type StoredRouting } from './store'

const HOST = 'host-1'
const ORDER = 'order-1'

function record(overrides: Partial<PluginShippableRecord> = {}): PluginShippableRecord {
  return {
    hostId: HOST,
    recordId: ORDER,
    displayRef: '#1042',
    status: 'paid',
    shippable: true,
    currency: 'usd',
    shipTo: { name: 'Ann Lee', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
    customerEmail: 'ann@example.com',
    lines: [
      { lineIndex: 0, name: 'Tee — S', sku: 'TEE-S', quantity: 2, quantityUnshipped: 2, unitValueCents: 1_500 },
      { lineIndex: 1, name: 'Gift note', quantity: 1, quantityUnshipped: 1, unitValueCents: 0 },
      { lineIndex: 2, name: 'Mug', sku: 'MUG', quantity: 1, quantityUnshipped: 1, unitValueCents: 1_250 },
    ],
    shipments: [],
    createdAtMs: 500,
    testMode: false,
    ...overrides,
  }
}

const parcel = (overrides: Partial<NetworkShipment> = {}): NetworkShipment => ({
  id: 'p1',
  carrier: 'USPS',
  trackingNumber: '9400',
  trackingUrl: 'https://track.example/9400',
  items: [{ sku: 'TEE-S', quantity: 2 }],
  trackingStatus: 'in_transit',
  trackingDetail: null,
  shippedAtMs: 2_000_000,
  ...overrides,
})

function harness(options: { provider?: NetworkProviderId; record?: PluginShippableRecord | null } = {}) {
  const providerId = options.provider ?? 'shipbob'
  let nowMs = 1_000_000
  const store = createMemoryNetworkStore()
  const connectionId = networkConnectionId(HOST, providerId)
  const writes: PluginShipmentWrite[] = []
  const tracks: PluginTrackingUpdate[] = []
  const stockRequests: PluginStockLevelRequest[] = []
  const state = {
    record: options.record === undefined ? record() : options.record,
    others: { holds: [], unanswered: [] } as PluginFulfillmentHolds,
    open: true,
    stock: new Map<string, number>([
      ['TEE-S', 10],
      ['MUG', 3],
    ]),
    orders: new Map<string, NetworkOrder>(),
    created: [] as NetworkOrderRequest[],
    createError: null as unknown,
    cancelOutcome: 'canceled' as 'canceled' | 'too_late',
    tracking: null as { status: 'delivered' | 'in_transit'; detail: string | null } | null,
  }
  const recordedLabels = new Set<string>()
  const seller: PluginShipmentRecords = {
    read: async () => state.record,
    recordShipment: async (write) => {
      writes.push(write)
      if (write.labelRef && recordedLabels.has(write.labelRef)) return { outcome: 'already', shipmentId: 'ful-1' }
      if (write.labelRef) recordedLabels.add(write.labelRef)
      return { outcome: 'recorded', shipmentId: `ful-${writes.length}` }
    },
    recordTracking: async (update) => {
      tracks.push(update)
      return { outcome: 'recorded' }
    },
    shipFromAddresses: async () => [],
  }
  const provider: FulfillmentNetworkProvider = {
    id: providerId,
    account: jest.fn(),
    findOrder: jest.fn(async (_credential, reference) => state.orders.get(reference) ?? null),
    createOrder: jest.fn(async (_credential, request: NetworkOrderRequest) => {
      if (state.createError) throw state.createError
      state.created.push(request)
      const order: NetworkOrder = { id: `net-${request.reference}`, reference: request.reference, state: 'open', detail: null, shipments: [] }
      state.orders.set(request.reference, order)
      return order
    }),
    getOrder: jest.fn(async (_credential, _id, reference) => {
      const order = state.orders.get(reference)
      if (!order) throw new ProviderError('not-found', 'gone')
      return order
    }),
    cancelOrder: jest.fn(async () => state.cancelOutcome),
    stock: jest.fn(async (_credential, skus: readonly string[]) =>
      skus.filter((sku) => state.stock.has(sku)).map((sku) => ({ sku, fulfillable: state.stock.get(sku) ?? 0 })),
    ),
    allStock: jest.fn(async () => [...state.stock].map(([sku, fulfillable]) => ({ sku, fulfillable }))),
    ...(providerId === 'amazon-mcf' ? { tracking: jest.fn(async () => state.tracking) } : {}),
  }
  const engine = createEngine({
    now: () => nowMs,
    store,
    provider: () => provider,
    credential: async () => ({ accessToken: 'access', channelId: 'ch', marketplaceId: 'MP1' }),
    records: () => seller,
    otherHolds: async () => state.others,
    stockLevels: () => ({
      setAvailable: async (request) => {
        stockRequests.push(request)
        return request.levels.map((level) => ({ sku: level.sku, outcome: level.sku === 'MUG' ? ('unknown_sku' as const) : ('updated' as const) }))
      },
    }),
    siteOpen: async () => state.open,
  })
  const connect = async (overrides: Record<string, unknown> = {}) => {
    await store.patchConnection(connectionId, {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: providerId, sandbox: false, nowMs }),
      status: 'active',
      connectedAtMs: 1,
      marketplaceId: providerId === 'amazon-mcf' ? 'MP1' : null,
      ...overrides,
    })
  }
  const routingId = networkOrderId(HOST, ORDER, providerId)
  const queue = async (overrides: Partial<StoredRouting> = {}) => {
    await store.createRouting(routingId, {
      orgId: 'org-1',
      hostId: HOST,
      recordId: ORDER,
      provider: providerId,
      connectionId,
      displayRef: '#1042',
      status: 'queued',
      attempt: 1,
      reference: null,
      providerOrderId: null,
      lines: [],
      shipments: {},
      note: null,
      cancelRequested: false,
      active: true,
      nextRunAtMs: nowMs,
      leaseUntilMs: 0,
      failures: 0,
      testMode: false,
      lastShippedAtMs: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      ...overrides,
    })
  }
  return {
    engine,
    store,
    provider,
    state,
    writes,
    tracks,
    stockRequests,
    connect,
    queue,
    routingId,
    connectionId,
    routing: () => store.routings.get(routingId) as StoredRouting,
    advance: (ms: number) => {
      nowMs += ms
    },
    now: () => nowMs,
  }
}

describe('sending an order (AGL-3634)', () => {
  it('sends the lines the network stocks under our reference, and keeps the rest with a reason', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('sent')
    expect(h.state.created).toHaveLength(1)
    expect(h.state.created[0]).toMatchObject({
      reference: referenceFor(HOST, ORDER, 1),
      displayRef: '#1042',
      shippingMethod: 'Standard',
      items: [
        { lineIndex: 0, sku: 'TEE-S', quantity: 2, unitValueCents: 1_500 },
        { lineIndex: 2, sku: 'MUG', quantity: 1, unitValueCents: 1_250 },
      ],
      address: expect.objectContaining({ name: 'Ann Lee', state: 'MA', email: 'ann@example.com' }),
    })
    const routing = h.routing()
    expect(routing).toMatchObject({ status: 'accepted', active: true, leaseUntilMs: 0, providerOrderId: `net-${referenceFor(HOST, ORDER, 1)}` })
    expect(routing.lines.map((line) => [line.lineIndex, line.quantity, line.shippedQuantity])).toEqual([
      [0, 2, 0],
      [2, 1, 0],
    ])
    expect(routing.note).toBe('Kept for you to ship: Gift note (it has no SKU for ShipBob to match).')
    expect(h.store.connections.get(h.connectionId)?.totals.sent).toBe(1)
    expect(h.store.logs.get(h.connectionId)?.[0]).toMatchObject({ kind: 'sent', recordId: ORDER })
  })

  it('adopts the order the network already has under our reference instead of sending it twice', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    const reference = referenceFor(HOST, ORDER, 1)
    h.state.orders.set(reference, { id: 'net-earlier', reference, state: 'open', detail: null, shipments: [] })
    await h.engine.runRouting(h.routingId)
    expect(h.provider.createOrder).not.toHaveBeenCalled()
    expect(h.routing().providerOrderId).toBe('net-earlier')
  })

  it('runs one hand-off once at a time: a second run while leased does nothing', async () => {
    const h = harness()
    await h.connect()
    await h.queue({ leaseUntilMs: h.now() + 60_000 })
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('leased_elsewhere')
    expect(h.provider.createOrder).not.toHaveBeenCalled()
  })

  it('leaves out units another fulfiller holds, and waits while one cannot answer', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    h.state.others = { holds: [], unanswered: [{ providerId: 'printer', providerLabel: 'Printer' }] }
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('deferred')
    expect(h.routing().status).toBe('queued')
    h.state.others = {
      holds: [{ providerId: 'printer', providerLabel: 'Printer', lineIndex: 0, quantity: 2, state: 'accepted' }],
      unanswered: [],
    }
    h.advance(10 * 60_000)
    await h.engine.runRouting(h.routingId)
    expect(h.state.created[0].items.map((item) => item.lineIndex)).toEqual([2])
    expect(h.routing().note).toContain('Tee — S (it is already being fulfilled elsewhere)')
  })

  it('lets the network connected first take an order before another of the plugin’s own', async () => {
    const h = harness({ provider: 'amazon-mcf' })
    await h.connect({ connectedAtMs: 50 })
    await h.queue()
    await h.store.patchConnection(networkConnectionId(HOST, 'shipbob'), {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST, provider: 'shipbob', sandbox: false, nowMs: 0 }),
      status: 'active',
      connectedAtMs: 10,
    })
    await h.store.createRouting(networkOrderId(HOST, ORDER, 'shipbob'), { ...h.routing(), provider: 'shipbob', connectionId: networkConnectionId(HOST, 'shipbob') })
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('deferred')
    // ShipBob took the tee: Amazon gets only the mug.
    await h.store.patchRouting(networkOrderId(HOST, ORDER, 'shipbob'), {
      status: 'accepted',
      lines: [{ lineIndex: 0, sku: 'TEE-S', name: 'Tee — S', quantity: 2, shippedQuantity: 0 }],
    })
    h.advance(2 * 60_000)
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('sent')
    expect(h.state.created[0].items.map((item) => item.sku)).toEqual(['MUG'])
    expect(h.state.created[0].shippingSpeed).toBe('Standard')
  })

  it('sends nothing real for a test order, and nothing live to a sandbox', async () => {
    const test = harness({ record: record({ testMode: true }) })
    await test.connect()
    await test.queue()
    await expect(test.engine.runRouting(test.routingId)).resolves.toBe('skipped')
    expect(test.routing()).toMatchObject({ status: 'skipped', active: false, note: 'A test order: nothing is sent to ShipBob for it.' })
    const sandbox = harness()
    await sandbox.connect({ sandbox: true })
    await sandbox.queue()
    await sandbox.engine.runRouting(sandbox.routingId)
    expect(sandbox.routing().note).toMatch(/sandbox/)
    expect(sandbox.provider.createOrder).not.toHaveBeenCalled()
  })

  it('stops on an address the network cannot use, and on an order no longer shippable', async () => {
    const noState = harness({ record: record({ shipTo: { name: 'Ann', line1: '2 B St', city: 'Boston', postalCode: '02108', country: 'US' } }) })
    await noState.connect()
    await noState.queue()
    await expect(noState.engine.runRouting(noState.routingId)).resolves.toBe('failed')
    expect(noState.routing().note).toMatch(/no complete shipping address/)
    const cancelled = harness({ record: record({ status: 'cancelled', shippable: false }) })
    await cancelled.connect()
    await cancelled.queue()
    await cancelled.engine.runRouting(cancelled.routingId)
    expect(cancelled.routing()).toMatchObject({ status: 'skipped', note: 'Not sent: the order is cancelled.' })
  })

  it('skips an order the network stocks nothing of, saying why', async () => {
    const h = harness()
    h.state.stock = new Map([['MUG', 0]])
    await h.connect()
    await h.queue()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('skipped')
    expect(h.routing().note).toBe(
      'Kept for you to ship: Tee — S (ShipBob does not stock its SKU); Gift note (it has no SKU for ShipBob to match); Mug (ShipBob does not have enough of it in stock).',
    )
    expect(h.provider.createOrder).not.toHaveBeenCalled()
  })

  it('does not send while paused, unless a member sends it', async () => {
    const h = harness()
    await h.connect({ status: 'paused' })
    await h.queue()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('skipped')
    await h.store.patchRouting(h.routingId, { status: 'queued', active: true })
    await expect(h.engine.runRouting(h.routingId, { force: true })).resolves.toBe('sent')
  })

  it('needs an Amazon marketplace before it sends', async () => {
    const h = harness({ provider: 'amazon-mcf' })
    await h.connect({ marketplaceId: null })
    await h.queue()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('failed')
    expect(h.routing().note).toMatch(/marketplace/)
  })

  it('waits while the site cannot run the plugin, or the grant needs connecting again', async () => {
    const h = harness()
    await h.connect({ status: 'reconnect' })
    await h.queue()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('deferred')
    await h.connect()
    h.state.open = false
    h.advance(2 * 60 * 60_000)
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('deferred')
    expect(h.routing()).toMatchObject({ status: 'queued', active: true })
  })
})

describe('when the network refuses or is unreachable (AGL-3634)', () => {
  it('turns a refused grant into connect again, and keeps the order queued', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    h.state.createError = new ProviderError('auth', 'expired')
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('deferred')
    expect(h.store.connections.get(h.connectionId)).toMatchObject({ status: 'reconnect', lastError: expect.stringMatching(/Connect again/) })
    expect(h.routing().status).toBe('queued')
  })

  it('stops on a refusal with the network’s own words', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    h.state.createError = new ProviderError('invalid', 'Zip code is invalid')
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('failed')
    expect(h.routing()).toMatchObject({ status: 'failed', active: false, note: 'ShipBob refused the order: Zip code is invalid' })
  })

  it('retries a blip with backoff, and stops after six tries', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    h.state.createError = new ProviderError('transient', 'ShipBob could not be reached')
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('retry')
    expect(h.routing().nextRunAtMs - h.now()).toBe(5 * 60_000)
    for (let attempt = 2; attempt <= 6; attempt += 1) {
      h.advance(7 * 60 * 60_000)
      await h.engine.runRouting(h.routingId)
    }
    expect(h.routing()).toMatchObject({ status: 'failed', active: false, failures: 6 })
    expect(h.routing().note).toMatch(/after 6 tries/)
  })
})

describe('reading back what shipped (AGL-3634)', () => {
  async function sent(provider: NetworkProviderId = 'shipbob') {
    const h = harness({ provider })
    await h.connect()
    await h.queue()
    await h.engine.runRouting(h.routingId)
    h.advance(20 * 60_000)
    return h
  }

  it('writes each parcel onto the order once, under its own key, with the lines it held', async () => {
    const h = await sent()
    const order = h.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder
    order.shipments = [parcel()]
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('read')
    expect(h.writes).toEqual([
      {
        hostId: HOST,
        recordId: ORDER,
        lines: [{ lineIndex: 0, quantity: 2 }],
        carrier: 'USPS',
        trackingNumber: '9400',
        trackingUrl: 'https://track.example/9400',
        labelRef: 'shipbob:p1',
      },
    ])
    expect(h.routing()).toMatchObject({ status: 'partially_shipped', active: true })
    expect(h.routing().shipments['p1']).toMatchObject({ recordedShipmentId: 'ful-1', trackingNumber: '9400' })
    h.advance(20 * 60_000)
    await h.engine.runRouting(h.routingId)
    expect(h.writes).toHaveLength(1)
    expect(h.store.connections.get(h.connectionId)?.totals.shipped).toBe(1)
  })

  it('waits for a parcel’s tracking number before writing it', async () => {
    const h = await sent()
    ;(h.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder).shipments = [parcel({ trackingNumber: null })]
    await h.engine.runRouting(h.routingId)
    expect(h.writes).toEqual([])
    expect(h.routing().shipments).toEqual({})
  })

  it('finishes a ShipBob order once everything shipped: deliveries arrive by webhook', async () => {
    const h = await sent()
    ;(h.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder).shipments = [
      parcel(),
      parcel({ id: 'p2', trackingNumber: '9401', items: [{ sku: 'MUG', quantity: 1 }] }),
    ]
    await h.engine.runRouting(h.routingId)
    expect(h.routing()).toMatchObject({ status: 'shipped', active: false })
    await expect(h.engine.applyShipbobEvent(h.connectionId, 'shipment_delivered', { orderId: h.routing().providerOrderId, shipmentId: 'p2' })).resolves.toBe('applied')
    expect(h.tracks).toEqual([expect.objectContaining({ recordId: ORDER, trackingNumber: '9401', status: 'delivered' })])
    expect(h.routing().shipments['p2'].trackingStatus).toBe('delivered')
    await expect(h.engine.applyShipbobEvent(h.connectionId, 'shipment_delivered', { orderId: 'someone-else', shipmentId: 'p2' })).resolves.toBe('unknown_order')
  })

  it('follows Amazon parcels until they arrive, then stops', async () => {
    const h = await sent('amazon-mcf')
    ;(h.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder).shipments = [
      parcel({ id: 'D1:1', items: [{ sku: 'TEE-S', quantity: 2, lineIndex: 0 }, { sku: 'MUG', quantity: 1, lineIndex: 2 }], packageNumber: '1' }),
    ]
    h.state.tracking = { status: 'in_transit', detail: null }
    await h.engine.runRouting(h.routingId)
    expect(h.routing()).toMatchObject({ status: 'shipped', active: true })
    expect(h.tracks).toEqual([])
    h.state.tracking = { status: 'delivered', detail: 'Left at door' }
    h.advance(3 * 60 * 60_000)
    await h.engine.runRouting(h.routingId)
    expect(h.tracks).toEqual([expect.objectContaining({ status: 'delivered', detail: 'Left at door', trackingNumber: '9400' })])
    expect(h.routing()).toMatchObject({ status: 'shipped', active: false })
  })

  it('records the network canceling, and a refusal it reports later', async () => {
    const h = await sent()
    ;(h.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder).state = 'canceled'
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('canceled')
    expect(h.routing()).toMatchObject({ status: 'canceled', active: false })
    const r = await sent('amazon-mcf')
    const order = r.state.orders.get(referenceFor(HOST, ORDER, 1)) as NetworkOrder
    order.state = 'refused'
    order.detail = 'Amazon could not fulfill the order (Unfulfillable).'
    await expect(r.engine.runRouting(r.routingId)).resolves.toBe('failed')
    expect(r.routing().note).toBe('Amazon could not fulfill the order (Unfulfillable).')
  })

  it('says so when the network no longer has the order', async () => {
    const h = await sent()
    h.state.orders.clear()
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('failed')
    expect(h.routing().note).toMatch(/no longer has this order/)
  })
})

describe('canceling (AGL-3634)', () => {
  it('cancels a queued order without asking the network', async () => {
    const h = harness()
    await h.connect()
    await h.queue({ cancelRequested: true })
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('canceled')
    expect(h.provider.cancelOrder).not.toHaveBeenCalled()
    expect(h.routing()).toMatchObject({ status: 'canceled', active: false })
  })

  it('asks the network, and keeps reading back when it is too late', async () => {
    const h = harness()
    await h.connect()
    await h.queue()
    await h.engine.runRouting(h.routingId)
    await h.store.patchRouting(h.routingId, { cancelRequested: true, nextRunAtMs: h.now() })
    h.state.cancelOutcome = 'too_late'
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('read')
    expect(h.routing()).toMatchObject({ cancelRequested: false, active: true, note: expect.stringMatching(/could not cancel/) })
    await h.store.patchRouting(h.routingId, { cancelRequested: true, nextRunAtMs: h.now() })
    h.state.cancelOutcome = 'canceled'
    await expect(h.engine.runRouting(h.routingId)).resolves.toBe('canceled')
    expect(h.routing()).toMatchObject({ status: 'canceled', active: false })
    expect(h.store.connections.get(h.connectionId)?.totals.canceled).toBe(1)
  })
})

describe('counting stock (AGL-3634)', () => {
  it('keeps the count and, when asked, sets the store’s counts less what is queued but unsent', async () => {
    const h = harness()
    await h.connect({ syncInventory: true })
    await h.queue({ lines: [{ lineIndex: 0, sku: 'TEE-S', name: 'Tee', quantity: 2, shippedQuantity: 0 }] })
    await expect(h.engine.runInventory(h.connectionId)).resolves.toBe('counted')
    expect(h.stockRequests).toEqual([
      {
        hostId: HOST,
        source: 'ShipBob',
        levels: [
          { sku: 'TEE-S', quantity: 8 },
          { sku: 'MUG', quantity: 3 },
        ],
      },
    ])
    const connection = h.store.connections.get(h.connectionId)
    expect(connection?.stock).toEqual({ 'TEE-S': 10, MUG: 3 })
    expect(connection?.inventory).toMatchObject({ skus: 2, updated: 1, unknown: 1 })
    expect(connection?.inventoryDueAtMs).toBe(h.now() + 60 * 60_000)
    // Not due again until the hour is up.
    await expect(h.engine.runInventory(h.connectionId)).resolves.toBe('skipped')
  })

  it('counts without touching the store when the merchant did not ask', async () => {
    const h = harness()
    await h.connect()
    await h.engine.runInventory(h.connectionId)
    expect(h.stockRequests).toEqual([])
    expect(h.store.connections.get(h.connectionId)?.inventory.skus).toBe(2)
  })

  it('turns a refused grant into connect again', async () => {
    const h = harness()
    await h.connect()
    ;(h.provider.allStock as jest.Mock).mockRejectedValueOnce(new ProviderError('auth', 'revoked'))
    await expect(h.engine.runInventory(h.connectionId)).resolves.toBe('failed')
    expect(h.store.connections.get(h.connectionId)?.status).toBe('reconnect')
  })
})

describe('the address a network ships to (AGL-3634)', () => {
  it('needs a name, street, city, postal code and country, and a state in the US and Canada', () => {
    expect(networkAddress(record())).toMatchObject({ country: 'US', state: 'MA' })
    expect(networkAddress(record({ shipTo: { name: 'A', line1: '1 St', city: 'London', postalCode: 'N1', country: 'gb' } }))).toMatchObject({ country: 'GB' })
    expect(networkAddress(record({ shipTo: { name: 'A', line1: '1 St', city: 'Toronto', postalCode: 'M5V', country: 'CA' } }))).toBeNull()
    expect(networkAddress(record({ shipTo: undefined }))).toBeNull()
  })

  it('makes a reference of at most forty characters, new per send', () => {
    expect(referenceFor(HOST, ORDER, 1)).toMatch(/^ag[0-9a-f]{30}$/)
    expect(referenceFor(HOST, ORDER, 2)).toBe(`${referenceFor(HOST, ORDER, 1)}-2`)
    expect(referenceFor(HOST, ORDER, 12).length).toBeLessThanOrEqual(40)
  })
})
