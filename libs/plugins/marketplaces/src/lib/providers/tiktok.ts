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
 * TIKTOK SHOP (AGL-3638), through the Open API, version 202309.
 *
 * The seller authorizes the app's service on TikTok Shop's consent page,
 * which redirects back with a `code`. The token API trades it for an access
 * token and a refresh token, each with an ABSOLUTE expiry in epoch seconds.
 *
 * Every API call is signed (see {@link tiktokSign}) and carries the app key,
 * a timestamp in seconds, the access token in `x-tts-access-token` and, for
 * a shop-scoped call, the shop's `shop_cipher`. TikTok answers HTTP 200 with
 * a non-zero `code` for most refusals, so every answer's envelope is read
 * and turned into a `ProviderError` here.
 *
 * - **Listings**: link only. SKUs are found by seller SKU through product
 *   search; each product's SKUs are updated in one inventory call (and one
 *   price call when prices are asked).
 * - **Orders**: TikTok gives one line item per unit, so units of one SKU at
 *   one price are grouped into a line whose `externalLineId` is every unit's
 *   line item id joined by `,`. A shipment confirmation splits it back and
 *   sends as many ids as the units it ships.
 * - **Shipments**: the seller's own carrier is confirmed with "Mark Package
 *   As Shipped", which names TikTok's shipping provider id; the id is found
 *   by name among the providers of the order's delivery option.
 * - **Sandbox**: TikTok Shop has no sandbox host. A test shop is an ordinary
 *   shop on the live API, so `app.sandbox` changes nothing here and orders
 *   are never marked as test orders.
 */

export const TIKTOK_API_BASE = 'https://open-api.tiktokglobalshop.com'
export const TIKTOK_AUTH_BASE = 'https://auth.tiktok-shops.com'

/**
 * The consent page, by where the app is registered: US sellers authorize
 * apps from the US Partner Center, everyone else from the global one.
 * `extra.region` picks (`us`, the default, or `global`).
 */
export const TIKTOK_AUTHORIZE_URLS = {
  us: 'https://services.us.tiktokshop.com/open/authorize',
  global: 'https://services.tiktokshop.com/open/authorize',
} as const

const PROVIDER = 'TikTok Shop'

/** Search pages; TikTok's maximum for products and orders. */
const PRODUCT_PAGE = 100
const ORDER_PAGE = 50
/** Seller SKUs named in one product search. */
const SKUS_PER_SEARCH = 50

/**
 * TikTok's envelope codes for a token it does not accept (invalid, expired
 * or revoked). Any other code whose message names the access token reads
 * the same way.
 */
const AUTH_CODES = new Set([105000, 105001, 105002, 105003, 105004])
const AUTH_MESSAGE = /access[\s_-]?token|expired credential|invalid credential|unauthori[sz]ed|authoriz(ation|ed) (has )?(been )?(revoked|expired|cancel)/i
/** TikTok's words for a rate limit, which it reports in the envelope rather than as a 429. */
const RATE_LIMIT_MESSAGE = /rate limit|too many requests|request frequency|frequency limit|qps/i

/** Shipping provider names written the way merchants write them, keyed by our normalized carrier. */
const CARRIER_ALIASES: Readonly<Record<string, string[]>> = {
  fedex: ['fedex', 'federalexpress'],
  usps: ['usps', 'unitedstatespostalservice'],
  ups: ['ups', 'unitedparcelservice'],
  dhl: ['dhl', 'dhlexpress', 'dhlecommerce'],
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * TikTok Shop's request signature, from the Partner Center's "Sign your API
 * request" algorithm:
 *
 * 1. Take every query parameter except `sign` and `access_token`, sorted by
 *    key, and concatenate each as `{key}{value}` (raw, not URL-encoded).
 * 2. Prepend the request path (`/order/202309/orders/search`).
 * 3. Append the request body exactly as sent, unless the request is
 *    multipart (none here are) or has no body.
 * 4. Wrap the result in the app secret on both ends.
 * 5. HMAC-SHA256 it keyed by the app secret; the signature is lower-case hex.
 */
export function tiktokSign(appSecret: string, path: string, query: Readonly<Record<string, string>>, body: string | null): string {
  const params = Object.keys(query)
    .filter((key) => key !== 'sign' && key !== 'access_token')
    .sort()
    .map((key) => `${key}${query[key]}`)
    .join('')
  const plain = `${appSecret}${path}${params}${body ?? ''}${appSecret}`
  return createHmac('sha256', appSecret).update(plain).digest('hex')
}

/** The `ProviderError` a non-zero envelope `code` stands for. */
export function tiktokError(payload: any): ProviderError {
  const code = Number(payload?.code)
  const message = String(text(payload?.message) ?? `${PROVIDER} refused the request (code ${payload?.code})`).slice(0, 300)
  if (AUTH_CODES.has(code) || AUTH_MESSAGE.test(message)) {
    return new ProviderError('auth', `${PROVIDER} refused the connection: ${message}`, { status: 401 })
  }
  if (RATE_LIMIT_MESSAGE.test(message)) {
    return new ProviderError('rate-limit', `${PROVIDER} asked us to slow down`, { status: 429, retryAfterMs: 60_000 })
  }
  return new ProviderError('invalid', message)
}

/** The envelope's `data`, or the error its `code` stands for. */
function envelopeData(payload: any): any {
  if (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0) throw tiktokError(payload)
  return payload?.data ?? {}
}

/**
 * An expiry as epoch ms. TikTok's `*_expire_in` fields are absolute epoch
 * seconds despite the name; a value too small to be one is read as seconds
 * from now, so a change in TikTok's meaning cannot yield an expiry in 1970.
 */
export function tiktokExpiryMs(value: unknown, nowMs: number): number | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds > 1e9 ? seconds * 1000 : nowMs + seconds * 1000
}

function readGrant(data: any, nowMs: number): MarketplaceGrant {
  const accessToken = text(data?.access_token)
  if (!accessToken) throw new ProviderError('auth', `${PROVIDER} answered no access token`)
  return {
    accessToken,
    refreshToken: text(data?.refresh_token),
    expiresAtMs: tiktokExpiryMs(data?.access_token_expire_in, nowMs),
    refreshExpiresAtMs: tiktokExpiryMs(data?.refresh_token_expire_in, nowMs),
  }
}

/** Where an order stands, from TikTok's order status. */
export function tiktokOrderState(status: unknown): MarketplaceOrderState {
  switch (String(status ?? '')) {
    case 'AWAITING_SHIPMENT':
    case 'AWAITING_COLLECTION':
    case 'PARTIALLY_SHIPPING':
      return 'unshipped'
    case 'IN_TRANSIT':
    case 'DELIVERED':
    case 'COMPLETED':
      return 'shipped'
    case 'CANCELLED':
      return 'canceled'
    // UNPAID, and ON_HOLD (the buyer's cancellation window after paying).
    default:
      return 'pending'
  }
}

function readAddress(raw: any): MarketplaceAddress | null {
  if (!raw || typeof raw !== 'object') return null
  const levels: any[] = Array.isArray(raw.district_info) ? raw.district_info : []
  const level = (pattern: RegExp) =>
    text(levels.find((entry) => pattern.test(String(entry?.address_level_name ?? '')))?.address_name)
  const extraLines = [raw.address_line2, raw.address_line3, raw.address_line4].map(text).filter(Boolean)
  return {
    name: text(raw.name) ?? ([text(raw.first_name), text(raw.last_name)].filter(Boolean).join(' ') || null),
    line1: text(raw.address_line1) ?? text(raw.address_detail),
    line2: extraLines.length ? extraLines.join(', ') : null,
    city: level(/city|town|locality/i),
    state: level(/state|province|region|county/i),
    postalCode: text(raw.postal_code),
    country: text(raw.region_code)?.toUpperCase() ?? null,
    phone: text(raw.phone_number),
  }
}

/**
 * The order as the engine reads it.
 *
 * Money: a unit's price is its `original_price`, and the order's discount
 * is `payment.seller_discount`, the part the merchant funds. The
 * `platform_discount` is TikTok's own promotion, which TikTok pays the
 * merchant back, so it is not taken off the merchant's sale; it shows only
 * in `totalMinor`, what the buyer paid. (`sale_price` already has both
 * discounts off, so pricing lines by it would take the seller's discount
 * off twice.)
 */
export function readTiktokOrder(raw: any): MarketplaceOrder {
  const payment = raw?.payment ?? {}
  const currency = String(text(payment.currency) ?? text(raw?.line_items?.[0]?.currency) ?? 'USD').toUpperCase()
  const decimals = currencyDecimals(currency)
  const money = (value: unknown) => toMinor(value, decimals) ?? 0
  const state = tiktokOrderState(raw?.status)
  const items: any[] = Array.isArray(raw?.line_items) ? raw.line_items : []
  // A canceled unit of a live order is not sold; a canceled order keeps every unit, for the record.
  const sold = state === 'canceled' ? items : items.filter((item) => String(item?.display_status ?? '') !== 'CANCELLED')
  const groups = new Map<string, { ids: string[]; item: any; unitPriceMinor: number }>()
  for (const item of sold) {
    const id = text(item?.id)
    if (!id) continue
    const unitPriceMinor = money(item?.original_price ?? item?.sale_price)
    const key = `${text(item?.sku_id) ?? text(item?.seller_sku) ?? id}|${unitPriceMinor}`
    const group = groups.get(key)
    if (group) group.ids.push(id)
    else groups.set(key, { ids: [id], item, unitPriceMinor })
  }
  const lines: MarketplaceOrderLine[] = [...groups.values()].map(({ ids, item, unitPriceMinor }) => ({
    externalLineId: ids.join(','),
    sku: text(item?.seller_sku),
    title: [text(item?.product_name), text(item?.sku_name)].filter(Boolean).join(' — ') || 'TikTok Shop item',
    quantity: ids.length,
    unitPriceMinor,
  }))
  const placedAtMs = timeMs(raw?.create_time) ?? 0
  const shipTo = readAddress(raw?.recipient_address)
  return {
    externalId: String(raw?.id ?? ''),
    displayRef: String(raw?.id ?? ''),
    state,
    fulfilledByMarketplace: String(raw?.fulfillment_type ?? '') === 'FULFILLMENT_BY_TIKTOK',
    placedAtMs,
    updatedAtMs: timeMs(raw?.update_time) ?? placedAtMs,
    currency,
    lines,
    shippingMinor: money(payment.shipping_fee),
    taxMinor: money(payment.tax),
    discountMinor: money(payment.seller_discount),
    totalMinor: money(payment.total_amount),
    fees: null,
    buyerName: shipTo?.name ?? null,
    shipTo,
    testMode: false,
  }
}

/** The shipping provider whose name matches the merchant's carrier, or `null`. */
export function matchShippingProvider(providers: readonly any[], carrier: string): { id: string; name: string } | null {
  const wanted = normalize(carrier)
  if (!wanted) return null
  const named = providers
    .map((provider) => ({ id: text(provider?.id), name: text(provider?.name) }))
    .filter((provider): provider is { id: string; name: string } => Boolean(provider.id && provider.name))
  const aliases = Object.values(CARRIER_ALIASES).find((list) => list.includes(wanted)) ?? [wanted]
  return (
    named.find((provider) => aliases.includes(normalize(provider.name))) ??
    named.find((provider) => aliases.some((alias) => normalize(provider.name).startsWith(alias))) ??
    null
  )
}

interface SkuRef {
  productId: string
  skuId: string
  warehouseId: string | null
}

export function createTiktokProvider(deps: { http: ProviderHttp; now?: () => number }): MarketplaceProvider {
  const now = deps.now ?? (() => Date.now())

  /** One signed Open API call, answering the envelope's `data`. */
  const call = async (
    app: MarketplaceApp,
    credential: MarketplaceCredential | null,
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; body?: unknown; shop?: boolean; retry?: boolean } = {},
  ) => {
    const query: Record<string, string> = {
      ...(options.query ?? {}),
      app_key: app.clientId,
      timestamp: String(Math.floor(now() / 1000)),
    }
    if (options.shop !== false && credential) {
      const cipher = text(credential.account.shopCipher)
      if (!cipher) throw new ProviderError('auth', `${PROVIDER} connection has no shop; connect again`)
      query['shop_cipher'] = cipher
    }
    const body = options.body === undefined ? null : JSON.stringify(options.body)
    const sign = tiktokSign(app.clientSecret, path, query, body)
    const search = new URLSearchParams({ ...query, sign })
    const payload = await providerRequest(deps.http, {
      provider: PROVIDER,
      method,
      url: `${TIKTOK_API_BASE}${path}?${search.toString()}`,
      headers: {
        'content-type': 'application/json',
        ...(credential ? { 'x-tts-access-token': credential.accessToken } : {}),
      },
      ...(body === null ? {} : { body }),
      ...(options.retry === false ? { retry: false } : {}),
    })
    return envelopeData(payload)
  }

  const tokenCall = async (path: string, params: Record<string, string>, nowMs: number) => {
    const payload = await providerRequest(deps.http, {
      provider: PROVIDER,
      method: 'GET',
      url: `${TIKTOK_AUTH_BASE}${path}?${new URLSearchParams(params).toString()}`,
      headers: { Accept: 'application/json' },
    })
    return readGrant(envelopeData(payload), nowMs)
  }

  /** Seller SKU → where TikTok keeps it, for the SKUs it lists. */
  const findSkus = async (app: MarketplaceApp, credential: MarketplaceCredential, skus: readonly string[]) => {
    const found = new Map<string, SkuRef>()
    const wanted = [...new Set(skus.filter(Boolean))]
    for (let index = 0; index < wanted.length; index += SKUS_PER_SEARCH) {
      const chunk = wanted.slice(index, index + SKUS_PER_SEARCH)
      let pageToken = ''
      for (let page = 0; page < 50; page += 1) {
        const data = await call(app, credential, 'POST', '/product/202309/products/search', {
          query: { page_size: String(PRODUCT_PAGE), ...(pageToken ? { page_token: pageToken } : {}) },
          body: { seller_skus: chunk },
        })
        for (const product of Array.isArray(data?.products) ? data.products : []) {
          if (String(product?.status ?? '') === 'DELETED' || !text(product?.id)) continue
          for (const sku of Array.isArray(product?.skus) ? product.skus : []) {
            const sellerSku = text(sku?.seller_sku)
            if (!sellerSku || !chunk.includes(sellerSku) || found.has(sellerSku) || !text(sku?.id)) continue
            found.set(sellerSku, {
              productId: String(product.id),
              skuId: String(sku.id),
              warehouseId: text(sku?.inventory?.[0]?.warehouse_id),
            })
          }
        }
        pageToken = text(data?.next_page_token) ?? ''
        if (!pageToken) break
      }
    }
    return found
  }

  const readOrder = async (app: MarketplaceApp, credential: MarketplaceCredential, orderId: string) => {
    const data = await call(app, credential, 'GET', '/order/202309/orders', { query: { ids: orderId } })
    const order = (Array.isArray(data?.orders) ? data.orders : []).find((entry: any) => String(entry?.id) === orderId)
    if (!order) throw new ProviderError('not-found', `${PROVIDER} has no order ${orderId}`, { status: 404 })
    return order
  }

  return {
    id: 'tiktok',

    authorizeUrl(app, input) {
      const serviceId = text(app.extra['serviceId'])
      if (!serviceId) throw new ProviderError('invalid', 'TikTok Shop needs the app’s service id (extra.serviceId)')
      const base = app.extra['region'] === 'global' ? TIKTOK_AUTHORIZE_URLS.global : TIKTOK_AUTHORIZE_URLS.us
      return `${base}?${new URLSearchParams({ service_id: serviceId, state: input.state }).toString()}`
    },

    async exchangeCode(app, input) {
      return tokenCall(
        '/api/v2/token/get',
        { app_key: app.clientId, app_secret: app.clientSecret, auth_code: input.code, grant_type: 'authorized_code' },
        input.nowMs,
      )
    },

    async refresh(app, input) {
      return tokenCall(
        '/api/v2/token/refresh',
        { app_key: app.clientId, app_secret: app.clientSecret, refresh_token: input.refreshToken, grant_type: 'refresh_token' },
        input.nowMs,
      )
    },

    async account(app, credential) {
      const data = await call(app, credential, 'GET', '/authorization/202309/shops', { shop: false })
      const shop = (Array.isArray(data?.shops) ? data.shops : []).find((entry: any) => text(entry?.cipher))
      if (!shop) throw new ProviderError('auth', `${PROVIDER} gave this connection no shop`)
      return {
        accountName: text(shop.name),
        account: { shopId: text(shop.id), shopCipher: text(shop.cipher) },
      }
    },

    async syncListings(app, credential, pushes, options) {
      const refs = await findSkus(
        app,
        credential,
        pushes.map((push) => push.sku),
      )
      const results: ListingResult[] = pushes.map((push) => {
        const ref = refs.get(push.sku)
        return ref
          ? { sku: push.sku, outcome: 'updated', externalId: `${ref.productId}:${ref.skuId}`, message: null }
          : { sku: push.sku, outcome: 'not_listed', externalId: null, message: null }
      })
      // One call per product, covering every SKU of it that was pushed.
      const byProduct = new Map<string, number[]>()
      pushes.forEach((push, index) => {
        const ref = refs.get(push.sku)
        if (!ref) return
        byProduct.set(ref.productId, [...(byProduct.get(ref.productId) ?? []), index])
      })
      const fail = (indexes: number[], message: string) => {
        for (const index of indexes) results[index] = { ...results[index], outcome: 'failed', message }
      }
      for (const [productId, indexes] of byProduct) {
        // A SKU pushed twice is sent once, with its last push's numbers.
        const latest = new Map<string, number>()
        for (const index of indexes) latest.set(refs.get(pushes[index].sku)!.skuId, index)
        const product = encodeURIComponent(productId)
        try {
          const data = await call(app, credential, 'POST', `/product/202309/products/${product}/inventory/update`, {
            body: {
              skus: [...latest].map(([skuId, index]) => {
                const ref = refs.get(pushes[index].sku)!
                const quantity = Math.max(0, Math.floor(pushes[index].quantity))
                return { id: skuId, inventory: [{ quantity, ...(ref.warehouseId ? { warehouse_id: ref.warehouseId } : {}) }] }
              }),
            },
          })
          for (const error of Array.isArray(data?.errors) ? data.errors : []) {
            const skuId = text(error?.detail?.sku_id)
            const failed = indexes.filter((index) => !skuId || refs.get(pushes[index].sku)!.skuId === skuId)
            fail(failed, String(text(error?.message) ?? `${PROVIDER} refused the quantity`))
          }
        } catch (error) {
          if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) {
            fail(indexes, error.message)
            continue
          }
          throw error
        }
        if (!options.prices) continue
        const priced = [...latest].filter(([, index]) => results[index].outcome === 'updated')
        if (!priced.length) continue
        try {
          await call(app, credential, 'POST', `/product/202309/products/${product}/prices/update`, {
            body: {
              skus: priced.map(([skuId, index]) => {
                const push = pushes[index]
                const currency = push.currency.toUpperCase()
                return { id: skuId, price: { amount: fromMinor(push.priceMinor, currencyDecimals(currency)), currency } }
              }),
            },
          })
        } catch (error) {
          if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) {
            fail(
              indexes.filter((index) => results[index].outcome === 'updated'),
              error.message,
            )
            continue
          }
          throw error
        }
      }
      return results
    },

    async listOrders(app, credential, query) {
      const data = await call(app, credential, 'POST', '/order/202309/orders/search', {
        query: {
          page_size: String(ORDER_PAGE),
          sort_field: 'update_time',
          sort_order: 'ASC',
          ...(query.cursor ? { page_token: query.cursor } : {}),
        },
        body: { update_time_ge: Math.floor(query.sinceMs / 1000) },
      })
      const orders = (Array.isArray(data?.orders) ? data.orders : []).map(readTiktokOrder)
      return { orders, nextCursor: text(data?.next_page_token) }
    },

    async confirmShipment(app, credential, confirmation) {
      const orderId = confirmation.externalOrderId
      const order = await readOrder(app, credential, orderId)
      const items: any[] = Array.isArray(order?.line_items) ? order.line_items : []
      const tracked = (id: string) => Boolean(text(items.find((item) => String(item?.id) === id)?.tracking_number))
      // Each line names one id per unit; the shipment takes as many as it ships, untracked first.
      const lineItemIds = confirmation.lines.flatMap((line) => {
        const ids = line.externalLineId.split(',').map((id) => id.trim()).filter(Boolean)
        const ordered = [...ids.filter((id) => !tracked(id)), ...ids.filter(tracked)]
        return ordered.slice(0, Math.max(0, line.quantity))
      })
      if (lineItemIds.length > 0 && lineItemIds.every(tracked)) return 'already'
      if (['IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(String(order?.status ?? ''))) return 'already'

      const deliveryOptionId = text(order?.delivery_option_id)
      if (!deliveryOptionId) throw new ProviderError('invalid', `${PROVIDER} order ${orderId} names no delivery option to ship by`)
      const options = await call(
        app,
        credential,
        'GET',
        `/logistics/202309/delivery_options/${encodeURIComponent(deliveryOptionId)}/shipping_providers`,
      )
      const providers: any[] = Array.isArray(options?.shipping_providers) ? options.shipping_providers : []
      const provider = confirmation.carrier ? matchShippingProvider(providers, confirmation.carrier) : null
      if (!provider) {
        const offered = providers.map((entry) => text(entry?.name)).filter(Boolean).slice(0, 12).join(', ')
        throw new ProviderError(
          'invalid',
          `${PROVIDER} has no shipping provider named “${confirmation.carrier ?? ''}” for this order` +
            (offered ? `; it takes: ${offered}` : ''),
        )
      }
      try {
        await call(app, credential, 'POST', `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/packages`, {
          body: {
            tracking_number: confirmation.trackingNumber,
            shipping_provider_id: provider.id,
            ...(lineItemIds.length ? { order_line_item_ids: lineItemIds } : {}),
          },
          retry: false,
        })
      } catch (error) {
        // A refusal for a package TikTok already has reads as done: the order says so.
        if (error instanceof ProviderError && error.kind === 'invalid') {
          const after = await readOrder(app, credential, orderId).catch(() => null)
          const afterItems: any[] = Array.isArray(after?.line_items) ? after.line_items : []
          const shipped = lineItemIds.length
            ? lineItemIds.every((id) => text(afterItems.find((item) => String(item?.id) === id)?.tracking_number))
            : ['IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(String(after?.status ?? ''))
          if (after && shipped) return 'already'
        }
        throw error
      }
      return 'confirmed'
    },
  }
}
