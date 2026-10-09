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
  createFaireProvider,
  FAIRE_SCOPES,
  faireCarrier,
  faireCountry,
  faireOrderState,
  readFaireOrder,
} from './faire'
import type { ListingPush, MarketplaceApp, MarketplaceCredential, ShipmentConfirmation } from './provider'

const APP: MarketplaceApp = { clientId: 'app_123', clientSecret: 'secret_456', sandbox: false, extra: {} }
const CREDENTIAL: MarketplaceCredential = { accessToken: 'faire-oauth', account: { sellerId: 'b_60ae65c4' } }
const NOW = Date.UTC(2026, 9, 7, 12)

const push = (sku: string, quantity: number, extra: Partial<ListingPush> = {}): ListingPush => ({
  offerId: `o-${sku}`,
  sku,
  groupId: 'g',
  title: sku,
  description: '',
  priceMinor: 1999,
  currency: 'USD',
  quantity,
  imageUrls: [],
  productUrl: null,
  options: {},
  ...extra,
})

const level = (onHand: number, committed: number) => ({
  on_hand_quantity: { type: 'QUANTITY', quantity: onHand },
  committed_quantity: { type: 'QUANTITY', quantity: committed },
  available_quantity: { type: 'QUANTITY', quantity: onHand - committed },
})

const ORDER = {
  id: 'bo_bxdmjbwxid',
  display_id: 'BXDMJBWXID',
  created_at: '2026-10-06T00:09:15.000Z',
  updated_at: '2026-10-06T00:10:00.000Z',
  state: 'PROCESSING',
  items: [
    {
      id: 'oi_1',
      quantity: 6,
      sku: 'TEE-S',
      price: { amount_minor: 1050, currency: 'USD' },
      price_cents: 1050,
      product_name: 'Tee',
      variant_name: 'S',
      state: 'PROCESSING',
    },
    { id: 'oi_2', quantity: 4, sku: 'MUG', price_cents: 600, product_name: 'Mug', state: 'PROCESSING' },
    { id: 'oi_3', quantity: 2, sku: 'CAP', price_cents: 900, product_name: 'Cap', state: 'CANCELED' },
  ],
  shipments: [],
  address: {
    name: 'John Smith',
    address1: '41 King Street West',
    address2: '3rd Floor',
    postal_code: 'N2G 1A1',
    city: 'Kitchener',
    state: 'Ontario',
    state_code: 'ON',
    phone_number: '555-123-4567',
    country: 'Canada',
    country_code: 'CAN',
    company_name: 'Tom’s Toque Emporium',
  },
  retailer_id: 'r_c9385ldj',
  payout_costs: {
    payout_fee_cents: 150,
    payout_fee_bps: 0,
    commission_cents: 2175,
    commission_bps: 2500,
    subtotal_after_brand_discounts: { amount_minor: 8100, currency: 'USD' },
    total_brand_discounts: { amount_minor: 600, currency: 'USD' },
  },
  source: 'MARKETPLACE',
}

describe('Faire OAuth (AGL-3638)', () => {
  it('sends the brand to the consent page with the app id, scopes, state and redirect', () => {
    const url = new URL(
      createFaireProvider({ http: mockHttp([]).http }).authorizeUrl(APP, {
        redirectUri: 'https://console.aglyn.com/oauth/faire',
        state: 's-1',
        codeChallenge: 'c',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://faire.com/oauth2/authorize')
    expect(url.searchParams.get('applicationId')).toBe('app_123')
    expect(url.searchParams.getAll('scope')).toEqual([...FAIRE_SCOPES])
    expect(url.searchParams.get('state')).toBe('s-1')
    expect(url.searchParams.get('redirectUrl')).toBe('https://console.aglyn.com/oauth/faire')
  })

  it('trades the authorization code for a token that does not expire, once', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: 'https://www.faire.com/api/external-api-oauth2/token', body: { accessToken: 'oauth-tok', tokenType: 'BEARER' } },
    ])
    const grant = await createFaireProvider({ http }).exchangeCode(APP, {
      code: 'ignored',
      redirectUri: 'https://console.aglyn.com/oauth/faire',
      codeVerifier: 'v',
      params: new URLSearchParams({ authorizationCode: 'code-9', state: 's-1' }),
      nowMs: NOW,
    })
    expect(grant).toEqual({ accessToken: 'oauth-tok', refreshToken: null, expiresAtMs: null, refreshExpiresAtMs: null })
    expect(sentJson(calls[0])).toEqual({
      application_token: 'app_123',
      application_secret: 'secret_456',
      redirect_url: 'https://console.aglyn.com/oauth/faire',
      scope: [...FAIRE_SCOPES],
      grant_type: 'AUTHORIZATION_CODE',
      authorization_code: 'code-9',
    })
  })

  it('has nothing to refresh: a refresh asks for a new connection', async () => {
    const { http, calls } = mockHttp([])
    await expect(createFaireProvider({ http }).refresh(APP, { refreshToken: 'x', nowMs: NOW })).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toHaveLength(0)
  })
})

describe('Faire account (AGL-3638)', () => {
  it('reads the brand profile with the app’s credentials beside the brand’s token', async () => {
    const { http, calls } = mockHttp([
      { match: 'https://www.faire.com/external-api/v2/brands/profile', body: { brand_id: 'b_60ae65c4', name: 'Jeff’s Warm Toques' } },
    ])
    const account = await createFaireProvider({ http }).account(APP, { accessToken: 'faire-oauth', account: {} })
    expect(account).toEqual({ accountName: 'Jeff’s Warm Toques', account: { sellerId: 'b_60ae65c4' } })
    expect(calls[0].headers['x-faire-app-credentials']).toBe(Buffer.from('app_123:secret_456').toString('base64'))
    expect(calls[0].headers['x-faire-oauth-access-token']).toBe('faire-oauth')
  })

  it('reads a 401 as auth', async () => {
    const { http } = mockHttp([{ match: '/brands/profile', status: 401, body: { message: 'Unauthorized' } }])
    await expect(createFaireProvider({ http }).account(APP, CREDENTIAL)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('Faire listings (AGL-3638)', () => {
  it('sets on-hand to the store’s quantity plus Faire’s committed units; an unknown SKU is not listed; prices are never sent', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/product-inventory/by-skus?', body: { 'TEE-S': level(10, 2), MUG: level(5, 0) } },
      {
        method: 'PATCH',
        match: '/product-inventory/by-skus',
        respond: (call) => ({
          body: Object.fromEntries(JSON.parse(call.body!).inventories.map((entry: any) => [entry.sku, level(entry.on_hand_quantity, 0)])),
        }),
      },
    ])
    const results = await createFaireProvider({ http }).syncListings(
      APP,
      CREDENTIAL,
      [push('TEE-S', 7), push('NOPE', 3), push('MUG', -1)],
      { publish: false, prices: true },
    )
    expect(results).toEqual([
      { sku: 'TEE-S', outcome: 'updated', externalId: null, message: null },
      { sku: 'NOPE', outcome: 'not_listed', externalId: null, message: null },
      { sku: 'MUG', outcome: 'updated', externalId: null, message: null },
    ])
    expect(new URL(calls[0].url).searchParams.getAll('skus')).toEqual(['TEE-S', 'NOPE', 'MUG'])
    expect(sentJson(calls[1])).toEqual({
      inventories: [
        { sku: 'TEE-S', on_hand_quantity: 9 },
        { sku: 'MUG', on_hand_quantity: 0 },
      ],
    })
    expect(calls).toHaveLength(2)
    expect(calls.some((call) => /price/i.test(call.url) || /price/i.test(call.body ?? ''))).toBe(false)
  })

  it('batches 50 SKUs a call', async () => {
    const skus = Array.from({ length: 120 }, (_, index) => `S${index}`)
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/product-inventory/by-skus?', respond: (call) => ({ body: Object.fromEntries(new URL(call.url).searchParams.getAll('skus').map((sku) => [sku, level(0, 0)])) }) },
      { method: 'PATCH', match: '/product-inventory/by-skus', respond: (call) => ({ body: Object.fromEntries(JSON.parse(call.body!).inventories.map((entry: any) => [entry.sku, level(1, 0)])) }) },
    ])
    const results = await createFaireProvider({ http }).syncListings(APP, CREDENTIAL, skus.map((sku) => push(sku, 1)), { publish: false, prices: false })
    expect(results.every((result) => result.outcome === 'updated')).toBe(true)
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => sentJson(call).inventories.length)).toEqual([50, 50, 20])
  })

  it('marks a refused batch as failed in Faire’s words', async () => {
    const { http } = mockHttp([
      { method: 'GET', match: '/product-inventory/by-skus?', body: { 'TEE-S': level(1, 0) } },
      { method: 'PATCH', match: '/product-inventory/by-skus', status: 400, body: { message: 'Inventory tracking is off' } },
    ])
    const results = await createFaireProvider({ http }).syncListings(APP, CREDENTIAL, [push('TEE-S', 1)], { publish: false, prices: false })
    expect(results).toEqual([{ sku: 'TEE-S', outcome: 'failed', externalId: null, message: 'Inventory tracking is off' }])
  })
})

describe('Faire orders (AGL-3638)', () => {
  it('maps every state', () => {
    expect(['NEW', 'PROCESSING'].map(faireOrderState)).toEqual(['unshipped', 'unshipped'])
    expect(['PRE_TRANSIT', 'IN_TRANSIT', 'DELIVERED'].map(faireOrderState)).toEqual(['shipped', 'shipped', 'shipped'])
    expect(['PENDING_RETAILER_CONFIRMATION', 'BACKORDERED'].map(faireOrderState)).toEqual(['pending', 'pending'])
    expect(faireOrderState('CANCELED')).toBe('canceled')
  })

  it('reads wholesale lines, the brand’s discount and Faire’s commission and payout fee', () => {
    expect(readFaireOrder(ORDER)).toEqual({
      externalId: 'bo_bxdmjbwxid',
      displayRef: 'BXDMJBWXID',
      state: 'unshipped',
      fulfilledByMarketplace: false,
      placedAtMs: Date.parse('2026-10-06T00:09:15.000Z'),
      updatedAtMs: Date.parse('2026-10-06T00:10:00.000Z'),
      currency: 'USD',
      lines: [
        { externalLineId: 'oi_1', sku: 'TEE-S', title: 'Tee — S', quantity: 6, unitPriceMinor: 1050 },
        { externalLineId: 'oi_2', sku: 'MUG', title: 'Mug', quantity: 4, unitPriceMinor: 600 },
      ],
      shippingMinor: 0,
      taxMinor: 0,
      discountMinor: 600,
      totalMinor: 8100,
      fees: [
        { label: 'Faire commission', amountMinor: 2175 },
        { label: 'Faire payout fee', amountMinor: 150 },
      ],
      buyerName: 'Tom’s Toque Emporium',
      shipTo: {
        name: 'John Smith',
        line1: '41 King Street West',
        line2: '3rd Floor',
        city: 'Kitchener',
        state: 'ON',
        postalCode: 'N2G 1A1',
        country: 'CA',
        phone: '555-123-4567',
      },
      testMode: false,
    })
  })

  it('reads an order without payout costs as fees not yet known', () => {
    const order = readFaireOrder({ ...ORDER, payout_costs: undefined, display_id: undefined })
    expect(order.fees).toBeNull()
    expect(order.totalMinor).toBe(6 * 1050 + 4 * 600)
    expect(order.displayRef).toBe('BXDMJBWXID')
    expect(faireCountry('USA')).toBe('US')
    expect(faireCountry('XXX')).toBeNull()
  })

  it('asks for orders updated since, then pages by Faire’s cursor alone', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/orders?', times: 1, body: { page: 1, limit: 50, cursor: 'cur-2', orders: [ORDER] } },
      { method: 'GET', match: '/orders?', body: { page: 1, limit: 50, orders: [{ ...ORDER, id: 'bo_2' }] } },
    ])
    const provider = createFaireProvider({ http })
    const first = await provider.listOrders(APP, CREDENTIAL, { sinceMs: NOW, cursor: null })
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ limit: '50', updated_at_min: new Date(NOW).toISOString() })
    expect(first).toMatchObject({ nextCursor: 'cur-2', orders: [{ externalId: 'bo_bxdmjbwxid' }] })
    const second = await provider.listOrders(APP, CREDENTIAL, { sinceMs: NOW, cursor: 'cur-2' })
    expect(Object.fromEntries(new URL(calls[1].url).searchParams)).toEqual({ limit: '50', cursor: 'cur-2' })
    expect(second.nextCursor).toBeNull()
  })
})

describe('Faire accept (AGL-3638)', () => {
  const order = readFaireOrder({ ...ORDER, state: 'NEW' })

  it('accepts a new order', async () => {
    const { http, calls } = mockHttp([{ method: 'PUT', match: '/orders/bo_bxdmjbwxid/processing', body: {} }])
    await createFaireProvider({ http }).acknowledgeOrder!(APP, CREDENTIAL, order)
    expect(calls).toHaveLength(1)
  })

  it('treats an order already accepted as done', async () => {
    const { http } = mockHttp([
      { method: 'PUT', match: '/processing', status: 400, body: { message: 'Order is not in state NEW' } },
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: { ...ORDER, state: 'PROCESSING' } },
    ])
    await expect(createFaireProvider({ http }).acknowledgeOrder!(APP, CREDENTIAL, order)).resolves.toBeUndefined()
  })

  it('still fails when the refused order is canceled', async () => {
    const { http } = mockHttp([
      { method: 'PUT', match: '/processing', status: 400, body: { message: 'Order is canceled' } },
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: { ...ORDER, state: 'CANCELED' } },
    ])
    await expect(createFaireProvider({ http }).acknowledgeOrder!(APP, CREDENTIAL, order)).rejects.toMatchObject({ kind: 'invalid' })
  })
})

describe('Faire shipments (AGL-3638)', () => {
  const CONFIRMATION: ShipmentConfirmation = {
    externalOrderId: 'bo_bxdmjbwxid',
    lines: [{ externalLineId: 'oi_1', quantity: 6 }],
    carrier: 'FedEx',
    trackingNumber: '9402 9300',
    trackingUrl: null,
    shippedAtMs: NOW,
    reference: 'sh-1',
  }

  it('maps carriers to Faire’s values', () => {
    expect(faireCarrier('FedEx')).toBe('FEDEX')
    expect(faireCarrier('usps')).toBe('USPS')
    expect(faireCarrier('Canada Post')).toBe('CANADA_POST')
    expect(faireCarrier('DHL eCommerce')).toBe('DHL_ECOMMERCE')
    expect(faireCarrier('OnTrac')).toBe('OnTrac')
  })

  it('adds a ship-on-your-own shipment with the carrier and tracking, once', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: ORDER },
      { method: 'POST', match: '/orders/bo_bxdmjbwxid/shipments', body: {} },
    ])
    await expect(createFaireProvider({ http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).resolves.toBe('confirmed')
    expect(sentJson(calls[1])).toEqual({
      shipments: [{ order_id: 'bo_bxdmjbwxid', carrier: 'FEDEX', tracking_code: '9402 9300', shipping_type: 'SHIP_ON_YOUR_OWN' }],
    })
  })

  it('sends what the brand paid to ship as maker_cost_cents, and nothing when it is not known (AGL-3693)', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: ORDER },
      { method: 'POST', match: '/orders/bo_bxdmjbwxid/shipments', body: {} },
    ])
    const provider = createFaireProvider({ http })
    await expect(provider.confirmShipment(APP, CREDENTIAL, { ...CONFIRMATION, shippingCostMinor: 2300 })).resolves.toBe('confirmed')
    expect(sentJson(calls[1])).toEqual({
      shipments: [
        {
          order_id: 'bo_bxdmjbwxid',
          carrier: 'FEDEX',
          tracking_code: '9402 9300',
          shipping_type: 'SHIP_ON_YOUR_OWN',
          maker_cost_cents: 2300,
        },
      ],
    })
    // Free shipping is a cost of zero, and is said.
    await provider.confirmShipment(APP, CREDENTIAL, { ...CONFIRMATION, shippingCostMinor: 0 })
    expect(sentJson(calls[3]).shipments[0].maker_cost_cents).toBe(0)
    // Unknown, or not whole cents: left out rather than guessed.
    for (const shippingCostMinor of [null, 12.5, -1]) {
      await provider.confirmShipment(APP, CREDENTIAL, { ...CONFIRMATION, shippingCostMinor })
      expect(sentJson(calls[calls.length - 1]).shipments[0]).not.toHaveProperty('maker_cost_cents')
    }
  })

  it('answers already when the order carries the tracking number', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: { ...ORDER, shipments: [{ id: 's_1', tracking_code: '94029300', carrier: 'fedex' }] } },
    ])
    await expect(createFaireProvider({ http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).resolves.toBe('already')
    expect(calls).toHaveLength(1)
  })

  it('answers already when Faire refuses a shipment it turns out to have', async () => {
    let reads = 0
    const { http } = mockHttp([
      {
        method: 'GET',
        match: '/orders/bo_bxdmjbwxid',
        respond: () => ({ body: reads++ === 0 ? ORDER : { ...ORDER, shipments: [{ tracking_code: '9402 9300' }] } }),
      },
      { method: 'POST', match: '/shipments', status: 400, body: { message: 'Order already shipped' } },
    ])
    await expect(createFaireProvider({ http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).resolves.toBe('already')
  })

  it('never retries the create, and refuses a shipment with no carrier', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/orders/bo_bxdmjbwxid', body: ORDER },
      { method: 'POST', match: '/shipments', status: 502, body: {} },
    ])
    const provider = createFaireProvider({ http })
    await expect(provider.confirmShipment(APP, CREDENTIAL, CONFIRMATION)).rejects.toMatchObject({ kind: 'transient' })
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    await expect(provider.confirmShipment(APP, CREDENTIAL, { ...CONFIRMATION, carrier: null })).rejects.toMatchObject({ kind: 'invalid' })
  })
})
