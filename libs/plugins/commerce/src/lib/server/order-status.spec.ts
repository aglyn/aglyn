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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  clearOrderStatusActions,
  orderStatusHandler,
  registerOrderStatusActions,
} from './order-status'
import { mintOrderStatusToken } from './order-status-token'
import { registerPluginTrackingPage } from '@aglyn/aglyn/plugin-manager/plugin-tracking-pages'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * The guest order-status data route (AGL-3610): the signed link is the whole
 * credential, a wrong one reads as a missing order, the answer is the
 * allow-listed projection, and lookups are rate-limited before the check.
 */
const docs = new Map<string, Record<string, any>>()
const mockConsume = jest.fn(async (_key: string, _options: any) => ({ allowed: true, resetMs: 0 }))

function ref(path: string): any {
  return {
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => docs.get(path)?.[field],
    }),
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  consumeRateLimit: (key: string, options: any) => mockConsume(key, options),
  firebaseAdmin: {
    app: () => ({ firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }) }),
  },
}))

const HOST = 'host-1'
const ORDER = 'order-1'

function call(query: Record<string, string>, method = 'GET') {
  const result = { status: 0, body: undefined as any, headers: {} as Record<string, string> }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader(name, value) {
      result.headers[name] = String(value)
    },
    redirect() {},
    end() {},
  }
  const req: PluginApiRequest = {
    method,
    query,
    body: undefined,
    headers: { 'x-forwarded-for': '203.0.113.9' },
    cookies: {},
    socket: { remoteAddress: '203.0.113.9' },
  }
  return Promise.resolve(orderStatusHandler(req, res)).then(() => result)
}

beforeEach(() => {
  process.env.TOKEN_SIGNING_SECRET = 'test-secret'
  docs.clear()
  mockConsume.mockClear()
  clearOrderStatusActions()
  docs.set(`hosts/${HOST}`, { displayName: 'Northwind Coffee', subdomain: 'northwind' })
  docs.set(`hosts/${HOST}/settings/store`, { currency: 'USD' })
  docs.set(`hosts/${HOST}/orders/${ORDER}`, {
    number: 1042,
    status: 'partially_fulfilled',
    channel: 'online',
    customerEmail: 'buyer@example.com',
    customerPhone: '+15555550100',
    shippingAddress: { line1: '1 Main St', city: 'Austin' },
    paymentIntentId: 'pi_secret',
    note: 'VIP — call before shipping',
    createdAtMs: 1_000,
    totals: { itemsCents: 3400, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 3900, feeCents: 100 },
    lineItems: [
      { productId: 'p1', name: 'House Blend', quantity: 2, unitAmountCents: 1200, productType: 'physical' },
      { productId: 'p2', name: 'Mug', quantity: 1, unitAmountCents: 1000, productType: 'physical' },
    ],
    fulfillments: [
      { id: 'f1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], carrier: 'ups', trackingNumber: '1Z1', atMs: 2_000 },
      { id: 'f0', lineItemIds: [1], carrier: 'UPS', trackingNumber: '1Z0', atMs: 1_500, status: 'cancelled' },
    ],
    timeline: [{ atMs: 1_000, event: 'paid' }],
  })
})

const token = () => mintOrderStatusToken(HOST, ORDER) as string

describe('orderStatusHandler (AGL-3610)', () => {
  it('answers a signed link with the order, shipments and tracking — and nothing private', async () => {
    const result = await call({ hostId: HOST, o: ORDER, t: token() })
    expect(result.status).toBe(200)
    expect(result.headers['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(result.headers['Cache-Control']).toBe('private, no-store')
    expect(result.body).toMatchObject({
      storeName: 'Northwind Coffee',
      number: '#1042',
      statusLabel: 'Partly shipped',
      totals: { totalCents: 3900, shippingCents: 500, refundedCents: 0 },
      shipments: [
        {
          id: 'f1',
          carrier: 'UPS',
          trackingNumber: '1Z1',
          trackingUrl: 'https://www.ups.com/track?tracknum=1Z1',
          lines: [{ name: 'House Blend', quantity: 1 }],
        },
      ],
    })
    expect(result.body.lines[0]).toMatchObject({ quantity: 2, shippedQuantity: 1 })
    const text = JSON.stringify(result.body)
    for (const secret of ['buyer@example.com', '+15555550100', 'Main St', 'pi_secret', 'VIP', 'feeCents']) {
      expect(text).not.toContain(secret)
    }
  })

  it('answers a wrong token exactly as a missing order', async () => {
    const forged = await call({ hostId: HOST, o: ORDER, t: '0'.repeat(32) })
    const missing = await call({ hostId: HOST, o: 'nope', t: mintOrderStatusToken(HOST, 'nope') as string })
    expect(forged.status).toBe(404)
    expect(forged.body).toEqual(missing.body)
    // Another site's token for the same order id does not open it.
    expect((await call({ hostId: HOST, o: ORDER, t: mintOrderStatusToken('host-2', ORDER) as string })).status).toBe(404)
  })

  it('rate-limits per address per site, before the token is checked', async () => {
    mockConsume.mockResolvedValueOnce({ allowed: false, resetMs: Date.now() + 60_000 })
    const result = await call({ hostId: HOST, o: ORDER, t: token() })
    expect(result.status).toBe(429)
    expect(result.headers['Retry-After']).toMatch(/^\d+$/)
    expect(mockConsume.mock.calls[0][0]).toBe(`commerce-order-status:${HOST}:203.0.113.9`)
  })

  it('refuses an incomplete link and anything but GET', async () => {
    expect((await call({ hostId: HOST, o: ORDER })).status).toBe(400)
    expect((await call({ hostId: HOST, o: 'a/b', t: 'x' })).status).toBe(400)
    expect((await call({ hostId: HOST, o: ORDER, t: token() }, 'POST')).status).toBe(405)
  })

  it('carries the actions a provider offers, and drops unsafe or failing ones', async () => {
    registerOrderStatusActions(({ order }) =>
      order.status === 'partially_fulfilled'
        ? [
            { id: 'return', label: 'Request a return', url: '/returns?o=order-1' },
            { id: 'evil', label: 'Click', url: 'javascript:alert(1)' },
          ]
        : [],
    )
    registerOrderStatusActions(() => {
      throw new Error('boom')
    })
    const result = await call({ hostId: HOST, o: ORDER, t: token() })
    expect(result.body.actions).toEqual([
      { id: 'return', label: 'Request a return', url: '/returns?o=order-1' },
    ])
  })

  it('sends each parcel to the store’s own tracking page where a plugin has one (AGL-3635)', async () => {
    resetPluginServicesForTests()
    registerPluginTrackingPage(
      async ({ hostId, recordId, carrier, trackingNumber }) =>
        hostId === HOST && recordId === ORDER && carrier === 'UPS'
          ? `https://northwind.narvar.com/northwind/tracking/ups?tracking_numbers=${trackingNumber}`
          : null,
      { pluginId: 'post-purchase' },
    )
    const result = await call({ hostId: HOST, o: ORDER, t: token() })
    expect(result.body.shipments[0].trackingUrl).toBe(
      'https://northwind.narvar.com/northwind/tracking/ups?tracking_numbers=1Z1',
    )
    resetPluginServicesForTests()
  })

  it('names the optional lines the buyer paid for, and nothing about whose they were (AGL-3635)', async () => {
    const order = docs.get(`hosts/${HOST}/orders/${ORDER}`) as Record<string, any>
    docs.set(`hosts/${HOST}/orders/${ORDER}`, {
      ...order,
      totals: { ...order.totals, extrasCents: 198, totalCents: 4098 },
      extras: [
        { id: 'post-purchase.package-protection', pluginId: 'post-purchase', key: 'package-protection', label: 'Package protection', amountCents: 198, quoteRef: 'q_secret' },
      ],
    })
    const result = await call({ hostId: HOST, o: ORDER, t: token() })
    expect(result.body.extras).toEqual([{ label: 'Package protection', amountCents: 198 }])
    expect(JSON.stringify(result.body)).not.toContain('q_secret')
  })
})
