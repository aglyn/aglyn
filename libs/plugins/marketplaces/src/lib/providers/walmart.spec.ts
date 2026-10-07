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
import type {
  ListingPush,
  MarketplaceApp,
  MarketplaceCredential,
  ShipmentConfirmation,
} from './provider'
import {
  createWalmartProvider,
  readWalmartOrder,
  walmartCarrier,
  walmartOrderState,
} from './walmart'

const APP: MarketplaceApp = {
  clientId: 'wm-client',
  clientSecret: 'wm-secret',
  sandbox: false,
  extra: {},
}

const CREDENTIAL: MarketplaceCredential = {
  accessToken: 'wm-access',
  account: { sellerId: '101' },
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

const charge = (chargeType: string, amount: number, tax?: number) => ({
  chargeType,
  chargeName: chargeType,
  chargeAmount: { currency: 'USD', amount },
  ...(tax === undefined
    ? {}
    : {
        tax: { taxName: 'Tax1', taxAmount: { currency: 'USD', amount: tax } },
      }),
})

const ORDER = {
  purchaseOrderId: '1796277083022',
  customerOrderId: '5281956426648',
  orderDate: 1_791_000_000_000,
  shippingInfo: {
    phone: '6175550100',
    methodCode: 'Standard',
    postalAddress: {
      name: 'Ann Lee',
      address1: '2 B St',
      address2: 'Apt 4',
      city: 'Boston',
      state: 'MA',
      postalCode: '02108',
      country: 'USA',
      addressType: 'RESIDENTIAL',
    },
  },
  orderLines: {
    orderLine: [
      {
        lineNumber: '1',
        item: { productName: 'Tee — S', sku: 'TEE-S' },
        charges: {
          charge: [charge('PRODUCT', 30, 2.1), charge('SHIPPING', 4.99, 0.35)],
        },
        orderLineQuantity: { unitOfMeasurement: 'EACH', amount: '2' },
        statusDate: 1_791_000_500_000,
        orderLineStatuses: {
          orderLineStatus: [
            {
              status: 'Created',
              statusQuantity: { unitOfMeasurement: 'EACH', amount: '2' },
            },
          ],
        },
      },
      {
        lineNumber: '2',
        item: { productName: 'Mug', sku: 'MUG' },
        charges: { charge: [charge('PRODUCT', 12, 0.84)] },
        orderLineQuantity: { unitOfMeasurement: 'EACH', amount: '1' },
        orderLineStatuses: { orderLineStatus: [{ status: 'Acknowledged' }] },
      },
    ],
  },
  shipNode: { type: 'SellerFulfilled' },
}

describe('Walmart marketplace (AGL-3638)', () => {
  describe('connecting', () => {
    it('sends the seller to Walmart’s Solution Provider consent page', () => {
      const url = new URL(
        createWalmartProvider({ http: mockHttp([]).http }).authorizeUrl(APP, {
          redirectUri: 'https://console.aglyn.com/cb',
          state: 'c1.nonce',
          codeChallenge: 'ignored',
        }),
      )
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://login.account.wal-mart.com/authorize',
      )
      expect(url.searchParams.get('responseType')).toBe('code')
      expect(url.searchParams.get('clientId')).toBe('wm-client')
      expect(url.searchParams.get('redirectUri')).toBe(
        'https://console.aglyn.com/cb',
      )
      expect(url.searchParams.get('clientType')).toBe('seller')
      expect(url.searchParams.get('state')).toBe('c1.nonce')
      expect(url.searchParams.get('nonce')).toMatch(/^[0-9a-f]{16}$/)
    })

    it('trades the code with Basic auth and the seller id, and keeps the seller id', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'https://marketplace.walmartapis.com/v3/token',
          body: {
            access_token: 'wm-a',
            refresh_token: 'wm-r',
            token_type: 'Bearer',
            expires_in: 900,
          },
        },
      ])
      const grant = await createWalmartProvider({ http }).exchangeCode(
        { ...APP, extra: { channelType: 'chan-1' } },
        {
          code: 'wm-code',
          redirectUri: 'https://console.aglyn.com/cb',
          codeVerifier: '',
          params: new URLSearchParams({
            code: 'wm-code',
            state: 's',
            sellerId: '101',
            type: 'auth',
          }),
          nowMs: 1_000,
        },
      )
      expect(grant).toEqual({
        accessToken: 'wm-a',
        refreshToken: 'wm-r',
        expiresAtMs: 901_000,
        refreshExpiresAtMs: 1_000 + 365 * 24 * 60 * 60 * 1000,
        account: { sellerId: '101' },
      })
      const headers = calls[0].headers
      expect(headers['authorization']).toBe(
        `Basic ${Buffer.from('wm-client:wm-secret').toString('base64')}`,
      )
      expect(headers['wm_partner.id']).toBe('101')
      expect(headers['wm_svc.name']).toBe('Walmart Marketplace')
      expect(headers['wm_qos.correlation_id']).toMatch(/^[0-9a-f-]{36}$/)
      expect(headers['wm_consumer.channel.type']).toBe('chan-1')
      expect(headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(
        Object.fromEntries(new URLSearchParams(calls[0].body ?? '')),
      ).toEqual({
        grant_type: 'authorization_code',
        code: 'wm-code',
        redirect_uri: 'https://console.aglyn.com/cb',
      })
    })

    it('refreshes against the sandbox host for a sandbox app; the refresh token held keeps working', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: 'https://sandbox.walmartapis.com/v3/token',
          body: { access_token: 'wm-b', expires_in: 900 },
        },
      ])
      const grant = await createWalmartProvider({ http }).refresh(
        { ...APP, sandbox: true },
        { refreshToken: 'wm-r', nowMs: 0 },
      )
      expect(grant).toEqual({
        accessToken: 'wm-b',
        refreshToken: null,
        expiresAtMs: 900_000,
      })
      expect(
        Object.fromEntries(new URLSearchParams(calls[0].body ?? '')),
      ).toEqual({
        grant_type: 'refresh_token',
        refresh_token: 'wm-r',
      })
      expect(calls[0].headers['wm_partner.id']).toBeUndefined()
    })

    it('names the account from the partner profile', async () => {
      const { http, calls } = mockHttp([
        {
          match: '/v3/settings/partnerprofile',
          body: {
            partner: {
              partnerId: '101',
              partnerName: 'Lee Goods LLC',
              partnerDisplayName: 'Lee Goods',
            },
          },
        },
      ])
      expect(
        await createWalmartProvider({ http }).account(APP, CREDENTIAL),
      ).toEqual({
        accountName: 'Lee Goods',
        account: { sellerId: '101' },
      })
      expect(calls[0].headers['wm_sec.access_token']).toBe('wm-access')
      expect(calls[0].headers['wm_consumer.channel.type']).toBeUndefined()
    })

    it('reads a refused credential as auth', async () => {
      const { http } = mockHttp([
        {
          match: 'partnerprofile',
          status: 401,
          body: { error: [{ code: 'UNAUTHORIZED.GMP_GATEWAY_API' }] },
        },
      ])
      await expect(
        createWalmartProvider({ http }).account(APP, CREDENTIAL),
      ).rejects.toMatchObject({ kind: 'auth' })
    })
  })

  describe('listings', () => {
    it('sends the quantity, and the price only when asked', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'PUT',
          match: '/v3/inventory?sku=TEE-S',
          body: { sku: 'TEE-S', quantity: { unit: 'EACH', amount: 7 } },
        },
        {
          method: 'PUT',
          match: '/v3/price',
          body: { ItemPriceResponse: { sku: 'TEE-S', message: 'Thank you.' } },
        },
      ])
      const provider = createWalmartProvider({ http })
      expect(
        await provider.syncListings(APP, CREDENTIAL, [PUSH], {
          publish: false,
          prices: false,
        }),
      ).toEqual([{ sku: 'TEE-S', outcome: 'updated', externalId: null }])
      expect(calls).toHaveLength(1)
      expect(sentJson(calls[0])).toEqual({
        sku: 'TEE-S',
        quantity: { unit: 'EACH', amount: 7 },
      })

      await provider.syncListings(APP, CREDENTIAL, [PUSH], {
        publish: false,
        prices: true,
      })
      expect(calls).toHaveLength(3)
      expect(sentJson(calls[2])).toEqual({
        sku: 'TEE-S',
        pricing: [
          {
            currentPriceType: 'BASE',
            currentPrice: { currency: 'USD', amount: 19.99 },
          },
        ],
      })
    })

    it('says not listed for a SKU Walmart does not have, and failed in Walmart’s words otherwise', async () => {
      const { http } = mockHttp([
        {
          method: 'PUT',
          match: 'sku=GONE',
          status: 404,
          body: { errors: { error: [{ description: 'Item not found' }] } },
        },
        {
          method: 'PUT',
          match: 'sku=MISSING',
          status: 400,
          body: {
            errors: {
              error: [
                {
                  code: 'CONTENT_NOT_FOUND.GMP_INVENTORY_API',
                  description: 'Item not found for SKU',
                },
              ],
            },
          },
        },
        {
          method: 'PUT',
          match: 'sku=TEE-S',
          status: 400,
          body: {
            errors: {
              error: [
                {
                  code: 'INVALID_REQUEST',
                  description: 'Quantity must be at most 10000',
                },
              ],
            },
          },
        },
      ])
      const results = await createWalmartProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [{ ...PUSH, sku: 'GONE' }, { ...PUSH, sku: 'MISSING' }, PUSH],
        { publish: true, prices: false },
      )
      expect(results).toEqual([
        { sku: 'GONE', outcome: 'not_listed' },
        { sku: 'MISSING', outcome: 'not_listed' },
        {
          sku: 'TEE-S',
          outcome: 'failed',
          message: 'Quantity must be at most 10000',
        },
      ])
    })

    it('waits out a short rate limit in the call', async () => {
      const { http, calls, waits } = mockHttp([
        {
          method: 'PUT',
          match: '/v3/inventory',
          status: 429,
          headers: { 'Retry-After': '2' },
          body: {},
          times: 1,
        },
        { method: 'PUT', match: '/v3/inventory', body: {} },
      ])
      const [result] = await createWalmartProvider({ http }).syncListings(
        APP,
        CREDENTIAL,
        [PUSH],
        { publish: false, prices: false },
      )
      expect(result.outcome).toBe('updated')
      expect(calls).toHaveLength(2)
      expect(waits).toEqual([2000])
    })

    it('stops the run on a long rate limit', async () => {
      const { http } = mockHttp([
        { method: 'PUT', match: '/v3/inventory', status: 429, body: {} },
      ])
      await expect(
        createWalmartProvider({ http }).syncListings(APP, CREDENTIAL, [PUSH], {
          publish: false,
          prices: false,
        }),
      ).rejects.toMatchObject({ kind: 'rate-limit' })
    })
  })

  describe('orders', () => {
    it('reads the state from every line', () => {
      const line = (status: string) => ({
        orderLineStatuses: { orderLineStatus: [{ status }] },
      })
      expect(walmartOrderState([line('Created')])).toBe('unshipped')
      expect(walmartOrderState([line('Acknowledged'), line('Shipped')])).toBe(
        'unshipped',
      )
      expect(walmartOrderState([line('Shipped'), line('Delivered')])).toBe(
        'shipped',
      )
      expect(walmartOrderState([line('Shipped'), line('Cancelled')])).toBe(
        'shipped',
      )
      expect(walmartOrderState([line('Cancelled'), line('Cancelled')])).toBe(
        'canceled',
      )
    })

    it('reads a purchase order’s lines, money in minor units and address', () => {
      expect(readWalmartOrder(ORDER)).toEqual({
        externalId: '1796277083022',
        displayRef: '5281956426648',
        state: 'unshipped',
        fulfilledByMarketplace: false,
        placedAtMs: 1_791_000_000_000,
        updatedAtMs: 1_791_000_500_000,
        currency: 'USD',
        lines: [
          {
            externalLineId: '1',
            sku: 'TEE-S',
            title: 'Tee — S',
            quantity: 2,
            unitPriceMinor: 1500,
          },
          {
            externalLineId: '2',
            sku: 'MUG',
            title: 'Mug',
            quantity: 1,
            unitPriceMinor: 1200,
          },
        ],
        shippingMinor: 499,
        taxMinor: 329,
        discountMinor: 0,
        totalMinor: 3000 + 1200 + 499 + 329,
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
          phone: '6175550100',
        },
      })
    })

    it('marks a WFS order as Walmart’s to ship', () => {
      expect(
        readWalmartOrder({ ...ORDER, shipNode: { type: 'WFSFulfilled' } })
          .fulfilledByMarketplace,
      ).toBe(true)
    })

    it('asks for orders changed since the instant, then follows Walmart’s cursor', async () => {
      const { http, calls } = mockHttp([
        {
          match: /\/v3\/orders\?lastModifiedStartDate=/,
          body: {
            list: {
              meta: {
                totalCount: 2,
                limit: 100,
                nextCursor: '?limit=100&hasMoreElements=true&soIndex=2',
              },
              elements: { order: [ORDER] },
            },
          },
        },
        {
          match: '/v3/orders?limit=100&hasMoreElements=true&soIndex=2',
          body: { list: { meta: { totalCount: 2 }, elements: { order: [] } } },
        },
      ])
      const provider = createWalmartProvider({ http })
      const first = await provider.listOrders(
        { ...APP, sandbox: true },
        CREDENTIAL,
        {
          sinceMs: Date.parse('2026-10-01T00:00:00Z'),
          cursor: null,
        },
      )
      expect(first.nextCursor).toBe('?limit=100&hasMoreElements=true&soIndex=2')
      expect(first.orders).toHaveLength(1)
      expect(first.orders[0].testMode).toBe(true)
      const url = new URL(calls[0].url)
      expect(url.origin).toBe('https://sandbox.walmartapis.com')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        lastModifiedStartDate: '2026-10-01T00:00:00.000Z',
        limit: '100',
      })

      const second = await provider.listOrders(APP, CREDENTIAL, {
        sinceMs: 0,
        cursor: first.nextCursor,
      })
      expect(second).toEqual({ orders: [], nextCursor: null })
      expect(calls[1].url).toBe(
        'https://marketplace.walmartapis.com/v3/orders?limit=100&hasMoreElements=true&soIndex=2',
      )
    })
  })

  describe('acknowledging and shipping', () => {
    const order = readWalmartOrder(ORDER)

    it('acknowledges once, and takes an already acknowledged answer as done', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: '/v3/orders/1796277083022/acknowledge',
          body: { order: {} },
        },
      ])
      await createWalmartProvider({ http }).acknowledgeOrder?.(
        APP,
        CREDENTIAL,
        order,
      )
      expect(calls).toHaveLength(1)

      const again = mockHttp([
        {
          method: 'POST',
          match: '/acknowledge',
          status: 400,
          body: {
            errors: {
              error: [{ description: 'Order is already acknowledged' }],
            },
          },
        },
      ])
      await expect(
        createWalmartProvider({ http: again.http }).acknowledgeOrder?.(
          APP,
          CREDENTIAL,
          order,
        ),
      ).resolves.toBeUndefined()

      const down = mockHttp([
        { method: 'POST', match: '/acknowledge', status: 500, body: {} },
      ])
      await expect(
        createWalmartProvider({ http: down.http }).acknowledgeOrder?.(
          APP,
          CREDENTIAL,
          order,
        ),
      ).rejects.toMatchObject({
        kind: 'transient',
      })
      expect(down.calls).toHaveLength(1)
    })

    const CONFIRMATION: ShipmentConfirmation = {
      externalOrderId: '1796277083022',
      lines: [
        { externalLineId: '1', quantity: 2 },
        { externalLineId: '2', quantity: 1 },
      ],
      carrier: 'FedEx',
      trackingNumber: '7712',
      trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=7712',
      shippedAtMs: 1_791_100_000_000,
      reference: 'ful_abc',
    }

    it('maps carriers to Walmart’s names, else otherCarrier', () => {
      expect(walmartCarrier('ups')).toEqual({ carrier: 'UPS' })
      expect(walmartCarrier('Canada-Post')).toEqual({ carrier: 'Canada Post' })
      expect(walmartCarrier('Pony Express')).toEqual({
        otherCarrier: 'Pony Express',
      })
    })

    it('ships each line with its tracking', async () => {
      const { http, calls } = mockHttp([
        {
          method: 'POST',
          match: '/v3/orders/1796277083022/shipping',
          body: { order: {} },
        },
      ])
      expect(
        await createWalmartProvider({ http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).toBe('confirmed')
      const trackingInfo = {
        shipDateTime: 1_791_100_000_000,
        carrierName: { carrier: 'FedEx' },
        methodCode: 'Standard',
        trackingNumber: '7712',
        trackingURL: 'https://www.fedex.com/fedextrack/?trknbr=7712',
      }
      expect(sentJson(calls[0])).toEqual({
        orderShipment: {
          orderLines: {
            orderLine: [
              {
                lineNumber: '1',
                orderLineStatuses: {
                  orderLineStatus: [
                    {
                      status: 'Shipped',
                      statusQuantity: {
                        unitOfMeasurement: 'EACH',
                        amount: '2',
                      },
                      trackingInfo,
                    },
                  ],
                },
              },
              {
                lineNumber: '2',
                orderLineStatuses: {
                  orderLineStatus: [
                    {
                      status: 'Shipped',
                      statusQuantity: {
                        unitOfMeasurement: 'EACH',
                        amount: '1',
                      },
                      trackingInfo,
                    },
                  ],
                },
              },
            ],
          },
        },
      })
    })

    it('answers already for lines Walmart has shipped, and rethrows anything else', async () => {
      const { http } = mockHttp([
        {
          method: 'POST',
          match: '/shipping',
          status: 400,
          body: {
            errors: {
              error: [{ description: 'Order line has already been shipped' }],
            },
          },
        },
      ])
      expect(
        await createWalmartProvider({ http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).toBe('already')

      const refused = mockHttp([
        {
          method: 'POST',
          match: '/shipping',
          status: 400,
          body: {
            errors: { error: [{ description: 'Invalid tracking number' }] },
          },
        },
      ])
      await expect(
        createWalmartProvider({ http: refused.http }).confirmShipment(
          APP,
          CREDENTIAL,
          CONFIRMATION,
        ),
      ).rejects.toMatchObject({
        kind: 'invalid',
        message: 'Invalid tracking number',
      })
    })
  })
})
