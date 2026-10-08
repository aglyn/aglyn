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

import { randomUUID } from 'node:crypto'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  currencyDecimals,
  fromMinor,
  text,
  timeMs,
  toMinor,
  type ListingResult,
  type MarketplaceAddress,
  type MarketplaceApp,
  type MarketplaceCredential,
  type MarketplaceGrant,
  type MarketplaceOrder,
  type MarketplaceOrderLine,
  type MarketplaceOrderState,
  type MarketplaceProvider,
} from './provider'

/**
 * WALMART MARKETPLACE (AGL-3638, US), as a Solution Provider app: the seller
 * signs in at Walmart and authorizes the app, which redirects back with a
 * `code` and the seller's `sellerId`. The Token API trades the code for a
 * 15-minute access token and a refresh token that lasts a year.
 *
 * Every call names the service (`WM_SVC.NAME`), a fresh correlation id and
 * the access token (`WM_SEC.ACCESS_TOKEN`); the channel type Walmart issues
 * a Solution Provider goes along when the deployment has one.
 *
 * - **Listings**: link only. Each SKU's quantity is one inventory call and,
 *   when prices are asked, one price call. The bulk feeds are asynchronous
 *   (a feed id to poll, a report to read back per SKU), which a run that
 *   reports one result per listing cannot wait on; per-SKU calls answer at
 *   once and say which SKU Walmart does not have.
 * - **Orders**: a purchase order is acknowledged before it ships. Its state
 *   is read from its lines' statuses.
 * - **Fees**: a Walmart order does not carry the commission, and no order
 *   API answers it.
 */

export const WALMART_API_HOSTS = {
  live: 'https://marketplace.walmartapis.com',
  sandbox: 'https://sandbox.walmartapis.com',
} as const

/** Walmart's sign-in and consent page for Solution Provider apps. */
export const WALMART_AUTHORIZE_URL =
  'https://login.account.wal-mart.com/authorize'

const SERVICE_NAME = 'Walmart Marketplace'

/** Walmart's refresh tokens last a year. */
const REFRESH_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

/** The carrier names Walmart takes as they are; anything else goes as `otherCarrier`. */
const WALMART_CARRIERS: Readonly<Record<string, string>> = {
  ups: 'UPS',
  usps: 'USPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  ontrac: 'OnTrac',
  lasership: 'LaserShip',
  'canada post': 'Canada Post',
}

const apiBase = (app: MarketplaceApp): string =>
  app.sandbox ? WALMART_API_HOSTS.sandbox : WALMART_API_HOSTS.live

/** Walmart's carrier for the carrier the merchant named. */
export function walmartCarrier(
  carrier: string | null,
): { carrier: string } | { otherCarrier: string } {
  const named = text(carrier)
  const known = named
    ? WALMART_CARRIERS[named.toLowerCase().replace(/[\s_-]+/g, ' ')]
    : undefined
  return known ? { carrier: known } : { otherCarrier: named ?? 'Other' }
}

const statusesOf = (line: any): string[] =>
  (Array.isArray(line?.orderLineStatuses?.orderLineStatus)
    ? line.orderLineStatuses.orderLineStatus
    : []
  )
    .map((entry: any) => String(entry?.status ?? ''))
    .filter(Boolean)

/** A purchase order's state, from every line's statuses. */
export function walmartOrderState(lines: any[]): MarketplaceOrderState {
  const statuses = lines.flatMap(statusesOf)
  if (!statuses.length) return 'unshipped'
  if (statuses.every((status) => status === 'Cancelled')) return 'canceled'
  if (
    statuses.some((status) => status === 'Created' || status === 'Acknowledged')
  )
    return 'unshipped'
  return 'shipped'
}

const chargesOf = (line: any): any[] =>
  Array.isArray(line?.charges?.charge) ? line.charges.charge : []

function readAddress(info: any): MarketplaceAddress | null {
  const address = info?.postalAddress
  if (!address || typeof address !== 'object') return null
  return {
    name: text(address.name),
    line1: text(address.address1),
    ...(text(address.address2) ? { line2: text(address.address2) } : {}),
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.postalCode),
    // Walmart writes the country as `USA`.
    country: ((code) => (code === 'USA' ? 'US' : code))(
      text(address.country)?.toUpperCase() ?? null,
    ),
    ...(text(info?.phone) ? { phone: text(info.phone) } : {}),
  }
}

/** One purchase order, as the engine reads it. */
export function readWalmartOrder(
  order: any,
  options: { testMode?: boolean } = {},
): MarketplaceOrder {
  const orderLines: any[] = Array.isArray(order?.orderLines?.orderLine)
    ? order.orderLines.orderLine
    : []
  const currency = (
    text(
      chargesOf(orderLines[0]).find((charge) => charge?.chargeAmount?.currency)
        ?.chargeAmount?.currency,
    ) ?? 'USD'
  ).toUpperCase()
  const decimals = currencyDecimals(currency)
  let shippingMinor = 0
  let taxMinor = 0
  let discountMinor = 0
  let productMinor = 0
  const lines: MarketplaceOrderLine[] = orderLines.map((line) => {
    const quantity = Math.max(0, Number(line?.orderLineQuantity?.amount) || 0)
    let lineProduct = 0
    for (const charge of chargesOf(line)) {
      const amount = toMinor(charge?.chargeAmount?.amount, decimals) ?? 0
      const type = String(charge?.chargeType ?? '').toUpperCase()
      taxMinor += toMinor(charge?.tax?.taxAmount?.amount, decimals) ?? 0
      if (type === 'SHIPPING') shippingMinor += amount
      else if (type === 'DISCOUNT' || amount < 0)
        discountMinor += Math.abs(amount)
      else if (type === 'PRODUCT') lineProduct += amount
    }
    productMinor += lineProduct
    const sku = text(line?.item?.sku)
    return {
      externalLineId: String(line?.lineNumber ?? ''),
      sku,
      title: text(line?.item?.productName) ?? sku ?? 'Item',
      quantity,
      unitPriceMinor:
        quantity > 0 ? Math.round(lineProduct / quantity) : lineProduct,
    }
  })
  const placedAtMs = timeMs(order?.orderDate) ?? 0
  const statusDates = orderLines
    .map((line) => timeMs(line?.statusDate))
    .filter((value): value is number => value !== null)
  const shipTo = readAddress(order?.shippingInfo)
  return {
    externalId: String(order?.purchaseOrderId ?? ''),
    displayRef: String(order?.customerOrderId ?? order?.purchaseOrderId ?? ''),
    state: walmartOrderState(orderLines),
    fulfilledByMarketplace:
      String(order?.shipNode?.type ?? '') === 'WFSFulfilled',
    placedAtMs,
    updatedAtMs: Math.max(placedAtMs, ...statusDates),
    currency,
    lines,
    shippingMinor,
    taxMinor,
    discountMinor,
    totalMinor: productMinor + shippingMinor + taxMinor - discountMinor,
    fees: null,
    buyerName: shipTo?.name ?? null,
    shipTo,
    ...(options.testMode ? { testMode: true } : {}),
  }
}

const notListed = (error: unknown): boolean =>
  error instanceof ProviderError &&
  (error.kind === 'not-found' ||
    (error.kind === 'invalid' &&
      /not found|does not exist|no item|invalid sku|unknown sku/i.test(
        error.message,
      )))

const isAlready = (error: unknown, words: RegExp): boolean =>
  error instanceof ProviderError &&
  error.kind === 'invalid' &&
  words.test(error.message)

export function createWalmartProvider(deps: {
  http: ProviderHttp
}): MarketplaceProvider {
  const { http } = deps

  const baseHeaders = (app: MarketplaceApp): Record<string, string> => ({
    'WM_SVC.NAME': SERVICE_NAME,
    'WM_QOS.CORRELATION_ID': randomUUID(),
    Accept: 'application/json',
    ...(text(app.extra['channelType'])
      ? { 'WM_CONSUMER.CHANNEL.TYPE': String(app.extra['channelType']).trim() }
      : {}),
  })

  const call = (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(http, {
      provider: 'Walmart',
      method,
      url: `${apiBase(app)}${path}`,
      headers: {
        ...baseHeaders(app),
        'WM_SEC.ACCESS_TOKEN': credential.accessToken,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const token = async (
    app: MarketplaceApp,
    form: Record<string, string>,
    nowMs: number,
    sellerId: string | null,
  ): Promise<MarketplaceGrant> => {
    const answer = await providerRequest(http, {
      provider: 'Walmart',
      method: 'POST',
      url: `${apiBase(app)}/v3/token`,
      headers: {
        ...baseHeaders(app),
        Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(sellerId ? { 'WM_PARTNER.ID': sellerId } : {}),
      },
      body: new URLSearchParams(form).toString(),
    })
    const accessToken = text(answer?.access_token)
    if (!accessToken)
      throw new ProviderError('auth', 'Walmart did not issue an access token')
    const expiresIn = Number(answer?.expires_in)
    const refreshToken = text(answer?.refresh_token)
    return {
      accessToken,
      // A refresh answers no refresh token: the one held keeps working.
      refreshToken,
      expiresAtMs:
        Number.isFinite(expiresIn) && expiresIn > 0
          ? nowMs + expiresIn * 1000
          : null,
      ...(refreshToken
        ? { refreshExpiresAtMs: nowMs + REFRESH_LIFETIME_MS }
        : {}),
    }
  }

  return {
    id: 'walmart',

    authorizeUrl(app, input) {
      const params = new URLSearchParams({
        responseType: 'code',
        clientId: app.clientId,
        redirectUri: input.redirectUri,
        clientType: 'seller',
        nonce: randomUUID().replace(/-/g, '').slice(0, 16),
        state: input.state,
      })
      return `${WALMART_AUTHORIZE_URL}?${params.toString()}`
    },

    async exchangeCode(app, input) {
      const sellerId = text(input.params.get('sellerId'))
      const grant = await token(
        app,
        {
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
        },
        input.nowMs,
        sellerId,
      )
      return { ...grant, ...(sellerId ? { account: { sellerId } } : {}) }
    },

    refresh(app, input) {
      return token(
        app,
        { grant_type: 'refresh_token', refresh_token: input.refreshToken },
        input.nowMs,
        null,
      )
    },

    async account(app, credential) {
      const answer = await call(
        app,
        credential,
        'GET',
        '/v3/settings/partnerprofile',
      )
      const partner = answer?.partner ?? answer ?? {}
      const sellerId =
        text(partner?.partnerId) ?? text(credential.account.sellerId)
      return {
        accountName:
          text(partner?.partnerDisplayName) ?? text(partner?.partnerName),
        account: sellerId ? { sellerId } : {},
      }
    },

    async syncListings(app, credential, pushes, options) {
      const results: ListingResult[] = []
      for (const push of pushes) {
        try {
          await call(
            app,
            credential,
            'PUT',
            `/v3/inventory?${new URLSearchParams({ sku: push.sku }).toString()}`,
            {
              sku: push.sku,
              quantity: {
                unit: 'EACH',
                amount: Math.max(0, Math.floor(push.quantity)),
              },
            },
          )
          if (options.prices) {
            await call(app, credential, 'PUT', '/v3/price', {
              sku: push.sku,
              pricing: [
                {
                  currentPriceType: 'BASE',
                  currentPrice: {
                    currency: push.currency.toUpperCase(),
                    amount: Number(
                      fromMinor(
                        push.priceMinor,
                        currencyDecimals(push.currency),
                      ),
                    ),
                  },
                },
              ],
            })
          }
          results.push({
            sku: push.sku,
            outcome: 'updated',
            externalId: push.externalId ?? null,
          })
        } catch (error) {
          if (notListed(error)) {
            results.push({ sku: push.sku, outcome: 'not_listed' })
            continue
          }
          if (error instanceof ProviderError && error.kind === 'invalid') {
            results.push({
              sku: push.sku,
              outcome: 'failed',
              message: error.message,
            })
            continue
          }
          throw error
        }
      }
      return results
    },

    async listOrders(app, credential, query) {
      let path: string
      if (query.cursor) {
        if (!query.cursor.startsWith('?'))
          throw new ProviderError(
            'invalid',
            'Walmart order cursor is not a query string',
          )
        path = `/v3/orders${query.cursor}`
      } else {
        const params = new URLSearchParams({
          lastModifiedStartDate: new Date(query.sinceMs).toISOString(),
          limit: '100',
        })
        path = `/v3/orders?${params.toString()}`
      }
      const answer = await call(app, credential, 'GET', path)
      const list = answer?.list ?? {}
      const orders = (
        Array.isArray(list?.elements?.order) ? list.elements.order : []
      ).map((order: any) => readWalmartOrder(order, { testMode: app.sandbox }))
      return { orders, nextCursor: text(list?.meta?.nextCursor) }
    },

    async acknowledgeOrder(app, credential, order) {
      try {
        await call(
          app,
          credential,
          'POST',
          `/v3/orders/${encodeURIComponent(order.externalId)}/acknowledge`,
          undefined,
          { retry: false },
        )
      } catch (error) {
        if (
          isAlready(
            error,
            /already acknowledged|already been acknowledged|status.*(acknowledged|shipped)/i,
          )
        )
          return
        throw error
      }
    },

    async confirmShipment(app, credential, confirmation) {
      try {
        await call(
          app,
          credential,
          'POST',
          `/v3/orders/${encodeURIComponent(confirmation.externalOrderId)}/shipping`,
          {
            orderShipment: {
              orderLines: {
                orderLine: confirmation.lines.map((line) => ({
                  lineNumber: line.externalLineId,
                  orderLineStatuses: {
                    orderLineStatus: [
                      {
                        status: 'Shipped',
                        statusQuantity: {
                          unitOfMeasurement: 'EACH',
                          amount: String(line.quantity),
                        },
                        trackingInfo: {
                          shipDateTime: confirmation.shippedAtMs,
                          carrierName: walmartCarrier(confirmation.carrier),
                          methodCode: 'Standard',
                          trackingNumber: confirmation.trackingNumber,
                          ...(confirmation.trackingUrl
                            ? { trackingURL: confirmation.trackingUrl }
                            : {}),
                        },
                      },
                    ],
                  },
                })),
              },
            },
          },
          { retry: false },
        )
        return 'confirmed'
      } catch (error) {
        if (
          isAlready(
            error,
            /already (been )?shipped|already in shipped|status.*shipped/i,
          )
        )
          return 'already'
        throw error
      }
    },
  }
}
