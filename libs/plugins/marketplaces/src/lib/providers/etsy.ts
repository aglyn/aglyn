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

import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  currencyDecimals,
  fromMinor,
  text,
  timeMs,
  type ListingPush,
  type ListingResult,
  type MarketplaceApp,
  type MarketplaceCredential,
  type MarketplaceGrant,
  type MarketplaceOrder,
  type MarketplaceOrderLine,
  type MarketplaceOrderState,
  type MarketplaceProvider,
} from './provider'

/**
 * ETSY (AGL-3638), through Open API v3 with the shop owner's OAuth 2.0
 * grant (authorization code with PKCE, S256).
 *
 * - **Credentials**: every call carries an `x-api-key` of the app's
 *   keystring and shared secret joined by a colon (Etsy's current form) and
 *   the bearer token. Access tokens last
 *   an hour and begin with the user id they were issued for
 *   (`{user_id}.{token}`); refresh tokens last 90 days and are replaced on
 *   every refresh. Etsy has no sandbox, so `app.sandbox` changes nothing and
 *   no order is a test.
 * - **Listings** (link only; Etsy listings are not published from here):
 *   Etsy cannot search listings by SKU, so the shop's active and sold-out
 *   listings are walked once per sync, with their inventory, to map each
 *   SKU to its listing. Each listing a push touches has its inventory read
 *   fresh and written back WHOLE, because Etsy replaces a listing's
 *   inventory with what it is sent: every product, property value and
 *   offering the sync does not change goes back exactly as read. A sold-out
 *   listing is not revived (Etsy charges a listing fee to renew it).
 * - **Orders** are receipts, read by last change, oldest first; their lines
 *   are transactions. Etsy's fees live on the shop's payment ledger, not the
 *   receipt, so an order's fees are not known here.
 * - **Shipments**: tracking is added to the whole receipt (Etsy has no
 *   per-line shipment); a receipt that already carries the tracking code is
 *   `already`.
 */

export const ETSY_CONNECT_URL = 'https://www.etsy.com/oauth/connect'
export const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
export const ETSY_API_BASE = 'https://api.etsy.com/v3/application'

/** Listings (read and write), receipts (read and write: tracking), and the shop. */
export const ETSY_SCOPES = ['listings_r', 'listings_w', 'transactions_r', 'transactions_w', 'shops_r'] as const

const LISTING_PAGE = 100
const RECEIPT_PAGE = 100
/** 100 pages of 100: the most listings one sync walks. */
const LISTING_PAGES_MAX = 100

/**
 * Etsy's `carrier_name` values (Fulfillment tutorial's supported carriers),
 * by the carrier as a merchant writes it. Anything else goes as `other`.
 */
const ETSY_CARRIERS: Readonly<Record<string, string>> = {
  usps: 'usps',
  ups: 'ups',
  fedex: 'fedex',
  dhl: 'dhl',
  'dhl express': 'dhl',
  'dhl ecommerce': 'dhl-global-mail-asia',
  'dhl global mail': 'dhl-global-mail',
  'dhl germany': 'dhl-germany',
  'canada post': 'canada-post',
  'royal mail': 'royal-mail',
  'australia post': 'australia-post',
  ontrac: 'ontrac',
  lasership: 'lasership',
  amazon: 'amazon',
  'amazon logistics': 'amazon',
  purolator: 'purolator',
  hermes: 'hermes',
  evri: 'hermes',
  dpd: 'dpd',
  'dpd uk': 'dpd-uk',
  gls: 'gls',
  postnl: 'postnl',
  'deutsche post': 'deutsch-post',
  'la poste': 'la-poste-colissimo',
  colissimo: 'la-poste-colissimo',
  'japan post': 'japan-post',
  'china post': 'china-post',
  sendle: 'sendle',
}

/** Etsy's `carrier_name` for the carrier the merchant named. */
export function etsyCarrier(carrier: string | null): string {
  const named = text(carrier)
  return (named && ETSY_CARRIERS[named.toLowerCase().replace(/[\s_-]+/g, ' ')]) || 'other'
}

/** The user id an Etsy access token was issued for: the digits before its first dot. */
export function etsyUserId(accessToken: string): string | null {
  const match = /^(\d+)\./.exec(String(accessToken ?? ''))
  return match ? match[1] : null
}

/**
 * An Etsy Money object (`{ amount, divisor, currency_code }`) in minor units
 * of `decimals`, by integer arithmetic: `amount / divisor` major units,
 * rounded half away from zero where the divisor is finer than the currency.
 */
export function etsyMinor(money: any, decimals: number): number {
  const amount = Number(money?.amount)
  const divisor = Number(money?.divisor)
  if (!Number.isInteger(amount) || !Number.isInteger(divisor) || divisor <= 0) return 0
  const scale = 10 ** decimals
  if (divisor === scale) return amount
  const scaled = Math.abs(amount) * scale
  const rounded = Math.floor((2 * scaled + divisor) / (2 * divisor))
  return amount < 0 ? -rounded : rounded
}

/**
 * Where an Etsy receipt stands. Canceled or fully refunded is `canceled`; a
 * receipt the seller marked shipped is `shipped`; a paid one (`paid`,
 * `completed`, `partially refunded`) is the merchant's to ship; anything
 * else (`open`, `payment processing`) waits.
 */
export function etsyReceiptState(raw: any): MarketplaceOrderState {
  const status = String(raw?.status ?? '').toLowerCase()
  if (status === 'canceled' || status === 'fully refunded') return 'canceled'
  if (raw?.is_shipped === true) return 'shipped'
  const paid = raw?.is_paid === true || status === 'paid' || status === 'completed' || status === 'partially refunded'
  return paid && status !== 'open' && status !== 'payment processing' ? 'unshipped' : 'pending'
}

/** An Etsy receipt as the engine reads it. */
export function readEtsyReceipt(raw: any): MarketplaceOrder {
  const currency = String(raw?.grandtotal?.currency_code ?? raw?.subtotal?.currency_code ?? 'USD').toUpperCase()
  const decimals = currencyDecimals(currency)
  const lines: MarketplaceOrderLine[] = (Array.isArray(raw?.transactions) ? raw.transactions : []).map((transaction: any) => {
    const productSku = (Array.isArray(transaction?.product_data) ? transaction.product_data : [])
      .map((entry: any) => text(entry?.sku))
      .find(Boolean)
    return {
      externalLineId: String(transaction?.transaction_id ?? ''),
      sku: text(transaction?.sku) ?? productSku ?? null,
      title: text(transaction?.title) ?? '',
      quantity: Math.max(1, Math.round(Number(transaction?.quantity) || 1)),
      // A transaction's price is per unit.
      unitPriceMinor: etsyMinor(transaction?.price, decimals),
    }
  })
  const placedAtMs = timeMs(raw?.created_timestamp) ?? timeMs(raw?.create_timestamp) ?? 0
  return {
    externalId: String(raw?.receipt_id ?? ''),
    displayRef: `#${raw?.receipt_id ?? ''}`,
    state: etsyReceiptState(raw),
    fulfilledByMarketplace: false,
    placedAtMs,
    updatedAtMs: timeMs(raw?.updated_timestamp) ?? timeMs(raw?.update_timestamp) ?? placedAtMs,
    currency,
    lines,
    shippingMinor: etsyMinor(raw?.total_shipping_cost, decimals),
    taxMinor: etsyMinor(raw?.total_tax_cost, decimals),
    discountMinor: Math.abs(etsyMinor(raw?.discount_amt, decimals)),
    totalMinor: etsyMinor(raw?.grandtotal, decimals),
    // Etsy's fees are on the shop's payment ledger, not the receipt.
    fees: null,
    buyerName: text(raw?.name),
    shipTo: text(raw?.first_line)
      ? {
          name: text(raw?.name),
          line1: text(raw?.first_line),
          line2: text(raw?.second_line),
          city: text(raw?.city),
          state: text(raw?.state),
          postalCode: text(raw?.zip),
          country: text(raw?.country_iso)?.toUpperCase() ?? null,
        }
      : null,
    testMode: false,
  }
}

/** The SKUs a listing carries, from its inventory or its `skus` list. */
const listingSkus = (listing: any): string[] => {
  const fromInventory = (Array.isArray(listing?.inventory?.products) ? listing.inventory.products : [])
    .map((product: any) => text(product?.sku))
    .filter((sku: string | null): sku is string => Boolean(sku))
  const listed = (Array.isArray(listing?.skus) ? listing.skus : []).map(text).filter((sku: string | null): sku is string => Boolean(sku))
  return [...new Set([...fromInventory, ...listed])]
}

/** A Money object or a plain number as the decimal number Etsy's inventory write takes. */
const decimalPrice = (price: any): number => {
  if (typeof price === 'number') return price
  const amount = Number(price?.amount)
  const divisor = Number(price?.divisor)
  return Number.isFinite(amount) && Number.isFinite(divisor) && divisor > 0 ? amount / divisor : 0
}

export const ETSY_MESSAGES = {
  notListed: 'No active Etsy listing has this SKU.',
  soldOut:
    'This Etsy listing is sold out. Renew it on Etsy (Etsy charges its listing fee) and the next sync sets its quantity.',
  pricesDiffer:
    'This Etsy listing has one price for every variation, and the store’s variations differ in price. Set prices to vary by variation on Etsy.',
} as const

/**
 * The inventory `updateListingInventory` takes: the listing's inventory as
 * read, every product and property kept, with each offering of a product
 * whose SKU is pushed set to that push's quantity (and price). Etsy refuses
 * the fields it reports but does not take (`product_id`, `offering_id`,
 * `is_deleted`, `scale_name`) and wants each price as a decimal number.
 *
 * Where quantity (or price) does not vary by a property, every product of
 * the listing shares one value: the smallest pushed quantity, so the listing
 * never offers more than the store has, and a price only when every push on
 * the listing agrees. An offering at zero that Etsy turned off is turned
 * back on when stock returns.
 */
export function etsyInventoryWrite(
  inventory: any,
  pushes: readonly ListingPush[],
  options: { prices: boolean },
): { body: Record<string, unknown> | null; refusal: string | null } {
  const products: any[] = (Array.isArray(inventory?.products) ? inventory.products : []).filter((product: any) => product?.is_deleted !== true)
  const bySku = new Map<string, ListingPush>()
  for (const push of pushes) bySku.set(push.sku, push)
  const quantityShared = products.length > 1 && !(Array.isArray(inventory?.quantity_on_property) && inventory.quantity_on_property.length)
  const priceShared = products.length > 1 && !(Array.isArray(inventory?.price_on_property) && inventory.price_on_property.length)
  const sharedQuantity = Math.min(...pushes.map((push) => Math.max(0, push.quantity)))
  const pushedPrices = new Set(pushes.map((push) => `${push.priceMinor}|${push.currency.toUpperCase()}`))
  if (options.prices && priceShared && pushedPrices.size > 1) return { body: null, refusal: ETSY_MESSAGES.pricesDiffer }
  const sharedPrice = pushes[0] ? Number(fromMinor(pushes[0].priceMinor, currencyDecimals(pushes[0].currency))) : 0

  const written = products.map((product: any) => {
    const push = bySku.get(String(product?.sku ?? ''))
    const touched = Boolean(push) || quantityShared || (options.prices && priceShared)
    return {
      sku: product?.sku ?? '',
      property_values: (Array.isArray(product?.property_values) ? product.property_values : []).map((value: any) => ({
        property_id: value?.property_id,
        value_ids: value?.value_ids ?? [],
        scale_id: value?.scale_id ?? null,
        property_name: value?.property_name,
        values: value?.values ?? [],
      })),
      offerings: (Array.isArray(product?.offerings) ? product.offerings : [])
        .filter((offering: any) => offering?.is_deleted !== true)
        .map((offering: any) => {
          const readQuantity = Math.max(0, Math.round(Number(offering?.quantity) || 0))
          const quantity = !touched ? readQuantity : quantityShared ? sharedQuantity : push ? Math.max(0, push.quantity) : readQuantity
          const price =
            options.prices && (push || priceShared)
              ? priceShared
                ? sharedPrice
                : Number(fromMinor(push!.priceMinor, currencyDecimals(push!.currency)))
              : decimalPrice(offering?.price)
          const revived = readQuantity === 0 && offering?.is_enabled === false && quantity > 0 && touched
          return {
            price,
            quantity,
            is_enabled: revived ? true : offering?.is_enabled !== false,
            readiness_state_id: offering?.readiness_state_id ?? null,
          }
        }),
    }
  })
  return {
    body: {
      products: written,
      price_on_property: inventory?.price_on_property ?? [],
      quantity_on_property: inventory?.quantity_on_property ?? [],
      sku_on_property: inventory?.sku_on_property ?? [],
      ...(Array.isArray(inventory?.readiness_state_on_property) ? { readiness_state_on_property: inventory.readiness_state_on_property } : {}),
    },
    refusal: null,
  }
}

export function createEtsyProvider(deps: { http: ProviderHttp }): MarketplaceProvider {
  const apiKey = (app: MarketplaceApp) => `${app.clientId}:${app.clientSecret}`

  const call = (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { body?: unknown; retry?: boolean } = {},
  ) =>
    providerRequest(deps.http, {
      provider: 'Etsy',
      method,
      url: `${ETSY_API_BASE}${path}`,
      headers: {
        'x-api-key': apiKey(app),
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.retry === false ? { retry: false } : {}),
    })

  const token = async (app: MarketplaceApp, form: Record<string, string>, nowMs: number): Promise<MarketplaceGrant> => {
    const answer = await providerRequest(deps.http, {
      provider: 'Etsy',
      method: 'POST',
      url: ETSY_TOKEN_URL,
      headers: { 'x-api-key': apiKey(app), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    })
    const accessToken = text(answer?.access_token)
    if (!accessToken) throw new ProviderError('auth', 'Etsy answered without an access token')
    const expiresIn = Number(answer?.expires_in)
    const userId = etsyUserId(accessToken)
    return {
      accessToken,
      refreshToken: text(answer?.refresh_token),
      expiresAtMs: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
      ...(userId ? { account: { userId } } : {}),
    }
  }

  const shopIdOf = (credential: MarketplaceCredential): string => {
    const shopId = text(credential.account.shopId)
    if (!shopId) throw new ProviderError('auth', 'This Etsy connection has no shop; connect again')
    return shopId
  }

  /** SKU → the listings that carry it, from the shop's active and sold-out listings. */
  const listingsBySku = async (app: MarketplaceApp, credential: MarketplaceCredential, shopId: string) => {
    const found = new Map<string, Array<{ listingId: string; state: string }>>()
    for (const state of ['active', 'sold_out']) {
      for (let page = 0; page < LISTING_PAGES_MAX; page += 1) {
        const query = new URLSearchParams({ state, limit: String(LISTING_PAGE), offset: String(page * LISTING_PAGE), includes: 'Inventory' })
        const answer = await call(app, credential, 'GET', `/shops/${encodeURIComponent(shopId)}/listings?${query.toString()}`)
        const results: any[] = Array.isArray(answer?.results) ? answer.results : []
        for (const listing of results) {
          if (listing?.listing_id === undefined) continue
          for (const sku of listingSkus(listing)) {
            const entries = found.get(sku) ?? []
            if (!entries.some((entry) => entry.listingId === String(listing.listing_id))) {
              entries.push({ listingId: String(listing.listing_id), state })
            }
            found.set(sku, entries)
          }
        }
        if (results.length < LISTING_PAGE) break
      }
    }
    return found
  }

  return {
    id: 'etsy',

    authorizeUrl(app, input) {
      const query = new URLSearchParams({
        response_type: 'code',
        redirect_uri: input.redirectUri,
        scope: ETSY_SCOPES.join(' '),
        client_id: app.clientId,
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: 'S256',
      })
      return `${ETSY_CONNECT_URL}?${query.toString()}`
    },

    async exchangeCode(app, input) {
      return token(
        app,
        {
          grant_type: 'authorization_code',
          client_id: app.clientId,
          redirect_uri: input.redirectUri,
          code: input.code,
          code_verifier: input.codeVerifier,
        },
        input.nowMs,
      )
    },

    async refresh(app, input) {
      return token(app, { grant_type: 'refresh_token', client_id: app.clientId, refresh_token: input.refreshToken }, input.nowMs)
    },

    async account(app, credential) {
      const userId = text(credential.account.userId) ?? etsyUserId(credential.accessToken)
      if (!userId) throw new ProviderError('auth', 'Etsy did not say which account this connection reaches')
      const answer = await call(app, credential, 'GET', `/users/${encodeURIComponent(userId)}/shops`)
      // getShopByOwnerUserId answers the shop itself; a list shape is read too.
      const shop = Array.isArray(answer?.results) ? answer.results[0] : answer
      const shopId = text(shop?.shop_id)
      if (!shopId) throw new ProviderError('invalid', 'This Etsy account has no shop')
      return { accountName: text(shop?.shop_name), account: { shopId, userId } }
    },

    async syncListings(app, credential, pushes, options) {
      const shopId = shopIdOf(credential)
      const results = new Map<ListingPush, ListingResult>()
      const map = await listingsBySku(app, credential, shopId)

      // Pushes grouped by the active listing that carries their SKU.
      const byListing = new Map<string, ListingPush[]>()
      for (const push of pushes) {
        const entries = map.get(push.sku) ?? []
        const active = entries.find((entry) => entry.state === 'active')
        if (active) {
          byListing.set(active.listingId, [...(byListing.get(active.listingId) ?? []), push])
          continue
        }
        if (entries.length) {
          // Sold out: zero already says what the store says; more needs a renewal on Etsy.
          results.set(
            push,
            push.quantity <= 0
              ? { sku: push.sku, outcome: 'updated', externalId: entries[0].listingId, message: null }
              : { sku: push.sku, outcome: 'failed', externalId: entries[0].listingId, message: ETSY_MESSAGES.soldOut },
          )
          continue
        }
        results.set(push, { sku: push.sku, outcome: 'not_listed', message: ETSY_MESSAGES.notListed })
      }

      for (const [listingId, listed] of byListing) {
        const settle = (outcome: ListingResult['outcome'], message: string | null) => {
          for (const push of listed) results.set(push, { sku: push.sku, outcome, externalId: listingId, message })
        }
        try {
          // Read fresh: the write replaces the whole inventory, so it starts from what Etsy holds now.
          const inventory = await call(app, credential, 'GET', `/listings/${encodeURIComponent(listingId)}/inventory`)
          const { body, refusal } = etsyInventoryWrite(inventory, listed, options)
          if (!body) {
            settle('failed', refusal)
            continue
          }
          await call(app, credential, 'PUT', `/listings/${encodeURIComponent(listingId)}/inventory`, { body })
          settle('updated', null)
        } catch (error) {
          if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) {
            settle('failed', error.message)
            continue
          }
          throw error
        }
      }

      return pushes.map((push) => results.get(push) ?? { sku: push.sku, outcome: 'failed', message: 'Etsy did not answer for this SKU.' })
    },

    async listOrders(app, credential, query) {
      const shopId = shopIdOf(credential)
      const offset = Math.max(0, Number(query.cursor ?? 0) || 0)
      const params = new URLSearchParams({
        // Etsy refuses a min_last_modified before 2000-01-01.
        min_last_modified: String(Math.max(946_684_800, Math.floor(query.sinceMs / 1000))),
        limit: String(RECEIPT_PAGE),
        offset: String(offset),
        sort_on: 'updated',
        sort_order: 'asc',
      })
      const answer = await call(app, credential, 'GET', `/shops/${encodeURIComponent(shopId)}/receipts?${params.toString()}`)
      const raw: any[] = Array.isArray(answer?.results) ? answer.results : []
      const count = Number(answer?.count)
      const next = offset + raw.length
      const more = raw.length > 0 && (Number.isFinite(count) ? next < count : raw.length === RECEIPT_PAGE)
      return { orders: raw.map(readEtsyReceipt), nextCursor: more ? String(next) : null }
    },

    async confirmShipment(app, credential, confirmation) {
      const shopId = shopIdOf(credential)
      const path = `/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(confirmation.externalOrderId)}`
      const tracking = confirmation.trackingNumber.trim()
      const receipt = await call(app, credential, 'GET', path)
      if (
        (Array.isArray(receipt?.shipments) ? receipt.shipments : []).some(
          (shipment: any) => String(shipment?.tracking_code ?? '').trim() === tracking,
        )
      ) {
        return 'already'
      }
      try {
        await call(app, credential, 'POST', `${path}/tracking`, {
          body: { tracking_code: tracking, carrier_name: etsyCarrier(confirmation.carrier), send_bcc: false },
          retry: false,
        })
        return 'confirmed'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid' && /already/i.test(error.message)) return 'already'
        throw error
      }
    },
  }
}
