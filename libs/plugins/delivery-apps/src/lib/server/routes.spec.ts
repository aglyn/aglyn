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

import type { PluginChannelOrders } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { createHmac } from 'node:crypto'
import type { DeliveryServiceId } from '../model/delivery-apps'
import { createDoordashProvider } from '../providers/doordash'
import type { DeliveryProvider } from '../providers/provider'
import { createUberEatsProvider } from '../providers/uber-eats'
import { DOORDASH_ORDER_CREATE, UBER_ORDER_NOTIFICATION } from '../testing/fixtures'
import { memoryDeliveryStore } from '../testing/memory-store'
import { mockHttp } from '../testing/mock-http'
import { readDeliveryAppsConfig, type DeliveryAppsConfig } from './config'
import { createEngine } from './engine'
import { createDeliveryRoutes, fail, type DeliveryGateKind } from './routes'
import { orderDocId, storeDocId } from './store'

const NOW = Date.parse('2026-10-07T18:01:00Z')
const HOST = 'host1'
const BASE = 'https://console.example.com/api/'

const CONFIG: DeliveryAppsConfig = readDeliveryAppsConfig({
  DELIVERY_APPS_DOORDASH_DEVELOPER_ID: 'dev',
  DELIVERY_APPS_DOORDASH_KEY_ID: 'key',
  DELIVERY_APPS_DOORDASH_SIGNING_SECRET: Buffer.from('secret').toString('base64url'),
  DELIVERY_APPS_DOORDASH_WEBHOOK_SECRET: 'hook-token',
  DELIVERY_APPS_UBER_EATS_CLIENT_ID: 'uber',
  DELIVERY_APPS_UBER_EATS_CLIENT_SECRET: 'uber-secret',
  DELIVERY_APPS_UBER_EATS_ENVIRONMENT: 'sandbox',
})

const seller: PluginChannelOrders = {
  importOrder: async (order) => ({
    outcome: 'created',
    recordId: `rec-${order.externalOrderId}`,
    displayRef: '#7',
    lines: order.lines.map((line, lineIndex) => ({ lineIndex, externalLineId: line.externalLineId })),
    shortfalls: [],
    unmatched: [],
  }),
  cancelOrder: async () => ({ outcome: 'cancelled', restockedUnits: 0 }),
  recordFees: async () => 'recorded',
}

function setup(options: { config?: DeliveryAppsConfig; who?: { hostId: string; kinds: DeliveryGateKind[] } | null } = {}) {
  const store = memoryDeliveryStore()
  const config = options.config ?? CONFIG
  const ddHttp = mockHttp([{ match: 'openapi.doordash.com', body: {} }])
  const uberHttp = mockHttp([{ match: 'uber.com', status: 503, body: {} }])
  const providers: Partial<Record<DeliveryServiceId, DeliveryProvider>> = {
    ...(config.doordash ? { doordash: createDoordashProvider({ config: config.doordash, http: ddHttp.http, now: () => NOW }) } : {}),
    ...(config['uber-eats'] ? { 'uber-eats': createUberEatsProvider({ config: config['uber-eats'], http: uberHttp.http, now: () => NOW }) } : {}),
  }
  const who = options.who === undefined ? { hostId: HOST, kinds: ['settings', 'register'] as DeliveryGateKind[] } : options.who
  const gate = async (request: Request, kind: DeliveryGateKind) => {
    if (!who) return fail(401, 'Unauthenticated')
    if (!who.kinds.includes(kind)) return fail(403, 'Not permitted')
    const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    return { orgId: 'org1', hostId: who.hostId, uid: 'u1', body }
  }
  const provider = (id: DeliveryServiceId) => providers[id] ?? null
  const engine = createEngine({
    now: () => NOW,
    store,
    provider,
    sandbox: (id) => config[id]?.sandbox === true,
    channelOrders: () => seller,
    catalog: () => undefined,
    siteOpen: async () => true,
  })
  const routes = createDeliveryRoutes({ now: () => NOW, config: () => config, store, provider, engine, gate })
  return { routes, store, ddHttp }
}

const get = (path: string, query: Record<string, string> = {}) =>
  new Request(`${BASE}${path}?${new URLSearchParams({ hostId: HOST, ...query })}`, { method: 'GET' })
const send = (path: string, body: Record<string, unknown>, method = 'POST') =>
  new Request(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostId: HOST, ...body }) })
const hook = (path: string, body: unknown, headers: Record<string, string>) =>
  new Request(`${BASE}${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

async function connect(routes: ReturnType<typeof setup>['routes'], service = 'doordash', externalStoreId = 'aglyn-store-7') {
  return routes.store(send('delivery-apps/store', { service, externalStoreId }))
}

describe('webhooks (AGL-3644)', () => {
  it('answer 404 for a service this deployment does not offer, and 405 for anything but POST', async () => {
    const { routes } = setup({ config: readDeliveryAppsConfig({}) })
    expect((await routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer hook-token' }))).status).toBe(404)
    expect((await setup().routes.webhookDoordash(new Request(`${BASE}w`, { method: 'GET' }))).status).toBe(405)
    expect((await setup().routes.webhookGrubhub(hook('w', {}, {}))).status).toBe(404)
  })

  it('refuse a body without the service’s signature', async () => {
    const { routes, store } = setup()
    await connect(routes)
    const response = await routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer forged' }))
    expect(response.status).toBe(401)
    expect(store.orders.size).toBe(0)
  })

  it('take a signed order for a connected store once, and answer 404 for a store connected nowhere', async () => {
    const { routes, store } = setup()
    expect((await routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer hook-token' }))).status).toBe(404)
    await connect(routes)
    const first = await routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer hook-token' }))
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toEqual({ received: true, applied: 1 })
    const again = await routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer hook-token' }))
    await expect(again.json()).resolves.toEqual({ received: true, applied: 0 })
    expect(store.orders.get(orderDocId('doordash', DOORDASH_ORDER_CREATE.order.id))).toMatchObject({ hostId: HOST, status: 'new', testMode: false })
  })

  it('ask the service to send again when the order cannot be read back from it', async () => {
    const { routes } = setup()
    await connect(routes, 'uber-eats', 'uber-store-1')
    const body = JSON.stringify(UBER_ORDER_NOTIFICATION)
    const signature = createHmac('sha256', 'uber-secret').update(body).digest('hex')
    const response = await routes.webhookUberEats(hook('w', body, { 'x-uber-signature': signature }))
    expect(response.status).toBe(503)
  })

  it('refuse a body larger than any order', async () => {
    const { routes } = setup()
    const response = await routes.webhookDoordash(hook('w', 'x'.repeat(1_000_001), { authorization: 'Bearer hook-token' }))
    expect(response.status).toBe(413)
  })
})

describe('store settings (AGL-3644)', () => {
  it('list what the deployment offers and the site’s stores, to the site’s admin only', async () => {
    const { routes } = setup()
    await connect(routes)
    const response = await routes.stores(get('delivery-apps/stores'))
    await expect(response.json()).resolves.toEqual({
      offered: [
        { id: 'doordash', sandbox: false },
        { id: 'uber-eats', sandbox: true },
      ],
      stores: [
        {
          service: 'doordash',
          externalStoreId: 'aglyn-store-7',
          settings: { autoAccept: false, prepMinutes: 15 },
          connectedAtMs: NOW,
          menu: { publishedAtMs: null, items: 0, error: null },
          unmatched: 0,
        },
      ],
    })
    const cashier = setup({ who: { hostId: HOST, kinds: ['register'] } })
    expect((await cashier.routes.stores(get('delivery-apps/stores'))).status).toBe(403)
  })

  it('link one service store to one site', async () => {
    const { routes, store } = setup()
    expect((await connect(routes)).status).toBe(200)
    store.stores.set(storeDocId('doordash', 'taken-store'), { ...store.stores.get(storeDocId('doordash', 'aglyn-store-7'))!, hostId: 'other-host' })
    const taken = await connect(routes, 'doordash', 'taken-store')
    expect(taken.status).toBe(409)
    await expect(taken.json()).resolves.toEqual({ error: 'That store is connected to another site. Disconnect it there first.' })
    expect((await connect(routes, 'doordash', 'bad id!')).status).toBe(400)
    expect((await connect(routes, 'grubhub', 'x')).status).toBe(400)
  })

  it('saves settings in bounds, moves to a new store id, and disconnects', async () => {
    const { routes, store } = setup()
    await connect(routes)
    await routes.store(send('delivery-apps/store', { service: 'doordash', settings: { autoAccept: true, prepMinutes: 500 } }))
    expect(store.stores.get(storeDocId('doordash', 'aglyn-store-7'))?.settings).toEqual({ autoAccept: true, prepMinutes: 15 })
    await connect(routes, 'doordash', 'new-store')
    expect([...store.stores.keys()]).toEqual([storeDocId('doordash', 'new-store')])
    expect(store.stores.get(storeDocId('doordash', 'new-store'))?.settings.autoAccept).toBe(true)
    await routes.store(send('delivery-apps/store', { service: 'doordash' }, 'DELETE'))
    expect(store.stores.size).toBe(0)
  })

  it('matches an item to a product, and clears it again', async () => {
    const { routes, store } = setup()
    await connect(routes)
    const id = storeDocId('doordash', 'aglyn-store-7')
    store.stores.get(id)!.unmatched = { k: { externalItemId: 'FRY-1', name: 'Fries', lastSeenAtMs: NOW } }
    // The key the routes use is the item's own hash, so the seeded row is replaced by the match.
    await routes.items(send('delivery-apps/items', { service: 'doordash', externalItemId: 'FRY-1', productId: 'fries', variantId: 'default', title: 'Fries' }))
    let items = await (await routes.items(get('delivery-apps/items', { service: 'doordash' }))).json()
    expect(items.items).toContainEqual({ externalItemId: 'FRY-1', name: 'FRY-1', productId: 'fries', variantId: 'default', title: 'Fries', lastSeenAtMs: null })
    await routes.items(send('delivery-apps/items', { service: 'doordash', externalItemId: 'FRY-1', clear: true }))
    items = await (await routes.items(get('delivery-apps/items', { service: 'doordash' }))).json()
    expect(items.items.filter((item: any) => item.productId)).toEqual([])
    expect((await routes.items(send('delivery-apps/items', { service: 'doordash', externalItemId: 'X', productId: '__bad__', variantId: 'v' }))).status).toBe(400)
  })
})

describe('the register (AGL-3644)', () => {
  async function withOrder() {
    const t = setup()
    await connect(t.routes)
    await t.routes.webhookDoordash(hook('w', DOORDASH_ORDER_CREATE, { authorization: 'Bearer hook-token' }))
    return { ...t, orderId: orderDocId('doordash', DOORDASH_ORDER_CREATE.order.id) }
  }

  it('draws nothing for a site with no store connected', async () => {
    const { routes } = setup()
    await expect((await routes.queue(get('delivery-apps/queue'))).json()).resolves.toEqual({ connected: false, open: [], recent: [] })
  })

  it('lists the open orders with what to make, and the buyer by first name and initial', async () => {
    const { routes, orderId } = await withOrder()
    const answer = await (await routes.queue(get('delivery-apps/queue'))).json()
    expect(answer.connected).toBe(true)
    expect(answer.open).toEqual([
      expect.objectContaining({
        id: orderId,
        service: 'doordash',
        externalRef: 'A1B2C3',
        status: 'new',
        customerName: 'Jamie R.',
        totalCents: 3240,
        lines: [
          { name: 'Classic Burger', quantity: 2, unitPriceCents: 1300, options: ['Cheese'], instructions: 'No onions', matched: true },
          { name: 'Fries', quantity: 1, unitPriceCents: 400, options: [], instructions: null, matched: true },
        ],
      }),
    ])
    expect(JSON.stringify(answer)).not.toContain('5555550123')
  })

  it('accepts through the engine and answers the order as it now stands', async () => {
    const { routes, orderId, ddHttp } = await withOrder()
    const response = await routes.orderAction(send('delivery-apps/order-action', { orderId, action: 'accept' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, order: { status: 'accepted', displayRef: '#7' } })
    expect(ddHttp.calls.map((call) => call.method)).toEqual(['PATCH'])
    const again = await routes.orderAction(send('delivery-apps/order-action', { orderId, action: 'accept' }))
    expect(again.status).toBe(409)
  })

  it('never acts on another site’s order, and asks the register’s gate', async () => {
    const { routes, store, orderId } = await withOrder()
    store.orders.get(orderId)!.hostId = 'other-host'
    expect((await routes.orderAction(send('delivery-apps/order-action', { orderId, action: 'accept' }))).status).toBe(404)
    expect((await routes.orderAction(send('delivery-apps/order-action', { orderId, action: 'refund' }))).status).toBe(400)
    const admin = setup({ who: { hostId: HOST, kinds: ['settings'] } })
    expect((await admin.routes.queue(get('delivery-apps/queue'))).status).toBe(403)
    expect((await setup({ who: null }).routes.orderAction(send('delivery-apps/order-action', { orderId, action: 'accept' }))).status).toBe(401)
  })
})
