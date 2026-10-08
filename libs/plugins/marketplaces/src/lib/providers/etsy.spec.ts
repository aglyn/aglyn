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
  ETSY_MESSAGES,
  ETSY_SCOPES,
  createEtsyProvider,
  etsyCarrier,
  etsyInventoryWrite,
  etsyMinor,
  etsyReceiptState,
  etsyUserId,
  readEtsyReceipt,
} from './etsy'
import type { ListingPush, MarketplaceApp, MarketplaceCredential } from './provider'

const APP: MarketplaceApp = { clientId: 'keystring1', clientSecret: 'sharedsecret1', sandbox: false, extra: {} }
const CREDENTIAL: MarketplaceCredential = { accessToken: '12345678.tok', account: { shopId: '555', userId: '12345678' } }
const NOW = Date.UTC(2026, 9, 7, 12)

const push = (overrides: Partial<ListingPush> = {}): ListingPush => ({
  offerId: 'p1',
  sku: 'TEE-S',
  groupId: 'p1',
  title: 'Cotton tee',
  description: 'A soft tee.',
  priceMinor: 2_500,
  currency: 'USD',
  quantity: 7,
  imageUrls: [],
  productUrl: null,
  options: {},
  ...overrides,
})

const money = (amount: number, divisor = 100, currency_code = 'USD') => ({ amount, divisor, currency_code })

/** A two-size listing whose price and quantity vary by size (property 100). */
const INVENTORY = {
  products: [
    {
      product_id: 1,
      sku: 'TEE-S',
      is_deleted: false,
      property_values: [{ property_id: 100, property_name: 'Size', scale_id: 19, scale_name: 'US', value_ids: [11], values: ['S'] }],
      offerings: [{ offering_id: 21, quantity: 3, is_enabled: true, is_deleted: false, price: money(2_000), readiness_state_id: 9 }],
    },
    {
      product_id: 2,
      sku: 'TEE-M',
      is_deleted: false,
      property_values: [{ property_id: 100, property_name: 'Size', scale_id: 19, scale_name: 'US', value_ids: [12], values: ['M'] }],
      offerings: [{ offering_id: 22, quantity: 4, is_enabled: true, is_deleted: false, price: money(2_150), readiness_state_id: 9 }],
    },
  ],
  price_on_property: [100],
  quantity_on_property: [100],
  sku_on_property: [100],
  readiness_state_on_property: [],
}

const formOf = (body: string | null) => Object.fromEntries(new URLSearchParams(body ?? ''))

describe('Etsy (AGL-3638)', () => {
  describe('consent and tokens', () => {
    it('sends the PKCE challenge, the scopes and the callback address', () => {
      const url = new URL(
        createEtsyProvider({ http: mockHttp([]).http }).authorizeUrl(APP, {
          redirectUri: 'https://console.aglyn.com/api/marketplaces/etsy/callback',
          state: 's-1',
          codeChallenge: 'chal-123',
        }),
      )
      expect(url.origin + url.pathname).toBe('https://www.etsy.com/oauth/connect')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        response_type: 'code',
        redirect_uri: 'https://console.aglyn.com/api/marketplaces/etsy/callback',
        scope: ETSY_SCOPES.join(' '),
        client_id: 'keystring1',
        state: 's-1',
        code_challenge: 'chal-123',
        code_challenge_method: 'S256',
      })
    })

    it('trades the code with the verifier and reads the user id off the token', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'https://api.etsy.com/v3/public/oauth/token',
          body: { access_token: '12345678.abc', token_type: 'Bearer', expires_in: 3600, refresh_token: '12345678.ref' },
        },
      ])
      const grant = await createEtsyProvider({ http }).exchangeCode(APP, {
        code: 'code-1',
        redirectUri: 'https://console.aglyn.com/cb',
        codeVerifier: 'verifier-xyz',
        params: new URLSearchParams(),
        nowMs: NOW,
      })
      expect(grant).toEqual({
        accessToken: '12345678.abc',
        refreshToken: '12345678.ref',
        expiresAtMs: NOW + 3_600_000,
        account: { userId: '12345678' },
      })
      expect(formOf(calls[0].body)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'keystring1',
        redirect_uri: 'https://console.aglyn.com/cb',
        code: 'code-1',
        code_verifier: 'verifier-xyz',
      })
      expect(calls[0].headers['x-api-key']).toBe('keystring1:sharedsecret1')
    })

    it('refreshes with the client id and the refresh token', async () => {
      const { http, calls } = mockHttp([
        { method: 'POST', match: '/v3/public/oauth/token', body: { access_token: '12345678.new', expires_in: 3600, refresh_token: '12345678.ref2' } },
      ])
      const grant = await createEtsyProvider({ http }).refresh(APP, { refreshToken: '12345678.ref', nowMs: NOW })
      expect(grant.refreshToken).toBe('12345678.ref2')
      expect(formOf(calls[0].body)).toEqual({ grant_type: 'refresh_token', client_id: 'keystring1', refresh_token: '12345678.ref' })
    })

    it('reads the shop the token’s user owns, with the key and bearer on the call', async () => {
      const { http, calls } = mockHttp([
        { match: 'https://api.etsy.com/v3/application/users/12345678/shops', body: { shop_id: 555, shop_name: 'TeesAndCo', user_id: 12345678 } },
      ])
      const account = await createEtsyProvider({ http }).account(APP, { accessToken: '12345678.tok', account: {} })
      expect(account).toEqual({ accountName: 'TeesAndCo', account: { shopId: '555', userId: '12345678' } })
      expect(calls[0].headers['x-api-key']).toBe('keystring1:sharedsecret1')
      expect(calls[0].headers['authorization']).toBe('Bearer 12345678.tok')
    })

    it('reads a refused token as an auth failure', async () => {
      const { http } = mockHttp([{ match: '/users/12345678/shops', status: 401, body: { error: 'invalid_token' } }])
      await expect(createEtsyProvider({ http }).account(APP, CREDENTIAL)).rejects.toMatchObject({ kind: 'auth' })
    })

    it('reads the user id prefix of a token', () => {
      expect(etsyUserId('12345678.O1zL')).toBe('12345678')
      expect(etsyUserId('nope')).toBeNull()
    })
  })

  describe('listings', () => {
    it('writes the whole inventory back, changing only the pushed SKU’s offering', () => {
      const { body } = etsyInventoryWrite(INVENTORY, [push({ quantity: 9, priceMinor: 2_299 })], { prices: true })
      expect(body).toEqual({
        products: [
          {
            sku: 'TEE-S',
            property_values: [{ property_id: 100, property_name: 'Size', scale_id: 19, value_ids: [11], values: ['S'] }],
            offerings: [{ price: 22.99, quantity: 9, is_enabled: true, readiness_state_id: 9 }],
          },
          {
            sku: 'TEE-M',
            property_values: [{ property_id: 100, property_name: 'Size', scale_id: 19, value_ids: [12], values: ['M'] }],
            offerings: [{ price: 21.5, quantity: 4, is_enabled: true, readiness_state_id: 9 }],
          },
        ],
        price_on_property: [100],
        quantity_on_property: [100],
        sku_on_property: [100],
        readiness_state_on_property: [],
      })
    })

    it('keeps prices as read when prices are not asked, and turns a zeroed offering back on when stock returns', () => {
      const zeroed = {
        ...INVENTORY,
        products: [{ ...INVENTORY.products[0], offerings: [{ ...INVENTORY.products[0].offerings[0], quantity: 0, is_enabled: false }] }, INVENTORY.products[1]],
      }
      const { body } = etsyInventoryWrite(zeroed, [push({ quantity: 2 })], { prices: false })
      expect((body as any).products[0].offerings[0]).toEqual({ price: 20, quantity: 2, is_enabled: true, readiness_state_id: 9 })
      const { body: off } = etsyInventoryWrite(zeroed, [push({ quantity: 0 })], { prices: false })
      expect((off as any).products[0].offerings[0].is_enabled).toBe(false)
    })

    it('shares one quantity and price across variations that do not vary them', () => {
      const shared = { ...INVENTORY, price_on_property: [], quantity_on_property: [] }
      const { body } = etsyInventoryWrite(shared, [push({ quantity: 5 }), push({ sku: 'TEE-M', quantity: 2 })], { prices: true })
      expect((body as any).products.map((product: any) => product.offerings[0].quantity)).toEqual([2, 2])
      expect((body as any).products.map((product: any) => product.offerings[0].price)).toEqual([25, 25])
      const differ = etsyInventoryWrite(shared, [push(), push({ sku: 'TEE-M', priceMinor: 2_700 })], { prices: true })
      expect(differ).toEqual({ body: null, refusal: ETSY_MESSAGES.pricesDiffer })
    })

    it('finds listings by SKU across the shop, updates them, and reports the rest', async () => {
      const { http, calls } = mockHttp([
        {
          match: '/shops/555/listings?state=active&limit=100&offset=0&includes=Inventory',
          body: {
            count: 2,
            results: [
              { listing_id: 901, state: 'active', inventory: INVENTORY },
              { listing_id: 902, state: 'active', skus: ['MUG'] },
            ],
          },
        },
        { match: '/shops/555/listings?state=sold_out', body: { count: 1, results: [{ listing_id: 903, skus: ['GONE', 'ZERO'] }] } },
        { method: 'GET', match: '/listings/901/inventory', body: INVENTORY },
        { method: 'PUT', match: '/listings/901/inventory', body: INVENTORY },
        {
          method: 'GET',
          match: '/listings/902/inventory',
          body: { products: [{ sku: 'MUG', property_values: [], offerings: [{ quantity: 1, is_enabled: true, price: money(1_000) }] }] },
        },
        { method: 'PUT', match: '/listings/902/inventory', status: 400, body: { error: 'Price must be at least 0.20' } },
      ])
      const results = await createEtsyProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [
          push({ quantity: 9 }),
          push({ sku: 'TEE-M', quantity: 1 }),
          push({ sku: 'MUG', priceMinor: 10 }),
          push({ sku: 'GONE' }),
          push({ sku: 'ZERO', quantity: 0 }),
          push({ sku: 'NOPE' }),
        ],
        { publish: false, prices: true },
      )
      expect(results).toEqual([
        { sku: 'TEE-S', outcome: 'updated', externalId: '901', message: null },
        { sku: 'TEE-M', outcome: 'updated', externalId: '901', message: null },
        { sku: 'MUG', outcome: 'failed', externalId: '902', message: 'Price must be at least 0.20' },
        { sku: 'GONE', outcome: 'failed', externalId: '903', message: ETSY_MESSAGES.soldOut },
        { sku: 'ZERO', outcome: 'updated', externalId: '903', message: null },
        { sku: 'NOPE', outcome: 'not_listed', message: ETSY_MESSAGES.notListed },
      ])
      // One write per listing, both pushed SKUs in it.
      const write = calls.filter((call) => call.method === 'PUT' && call.url.includes('/listings/901/'))
      expect(write).toHaveLength(1)
      expect(sentJson(write[0]).products.map((product: any) => product.offerings[0].quantity)).toEqual([9, 1])
      expect(write[0].headers['x-api-key']).toBe('keystring1:sharedsecret1')
    })

    it('walks every page of listings', async () => {
      const page = (offset: number, count: number) =>
        Array.from({ length: count }, (_, index) => ({ listing_id: offset + index + 1, skus: [`S${offset + index}`] }))
      const { http, calls } = mockHttp([
        { match: 'state=active&limit=100&offset=0', body: { count: 150, results: page(0, 100) } },
        { match: 'state=active&limit=100&offset=100', body: { count: 150, results: page(100, 50) } },
        { match: 'state=sold_out', body: { count: 0, results: [] } },
        { method: 'GET', match: '/listings/150/inventory', body: { products: [{ sku: 'S149', property_values: [], offerings: [{ quantity: 0, is_enabled: true, price: money(500) }] }] } },
        { method: 'PUT', match: '/listings/150/inventory', body: {} },
      ])
      const [result] = await createEtsyProvider({ http }).syncListings(APP, CREDENTIAL, [push({ sku: 'S149', quantity: 4 })], {
        publish: false,
        prices: false,
      })
      expect(result).toEqual({ sku: 'S149', outcome: 'updated', externalId: '150', message: null })
      expect(calls.filter((call) => call.url.includes('/shops/555/listings'))).toHaveLength(3)
    })
  })

  describe('orders', () => {
    const RECEIPT = {
      receipt_id: 3001,
      status: 'Paid',
      is_paid: true,
      is_shipped: false,
      name: 'Ann Lee',
      first_line: '2 B St',
      second_line: 'Apt 4',
      city: 'Boston',
      state: 'MA',
      zip: '02108',
      country_iso: 'us',
      created_timestamp: 1_791_000_000,
      updated_timestamp: 1_791_000_600,
      grandtotal: money(3_418, 100, 'usd'),
      total_shipping_cost: money(495),
      total_tax_cost: money(223),
      discount_amt: money(300),
      transactions: [
        { transaction_id: 77, title: 'Cotton tee', quantity: 2, sku: '', product_data: [{ sku: 'TEE-S' }], price: money(1_500) },
        { transaction_id: 78, title: 'Sticker', quantity: 1, sku: 'STK', price: money(12_345, 1000) },
      ],
    }

    it('reads a receipt: lines, money by divisor, and the address', () => {
      expect(readEtsyReceipt(RECEIPT)).toEqual({
        externalId: '3001',
        displayRef: '#3001',
        state: 'unshipped',
        fulfilledByMarketplace: false,
        placedAtMs: 1_791_000_000_000,
        updatedAtMs: 1_791_000_600_000,
        currency: 'USD',
        lines: [
          { externalLineId: '77', sku: 'TEE-S', title: 'Cotton tee', quantity: 2, unitPriceMinor: 1_500 },
          { externalLineId: '78', sku: 'STK', title: 'Sticker', quantity: 1, unitPriceMinor: 1_235 },
        ],
        shippingMinor: 495,
        taxMinor: 223,
        discountMinor: 300,
        totalMinor: 3_418,
        fees: null,
        buyerName: 'Ann Lee',
        shipTo: { name: 'Ann Lee', line1: '2 B St', line2: 'Apt 4', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
        testMode: false,
      })
    })

    it('converts amounts by their divisor with integer math', () => {
      expect(etsyMinor(money(1999), 2)).toBe(1999)
      expect(etsyMinor(money(19_990, 1000), 2)).toBe(1999)
      expect(etsyMinor(money(19_995, 1000), 2)).toBe(2000)
      expect(etsyMinor(money(5, 1), 2)).toBe(500)
      expect(etsyMinor(money(1500, 1, 'JPY'), 0)).toBe(1500)
      expect(etsyMinor(money(-12_345, 1000), 2)).toBe(-1235)
      expect(etsyMinor(null, 2)).toBe(0)
    })

    it('reads receipt states', () => {
      expect(etsyReceiptState({ status: 'paid', is_paid: true, is_shipped: false })).toBe('unshipped')
      expect(etsyReceiptState({ status: 'completed', is_paid: true, is_shipped: true })).toBe('shipped')
      expect(etsyReceiptState({ status: 'partially refunded', is_paid: true, is_shipped: false })).toBe('unshipped')
      expect(etsyReceiptState({ status: 'canceled', is_paid: true })).toBe('canceled')
      expect(etsyReceiptState({ status: 'Fully Refunded', is_paid: true, is_shipped: true })).toBe('canceled')
      expect(etsyReceiptState({ status: 'payment processing', is_paid: false })).toBe('pending')
      expect(etsyReceiptState({ status: 'open', is_paid: false })).toBe('pending')
    })

    it('pages receipts by last change, oldest first', async () => {
      const { http, calls } = mockHttp([
        { match: 'offset=0', body: { count: 101, results: Array.from({ length: 100 }, () => RECEIPT) } },
        { match: 'offset=100', body: { count: 101, results: [RECEIPT] } },
      ])
      const provider = createEtsyProvider({ http })
      const first = await provider.listOrders(APP, CREDENTIAL, { sinceMs: 1_791_000_000_500, cursor: null })
      expect(first.nextCursor).toBe('100')
      const url = new URL(calls[0].url)
      expect(url.origin + url.pathname).toBe('https://api.etsy.com/v3/application/shops/555/receipts')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        min_last_modified: '1791000000',
        limit: '100',
        offset: '0',
        sort_on: 'updated',
        sort_order: 'asc',
      })
      const second = await provider.listOrders(APP, CREDENTIAL, { sinceMs: 0, cursor: first.nextCursor })
      expect(second.nextCursor).toBeNull()
      expect(new URL(calls[1].url).searchParams.get('min_last_modified')).toBe('946684800')
    })
  })

  describe('shipments', () => {
    const CONFIRMATION = {
      externalOrderId: '3001',
      lines: [{ externalLineId: '77', quantity: 2 }],
      carrier: 'Canada Post',
      trackingNumber: 'CP123',
      trackingUrl: null,
      shippedAtMs: NOW,
      reference: 'ship-1',
    }

    it('adds tracking to the receipt with Etsy’s carrier name', async () => {
      const { http, calls } = mockHttp([
        { method: 'GET', match: '/shops/555/receipts/3001', body: { receipt_id: 3001, shipments: [] } },
        { method: 'POST', match: '/shops/555/receipts/3001/tracking', body: { receipt_id: 3001, is_shipped: true } },
      ])
      expect(await createEtsyProvider({ http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('confirmed')
      expect(sentJson(calls[1])).toEqual({ tracking_code: 'CP123', carrier_name: 'canada-post', send_bcc: false })
    })

    it('answers already when the receipt carries the tracking code or Etsy says so', async () => {
      const held = mockHttp([{ method: 'GET', match: '/receipts/3001', body: { shipments: [{ tracking_code: 'CP123', carrier_name: 'canada-post' }] } }])
      expect(await createEtsyProvider({ http: held.http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('already')
      expect(held.calls).toHaveLength(1)

      const refused = mockHttp([
        { method: 'GET', match: '/receipts/3001', body: { shipments: [] } },
        { method: 'POST', match: '/receipts/3001/tracking', status: 400, body: { error: 'This receipt has already been shipped.' } },
      ])
      expect(await createEtsyProvider({ http: refused.http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('already')
    })

    it('maps carriers to Etsy’s names, other for the rest', () => {
      expect(etsyCarrier('USPS')).toBe('usps')
      expect(etsyCarrier('FedEx')).toBe('fedex')
      expect(etsyCarrier('royal_mail')).toBe('royal-mail')
      expect(etsyCarrier('Deutsche Post')).toBe('deutsch-post')
      expect(etsyCarrier('Bob’s Couriers')).toBe('other')
      expect(etsyCarrier(null)).toBe('other')
    })
  })
})
