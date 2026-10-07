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

import { registerPluginProductCatalog } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { registerPluginProductWriter, type SourcedProductWrite } from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import {
  registerPluginShipmentRecords,
  type PluginShipmentWrite,
  type PluginTrackingUpdate,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  listPluginFulfillmentProviders,
  pluginFulfillmentHolds,
  registerPluginFulfillmentProvider,
} from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { registerPrintOnDemandServerDeclarations } from '../declarations.server'
import { createHmac, randomBytes } from 'node:crypto'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { ProviderFetch } from '../providers/http'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { runPodLinkTick } from './catalog'
import { POD_ENV, setPodFetchForTests } from './config'
import {
  cancelPodOrder,
  onOrderCancelled,
  onOrderPaid,
  onOrderRefunded,
  podExternalId,
  podFulfillmentHolds,
  refreshPodOrder,
  runPodOrderTick,
  sendPodOrder,
} from './orders'
import {
  catalogRoute,
  connectionsRoute,
  connectRoute,
  disconnectRoute,
  importedRoute,
  importRoute,
  orderActionRoute,
  orderRoute,
  ordersRoute,
  productLinkRoute,
  settingsRoute,
  storesRoute,
  unlinkRoute,
} from './routes'
import { connectionId, linkId, podOrderId, readStoredConnection, readStoredLink, readStoredPodOrder, setPodDbForTests } from './store'
import { parseSecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { printfulWebhookRoute, printifyWebhookRoute } from './webhook-routes'

/**
 * Print-on-demand's server half against an in-memory Firestore and a
 * recorded Printful and Printify (AGL-3641): connecting, importing through
 * the products' keeper, sending a paid order once however many doors try,
 * test and review orders left as drafts, retries and refusals, parcels
 * written back once, cancellation and its race with a send in flight, the
 * job, the webhook doors, and every console route behind its gate.
 */

const TOKEN_KEY = randomBytes(32).toString('base64')
const ORG = 'org-tees'
const HOST = 'host-tees'
const OTHER_HOST = 'host-other'
const ORDER_ID = 'cs_live_order1'

let db: MemoryFirestore
const notices: Array<{ hostId: string; title: string; body: string }> = []
let lockdown: unknown = null

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email: 'rosa@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-outsider', email: 'out@example.com', email_verified: true },
}

const sites: Record<string, { org: Record<string, unknown>; host: Record<string, unknown> }> = {}

function resetSites() {
  sites[HOST] = {
    org: { name: 'Tees', plan: 'pro' },
    host: { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } },
  }
  sites[OTHER_HOST] = {
    org: { name: 'Other', plan: 'free' },
    host: { memberRoles: { 'uid-admin': 'admin' } },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => db,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          const decoded = TOKENS[token]
          if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
          return decoded
        },
      }),
    }),
  },
  getOrgForHost: async (hostId: string) => (sites[hostId] ? { orgId: ORG, org: sites[hostId].org } : null),
  getHostDocAdmin: async (hostId: string) => sites[hostId]?.host ?? null,
  notifyHostManagers: async (hostId: string, payload: { title: string; body: string }) => {
    notices.push({ hostId, title: payload.title, body: payload.body })
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  getLockdownVerdict: async () => lockdown,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: (org: { plan?: string }) => org?.plan !== 'free',
}))

/* ------------------------------------------------------------ the services */

interface Call {
  method: string
  url: string
  host: string
  path: string
  search: string
  headers: Record<string, string>
  body: any
}

let calls: Call[] = []
/** A hook a spec sets to answer a call before the healthy service does. */
let override: ((call: Call) => { status: number; body?: unknown; headers?: Record<string, string>; raw?: Uint8Array } | null) | null = null

interface FakeOrder {
  id: number
  external_id: string
  status: string
  items: Array<{ id: number; external_id: string; sync_variant_id: number; quantity: number }>
  shipments: unknown[]
  costs: Record<string, string>
}

let printfulOrders: Map<string, FakeOrder>
let printfulWebhook: string | null
let nextOrderId = 700
let printifyOrder: Record<string, any> | null
let printifyHooks: Array<{ topic: string; url: string; secret: string }>

const PRINTFUL_PRODUCT = {
  sync_product: { id: 501, name: 'Ocean Tee', thumbnail_url: 'https://files.cdn.printful.com/tee.png' },
  sync_variants: [
    { id: 9001, name: 'Ocean Tee / Black / S', variant_id: 4011, retail_price: '24.99', currency: 'USD', sku: 'TEE-S', color: 'Black', size: 'S', availability_status: 'active', files: [{ type: 'preview', preview_url: 'https://files.cdn.printful.com/s.png' }] },
    { id: 9002, name: 'Ocean Tee / Black / M', variant_id: 4012, retail_price: '25.99', currency: 'USD', sku: 'TEE-M', color: 'Black', size: 'M', availability_status: 'active', files: [] },
  ],
}

function printfulOrder(order: FakeOrder) {
  return { ...order, dashboard_url: `https://www.printful.com/dashboard?order_id=${order.id}` }
}

function healthy(call: Call): { status: number; body?: unknown; headers?: Record<string, string>; raw?: Uint8Array } {
  if (call.host === 'files.cdn.printful.com' || call.host === 'images-api.printify.com') {
    return { status: 200, raw: new Uint8Array([137, 80, 78, 71]), headers: { 'content-type': 'image/png' } }
  }
  if (call.host === 'console.test' && call.path === '/api/media/upload') {
    const mediaId = `m-${call.body.fileName}`
    db.docs.set(`hosts/${call.body.hostId}/media/${mediaId}`, { cdnPath: `/api/media/cdn/${call.body.hostId}/${mediaId}` })
    return { status: 200, body: { mediaId, url: 'https://firebasestorage.googleapis.com/x' } }
  }
  if (call.host === 'api.printful.com') {
    if (call.path === '/stores') return { status: 200, body: { result: [{ id: 42, name: 'Ocean Goods', currency: 'USD' }] } }
    if (call.path === '/store/products') {
      return { status: 200, body: { result: [{ id: 501, name: 'Ocean Tee', variants: 2, thumbnail_url: 'https://files.cdn.printful.com/tee.png' }], paging: { total: 1 } } }
    }
    if (call.path === '/store/products/501') return { status: 200, body: { result: PRINTFUL_PRODUCT } }
    if (call.path.startsWith('/products/variant/')) {
      const price = call.path.endsWith('4011') ? '11.50' : '12.50'
      return { status: 200, body: { result: { variant: { price }, product: { description: 'Soft cotton.' } } } }
    }
    if (call.path === '/webhooks') {
      if (call.method === 'GET') return { status: 200, body: { result: { url: printfulWebhook } } }
      if (call.method === 'POST') {
        printfulWebhook = call.body.url
        return { status: 200, body: { result: {} } }
      }
      printfulWebhook = null
      return { status: 200, body: { result: {} } }
    }
    if (call.path === '/orders' && call.method === 'POST') {
      const order: FakeOrder = {
        id: (nextOrderId += 1),
        external_id: call.body.external_id,
        status: call.search === '?confirm=true' ? 'pending' : 'draft',
        items: call.body.items.map((item: any, index: number) => ({ id: 1000 + index, external_id: item.external_id, sync_variant_id: item.sync_variant_id, quantity: item.quantity })),
        shipments: [],
        costs: { currency: 'USD', subtotal: '23.00', discount: '0', shipping: '4.99', tax: '0.50', vat: '0', total: '28.49' },
      }
      printfulOrders.set(String(order.id), order)
      return { status: 200, body: { result: printfulOrder(order) } }
    }
    const byExternal = call.path.match(/^\/orders\/@(.+)$/)
    if (byExternal) {
      const found = [...printfulOrders.values()].find((order) => order.external_id === decodeURIComponent(byExternal[1]))
      return found ? { status: 200, body: { result: printfulOrder(found) } } : { status: 404, body: { result: 'Not found' } }
    }
    const byId = call.path.match(/^\/orders\/(\d+)(\/confirm)?$/)
    if (byId) {
      const order = printfulOrders.get(byId[1])
      if (!order) return { status: 404, body: { result: 'Not found' } }
      if (byId[2]) order.status = 'pending'
      if (call.method === 'DELETE') {
        if (!['draft', 'pending', 'failed', 'onhold'].includes(order.status)) {
          return { status: 400, body: { result: 'Order cannot be canceled', error: { message: 'Order cannot be canceled' } } }
        }
        order.status = 'canceled'
      }
      return { status: 200, body: { result: printfulOrder(order) } }
    }
  }
  if (call.host === 'api.printify.com') {
    const path = call.path.replace('/v1', '')
    if (path === '/shops.json') return { status: 200, body: [{ id: 9, title: 'Wave Shop' }] }
    if (path === '/shops/9/products.json') return { status: 200, body: { current_page: 1, last_page: 1, total: 1, data: [] } }
    if (path === '/shops/9/webhooks.json') {
      if (call.method === 'POST') printifyHooks.push(call.body)
      return { status: 200, body: call.method === 'GET' ? [] : { id: `w${printifyHooks.length}` } }
    }
    if (path === '/shops/9/products/p1.json') {
      return {
        status: 200,
        body: {
          id: 'p1',
          title: 'Wave Mug',
          description: '<p>Mug</p>',
          options: [{ name: 'Sizes', values: [{ id: 10, title: '11oz' }, { id: 11, title: '15oz' }] }],
          variants: [
            { id: 100, sku: 'M11', cost: 450, price: 1500, title: '11oz', is_enabled: true, options: [10] },
            { id: 101, sku: 'M15', cost: 550, price: 1800, title: '15oz', is_enabled: true, options: [11] },
          ],
          images: [{ src: 'https://images-api.printify.com/m.png', variant_ids: [100, 101], is_default: true }],
        },
      }
    }
    if (path === '/shops/9/orders.json' && call.method === 'GET') {
      return { status: 200, body: { last_page: 1, data: printifyOrder ? [printifyOrder] : [] } }
    }
    if (path === '/shops/9/orders.json' && call.method === 'POST') {
      printifyOrder = {
        id: 'o1',
        external_id: call.body.external_id,
        status: 'on-hold',
        line_items: call.body.line_items.map((line: any) => ({ ...line, status: 'on-hold' })),
        total_price: 900,
        total_shipping: 450,
        total_tax: 0,
        shipments: [],
      }
      return { status: 200, body: { id: 'o1' } }
    }
    if (path === '/shops/9/orders/o1/send_to_production.json' && printifyOrder) {
      printifyOrder.status = 'in-production'
      printifyOrder.sent_to_production_at = '2026-10-07 10:00:00+00:00'
      return { status: 200, body: {} }
    }
    if (path === '/shops/9/orders/o1.json' && printifyOrder) return { status: 200, body: printifyOrder }
  }
  return { status: 500, body: { message: `unexpected ${call.method} ${call.host}${call.path}` } }
}

const service: ProviderFetch = async (url, init = {}) => {
  const parsed = new URL(String(url))
  const call: Call = {
    method: String(init.method ?? 'GET'),
    url: String(url),
    host: parsed.host,
    path: parsed.pathname,
    search: parsed.search,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
  }
  calls.push(call)
  const answer = override?.(call) ?? healthy(call)
  return new Response((answer.raw ?? (answer.body === undefined ? '' : JSON.stringify(answer.body))) as BodyInit, {
    status: answer.status,
    headers: answer.headers ?? {},
  })
}

const serviceCalls = (host = 'api.printful.com') => calls.filter((call) => call.host === host)

/* ------------------------------------------------------------- the seams */

let written: SourcedProductWrite[] = []
let storeProducts: Map<string, { variants: string[] }>
let shipments: PluginShipmentWrite[] = []
let tracking: PluginTrackingUpdate[] = []
let orderRecord: Record<string, unknown> | null
let shipmentOutcome: 'recorded' | 'blocked' = 'recorded'

function registerSeams() {
  registerPluginProductCatalog(
    { store: async () => ({ hostId: HOST, name: 'Tees', origin: null, currency: 'USD', productPagesServed: true, carrierPricedCountries: [] }), page: async () => ({ offers: [], nextCursor: null }) },
    { pluginId: 'commerce' },
  )
  registerPluginProductWriter(
    {
      upsertSourced: async (write) => {
        written.push(write)
        const existing = write.productId ? storeProducts.get(write.productId) : undefined
        if (write.productId && !existing && write.recreate === false) return { outcome: 'missing' }
        const productId = existing ? (write.productId as string) : `prod-${storeProducts.size + 1}`
        const variants = write.product.variants.map((variant, index) => ({ key: variant.key, variantId: variant.variantId ?? `${productId}-v${index}` }))
        storeProducts.set(productId, { variants: variants.map((entry) => entry.variantId) })
        return { outcome: existing ? 'updated' : 'created', productId, variants }
      },
    },
    { pluginId: 'commerce' },
  )
  registerPluginShipmentRecords(
    {
      read: async (hostId, recordId) =>
        orderRecord && hostId === HOST && recordId === ORDER_ID
          ? ({
              hostId,
              recordId,
              displayRef: '#1042',
              status: 'paid',
              shippable: true,
              currency: 'usd',
              customerEmail: 'buyer@example.com',
              lines: [],
              shipments: [],
              ...orderRecord,
            } as never)
          : null,
      recordShipment: async (write) => {
        if (shipmentOutcome === 'blocked') return { outcome: 'blocked', from: 'cancelled' }
        const already = shipments.some((entry) => entry.labelRef === write.labelRef)
        if (!already) shipments.push(write)
        return already ? { outcome: 'already' } : { outcome: 'recorded', shipmentId: `ship-${shipments.length}` }
      },
      recordTracking: async (update) => {
        tracking.push(update)
        return { outcome: 'recorded' }
      },
      shipFromAddresses: async () => [],
    },
    { pluginId: 'commerce' },
  )
}

/* --------------------------------------------------------------- helpers */

function request(route: string, token: string | null, options: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const query = new URLSearchParams({ hostId: HOST, ...(options.query ?? {}) })
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  return new Request(`https://console.test/api/${route}?${query.toString()}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ hostId: HOST, ...((options.body as object) ?? {}) }) }),
  })
}

async function json(response: Response) {
  return { status: response.status, body: (await response.json()) as any }
}

async function connectPrintful(extra: Record<string, unknown> = {}) {
  const answer = await json(await connectRoute(request(POD_API_ROUTES.connect, 'tok-admin', { body: { provider: 'printful', token: 'pf-secret-token', ...extra } })))
  expect(answer.status).toBe(200)
  return answer.body
}

async function importTee() {
  const answer = await json(await importRoute(request(POD_API_ROUTES.importProducts, 'tok-editor', { body: { provider: 'printful', productIds: ['501'] } })))
  expect(answer.status).toBe(200)
  return answer.body.results[0]
}

function paidEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    event: 'order.paid',
    hostId: HOST,
    orgId: ORG,
    occurredAtMs: 1,
    attempt: 1,
    payload: {
      order: {
        id: ORDER_ID,
        number: 1042,
        currency: 'usd',
        testMode: false,
        lineItems: [
          { productId: 'prod-1', variantId: 'prod-1-v0', name: 'Ocean Tee', variantLabel: 'Black / S', quantity: 2, unitAmountCents: 2499 },
          { productId: 'own-product', variantId: 'v', name: 'Sticker', quantity: 1, unitAmountCents: 300 },
          { productId: 'prod-1', variantId: 'prod-1-v1', name: 'Ocean Tee', variantLabel: 'Black / M', quantity: 1, unitAmountCents: 2599 },
        ],
        ...overrides,
      },
    },
  }
}

const PART = () => podOrderId(HOST, ORDER_ID, 'printful')
const part = () => readStoredPodOrder(db.docs.get(`podOrders/${PART()}`))

beforeEach(() => {
  db = createMemoryFirestore()
  setPodDbForTests(db)
  setPodFetchForTests(service)
  process.env[POD_ENV.tokenKey] = TOKEN_KEY
  process.env['NEXT_PUBLIC_CONSOLE_URL'] = 'https://console.test'
  resetSites()
  resetPluginServicesForTests()
  registerSeams()
  calls = []
  override = null
  printfulOrders = new Map()
  printfulWebhook = null
  nextOrderId = 700
  printifyOrder = null
  printifyHooks = []
  written = []
  storeProducts = new Map()
  shipments = []
  tracking = []
  notices.length = 0
  lockdown = null
  shipmentOutcome = 'recorded'
  orderRecord = { shipTo: { name: 'Bea Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us', phone: '555' } }
})

afterAll(() => {
  setPodDbForTests(null)
  setPodFetchForTests(null)
  delete process.env[POD_ENV.tokenKey]
})

/* ----------------------------------------------------------------- gate */

describe('the gate', () => {
  it('answers 404 on a deployment without the sealing key', async () => {
    delete process.env[POD_ENV.tokenKey]
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-admin'))).status).toBe(404)
  })

  it('refuses no token, a bad token, an unverified address, an outsider and a site that does not sell', async () => {
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, null))).status).toBe(401)
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-nobody'))).status).toBe(401)
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-unverified'))).status).toBe(403)
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-outsider'))).status).toBe(403)
    const other = new Request(`https://console.test/api/x?hostId=${OTHER_HOST}`, { headers: { authorization: 'Bearer tok-admin' } })
    expect((await connectionsRoute(other)).status).toBe(404)
  })

  it('keeps the token and settings an admin’s, importing an editor’s, reading a viewer’s', async () => {
    expect((await connectRoute(request(POD_API_ROUTES.connect, 'tok-editor', { body: { provider: 'printful', token: 'x' } }))).status).toBe(403)
    expect((await storesRoute(request(POD_API_ROUTES.stores, 'tok-editor', { body: { provider: 'printful', token: 'x' } }))).status).toBe(403)
    expect((await settingsRoute(request(POD_API_ROUTES.settings, 'tok-editor', { body: { provider: 'printful' } }))).status).toBe(403)
    expect((await disconnectRoute(request(POD_API_ROUTES.disconnect, 'tok-editor', { body: { provider: 'printful' } }))).status).toBe(403)
    expect((await importRoute(request(POD_API_ROUTES.importProducts, 'tok-viewer', { body: { provider: 'printful', productIds: ['1'] } }))).status).toBe(403)
    expect((await orderActionRoute(request(POD_API_ROUTES.orderAction, 'tok-viewer', { body: { orderId: ORDER_ID, provider: 'printful', action: 'refresh' } }))).status).toBe(403)
    expect((await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-viewer'))).status).toBe(200)
  })
})

/* ------------------------------------------------------------- connecting */

describe('connecting', () => {
  it('tests the token, seals it, registers the store’s notices, and never echoes it', async () => {
    const body = await connectPrintful()
    expect(body.connection).toMatchObject({
      provider: 'printful',
      storeId: '42',
      storeName: 'Ocean Goods',
      currency: 'USD',
      submitMode: 'automatic',
      syncPrices: false,
      webhooks: 'registered',
    })
    expect(body.notice).toBeNull()
    expect(JSON.stringify(body)).not.toContain('pf-secret-token')
    const stored = db.docs.get(`podConnections/${connectionId(HOST, 'printful')}`) as Record<string, unknown>
    expect(JSON.stringify(stored)).not.toContain('pf-secret-token')
    expect(stored['orgId']).toBe(ORG)
    expect(printfulWebhook).toMatch(/^https:\/\/console\.test\/api\/print-on-demand\/webhooks\/printful\?c=host-tees__printful&t=/)
    // Every call carried the merchant's token, and the store's own once chosen.
    expect(serviceCalls().every((call) => call.headers['Authorization'] === 'Bearer pf-secret-token')).toBe(true)
    expect(serviceCalls().find((call) => call.path === '/webhooks')?.headers['X-PF-Store-Id']).toBe('42')
  })

  it('stores nothing when the service refuses the token', async () => {
    override = (call) => (call.path === '/stores' ? { status: 401, body: { error: { message: 'bad' } } } : null)
    const answer = await json(await connectRoute(request(POD_API_ROUTES.connect, 'tok-admin', { body: { provider: 'printful', token: 'nope' } })))
    expect(answer).toEqual({ status: 400, body: { error: 'Printful refused the token. Make a new private token and connect again.' } })
    expect([...db.docs.keys()].filter((key) => key.startsWith('podConnections/'))).toEqual([])
  })

  it('asks which store when the token reaches several, then connects the chosen one', async () => {
    override = (call) =>
      call.path === '/stores' ? { status: 200, body: { result: [{ id: 1, name: 'A', currency: 'USD' }, { id: 42, name: 'B', currency: 'USD' }] } } : null
    expect((await connectRoute(request(POD_API_ROUTES.connect, 'tok-admin', { body: { provider: 'printful', token: 't' } }))).status).toBe(409)
    const stores = await json(await storesRoute(request(POD_API_ROUTES.stores, 'tok-admin', { body: { provider: 'printful', token: 't' } })))
    expect(stores.body.stores.map((store: { id: string }) => store.id)).toEqual(['1', '42'])
    const chosen = await connectPrintful({ storeId: '42' })
    expect(chosen.connection.storeName).toBe('B')
  })

  it('falls back to asking after orders when another app holds Printful’s one notice address', async () => {
    printfulWebhook = 'https://another-app.example/hooks'
    const body = await connectPrintful()
    expect(body.connection.webhooks).toBe('polling')
    expect(body.connection.webhookDetail).toContain('another app')
    expect(printfulWebhook).toBe('https://another-app.example/hooks')
  })

  it('says when the service prices in another currency than the store', async () => {
    override = (call) => (call.path === '/stores' ? { status: 200, body: { result: [{ id: 42, name: 'EU', currency: 'EUR' }] } } : null)
    const body = await connectPrintful()
    expect(body.notice).toContain('EUR')
    const list = await json(await connectionsRoute(request(POD_API_ROUTES.connections, 'tok-viewer')))
    expect(list.body.storeCurrency).toBe('USD')
    expect(list.body.connections[0].currency).toBe('EUR')
  })

  it('saves the settings, and disconnecting removes the notice address and the token', async () => {
    await connectPrintful()
    const saved = await json(await settingsRoute(request(POD_API_ROUTES.settings, 'tok-admin', { body: { provider: 'printful', submitMode: 'review', syncPrices: true } })))
    expect(saved.body.connection).toMatchObject({ submitMode: 'review', syncPrices: true })
    await disconnectRoute(request(POD_API_ROUTES.disconnect, 'tok-admin', { body: { provider: 'printful' } }))
    expect(db.docs.has(`podConnections/${connectionId(HOST, 'printful')}`)).toBe(false)
    expect(printfulWebhook).toBeNull()
  })
})

/* -------------------------------------------------------------- importing */

describe('importing', () => {
  beforeEach(async () => {
    await connectPrintful()
    calls = []
  })

  it('lists the service’s products marked with what is imported', async () => {
    const before = await json(await catalogRoute(request(POD_API_ROUTES.catalog, 'tok-editor', { query: { provider: 'printful' } })))
    expect(before.body.products).toEqual([
      { id: '501', name: 'Ocean Tee', thumbnailUrl: 'https://files.cdn.printful.com/tee.png', variantCount: 2, importedProductId: null },
    ])
    await importTee()
    const after = await json(await catalogRoute(request(POD_API_ROUTES.catalog, 'tok-editor', { query: { provider: 'printful' } })))
    expect(after.body.products[0].importedProductId).toBe('prod-1')
  })

  it('writes the product through the store’s keeper, with photos copied as the member, and keeps the link with costs', async () => {
    const result = await importTee()
    expect(result).toEqual({ sourceProductId: '501', outcome: 'created', productId: 'prod-1', name: 'Ocean Tee', imagesSkipped: 0 })
    expect(written[0]).toMatchObject({
      hostId: HOST,
      status: 'draft',
      prices: false,
      content: false,
      actorUid: 'uid-editor',
      product: {
        sourceKey: 'printful:501',
        name: 'Ocean Tee',
        description: 'Soft cotton.',
        options: [
          { name: 'Color', values: ['Black'] },
          { name: 'Size', values: ['S', 'M'] },
        ],
        variants: [
          { key: '9001', options: { Color: 'Black', Size: 'S' }, sku: 'TEE-S', priceMinor: 2499, available: true },
          { key: '9002', options: { Color: 'Black', Size: 'M' }, sku: 'TEE-M', priceMinor: 2599, available: true },
        ],
      },
    })
    // The product's photo and each variant's preview, copied once each.
    expect(written[0].product.mediaUrls).toEqual([`/api/media/cdn/${HOST}/m-Ocean-Tee-1.png`, `/api/media/cdn/${HOST}/m-Ocean-Tee-2.png`])
    expect(written[0].product.variants[0].imageUrl).toBe(`/api/media/cdn/${HOST}/m-Ocean-Tee-2.png`)
    const uploads = calls.filter((call) => call.path === '/api/media/upload')
    expect(uploads).toHaveLength(2)
    expect(uploads[0].headers['Authorization']).toBe('Bearer tok-editor')
    expect(uploads[0].body).toMatchObject({ hostId: HOST, contentType: 'image/png' })
    const link = readStoredLink(db.docs.get(`podProductLinks/${linkId(HOST, 'printful', '501')}`))
    expect(link).toMatchObject({
      orgId: ORG,
      productId: 'prod-1',
      costCurrency: 'USD',
      variants: [
        { variantId: 'prod-1-v0', sourceVariantId: '9001', costMinor: 1150, retailMinor: 2499, available: true },
        { variantId: 'prod-1-v1', sourceVariantId: '9002', costMinor: 1250, retailMinor: 2599, available: true },
      ],
    })
  })

  it('re-imports into the same product and variants, copying no photos unless told', async () => {
    await importTee()
    calls = []
    const again = await importTee()
    expect(again).toMatchObject({ outcome: 'updated', productId: 'prod-1' })
    expect(written[1]).toMatchObject({ productId: 'prod-1', content: false })
    expect(written[1].product.variants.map((variant) => variant.variantId)).toEqual(['prod-1-v0', 'prod-1-v1'])
    expect(calls.some((call) => call.path === '/api/media/upload')).toBe(false)
  })

  it('refuses a product priced in another currency, and a batch too large', async () => {
    override = (call) =>
      call.path === '/store/products/501'
        ? { status: 200, body: { result: { ...PRINTFUL_PRODUCT, sync_variants: PRINTFUL_PRODUCT.sync_variants.map((v) => ({ ...v, currency: 'EUR' })) } } }
        : null
    const result = await importTee()
    expect(result).toEqual({
      sourceProductId: '501',
      outcome: 'failed',
      message: 'Printful prices “Ocean Tee” in EUR and this store sells in USD. Set both to the same currency first.',
    })
    expect(written).toHaveLength(0)
    const tooMany = await importRoute(
      request(POD_API_ROUTES.importProducts, 'tok-editor', { body: { provider: 'printful', productIds: ['1', '2', '3', '4', '5', '6'] } }),
    )
    expect(tooMany.status).toBe(400)
  })

  it('says the plan’s allowance in words, and leaves a photo out rather than the product', async () => {
    // A photo the service will not serve is left out; the product still comes in.
    override = (call) => (call.path === '/s.png' ? { status: 404 } : null)
    const imported = await importTee()
    expect(imported).toMatchObject({ outcome: 'created', imagesSkipped: 1 })
    expect(written[0].product.variants[0].imageUrl).toBeUndefined()

    // The keeper refuses past the plan's allowance; nothing is linked.
    db.docs.delete(`podProductLinks/${linkId(HOST, 'printful', '501')}`)
    storeProducts.clear()
    const keeper = { upsertSourced: async () => ({ outcome: 'plan_limit' as const, limit: 10 }) }
    resetPluginServicesForTests()
    registerPluginProductWriter(keeper, { pluginId: 'commerce' })
    expect(await importTee()).toEqual({
      sourceProductId: '501',
      outcome: 'failed',
      message: 'Your plan includes 10 products. Upgrade in Billing to import more.',
    })
    expect(db.docs.has(`podProductLinks/${linkId(HOST, 'printful', '501')}`)).toBe(false)
  })

  it('lists imported products a page at a time, newest first, and unlinks one for the site only', async () => {
    await importTee()
    db.docs.set(`podProductLinks/${linkId(HOST, 'printful', '600')}`, { orgId: ORG, hostId: HOST, provider: 'printful', productId: 'prod-9', sourceProductId: '600', importedAtMs: 1, variants: [] })
    const first = await json(await importedRoute(request(POD_API_ROUTES.imported, 'tok-viewer', { query: { pageSize: '1' } })))
    expect(first.body.links.map((link: { productId: string }) => link.productId)).toEqual(['prod-1'])
    expect(first.body.next).toBeTruthy()
    const second = await json(await importedRoute(request(POD_API_ROUTES.imported, 'tok-viewer', { query: { pageSize: '1', after: first.body.next } })))
    expect(second.body.links.map((link: { productId: string }) => link.productId)).toEqual(['prod-9'])
    expect(second.body.next).toBeNull()

    const product = await json(await productLinkRoute(request(POD_API_ROUTES.productLink, 'tok-viewer', { query: { productId: 'prod-1' } })))
    expect(product.body.link.sourceProductId).toBe('501')

    const foreign = await unlinkRoute(request(POD_API_ROUTES.unlink, 'tok-editor', { body: { linkId: `${OTHER_HOST}__printful__1` } }))
    expect(foreign.status).toBe(400)
    await unlinkRoute(request(POD_API_ROUTES.unlink, 'tok-editor', { body: { linkId: linkId(HOST, 'printful', '501') } }))
    expect(db.docs.has(`podProductLinks/${linkId(HOST, 'printful', '501')}`)).toBe(false)
  })

  it('the job re-syncs a due product without photos, and drops the link of a product the merchant deleted', async () => {
    await importTee()
    const id = `podProductLinks/${linkId(HOST, 'printful', '501')}`
    db.docs.set(id, { ...(db.docs.get(id) as object), syncDueAtMs: 0 })
    calls = []
    expect(await runPodLinkTick({ nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })).toEqual({ synced: 1, linkFailed: 0 })
    expect(written[1]).toMatchObject({ productId: 'prod-1', recreate: false })
    expect(calls.some((call) => call.path === '/api/media/upload')).toBe(false)

    storeProducts.delete('prod-1')
    db.docs.set(id, { ...(db.docs.get(id) as object), syncDueAtMs: 0 })
    expect(await runPodLinkTick({ nowMs: Date.now(), deadlineMs: Date.now() + 60_000 })).toEqual({ synced: 0, linkFailed: 1 })
    expect(db.docs.has(id)).toBe(false)
  })
})

/* ---------------------------------------------------------------- orders */

describe('orders', () => {
  beforeEach(async () => {
    await connectPrintful()
    await importTee()
    calls = []
  })

  it('sends a paid order’s imported lines once, confirmed, with the address read from the order', async () => {
    await onOrderPaid(paidEnvelope() as never)
    const stored = part()
    expect(stored).toMatchObject({
      orgId: ORG,
      orderRef: '#1042',
      status: 'submitted',
      testMode: false,
      externalId: podExternalId(HOST, ORDER_ID),
      sourceOrderId: '701',
      sourceOrderKey: 'printful:42:701',
      costs: { currency: 'USD', itemsMinor: 2300, shippingMinor: 499, taxMinor: 50, totalMinor: 2849 },
      attempts: 1,
      lastError: null,
      work: 'poll',
      leaseUntilMs: 0,
      lines: [
        { lineIndex: 0, quantity: 2, sourceVariantId: '9001', retailMinor: 2499, costMinor: 1150 },
        { lineIndex: 2, quantity: 1, sourceVariantId: '9002', retailMinor: 2599, costMinor: 1250 },
      ],
    })
    expect(stored?.externalId).toHaveLength(32)
    const created = serviceCalls().find((call) => call.method === 'POST' && call.path === '/orders')
    expect(created?.search).toBe('?confirm=true')
    expect(created?.body.recipient).toEqual({
      name: 'Bea Buyer',
      address1: '1 Main St',
      city: 'Austin',
      state_code: 'TX',
      country_code: 'US',
      zip: '78701',
      phone: '555',
      email: 'buyer@example.com',
    })
    expect(created?.body.items.map((item: { external_id: string }) => item.external_id)).toEqual(['0', '2'])
    // No buyer address or email is kept here.
    expect(JSON.stringify(db.docs.get(`podOrders/${PART()}`))).not.toMatch(/Main St|buyer@example/)

    // A redelivered event, and a member's send, find it sent.
    calls = []
    await onOrderPaid(paidEnvelope() as never)
    expect(await sendPodOrder(PART(), { force: true })).toBe('skipped')
    expect(serviceCalls().filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(printfulOrders.size).toBe(1)
  })

  it('finds an order the service took but whose answer was lost, instead of sending it twice', async () => {
    let first = true
    override = (call) => {
      if (call.method === 'POST' && call.path === '/orders' && first) {
        first = false
        healthy(call)
        return { status: 502, body: { result: 'Bad gateway' } }
      }
      return null
    }
    await onOrderPaid(paidEnvelope() as never)
    expect(part()).toMatchObject({ status: 'queued', work: 'submit', attempts: 1, lastError: 'Printful: Bad gateway' })
    expect(await sendPodOrder(PART(), { now: Date.now() + 120_000 })).toBe('found')
    expect(part()).toMatchObject({ status: 'submitted', sourceOrderId: '701', attempts: 2 })
    expect(printfulOrders.size).toBe(1)
  })

  it('leaves a test order a draft, never confirmed', async () => {
    await onOrderPaid(paidEnvelope({ testMode: true }) as never)
    expect(part()).toMatchObject({ status: 'draft', testMode: true })
    expect(serviceCalls().find((call) => call.path === '/orders')?.search).toBe('?confirm=false')
    const confirm = await json(await orderActionRoute(request(POD_API_ROUTES.orderAction, 'tok-editor', { body: { orderId: ORDER_ID, provider: 'printful', action: 'confirm' } })))
    expect(confirm.status).toBe(409)
    expect(confirm.body.error).toBe('A test order is never sent for production.')
    expect(printfulOrders.get('701')?.status).toBe('draft')
  })

  it('leaves a live order a draft in review mode, for a member to confirm', async () => {
    await settingsRoute(request(POD_API_ROUTES.settings, 'tok-admin', { body: { provider: 'printful', submitMode: 'review' } }))
    await onOrderPaid(paidEnvelope() as never)
    expect(part()?.status).toBe('draft')
    const view = await json(await orderRoute(request(POD_API_ROUTES.order, 'tok-viewer', { query: { orderId: ORDER_ID } })))
    expect(view.body.parts[0].actions).toEqual(['confirm', 'refresh', 'cancel'])
    const confirmed = await json(await orderActionRoute(request(POD_API_ROUTES.orderAction, 'tok-editor', { body: { orderId: ORDER_ID, provider: 'printful', action: 'confirm' } })))
    expect(confirmed.body.part.status).toBe('submitted')
    expect(printfulOrders.get('701')?.status).toBe('pending')
  })

  it('routes nothing for an order with no imported products, and nothing without a connection', async () => {
    await onOrderPaid(paidEnvelope({ lineItems: [{ productId: 'own-product', quantity: 1, unitAmountCents: 100 }] }) as never)
    expect(part()).toBeNull()
    await disconnectRoute(request(POD_API_ROUTES.disconnect, 'tok-admin', { body: { provider: 'printful' } }))
    await onOrderPaid(paidEnvelope() as never)
    expect(part()).toBeNull()
  })

  it('retries a failure that may pass with backoff, and gives up on one that will not, telling the managers', async () => {
    override = (call) => (call.method === 'POST' && call.path === '/orders' ? { status: 503 } : null)
    await onOrderPaid(paidEnvelope() as never)
    const queued = part()
    expect(queued).toMatchObject({ status: 'queued', work: 'submit', attempts: 1 })
    expect((queued?.dueAtMs ?? 0) - Date.now()).toBeGreaterThan(50_000)

    override = (call) =>
      call.method === 'POST' && call.path === '/orders' ? { status: 400, body: { error: { message: 'Invalid recipient address' } } } : null
    expect(await runPodOrderTick({ nowMs: Date.now() + 120_000, deadlineMs: Date.now() + 60_000 })).toMatchObject({ failed: 1 })
    expect(part()).toMatchObject({ status: 'failed', work: null, lastError: 'Printful: Invalid recipient address' })
    expect(notices).toEqual([
      {
        hostId: HOST,
        title: 'Order #1042 not sent to Printful',
        body: expect.stringContaining('Invalid recipient address'),
      },
    ])

    // A member fixes it and sends it again, with a fresh budget of tries.
    override = null
    const retried = await json(await orderActionRoute(request(POD_API_ROUTES.orderAction, 'tok-editor', { body: { orderId: ORDER_ID, provider: 'printful', action: 'retry' } })))
    expect(retried.body.part).toMatchObject({ status: 'submitted', attempts: 1 })
  })

  it('fails at once an order with no address to ship to', async () => {
    orderRecord = { shipTo: { name: 'X', country: 'US' } }
    await onOrderPaid(paidEnvelope() as never)
    expect(part()).toMatchObject({ status: 'failed', lastError: 'The order has no complete shipping address, so it cannot be sent to be made.' })
    expect(serviceCalls().some((call) => call.path === '/orders')).toBe(false)
  })

  it('holds a locked workspace’s order, untouched, until the lock lifts', async () => {
    lockdown = { scope: 'all' }
    await onOrderPaid(paidEnvelope() as never)
    expect(part()).toMatchObject({ status: 'queued', work: 'submit', attempts: 0 })
    expect(serviceCalls().some((call) => call.path === '/orders')).toBe(false)
    lockdown = null
    await runPodOrderTick({ nowMs: Date.now() + 2 * 3_600_000, deadlineMs: Date.now() + 60_000 })
    expect(part()?.status).toBe('submitted')
  })

  it('writes each parcel onto the order once, with the lines it carried', async () => {
    await onOrderPaid(paidEnvelope() as never)
    const order = printfulOrders.get('701') as FakeOrder
    order.status = 'partial'
    order.shipments = [{ id: 555, carrier: 'USPS', tracking_number: '9400111', tracking_url: 'https://tools.usps.com/9400111', items: [{ item_id: 1000, quantity: 2 }] }]
    expect(await refreshPodOrder(PART())).toBe('refreshed')
    expect(shipments).toEqual([
      {
        hostId: HOST,
        recordId: ORDER_ID,
        lines: [{ lineIndex: 0, quantity: 2 }],
        carrier: 'USPS',
        trackingNumber: '9400111',
        trackingUrl: 'https://tools.usps.com/9400111',
        labelRef: 'pod:printful:555',
      },
    ])
    expect(part()).toMatchObject({ status: 'partially_shipped', work: 'poll' })
    await refreshPodOrder(PART())
    expect(shipments).toHaveLength(1)

    order.status = 'fulfilled'
    order.shipments.push({ id: 556, carrier: 'USPS', tracking_number: '9400112', items: [{ item_id: 1001, quantity: 1 }] })
    await refreshPodOrder(PART())
    expect(shipments.map((entry) => entry.lines)).toEqual([[{ lineIndex: 0, quantity: 2 }], [{ lineIndex: 2, quantity: 1 }]])
    expect(part()).toMatchObject({ status: 'shipped', work: null })
  })

  it('keeps a parcel the order refused, with the reason, and tries again later', async () => {
    await onOrderPaid(paidEnvelope() as never)
    const order = printfulOrders.get('701') as FakeOrder
    order.status = 'fulfilled'
    order.shipments = [{ id: 555, carrier: 'USPS', tracking_number: '1', items: [] }]
    shipmentOutcome = 'blocked'
    await refreshPodOrder(PART())
    expect(part()?.shipments[0]).toMatchObject({ recorded: false, refusal: 'The order is cancelled, so the parcel was not added to it.' })
    expect(part()?.work).toBe('poll')
    shipmentOutcome = 'recorded'
    await refreshPodOrder(PART())
    expect(part()).toMatchObject({ work: null, lastError: null })
  })

  it('cancels at the service when the store cancels or fully refunds, and not for a part refund', async () => {
    await onOrderPaid(paidEnvelope() as never)
    await onOrderRefunded({ ...paidEnvelope(), event: 'order.refunded', payload: { ...paidEnvelope().payload, refund: { full: false } } } as never)
    expect(part()?.status).toBe('submitted')
    await onOrderRefunded({ ...paidEnvelope(), event: 'order.refunded', payload: { ...paidEnvelope().payload, refund: { full: true } } } as never)
    expect(part()).toMatchObject({ status: 'canceled', work: null })
    expect(printfulOrders.get('701')?.status).toBe('canceled')
    await onOrderCancelled({ ...paidEnvelope(), event: 'order.cancelled' } as never)
    expect(serviceCalls().filter((call) => call.method === 'DELETE')).toHaveLength(1)
  })

  it('tells the managers when the service has already started making a canceled order', async () => {
    await onOrderPaid(paidEnvelope() as never)
    const order = printfulOrders.get('701') as FakeOrder
    order.status = 'inprocess'
    await refreshPodOrder(PART())
    await onOrderCancelled({ ...paidEnvelope(), event: 'order.cancelled' } as never)
    expect(part()?.status).toBe('in_production')
    expect(notices[0].title).toBe('Order #1042 is already in production at Printful')
  })

  it('cancels an order never sent here, and one canceled mid-send once the send settles', async () => {
    lockdown = { scope: 'all' }
    await onOrderPaid(paidEnvelope() as never)
    const outcome = await cancelPodOrder(PART(), parseSecretBoxKeyring(TOKEN_KEY), 'Canceled.')
    expect(outcome.ok).toBe(true)
    expect(part()).toMatchObject({ status: 'canceled', work: null })
    expect(await sendPodOrder(PART(), { force: true })).toBe('skipped')

    // A cancel that arrives while a send holds the part.
    lockdown = null
    db.docs.delete(`podOrders/${PART()}`)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slowService: ProviderFetch = async (url, init) => {
      if (String(url).includes('/orders') && init?.method === 'POST') await gate
      return service(url, init)
    }
    setPodFetchForTests(slowService)
    const paid = onOrderPaid(paidEnvelope() as never)
    while (!part() || part()?.leaseUntilMs === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    await onOrderCancelled({ ...paidEnvelope(), event: 'order.cancelled' } as never)
    expect(part()?.work).toBe('cancel')
    release()
    await paid
    expect(part()).toMatchObject({ status: 'submitted', work: 'cancel' })
    await runPodOrderTick({ nowMs: Date.now() + 1_000, deadlineMs: Date.now() + 60_000 })
    expect(part()).toMatchObject({ status: 'canceled', work: null })
  })

  it('leaves a draft for an order the store’s own record says was paid in test mode', async () => {
    orderRecord = { ...orderRecord, testMode: true }
    await onOrderPaid(paidEnvelope() as never)
    expect(part()).toMatchObject({ status: 'draft', testMode: true })
    expect(serviceCalls().find((call) => call.path === '/orders')?.search).toBe('?confirm=false')
  })

  it('holds the units it has not shipped, for a label bought for the rest of the order', async () => {
    registerPrintOnDemandServerDeclarations()
    expect(listPluginFulfillmentProviders().map((entry) => entry.id).sort()).toEqual(['printful', 'printify'])
    await onOrderPaid(paidEnvelope() as never)
    expect(await podFulfillmentHolds(HOST, ORDER_ID, 'printful')).toEqual([
      { providerId: 'printful', providerLabel: 'Printful', lineIndex: 0, quantity: 2, state: 'accepted', reference: '701' },
      { providerId: 'printful', providerLabel: 'Printful', lineIndex: 2, quantity: 1, state: 'accepted', reference: '701' },
    ])
    const order = printfulOrders.get('701') as FakeOrder
    order.status = 'partial'
    order.shipments = [{ id: 555, carrier: 'USPS', tracking_number: '1', items: [{ item_id: 1000, quantity: 2 }] }]
    await refreshPodOrder(PART())
    const seen = await pluginFulfillmentHolds(HOST, ORDER_ID)
    expect(seen.unanswered).toEqual([])
    expect(seen.holds.map((hold) => [hold.providerId, hold.lineIndex, hold.quantity])).toEqual([['printful', 2, 1]])
    // Too far along to cancel, so the service still holds what it is making.
    await onOrderCancelled({ ...paidEnvelope(), event: 'order.cancelled' } as never)
    expect((await podFulfillmentHolds(HOST, ORDER_ID, 'printful')).map((hold) => hold.lineIndex)).toEqual([2])
    // A canceled part holds nothing.
    db.docs.set(`podOrders/${PART()}`, { ...(db.docs.get(`podOrders/${PART()}`) as object), status: 'canceled' })
    expect(await podFulfillmentHolds(HOST, ORDER_ID, 'printful')).toEqual([])
  })

  it('sends none of a line another fulfiller already holds', async () => {
    registerPluginFulfillmentProvider(
      {
        id: 'shipbob',
        label: 'ShipBob',
        holds: async () => [{ providerId: 'shipbob', providerLabel: 'ShipBob', lineIndex: 0, quantity: 2, state: 'accepted' }],
      },
      { pluginId: 'fulfillment-network' },
    )
    await onOrderPaid(paidEnvelope() as never)
    expect(part()?.lines.map((line) => [line.lineIndex, line.quantity])).toEqual([[2, 1]])
  })

  it('lists the site’s sent orders newest first', async () => {
    await onOrderPaid(paidEnvelope() as never)
    const list = await json(await ordersRoute(request(POD_API_ROUTES.orders, 'tok-editor')))
    expect(list.body.parts).toHaveLength(1)
    expect(list.body.parts[0]).toMatchObject({ orderRef: '#1042', providerLabel: 'Printful', status: 'submitted', retailMinor: 2 * 2499 + 2599 })
  })
})

/* -------------------------------------------------------------- webhooks */

describe('webhook doors', () => {
  beforeEach(async () => {
    await connectPrintful()
    await importTee()
    await onOrderPaid(paidEnvelope() as never)
    calls = []
  })

  const hookUrl = () => String(printfulWebhook)

  it('refuses a notice without the connection’s secret', async () => {
    const forged = hookUrl().replace(/t=[^&]+/, 't=wrong')
    expect((await printfulWebhookRoute(new Request(forged, { method: 'POST', body: '{}' }))).status).toBe(401)
    expect((await printfulWebhookRoute(new Request('https://console.test/api/x', { method: 'POST', body: '{}' }))).status).toBe(401)
    expect(serviceCalls()).toHaveLength(0)
  })

  it('reads the order a verified notice names from the service, and writes its parcel', async () => {
    const order = printfulOrders.get('701') as FakeOrder
    order.status = 'fulfilled'
    order.shipments = [{ id: 9, carrier: 'UPS', tracking_number: '1Z', items: [{ item_id: 1000, quantity: 2 }, { item_id: 1001, quantity: 1 }] }]
    // The payload claims nothing the store believes: only which order to read.
    const body = JSON.stringify({ type: 'package_shipped', data: { order: { id: 701, status: 'fulfilled' }, shipment: { tracking_number: 'FORGED' } } })
    const answer = await json(await printfulWebhookRoute(new Request(hookUrl(), { method: 'POST', body })))
    expect(answer.body).toEqual({ ok: true, applied: 'refreshed' })
    expect(serviceCalls().map((call) => `${call.method} ${call.path}`)).toEqual(['GET /orders/701'])
    expect(shipments.map((entry) => entry.trackingNumber)).toEqual(['1Z'])
    const unknown = await json(await printfulWebhookRoute(new Request(hookUrl(), { method: 'POST', body: JSON.stringify({ data: { order: { id: 1 } } }) })))
    expect(unknown.body.applied).toBe('unknown_order')
  })

  it('checks Printify’s signature as well as the secret, and maps its parcel to the lines it reports done', async () => {
    const connected = await json(await connectRoute(request(POD_API_ROUTES.connect, 'tok-admin', { body: { provider: 'printify', token: 'pfy-token' } })))
    expect(connected.body.connection).toMatchObject({ provider: 'printify', storeId: '9', webhooks: 'registered' })
    expect(printifyHooks.map((hook) => hook.topic)).toEqual(['order:updated', 'order:sent-to-production', 'order:shipment:created', 'order:shipment:delivered'])
    const { url, secret } = printifyHooks[0]
    expect(new URL(url).searchParams.get('t')).toBe(secret)

    const imported = await json(await importRoute(request(POD_API_ROUTES.importProducts, 'tok-editor', { body: { provider: 'printify', productIds: ['p1'] } })))
    expect(imported.body.results[0]).toMatchObject({ outcome: 'created', productId: 'prod-2' })
    await onOrderPaid({
      ...paidEnvelope(),
      id: 'evt-2',
      payload: {
        order: {
          id: ORDER_ID,
          number: 1042,
          currency: 'usd',
          lineItems: [
            { productId: 'prod-1', variantId: 'prod-1-v0', name: 'Ocean Tee', quantity: 1, unitAmountCents: 2499 },
            { productId: 'prod-2', variantId: 'prod-2-v0', name: 'Wave Mug', quantity: 2, unitAmountCents: 1500 },
            { productId: 'prod-2', variantId: 'prod-2-v1', name: 'Wave Mug', quantity: 1, unitAmountCents: 1800 },
          ],
        },
      },
    } as never)
    const printifyPart = () => readStoredPodOrder(db.docs.get(`podOrders/${podOrderId(HOST, ORDER_ID, 'printify')}`))
    expect(printifyPart()).toMatchObject({ status: 'in_production', sourceOrderId: 'o1', lines: [{ lineIndex: 1 }, { lineIndex: 2 }] })
    // The order's Printful part was made by the first delivery and is not made again.
    expect(part()?.lines.map((line) => line.lineIndex)).toEqual([0, 2])

    // Printify ships the 11oz mugs first, and they arrive.
    const order = printifyOrder as Record<string, any>
    order.status = 'partially-fulfilled'
    order.line_items[0].status = 'fulfilled'
    order.shipments = [{ carrier: 'usps', number: '9400222', url: 'https://track.example/9400222', delivered_at: '2026-10-09 12:00:00+00:00' }]
    const body = JSON.stringify({ type: 'order:shipment:created', resource: { id: 'o1', type: 'order' } })
    const signed = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect((await printifyWebhookRoute(new Request(url, { method: 'POST', body, headers: { 'x-pfy-signature': 'sha256=00' } }))).status).toBe(401)
    const answer = await json(await printifyWebhookRoute(new Request(url, { method: 'POST', body, headers: { 'x-pfy-signature': signed } })))
    expect(answer.body).toEqual({ ok: true, applied: 'refreshed' })
    const parcel = shipments.find((entry) => entry.trackingNumber === '9400222')
    expect(parcel).toMatchObject({ lines: [{ lineIndex: 1, quantity: 2 }], labelRef: 'pod:printify:usps:9400222', carrier: 'usps' })
    expect(tracking).toEqual([
      { hostId: HOST, recordId: ORDER_ID, trackingNumber: '9400222', status: 'delivered', atMs: Date.parse('2026-10-09T12:00:00+00:00') },
    ])
    expect(printifyPart()).toMatchObject({ status: 'partially_shipped', work: 'poll' })
  })
})
