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
import { amazonTrackingStatus, createAmazonMcfProvider, readAmazonOrder } from './amazon-mcf'
import { ProviderError } from './http'
import type { NetworkOrderRequest } from './provider'
import { createShipbobProvider, readShipbobOrder, shipbobFulfillable } from './shipbob'

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
  shippingSpeed: 'Expedited',
}

const SHIPBOB_ORDER = {
  id: 9001,
  reference_id: 'agabc123',
  status: 'PartiallyFulfilled',
  shipments: [
    {
      id: 77,
      status: 'Completed',
      tracking: { carrier: 'USPS', tracking_number: '9400', tracking_url: 'https://tools.usps.com/t?n=9400', shipping_date: '2026-10-08T10:00:00Z' },
      products: [{ reference_id: 'TEE-S', inventory_items: [{ quantity: 2 }] }],
    },
    { id: 78, status: 'Processing', products: [{ reference_id: 'MUG', inventory_items: [{ quantity: 1 }] }] },
  ],
}

describe('ShipBob (AGL-3634)', () => {
  const credential = { accessToken: 'sb-access', channelId: 'ch-5' }

  it('reads the grant’s channel at connect: the one that may write orders', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'api.shipbob.com/1.0/channel',
        body: [
          { id: 1, name: 'Shopify', scopes: ['orders_read'] },
          { id: 5, name: 'Aglyn', scopes: ['orders_read', 'orders_write'] },
        ],
      },
    ])
    const account = await createShipbobProvider({ http, sandbox: false }).account({ accessToken: 'sb-access' })
    expect(account).toEqual({ accountName: 'Aglyn', channelId: '5' })
    expect(calls[0].headers['authorization']).toBe('Bearer sb-access')
  })

  it('refuses a grant with no channel as an auth failure', async () => {
    const { http } = mockHttp([{ match: '/channel', body: [] }])
    await expect(createShipbobProvider({ http, sandbox: false }).account({ accessToken: 't' })).rejects.toMatchObject({
      kind: 'auth',
    })
  })

  it('looks an order up by our reference, under the channel', async () => {
    const { http, calls } = mockHttp([{ match: '/order?ReferenceIds=agabc123', body: [SHIPBOB_ORDER] }])
    const found = await createShipbobProvider({ http, sandbox: false }).findOrder(credential, 'agabc123')
    expect(found?.id).toBe('9001')
    expect(calls[0].headers['shipbob_channel_id']).toBe('ch-5')
    const none = mockHttp([{ match: '/order?', body: [] }])
    await expect(createShipbobProvider({ http: none.http, sandbox: false }).findOrder(credential, 'x')).resolves.toBeNull()
  })

  it('creates an order with our reference, the address and the SKUs, once', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: 'sandbox-api.shipbob.com/1.0/order', body: { ...SHIPBOB_ORDER, shipments: [] } }])
    const order = await createShipbobProvider({ http, sandbox: true }).createOrder(credential, REQUEST)
    expect(order).toMatchObject({ id: '9001', reference: 'agabc123', state: 'open', shipments: [] })
    expect(sentJson(calls[0])).toMatchObject({
      reference_id: 'agabc123',
      order_number: '#1042',
      type: 'DTC',
      shipping_method: 'Standard',
      recipient: {
        name: 'Ann Lee',
        address: { address1: '2 B St', address2: 'Apt 4', city: 'Boston', state: 'MA', zip_code: '02108', country: 'US' },
        email: 'ann@example.com',
        phone_number: '+16175550100',
      },
      products: [
        { reference_id: 'TEE-S', name: 'Tee — S', quantity: 2, unit_price: 15 },
        { reference_id: 'MUG', name: 'Mug', quantity: 1, unit_price: 12.5 },
      ],
    })
  })

  it('never retries a create in the call: a 5xx may have been taken', async () => {
    const { http, calls } = mockHttp([{ method: 'POST', match: '/order', status: 503, body: {} }])
    await expect(createShipbobProvider({ http, sandbox: false }).createOrder(credential, REQUEST)).rejects.toMatchObject({
      kind: 'transient',
    })
    expect(calls).toHaveLength(1)
  })

  it('reads completed shipments with tracking and leaves the rest', async () => {
    const { http } = mockHttp([{ match: '/order/9001', body: SHIPBOB_ORDER }])
    const order = await createShipbobProvider({ http, sandbox: false }).getOrder(credential, '9001', 'agabc123')
    expect(order.state).toBe('open')
    expect(order.shipments).toEqual([
      {
        id: '77',
        carrier: 'USPS',
        trackingNumber: '9400',
        trackingUrl: 'https://tools.usps.com/t?n=9400',
        items: [{ sku: 'TEE-S', quantity: 2 }],
        trackingStatus: 'in_transit',
        trackingDetail: null,
        shippedAtMs: Date.parse('2026-10-08T10:00:00Z'),
      },
    ])
  })

  it('reads a fulfilled, a canceled and a held order', () => {
    expect(readShipbobOrder({ ...SHIPBOB_ORDER, status: 'Fulfilled' }).state).toBe('shipped')
    expect(readShipbobOrder({ ...SHIPBOB_ORDER, status: 'Cancelled' }).state).toBe('canceled')
    const held = readShipbobOrder({
      id: 1,
      status: 'Processing',
      shipments: [{ id: 2, status: 'Exception', status_details: [{ description: 'Out of stock' }] }],
    })
    expect(held).toMatchObject({ state: 'open', detail: 'Out of stock', shipments: [] })
  })

  it('cancels, and says when it is too late', async () => {
    const ok = mockHttp([
      { method: 'POST', match: '/order/9001/cancel', body: { canceled_shipment_results: [{ is_success: true }] } },
    ])
    await expect(createShipbobProvider({ http: ok.http, sandbox: false }).cancelOrder(credential, '9001', 'r')).resolves.toBe('canceled')
    const late = mockHttp([
      { method: 'POST', match: '/order/9001/cancel', body: { canceled_shipment_results: [{ is_success: false, reason: 'Picked' }] } },
    ])
    await expect(createShipbobProvider({ http: late.http, sandbox: false }).cancelOrder(credential, '9001', 'r')).resolves.toBe('too_late')
    const refused = mockHttp([{ method: 'POST', match: '/cancel', status: 422, body: { title: 'Cannot cancel' } }])
    await expect(createShipbobProvider({ http: refused.http, sandbox: false }).cancelOrder(credential, '9001', 'r')).resolves.toBe('too_late')
  })

  it('reads stock by SKU in chunks of fifty, from whichever total a product carries', async () => {
    const skus = Array.from({ length: 51 }, (_, index) => `S${index}`)
    const { http, calls } = mockHttp([
      { match: /ReferenceIds=S0%2C/, body: [{ reference_id: 'S0', total_fulfillable_quantity: 4 }, { reference_id: 'NOT-ASKED', total_fulfillable_quantity: 1 }] },
      { match: /ReferenceIds=S50&/, body: [{ sku: 'S50', fulfillable_quantity_by_fulfillment_center: [{ fulfillable_quantity: 2 }, { fulfillable_quantity: 3 }] }] },
    ])
    const stock = await createShipbobProvider({ http, sandbox: false }).stock(credential, skus)
    expect(stock).toEqual([
      { sku: 'S0', fulfillable: 4 },
      { sku: 'S50', fulfillable: 5 },
    ])
    expect(calls).toHaveLength(2)
    expect(shipbobFulfillable({ fulfillable_inventory_items: [{ quantity: 1 }, { quantity: 6 }] })).toBe(7)
  })

  it('pages through every product for a stock count', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ reference_id: `P${from + index}`, total_fulfillable_quantity: 1 }))
    const { http, calls } = mockHttp([
      { match: 'Page=1&', body: page(0, 250) },
      { match: 'Page=2&', body: page(250, 3) },
    ])
    const stock = await createShipbobProvider({ http, sandbox: false }).allStock(credential, 5_000)
    expect(stock).toHaveLength(253)
    expect(calls).toHaveLength(2)
  })

  it('points the webhooks at this connection’s address, removing stale ones', async () => {
    const prefix = 'https://console.example/api/fulfillment-networks/webhooks/shipbob?connection=h1_shipbob'
    const url = `${prefix}&token=new`
    const { http, calls } = mockHttp([
      {
        method: 'GET',
        match: '/webhook',
        body: [
          { id: 1, topic: 'order_shipped', subscription_url: `${prefix}&token=old&topic=order_shipped` },
          { id: 2, topic: 'shipment_delivered', subscription_url: `${url}&topic=shipment_delivered` },
          { id: 3, topic: 'order_shipped', subscription_url: 'https://elsewhere.example/hook' },
        ],
      },
      { method: 'DELETE', match: '/webhook/1', status: 204 },
      { method: 'POST', match: '/webhook', body: {} },
    ])
    await createShipbobProvider({ http, sandbox: false }).syncWebhooks!(credential, { prefix, url })
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
      'https://api.shipbob.com/1.0/webhook/1',
    ])
    const created = calls.filter((call) => call.method === 'POST').map(sentJson)
    expect(created.map((body) => body.topic)).toEqual(['order_shipped', 'shipment_exception', 'shipment_cancelled'])
    expect(created[0].subscription_url).toBe(`${url}&topic=order_shipped`)
  })

  it('removes every hook of the connection on a disconnect', async () => {
    const prefix = 'https://console.example/api/fulfillment-networks/webhooks/shipbob?connection=h1_shipbob'
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/webhook', body: [{ id: 9, topic: 'order_shipped', subscription_url: `${prefix}&token=t` }] },
      { method: 'DELETE', match: '/webhook/9', status: 204 },
    ])
    await createShipbobProvider({ http, sandbox: false }).syncWebhooks!(credential, { prefix, url: null })
    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE'])
  })
})

const AMAZON_ORDER = {
  payload: {
    fulfillmentOrder: { sellerFulfillmentOrderId: 'agabc123', fulfillmentOrderStatus: 'Processing' },
    fulfillmentShipments: [
      {
        amazonShipmentId: 'D1',
        fulfillmentShipmentStatus: 'SHIPPED',
        shippingDate: '2026-10-08T10:00:00Z',
        fulfillmentShipmentItem: [
          { sellerSku: 'TEE-S', sellerFulfillmentOrderItemId: 'line-0', quantity: 2, packageNumber: 1 },
          { sellerSku: 'MUG', sellerFulfillmentOrderItemId: 'line-2', quantity: 1, packageNumber: 2 },
        ],
        fulfillmentShipmentPackage: [
          { packageNumber: 1, carrierCode: 'UPS', trackingNumber: '1Z1' },
          { packageNumber: 2, carrierCode: 'UPS', trackingNumber: '1Z2' },
        ],
      },
      { amazonShipmentId: 'D2', fulfillmentShipmentStatus: 'PENDING', fulfillmentShipmentItem: [], fulfillmentShipmentPackage: [] },
    ],
  },
}

describe('Amazon Multi-Channel Fulfillment (AGL-3634)', () => {
  const credential = { accessToken: 'Atza|access', marketplaceId: 'ATVPDKIKX0DER' }
  const amazon = (http: ReturnType<typeof mockHttp>['http'], region: 'na' | 'eu' = 'na', sandbox = false) =>
    createAmazonMcfProvider({ http, region, sandbox })

  it('reads the marketplaces the seller takes part in, with the access token header', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations',
        body: {
          payload: [
            { marketplace: { id: 'ATVPDKIKX0DER', name: 'Amazon.com', countryCode: 'US' }, participation: { isParticipating: true }, storeName: 'Candles' },
            { marketplace: { id: 'A2EUQ1WTGCTBG2', name: 'Amazon.ca', countryCode: 'CA' }, participation: { isParticipating: false } },
          ],
        },
      },
    ])
    const account = await amazon(http).account({ accessToken: 'Atza|access' })
    expect(account).toEqual({
      accountName: 'Candles',
      marketplaces: [{ id: 'ATVPDKIKX0DER', name: 'Amazon.com', countryCode: 'US' }],
    })
    expect(calls[0].headers['x-amz-access-token']).toBe('Atza|access')
  })

  it('finds an order by our id, and answers null for one Amazon does not have', async () => {
    const found = mockHttp([{ match: '/fba/outbound/2020-07-01/fulfillmentOrders/agabc123', body: AMAZON_ORDER }])
    await expect(amazon(found.http).findOrder(credential, 'agabc123')).resolves.toMatchObject({ id: 'agabc123' })
    const missing = mockHttp([{ match: '/fulfillmentOrders/', status: 404, body: { errors: [{ code: 'NotFound', message: 'Not found' }] } }])
    await expect(amazon(missing.http).findOrder(credential, 'x')).resolves.toBeNull()
    const refusal = mockHttp([{ match: '/fulfillmentOrders/', status: 400, body: { errors: [{ message: 'Requested order does not exist' }] } }])
    await expect(amazon(refusal.http).findOrder(credential, 'x')).resolves.toBeNull()
  })

  it('creates a fulfillment order under our id with each line as its item id, then reads it', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: 'sandbox.sellingpartnerapi-eu.amazon.com/fba/outbound/2020-07-01/fulfillmentOrders', body: {} },
      { method: 'GET', match: '/fulfillmentOrders/agabc123', body: { payload: { ...AMAZON_ORDER.payload, fulfillmentShipments: [] } } },
    ])
    const order = await amazon(http, 'eu', true).createOrder(credential, REQUEST)
    expect(order).toMatchObject({ id: 'agabc123', state: 'open', shipments: [] })
    expect(sentJson(calls[0])).toEqual({
      marketplaceId: 'ATVPDKIKX0DER',
      sellerFulfillmentOrderId: 'agabc123',
      displayableOrderId: '1042',
      displayableOrderDate: new Date(REQUEST.orderedAtMs).toISOString(),
      displayableOrderComment: 'Thank you for your order.',
      shippingSpeedCategory: 'Expedited',
      fulfillmentAction: 'Ship',
      fulfillmentPolicy: 'FillOrKill',
      destinationAddress: {
        name: 'Ann Lee',
        addressLine1: '2 B St',
        addressLine2: 'Apt 4',
        city: 'Boston',
        stateOrRegion: 'MA',
        postalCode: '02108',
        countryCode: 'US',
        phone: '+16175550100',
      },
      items: [
        { sellerSku: 'TEE-S', sellerFulfillmentOrderItemId: 'line-0', quantity: 2, perUnitDeclaredValue: { currencyCode: 'USD', value: '15.00' } },
        { sellerSku: 'MUG', sellerFulfillmentOrderItemId: 'line-2', quantity: 1, perUnitDeclaredValue: { currencyCode: 'USD', value: '12.50' } },
      ],
    })
  })

  it('refuses to create without a marketplace', async () => {
    const { http, calls } = mockHttp([])
    await expect(amazon(http).createOrder({ accessToken: 't' }, REQUEST)).rejects.toBeInstanceOf(ProviderError)
    expect(calls).toHaveLength(0)
  })

  it('reads each shipped package as a parcel naming its lines', async () => {
    const { http } = mockHttp([{ match: '/fulfillmentOrders/agabc123', body: AMAZON_ORDER }])
    const order = await amazon(http).getOrder(credential, 'agabc123', 'agabc123')
    expect(order.shipments).toEqual([
      expect.objectContaining({ id: 'D1:1', carrier: 'UPS', trackingNumber: '1Z1', packageNumber: '1', items: [{ sku: 'TEE-S', quantity: 2, lineIndex: 0 }] }),
      expect.objectContaining({ id: 'D1:2', trackingNumber: '1Z2', packageNumber: '2', items: [{ sku: 'MUG', quantity: 1, lineIndex: 2 }] }),
    ])
  })

  it('reads complete, canceled and unfulfillable orders', () => {
    const at = (status: string) =>
      readAmazonOrder({ fulfillmentOrder: { sellerFulfillmentOrderId: 'r', fulfillmentOrderStatus: status } })
    expect(at('Complete').state).toBe('shipped')
    expect(at('CompletePartialled').state).toBe('shipped')
    expect(at('Cancelled').state).toBe('canceled')
    expect(at('Unfulfillable')).toMatchObject({ state: 'refused', detail: expect.stringContaining('Unfulfillable') })
    expect(at('Planning').state).toBe('open')
  })

  it('cancels by our id, and says when it is too late', async () => {
    const ok = mockHttp([{ method: 'PUT', match: '/fulfillmentOrders/agabc123/cancel', body: {} }])
    await expect(amazon(ok.http).cancelOrder(credential, 'agabc123', 'agabc123')).resolves.toBe('canceled')
    const late = mockHttp([{ method: 'PUT', match: '/cancel', status: 400, body: { errors: [{ message: 'Order cannot be cancelled' }] } }])
    await expect(amazon(late.http).cancelOrder(credential, 'agabc123', 'agabc123')).resolves.toBe('too_late')
  })

  it('reads FBA stock for the marketplace by SKU, and pages a full count', async () => {
    const { http, calls } = mockHttp([
      {
        match: /summaries\?.*sellerSkus=TEE-S%2CMUG/,
        body: { payload: { inventorySummaries: [{ sellerSku: 'TEE-S', inventoryDetails: { fulfillableQuantity: 9 } }] } },
      },
      {
        match: /summaries\?(?!.*nextToken)(?!.*sellerSkus)/,
        body: { payload: { inventorySummaries: [{ sellerSku: 'A', inventoryDetails: { fulfillableQuantity: 1 } }] }, pagination: { nextToken: 'tok' } },
      },
      { match: /nextToken=tok/, body: { payload: { inventorySummaries: [{ sellerSku: 'B', inventoryDetails: { fulfillableQuantity: 0 } }] } } },
    ])
    await expect(amazon(http).stock(credential, ['TEE-S', 'MUG'])).resolves.toEqual([{ sku: 'TEE-S', fulfillable: 9 }])
    expect(calls[0].url).toContain('granularityType=Marketplace')
    expect(calls[0].url).toContain('granularityId=ATVPDKIKX0DER')
    await expect(amazon(http).allStock(credential, 100)).resolves.toEqual([
      { sku: 'A', fulfillable: 1 },
      { sku: 'B', fulfillable: 0 },
    ])
  })

  it('reads a package’s tracking in the carrier-neutral word', async () => {
    const { http, calls } = mockHttp([
      { match: '/fba/outbound/2020-07-01/tracking?packageNumber=1', body: { payload: { currentStatus: 'DELIVERED', currentStatusDescription: 'Left at door' } } },
    ])
    const shipment = { id: 'D1:1', carrier: 'UPS', trackingNumber: '1Z1', trackingUrl: null, items: [], trackingStatus: null, trackingDetail: null, shippedAtMs: null, packageNumber: '1' }
    await expect(amazon(http).tracking!(credential, shipment)).resolves.toEqual({ status: 'delivered', detail: 'Left at door' })
    expect(calls).toHaveLength(1)
    expect(amazonTrackingStatus('RETURNED')).toBe('returned')
    expect(amazonTrackingStatus('UNDELIVERABLE')).toBe('exception')
    expect(amazonTrackingStatus('OUT_FOR_DELIVERY')).toBe('out_for_delivery')
    expect(amazonTrackingStatus('UNKNOWN')).toBeNull()
  })
})

describe('the network door (AGL-3634)', () => {
  it('retries a read through a blip, and names a refused grant and a missing thing', async () => {
    const blip = mockHttp([
      { match: '/order/1', status: 502, times: 1, body: {} },
      { match: '/order/1', body: { id: 1, status: 'Processing', shipments: [] } },
    ])
    await expect(createShipbobProvider({ http: blip.http, sandbox: false }).getOrder({ accessToken: 't' }, '1', 'r')).resolves.toMatchObject({ id: '1' })
    expect(blip.calls).toHaveLength(2)
    const refused = mockHttp([{ match: '/order/1', status: 401, body: { title: 'Unauthorized' } }])
    await expect(createShipbobProvider({ http: refused.http, sandbox: false }).getOrder({ accessToken: 't' }, '1', 'r')).rejects.toMatchObject({ kind: 'auth' })
    const gone = mockHttp([{ match: '/order/1', status: 404, body: {} }])
    await expect(createShipbobProvider({ http: gone.http, sandbox: false }).getOrder({ accessToken: 't' }, '1', 'r')).rejects.toMatchObject({ kind: 'not-found' })
  })

  it('carries ShipBob’s field errors as its own words', async () => {
    const { http } = mockHttp([{ method: 'POST', match: '/order', status: 422, body: { errors: { 'Recipient.Address.ZipCode': ['Zip code is invalid'] } } }])
    await expect(createShipbobProvider({ http, sandbox: false }).createOrder({ accessToken: 't', channelId: '1' }, REQUEST)).rejects.toMatchObject({
      kind: 'invalid',
      message: 'Zip code is invalid',
    })
  })
})
