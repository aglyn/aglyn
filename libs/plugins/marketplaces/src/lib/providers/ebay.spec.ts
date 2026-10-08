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
import { EBAY_MESSAGES, EBAY_SCOPES, createEbayProvider, ebayCarrier, ebayOrderState, readEbayOrder } from './ebay'
import { ProviderError } from './http'
import type { ListingPush, MarketplaceApp, MarketplaceCredential } from './provider'

const APP: MarketplaceApp = {
  clientId: 'Aglyn-App-PRD-123',
  clientSecret: 'PRD-secret',
  sandbox: false,
  extra: { ruName: 'Aglyn_LLC-AglynApp-Aglyn-abcde' },
}
const SANDBOX: MarketplaceApp = { ...APP, sandbox: true }
const CREDENTIAL: MarketplaceCredential = { accessToken: 'v^1.1#token', account: { sellerId: 'u-1', marketplaceId: 'EBAY_US' } }
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
  imageUrls: ['https://cdn.example.com/tee.jpg'],
  productUrl: 'https://shop.example.com/p/tee',
  options: { Size: 'S' },
  ...overrides,
})

const formOf = (body: string | null) => Object.fromEntries(new URLSearchParams(body ?? ''))

describe('eBay (AGL-3638)', () => {
  describe('consent and tokens', () => {
    it('sends the RuName as redirect_uri, never the callback address', () => {
      const url = new URL(
        createEbayProvider({ http: mockHttp([]).http }).authorizeUrl(APP, {
          redirectUri: 'https://console.aglyn.com/api/marketplaces/ebay/callback',
          state: 's-1',
          codeChallenge: 'unused',
        }),
      )
      expect(url.origin + url.pathname).toBe('https://auth.ebay.com/oauth2/authorize')
      expect(url.searchParams.get('redirect_uri')).toBe('Aglyn_LLC-AglynApp-Aglyn-abcde')
      expect(url.searchParams.get('client_id')).toBe('Aglyn-App-PRD-123')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('state')).toBe('s-1')
      expect(url.searchParams.get('scope')?.split(' ')).toEqual([...EBAY_SCOPES])
      expect(url.searchParams.has('code_challenge')).toBe(false)
    })

    it('uses the sandbox consent page for a sandbox app', () => {
      const url = createEbayProvider({ http: mockHttp([]).http }).authorizeUrl(SANDBOX, { redirectUri: 'x', state: 's', codeChallenge: 'c' })
      expect(url.startsWith('https://auth.sandbox.ebay.com/oauth2/authorize?')).toBe(true)
    })

    it('refuses to build a consent page without a RuName', () => {
      expect(() =>
        createEbayProvider({ http: mockHttp([]).http }).authorizeUrl({ ...APP, extra: {} }, { redirectUri: 'x', state: 's', codeChallenge: 'c' }),
      ).toThrow(ProviderError)
    })

    it('trades the code with Basic credentials and the RuName, and dates both tokens', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'https://api.ebay.com/identity/v1/oauth2/token',
          body: { access_token: 'v^1.1#a', expires_in: 7200, refresh_token: 'v^1.1#r', refresh_token_expires_in: 47_304_000, token_type: 'User Access Token' },
        },
      ])
      const grant = await createEbayProvider({ http }).exchangeCode(APP, {
        code: 'code-1',
        redirectUri: 'https://console.aglyn.com/cb',
        codeVerifier: 'v',
        params: new URLSearchParams(),
        nowMs: NOW,
      })
      expect(grant).toEqual({
        accessToken: 'v^1.1#a',
        refreshToken: 'v^1.1#r',
        expiresAtMs: NOW + 7_200_000,
        refreshExpiresAtMs: NOW + 47_304_000_000,
      })
      expect(calls[0].headers['authorization']).toBe(`Basic ${Buffer.from('Aglyn-App-PRD-123:PRD-secret').toString('base64')}`)
      expect(calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(formOf(calls[0].body)).toEqual({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'Aglyn_LLC-AglynApp-Aglyn-abcde' })
    })

    it('refreshes with the consented scopes, keeping the old refresh token', async () => {
      const { http, calls } = mockHttp([
        { method: 'POST', match: 'api.sandbox.ebay.com/identity/v1/oauth2/token', body: { access_token: 'v^1.1#b', expires_in: 7200 } },
      ])
      const grant = await createEbayProvider({ http }).refresh(SANDBOX, { refreshToken: 'v^1.1#r', nowMs: NOW })
      expect(grant).toEqual({ accessToken: 'v^1.1#b', refreshToken: null, expiresAtMs: NOW + 7_200_000, refreshExpiresAtMs: null })
      expect(formOf(calls[0].body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'v^1.1#r', scope: EBAY_SCOPES.join(' ') })
    })

    it('reads the account from Commerce Identity on apiz', async () => {
      const { http, calls } = mockHttp([
        { match: 'https://apiz.ebay.com/commerce/identity/v1/user/', body: { userId: 'abc123', username: 'tees_and_co' } },
      ])
      const account = await createEbayProvider({ http }).account(APP, { accessToken: 't', account: {} })
      expect(account).toEqual({ accountName: 'tees_and_co', account: { sellerId: 'abc123', marketplaceId: 'EBAY_US' } })
      expect(calls[0].headers['authorization']).toBe('Bearer t')
    })

    it('reads a refused token as an auth failure', async () => {
      const { http } = mockHttp([
        { match: '/commerce/identity/v1/user/', status: 401, body: { errors: [{ errorId: 1001, message: 'Invalid access token' }] } },
      ])
      await expect(createEbayProvider({ http }).account(APP, CREDENTIAL)).rejects.toMatchObject({ kind: 'auth' })
    })
  })

  describe('listings', () => {
    it('updates quantity and price of live listings and reports SKUs the Inventory API cannot see', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: '/sell/inventory/v1/bulk_get_inventory_item',
          body: {
            responses: [
              { sku: 'TEE-S', statusCode: 200, inventoryItem: { sku: 'TEE-S' } },
              { sku: 'MUG', statusCode: 200, inventoryItem: { sku: 'MUG' } },
              { sku: 'OLD', statusCode: 404, errors: [{ errorId: 25710, message: 'not found' }] },
            ],
          },
        },
        {
          match: '/sell/inventory/v1/offer?sku=TEE-S',
          body: { offers: [{ offerId: 'o-1', sku: 'TEE-S', marketplaceId: 'EBAY_US', status: 'PUBLISHED', listing: { listingId: '1100' } }] },
        },
        {
          match: '/sell/inventory/v1/offer?sku=MUG',
          body: { offers: [{ offerId: 'o-2', sku: 'MUG', marketplaceId: 'EBAY_US', status: 'PUBLISHED', listing: { listingId: '1200' } }] },
        },
        {
          method: 'POST',
          match: '/sell/inventory/v1/bulk_update_price_quantity',
          body: {
            responses: [
              { sku: 'TEE-S', offerId: 'o-1', statusCode: 200 },
              { sku: 'MUG', offerId: 'o-2', statusCode: 400, errors: [{ errorId: 25001, longMessage: 'The price is below the minimum for this category.' }] },
            ],
          },
        },
      ])
      const results = await createEbayProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [push(), push({ sku: 'MUG', offerId: 'p2', priceMinor: 99, quantity: 0 }), push({ sku: 'OLD', offerId: 'p3' })],
        { publish: false, prices: true },
      )
      expect(results).toEqual([
        { sku: 'TEE-S', outcome: 'updated', externalId: '1100', message: null },
        { sku: 'MUG', outcome: 'failed', message: 'The price is below the minimum for this category.' },
        { sku: 'OLD', outcome: 'not_listed', message: EBAY_MESSAGES.notInInventoryApi },
      ])
      expect(sentJson(calls[0])).toEqual({ requests: [{ sku: 'TEE-S' }, { sku: 'MUG' }, { sku: 'OLD' }] })
      expect(sentJson(calls.find((call) => call.url.includes('bulk_update_price_quantity')))).toEqual({
        requests: [
          {
            sku: 'TEE-S',
            shipToLocationAvailability: { quantity: 7 },
            offers: [{ offerId: 'o-1', availableQuantity: 7, price: { value: '25.00', currency: 'USD' } }],
          },
          {
            sku: 'MUG',
            shipToLocationAvailability: { quantity: 0 },
            offers: [{ offerId: 'o-2', availableQuantity: 0, price: { value: '0.99', currency: 'USD' } }],
          },
        ],
      })
    })

    it('sends quantities alone when prices are not asked, and reads a SKU with no offers as not listed', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'bulk_get_inventory_item',
          body: { responses: [{ sku: 'TEE-S', statusCode: 200 }, { sku: 'DRAFT', statusCode: 200 }] },
        },
        { match: 'offer?sku=TEE-S', body: { offers: [{ offerId: 'o-1', status: 'PUBLISHED', listing: { listingId: '1100' } }] } },
        { match: 'offer?sku=DRAFT', status: 404, body: { errors: [{ errorId: 25713, message: 'This Offer is not available.' }] } },
        { method: 'POST', match: 'bulk_update_price_quantity', body: { responses: [{ sku: 'TEE-S', offerId: 'o-1', statusCode: 200 }] } },
      ])
      const results = await createEbayProvider({ http }).syncListings(APP, CREDENTIAL, [push(), push({ sku: 'DRAFT' })], {
        publish: false,
        prices: false,
      })
      expect(results.map((result) => result.outcome)).toEqual(['updated', 'not_listed'])
      expect(results[1].message).toBe(EBAY_MESSAGES.noLiveOffer)
      const update = sentJson(calls.find((call) => call.url.includes('bulk_update_price_quantity')))
      expect(update.requests[0].offers[0]).toEqual({ offerId: 'o-1', availableQuantity: 7 })
    })

    it('batches 25 SKUs to a bulk call', async () => {
      const skus = Array.from({ length: 30 }, (_, index) => `S${index}`)
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'bulk_get_inventory_item',
          respond: (call) => ({
            body: { responses: sentJson(call).requests.map((request: any) => ({ sku: request.sku, statusCode: 404 })) },
          }),
        },
      ])
      const results = await createEbayProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        skus.map((sku) => push({ sku })),
        { publish: false, prices: false },
      )
      expect(calls.map((call) => sentJson(call).requests.length)).toEqual([25, 5])
      expect(results.every((result) => result.outcome === 'not_listed')).toBe(true)
    })

    const PUBLISH_ROUTES = [
      { method: 'POST', match: 'bulk_get_inventory_item', body: { responses: [{ sku: 'TEE-S', statusCode: 404 }] } },
      { match: '/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US', body: { fulfillmentPolicies: [{ fulfillmentPolicyId: 'fp-1' }] } },
      { match: '/sell/account/v1/payment_policy?marketplace_id=EBAY_US', body: { paymentPolicies: [{ paymentPolicyId: 'pp-1' }] } },
      { match: '/sell/account/v1/return_policy?marketplace_id=EBAY_US', body: { returnPolicies: [{ returnPolicyId: 'rp-1' }] } },
      { match: '/sell/inventory/v1/location', body: { locations: [{ merchantLocationKey: 'home', merchantLocationStatus: 'ENABLED' }] } },
      { match: '/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US', body: { categoryTreeId: '0' } },
      { method: 'PUT', match: '/sell/inventory/v1/inventory_item/TEE-S', status: 204 },
      {
        match: '/commerce/taxonomy/v1/category_tree/0/get_category_suggestions',
        body: { categorySuggestions: [{ category: { categoryId: '15687', categoryName: 'T-Shirts' } }] },
      },
      { method: 'POST', match: /\/sell\/inventory\/v1\/offer$/, body: { offerId: 'o-9' } },
      { method: 'POST', match: '/sell/inventory/v1/offer/o-9/publish', body: { listingId: '1300' } },
    ]

    it('publishes a SKU eBay lacks: inventory item, category, policies, location, offer, publish', async () => {
      const { http, calls } = mockHttp(PUBLISH_ROUTES)
      const results = await createEbayProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [push({ gtin: '0123456789012', brand: 'Aglyn', mpn: 'T-1', weightGrams: 200, condition: 'new' })],
        { publish: true, prices: true },
      )
      expect(results).toEqual([{ sku: 'TEE-S', outcome: 'created', externalId: '1300', message: null }])
      const item = calls.find((call) => call.method === 'PUT')!
      expect(item.headers['content-language']).toBe('en-US')
      expect(sentJson(item)).toEqual({
        condition: 'NEW',
        availability: { shipToLocationAvailability: { quantity: 7 } },
        product: {
          title: 'Cotton tee',
          description: 'A soft tee.',
          imageUrls: ['https://cdn.example.com/tee.jpg'],
          aspects: { Size: ['S'], Brand: ['Aglyn'] },
          brand: 'Aglyn',
          mpn: 'T-1',
          ean: ['0123456789012'],
        },
        packageWeightAndSize: { weight: { value: 200, unit: 'GRAM' } },
      })
      const suggestions = calls.find((call) => call.url.includes('get_category_suggestions'))!
      expect(new URL(suggestions.url).searchParams.get('q')).toBe('Cotton tee')
      const offer = calls.find((call) => call.method === 'POST' && call.url.endsWith('/sell/inventory/v1/offer'))!
      expect(offer.headers['content-language']).toBe('en-US')
      expect(sentJson(offer)).toEqual({
        sku: 'TEE-S',
        marketplaceId: 'EBAY_US',
        format: 'FIXED_PRICE',
        listingDuration: 'GTC',
        availableQuantity: 7,
        categoryId: '15687',
        listingDescription: 'A soft tee.',
        listingPolicies: { fulfillmentPolicyId: 'fp-1', paymentPolicyId: 'pp-1', returnPolicyId: 'rp-1' },
        merchantLocationKey: 'home',
        pricingSummary: { price: { value: '25.00', currency: 'USD' } },
      })
    })

    it('reads the seller’s policies, location and category tree once per sync', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'bulk_get_inventory_item',
          body: { responses: [{ sku: 'A', statusCode: 404 }, { sku: 'B', statusCode: 404 }] },
        },
        ...PUBLISH_ROUTES.slice(1, 6),
        { method: 'PUT', match: /inventory_item\/[AB]$/, status: 204 },
        PUBLISH_ROUTES[7],
        { method: 'POST', match: /\/sell\/inventory\/v1\/offer$/, respond: (call) => ({ body: { offerId: `o-${sentJson(call).sku}` } }) },
        { method: 'POST', match: /offer\/o-[AB]\/publish$/, respond: (call) => ({ body: { listingId: call.url.includes('o-A') ? '1' : '2' } }) },
      ])
      const results = await createEbayProvider({ http }).syncListings(APP, CREDENTIAL, [push({ sku: 'A' }), push({ sku: 'B' })], {
        publish: true,
        prices: false,
      })
      expect(results.map((result) => [result.outcome, result.externalId])).toEqual([
        ['created', '1'],
        ['created', '2'],
      ])
      expect(calls.filter((call) => call.url.includes('fulfillment_policy'))).toHaveLength(1)
      expect(calls.filter((call) => call.url.includes('get_default_category_tree_id'))).toHaveLength(1)
    })

    it('says what the merchant must set up when policies or a location are missing', async () => {
      const noPolicies = mockHttp([
        PUBLISH_ROUTES[0],
        { match: 'fulfillment_policy', body: { fulfillmentPolicies: [], total: 0 } },
        ...PUBLISH_ROUTES.slice(2, 6),
      ])
      const [result] = await createEbayProvider({ http: noPolicies.http }).syncListings(APP, CREDENTIAL, [push()], {
        publish: true,
        prices: false,
      })
      expect(result).toEqual({ sku: 'TEE-S', outcome: 'failed', message: EBAY_MESSAGES.noPolicies })
      expect(noPolicies.calls.some((call) => call.method === 'PUT')).toBe(false)

      const noLocation = mockHttp([...PUBLISH_ROUTES.slice(0, 4), { match: '/sell/inventory/v1/location', body: { locations: [] } }, PUBLISH_ROUTES[5]])
      const [second] = await createEbayProvider({ http: noLocation.http }).syncListings(APP, CREDENTIAL, [push()], {
        publish: true,
        prices: false,
      })
      expect(second.message).toBe(EBAY_MESSAGES.noLocation)
    })

    it('refuses to publish a product with no photo, before calling eBay', async () => {
      const { http, calls } = mockHttp([PUBLISH_ROUTES[0]])
      const [result] = await createEbayProvider({ http }).syncListings(APP, CREDENTIAL, [push({ imageUrls: [] })], {
        publish: true,
        prices: false,
      })
      expect(result).toEqual({ sku: 'TEE-S', outcome: 'failed', message: EBAY_MESSAGES.noImage })
      expect(calls).toHaveLength(1)
    })

    it('reports eBay’s own words when it refuses to publish', async () => {
      const { http } = mockHttp([
        ...PUBLISH_ROUTES.slice(0, 9),
        {
          method: 'POST',
          match: '/offer/o-9/publish',
          status: 400,
          body: { errors: [{ errorId: 25002, longMessage: 'The item specific Department is missing.' }] },
        },
      ])
      const [result] = await createEbayProvider({ http }).syncListings(APP, CREDENTIAL, [push()], { publish: true, prices: false })
      expect(result).toEqual({ sku: 'TEE-S', outcome: 'failed', message: 'The item specific Department is missing.' })
    })

    it('reuses an unpublished offer instead of creating a second', async () => {
      const { http, calls } = mockHttp([
        { method: 'POST', match: 'bulk_get_inventory_item', body: { responses: [{ sku: 'TEE-S', statusCode: 200 }] } },
        { match: 'offer?sku=TEE-S', body: { offers: [{ offerId: 'o-7', status: 'UNPUBLISHED', format: 'FIXED_PRICE' }] } },
        ...PUBLISH_ROUTES.slice(1, 8),
        { method: 'PUT', match: '/sell/inventory/v1/offer/o-7', status: 204 },
        { method: 'POST', match: '/sell/inventory/v1/offer/o-7/publish', body: { listingId: '1400' } },
      ])
      const [result] = await createEbayProvider({ http }).syncListings(APP, CREDENTIAL, [push()], { publish: true, prices: false })
      expect(result).toEqual({ sku: 'TEE-S', outcome: 'created', externalId: '1400', message: null })
      expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/sell/inventory/v1/offer'))).toBe(false)
    })
  })

  describe('orders', () => {
    const ORDER = {
      orderId: '12-34567-89012',
      creationDate: '2026-10-06T10:00:00.000Z',
      lastModifiedDate: '2026-10-06T11:00:00.000Z',
      orderFulfillmentStatus: 'NOT_STARTED',
      orderPaymentStatus: 'PAID',
      cancelStatus: { cancelState: 'NONE_REQUESTED' },
      buyer: { username: 'buyer_1' },
      pricingSummary: {
        priceSubtotal: { value: '30.00', currency: 'USD' },
        priceDiscount: { value: '-3.00', currency: 'USD' },
        deliveryCost: { value: '4.95', currency: 'USD' },
        tax: { value: '1.00', currency: 'USD' },
        total: { value: '34.18', currency: 'USD' },
      },
      totalMarketplaceFee: { value: '4.07', currency: 'USD' },
      lineItems: [
        {
          lineItemId: '10001',
          sku: 'TEE-S',
          title: 'Cotton tee',
          quantity: 2,
          lineItemCost: { value: '30.00', currency: 'USD' },
          ebayCollectAndRemitTaxes: [{ taxType: 'STATE_SALES_TAX', amount: { value: '2.23', currency: 'USD' } }],
        },
      ],
      fulfillmentStartInstructions: [
        {
          shippingStep: {
            shipTo: {
              fullName: 'Ann Lee',
              contactAddress: { addressLine1: '2 B St', addressLine2: 'Apt 4', city: 'Boston', stateOrProvince: 'MA', postalCode: '02108', countryCode: 'us' },
              primaryPhone: { phoneNumber: '6175550100' },
            },
          },
        },
      ],
    }

    it('reads an order: lines, money in minor units, fees and the address', () => {
      expect(readEbayOrder(ORDER, false)).toEqual({
        externalId: '12-34567-89012',
        displayRef: '12-34567-89012',
        state: 'unshipped',
        fulfilledByMarketplace: false,
        placedAtMs: Date.parse('2026-10-06T10:00:00.000Z'),
        updatedAtMs: Date.parse('2026-10-06T11:00:00.000Z'),
        currency: 'USD',
        lines: [{ externalLineId: '10001', sku: 'TEE-S', title: 'Cotton tee', quantity: 2, unitPriceMinor: 1_500 }],
        shippingMinor: 495,
        taxMinor: 223,
        discountMinor: 300,
        totalMinor: 3_418,
        fees: [{ label: 'eBay fees', amountMinor: 407 }],
        buyerName: 'Ann Lee',
        shipTo: { name: 'Ann Lee', line1: '2 B St', line2: 'Apt 4', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US', phone: '6175550100' },
        testMode: false,
      })
    })

    it('reads states from payment, fulfillment and cancellation', () => {
      expect(ebayOrderState({ orderPaymentStatus: 'PENDING', orderFulfillmentStatus: 'NOT_STARTED' })).toBe('pending')
      expect(ebayOrderState({ orderPaymentStatus: 'PAID', orderFulfillmentStatus: 'IN_PROGRESS' })).toBe('shipped')
      expect(ebayOrderState({ orderPaymentStatus: 'PAID', orderFulfillmentStatus: 'FULFILLED' })).toBe('shipped')
      expect(ebayOrderState({ orderPaymentStatus: 'PAID', cancelStatus: { cancelState: 'CANCELED' } })).toBe('canceled')
      expect(ebayOrderState({ orderPaymentStatus: 'FULLY_REFUNDED' })).toBe('canceled')
      expect(readEbayOrder({ ...ORDER, totalMarketplaceFee: undefined, lineItems: [] }, true)).toMatchObject({
        fees: null,
        taxMinor: 100,
        testMode: true,
      })
    })

    it('pages by offset, filtered by last change, with the tax breakdown', async () => {
      const { http, calls } = mockHttp([
        { match: 'offset=0', body: { orders: [ORDER, ORDER], total: 3, limit: 200, offset: 0 } },
        { match: 'offset=2', body: { orders: [ORDER], total: 3, limit: 200, offset: 2 } },
      ])
      const provider = createEbayProvider({ http })
      const sinceMs = Date.UTC(2026, 9, 1)
      const first = await provider.listOrders(APP, CREDENTIAL, { sinceMs, cursor: null })
      expect(first.orders).toHaveLength(2)
      expect(first.nextCursor).toBe('2')
      const url = new URL(calls[0].url)
      expect(url.origin + url.pathname).toBe('https://api.ebay.com/sell/fulfillment/v1/order')
      expect(url.searchParams.get('filter')).toBe('lastmodifieddate:[2026-10-01T00:00:00.000Z..]')
      expect(url.searchParams.get('limit')).toBe('200')
      expect(url.searchParams.get('fieldGroups')).toBe('TAX_BREAKDOWN')
      const second = await provider.listOrders(APP, CREDENTIAL, { sinceMs, cursor: first.nextCursor })
      expect(second.nextCursor).toBeNull()
    })
  })

  describe('shipments', () => {
    const CONFIRMATION = {
      externalOrderId: '12-34567-89012',
      lines: [{ externalLineId: '10001', quantity: 2 }],
      carrier: 'FedEx',
      trackingNumber: '7712 ',
      trackingUrl: null,
      shippedAtMs: Date.UTC(2026, 9, 7, 15),
      reference: 'ship-1',
    }

    it('creates a shipping fulfillment with eBay’s carrier code', async () => {
      const { http, calls } = mockHttp([
        { method: 'GET', match: '/order/12-34567-89012/shipping_fulfillment', body: { fulfillments: [], total: 0 } },
        { method: 'POST', match: '/order/12-34567-89012/shipping_fulfillment', status: 201, body: {} },
      ])
      expect(await createEbayProvider({ http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('confirmed')
      expect(sentJson(calls[1])).toEqual({
        lineItems: [{ lineItemId: '10001', quantity: 2 }],
        shippedDate: '2026-10-07T15:00:00.000Z',
        shippingCarrierCode: 'FedEx',
        trackingNumber: '7712',
      })
    })

    it('answers already for a tracking number eBay has, or a refusal saying so', async () => {
      const held = mockHttp([
        { method: 'GET', match: 'shipping_fulfillment', body: { fulfillments: [{ fulfillmentId: 'f1', shipmentTrackingNumber: '7712' }] } },
      ])
      expect(await createEbayProvider({ http: held.http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('already')
      expect(held.calls).toHaveLength(1)

      const refused = mockHttp([
        { method: 'GET', match: 'shipping_fulfillment', body: { fulfillments: [] } },
        { method: 'POST', match: 'shipping_fulfillment', status: 409, body: { errors: [{ message: 'The order has already been fulfilled.' }] } },
      ])
      expect(await createEbayProvider({ http: refused.http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)).toBe('already')
    })

    it('maps carriers to eBay’s codes, Other for the rest', () => {
      expect(ebayCarrier('UPS')).toBe('UPS')
      expect(ebayCarrier('usps')).toBe('USPS')
      expect(ebayCarrier('Royal Mail')).toBe('RoyalMail')
      expect(ebayCarrier('DHL eCommerce')).toBe('DHLGlobalMail')
      expect(ebayCarrier('Bob’s Couriers')).toBe('Other')
      expect(ebayCarrier(null)).toBe('Other')
    })
  })
})
