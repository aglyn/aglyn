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

import { randomBytes } from 'node:crypto'
import { INVENTORY_SYNC_API_ROUTES } from '../constants'
import { inventoryOrderId, type InventoryProviderId } from '../model/inventory-sync'
import { ProviderError } from '../providers/http'
import type { InventorySystemProvider } from '../providers/provider'
import { createMemoryInventoryStore } from '../testing/memory-store'
import { mockHttp } from '../testing/mock-http'
import { openCredential, readInventorySyncConfig } from './config'
import { createEngine } from './engine'
import { sha256 } from './oauth'
import { createInventoryRoutes, fail, readPastedKeys, type InventoryRole } from './routes'
import { emptyConnection, type StoredOrder } from './store'

const HOST = 'host-1'
const T0 = Date.UTC(2026, 9, 7, 12)
const KEY = randomBytes(32).toString('base64')

function system(overrides: Partial<InventorySystemProvider> = {}): InventorySystemProvider {
  return {
    id: 'cin7-core',
    account: async () => ({ accountName: 'Acme Goods' }),
    locations: async () => [{ id: 'Main', name: 'Main' }],
    stock: async () => [],
    adjustStock: async () => undefined,
    products: async () => ({ products: [], nextCursor: null }),
    productIdsBySku: async (_c, skus) => new Map(skus.map((sku) => [sku, `pid-${sku}`])),
    createProduct: async () => ({ id: 'x' }),
    customerExists: async (_c, name) => name === 'Web Sales',
    findOrder: async () => null,
    createOrder: async () => ({ id: 'sale-1', number: 'SO-1' }),
    cancelOrder: async () => 'canceled',
    ...overrides,
  }
}

function setup(options: { env?: Record<string, string>; provider?: InventorySystemProvider; canImport?: boolean; routes?: Parameters<typeof mockHttp>[0] } = {}) {
  const store = createMemoryInventoryStore()
  const provider = options.provider ?? system()
  const { http, calls } = mockHttp(options.routes ?? [])
  const config = () =>
    readInventorySyncConfig(options.env ?? { INVENTORY_SYNC_TOKEN_KEY: KEY, BRIGHTPEARL_APP_REF: 'app-ref', BRIGHTPEARL_DEV_REF: 'dev-ref' })
  const activity: string[] = []
  const credential = async () => ({ provider: 'cin7-core' as const, accountId: 'a', apiKey: 'k' })
  const engine = createEngine({
    now: () => T0,
    store,
    provider: () => provider,
    credential,
    stockLevels: () => ({ setAvailable: async (request) => request.levels.map((level) => ({ sku: level.sku, outcome: 'updated' as const })) }),
    catalog: () => undefined,
    productWriter: () => undefined,
    siteOpen: async () => true,
  })
  const routes = createInventoryRoutes({
    now: () => T0,
    config,
    store,
    provider: () => provider,
    http,
    engine,
    credential,
    // The member's role rides in a header, so each spec says who is asking.
    gate: async (request: Request, role: InventoryRole) => {
      const rank: Record<string, number> = { viewer: 1, editor: 2, admin: 3 }
      const asking = request.headers.get('x-role') ?? 'admin'
      if (rank[asking] < rank[role]) return fail(403, 'Not permitted')
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'user-1', body }
    },
    canImportProducts: () => options.canImport ?? false,
    consoleAddress: (path) => `https://console.aglyn.com${path}`,
    logActivity: async (input) => {
      activity.push(`${input.action}:${input.provider}`)
    },
  })
  return { store, routes, activity, calls }
}

const request = (method: string, route: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request(`https://console.aglyn.com/api/${route}${method === 'GET' && body ? `?${new URLSearchParams(body as never)}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' || !body ? {} : { body: JSON.stringify(body) }),
  })

async function connectCin7(routes: ReturnType<typeof setup>['routes']) {
  return routes.connectKeys(
    request('POST', INVENTORY_SYNC_API_ROUTES.connectKeys, { hostId: HOST, provider: 'cin7-core', accountId: 'acct-1234', apiKey: 'app-key-secret' }),
  )
}

describe('connecting (AGL-3642)', () => {
  it('lists what the deployment offers, and no connection yet', async () => {
    const { routes } = setup({ env: { INVENTORY_SYNC_TOKEN_KEY: KEY } })
    const answer = await (await routes.connection(request('GET', INVENTORY_SYNC_API_ROUTES.connection, { hostId: HOST }))).json()
    expect(answer).toEqual({ offered: [{ id: 'cin7-core' }, { id: 'inflow' }], connection: null, capabilities: { importProducts: false } })
  })

  it('checks pasted keys with the system, seals them, and never answers them back', async () => {
    const { routes, store, activity } = setup()
    const response = await connectCin7(routes)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('app-key-secret')
    expect(JSON.parse(text).connection).toMatchObject({ provider: 'cin7-core', status: 'active', accountName: 'Acme Goods', stockSource: 'off', sendOrders: false })
    const stored = store.connections.get(HOST)!
    expect(JSON.stringify(stored)).not.toContain('app-key-secret')
    expect(openCredential(stored.sealedCredential!, HOST, readInventorySyncConfig({ INVENTORY_SYNC_TOKEN_KEY: KEY }).keyring!).payload).toEqual({
      provider: 'cin7-core',
      accountId: 'acct-1234',
      apiKey: 'app-key-secret',
    })
    expect(activity).toEqual(['connected:cin7-core'])
  })

  it('refuses keys the system refuses, and stores nothing', async () => {
    const { routes, store } = setup({
      provider: system({
        account: async () => {
          throw new ProviderError('auth', 'no')
        },
      }),
    })
    const response = await connectCin7(routes)
    expect(response.status).toBe(400)
    expect(store.connections.size).toBe(0)
  })

  it('needs an admin, keys of the right shape, and one system per store', async () => {
    const { routes } = setup()
    const asEditor = await routes.connectKeys(
      request('POST', INVENTORY_SYNC_API_ROUTES.connectKeys, { hostId: HOST, provider: 'cin7-core' }, { 'x-role': 'editor' }),
    )
    expect(asEditor.status).toBe(403)
    expect(readPastedKeys('inflow', { companyId: 'c', apiKey: '' })).toMatchObject({ ok: false })
    await connectCin7(routes)
    const second = await routes.connectKeys(
      request('POST', INVENTORY_SYNC_API_ROUTES.connectKeys, { hostId: HOST, provider: 'inflow', companyId: 'company-1', apiKey: 'inflow-key-1' }),
    )
    expect(second.status).toBe(409)
  })

  it('answers nothing at all on a deployment without the token key', async () => {
    const { routes } = setup({ env: {} })
    const response = await connectCin7(routes)
    expect(response.status).toBe(404)
  })
})

describe('connecting Brightpearl (AGL-3642)', () => {
  it('sends the member to the account’s consent page with a single-use state, then seals the grant', async () => {
    const { routes, store, calls } = setup({
      provider: system({ id: 'brightpearl', account: async () => ({ accountName: 'shop' }) }),
      routes: [
        {
          method: 'POST',
          match: 'oauth.brightpearlapp.com/token/shop',
          body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 604800, api_domain: 'use1.brightpearlconnect.com' },
        },
      ],
    })
    const start = await routes.connectOAuth(
      request('POST', INVENTORY_SYNC_API_ROUTES.connectOAuth, { hostId: HOST, accountCode: 'Shop', returnTo: '/acme/site/commerce/settings' }),
    )
    const { url } = await start.json()
    const consent = new URL(url)
    expect(`${consent.origin}${consent.pathname}`).toBe('https://oauth.brightpearlapp.com/authorize/shop')
    expect(consent.searchParams.get('client_id')).toBe('app-ref')
    expect(consent.searchParams.get('redirect_uri')).toBe('https://console.aglyn.com/api/inventory-sync/oauth/callback')
    const state = consent.searchParams.get('state')!
    expect(store.connections.get(HOST)?.pendingOAuth?.nonceHash).toBe(sha256(state.split('.')[1]))

    const back = await routes.oauthCallback(
      new Request(`https://console.aglyn.com/api/inventory-sync/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`),
    )
    expect(back.status).toBe(303)
    expect(back.headers.get('location')).toBe('https://console.aglyn.com/acme/site/commerce/settings?inventorySync=connected')
    expect(calls[0].body).toContain('grant_type=authorization_code')
    const stored = store.connections.get(HOST)!
    expect(stored).toMatchObject({ provider: 'brightpearl', status: 'active', accountCode: 'shop', apiDomain: 'use1.brightpearlconnect.com', pendingOAuth: null })
    expect(JSON.stringify(stored)).not.toContain('access-1')

    // Good once.
    const again = await routes.oauthCallback(
      new Request(`https://console.aglyn.com/api/inventory-sync/oauth/callback?code=code-1&state=${encodeURIComponent(state)}`),
    )
    expect(again.status).toBe(400)
  })

  it('is not offered without the app', async () => {
    const { routes } = setup({ env: { INVENTORY_SYNC_TOKEN_KEY: KEY } })
    const response = await routes.connectOAuth(request('POST', INVENTORY_SYNC_API_ROUTES.connectOAuth, { hostId: HOST, accountCode: 'shop' }))
    expect(response.status).toBe(404)
  })

  it('refuses a state it never minted', async () => {
    const { routes } = setup()
    const response = await routes.oauthCallback(new Request('https://console.aglyn.com/api/inventory-sync/oauth/callback?code=x&state=nope'))
    expect(response.status).toBe(400)
  })
})

describe('settings (AGL-3642)', () => {
  const patch = (routes: ReturnType<typeof setup>['routes'], body: Record<string, unknown>) =>
    routes.settings(request('PATCH', INVENTORY_SYNC_API_ROUTES.settings, { hostId: HOST, ...body }))

  it('needs a location before the store’s counts can be pushed', async () => {
    const { routes } = setup()
    await connectCin7(routes)
    expect((await patch(routes, { stockSource: 'store' })).status).toBe(400)
    const saved = await (await patch(routes, { stockSource: 'store', locationId: 'Main' })).json()
    expect(saved.connection).toMatchObject({ stockSource: 'store', locationId: 'Main' })
  })

  it('checks the order customer exists in the system', async () => {
    const { routes } = setup()
    await connectCin7(routes)
    expect((await patch(routes, { orderCustomer: 'Nobody' })).status).toBe(400)
    expect((await (await patch(routes, { orderCustomer: 'Web Sales', sendOrders: true })).json()).connection).toMatchObject({
      orderCustomer: 'Web Sales',
      sendOrders: true,
    })
  })

  it('offers import only where the deployment has a product writer', async () => {
    const { routes } = setup()
    await connectCin7(routes)
    expect((await patch(routes, { productSync: 'import' })).status).toBe(400)
    expect((await patch(routes, { productSync: 'export' })).status).toBe(200)
  })

  it('resets the counts it remembers when the direction changes', async () => {
    const { routes, store } = setup()
    await connectCin7(routes)
    store.connections.get(HOST)!.lastCounts = { A: 1 }
    await patch(routes, { stockSource: 'system' })
    expect(store.connections.get(HOST)).toMatchObject({ lastCounts: {}, stockDueAtMs: T0, stockFullDueAtMs: T0 })
  })

  it('disconnects, leaving unsent orders unsent', async () => {
    const { routes, store, activity } = setup()
    await connectCin7(routes)
    store.orders.set(inventoryOrderId(HOST, 'o-1'), { hostId: HOST, status: 'queued', active: true } as StoredOrder)
    const response = await routes.settings(request('DELETE', INVENTORY_SYNC_API_ROUTES.settings, { hostId: HOST }))
    expect(response.status).toBe(200)
    expect(store.connections.size).toBe(0)
    expect(store.orders.get(inventoryOrderId(HOST, 'o-1'))).toMatchObject({ status: 'skipped', active: false })
    expect(activity).toEqual(['connected:cin7-core', 'disconnected:cin7-core'])
  })
})

describe('orders (AGL-3642)', () => {
  const failed = (provider: InventoryProviderId = 'cin7-core'): StoredOrder => ({
    orgId: 'org-1',
    hostId: HOST,
    recordId: 'o-1',
    provider,
    connectionId: HOST,
    displayRef: '#7',
    reference: 'AG7-aaaaaaaa',
    status: 'failed',
    lines: [{ lineIndex: 0, sku: 'A', name: 'A', quantity: 1, unitAmountCents: 100 }],
    skippedLines: [],
    snapshot: { orderedAtMs: T0, currency: 'USD', buyerName: null, buyerEmail: null, shippingAddress: null, shippingCents: 0, discountCents: 0, taxCents: 0, totalCents: 100 },
    externalId: null,
    externalNumber: null,
    note: 'Cin7 Core has no product with the SKU A.',
    cancelRequested: false,
    active: false,
    nextRunAtMs: T0,
    leaseUntilMs: 0,
    attempts: 1,
    createdAtMs: T0,
    updatedAtMs: T0,
  })

  it('lists the orders that need the merchant, and sends one again', async () => {
    const { routes, store } = setup()
    await connectCin7(routes)
    store.connections.get(HOST)!.orderCustomer = 'Web Sales'
    store.orders.set(inventoryOrderId(HOST, 'o-1'), failed())
    const listed = await (await routes.orders(request('GET', INVENTORY_SYNC_API_ROUTES.orders, { hostId: HOST }))).json()
    expect(listed.orders).toEqual([expect.objectContaining({ recordId: 'o-1', status: 'failed', displayRef: '#7' })])
    const sent = await (await routes.orderSend(request('POST', INVENTORY_SYNC_API_ROUTES.orderSend, { hostId: HOST, recordId: 'o-1' }))).json()
    expect(sent.order).toMatchObject({ status: 'sent', externalNumber: 'SO-1' })
    const again = await routes.orderSend(request('POST', INVENTORY_SYNC_API_ROUTES.orderSend, { hostId: HOST, recordId: 'o-1' }))
    expect(again.status).toBe(409)
  })

  it('answers where one order stands to a viewer, without a credential', async () => {
    const { routes, store } = setup()
    await connectCin7(routes)
    store.orders.set(inventoryOrderId(HOST, 'o-1'), failed())
    const answer = await (
      await routes.order(request('GET', INVENTORY_SYNC_API_ROUTES.order, { hostId: HOST, recordId: 'o-1' }, { 'x-role': 'viewer' }))
    ).json()
    expect(answer).toMatchObject({ connection: { provider: 'cin7-core', status: 'active' }, order: { status: 'failed' } })
    expect(JSON.stringify(answer)).not.toMatch(/sealed|apiKey/)
  })

  it('syncs now only for an active connection', async () => {
    const { routes, store } = setup()
    await connectCin7(routes)
    store.connections.get(HOST)!.status = 'reconnect'
    expect((await routes.syncNow(request('POST', INVENTORY_SYNC_API_ROUTES.syncNow, { hostId: HOST }))).status).toBe(409)
    store.connections.get(HOST)!.status = 'active'
    const answer = await (await routes.syncNow(request('POST', INVENTORY_SYNC_API_ROUTES.syncNow, { hostId: HOST }))).json()
    expect(answer.connection).toMatchObject({ status: 'active' })
  })
})

describe('the empty connection (AGL-3642)', () => {
  it('writes nothing on either side until the merchant chooses', () => {
    expect(emptyConnection({ orgId: 'o', hostId: HOST, provider: 'inflow', nowMs: T0 })).toMatchObject({
      stockSource: 'off',
      productSync: 'off',
      sendOrders: false,
      status: 'reconnect',
    })
  })
})
