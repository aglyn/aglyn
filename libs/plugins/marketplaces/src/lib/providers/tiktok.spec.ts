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

import { mockHttp, sentJson, type RecordedCall } from '../testing/mock-http'
import { ProviderError } from './http'
import type { ListingPush, MarketplaceApp, MarketplaceCredential, ShipmentConfirmation } from './provider'
import {
  createTiktokProvider,
  matchShippingProvider,
  readTiktokOrder,
  tiktokError,
  tiktokExpiryMs,
  tiktokOrderState,
  tiktokSign,
} from './tiktok'

const APP: MarketplaceApp = { clientId: 'test_key', clientSecret: 'test_secret', sandbox: false, extra: { serviceId: '7311' } }
const CREDENTIAL: MarketplaceCredential = { accessToken: 'tts-access', account: { shopId: '7495', shopCipher: 'ROW_abc' } }
const NOW = Date.UTC(2026, 9, 7, 12)
const ok = (data: unknown) => ({ code: 0, message: 'Success', request_id: 'r1', data })

const query = (call: RecordedCall) => new URL(call.url).searchParams

/** Re-signs a recorded call the way TikTok checks it. */
const expectSigned = (call: RecordedCall) => {
  const url = new URL(call.url)
  const params: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    if (key !== 'sign') params[key] = value
  })
  expect(url.searchParams.get('sign')).toBe(tiktokSign('test_secret', url.pathname, params, call.body))
  expect(call.headers['x-tts-access-token']).toBe('tts-access')
  expect(params['app_key']).toBe('test_key')
  expect(params['timestamp']).toBe(String(Math.floor(NOW / 1000)))
}

const push = (sku: string, quantity: number, extra: Partial<ListingPush> = {}): ListingPush => ({
  offerId: `o-${sku}`,
  sku,
  groupId: 'g',
  title: sku,
  description: '',
  priceMinor: 1999,
  currency: 'usd',
  quantity,
  imageUrls: [],
  productUrl: null,
  options: {},
  ...extra,
})

const ORDER = {
  id: '576461413038785752',
  status: 'AWAITING_SHIPMENT',
  fulfillment_type: 'FULFILLMENT_BY_SELLER',
  create_time: 1791374400,
  update_time: 1791378000,
  delivery_option_id: 'do-1',
  payment: {
    currency: 'USD',
    sub_total: '45.00',
    shipping_fee: '5.99',
    seller_discount: '3.00',
    platform_discount: '2.00',
    total_amount: '54.13',
    tax: '3.14',
  },
  recipient_address: {
    name: 'Ann Lee',
    address_line1: '2 B St',
    address_line2: 'Apt 4',
    address_line3: '',
    postal_code: '02108',
    region_code: 'US',
    phone_number: '(+1)617*****00',
    district_info: [
      { address_level_name: 'Country', address_name: 'United States', address_level: 'L0' },
      { address_level_name: 'State', address_name: 'Massachusetts', address_level: 'L1' },
      { address_level_name: 'County', address_name: 'Suffolk', address_level: 'L2' },
      { address_level_name: 'City', address_name: 'Boston', address_level: 'L3' },
    ],
  },
  line_items: [
    { id: 'li-1', sku_id: 'sku-a', seller_sku: 'TEE-S', product_name: 'Tee', sku_name: 'S', original_price: '20.00', sale_price: '18.00', currency: 'USD', display_status: 'AWAITING_SHIPMENT' },
    { id: 'li-2', sku_id: 'sku-a', seller_sku: 'TEE-S', product_name: 'Tee', sku_name: 'S', original_price: '20.00', sale_price: '18.00', currency: 'USD', display_status: 'AWAITING_SHIPMENT' },
    { id: 'li-3', sku_id: 'sku-b', seller_sku: 'MUG', product_name: 'Mug', original_price: '10.00', sale_price: '9.00', currency: 'USD', display_status: 'AWAITING_SHIPMENT' },
    { id: 'li-4', sku_id: 'sku-b', seller_sku: 'MUG', product_name: 'Mug', original_price: '10.00', sale_price: '9.00', currency: 'USD', display_status: 'CANCELLED' },
  ],
}

describe('TikTok Shop signing (AGL-3638)', () => {
  it('signs path, sorted params and body, wrapped in the secret, HMAC-SHA256 hex', () => {
    // The algorithm, written out: the string signed is
    //   secret + path + (sorted key+value pairs, minus sign/access_token) + body + secret
    // test_secret/order/202309/orders/searchapp_keytest_keypage_size50shop_cipherROW_abc
    //   sort_fieldupdate_timesort_orderASCtimestamp1700000000{"update_time_ge":1699990000}test_secret
    // and its HMAC-SHA256 keyed by "test_secret", in hex:
    const sign = tiktokSign(
      'test_secret',
      '/order/202309/orders/search',
      {
        timestamp: '1700000000',
        sort_order: 'ASC',
        app_key: 'test_key',
        sort_field: 'update_time',
        shop_cipher: 'ROW_abc',
        page_size: '50',
        sign: 'ignored',
        access_token: 'ignored',
      },
      '{"update_time_ge":1699990000}',
    )
    expect(sign).toBe('dd79599c4a432b519ee29a8bcaebac9df986fa73f1dc5719fc8352aed2d039ab')
  })

  it('signs a call with no body by its path and params alone', () => {
    expect(tiktokSign('test_secret', '/authorization/202309/shops', { app_key: 'test_key', timestamp: '1700000000' }, null)).toBe(
      '21d5c8afd9009543285b69530f1a9d55b2834d752f0b88b45145f05ba8800441',
    )
  })
})

describe('TikTok Shop envelope errors (AGL-3638)', () => {
  it('reads an expired or invalid token as auth', () => {
    expect(tiktokError({ code: 105002, message: 'Expired credentials' }).kind).toBe('auth')
    expect(tiktokError({ code: 36009004, message: 'Invalid access_token' }).kind).toBe('auth')
  })

  it('reads a rate limit as rate-limit, and anything else as invalid in TikTok’s words', () => {
    expect(tiktokError({ code: 36009001, message: 'Too many requests, please retry later' })).toMatchObject({
      kind: 'rate-limit',
      retryAfterMs: 60_000,
    })
    const invalid = tiktokError({ code: 12052900, message: 'The seller_sku is invalid' })
    expect(invalid).toMatchObject({ kind: 'invalid', message: 'The seller_sku is invalid' })
  })

  it('throws the mapped error from an HTTP 200 answer with a non-zero code', async () => {
    const { http } = mockHttp([{ match: '/authorization/202309/shops', body: { code: 105001, message: 'Invalid credentials', data: null } }])
    const error = await createTiktokProvider({ http, now: () => NOW })
      .account(APP, CREDENTIAL)
      .catch((caught) => caught)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.kind).toBe('auth')
  })

  it('reads a 401 as auth', async () => {
    const { http } = mockHttp([{ match: '/order/202309/orders/search', status: 401, body: { code: 105002, message: 'expired' } }])
    await expect(
      createTiktokProvider({ http, now: () => NOW }).listOrders(APP, CREDENTIAL, { sinceMs: NOW, cursor: null }),
    ).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('TikTok Shop OAuth (AGL-3638)', () => {
  it('sends the seller to the service’s consent page with our state', () => {
    const provider = createTiktokProvider({ http: mockHttp([]).http })
    const url = new URL(provider.authorizeUrl(APP, { redirectUri: 'https://x', state: 's-1', codeChallenge: 'c' }))
    expect(url.origin + url.pathname).toBe('https://services.us.tiktokshop.com/open/authorize')
    expect(url.searchParams.get('service_id')).toBe('7311')
    expect(url.searchParams.get('state')).toBe('s-1')
    const global = provider.authorizeUrl({ ...APP, extra: { serviceId: '7311', region: 'global' } }, { redirectUri: 'https://x', state: 's', codeChallenge: 'c' })
    expect(global.startsWith('https://services.tiktokshop.com/open/authorize?')).toBe(true)
    expect(() => provider.authorizeUrl({ ...APP, extra: {} }, { redirectUri: 'https://x', state: 's', codeChallenge: 'c' })).toThrow(ProviderError)
  })

  it('trades the code for tokens whose expiries are absolute epoch seconds', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'auth.tiktok-shops.com/api/v2/token/get',
        body: ok({
          access_token: 'acc',
          access_token_expire_in: 1791979200,
          refresh_token: 'ref',
          refresh_token_expire_in: 4841467787,
          seller_name: 'Ann’s Shop',
        }),
      },
    ])
    const grant = await createTiktokProvider({ http }).exchangeCode(APP, {
      code: 'auth-1',
      redirectUri: 'https://x',
      codeVerifier: 'v',
      params: new URLSearchParams({ code: 'auth-1' }),
      nowMs: NOW,
    })
    expect(grant).toEqual({
      accessToken: 'acc',
      refreshToken: 'ref',
      expiresAtMs: 1791979200_000,
      refreshExpiresAtMs: 4841467787_000,
    })
    const params = query(calls[0])
    expect(calls[0].method).toBe('GET')
    expect(Object.fromEntries(params)).toEqual({
      app_key: 'test_key',
      app_secret: 'test_secret',
      auth_code: 'auth-1',
      grant_type: 'authorized_code',
    })
  })

  it('refreshes, and reads a relative expiry as seconds from now', async () => {
    const { http, calls } = mockHttp([
      { match: '/api/v2/token/refresh', body: ok({ access_token: 'acc2', access_token_expire_in: 604800, refresh_token: 'ref2' }) },
    ])
    const grant = await createTiktokProvider({ http }).refresh(APP, { refreshToken: 'ref', nowMs: NOW })
    expect(grant).toMatchObject({ accessToken: 'acc2', refreshToken: 'ref2', expiresAtMs: NOW + 604800_000, refreshExpiresAtMs: null })
    expect(query(calls[0]).get('grant_type')).toBe('refresh_token')
    expect(query(calls[0]).get('refresh_token')).toBe('ref')
    expect(tiktokExpiryMs(undefined, NOW)).toBeNull()
  })

  it('reads a refused refresh as auth', async () => {
    const { http } = mockHttp([{ match: '/api/v2/token/refresh', body: { code: 105002, message: 'refresh token expired' } }])
    await expect(createTiktokProvider({ http }).refresh(APP, { refreshToken: 'r', nowMs: NOW })).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('TikTok Shop account (AGL-3638)', () => {
  it('reads the authorized shop and its cipher, signed and without a shop cipher', async () => {
    const { http, calls } = mockHttp([
      {
        match: 'open-api.tiktokglobalshop.com/authorization/202309/shops',
        body: ok({ shops: [{ id: '7495', name: 'Ann’s Shop', region: 'US', cipher: 'ROW_abc', code: 'USLC', seller_type: 'LOCAL' }] }),
      },
    ])
    const account = await createTiktokProvider({ http, now: () => NOW }).account(APP, { accessToken: 'tts-access', account: {} })
    expect(account).toEqual({ accountName: 'Ann’s Shop', account: { shopId: '7495', shopCipher: 'ROW_abc' } })
    expectSigned(calls[0])
    expect(query(calls[0]).has('shop_cipher')).toBe(false)
  })

  it('refuses a grant that reaches no shop', async () => {
    const { http } = mockHttp([{ match: '/shops', body: ok({ shops: [] }) }])
    await expect(createTiktokProvider({ http, now: () => NOW }).account(APP, CREDENTIAL)).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('TikTok Shop listings (AGL-3638)', () => {
  const SEARCH = ok({
    products: [
      {
        id: 'p1',
        status: 'ACTIVATE',
        skus: [
          { id: 'k1', seller_sku: 'TEE-S', inventory: [{ warehouse_id: 'w1', quantity: 3 }] },
          { id: 'k2', seller_sku: 'TEE-M', inventory: [{ warehouse_id: 'w1', quantity: 1 }] },
        ],
      },
      { id: 'p2', status: 'ACTIVATE', skus: [{ id: 'k3', seller_sku: 'MUG', inventory: [{ warehouse_id: 'w1', quantity: 0 }] }] },
    ],
  })

  it('updates each product’s SKUs in one inventory call; an unknown SKU is not listed', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: '/product/202309/products/search', body: SEARCH },
      { method: 'POST', match: /\/products\/p[12]\/inventory\/update/, body: ok({}) },
    ])
    const results = await createTiktokProvider({ http, now: () => NOW }).syncListings(
      APP,
      CREDENTIAL,
      [push('TEE-S', 4), push('NOPE', 1), push('TEE-M', -2), push('MUG', 7)],
      { publish: false, prices: false },
    )
    expect(results).toEqual([
      { sku: 'TEE-S', outcome: 'updated', externalId: 'p1:k1', message: null },
      { sku: 'NOPE', outcome: 'not_listed', externalId: null, message: null },
      { sku: 'TEE-M', outcome: 'updated', externalId: 'p1:k2', message: null },
      { sku: 'MUG', outcome: 'updated', externalId: 'p2:k3', message: null },
    ])
    expect(sentJson(calls[0])).toEqual({ seller_skus: ['TEE-S', 'NOPE', 'TEE-M', 'MUG'] })
    expect(query(calls[0]).get('shop_cipher')).toBe('ROW_abc')
    calls.forEach(expectSigned)
    const updates = calls.filter((call) => call.url.includes('/inventory/update'))
    expect(updates).toHaveLength(2)
    expect(sentJson(updates[0])).toEqual({
      skus: [
        { id: 'k1', inventory: [{ quantity: 4, warehouse_id: 'w1' }] },
        { id: 'k2', inventory: [{ quantity: 0, warehouse_id: 'w1' }] },
      ],
    })
    expect(sentJson(updates[1])).toEqual({ skus: [{ id: 'k3', inventory: [{ quantity: 7, warehouse_id: 'w1' }] }] })
    expect(calls.some((call) => call.url.includes('/prices/update'))).toBe(false)
  })

  it('sends prices as decimal strings when asked, grouped per product', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: '/products/search', body: SEARCH },
      { method: 'POST', match: '/inventory/update', body: ok({}) },
      { method: 'POST', match: '/prices/update', body: ok({}) },
    ])
    await createTiktokProvider({ http, now: () => NOW }).syncListings(
      APP,
      CREDENTIAL,
      [push('TEE-S', 1, { priceMinor: 2450 }), push('TEE-M', 1, { priceMinor: 2500 })],
      { publish: false, prices: true },
    )
    const prices = calls.filter((call) => call.url.includes('/prices/update'))
    expect(prices).toHaveLength(1)
    expect(new URL(prices[0].url).pathname).toBe('/product/202309/products/p1/prices/update')
    expect(sentJson(prices[0])).toEqual({
      skus: [
        { id: 'k1', price: { amount: '24.50', currency: 'USD' } },
        { id: 'k2', price: { amount: '25.00', currency: 'USD' } },
      ],
    })
  })

  it('marks a SKU TikTok refused as failed, in TikTok’s words', async () => {
    const { http } = mockHttp([
      { method: 'POST', match: '/products/search', body: SEARCH },
      { method: 'POST', match: '/products/p1/inventory/update', body: ok({ errors: [{ code: 1, message: 'Quantity locked', detail: { sku_id: 'k2' } }] }) },
      { method: 'POST', match: '/products/p2/inventory/update', body: { code: 12019020, message: 'Product is frozen', data: null } },
    ])
    const results = await createTiktokProvider({ http, now: () => NOW }).syncListings(
      APP,
      CREDENTIAL,
      [push('TEE-S', 1), push('TEE-M', 1), push('MUG', 1)],
      { publish: false, prices: false },
    )
    expect(results.map((result) => [result.outcome, result.message])).toEqual([
      ['updated', null],
      ['failed', 'Quantity locked'],
      ['failed', 'Product is frozen'],
    ])
  })
})

describe('TikTok Shop orders (AGL-3638)', () => {
  it('maps every status', () => {
    expect(['UNPAID', 'ON_HOLD'].map(tiktokOrderState)).toEqual(['pending', 'pending'])
    expect(['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING'].map(tiktokOrderState)).toEqual([
      'unshipped',
      'unshipped',
      'unshipped',
    ])
    expect(['IN_TRANSIT', 'DELIVERED', 'COMPLETED'].map(tiktokOrderState)).toEqual(['shipped', 'shipped', 'shipped'])
    expect(tiktokOrderState('CANCELLED')).toBe('canceled')
  })

  it('groups one-per-unit line items by SKU, keeping every id, in minor units', () => {
    expect(readTiktokOrder(ORDER)).toEqual({
      externalId: '576461413038785752',
      displayRef: '576461413038785752',
      state: 'unshipped',
      fulfilledByMarketplace: false,
      placedAtMs: 1791374400_000,
      updatedAtMs: 1791378000_000,
      currency: 'USD',
      lines: [
        { externalLineId: 'li-1,li-2', sku: 'TEE-S', title: 'Tee — S', quantity: 2, unitPriceMinor: 2000 },
        { externalLineId: 'li-3', sku: 'MUG', title: 'Mug', quantity: 1, unitPriceMinor: 1000 },
      ],
      shippingMinor: 599,
      taxMinor: 314,
      discountMinor: 300,
      totalMinor: 5413,
      fees: null,
      buyerName: 'Ann Lee',
      shipTo: {
        name: 'Ann Lee',
        line1: '2 B St',
        line2: 'Apt 4',
        city: 'Boston',
        state: 'Massachusetts',
        postalCode: '02108',
        country: 'US',
        phone: '(+1)617*****00',
      },
      testMode: false,
    })
  })

  it('reads Fulfilled by TikTok', () => {
    expect(readTiktokOrder({ ...ORDER, fulfillment_type: 'FULFILLMENT_BY_TIKTOK' }).fulfilledByMarketplace).toBe(true)
  })

  it('searches by update time, oldest first, and pages by token', async () => {
    const { http, calls } = mockHttp([
      { method: 'POST', match: '/order/202309/orders/search', times: 1, body: ok({ orders: [ORDER], next_page_token: 'tok/2=' }) },
      { method: 'POST', match: '/order/202309/orders/search', body: ok({ orders: [], next_page_token: '' }) },
    ])
    const provider = createTiktokProvider({ http, now: () => NOW })
    const first = await provider.listOrders(APP, CREDENTIAL, { sinceMs: 1791370000_500, cursor: null })
    expect(first.orders).toHaveLength(1)
    expect(first.nextCursor).toBe('tok/2=')
    expect(sentJson(calls[0])).toEqual({ update_time_ge: 1791370000 })
    expect(Object.fromEntries(query(calls[0]))).toMatchObject({
      page_size: '50',
      sort_field: 'update_time',
      sort_order: 'ASC',
      shop_cipher: 'ROW_abc',
    })
    expectSigned(calls[0])
    const second = await provider.listOrders(APP, CREDENTIAL, { sinceMs: 1791370000_500, cursor: 'tok/2=' })
    expect(query(calls[1]).get('page_token')).toBe('tok/2=')
    expectSigned(calls[1])
    expect(second.nextCursor).toBeNull()
  })
})

describe('TikTok Shop shipments (AGL-3638)', () => {
  const CONFIRMATION: ShipmentConfirmation = {
    externalOrderId: ORDER.id,
    lines: [
      { externalLineId: 'li-1,li-2', quantity: 2 },
      { externalLineId: 'li-3', quantity: 1 },
    ],
    carrier: 'FedEx',
    trackingNumber: '7489',
    trackingUrl: null,
    shippedAtMs: NOW,
    reference: 'sh-1',
  }
  const PROVIDERS = ok({ shipping_providers: [{ id: 'sp-ups', name: 'UPS' }, { id: 'sp-fedex', name: 'FedEx' }, { id: 'sp-usps', name: 'USPS' }] })

  it('matches the carrier to a shipping provider by name', () => {
    const providers = [{ id: '1', name: 'FedEx' }, { id: '2', name: 'USPS' }, { id: '3', name: 'DHL eCommerce' }]
    expect(matchShippingProvider(providers, 'fedex')?.id).toBe('1')
    expect(matchShippingProvider(providers, 'United States Postal Service')?.id).toBe('2')
    expect(matchShippingProvider(providers, 'DHL')?.id).toBe('3')
    expect(matchShippingProvider(providers, 'OnTrac')).toBeNull()
  })

  it('marks the package shipped with the provider id, tracking and every unit’s line item id, once', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/order/202309/orders?', body: ok({ orders: [ORDER] }) },
      { method: 'GET', match: '/logistics/202309/delivery_options/do-1/shipping_providers', body: PROVIDERS },
      { method: 'POST', match: `/fulfillment/202309/orders/${ORDER.id}/packages`, body: ok({}) },
    ])
    const outcome = await createTiktokProvider({ http, now: () => NOW }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)
    expect(outcome).toBe('confirmed')
    expect(query(calls[0]).get('ids')).toBe(ORDER.id)
    const post = calls[2]
    expect(sentJson(post)).toEqual({ tracking_number: '7489', shipping_provider_id: 'sp-fedex', order_line_item_ids: ['li-1', 'li-2', 'li-3'] })
    calls.forEach(expectSigned)
  })

  it('ships part of a grouped line by its first untracked units', async () => {
    const order = {
      ...ORDER,
      line_items: ORDER.line_items.map((item) => (item.id === 'li-1' ? { ...item, tracking_number: 'old' } : item)),
    }
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/order/202309/orders?', body: ok({ orders: [order] }) },
      { method: 'GET', match: '/shipping_providers', body: PROVIDERS },
      { method: 'POST', match: '/packages', body: ok({}) },
    ])
    await createTiktokProvider({ http, now: () => NOW }).confirmShipment(APP, CREDENTIAL, {
      ...CONFIRMATION,
      lines: [{ externalLineId: 'li-1,li-2', quantity: 1 }],
    })
    expect(sentJson(calls[2]).order_line_item_ids).toEqual(['li-2'])
  })

  it('answers already when the units already carry tracking', async () => {
    const order = { ...ORDER, line_items: ORDER.line_items.map((item) => ({ ...item, tracking_number: '7489' })) }
    const { http, calls } = mockHttp([{ method: 'GET', match: '/order/202309/orders?', body: ok({ orders: [order] }) }])
    await expect(createTiktokProvider({ http, now: () => NOW }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).resolves.toBe('already')
    expect(calls).toHaveLength(1)
  })

  it('answers already when TikTok refuses a package it turns out to have', async () => {
    let reads = 0
    const shipped = { ...ORDER, status: 'IN_TRANSIT', line_items: ORDER.line_items.map((item) => ({ ...item, tracking_number: '7489' })) }
    const { http } = mockHttp([
      { method: 'GET', match: '/order/202309/orders?', respond: () => ({ body: ok({ orders: [reads++ === 0 ? ORDER : shipped] }) }) },
      { method: 'GET', match: '/shipping_providers', body: PROVIDERS },
      { method: 'POST', match: '/packages', body: { code: 21011001, message: 'Package has been shipped', data: null } },
    ])
    await expect(createTiktokProvider({ http, now: () => NOW }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).resolves.toBe('already')
  })

  it('refuses a carrier TikTok offers no provider for, naming what it takes', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/order/202309/orders?', body: ok({ orders: [ORDER] }) },
      { method: 'GET', match: '/shipping_providers', body: PROVIDERS },
    ])
    const error = await createTiktokProvider({ http, now: () => NOW })
      .confirmShipment(APP, CREDENTIAL, { ...CONFIRMATION, carrier: 'OnTrac' })
      .catch((caught) => caught)
    expect(error).toMatchObject({ kind: 'invalid' })
    expect(error.message).toContain('UPS, FedEx, USPS')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('sends the package once: a timeout is not retried', async () => {
    const { http, calls } = mockHttp([
      { method: 'GET', match: '/order/202309/orders?', body: ok({ orders: [ORDER] }) },
      { method: 'GET', match: '/shipping_providers', body: PROVIDERS },
      { method: 'POST', match: '/packages', status: 503, body: {} },
    ])
    await expect(createTiktokProvider({ http, now: () => NOW }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).rejects.toMatchObject({
      kind: 'transient',
    })
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  })
})
