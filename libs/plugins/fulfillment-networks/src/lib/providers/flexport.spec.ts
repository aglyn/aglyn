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

import { mockHttp, sentJson } from '../testing/mock-http'
import {
  createFlexportProvider,
  FLEXPORT_WEBHOOK_EVENTS,
  FLEXPORT_WEBHOOK_TOKEN_HEADER,
  flexportPackageStatus,
  readFlexportOrder,
} from './flexport'
import type { NetworkCredential, NetworkOrderRequest } from './provider'

/**
 * Every answer below is shaped as the Logistics API 2026-02 reference
 * documents it (https://docs.logistics-api.flexport.com/2026-02/), and every
 * call goes to the scripted fetch: no Flexport account is reached.
 */

const API = 'https://logistics-api.flexport.com/logistics/api/2026-02'

const REQUEST: NetworkOrderRequest = {
  reference: 'agabc123',
  displayRef: '#1042',
  orderedAtMs: Date.UTC(2026, 9, 7, 12),
  currency: 'usd',
  address: {
    name: 'Ann Lee',
    line1: '2 B St',
    line2: 'Apt 4',
    city: 'Boston',
    state: 'MA',
    postalCode: '02108',
    country: 'US',
    phone: '+16175550100',
    email: 'ann@example.com',
  },
  items: [
    { lineIndex: 0, sku: 'TEE-S', name: 'Tee — S', quantity: 2, unitValueCents: 1_500 },
    { lineIndex: 2, sku: 'MUG', name: 'Mug', quantity: 1, unitValueCents: 1_250 },
  ],
  shippingMethod: 'Standard',
  shippingSpeed: 'Standard',
}

const credential = (): NetworkCredential => ({ accessToken: 'fx-token' })

/** The merchant's catalog: `merchantSku` → Flexport's `logisticsSku` (GetProducts). */
const CATALOG = [
  { name: 'Tee — S', logisticsSku: 'D1111111111', merchantSku: 'TEE-S', barcodes: [], dimsLocked: true },
  { name: 'Mug', logisticsSku: 'D2222222222', merchantSku: 'MUG', barcodes: [], dimsLocked: true },
  { name: 'Cap', logisticsSku: 'D3333333333', merchantSku: 'CAP', barcodes: [], dimsLocked: true },
]

/** An order Flexport shipped in one shipment of two packages (OrderModelV2). */
const SHIPPED = {
  id: '01HKBBNEVYKM0D84E63MMYN022',
  externalOrderId: 'agabc123',
  state: { internalStatus: 'SHIPPED', fulfillmentStatus: 'SHIPPED', fulfillmentDelayed: false, fulfillmentInProgress: false },
  lineItems: [
    { lineItemId: '0', logisticsSku: 'D1111111111', quantity: 2 },
    { lineItemId: '2', logisticsSku: 'D2222222222', quantity: 1 },
  ],
  address: { name: 'Ann Lee', address1: '2 B St', city: 'Boston', provinceCode: 'MA', countryCode: 'US', zip: '02108', phone: '+16175550100' },
  shipments: [
    {
      id: '01HKBC2H4Y9F3R7Q2Z6VZC5X01',
      warehouseId: 'ATL1',
      status: 'SHIPPED',
      lineItems: [
        { logisticsSku: 'D1111111111', quantity: 2 },
        { logisticsSku: 'D2222222222', quantity: 1 },
      ],
      packages: [
        {
          id: 'PKG-1',
          lineItems: [{ logisticsSku: 'D1111111111', quantity: 2 }],
          label: { id: 'L1', carrier: 'USPS', trackingCode: '9400', trackingUrl: 'https://tools.usps.com/t?n=9400', packageDimensions: {} },
          carrierShipTime: '2026-10-08T14:00:00.000Z',
        },
        {
          id: 'PKG-2',
          lineItems: [{ logisticsSku: 'D2222222222', quantity: 1 }],
          label: { id: 'L2', carrier: 'UPS', trackingCode: '1Z99', packageDimensions: {} },
          carrierDeliveryTime: '2026-10-10T18:00:00.000Z',
        },
      ],
      shippedAt: '2026-10-08T12:00:00.000Z',
    },
  ],
  createdAt: '2026-10-07T12:00:00.000Z',
  shippedAt: '2026-10-08T12:00:00.000Z',
}

const CREATED = {
  ...SHIPPED,
  state: { internalStatus: 'CREATED', fulfillmentStatus: 'ROUTING_IN_PROGRESS', fulfillmentDelayed: false, fulfillmentInProgress: true },
  shipments: [],
  shippedAt: undefined,
}

describe('Flexport (AGL-3822)', () => {
  it('checks a pasted token at connect with the reads every connection needs, as a bearer token', async () => {
    const { http, calls } = mockHttp([
      { match: `${API}/products?limit=1&offset=0`, body: [CATALOG[0]] },
      { match: `${API}/orders/external_id/aglyn-connection-check`, status: 404, body: { status: 404, title: 'Not Found' } },
    ])
    await expect(createFlexportProvider({ http }).account(credential())).resolves.toEqual({ accountName: null })
    expect(calls).toHaveLength(2)
    expect(calls[0].headers['authorization']).toBe('Bearer fx-token')
  })

  it('refuses an expired token, and one missing a permission, as auth failures', async () => {
    const expired = mockHttp([{ match: '/products?', status: 401, body: { status: 401, title: 'Unauthorized', message: 'Unauthorized' } }])
    await expect(createFlexportProvider({ http: expired.http }).account(credential())).rejects.toMatchObject({ kind: 'auth' })
    const scoped = mockHttp([
      { match: '/products?', body: [] },
      { match: '/orders/external_id/', status: 403, body: { status: 403, title: 'Forbidden', message: 'Forbidden' } },
    ])
    await expect(createFlexportProvider({ http: scoped.http }).account(credential())).rejects.toMatchObject({ kind: 'auth' })
  })

  it('looks an order up by our reference, and reads absence as none', async () => {
    const { http, calls } = mockHttp([{ match: `${API}/orders/external_id/agabc123`, body: SHIPPED }])
    const found = await createFlexportProvider({ http }).findOrder(credential(), 'agabc123')
    expect(found).toMatchObject({ id: SHIPPED.id, reference: 'agabc123', state: 'shipped' })
    expect(calls).toHaveLength(1)
    const missing = mockHttp([{ match: '/orders/external_id/', status: 404, body: { status: 404, title: 'Not Found', detail: 'Cannot find order' } }])
    await expect(createFlexportProvider({ http: missing.http }).findOrder(credential(), 'x')).resolves.toBeNull()
  })

  it('creates the order with Flexport’s product ids, each line keyed by its index, once, under our reference', async () => {
    const { http, calls } = mockHttp([
      { match: `${API}/products?limit=1000&offset=0`, body: CATALOG },
      { method: 'POST', match: `${API}/orders`, body: CREATED },
    ])
    const order = await createFlexportProvider({ http }).createOrder(credential(), REQUEST)
    expect(order).toEqual({ id: SHIPPED.id, reference: 'agabc123', state: 'open', detail: null, shipments: [] })
    const create = calls.find((call) => call.method === 'POST')
    expect(create?.headers['idempotency-key']).toBe('agabc123')
    expect(sentJson(create)).toEqual({
      externalOrderId: 'agabc123',
      lineItems: [
        { lineItemId: '0', logisticsSku: 'D1111111111', quantity: 2, customsUnitValue: { amount: 15, currencyCode: 'USD' } },
        { lineItemId: '2', logisticsSku: 'D2222222222', quantity: 1, customsUnitValue: { amount: 12.5, currencyCode: 'USD' } },
      ],
      address: {
        name: 'Ann Lee',
        address1: '2 B St',
        address2: 'Apt 4',
        city: 'Boston',
        provinceCode: 'MA',
        zip: '02108',
        countryCode: 'US',
        phone: '+16175550100',
        email: 'ann@example.com',
      },
      shipMethod: 'Standard',
    })
    // A create is never retried in the call: a timeout after Flexport took it would send it twice.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('never retries a create that failed in transit', async () => {
    const { http, calls } = mockHttp([
      { match: '/products?', body: CATALOG },
      { method: 'POST', match: `${API}/orders`, status: 503, body: { status: 503, title: 'Service Unavailable' } },
    ])
    await expect(createFlexportProvider({ http }).createOrder(credential(), REQUEST)).rejects.toMatchObject({ kind: 'transient' })
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })

  it('adopts the order Flexport already has when the create is a duplicate', async () => {
    const { http } = mockHttp([
      { match: '/products?', body: CATALOG },
      { method: 'POST', match: `${API}/orders`, status: 409, body: { status: 409, title: 'Conflict', detail: 'DUPLICATE_ORDER' } },
      { match: '/orders/external_id/agabc123', body: CREATED },
    ])
    await expect(createFlexportProvider({ http }).createOrder(credential(), REQUEST)).resolves.toMatchObject({ id: SHIPPED.id, state: 'open' })
  })

  it('refuses before sending when a SKU is not in the Flexport catalog', async () => {
    const { http, calls } = mockHttp([{ match: '/products?', body: CATALOG.slice(0, 1) }])
    await expect(createFlexportProvider({ http }).createOrder(credential(), REQUEST)).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Flexport has no product with SKU MUG',
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('reads the catalog across pages, once per credential', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ logisticsSku: `D${index}`, merchantSku: `SKU-${index}`, name: 'x', barcodes: [], dimsLocked: true }))
    const { http, calls } = mockHttp([
      { match: '/products?limit=1000&offset=0', body: page },
      { match: '/products?limit=1000&offset=1000', body: CATALOG },
      { match: '/products/D2222222222/inventory?aggregatePacks=true', body: { logisticsSku: 'D2222222222', available: 7, onHand: 9, unavailable: 2 } },
      { match: '/products/D5/inventory', body: { available: 0, onHand: 0, unavailable: 0 } },
    ])
    const provider = createFlexportProvider({ http })
    const opened = credential()
    expect(await provider.stock(opened, ['MUG', 'SKU-5', 'NOT-THERE'])).toEqual([
      { sku: 'MUG', fulfillable: 7 },
      { sku: 'SKU-5', fulfillable: 0 },
    ])
    await provider.stock(opened, ['MUG'])
    expect(calls.filter((call) => call.url.includes('/products?'))).toHaveLength(2)
  })

  it('counts all stock through the inventory cursor, by the store’s SKU, leaving out what is not in the catalog', async () => {
    const { http, calls } = mockHttp([
      { match: '/products?', body: CATALOG },
      {
        match: /\/products\/inventory\/cursor\?limit=100$/,
        body: {
          inventories: [
            { logisticsSku: 'D1111111111', available: 4, onHand: 4, unavailable: 0 },
            { logisticsSku: 'DPACK000001', available: 2, onHand: 2, unavailable: 0 },
          ],
          nextCursor: 'DPACK000001',
        },
      },
      { match: '/products/inventory/cursor?limit=100&cursor=DPACK000001', body: { inventories: [{ logisticsSku: 'D3333333333', available: 11, onHand: 11, unavailable: 0 }] } },
    ])
    expect(await createFlexportProvider({ http }).allStock(credential(), 5_000)).toEqual([
      { sku: 'TEE-S', fulfillable: 4 },
      { sku: 'CAP', fulfillable: 11 },
    ])
    expect(calls.filter((call) => call.url.includes('/inventory/cursor'))).toHaveLength(2)
  })

  it('reads each shipped package as a parcel on the lines it held, with where it is', () => {
    const order = readFlexportOrder(SHIPPED)
    expect(order.state).toBe('shipped')
    expect(order.shipments).toEqual([
      {
        id: 'PKG-1',
        carrier: 'USPS',
        trackingNumber: '9400',
        trackingUrl: 'https://tools.usps.com/t?n=9400',
        items: [{ sku: 'D1111111111', quantity: 2, lineIndex: 0 }],
        trackingStatus: 'in_transit',
        trackingDetail: null,
        shippedAtMs: Date.parse('2026-10-08T14:00:00.000Z'),
        packageNumber: SHIPPED.id,
      },
      {
        id: 'PKG-2',
        carrier: 'UPS',
        trackingNumber: '1Z99',
        trackingUrl: null,
        items: [{ sku: 'D2222222222', quantity: 1, lineIndex: 2 }],
        trackingStatus: 'delivered',
        trackingDetail: null,
        shippedAtMs: Date.parse('2026-10-08T12:00:00.000Z'),
        packageNumber: SHIPPED.id,
      },
    ])
  })

  it('places one product’s units on its lines in order when it sits on more than one', () => {
    const raw = {
      ...SHIPPED,
      lineItems: [
        { lineItemId: '0', logisticsSku: 'D1111111111', quantity: 1 },
        { lineItemId: '1', logisticsSku: 'D1111111111', quantity: 2 },
      ],
      shipments: [
        {
          ...SHIPPED.shipments[0],
          packages: [
            { id: 'A', lineItems: [{ logisticsSku: 'D1111111111', quantity: 2 }], label: { carrier: 'USPS', trackingCode: 'T1' } },
            { id: 'B', lineItems: [{ logisticsSku: 'D1111111111', quantity: 1 }], label: { carrier: 'USPS', trackingCode: 'T2' } },
          ],
        },
      ],
    }
    const [a, b] = readFlexportOrder(raw).shipments
    expect(a.items).toEqual([
      { sku: 'D1111111111', quantity: 1, lineIndex: 0 },
      { sku: 'D1111111111', quantity: 1, lineIndex: 1 },
    ])
    expect(b.items).toEqual([{ sku: 'D1111111111', quantity: 1, lineIndex: 1 }])
  })

  it('reads Flexport’s states: open, held, canceled, refused, and a routing error it may still clear', () => {
    expect(readFlexportOrder(CREATED)).toMatchObject({ state: 'open', detail: null })
    expect(readFlexportOrder({ ...CREATED, state: { internalStatus: 'ON_HOLD' } })).toMatchObject({
      state: 'open',
      detail: 'Flexport put the order on hold. Check it in Flexport.',
    })
    expect(readFlexportOrder({ ...CREATED, state: { internalStatus: 'CANCELLED' } }).state).toBe('canceled')
    expect(
      readFlexportOrder({ ...CREATED, state: { internalStatus: 'ERROR' }, error: { code: 1, type: 'BAD_ADDRESS', message: 'Address is not deliverable', retriable: false } }),
    ).toMatchObject({ state: 'refused', detail: 'Flexport could not fulfill the order: Address is not deliverable.' })
    expect(
      readFlexportOrder({ ...CREATED, state: { internalStatus: 'ERROR' }, error: { code: 2, type: 'STOCKOUT', message: 'Out of stock', retriable: true } }),
    ).toMatchObject({ state: 'open', detail: 'Flexport could not route the order yet: Out of stock. Check it in Flexport.' })
    // A shipment whose packages have no label yet has not left.
    expect(
      readFlexportOrder({ ...CREATED, shipments: [{ id: 'S', status: 'WAREHOUSE', lineItems: [], packages: [{ id: 'P', lineItems: [] }] }] }).shipments,
    ).toEqual([])
  })

  it('follows a parcel from the order it already read, and reads the order when it has not', async () => {
    const { http, calls } = mockHttp([{ match: `${API}/orders/${SHIPPED.id}`, body: SHIPPED }])
    const provider = createFlexportProvider({ http })
    const opened = credential()
    const order = await provider.getOrder(opened, SHIPPED.id, 'agabc123')
    expect(await provider.tracking?.(opened, order.shipments[1])).toEqual({ status: 'delivered', detail: null })
    expect(calls).toHaveLength(1)
    const fresh = await provider.tracking?.(credential(), order.shipments[0])
    expect(fresh).toEqual({ status: 'in_transit', detail: null })
    expect(calls).toHaveLength(2)
    expect(flexportPackageStatus({ attemptedDeliveryTime: '2026-10-09T10:00:00Z' }, {})).toEqual({
      status: 'exception',
      detail: 'The carrier attempted delivery and could not deliver the parcel.',
    })
  })

  it('reads an order by our reference where no Flexport id was kept', async () => {
    const { http, calls } = mockHttp([{ match: '/orders/external_id/agabc123', body: CREATED }])
    await expect(createFlexportProvider({ http }).getOrder(credential(), 'agabc123', 'agabc123')).resolves.toMatchObject({ id: SHIPPED.id })
    expect(calls[0].url).toBe(`${API}/orders/external_id/agabc123`)
  })

  it('cancels an order not yet shipped, and says when it is too late', async () => {
    const open = mockHttp([
      { match: `${API}/orders/${SHIPPED.id}/cancel`, method: 'POST', body: { ...CREATED, state: { internalStatus: 'CANCELLED' } } },
      { match: `${API}/orders/${SHIPPED.id}`, body: CREATED },
    ])
    await expect(createFlexportProvider({ http: open.http }).cancelOrder(credential(), SHIPPED.id, 'agabc123')).resolves.toBe('canceled')
    expect(open.calls.filter((call) => call.method === 'POST')).toHaveLength(1)

    const shipped = mockHttp([{ match: `${API}/orders/${SHIPPED.id}`, body: SHIPPED }])
    await expect(createFlexportProvider({ http: shipped.http }).cancelOrder(credential(), SHIPPED.id, 'agabc123')).resolves.toBe('too_late')
    expect(shipped.calls.some((call) => call.method === 'POST')).toBe(false)

    const refused = mockHttp([
      { match: '/cancel', method: 'POST', status: 400, body: { status: 400, title: 'Bad Request', detail: 'Order already processed' } },
      { match: `${API}/orders/${SHIPPED.id}`, body: CREATED },
    ])
    await expect(createFlexportProvider({ http: refused.http }).cancelOrder(credential(), SHIPPED.id, 'agabc123')).resolves.toBe('too_late')

    const pending = mockHttp([
      { match: '/cancel', method: 'POST', body: CREATED },
      { match: `${API}/orders/${SHIPPED.id}`, body: CREATED },
    ])
    await expect(createFlexportProvider({ http: pending.http }).cancelOrder(credential(), SHIPPED.id, 'agabc123')).resolves.toBe('requested')

    const gone = mockHttp([{ match: `${API}/orders/`, status: 404, body: { status: 404, title: 'Not Found' } }])
    await expect(createFlexportProvider({ http: gone.http }).cancelOrder(credential(), SHIPPED.id, 'agabc123')).resolves.toBe('canceled')
  })

  it('honors Flexport’s Retry-After on a rate limit, within the call', async () => {
    const { http, waits } = mockHttp([
      { match: '/orders/external_id/', status: 429, headers: { 'Retry-After': '2' }, body: { status: 429, title: 'Too Many Requests' }, times: 1 },
      { match: '/orders/external_id/', body: CREATED },
    ])
    await expect(createFlexportProvider({ http }).findOrder(credential(), 'agabc123')).resolves.toMatchObject({ state: 'open' })
    expect(waits).toEqual([2_000])
  })

  it('registers its webhooks afresh with a token header, removing only this connection’s', async () => {
    const prefix = 'https://console.example/api/fulfillment-networks/webhooks/flexport?connection=h_flexport'
    const { http, calls } = mockHttp([
      {
        method: 'GET',
        match: `${API}/webhooks`,
        body: [
          { id: 7, type: 'Order.Shipped', url: prefix, method: 'POST' },
          { id: 8, type: 'Order.Shipped', url: 'https://elsewhere.example/hook', method: 'POST' },
        ],
      },
      { method: 'DELETE', match: `${API}/webhooks/7`, status: 204 },
      { method: 'POST', match: `${API}/webhooks`, body: { id: 9 } },
    ])
    await createFlexportProvider({ http }).syncWebhooks?.(credential(), { prefix, url: prefix, token: 'tok-1' })
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([`${API}/webhooks/7`])
    const created = calls.filter((call) => call.method === 'POST').map(sentJson)
    expect(created.map((body) => body.type)).toEqual([...FLEXPORT_WEBHOOK_EVENTS])
    expect(created[0]).toEqual({
      type: 'Shipment.Shipped',
      url: prefix,
      method: 'POST',
      authMethod: 'TOKEN',
      token: 'tok-1',
      tokenHeader: FLEXPORT_WEBHOOK_TOKEN_HEADER,
    })

    const removal = mockHttp([
      { method: 'GET', match: `${API}/webhooks`, body: [{ id: 7, type: 'Order.Shipped', url: prefix, method: 'POST' }] },
      { method: 'DELETE', match: `${API}/webhooks/7`, status: 404, body: { status: 404, title: 'Not Found' } },
    ])
    await createFlexportProvider({ http: removal.http }).syncWebhooks?.(credential(), { prefix, url: null })
    expect(removal.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})
