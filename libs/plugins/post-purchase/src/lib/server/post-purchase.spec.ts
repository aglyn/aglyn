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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  registerPluginShipmentRecords,
  type PluginTrackingUpdate,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { createHmac, randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setPostPurchaseFetchForTests } from './config'
import { setPostPurchaseDbForTests } from './db'
import { offerPackageProtection, PROTECTION_MARKUP_CENTS, trackingPageFor } from './offers'
import {
  endProtectionPolicy,
  followParcel,
  openProtectionPolicy,
  syncNarvarOrder,
  tellRouteShipment,
  type OrderEventPayload,
  type OrderFulfilledPayload,
  type OrderRefundedPayload,
} from './order-sync'
import { aftershipWebhookRoute, availabilityRoute, orderRoute, settingsRoute } from './routes'

/**
 * Post-purchase's server half through its doors: the console routes and
 * the gate each climbs, the settings a merchant connects (sealed, never read
 * back), the package-protection offer the cart asks for, the order events
 * that open, tell and end a Route policy, follow a parcel in AfterShip and
 * keep Narvar whole, and AfterShip's signed webhook. An in-memory Firestore
 * and a recording vendor; nothing leaves the process.
 */

const ORG = 'org-candles'
const HOST = 'host-candles'
let db: MemoryFirestore

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email: 'ed@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-out', email: 'out@example.com', email_verified: true },
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
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' ? { orgId: 'org-candles', org: { name: 'Candles', plan: 'pro' } } : null,
  getHostDocAdmin: async (hostId: string) =>
    hostId === 'host-candles'
      ? { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } }
      : null,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

/** Every vendor, recorded; `fail` makes the next call to a path answer that status. */
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
const fail = new Map<string, number>()
const vendorFetch = async (url: string, init: RequestInit) => {
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body })
  const path = new URL(url).pathname
  const status = fail.get(path)
  if (status) {
    fail.delete(path)
    return new Response(JSON.stringify({ error: 'no' }), { status })
  }
  const answer = path.endsWith('/quotes')
    ? { id: 'q_1', premium: { amount: '1.98', currency: 'USD' } }
    : path.endsWith('/orders') && url.includes('route')
      ? { id: 'pol_1' }
      : path.endsWith('/trackings')
        ? { data: { id: 'trk_1' } }
        : {}
  return new Response(JSON.stringify(answer), { status: 200 })
}

const tracking: PluginTrackingUpdate[] = []

function request(method: string, route: string, options: { token?: string; query?: Record<string, string>; body?: unknown } = {}) {
  const query = new URLSearchParams({ hostId: HOST, ...(options.query ?? {}) }).toString()
  return new Request(`https://console.example/api/${route}?${query}`, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

async function connect(change: Record<string, unknown>) {
  const response = await settingsRoute(request('POST', 'post-purchase/settings', { token: 'tok-admin', body: { hostId: HOST, change } }))
  expect(response.status).toBe(200)
  return response.json()
}

const ORDER = {
  id: 'cs_1',
  number: 1042,
  status: 'paid',
  currency: 'usd',
  customerEmail: 'ann@example.com',
  customerName: 'Ann Lee',
  lineItems: [
    { productId: 'lamp', name: 'Lamp', sku: 'L-1', quantity: 1, unitAmountCents: 10_000, productType: 'physical' },
    { productId: 'pdf', name: 'Guide', quantity: 1, unitAmountCents: 500, productType: 'digital' },
  ],
  shippingAddress: { line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
  fulfillments: [] as any[],
  extras: [
    { id: 'post-purchase.package-protection', pluginId: 'post-purchase', key: 'package-protection', label: 'Package protection', amountCents: 198, quoteRef: 'q_1' },
  ],
}

function envelope<P>(event: string, payload: P, id = `${event}:1`): PluginDomainEventEnvelope<P> {
  return { id, event, hostId: HOST, orgId: ORG, occurredAtMs: Date.UTC(2026, 9, 7), attempt: 1, payload }
}

const FULFILLMENT = { id: 'f_1', lines: [{ lineItemId: 0, quantity: 1 }], carrier: 'UPS', trackingNumber: '1Z999' }

function routeCalls(path: string) {
  return calls.filter((call) => call.url.startsWith('https://api.route.com') && call.url.endsWith(path))
}

beforeEach(() => {
  db = createMemoryFirestore()
  setPostPurchaseDbForTests(db)
  setPostPurchaseFetchForTests(vendorFetch as never)
  calls.length = 0
  fail.clear()
  tracking.length = 0
  process.env['POST_PURCHASE_VENDORS'] = 'aftership,route,narvar'
  process.env['POST_PURCHASE_TOKEN_KEY'] = randomBytes(32).toString('base64')
  resetPluginServicesForTests()
  registerPluginShipmentRecords(
    {
      read: async () => null,
      recordShipment: async () => ({ outcome: 'no_such_record' }),
      recordTracking: async (update) => {
        tracking.push(update)
        return { outcome: 'recorded' }
      },
      shipFromAddresses: async () => [],
    },
    { pluginId: 'seller' },
  )
})

afterEach(() => {
  setPostPurchaseDbForTests(null)
  setPostPurchaseFetchForTests(null)
  delete process.env['POST_PURCHASE_VENDORS']
  delete process.env['POST_PURCHASE_TOKEN_KEY']
})

describe('the gate', () => {
  it('hides every surface on a deployment that offers nothing', async () => {
    delete process.env['POST_PURCHASE_VENDORS']
    const response = await availabilityRoute(request('GET', 'post-purchase/availability', { token: 'tok-admin' }))
    expect(response.status).toBe(404)
  })

  it('refuses no token, an unverified address, a stranger and a site that is not this one', async () => {
    expect((await availabilityRoute(request('GET', 'x'))).status).toBe(401)
    expect((await availabilityRoute(request('GET', 'x', { token: 'tok-bogus' }))).status).toBe(401)
    expect((await availabilityRoute(request('GET', 'x', { token: 'tok-unverified' }))).status).toBe(403)
    expect((await availabilityRoute(request('GET', 'x', { token: 'tok-outsider' }))).status).toBe(403)
    expect((await availabilityRoute(request('GET', 'x', { token: 'tok-admin', query: { hostId: 'elsewhere' } }))).status).toBe(404)
  })

  it('answers only the services the deployment offers', async () => {
    process.env['POST_PURCHASE_VENDORS'] = 'route, bogus'
    const response = await availabilityRoute(request('GET', 'x', { token: 'tok-viewer' }))
    await expect(response.json()).resolves.toEqual({ available: true, vendors: ['route'] })
  })
})

describe('settings', () => {
  it('lets only an admin store a credential, seals it, and never hands it back', async () => {
    const editor = await settingsRoute(
      request('POST', 'x', { token: 'tok-editor', body: { hostId: HOST, change: { vendor: 'route', apiKey: 'rt_secret', enabled: true } } }),
    )
    expect(editor.status).toBe(403)
    const answer = await connect({ vendor: 'route', apiKey: 'rt_secret', enabled: true, defaultSelected: true })
    expect(answer.settings.route).toEqual({ enabled: true, connected: true, defaultSelected: true })
    const stored = db.docs.get(`orgs/${ORG}/postPurchaseHostSettings/${HOST}`)
    expect(JSON.stringify(stored)).not.toContain('rt_secret')
    const read = await settingsRoute(request('GET', 'x', { token: 'tok-viewer' }))
    expect(JSON.stringify(await read.json())).not.toContain('rt_secret')
  })

  it('refuses switching a service on with no credential, and a tracking page that is not https', async () => {
    const off = await settingsRoute(request('POST', 'x', { token: 'tok-admin', body: { hostId: HOST, change: { vendor: 'narvar', enabled: true } } }))
    expect(off.status).toBe(400)
    const page = await settingsRoute(
      request('POST', 'x', { token: 'tok-admin', body: { hostId: HOST, change: { vendor: 'aftership', trackingPageUrl: 'http://x.example' } } }),
    )
    expect(page.status).toBe(400)
    const bogus = await settingsRoute(request('POST', 'x', { token: 'tok-admin', body: { hostId: HOST, change: { vendor: 'shopify' } } }))
    expect(bogus.status).toBe(400)
  })

  it('checks an AfterShip key with AfterShip before keeping it', async () => {
    fail.set('/tracking/2024-04/couriers', 401)
    const refused = await settingsRoute(
      request('POST', 'x', { token: 'tok-admin', body: { hostId: HOST, change: { vendor: 'aftership', apiKey: 'bad', webhookSecret: 'w' } } }),
    )
    expect(refused.status).toBe(400)
    await expect(refused.json()).resolves.toEqual({ error: 'AfterShip did not accept that API key.' })
    const kept = await connect({ vendor: 'aftership', apiKey: 'good', webhookSecret: 'whsec', enabled: true })
    expect(kept.settings.aftership).toMatchObject({ enabled: true, connected: true })
  })

  it('disconnects: the credential goes and the service is off', async () => {
    await connect({ vendor: 'route', apiKey: 'rt_secret', enabled: true })
    const answer = await connect({ vendor: 'route', disconnect: true })
    expect(answer.settings.route).toEqual({ enabled: false, connected: false, defaultSelected: false })
  })
})

describe('package protection at the cart', () => {
  const REQUEST = {
    hostId: HOST,
    currency: 'usd',
    itemsCents: 10_500,
    lines: [
      { name: 'Lamp', quantity: 1, unitCents: 10_000, ships: true },
      { name: 'Guide', quantity: 1, unitCents: 500, ships: false },
    ],
  }

  it('offers nothing until Route is connected and switched on', async () => {
    await expect(offerPackageProtection(REQUEST)).resolves.toBeNull()
    await connect({ vendor: 'route', apiKey: 'rt_secret' })
    await expect(offerPackageProtection(REQUEST)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('offers Route’s premium for the shipped goods only, with nothing added', async () => {
    expect(PROTECTION_MARKUP_CENTS).toBe(0)
    await connect({ vendor: 'route', apiKey: 'rt_secret', enabled: true, defaultSelected: true })
    await expect(offerPackageProtection(REQUEST)).resolves.toEqual({
      key: 'package-protection',
      label: 'Package protection',
      description: 'Covers loss, damage and theft in transit, through Route.',
      amountCents: 198,
      currency: 'usd',
      defaultSelected: true,
      quoteRef: 'q_1',
    })
    expect(routeCalls('/quotes')[0].body.subtotal).toBe('100.00')
  })

  it('offers nothing for a basket that does not ship', async () => {
    await connect({ vendor: 'route', apiKey: 'rt_secret', enabled: true })
    await expect(offerPackageProtection({ ...REQUEST, lines: [REQUEST.lines[1]] })).resolves.toBeNull()
  })
})

describe('the Route policy', () => {
  beforeEach(async () => {
    await connect({ vendor: 'route', apiKey: 'rt_secret', enabled: true })
  })

  it('opens once however many times order.paid is delivered', async () => {
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    expect(routeCalls('/orders')).toHaveLength(1)
    expect(routeCalls('/orders')[0].body).toMatchObject({ source_order_id: 'cs_1', paid_to_insure: '1.98', subtotal: '100.00' })
    const view = await (await orderRoute(request('GET', 'x', { token: 'tok-viewer', query: { recordId: 'cs_1' } }))).json()
    expect(view.order.protection).toEqual({ status: 'registered', premiumCents: 198, policyId: 'pol_1', error: null })
  })

  it('does nothing for an order that did not buy it', async () => {
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: { ...ORDER, extras: [] } }))
    expect(calls).toHaveLength(0)
  })

  it('throws to be retried on a passing failure, and opens on the retry', async () => {
    fail.set('/v2/orders', 503)
    await expect(openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))).rejects.toThrow()
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    expect(routeCalls('/orders')).toHaveLength(2)
    expect(db.docs.get(`orgs/${ORG}/postPurchaseOrders/${HOST}__cs_1`)?.['route']?.status).toBe('registered')
  })

  it('records a refusal for the merchant and stops asking', async () => {
    fail.set('/v2/orders', 422)
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    expect(routeCalls('/orders')).toHaveLength(1)
    const view = await (await orderRoute(request('GET', 'x', { token: 'tok-viewer', query: { recordId: 'cs_1' } }))).json()
    expect(view.order.protection).toMatchObject({ status: 'failed', error: 'Route refused it (422).' })
  })

  it('still opens cover the buyer paid for after the merchant switched Route off', async () => {
    await connect({ vendor: 'route', enabled: false })
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    expect(routeCalls('/orders')).toHaveLength(1)
  })

  it('tells each parcel once, and waits for a policy still being opened', async () => {
    const fulfilled = envelope<OrderFulfilledPayload>('order.fulfilled', { order: ORDER, fulfillment: FULFILLMENT })
    await expect(tellRouteShipment(fulfilled)).resolves.toBeUndefined()
    expect(routeCalls('/shipments')).toHaveLength(0)
    fail.set('/v2/orders', 503)
    await expect(openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))).rejects.toThrow()
    await expect(tellRouteShipment(fulfilled)).rejects.toThrow('not open yet')
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    await tellRouteShipment(fulfilled)
    await tellRouteShipment(fulfilled)
    expect(routeCalls('/shipments')).toHaveLength(1)
    expect(routeCalls('/shipments')[0].body).toEqual({
      source_order_id: 'cs_1',
      tracking_number: '1Z999',
      courier_id: 'UPS',
      source_product_ids: ['lamp'],
    })
  })

  it('ends on a whole refund or a cancel, never on a partial refund', async () => {
    await openProtectionPolicy(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    await endProtectionPolicy(envelope<OrderRefundedPayload>('order.refunded', { order: ORDER, refund: { full: false } }))
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(0)
    await endProtectionPolicy(envelope<OrderRefundedPayload>('order.refunded', { order: ORDER, refund: { full: true } }))
    await endProtectionPolicy(envelope<OrderEventPayload>('order.cancelled', { order: ORDER }))
    expect(calls.filter((call) => call.url.endsWith('/orders/pol_1/cancel'))).toHaveLength(1)
    expect(db.docs.get(`orgs/${ORG}/postPurchaseOrders/${HOST}__cs_1`)?.['route']?.status).toBe('cancelled')
  })
})

describe('AfterShip', () => {
  beforeEach(async () => {
    await connect({ vendor: 'aftership', apiKey: 'as_key', webhookSecret: 'whsec', enabled: true, trackingPageUrl: 'https://candles.aftership.com' })
    calls.length = 0
  })

  function delivery(body: unknown, secret = 'whsec') {
    const raw = JSON.stringify(body)
    return new Request(`https://console.example/api/post-purchase/webhooks/aftership?hostId=${HOST}`, {
      method: 'POST',
      headers: { 'aftership-hmac-sha256': createHmac('sha256', secret).update(raw).digest('base64') },
      body: raw,
    })
  }

  const UPDATE = { msg: { tracking_number: '1Z999', tag: 'OutForDelivery', custom_fields: { host_id: HOST, record_id: 'cs_1' } } }

  it('follows each shipped parcel once', async () => {
    const fulfilled = envelope<OrderFulfilledPayload>('order.fulfilled', { order: ORDER, fulfillment: FULFILLMENT })
    await followParcel(fulfilled)
    await followParcel(fulfilled)
    const created = calls.filter((call) => call.url.endsWith('/trackings'))
    expect(created).toHaveLength(1)
    expect(created[0].body).toMatchObject({ tracking_number: '1Z999', slug: 'ups', order_id: 'cs_1', order_number: '1042' })
  })

  it('records a verified update on the order, and nothing for a forged or unknown one', async () => {
    await followParcel(envelope<OrderFulfilledPayload>('order.fulfilled', { order: ORDER, fulfillment: FULFILLMENT }))
    expect((await aftershipWebhookRoute(delivery(UPDATE, 'forged'))).status).toBe(401)
    const unknown = await aftershipWebhookRoute(delivery({ msg: { ...UPDATE.msg, tracking_number: 'OTHER' } }))
    await expect(unknown.json()).resolves.toEqual({ ok: true, applied: 'unknown_parcel' })
    const elsewhere = await aftershipWebhookRoute(delivery({ msg: { ...UPDATE.msg, custom_fields: { host_id: 'other', record_id: 'cs_1' } } }))
    await expect(elsewhere.json()).resolves.toEqual({ ok: true, applied: 'unknown_parcel' })
    expect(tracking).toHaveLength(0)
    const applied = await aftershipWebhookRoute(delivery(UPDATE))
    await expect(applied.json()).resolves.toEqual({ ok: true, applied: 'recorded' })
    expect(tracking).toEqual([
      expect.objectContaining({ hostId: HOST, recordId: 'cs_1', trackingNumber: '1Z999', status: 'out_for_delivery' }),
    ])
  })

  it('links the store’s AfterShip page, and prefers Narvar where it knows the carrier', async () => {
    const parcel = { hostId: HOST, recordId: 'cs_1', carrier: 'UPS', trackingNumber: '1Z999' }
    await expect(trackingPageFor(parcel)).resolves.toBe('https://candles.aftership.com/1Z999')
    await connect({ vendor: 'narvar', accountId: 'acct', authToken: 'tok', retailerMoniker: 'candles', enabled: true })
    await expect(trackingPageFor(parcel)).resolves.toBe('https://candles.narvar.com/candles/tracking/ups?tracking_numbers=1Z999')
    await expect(trackingPageFor({ ...parcel, carrier: 'Canada Post' })).resolves.toBe('https://candles.aftership.com/1Z999')
  })
})

describe('Narvar', () => {
  it('sends the whole order on each event, with every parcel so far', async () => {
    await connect({ vendor: 'narvar', accountId: 'acct', authToken: 'tok', retailerMoniker: 'candles', enabled: true })
    await syncNarvarOrder(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    const shipped = {
      ...ORDER,
      status: 'fulfilled',
      fulfillments: [{ id: 'f_1', status: 'active', carrier: 'UPS', trackingNumber: '1Z999', lines: [{ lineItemId: 0, quantity: 1 }], at: '2026-10-08T00:00:00.000Z' }],
    }
    await syncNarvarOrder(envelope<OrderEventPayload>('order.fulfilled', { order: shipped }))
    const sent = calls.filter((call) => call.url.startsWith('https://ws.narvar.com'))
    expect(sent.map((call) => call.body.order_info.status)).toEqual(['PROCESSING', 'SHIPPED'])
    expect(sent[1].body.order_info.shipments).toEqual([
      expect.objectContaining({ carrier: 'ups', tracking_number: '1Z999', items_info: [{ item_id: 'lamp', sku: 'L-1', quantity: 1 }] }),
    ])
  })

  it('records a refusal on the order rather than retrying it forever', async () => {
    await connect({ vendor: 'narvar', accountId: 'acct', authToken: 'tok', enabled: true })
    fail.set('/api/v1/orders', 401)
    await syncNarvarOrder(envelope<OrderEventPayload>('order.paid', { order: ORDER }))
    const view = await (await orderRoute(request('GET', 'x', { token: 'tok-viewer', query: { recordId: 'cs_1' } }))).json()
    expect(view.order.narvar).toMatchObject({ error: 'Narvar refused it (401).' })
  })
})
