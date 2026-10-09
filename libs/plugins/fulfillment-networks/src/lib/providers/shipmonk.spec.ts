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

import { createHmac } from 'node:crypto'
import { mockHttp, sentJson } from '../testing/mock-http'
import type { NetworkOrderRequest } from './provider'
import {
  createShipmonkProvider,
  readShipmonkOrder,
  shipmonkTrackingStatus,
  verifyShipmonkSignature,
} from './shipmonk'

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
  shippingMethod: 'ShipMonk Standard',
  shippingSpeed: 'Standard',
}

const CREDENTIAL = { accessToken: 'sm-key', storeId: '11364' }

/** An order ShipMonk holds, shipped in two packages, one line in each. */
const SHIPPED = {
  order_key: 'agabc123',
  order_number: 'SM-1042',
  order_status: 'unfulfilled',
  processing_status: 'en_route',
  shipped_at: '2026-10-08T10:00:00-04:00',
  shipment_data: { carrier: 'USPS', carrier_tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400' },
  packages: [
    {
      number: 1,
      tracking_number: '9400',
      tracking_url: 'https://tools.usps.com/t?n=9400',
      packed_items: [{ sku: 'TEE-S', line_key: '0', quantity: 2 }],
    },
    {
      number: 2,
      tracking_number: '9401',
      tracking_url: null,
      packed_items: [],
      packed_products: [{ sku: 'MUG', quantity: 1 }],
    },
  ],
  items: [
    { line_key: '0', sku: 'TEE-S', quantity: 2, fulfilled_quantity: 2 },
    { line_key: '2', sku: 'MUG', quantity: 1, fulfilled_quantity: 1 },
  ],
  order_parts: null,
}

const orderAnswer = (data: unknown) => ({ status: 200, data })

describe('ShipMonk (AGL-3697)', () => {
  it('checks a pasted key at connect against an endpoint every key may read', async () => {
    const { http, calls } = mockHttp([{ match: 'api.shipmonk.com/v1/integrations/warehouses', body: { data: [] } }])
    const account = await createShipmonkProvider({ http, sandbox: false }).account(CREDENTIAL)
    expect(account).toEqual({ accountName: 'Store 11364' })
    expect(calls[0].headers['api-key']).toBe('sm-key')
    expect(calls[0].headers['authorization']).toBeUndefined()
  })

  it('refuses a key ShipMonk refuses, and a missing store id, as auth failures', async () => {
    const refused = mockHttp([{ match: '/warehouses', status: 401, body: { message: 'Invalid API key' } }])
    await expect(createShipmonkProvider({ http: refused.http, sandbox: false }).account(CREDENTIAL)).rejects.toMatchObject({ kind: 'auth' })
    const none = mockHttp([])
    await expect(createShipmonkProvider({ http: none.http, sandbox: false }).account({ accessToken: 'k' })).rejects.toMatchObject({ kind: 'auth' })
    expect(none.calls).toHaveLength(0)
  })

  it('looks an order up by our reference within the store, and reads absence as none', async () => {
    const { http, calls } = mockHttp([{ match: '/v1/integrations/orders?orderKey=agabc123', body: orderAnswer(SHIPPED) }])
    const found = await createShipmonkProvider({ http, sandbox: false }).findOrder(CREDENTIAL, 'agabc123')
    expect(found).toMatchObject({ id: 'agabc123', reference: 'agabc123', state: 'shipped' })
    expect(new URL(calls[0].url).searchParams.get('storeId')).toBe('11364')
    const missing = mockHttp([{ match: '/v1/integrations/orders?', status: 404, body: { message: 'Order not found' } }])
    await expect(createShipmonkProvider({ http: missing.http, sandbox: false }).findOrder(CREDENTIAL, 'x')).resolves.toBeNull()
  })

  it('creates the order under our reference with each line keyed by its index, once', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: 'sandbox.shipmonk.dev/v1/integrations/order', body: { message: 'Order created' } }])
    const order = await createShipmonkProvider({ http, sandbox: true }).createOrder(CREDENTIAL, REQUEST)
    expect(order).toEqual({ id: 'agabc123', reference: 'agabc123', state: 'open', detail: null, shipments: [] })
    expect(sentJson(calls[0])).toEqual({
      store_id: 11364,
      order_key: 'agabc123',
      order_number: '#1042',
      order_status: 'unfulfilled',
      ordered_at: '2026-10-07T12:00:00.000Z',
      requested_shipping_service: 'ShipMonk Standard',
      currency_code: 'USD',
      customer_email: 'ann@example.com',
      ship_to: {
        name: 'Ann Lee',
        street1: '2 B St',
        street2: 'Apt 4',
        city: 'Boston',
        state: 'MA',
        zip: '02108',
        country_code: 'US',
        phone: '+16175550100',
      },
      items: [
        { sku: 'TEE-S', quantity: 2, line_key: '0', name: 'Tee — S', price: 15 },
        { sku: 'MUG', quantity: 1, line_key: '2', name: 'Mug', price: 12.5 },
      ],
    })
  })

  it('never retries a create in the call: a 5xx may have been taken', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: '/v1/integrations/order', status: 503, body: {} }])
    await expect(createShipmonkProvider({ http, sandbox: false }).createOrder(CREDENTIAL, REQUEST)).rejects.toMatchObject({ kind: 'transient' })
    expect(calls).toHaveLength(1)
  })

  it('reads each package with tracking as a parcel, its units on the lines it names', async () => {
    const { http } = mockHttp([{ match: '/v1/integrations/orders?orderKey=agabc123', body: orderAnswer(SHIPPED) }])
    const order = await createShipmonkProvider({ http, sandbox: false }).getOrder(CREDENTIAL, 'agabc123', 'agabc123')
    expect(order.state).toBe('shipped')
    expect(order.shipments).toEqual([
      {
        id: 'SM-1042:1',
        carrier: 'USPS',
        trackingNumber: '9400',
        trackingUrl: 'https://tools.usps.com/t?n=9400',
        items: [{ sku: 'TEE-S', quantity: 2, lineIndex: 0 }],
        trackingStatus: 'in_transit',
        trackingDetail: null,
        shippedAtMs: Date.parse('2026-10-08T10:00:00-04:00'),
        packageNumber: 'agabc123',
      },
      expect.objectContaining({
        id: 'SM-1042:2',
        trackingNumber: '9401',
        trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400',
        items: [{ sku: 'MUG', quantity: 1 }],
      }),
    ])
  })

  it('reads the parts of a split order, each under its own number, once', async () => {
    const main = {
      ...SHIPPED,
      packages: [SHIPPED.packages[0]],
      order_parts: { main_order: { order_number: 'SM-1042', parts: [{ order_number: 'SM-1042' }, { order_number: 'SM-1042-2' }] } },
    }
    const part = {
      ...SHIPPED,
      order_key: 'agabc123-part',
      order_number: 'SM-1042-2',
      processing_status: 'awaiting_pick_up',
      packages: [{ number: 1, tracking_number: '9402', packed_items: [{ sku: 'MUG', line_key: '2', quantity: 1 }] }],
    }
    const { http, calls } = mockHttp([
      { match: 'orderKey=agabc123', body: orderAnswer(main) },
      { match: 'orderNumber=SM-1042-2', body: orderAnswer(part) },
    ])
    const order = await createShipmonkProvider({ http, sandbox: false }).getOrder(CREDENTIAL, 'agabc123', 'agabc123')
    expect(calls).toHaveLength(2)
    expect(order.shipments.map((shipment) => [shipment.id, shipment.trackingStatus, shipment.packageNumber])).toEqual([
      ['SM-1042:1', 'in_transit', 'agabc123'],
      ['SM-1042-2:1', 'pre_transit', 'agabc123-part'],
    ])
  })

  it('reads nothing shipped while the warehouse works, and says why ShipMonk holds an order', () => {
    expect(readShipmonkOrder({ ...SHIPPED, processing_status: 'pack_in_progress', shipped_at: null })).toMatchObject({
      state: 'open',
      shipments: [],
      detail: null,
    })
    expect(readShipmonkOrder({ ...SHIPPED, processing_status: 'backorder', shipped_at: null, packages: [] }).detail).toMatch(/backorder/)
    expect(
      readShipmonkOrder({
        ...SHIPPED,
        processing_status: 'submitted',
        shipped_at: null,
        packages: [],
        actions_required: { address: true, item_mapping: true, customs: false },
      }).detail,
    ).toBe('ShipMonk needs action on the order: address, item mapping. Check it in ShipMonk.')
    expect(readShipmonkOrder({ ...SHIPPED, order_status: 'cancelled', processing_status: 'cancelled' }).state).toBe('canceled')
    expect(readShipmonkOrder({ ...SHIPPED, order_status: 'fulfilled', processing_status: 'fulfilled_by_3rd', packages: [], shipped_at: null })).toMatchObject({
      state: 'refused',
      detail: expect.stringMatching(/outside ShipMonk/),
    })
  })

  it('reads a one-piece shipment from the order’s master tracking number', () => {
    const order = readShipmonkOrder({ ...SHIPPED, packages: [], master_tracking_number: '1Z999' })
    expect(order.shipments).toEqual([
      expect.objectContaining({
        id: 'SM-1042:1Z999',
        trackingNumber: '1Z999',
        items: [
          { sku: 'TEE-S', quantity: 2, lineIndex: 0 },
          { sku: 'MUG', quantity: 1, lineIndex: 2 },
        ],
      }),
    ])
  })

  it('cancels with the same upsert, carrying the order’s own fields, and confirms by reading it back', async () => {
    const held = { ...SHIPPED, processing_status: 'submitted', shipped_at: null, packages: [], ordered_at: '2026-10-07T12:00:00+00:00', requested_shipping_service: 'ShipMonk Standard', ship_to: { name: 'Ann Lee', street1: '2 B St', city: 'Boston', state: 'MA', zip: '02108', country_code: 'US' } }
    const { http, calls } = mockHttp([
      { method: 'GET', match: 'orderKey=agabc123', body: orderAnswer(held), times: 1 },
      { method: 'POST', match: '/v1/integrations/order', body: { message: 'Order updated' } },
      { method: 'GET', match: 'orderKey=agabc123', body: orderAnswer({ ...held, order_status: 'cancelled', processing_status: 'cancelled' }) },
    ])
    await expect(createShipmonkProvider({ http, sandbox: false }).cancelOrder(CREDENTIAL, 'agabc123', 'agabc123')).resolves.toBe('canceled')
    expect(sentJson(calls[1])).toMatchObject({
      store_id: 11364,
      order_key: 'agabc123',
      order_number: 'SM-1042',
      order_status: 'cancelled',
      requested_shipping_service: 'ShipMonk Standard',
      ship_to: { name: 'Ann Lee', street1: '2 B St', zip: '02108', country_code: 'US' },
      items: [
        { sku: 'TEE-S', quantity: 2, line_key: '0' },
        { sku: 'MUG', quantity: 1, line_key: '2' },
      ],
    })
  })

  it('answers requested while the warehouse confirms, and too late once it is being packed', async () => {
    const held = { ...SHIPPED, processing_status: 'submitted', shipped_at: null, packages: [] }
    const requested = mockHttp([
      { method: 'GET', match: 'orderKey=', body: orderAnswer(held), times: 1 },
      { method: 'POST', match: '/v1/integrations/order', body: {} },
      { method: 'GET', match: 'orderKey=', body: orderAnswer({ ...held, processing_status: 'cancellation_requested' }) },
    ])
    await expect(createShipmonkProvider({ http: requested.http, sandbox: false }).cancelOrder(CREDENTIAL, 'agabc123', 'agabc123')).resolves.toBe('requested')
    const packing = mockHttp([{ method: 'GET', match: 'orderKey=', body: orderAnswer({ ...held, processing_status: 'pack_in_progress' }) }])
    await expect(createShipmonkProvider({ http: packing.http, sandbox: false }).cancelOrder(CREDENTIAL, 'agabc123', 'agabc123')).resolves.toBe('too_late')
    expect(packing.calls.every((call) => call.method === 'GET')).toBe(true)
    const refused = mockHttp([
      { method: 'GET', match: 'orderKey=', body: orderAnswer(held) },
      { method: 'POST', match: '/v1/integrations/order', status: 422, body: { message: 'Order can no longer be cancelled' } },
    ])
    await expect(createShipmonkProvider({ http: refused.http, sandbox: false }).cancelOrder(CREDENTIAL, 'agabc123', 'agabc123')).resolves.toBe('too_late')
  })

  it('reads stock for the SKUs an order needs, exactly matched', async () => {
    const { http, calls } = mockHttp([
      {
        match: '/v1/products?search=TEE-S',
        body: { data: [{ sku: 'TEE-S-XL', inventory: { quantity_total_available: 9 } }, { sku: 'TEE-S', inventory: { quantity_total_available: 4 } }] },
      },
      { match: '/v1/products?search=GONE', body: { data: [] } },
    ])
    await expect(createShipmonkProvider({ http, sandbox: false }).stock(CREDENTIAL, ['TEE-S', 'GONE', 'TEE-S'])).resolves.toEqual([
      { sku: 'TEE-S', fulfillable: 4 },
    ])
    expect(calls).toHaveLength(2)
  })

  it('counts every active product through the inventory-sync cursor, up to the most asked for', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: '/v1/integrations/products/search', body: { total: 3, cursor: 'c-1' } },
      {
        match: 'search/paginate?cursor=c-1',
        body: { data: [{ sku: 'A', inventory: { quantity_total_available: 3 } }, { sku: 'B', inventory: { quantity_total_available: -2 } }], next_cursor: 'c-2' },
      },
      { match: 'search/paginate?cursor=c-2', body: { data: [{ sku: 'C', inventory: { quantity_total_available: 7 } }], next_cursor: null } },
    ])
    await expect(createShipmonkProvider({ http, sandbox: false }).allStock(CREDENTIAL, 10)).resolves.toEqual([
      { sku: 'A', fulfillable: 3 },
      { sku: 'B', fulfillable: 0 },
      { sku: 'C', fulfillable: 7 },
    ])
    expect(sentJson(calls[0])).toEqual({ filters: { status: 'active' }, sort: { sort_by: 'id', sort_order: 'ASC' } })
    const capped = mockHttp([
      { method: 'POST', match: '/products/search', body: { cursor: 'c-1' } },
      { match: 'paginate', body: { data: [{ sku: 'A', inventory: {} }, { sku: 'B', inventory: {} }], next_cursor: 'c-2' } },
    ])
    await expect(createShipmonkProvider({ http: capped.http, sandbox: false }).allStock(CREDENTIAL, 1)).resolves.toEqual([{ sku: 'A', fulfillable: 0 }])
  })

  it('follows a parcel through the order it shipped from', async () => {
    const { http } = mockHttp([{ match: 'orderKey=agabc123', body: orderAnswer({ ...SHIPPED, processing_status: 'delivered' }) }])
    const provider = createShipmonkProvider({ http, sandbox: false })
    const parcel = readShipmonkOrder(SHIPPED).shipments[0]
    await expect(provider.tracking?.(CREDENTIAL, parcel)).resolves.toEqual({ status: 'delivered', detail: null })
    await expect(provider.tracking?.(CREDENTIAL, { ...parcel, packageNumber: null })).resolves.toBeNull()
    expect(shipmonkTrackingStatus('undeliverable')).toBe('exception')
    expect(shipmonkTrackingStatus('shipped_untrackable')).toBeNull()
  })

  it('honors a rate limit’s Retry-After', async () => {
    const { http, calls, waits } = mockHttp([
      { match: '/warehouses', status: 429, headers: { 'Retry-After': '2' }, body: {}, times: 1 },
      { match: '/warehouses', body: { data: [] } },
    ])
    await createShipmonkProvider({ http, sandbox: false }).account(CREDENTIAL)
    expect(calls).toHaveLength(2)
    expect(waits).toEqual([2_000])
  })
})

describe('ShipMonk webhook signatures (AGL-3697)', () => {
  const body = JSON.stringify({ order_key: 'agabc123', processing_status: 'en_route' })
  const mac = createHmac('sha512', 'whsec').update(body).digest()

  it('takes the HMAC-SHA512 of the raw body under the secret, in hex or base64', () => {
    expect(verifyShipmonkSignature(body, mac.toString('hex'), 'whsec')).toBe(true)
    expect(verifyShipmonkSignature(body, mac.toString('base64'), 'whsec')).toBe(true)
  })

  it('refuses another secret, a changed body, and no signature', () => {
    expect(verifyShipmonkSignature(body, mac.toString('hex'), 'other')).toBe(false)
    expect(verifyShipmonkSignature(`${body} `, mac.toString('hex'), 'whsec')).toBe(false)
    expect(verifyShipmonkSignature(body, null, 'whsec')).toBe(false)
    expect(verifyShipmonkSignature(body, mac.toString('hex'), '')).toBe(false)
  })
})
