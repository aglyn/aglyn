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

import { createHash } from 'node:crypto'
import type { MarketplaceSite } from '../model/marketplaces'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  currencyDecimals,
  fromMinor,
  text,
  timeMs,
  toMinor,
  type ListingPush,
  type ListingResult,
  type MarketplaceAddress,
  type MarketplaceApp,
  type MarketplaceCredential,
  type MarketplaceFee,
  type MarketplaceGrant,
  type MarketplaceOrder,
  type MarketplaceOrderLine,
  type MarketplaceOrderState,
  type MarketplaceProvider,
} from './provider'

/**
 * AMAZON (AGL-3638), through the Selling Partner API with the seller's
 * website authorization: the seller consents in Seller Central, which sends
 * back `spapi_oauth_code` and `selling_partner_id`; Login with Amazon trades
 * the code for a refresh token that does not expire and hour-long access
 * tokens. Calls carry the access token in `x-amz-access-token`; SP-API has
 * not required request signing since October 2023.
 *
 * - **Listings** (Listings Items API 2021-08-01): a listing is found by the
 *   seller SKU. Its product type, which every patch must name, is read
 *   first; quantity goes in `fulfillment_availability` and price in
 *   `purchasable_offer`. A SKU with no listing and a GTIN is published as an
 *   offer-only listing, matched to Amazon's catalog by that GTIN.
 * - **Orders** (Orders API 2026-01-01, `searchOrders`): one call answers each
 *   page of orders with their items, money and, where the app holds the
 *   roles, the buyer and the delivery address. No Restricted Data Token is
 *   needed in this version. (Orders v0's reads are deprecated and leave on
 *   March 27, 2027.)
 * - **Shipments**: Orders v0's `confirmShipment`, which 2026-01-01 does not
 *   replace.
 * - **Fees** (Finances API v0): the order's financial events, which appear
 *   once Amazon has charged the sale.
 */

export type AmazonRegion = 'na' | 'eu' | 'fe'

export const AMAZON_API_HOSTS: Readonly<
  Record<AmazonRegion, { live: string; sandbox: string }>
> = {
  na: {
    live: 'https://sellingpartnerapi-na.amazon.com',
    sandbox: 'https://sandbox.sellingpartnerapi-na.amazon.com',
  },
  eu: {
    live: 'https://sellingpartnerapi-eu.amazon.com',
    sandbox: 'https://sandbox.sellingpartnerapi-eu.amazon.com',
  },
  fe: {
    live: 'https://sellingpartnerapi-fe.amazon.com',
    sandbox: 'https://sandbox.sellingpartnerapi-fe.amazon.com',
  },
}

/** Seller Central's consent page, per SP-API region. */
export const AMAZON_CONSENT_HOSTS: Readonly<Record<AmazonRegion, string>> = {
  na: 'https://sellercentral.amazon.com',
  eu: 'https://sellercentral-europe.amazon.com',
  fe: 'https://sellercentral.amazon.co.jp',
}

/** Login with Amazon's token endpoint, for every region. */
export const AMAZON_LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

const LISTINGS = '/listings/2021-08-01/items'
const ORDERS = '/orders/2026-01-01/orders'

/** What every page of orders asks for; the first two need the app's PII roles. */
const ORDER_DATA_WITH_PII = ['BUYER', 'RECIPIENT', 'PROCEEDS', 'FULFILLMENT']
const ORDER_DATA = ['PROCEEDS', 'FULFILLMENT']

/** Listings Items allows 5 calls a second; one call every 200 ms stays inside it. */
const LISTING_CALL_GAP_MS = 200

/** The carrier codes Amazon takes as they are; anything else goes as `Other` with its name. */
const AMAZON_CARRIERS: Readonly<Record<string, string>> = {
  ups: 'UPS',
  usps: 'USPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  'dhl ecommerce': 'DHL eCommerce',
  ontrac: 'OnTrac',
  'canada post': 'Canada Post',
  'royal mail': 'Royal Mail',
  'amazon shipping': 'Amazon Shipping',
}

const regionOf = (app: MarketplaceApp): AmazonRegion => {
  const region = String(app.extra['region'] ?? '').toLowerCase()
  return region === 'eu' || region === 'fe' ? region : 'na'
}

const apiBase = (app: MarketplaceApp): string => {
  const hosts = AMAZON_API_HOSTS[regionOf(app)]
  return app.sandbox ? hosts.sandbox : hosts.live
}

/** Amazon's carrier code for the carrier the merchant named, with the name it needs when that is `Other`. */
export function amazonCarrier(carrier: string | null): {
  carrierCode: string
  carrierName?: string
} {
  const named = text(carrier)
  const code = named
    ? AMAZON_CARRIERS[named.toLowerCase().replace(/[\s_-]+/g, ' ')]
    : undefined
  if (code) return { carrierCode: code }
  return { carrierCode: 'Other', carrierName: (named ?? 'Other').slice(0, 64) }
}

/**
 * The package reference Amazon takes: a positive number, stable per shipment
 * so a confirmation sent again names the same package.
 */
export function amazonPackageReference(reference: string): string {
  const digest = createHash('sha256').update(reference).digest('hex')
  // 48 bits stay exact in a double; +1 keeps it positive.
  return String(parseInt(digest.slice(0, 12), 16) + 1)
}

/** Amazon's condition value for the store's condition. */
const conditionType = (condition: ListingPush['condition']): string =>
  condition === 'refurbished'
    ? 'refurbished_refurbished'
    : condition === 'used'
      ? 'used_good'
      : 'new_new'

/** The identifier type Amazon names a GTIN by, from its length. */
const gtinType = (gtin: string): string => {
  const digits = gtin.replace(/\D/g, '')
  return digits.length === 12 ? 'upc' : digits.length === 13 ? 'ean' : 'gtin'
}

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0)

/** Amazon's order status, in the engine's words. */
export function amazonOrderState(status: unknown): MarketplaceOrderState {
  switch (String(status ?? '').toUpperCase()) {
    case 'PENDING':
    case 'PENDING_AVAILABILITY':
      return 'pending'
    case 'SHIPPED':
    case 'INVOICE_UNCONFIRMED':
      return 'shipped'
    // UNFULFILLABLE applies only to Multi-Channel Fulfillment orders, which
    // are not marketplace sales: nothing is owed on one.
    case 'CANCELLED':
    case 'CANCELED':
    case 'UNFULFILLABLE':
      return 'canceled'
    default:
      return 'unshipped'
  }
}

/** One proceeds breakdown type's subtotals, in minor units. */
const breakdownMinor = (
  proceeds: any,
  type: string,
  decimals: number,
): number[] =>
  (Array.isArray(proceeds?.breakdowns) ? proceeds.breakdowns : [])
    .filter((entry: any) => String(entry?.type ?? '') === type)
    .map((entry: any) => toMinor(entry?.subtotal?.amount, decimals) ?? 0)

function readAddress(address: any): MarketplaceAddress | null {
  if (!address || typeof address !== 'object') return null
  const line2 = [text(address.addressLine2), text(address.addressLine3)]
    .filter(Boolean)
    .join(', ')
  const read: MarketplaceAddress = {
    name: text(address.name),
    line1: text(address.addressLine1),
    ...(line2 ? { line2 } : {}),
    city: text(address.city),
    state: text(address.stateOrRegion),
    postalCode: text(address.postalCode),
    country: text(address.countryCode)?.toUpperCase() ?? null,
    ...(text(address.phone) ? { phone: text(address.phone) } : {}),
  }
  return read.line1 || read.city || read.postalCode || read.country
    ? read
    : null
}

/** One order of a `searchOrders` page, as the engine reads it. */
export function readAmazonOrder(
  order: any,
  options: { testMode?: boolean } = {},
): MarketplaceOrder {
  const items: any[] = Array.isArray(order?.orderItems) ? order.orderItems : []
  const currency = (
    text(order?.proceeds?.grandTotal?.currencyCode) ??
    text(
      items.find((item) => item?.proceeds?.proceedsTotal?.currencyCode)
        ?.proceeds?.proceedsTotal?.currencyCode,
    ) ??
    text(
      items.find((item) => item?.product?.price?.unitPrice?.currencyCode)
        ?.product?.price?.unitPrice?.currencyCode,
    ) ??
    'USD'
  ).toUpperCase()
  const decimals = currencyDecimals(currency)
  const lines: MarketplaceOrderLine[] = items.map((item) => {
    const quantity = Math.max(0, Number(item?.quantityOrdered) || 0)
    const itemMinor = breakdownMinor(item?.proceeds, 'ITEM', decimals)
    const unitPriceMinor =
      itemMinor.length && quantity > 0
        ? Math.round(sum(itemMinor) / quantity)
        : (toMinor(item?.product?.price?.unitPrice?.amount, decimals) ?? 0)
    const sku = text(item?.product?.sellerSku)
    return {
      externalLineId: String(item?.orderItemId ?? ''),
      sku,
      title: text(item?.product?.title) ?? sku ?? 'Item',
      quantity,
      unitPriceMinor,
    }
  })
  const lineTotal = (type: string) =>
    sum(items.flatMap((item) => breakdownMinor(item?.proceeds, type, decimals)))
  const itemsTotal = sum(
    items.map(
      (item) => toMinor(item?.proceeds?.proceedsTotal?.amount, decimals) ?? 0,
    ),
  )
  const placedAtMs = timeMs(order?.createdTime) ?? 0
  return {
    externalId: String(order?.orderId ?? ''),
    displayRef: String(order?.orderId ?? ''),
    state: amazonOrderState(order?.fulfillment?.fulfillmentStatus),
    fulfilledByMarketplace:
      String(order?.fulfillment?.fulfilledBy ?? '').toUpperCase() === 'AMAZON',
    placedAtMs,
    updatedAtMs: timeMs(order?.lastUpdatedTime) ?? placedAtMs,
    currency,
    lines,
    shippingMinor: lineTotal('SHIPPING'),
    taxMinor: lineTotal('TAX'),
    discountMinor: Math.abs(lineTotal('DISCOUNT')),
    totalMinor:
      toMinor(order?.proceeds?.grandTotal?.amount, decimals) ?? itemsTotal,
    fees: null,
    buyerName: text(order?.buyer?.buyerName),
    shipTo: readAddress(order?.recipient?.deliveryAddress),
    ...(options.testMode ? { testMode: true } : {}),
  }
}

/**
 * What Amazon charged for one order, from its financial events, summed by fee
 * type. Amazon writes a charge as a negative amount; a fee is stored as what
 * the merchant paid. `null` while there are no shipment events yet.
 */
export function readAmazonFees(eventPages: any[]): MarketplaceFee[] | null {
  const byType = new Map<string, number>()
  let sawEvent = false
  for (const page of eventPages) {
    for (const event of Array.isArray(page?.ShipmentEventList)
      ? page.ShipmentEventList
      : []) {
      sawEvent = true
      for (const item of Array.isArray(event?.ShipmentItemList)
        ? event.ShipmentItemList
        : []) {
        for (const fee of Array.isArray(item?.ItemFeeList)
          ? item.ItemFeeList
          : []) {
          const currency = String(fee?.FeeAmount?.CurrencyCode ?? 'USD')
          const amount = toMinor(
            fee?.FeeAmount?.CurrencyAmount,
            currencyDecimals(currency),
          )
          if (amount === null || amount === 0) continue
          const label = text(fee?.FeeType) ?? 'Amazon fee'
          byType.set(label, (byType.get(label) ?? 0) - amount)
        }
      }
    }
  }
  if (!sawEvent) return null
  return [...byType].map(([label, amountMinor]) => ({ label, amountMinor }))
}

/** The first issue Amazon rated an error, in its words. */
const firstError = (answer: any): string | null => {
  const issues: any[] = Array.isArray(answer?.issues) ? answer.issues : []
  const error = issues.find(
    (issue) => String(issue?.severity ?? '').toUpperCase() === 'ERROR',
  )
  if (error)
    return (
      text(error.message) ?? text(error.code) ?? 'Amazon refused the listing'
    )
  return String(answer?.status ?? '').toUpperCase() === 'INVALID'
    ? (text(issues[0]?.message) ?? 'Amazon refused the listing')
    : null
}

const isAlreadyShipped = (error: unknown): boolean =>
  error instanceof ProviderError &&
  error.kind === 'invalid' &&
  /already (been )?(shipped|confirmed)|has already been|shipment.*already/i.test(
    error.message,
  )

export function createAmazonProvider(deps: {
  http: ProviderHttp
}): MarketplaceProvider {
  const { http } = deps

  const call = (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(http, {
      provider: 'Amazon',
      method,
      url: `${apiBase(app)}${path}`,
      headers: {
        'x-amz-access-token': credential.accessToken,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const token = async (
    app: MarketplaceApp,
    form: Record<string, string>,
    nowMs: number,
  ): Promise<MarketplaceGrant> => {
    const body = new URLSearchParams({
      ...form,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    })
    const answer = await providerRequest(http, {
      provider: 'Amazon',
      method: 'POST',
      url: AMAZON_LWA_TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body: body.toString(),
    })
    const accessToken = text(answer?.access_token)
    if (!accessToken)
      throw new ProviderError('auth', 'Amazon did not issue an access token')
    const expiresIn = Number(answer?.expires_in)
    return {
      accessToken,
      refreshToken: text(answer?.refresh_token),
      expiresAtMs:
        Number.isFinite(expiresIn) && expiresIn > 0
          ? nowMs + expiresIn * 1000
          : null,
      // Login with Amazon's refresh tokens do not expire.
      refreshExpiresAtMs: null,
    }
  }

  const keys = (
    credential: MarketplaceCredential,
  ): { sellerId: string; marketplaceId: string } => {
    const sellerId = text(credential.account.sellerId)
    if (!sellerId)
      throw new ProviderError(
        'auth',
        'This Amazon connection has no selling partner id; connect again',
      )
    const marketplaceId = text(credential.account.marketplaceId)
    if (!marketplaceId)
      throw new ProviderError(
        'invalid',
        'Choose the Amazon marketplace to sell on',
      )
    return { sellerId, marketplaceId }
  }

  return {
    id: 'amazon',

    authorizeUrl(app, input) {
      const applicationId = text(app.extra['applicationId'])
      if (!applicationId)
        throw new ProviderError(
          'invalid',
          'This deployment has no Amazon application id',
        )
      const params = new URLSearchParams({
        application_id: applicationId,
        state: input.state,
        redirect_uri: input.redirectUri,
      })
      if (app.extra['draft'] === 'true') params.set('version', 'beta')
      return `${AMAZON_CONSENT_HOSTS[regionOf(app)]}/apps/authorize/consent?${params.toString()}`
    },

    async exchangeCode(app, input) {
      const grant = await token(
        app,
        {
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: input.redirectUri,
        },
        input.nowMs,
      )
      const sellerId = text(input.params.get('selling_partner_id'))
      return { ...grant, ...(sellerId ? { account: { sellerId } } : {}) }
    },

    refresh(app, input) {
      return token(
        app,
        { grant_type: 'refresh_token', refresh_token: input.refreshToken },
        input.nowMs,
      )
    },

    async account(app, credential) {
      const answer = await call(
        app,
        credential,
        'GET',
        '/sellers/v1/marketplaceParticipations',
      )
      const sites: MarketplaceSite[] = []
      let storeName: string | null = null
      for (const entry of Array.isArray(answer?.payload)
        ? answer.payload
        : []) {
        if (entry?.participation?.isParticipating !== true) continue
        const id = text(entry?.marketplace?.id)
        const name = text(entry?.marketplace?.name) ?? id
        // "Non-Amazon" marketplaces record off-Amazon sales; nothing lists there.
        if (!id || !name || /^non-amazon/i.test(name)) continue
        storeName = storeName ?? text(entry?.storeName)
        sites.push({
          id,
          name,
          currency:
            text(entry?.marketplace?.defaultCurrencyCode)?.toUpperCase() ??
            null,
        })
      }
      const marketplaceId =
        text(credential.account.marketplaceId) ?? sites[0]?.id ?? null
      return {
        accountName: storeName,
        account: { ...(marketplaceId ? { marketplaceId } : {}) },
        sites,
      }
    },

    async syncListings(app, credential, pushes, options) {
      const { sellerId, marketplaceId } = keys(credential)
      const results: ListingResult[] = []
      let calls = 0
      const paced = async <T>(send: () => Promise<T>): Promise<T> => {
        if (calls > 0) await http.sleep(LISTING_CALL_GAP_MS)
        calls += 1
        return send()
      }
      const itemPath = (sku: string, query: Record<string, string>) =>
        `${LISTINGS}/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?${new URLSearchParams(
          {
            marketplaceIds: marketplaceId,
            ...query,
          },
        ).toString()}`

      for (const push of pushes) {
        const decimals = currencyDecimals(push.currency)
        const quantity = Math.max(0, Math.floor(push.quantity))
        const offer = {
          currency: push.currency.toUpperCase(),
          audience: 'ALL',
          marketplace_id: marketplaceId,
          our_price: [
            {
              schedule: [
                {
                  value_with_tax: Number(fromMinor(push.priceMinor, decimals)),
                },
              ],
            },
          ],
        }
        const availability = [{ fulfillment_channel_code: 'DEFAULT', quantity }]
        try {
          let existing: any = null
          try {
            existing = await paced(() =>
              call(
                app,
                credential,
                'GET',
                itemPath(push.sku, { includedData: 'summaries' }),
              ),
            )
          } catch (error) {
            if (!(error instanceof ProviderError && error.kind === 'not-found'))
              throw error
          }

          if (!existing) {
            const gtin = text(push.gtin)
            if (!options.publish || !gtin) {
              results.push({
                sku: push.sku,
                outcome: 'not_listed',
                message: options.publish
                  ? 'Amazon needs a GTIN (UPC or EAN) to publish this product'
                  : null,
              })
              continue
            }
            const answer = await paced(() =>
              call(
                app,
                credential,
                'PUT',
                itemPath(push.sku, { includedData: 'identifiers,issues' }),
                {
                  productType: 'PRODUCT',
                  requirements: 'LISTING_OFFER_ONLY',
                  attributes: {
                    condition_type: [
                      {
                        value: conditionType(push.condition),
                        marketplace_id: marketplaceId,
                      },
                    ],
                    externally_assigned_product_identifier: [
                      {
                        type: gtinType(gtin),
                        value: gtin,
                        marketplace_id: marketplaceId,
                      },
                    ],
                    purchasable_offer: [offer],
                    fulfillment_availability: availability,
                  },
                },
                { retry: false },
              ),
            )
            const refused = firstError(answer)
            const asin =
              text(
                (Array.isArray(answer?.identifiers)
                  ? answer.identifiers
                  : []
                ).find((entry: any) => entry?.marketplaceId === marketplaceId)
                  ?.asin,
              ) ?? null
            results.push(
              refused
                ? { sku: push.sku, outcome: 'failed', message: refused }
                : { sku: push.sku, outcome: 'created', externalId: asin },
            )
            continue
          }

          const summary =
            (Array.isArray(existing?.summaries) ? existing.summaries : []).find(
              (entry: any) => entry?.marketplaceId === marketplaceId,
            ) ?? existing?.summaries?.[0]
          const patches: Array<{ op: string; path: string; value: unknown[] }> =
            [
              {
                op: 'replace',
                path: '/attributes/fulfillment_availability',
                value: availability,
              },
            ]
          if (options.prices)
            patches.push({
              op: 'merge',
              path: '/attributes/purchasable_offer',
              value: [offer],
            })
          const answer = await paced(() =>
            call(app, credential, 'PATCH', itemPath(push.sku, {}), {
              productType: text(summary?.productType) ?? 'PRODUCT',
              patches,
            }),
          )
          const refused = firstError(answer)
          results.push(
            refused
              ? { sku: push.sku, outcome: 'failed', message: refused }
              : {
                  sku: push.sku,
                  outcome: 'updated',
                  externalId: text(summary?.asin) ?? push.externalId ?? null,
                },
          )
        } catch (error) {
          if (
            error instanceof ProviderError &&
            (error.kind === 'invalid' || error.kind === 'not-found')
          ) {
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
      const marketplaceId = text(credential.account.marketplaceId)
      if (!marketplaceId)
        throw new ProviderError(
          'invalid',
          'Choose the Amazon marketplace to sell on',
        )
      const page = (includedData: string[]) => {
        const params = new URLSearchParams({
          marketplaceIds: marketplaceId,
          lastUpdatedAfter: new Date(query.sinceMs).toISOString(),
          includedData: includedData.join(','),
          maxResultsPerPage: '100',
        })
        if (query.cursor) params.set('paginationToken', query.cursor)
        return call(app, credential, 'GET', `${ORDERS}?${params.toString()}`)
      }
      let answer: any
      try {
        answer = await page(ORDER_DATA_WITH_PII)
      } catch (error) {
        // An app without the buyer and address roles is refused those parts;
        // the orders still come, without who and where.
        if (!(error instanceof ProviderError && error.kind === 'auth'))
          throw error
        answer = await page(ORDER_DATA)
      }
      const orders = (Array.isArray(answer?.orders) ? answer.orders : []).map(
        (order: any) => readAmazonOrder(order, { testMode: app.sandbox }),
      )
      return { orders, nextCursor: text(answer?.pagination?.nextToken) }
    },

    async confirmShipment(app, credential, confirmation) {
      const marketplaceId = text(credential.account.marketplaceId)
      if (!marketplaceId)
        throw new ProviderError(
          'invalid',
          'Choose the Amazon marketplace to sell on',
        )
      try {
        await call(
          app,
          credential,
          'POST',
          `/orders/v0/orders/${encodeURIComponent(confirmation.externalOrderId)}/shipmentConfirmation`,
          {
            marketplaceId,
            packageDetail: {
              packageReferenceId: amazonPackageReference(
                confirmation.reference,
              ),
              ...amazonCarrier(confirmation.carrier),
              trackingNumber: confirmation.trackingNumber,
              shipDate: new Date(confirmation.shippedAtMs).toISOString(),
              orderItems: confirmation.lines.map((line) => ({
                orderItemId: line.externalLineId,
                quantity: line.quantity,
              })),
            },
          },
          { retry: false },
        )
        return 'confirmed'
      } catch (error) {
        if (isAlreadyShipped(error)) return 'already'
        throw error
      }
    },

    async orderFees(app, credential, externalOrderId) {
      const pages: any[] = []
      let nextToken: string | null = null
      for (let index = 0; index < 20; index += 1) {
        const params = new URLSearchParams({ MaxResultsPerPage: '100' })
        if (nextToken) params.set('NextToken', nextToken)
        const answer = await call(
          app,
          credential,
          'GET',
          `/finances/v0/orders/${encodeURIComponent(externalOrderId)}/financialEvents?${params.toString()}`,
        )
        pages.push(answer?.payload?.FinancialEvents ?? {})
        nextToken = text(answer?.payload?.NextToken)
        if (!nextToken) break
      }
      return readAmazonFees(pages)
    },
  }
}
