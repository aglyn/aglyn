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
  amazonCarrier,
  amazonOrderState,
  amazonPackageReference,
  createAmazonProvider,
  readAmazonFees,
  readAmazonOrder,
} from './amazon'
import { ProviderError } from './http'
import type {
  ListingPush,
  MarketplaceApp,
  MarketplaceCredential,
} from './provider'

const APP: MarketplaceApp = {
  clientId: 'amzn1.application-oa2-client.abc',
  clientSecret: 'lwa-secret',
  sandbox: false,
  extra: { applicationId: 'amzn1.sp.solution.123', region: 'na' },
}

const CREDENTIAL: MarketplaceCredential = {
  accessToken: 'Atza|access',
  account: { sellerId: 'A1SELLER', marketplaceId: 'ATVPDKIKX0DER' },
}

const PUSH: ListingPush = {
  offerId: 'p1',
  sku: 'TEE-S',
  groupId: 'p1',
  title: 'Tee',
  description: 'A tee',
  priceMinor: 1999,
  currency: 'USD',
  quantity: 7,
  imageUrls: [],
  productUrl: null,
  options: {},
}

const ORDER = {
  orderId: '113-1234567-1234567',
  createdTime: '2026-10-07T10:00:00Z',
  lastUpdatedTime: '2026-10-07T11:00:00Z',
  salesChannel: { marketplaceId: 'ATVPDKIKX0DER' },
  buyer: { buyerName: 'Ann Lee' },
  recipient: {
    deliveryAddress: {
      name: 'Ann Lee',
      addressLine1: '2 B St',
      addressLine2: 'Apt 4',
      city: 'Boston',
      stateOrRegion: 'MA',
      postalCode: '02108',
      countryCode: 'us',
      phone: '555-0100',
    },
  },
  proceeds: { grandTotal: { amount: '47.07', currencyCode: 'USD' } },
  fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'MERCHANT' },
  orderItems: [
    {
      orderItemId: '111',
      quantityOrdered: 2,
      product: {
        sellerSku: 'TEE-S',
        title: 'Tee — S',
        price: { unitPrice: { amount: '15.00', currencyCode: 'USD' } },
      },
      proceeds: {
        proceedsTotal: { amount: '35.07', currencyCode: 'USD' },
        breakdowns: [
          { type: 'ITEM', subtotal: { amount: '30.00', currencyCode: 'USD' } },
          {
            type: 'SHIPPING',
            subtotal: { amount: '4.99', currencyCode: 'USD' },
          },
          { type: 'TAX', subtotal: { amount: '2.08', currencyCode: 'USD' } },
          {
            type: 'DISCOUNT',
            subtotal: { amount: '-2.00', currencyCode: 'USD' },
          },
        ],
      },
    },
    {
      orderItemId: '112',
      quantityOrdered: 1,
      product: { sellerSku: 'MUG', title: 'Mug' },
      proceeds: {
        proceedsTotal: { amount: '12.00', currencyCode: 'USD' },
        breakdowns: [
          { type: 'ITEM', subtotal: { amount: '12.00', currencyCode: 'USD' } },
        ],
      },
    },
  ],
}

describe('Amazon marketplace (AGL-3638)', () => {
  describe('connecting', () => {
    it('sends the seller to Seller Central’s consent page for the region, as a draft when asked', () => {
      const provider = createAmazonProvider({ http: mockHttp([]).http })
      const input = {
        redirectUri: 'https://console.aglyn.com/cb',
        state: 'c1.nonce',
        codeChallenge: 'ignored',
      }
      const live = new URL(provider.authorizeUrl(APP, input))
      expect(live.origin).toBe('https://sellercentral.amazon.com')
      expect(live.pathname).toBe('/apps/authorize/consent')
      expect(Object.fromEntries(live.searchParams)).toEqual({
        application_id: 'amzn1.sp.solution.123',
        state: 'c1.nonce',
        redirect_uri: 'https://console.aglyn.com/cb',
      })
      const draft = new URL(
        provider.authorizeUrl(
          { ...APP, extra: { ...APP.extra, region: 'eu', draft: 'true' } },
          input,
        ),
      )
      expect(draft.origin).toBe('https://sellercentral-europe.amazon.com')
      expect(draft.searchParams.get('version')).toBe('beta')
      expect(draft.searchParams.has('code_challenge')).toBe(false)
    })

    it('trades the code with Login with Amazon and keeps the selling partner id', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'https://api.amazon.com/auth/o2/token',
          body: {
            access_token: 'Atza|a',
            refresh_token: 'Atzr|r',
            expires_in: 3600,
            token_type: 'bearer',
          },
        },
      ])
      const grant = await createAmazonProvider({ http }).exchangeCode(APP, {
        code: 'spapi-code',
        redirectUri: 'https://console.aglyn.com/cb',
        codeVerifier: '',
        params: new URLSearchParams({
          spapi_oauth_code: 'spapi-code',
          selling_partner_id: 'A1SELLER',
          state: 's',
        }),
        nowMs: 1_000,
      })
      expect(grant).toEqual({
        accessToken: 'Atza|a',
        refreshToken: 'Atzr|r',
        expiresAtMs: 1_000 + 3_600_000,
        refreshExpiresAtMs: null,
        account: { sellerId: 'A1SELLER' },
      })
      const form = new URLSearchParams(calls[0].body ?? '')
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'authorization_code',
        code: 'spapi-code',
        redirect_uri: 'https://console.aglyn.com/cb',
        client_id: APP.clientId,
        client_secret: 'lwa-secret',
      })
      expect(calls[0].headers['content-type']).toContain(
        'application/x-www-form-urlencoded',
      )
    })

    it('refreshes with the refresh token', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'api.amazon.com/auth/o2/token',
          body: { access_token: 'Atza|b', expires_in: 3600 },
        },
      ])
      const grant = await createAmazonProvider({ http }).refresh(APP, {
        refreshToken: 'Atzr|r',
        nowMs: 5_000,
      })
      expect(grant).toMatchObject({
        accessToken: 'Atza|b',
        refreshToken: null,
        expiresAtMs: 3_605_000,
      })
      expect(new URLSearchParams(calls[0].body ?? '').get('grant_type')).toBe(
        'refresh_token',
      )
      expect(
        new URLSearchParams(calls[0].body ?? '').get('refresh_token'),
      ).toBe('Atzr|r')
    })

    it('reads the store name and the marketplaces the seller takes part in', async () => {
      const { http, calls } = mockHttp([
        {
          match:
            'sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations',
          body: {
            payload: [
              {
                marketplace: {
                  id: 'ATVPDKIKX0DER',
                  name: 'Amazon.com',
                  defaultCurrencyCode: 'USD',
                },
                participation: { isParticipating: true },
                storeName: 'Lee Goods',
              },
              {
                marketplace: {
                  id: 'A2EUQ1WTGCTBG2',
                  name: 'Amazon.ca',
                  defaultCurrencyCode: 'CAD',
                },
                participation: { isParticipating: false },
              },
              {
                marketplace: {
                  id: 'A1AM78C64UM0Y8',
                  name: 'Amazon.com.mx',
                  defaultCurrencyCode: 'MXN',
                },
                participation: { isParticipating: true },
              },
              {
                marketplace: {
                  id: 'A2ZV50J4W1RKNI',
                  name: 'Non-Amazon',
                  defaultCurrencyCode: 'USD',
                },
                participation: { isParticipating: true },
              },
            ],
          },
        },
      ])
      const account = await createAmazonProvider({ http }).account(APP, {
        accessToken: 'Atza|a',
        account: { sellerId: 'A1SELLER' },
      })
      expect(account).toEqual({
        accountName: 'Lee Goods',
        account: { marketplaceId: 'ATVPDKIKX0DER' },
        sites: [
          { id: 'ATVPDKIKX0DER', name: 'Amazon.com', currency: 'USD' },
          { id: 'A1AM78C64UM0Y8', name: 'Amazon.com.mx', currency: 'MXN' },
        ],
      })
      expect(calls[0].headers['x-amz-access-token']).toBe('Atza|a')
    })

    it('uses the sandbox host for a sandbox app', async () => {
      const { http, calls } = mockHttp([
        {
          match: 'sandbox.sellingpartnerapi-fe.amazon.com',
          body: { payload: [] },
        },
      ])
      await createAmazonProvider({ http }).account(
        { ...APP, sandbox: true, extra: { region: 'fe' } },
        CREDENTIAL,
      )
      expect(calls[0].url).toContain(
        'https://sandbox.sellingpartnerapi-fe.amazon.com/sellers/v1/',
      )
    })
  })

  describe('listings', () => {
    const itemUrl = /\/listings\/2021-08-01\/items\/A1SELLER\/TEE-S\?/

    it('patches quantity on the listing’s own product type, and price only when asked', async () => {
      const { http, calls, waits } = mockHttp([
        {
          method: 'GET',
          match: itemUrl,
          body: {
            sku: 'TEE-S',
            summaries: [
              {
                marketplaceId: 'ATVPDKIKX0DER',
                asin: 'B0TEE',
                productType: 'SHIRT',
              },
            ],
          },
        },
        {
          method: 'PATCH',
          match: itemUrl,
          body: {
            sku: 'TEE-S',
            status: 'ACCEPTED',
            submissionId: 's1',
            issues: [],
          },
        },
      ])
      const provider = createAmazonProvider({ http })
      const [result] = await provider.syncListings(APP, CREDENTIAL, [PUSH], {
        publish: false,
        prices: false,
      })
      expect(result).toEqual({
        sku: 'TEE-S',
        outcome: 'updated',
        externalId: 'B0TEE',
      })
      const get = new URL(calls[0].url)
      expect(get.searchParams.get('marketplaceIds')).toBe('ATVPDKIKX0DER')
      expect(get.searchParams.get('includedData')).toBe('summaries')
      expect(sentJson(calls[1])).toEqual({
        productType: 'SHIRT',
        patches: [
          {
            op: 'replace',
            path: '/attributes/fulfillment_availability',
            value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 7 }],
          },
        ],
      })
      expect(waits).toEqual([200])

      const priced = mockHttp([
        {
          method: 'GET',
          match: itemUrl,
          body: {
            summaries: [
              { marketplaceId: 'ATVPDKIKX0DER', productType: 'SHIRT' },
            ],
          },
        },
        { method: 'PATCH', match: itemUrl, body: { status: 'ACCEPTED' } },
      ])
      await createAmazonProvider({ http: priced.http }).syncListings(
        APP,
        CREDENTIAL,
        [PUSH],
        { publish: false, prices: true },
      )
      expect(sentJson(priced.calls[1]).patches[1]).toEqual({
        op: 'merge',
        path: '/attributes/purchasable_offer',
        value: [
          {
            currency: 'USD',
            audience: 'ALL',
            marketplace_id: 'ATVPDKIKX0DER',
            our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
          },
        ],
      })
    })

    it('says not listed for a SKU Amazon has no listing for, and publishes nothing without a GTIN', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'GET',
          match: itemUrl,
          status: 404,
          body: { errors: [{ message: 'Not found' }] },
        },
      ])
      const provider = createAmazonProvider({ http })
      expect(
        await provider.syncListings(APP, CREDENTIAL, [PUSH], {
          publish: false,
          prices: false,
        }),
      ).toEqual([{ sku: 'TEE-S', outcome: 'not_listed', message: null }])
      const [noGtin] = await provider.syncListings(APP, CREDENTIAL, [PUSH], {
        publish: true,
        prices: false,
      })
      expect(noGtin.outcome).toBe('not_listed')
      expect(noGtin.message).toMatch(/GTIN/)
      expect(calls.every((call) => call.method === 'GET')).toBe(true)
    })

    it('publishes an offer-only listing matched by GTIN', async () => {
      const { http, calls } = mockHttp([
        { method: 'GET', match: itemUrl, status: 404, body: {} },
        {
          method: 'PUT',
          match: itemUrl,
          body: {
            sku: 'TEE-S',
            status: 'ACCEPTED',
            identifiers: [{ marketplaceId: 'ATVPDKIKX0DER', asin: 'B0NEW' }],
            issues: [],
          },
        },
      ])
      const [result] = await createAmazonProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [{ ...PUSH, gtin: '012345678905', condition: 'new' }],
        { publish: true, prices: false },
      )
      expect(result).toEqual({
        sku: 'TEE-S',
        outcome: 'created',
        externalId: 'B0NEW',
      })
      expect(new URL(calls[1].url).searchParams.get('includedData')).toBe(
        'identifiers,issues',
      )
      expect(sentJson(calls[1])).toEqual({
        productType: 'PRODUCT',
        requirements: 'LISTING_OFFER_ONLY',
        attributes: {
          condition_type: [
            { value: 'new_new', marketplace_id: 'ATVPDKIKX0DER' },
          ],
          externally_assigned_product_identifier: [
            {
              type: 'upc',
              value: '012345678905',
              marketplace_id: 'ATVPDKIKX0DER',
            },
          ],
          purchasable_offer: [
            {
              currency: 'USD',
              audience: 'ALL',
              marketplace_id: 'ATVPDKIKX0DER',
              our_price: [{ schedule: [{ value_with_tax: 19.99 }] }],
            },
          ],
          fulfillment_availability: [
            { fulfillment_channel_code: 'DEFAULT', quantity: 7 },
          ],
        },
      })
    })

    it('reports a listing Amazon accepted with an error issue as failed, in Amazon’s words', async () => {
      const { http } = mockHttp([
        {
          method: 'GET',
          match: itemUrl,
          body: {
            summaries: [
              { marketplaceId: 'ATVPDKIKX0DER', productType: 'SHIRT' },
            ],
          },
        },
        {
          method: 'PATCH',
          match: itemUrl,
          body: {
            status: 'ACCEPTED',
            issues: [
              { code: '1', message: 'A warning', severity: 'WARNING' },
              {
                code: '90220',
                message: 'The price is outside the allowed range',
                severity: 'ERROR',
              },
            ],
          },
        },
      ])
      const [result] = await createAmazonProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [PUSH],
        { publish: false, prices: true },
      )
      expect(result).toEqual({
        sku: 'TEE-S',
        outcome: 'failed',
        message: 'The price is outside the allowed range',
      })
    })

    it('reports a 400 for one SKU as failed and keeps going', async () => {
      const { http } = mockHttp([
        {
          method: 'GET',
          match: /items\/A1SELLER\/BAD\?/,
          status: 400,
          body: { errors: [{ message: 'Invalid SKU' }] },
        },
        {
          method: 'GET',
          match: itemUrl,
          body: { summaries: [{ productType: 'SHIRT' }] },
        },
        { method: 'PATCH', match: itemUrl, body: { status: 'ACCEPTED' } },
      ])
      const results = await createAmazonProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [{ ...PUSH, sku: 'BAD' }, PUSH],
        {
          publish: false,
          prices: false,
        },
      )
      expect(results.map((result) => result.outcome)).toEqual([
        'failed',
        'updated',
      ])
      expect(results[0].message).toBe('Invalid SKU')
    })

    it('stops the run on a refused credential', async () => {
      const { http } = mockHttp([
        {
          match: itemUrl,
          status: 401,
          body: { errors: [{ message: 'Unauthorized' }] },
        },
      ])
      await expect(
        createAmazonProvider({ http }).syncListings(APP, CREDENTIAL, [PUSH], {
          publish: false,
          prices: false,
        }),
      ).rejects.toMatchObject({ kind: 'auth' })
    })

    it('waits out a short rate limit in the call', async () => {
      const { http, calls, waits } = mockHttp([
        {
          method: 'GET',
          match: itemUrl,
          status: 429,
          headers: { 'Retry-After': '1' },
          body: {},
          times: 1,
        },
        {
          method: 'GET',
          match: itemUrl,
          body: { summaries: [{ productType: 'SHIRT' }] },
        },
        { method: 'PATCH', match: itemUrl, body: { status: 'ACCEPTED' } },
      ])
      const [result] = await createAmazonProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [PUSH],
        { publish: false, prices: false },
      )
      expect(result.outcome).toBe('updated')
      expect(calls).toHaveLength(3)
      expect(waits).toEqual([1000, 200])
    })
  })

  describe('orders', () => {
    it('reads states the way the engine needs them', () => {
      expect(amazonOrderState('PENDING')).toBe('pending')
      expect(amazonOrderState('PENDING_AVAILABILITY')).toBe('pending')
      expect(amazonOrderState('UNSHIPPED')).toBe('unshipped')
      expect(amazonOrderState('PARTIALLY_SHIPPED')).toBe('unshipped')
      expect(amazonOrderState('SHIPPED')).toBe('shipped')
      expect(amazonOrderState('INVOICE_UNCONFIRMED')).toBe('shipped')
      expect(amazonOrderState('CANCELLED')).toBe('canceled')
      expect(amazonOrderState('UNFULFILLABLE')).toBe('canceled')
    })

    it('reads an order’s lines, money in minor units, buyer and address', () => {
      expect(readAmazonOrder(ORDER)).toEqual({
        externalId: '113-1234567-1234567',
        displayRef: '113-1234567-1234567',
        state: 'unshipped',
        fulfilledByMarketplace: false,
        placedAtMs: Date.parse('2026-10-07T10:00:00Z'),
        updatedAtMs: Date.parse('2026-10-07T11:00:00Z'),
        currency: 'USD',
        lines: [
          {
            externalLineId: '111',
            sku: 'TEE-S',
            title: 'Tee — S',
            quantity: 2,
            unitPriceMinor: 1500,
          },
          {
            externalLineId: '112',
            sku: 'MUG',
            title: 'Mug',
            quantity: 1,
            unitPriceMinor: 1200,
          },
        ],
        shippingMinor: 499,
        taxMinor: 208,
        discountMinor: 200,
        totalMinor: 4707,
        fees: null,
        buyerName: 'Ann Lee',
        shipTo: {
          name: 'Ann Lee',
          line1: '2 B St',
          line2: 'Apt 4',
          city: 'Boston',
          state: 'MA',
          postalCode: '02108',
          country: 'US',
          phone: '555-0100',
        },
      })
    })

    it('marks an FBA order as Amazon’s to ship', () => {
      const order = readAmazonOrder({
        ...ORDER,
        fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' },
      })
      expect(order.fulfilledByMarketplace).toBe(true)
      expect(order.state).toBe('shipped')
    })

    it('asks for one page with the buyer, address and money, and hands back the pagination token', async () => {
      const { http, calls } = mockHttp([
        {
          match: '/orders/2026-01-01/orders?',
          body: { orders: [ORDER], pagination: { nextToken: 'tok-2' } },
        },
      ])
      const page = await createAmazonProvider({ http }).listOrders(
        { ...APP, sandbox: true },
        CREDENTIAL,
        {
          sinceMs: Date.parse('2026-10-01T00:00:00Z'),
          cursor: 'tok-1',
        },
      )
      expect(page.nextCursor).toBe('tok-2')
      expect(page.orders[0].testMode).toBe(true)
      const url = new URL(calls[0].url)
      expect(url.origin).toBe('https://sandbox.sellingpartnerapi-na.amazon.com')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        marketplaceIds: 'ATVPDKIKX0DER',
        lastUpdatedAfter: '2026-10-01T00:00:00.000Z',
        includedData: 'BUYER,RECIPIENT,PROCEEDS,FULFILLMENT',
        maxResultsPerPage: '100',
        paginationToken: 'tok-1',
      })
    })

    it('reads orders without who and where when the app lacks the PII roles', async () => {
      const { http, calls } = mockHttp([
        {
          match: /includedData=BUYER/,
          status: 403,
          body: {
            errors: [{ message: 'Access to requested resource is denied.' }],
          },
        },
        {
          match: /includedData=PROCEEDS/,
          body: {
            orders: [{ ...ORDER, buyer: undefined, recipient: undefined }],
          },
        },
      ])
      const page = await createAmazonProvider({ http }).listOrders(
        APP,
        CREDENTIAL,
        { sinceMs: 0, cursor: null },
      )
      expect(calls).toHaveLength(2)
      expect(page.orders[0]).toMatchObject({
        buyerName: null,
        shipTo: null,
        totalMinor: 4707,
      })
      expect(page.nextCursor).toBeNull()
    })

    it('reads the fees from the order’s financial events, as positive amounts by type', async () => {
      const { http, calls } = mockHttp([
        {
          match: /financialEvents\?MaxResultsPerPage=100&NextToken=n2/,
          body: {
            payload: {
              FinancialEvents: {
                ShipmentEventList: [
                  {
                    ShipmentItemList: [
                      {
                        ItemFeeList: [
                          {
                            FeeType: 'Commission',
                            FeeAmount: {
                              CurrencyCode: 'USD',
                              CurrencyAmount: -1.8,
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          match: '/finances/v0/orders/113-1234567-1234567/financialEvents',
          body: {
            payload: {
              NextToken: 'n2',
              FinancialEvents: {
                ShipmentEventList: [
                  {
                    ShipmentItemList: [
                      {
                        ItemFeeList: [
                          {
                            FeeType: 'Commission',
                            FeeAmount: {
                              CurrencyCode: 'USD',
                              CurrencyAmount: -4.5,
                            },
                          },
                          {
                            FeeType: 'FixedClosingFee',
                            FeeAmount: {
                              CurrencyCode: 'USD',
                              CurrencyAmount: 0,
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ])
      const provider = createAmazonProvider({ http })
      expect(
        await provider.orderFees?.(APP, CREDENTIAL, '113-1234567-1234567'),
      ).toEqual([{ label: 'Commission', amountMinor: 630 }])
      expect(calls).toHaveLength(2)
      expect(readAmazonFees([{ ShipmentEventList: [] }])).toBeNull()
    })
  })

  describe('shipments', () => {
    const CONFIRMATION = {
      externalOrderId: '113-1234567-1234567',
      lines: [{ externalLineId: '111', quantity: 2 }],
      carrier: 'fedex',
      trackingNumber: '7712',
      trackingUrl: null,
      shippedAtMs: Date.parse('2026-10-08T15:00:00Z'),
      reference: 'ful_abc',
    }

    it('maps carriers to Amazon’s codes, else Other with the name', () => {
      expect(amazonCarrier('UPS')).toEqual({ carrierCode: 'UPS' })
      expect(amazonCarrier('Canada_Post')).toEqual({
        carrierCode: 'Canada Post',
      })
      expect(amazonCarrier('Pony Express')).toEqual({
        carrierCode: 'Other',
        carrierName: 'Pony Express',
      })
      expect(amazonCarrier(null)).toEqual({
        carrierCode: 'Other',
        carrierName: 'Other',
      })
    })

    it('confirms the package once, by a numeric reference stable per shipment', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: '/orders/v0/orders/113-1234567-1234567/shipmentConfirmation',
          status: 204,
        },
      ])
      expect(
        await createAmazonProvider({ http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).toBe('confirmed')
      const body = sentJson(calls[0])
      expect(body).toEqual({
        marketplaceId: 'ATVPDKIKX0DER',
        packageDetail: {
          packageReferenceId: amazonPackageReference('ful_abc'),
          carrierCode: 'FedEx',
          trackingNumber: '7712',
          shipDate: '2026-10-08T15:00:00.000Z',
          orderItems: [{ orderItemId: '111', quantity: 2 }],
        },
      })
      expect(body.packageDetail.packageReferenceId).toMatch(/^[1-9]\d*$/)
      expect(amazonPackageReference('ful_abc')).toBe(
        body.packageDetail.packageReferenceId,
      )
    })

    it('sends no shipping cost: Amazon’s shipment confirmation has no field for one (AGL-3693)', async () => {
      const routes = [
        { method: 'POST', match: '/orders/v0/orders/113-1234567-1234567/shipmentConfirmation', status: 204 },
      ]
      const without = mockHttp(routes)
      const withCost = mockHttp(routes)
      await createAmazonProvider({ http: without.http }).confirmShipment(APP, CREDENTIAL, CONFIRMATION)
      await createAmazonProvider({ http: withCost.http }).confirmShipment(APP, CREDENTIAL, {
        ...CONFIRMATION,
        shippingCostMinor: 845,
      })
      expect(sentJson(withCost.calls[0])).toEqual(sentJson(without.calls[0]))
    })

    it('answers already for a shipment Amazon has, and never retries the write', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'shipmentConfirmation',
          status: 400,
          body: {
            errors: [{ message: 'The order has already been shipped.' }],
          },
        },
      ])
      expect(
        await createAmazonProvider({ http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).toBe('already')

      const failing = mockHttp([
        {
          method: 'POST',
          match: 'shipmentConfirmation',
          status: 503,
          body: {},
        },
      ])
      await expect(
        createAmazonProvider({ http: failing.http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).rejects.toBeInstanceOf(ProviderError)
      expect(failing.calls).toHaveLength(1)
      expect(calls).toHaveLength(1)
    })

    it('rethrows any other refusal', async () => {
      const { http } = mockHttp([
        {
          method: 'POST',
          match: 'shipmentConfirmation',
          status: 400,
          body: { errors: [{ message: 'Invalid carrier' }] },
        },
      ])
      await expect(
        createAmazonProvider({ http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).rejects.toMatchObject({
        kind: 'invalid',
        message: 'Invalid carrier',
      })
    })
  })
})
