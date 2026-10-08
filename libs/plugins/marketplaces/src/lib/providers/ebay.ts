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
  toMinor,
  type ListingPush,
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
 * EBAY (AGL-3638), through the Sell APIs with the seller's OAuth
 * authorization code grant.
 *
 * - **Consent**: eBay's `redirect_uri` is not a URL but the app's RuName
 *   (`app.extra.ruName`), which eBay maps to the accept URL registered on
 *   it. The engine's own callback address is that accept URL, so it is never
 *   sent. Access tokens last two hours; the refresh token's own lifetime
 *   comes back as `refresh_token_expires_in`, and a refresh answers no new
 *   refresh token (the old one keeps working).
 * - **Listings** (Inventory API): a listing is found by its SKU's inventory
 *   item and published offer. eBay's Inventory API cannot see a listing made
 *   on eBay's website or by another tool until it is migrated into the
 *   Inventory API, so such a SKU reads as not listed. Quantities and prices
 *   go through `bulk_update_price_quantity`, 25 SKUs a call. Publishing makes
 *   the inventory item, picks eBay's suggested category, applies the
 *   seller's first business policy of each kind and first enabled inventory
 *   location, and creates and publishes a fixed-price offer.
 * - **Orders** (Fulfillment API): orders modified since the last read, 200 a
 *   page, with `TAX_BREAKDOWN` so the total includes the tax eBay collects
 *   and remits. The order's own `totalMarketplaceFee` is its fees.
 * - **Shipments**: one shipping fulfillment per parcel, looked up by
 *   tracking number first so a confirmation sent again is `already`.
 */

export const EBAY_HOSTS = {
  live: { auth: 'https://auth.ebay.com', api: 'https://api.ebay.com', apiz: 'https://apiz.ebay.com' },
  sandbox: { auth: 'https://auth.sandbox.ebay.com', api: 'https://api.sandbox.ebay.com', apiz: 'https://apiz.sandbox.ebay.com' },
} as const

/**
 * The scopes the consent page asks for: the base scope (Taxonomy's category
 * suggestions), listings, orders and shipments, the seller's business
 * policies (read only), and the seller's user id and name (Identity).
 */
export const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
] as const

const DEFAULT_MARKETPLACE = 'EBAY_US'

/** The language each eBay marketplace's listing text is written in, for `Content-Language`. */
const MARKETPLACE_LANGUAGES: Readonly<Record<string, string>> = {
  EBAY_US: 'en-US',
  EBAY_MOTORS_US: 'en-US',
  EBAY_CA: 'en-CA',
  EBAY_GB: 'en-GB',
  EBAY_AU: 'en-AU',
  EBAY_IE: 'en-IE',
  EBAY_DE: 'de-DE',
  EBAY_AT: 'de-AT',
  EBAY_CH: 'de-CH',
  EBAY_FR: 'fr-FR',
  EBAY_IT: 'it-IT',
  EBAY_ES: 'es-ES',
  EBAY_NL: 'nl-NL',
  EBAY_PL: 'pl-PL',
}

/** eBay takes up to 25 SKUs in one bulk read and one bulk price-and-quantity update. */
const EBAY_BULK_MAX = 25
const ORDER_PAGE = 200

/**
 * eBay's shipping carrier codes (Trading API `ShippingCarrierCodeType`, which
 * the Fulfillment API names), by the carrier as a merchant writes it.
 * Anything else goes as `Other`, eBay's code for a carrier it does not list.
 */
const EBAY_CARRIERS: Readonly<Record<string, string>> = {
  usps: 'USPS',
  ups: 'UPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  'dhl express': 'DHL',
  'dhl global mail': 'DHLGlobalMail',
  'dhl ecommerce': 'DHLGlobalMail',
  ontrac: 'ONTRACK',
  lasership: 'Prestige',
  'royal mail': 'RoyalMail',
  'australia post': 'AustraliaPost',
  'deutsche post': 'DeutschePost',
  hermes: 'Hermes',
  evri: 'Hermes',
  dpd: 'DPD',
  gls: 'GLS',
  postnl: 'PostNL',
  colissimo: 'Colissimo',
  'japan post': 'JapanPost',
  'china post': 'ChinaPost',
  parcelforce: 'Parcelforce',
  yodel: 'Yodel',
}

/** eBay's carrier code for the carrier the merchant named. */
export function ebayCarrier(carrier: string | null): string {
  const named = text(carrier)
  return (named && EBAY_CARRIERS[named.toLowerCase().replace(/[\s_-]+/g, ' ')]) || 'Other'
}

const hostsOf = (app: MarketplaceApp) => (app.sandbox ? EBAY_HOSTS.sandbox : EBAY_HOSTS.live)

const marketplaceOf = (app: MarketplaceApp, credential?: MarketplaceCredential): string =>
  text(credential?.account.marketplaceId) ?? text(app.extra['marketplaceId']) ?? DEFAULT_MARKETPLACE

const languageOf = (marketplaceId: string): string => MARKETPLACE_LANGUAGES[marketplaceId] ?? 'en-US'

const ruNameOf = (app: MarketplaceApp): string => {
  const ruName = text(app.extra['ruName'])
  if (!ruName) throw new ProviderError('invalid', 'eBay needs the app’s RuName (EBAY ruName) to connect')
  return ruName
}

const basicAuth = (app: MarketplaceApp): string =>
  `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`, 'utf8').toString('base64')}`

/** A grant from eBay's token answer; a refresh carries no refresh token, so the old one stands. */
function readGrant(answer: any, nowMs: number): MarketplaceGrant {
  const accessToken = text(answer?.access_token)
  if (!accessToken) throw new ProviderError('auth', 'eBay answered without an access token')
  const expiresIn = Number(answer?.expires_in)
  const refreshExpiresIn = Number(answer?.refresh_token_expires_in)
  return {
    accessToken,
    refreshToken: text(answer?.refresh_token),
    expiresAtMs: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
    refreshExpiresAtMs: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? nowMs + refreshExpiresIn * 1000 : null,
  }
}

/** An eBay `Amount` in minor units of its own currency; 0 when absent. */
const amountMinor = (amount: any, decimals: number): number => toMinor(amount?.value, decimals) ?? 0

/** The first refusal in a bulk answer's per-item `errors`, in eBay's words. */
const firstError = (errors: unknown): string | null => {
  const first = Array.isArray(errors) ? errors[0] : null
  return text(first?.longMessage) ?? text(first?.message)
}

/**
 * Where an eBay order stands. A cancellation or full refund is `canceled`;
 * a fulfillment eBay has (all of it, or some: `IN_PROGRESS`) is `shipped`;
 * otherwise a paid order is the merchant's to ship and anything else waits.
 */
export function ebayOrderState(raw: any): MarketplaceOrderState {
  const payment = String(raw?.orderPaymentStatus ?? '')
  if (String(raw?.cancelStatus?.cancelState ?? '') === 'CANCELED' || payment === 'FULLY_REFUNDED') return 'canceled'
  const fulfillment = String(raw?.orderFulfillmentStatus ?? '')
  if (fulfillment === 'FULFILLED' || fulfillment === 'IN_PROGRESS') return 'shipped'
  return payment === 'PAID' || payment === 'PARTIALLY_REFUNDED' ? 'unshipped' : 'pending'
}

function readAddress(shipTo: any): MarketplaceAddress | null {
  const address = shipTo?.contactAddress
  if (!shipTo || !address) return null
  return {
    name: text(shipTo.fullName),
    line1: text(address.addressLine1),
    line2: text(address.addressLine2),
    city: text(address.city),
    state: text(address.stateOrProvince),
    postalCode: text(address.postalCode),
    country: text(address.countryCode)?.toUpperCase() ?? null,
    phone: text(shipTo.primaryPhone?.phoneNumber),
  }
}

/** An eBay order (Fulfillment API, read with `fieldGroups=TAX_BREAKDOWN`) as the engine reads it. */
export function readEbayOrder(raw: any, sandbox: boolean): MarketplaceOrder {
  const pricing = raw?.pricingSummary ?? {}
  const currency = String(pricing.total?.currency ?? pricing.priceSubtotal?.currency ?? 'USD').toUpperCase()
  const decimals = currencyDecimals(currency)
  const rawLines: any[] = Array.isArray(raw?.lineItems) ? raw.lineItems : []
  const lines: MarketplaceOrderLine[] = rawLines.map((line) => {
    const quantity = Math.max(1, Math.round(Number(line?.quantity) || 1))
    return {
      externalLineId: String(line?.lineItemId ?? ''),
      sku: text(line?.sku),
      title: text(line?.title) ?? '',
      quantity,
      // lineItemCost is the unit price times the quantity, before discounts.
      unitPriceMinor: Math.round(amountMinor(line?.lineItemCost, decimals) / quantity),
    }
  })
  // Tax eBay collects and remits is itemized per line; other tax is the order's.
  const remitted = rawLines.reduce(
    (sum, line) =>
      sum +
      (Array.isArray(line?.ebayCollectAndRemitTaxes) ? line.ebayCollectAndRemitTaxes : []).reduce(
        (lineSum: number, tax: any) => lineSum + amountMinor(tax?.amount, decimals),
        0,
      ),
    0,
  )
  // eBay reports discounts as negative amounts.
  const discountMinor = Math.abs(amountMinor(pricing.priceDiscount, decimals)) + Math.abs(amountMinor(pricing.deliveryDiscount, decimals))
  const shipTo = raw?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo
  const fee = raw?.totalMarketplaceFee
  return {
    externalId: String(raw?.orderId ?? ''),
    displayRef: String(raw?.orderId ?? ''),
    state: ebayOrderState(raw),
    fulfilledByMarketplace: false,
    placedAtMs: timeMs(raw?.creationDate) ?? 0,
    updatedAtMs: timeMs(raw?.lastModifiedDate) ?? timeMs(raw?.creationDate) ?? 0,
    currency,
    lines,
    shippingMinor: amountMinor(pricing.deliveryCost, decimals),
    taxMinor: remitted > 0 ? remitted : amountMinor(pricing.tax, decimals),
    discountMinor,
    totalMinor: amountMinor(pricing.total, decimals),
    fees: fee && toMinor(fee.value, decimals) !== null ? [{ label: 'eBay fees', amountMinor: amountMinor(fee, decimals) }] : null,
    buyerName: text(shipTo?.fullName) ?? text(raw?.buyer?.username),
    shipTo: readAddress(shipTo),
    testMode: sandbox,
  }
}

/** eBay's condition value for the store's condition. */
const conditionOf = (condition: ListingPush['condition']): string =>
  condition === 'refurbished' ? 'SELLER_REFURBISHED' : condition === 'used' ? 'USED_EXCELLENT' : 'NEW'

/** The product identifiers eBay takes, from the GTIN's length (ISBN-13s start 978 or 979). */
function productCodes(gtin: string | undefined): Record<string, string[]> {
  const digits = String(gtin ?? '').replace(/\D/g, '')
  if (digits.length === 12) return { upc: [digits] }
  if (digits.length === 13) return /^97[89]/.test(digits) ? { isbn: [digits], ean: [digits] } : { ean: [digits] }
  if (digits.length === 8) return { ean: [digits] }
  return {}
}

/** The inventory item `createOrReplaceInventoryItem` takes for a push. */
export function ebayInventoryItem(push: ListingPush): Record<string, unknown> {
  const aspects: Record<string, string[]> = {}
  for (const [name, value] of Object.entries(push.options)) {
    if (text(name) && text(value)) aspects[name.trim()] = [value.trim()]
  }
  if (push.brand && !aspects['Brand']) aspects['Brand'] = [push.brand]
  const packageWeightAndSize: Record<string, unknown> = {}
  if (push.weightGrams && push.weightGrams > 0) packageWeightAndSize['weight'] = { value: push.weightGrams, unit: 'GRAM' }
  if (push.dimensionsCm) {
    packageWeightAndSize['dimensions'] = { ...push.dimensionsCm, unit: 'CENTIMETER' }
  }
  return {
    condition: conditionOf(push.condition),
    availability: { shipToLocationAvailability: { quantity: Math.max(0, push.quantity) } },
    product: {
      title: push.title.slice(0, 80),
      description: push.description,
      imageUrls: push.imageUrls.slice(0, 24),
      ...(Object.keys(aspects).length ? { aspects } : {}),
      ...(push.brand ? { brand: push.brand } : {}),
      ...(push.mpn ? { mpn: push.mpn } : {}),
      ...productCodes(push.gtin),
    },
    ...(Object.keys(packageWeightAndSize).length ? { packageWeightAndSize } : {}),
  }
}

/** What a publish needs from the seller's account, read once per sync. */
interface PublishContext {
  policies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string } | null
  merchantLocationKey: string | null
  categoryTreeId: string | null
}

export const EBAY_MESSAGES = {
  notInInventoryApi:
    'eBay has no listing under this SKU that its Inventory API can reach. A listing made on eBay’s website or by another tool stays out of reach until it is moved into eBay’s Inventory API.',
  noLiveOffer: 'eBay holds this SKU but has no live listing for it.',
  noImage: 'eBay needs at least one photo to list a product. Add one to the product.',
  noStock: 'Not published: there are no units to offer.',
  noPolicies:
    'eBay needs a shipping, a payment and a return business policy before a product can be listed. Create them in eBay’s Seller Hub (Account › Business policies).',
  noLocation:
    'eBay needs an inventory location (where items ship from) before a product can be listed. Add one in eBay’s Seller Hub.',
  noCategory: 'eBay suggested no category for this product’s title.',
} as const

export function createEbayProvider(deps: { http: ProviderHttp }): MarketplaceProvider {
  const call = (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { body?: unknown; retry?: boolean; language?: string; host?: 'api' | 'apiz' } = {},
  ) =>
    providerRequest(deps.http, {
      provider: 'eBay',
      method,
      url: `${hostsOf(app)[options.host ?? 'api']}${path}`,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.language ? { 'Content-Language': options.language } : {}),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.retry === false ? { retry: false } : {}),
    })

  const token = async (app: MarketplaceApp, form: Record<string, string>, nowMs: number) =>
    readGrant(
      await providerRequest(deps.http, {
        provider: 'eBay',
        method: 'POST',
        url: `${hostsOf(app).api}/identity/v1/oauth2/token`,
        headers: {
          Authorization: basicAuth(app),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(form).toString(),
      }),
      nowMs,
    )

  /** The SKU's offers on this marketplace; none (eBay answers 404) is an empty list. */
  const offersFor = async (app: MarketplaceApp, credential: MarketplaceCredential, sku: string, marketplaceId: string) => {
    try {
      const answer = await call(app, credential, 'GET', `/sell/inventory/v1/offer?${new URLSearchParams({ sku, marketplace_id: marketplaceId }).toString()}`)
      return (Array.isArray(answer?.offers) ? answer.offers : []).filter(
        (offer: any) => !offer?.marketplaceId || offer.marketplaceId === marketplaceId,
      )
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-found') return []
      throw error
    }
  }

  const readPublishContext = async (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    marketplaceId: string,
  ): Promise<PublishContext> => {
    const query = new URLSearchParams({ marketplace_id: marketplaceId }).toString()
    const [fulfillment, payment, returns, locations, tree] = await Promise.all([
      call(app, credential, 'GET', `/sell/account/v1/fulfillment_policy?${query}`),
      call(app, credential, 'GET', `/sell/account/v1/payment_policy?${query}`),
      call(app, credential, 'GET', `/sell/account/v1/return_policy?${query}`),
      call(app, credential, 'GET', '/sell/inventory/v1/location?limit=100'),
      call(app, credential, 'GET', `/commerce/taxonomy/v1/get_default_category_tree_id?${query}`),
    ])
    const fulfillmentPolicyId = text(fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId)
    const paymentPolicyId = text(payment?.paymentPolicies?.[0]?.paymentPolicyId)
    const returnPolicyId = text(returns?.returnPolicies?.[0]?.returnPolicyId)
    const location = (Array.isArray(locations?.locations) ? locations.locations : []).find(
      (entry: any) => text(entry?.merchantLocationKey) && String(entry?.merchantLocationStatus ?? 'ENABLED') !== 'DISABLED',
    )
    return {
      policies: fulfillmentPolicyId && paymentPolicyId && returnPolicyId ? { fulfillmentPolicyId, paymentPolicyId, returnPolicyId } : null,
      merchantLocationKey: text(location?.merchantLocationKey),
      categoryTreeId: text(tree?.categoryTreeId),
    }
  }

  /** Lists a push as a new fixed-price eBay listing; `offerId` reuses an unpublished offer. */
  const publish = async (
    app: MarketplaceApp,
    credential: MarketplaceCredential,
    push: ListingPush,
    marketplaceId: string,
    context: () => Promise<PublishContext>,
    unpublishedOfferId: string | null,
  ): Promise<ListingResult> => {
    const failed = (message: string): ListingResult => ({ sku: push.sku, outcome: 'failed', message })
    if (!push.imageUrls.length) return failed(EBAY_MESSAGES.noImage)
    if (push.quantity <= 0) return { sku: push.sku, outcome: 'not_listed', message: EBAY_MESSAGES.noStock }
    const found = await context()
    if (!found.policies) return failed(EBAY_MESSAGES.noPolicies)
    if (!found.merchantLocationKey) return failed(EBAY_MESSAGES.noLocation)
    const language = languageOf(marketplaceId)
    try {
      // createOrReplaceInventoryItem is a PUT of the whole item: sending it twice is harmless.
      await call(app, credential, 'PUT', `/sell/inventory/v1/inventory_item/${encodeURIComponent(push.sku)}`, {
        body: ebayInventoryItem(push),
        language,
      })
      const suggestions = found.categoryTreeId
        ? await call(
            app,
            credential,
            'GET',
            `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(found.categoryTreeId)}/get_category_suggestions?${new URLSearchParams({ q: push.title.slice(0, 350) }).toString()}`,
          )
        : null
      const categoryId = text(suggestions?.categorySuggestions?.[0]?.category?.categoryId)
      if (!categoryId) return failed(EBAY_MESSAGES.noCategory)
      const decimals = currencyDecimals(push.currency)
      const offer = {
        sku: push.sku,
        marketplaceId,
        format: 'FIXED_PRICE',
        listingDuration: 'GTC',
        availableQuantity: push.quantity,
        categoryId,
        listingDescription: push.description,
        listingPolicies: found.policies,
        merchantLocationKey: found.merchantLocationKey,
        pricingSummary: { price: { value: fromMinor(push.priceMinor, decimals), currency: push.currency.toUpperCase() } },
      }
      let offerId = unpublishedOfferId
      if (offerId) {
        await call(app, credential, 'PUT', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { body: offer, language })
      } else {
        const created = await call(app, credential, 'POST', '/sell/inventory/v1/offer', { body: offer, language, retry: false })
        offerId = text(created?.offerId)
        if (!offerId) return failed('eBay did not create the offer.')
      }
      const published = await call(app, credential, 'POST', `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, {
        retry: false,
      })
      return { sku: push.sku, outcome: 'created', externalId: text(published?.listingId), message: null }
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'invalid' || error.kind === 'not-found')) return failed(error.message)
      throw error
    }
  }

  return {
    id: 'ebay',

    authorizeUrl(app, input) {
      const query = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: ruNameOf(app),
        response_type: 'code',
        scope: EBAY_SCOPES.join(' '),
        state: input.state,
      })
      return `${hostsOf(app).auth}/oauth2/authorize?${query.toString()}`
    },

    async exchangeCode(app, input) {
      return token(app, { grant_type: 'authorization_code', code: input.code, redirect_uri: ruNameOf(app) }, input.nowMs)
    },

    async refresh(app, input) {
      return token(app, { grant_type: 'refresh_token', refresh_token: input.refreshToken, scope: EBAY_SCOPES.join(' ') }, input.nowMs)
    },

    async account(app, credential) {
      const user = await call(app, credential, 'GET', '/commerce/identity/v1/user/', { host: 'apiz' })
      const userId = text(user?.userId)
      if (!userId) throw new ProviderError('auth', 'eBay did not say which account this connection reaches')
      return {
        accountName: text(user?.username),
        account: { sellerId: userId, marketplaceId: marketplaceOf(app, credential) },
      }
    },

    async syncListings(app, credential, pushes, options) {
      const marketplaceId = marketplaceOf(app, credential)
      const results = new Map<ListingPush, ListingResult>()
      let contextPromise: Promise<PublishContext> | null = null
      const context = () => (contextPromise ??= readPublishContext(app, credential, marketplaceId))

      // Which SKUs eBay's Inventory API holds, 25 a call.
      const held = new Map<string, boolean>()
      const skus = [...new Set(pushes.map((push) => push.sku).filter(Boolean))]
      for (let index = 0; index < skus.length; index += EBAY_BULK_MAX) {
        const chunk = skus.slice(index, index + EBAY_BULK_MAX)
        let answer: any = null
        try {
          answer = await call(app, credential, 'POST', '/sell/inventory/v1/bulk_get_inventory_item', {
            body: { requests: chunk.map((sku) => ({ sku })) },
          })
        } catch (error) {
          if (!(error instanceof ProviderError && error.kind === 'not-found')) throw error
        }
        for (const response of Array.isArray(answer?.responses) ? answer.responses : []) {
          if (Number(response?.statusCode) === 200 && text(response?.sku)) held.set(String(response.sku), true)
        }
      }

      // What each held SKU's published offer is; a held SKU without one may be published.
      const updates: Array<{ push: ListingPush; offers: any[] }> = []
      for (const push of pushes) {
        if (!held.get(push.sku)) {
          results.set(
            push,
            options.publish
              ? await publish(app, credential, push, marketplaceId, context, null)
              : { sku: push.sku, outcome: 'not_listed', message: EBAY_MESSAGES.notInInventoryApi },
          )
          continue
        }
        const offers = await offersFor(app, credential, push.sku, marketplaceId)
        const live = offers.filter((offer: any) => offer?.status === 'PUBLISHED' && text(offer?.offerId))
        if (live.length) {
          updates.push({ push, offers: live })
          continue
        }
        const unpublished = offers.find((offer: any) => offer?.status !== 'PUBLISHED' && offer?.format !== 'AUCTION')
        results.set(
          push,
          options.publish
            ? await publish(app, credential, push, marketplaceId, context, text(unpublished?.offerId))
            : { sku: push.sku, outcome: 'not_listed', message: EBAY_MESSAGES.noLiveOffer },
        )
      }

      // Quantities (and prices) of live listings, 25 SKUs a call.
      for (let index = 0; index < updates.length; index += EBAY_BULK_MAX) {
        const chunk = updates.slice(index, index + EBAY_BULK_MAX)
        const answer = await call(app, credential, 'POST', '/sell/inventory/v1/bulk_update_price_quantity', {
          body: {
            requests: chunk.map(({ push, offers }) => ({
              sku: push.sku,
              shipToLocationAvailability: { quantity: Math.max(0, push.quantity) },
              offers: offers.map((offer: any) => ({
                offerId: String(offer.offerId),
                availableQuantity: Math.max(0, push.quantity),
                ...(options.prices
                  ? {
                      price: {
                        value: fromMinor(push.priceMinor, currencyDecimals(push.currency)),
                        currency: push.currency.toUpperCase(),
                      },
                    }
                  : {}),
              })),
            })),
          },
        })
        const refusals = new Map<string, string>()
        for (const response of Array.isArray(answer?.responses) ? answer.responses : []) {
          const status = Number(response?.statusCode)
          if (status >= 200 && status < 300) continue
          const sku = text(response?.sku)
          if (sku && !refusals.has(sku)) refusals.set(sku, firstError(response?.errors) ?? `eBay answered ${status}`)
        }
        for (const { push, offers } of chunk) {
          const refusal = refusals.get(push.sku)
          results.set(
            push,
            refusal
              ? { sku: push.sku, outcome: 'failed', message: refusal }
              : { sku: push.sku, outcome: 'updated', externalId: text(offers[0]?.listing?.listingId), message: null },
          )
        }
      }

      return pushes.map((push) => results.get(push) ?? { sku: push.sku, outcome: 'failed', message: 'eBay did not answer for this SKU.' })
    },

    async listOrders(app, credential, query) {
      const offset = Math.max(0, Number(query.cursor ?? 0) || 0)
      const params = new URLSearchParams({
        filter: `lastmodifieddate:[${new Date(query.sinceMs).toISOString()}..]`,
        limit: String(ORDER_PAGE),
        offset: String(offset),
        fieldGroups: 'TAX_BREAKDOWN',
      })
      const answer = await call(app, credential, 'GET', `/sell/fulfillment/v1/order?${params.toString()}`)
      const raw: any[] = Array.isArray(answer?.orders) ? answer.orders : []
      const total = Number(answer?.total)
      const next = offset + raw.length
      const more = raw.length > 0 && (Number.isFinite(total) ? next < total : Boolean(answer?.next))
      return { orders: raw.map((order) => readEbayOrder(order, app.sandbox)), nextCursor: more ? String(next) : null }
    },

    async confirmShipment(app, credential, confirmation) {
      const path = `/sell/fulfillment/v1/order/${encodeURIComponent(confirmation.externalOrderId)}/shipping_fulfillment`
      const existing = await call(app, credential, 'GET', path)
      const tracking = confirmation.trackingNumber.trim()
      if (
        (Array.isArray(existing?.fulfillments) ? existing.fulfillments : []).some(
          (fulfillment: any) => String(fulfillment?.shipmentTrackingNumber ?? '').trim() === tracking,
        )
      ) {
        return 'already'
      }
      try {
        await call(app, credential, 'POST', path, {
          body: {
            lineItems: confirmation.lines.map((line) => ({ lineItemId: line.externalLineId, quantity: line.quantity })),
            shippedDate: new Date(confirmation.shippedAtMs).toISOString(),
            shippingCarrierCode: ebayCarrier(confirmation.carrier),
            trackingNumber: tracking,
          },
          retry: false,
        })
        return 'confirmed'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid' && /already|fulfilled|shipped/i.test(error.message)) return 'already'
        throw error
      }
    },
  }
}
