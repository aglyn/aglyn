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

import type {
  PluginShippingAddress,
  PluginShippingParcel,
  PluginShippingQuote,
} from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import { randomUUID } from 'node:crypto'
import { decimalToCents, providerErrorDetail, type ProviderFetch } from './http'
import { ShippingProviderError } from './types'

/**
 * SHIPPERHQ, THE MERCHANT'S CHECKOUT RATE RULES (AGL-3632).
 *
 * Not a label platform: ShipperHQ answers what a shopper is CHARGED for
 * shipping, after the merchant's own rules there — carriers, markups,
 * free-shipping offers, packing, origins. Labels are still bought on the
 * workspace's label platform.
 *
 * The Rates API is GraphQL at `api.shipperhq.com/v2/graphql`:
 *
 * 1. `createSecretToken(api_key, auth_code)` turns the website's API key and
 *    authentication code into a JWT good for thirty days, kept in memory per
 *    connection here and minted again on the first refusal.
 * 2. `retrieveShippingQuote(ratingInfo)` with the headers
 *    `X-ShipperHQ-Secret-Token`, `X-ShipperHQ-Scope` (LIVE, TEST,
 *    DEVELOPMENT or INTEGRATION) and `X-ShipperHQ-Session`, answering
 *    carriers with their `shippingRates`.
 *
 * The query and the input shapes are the ones ShipperHQ's own client library
 * sends (`shipperhq/library-graphql`). Checkout asks with parcels, not
 * products, so each parcel is one cart item of its weight and its share of
 * the cart's value: rules on weight, price, destination and carrier apply;
 * rules on a product's shipping group do not, because the parcel carries no
 * SKU.
 */

export const SHIPPERHQ_GRAPHQL_URL = 'https://api.shipperhq.com/v2/graphql'

export type ShipperHqScope = 'LIVE' | 'TEST' | 'DEVELOPMENT' | 'INTEGRATION'

export interface ShipperHqCredentials {
  apiKey: string
  authCode: string
  scope: ShipperHqScope
  weightUnit: 'lb' | 'kg'
}

const CREATE_SECRET_TOKEN = `mutation CreateSecretToken($api_key: String!, $auth_code: String!){
  createSecretToken(api_key: $api_key, auth_code: $auth_code){
    token
  }
}`

const RETRIEVE_SHIPPING_QUOTE = `query retrieveShippingQuote($ratingInfo: RMSRatingInfo!) {
  retrieveShippingQuote(ratingInfo: $ratingInfo) {
    transactionId
    carriers {
      carrierCode
      carrierTitle
      shippingRates {
        code
        title
        totalCharges
      }
      error {
        errorCode
        internalErrorMessage
        externalErrorMessage
        priority
      }
    }
    errors {
      errorCode
      internalErrorMessage
      externalErrorMessage
      priority
    }
  }
}`

interface GraphQlAnswer<T> {
  data?: T | null
  errors?: Array<{ message?: string }> | null
}

interface ShipperHqError {
  errorCode?: string | number
  externalErrorMessage?: string
  internalErrorMessage?: string
}

interface ShipperHqQuote {
  transactionId?: string
  carriers?: Array<{
    carrierCode?: string
    carrierTitle?: string
    shippingRates?: Array<{ code?: string; title?: string; totalCharges?: number | string }> | null
    error?: ShipperHqError | null
  }> | null
  errors?: ShipperHqError[] | null
}

export interface ShipperHqQuoteInput {
  to: PluginShippingAddress
  parcels: PluginShippingParcel[]
  currency: string
  valueCents: number
  websiteUrl?: string
  signal?: AbortSignal
}

export interface ShipperHqQuoteResult {
  quotes: PluginShippingQuote[]
  /** What ShipperHQ said instead of a rate, in its own words. */
  messages: string[]
}

/** How long a minted token is reused before another is asked for (it lives thirty days). */
const TOKEN_REUSE_MS = 24 * 60 * 60 * 1000

export interface ShipperHqEngine {
  /** Mints a token, which proves the key and code. */
  verify(credentials: ShipperHqCredentials): Promise<void>
  quote(cacheKey: string, credentials: ShipperHqCredentials, input: ShipperHqQuoteInput): Promise<ShipperHqQuoteResult>
}

export function createShipperHqEngine(options: { fetchImpl?: ProviderFetch } = {}): ShipperHqEngine {
  const fetchImpl = options.fetchImpl ?? fetch
  const tokens = new Map<string, { token: string; atMs: number }>()

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(SHIPPERHQ_GRAPHQL_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
        ...(signal ? { signal } : {}),
      })
    } catch {
      throw new ShippingProviderError('shipperhq could not be reached', 0, 'shipperhq', 'ShipperHQ could not be reached.')
    }
    const text = await response.text()
    let parsed: GraphQlAnswer<T> | undefined
    try {
      parsed = text ? (JSON.parse(text) as GraphQlAnswer<T>) : undefined
    } catch {
      parsed = undefined
    }
    if (!response.ok || !parsed?.data) {
      const detail =
        parsed?.errors?.map((one) => one?.message).filter(Boolean).join(' ').slice(0, 300) ||
        providerErrorDetail(parsed)
      throw shipperHqError(`ShipperHQ refused the request (${response.status})`, response.ok ? 502 : response.status, detail)
    }
    return parsed.data
  }

  async function mint(credentials: ShipperHqCredentials): Promise<string> {
    const data = await graphql<{ createSecretToken?: { token?: string } | null }>(
      CREATE_SECRET_TOKEN,
      { api_key: credentials.apiKey, auth_code: credentials.authCode },
      {},
    )
    const token = String(data?.createSecretToken?.token ?? '')
    if (!token) throw shipperHqError('ShipperHQ issued no token', 401, 'ShipperHQ did not accept that API key and authentication code.')
    return token
  }

  async function tokenFor(cacheKey: string, credentials: ShipperHqCredentials, fresh: boolean): Promise<string> {
    const held = tokens.get(cacheKey)
    if (!fresh && held && Date.now() - held.atMs < TOKEN_REUSE_MS) return held.token
    const token = await mint(credentials)
    tokens.set(cacheKey, { token, atMs: Date.now() })
    return token
  }

  return {
    async verify(credentials) {
      await mint(credentials)
    },

    async quote(cacheKey, credentials, input) {
      const ratingInfo = ratingInfoFor(credentials, input)
      const ask = async (fresh: boolean) =>
        graphql<{ retrieveShippingQuote?: ShipperHqQuote | null }>(
          RETRIEVE_SHIPPING_QUOTE,
          { ratingInfo },
          {
            'X-ShipperHQ-Secret-Token': await tokenFor(cacheKey, credentials, fresh),
            'X-ShipperHQ-Scope': credentials.scope,
            'X-ShipperHQ-Session': randomUUID(),
          },
          input.signal,
        )
      let data
      try {
        data = await ask(false)
      } catch (error) {
        // A token ShipperHQ no longer honors (expired, the code rotated) is
        // minted again once; a second refusal is the merchant's to fix.
        if (!(error instanceof ShippingProviderError) || (error.status !== 401 && error.status !== 403)) throw error
        data = await ask(true)
      }
      return readShipperHqQuote(data?.retrieveShippingQuote, input.currency)
    },
  }
}

function shipperHqError(message: string, status: number, detail?: string): ShippingProviderError {
  return new ShippingProviderError(message, status, 'shipperhq', detail)
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** The rating request ShipperHQ's client library sends, one item per parcel. */
export function ratingInfoFor(credentials: ShipperHqCredentials, input: ShipperHqQuoteInput): Record<string, unknown> {
  const parcels = input.parcels.length ? input.parcels : [{ weightGrams: 0 }]
  const totalGrams = parcels.reduce((sum, parcel) => sum + Math.max(0, parcel.weightGrams), 0)
  const value = Math.max(0, Math.round(input.valueCents)) / 100
  const items = parcels.map((parcel, index) => {
    const share = totalGrams > 0 ? parcel.weightGrams / totalGrams : 1 / parcels.length
    const price = round2(value * share)
    const weight =
      credentials.weightUnit === 'kg'
        ? round2(Math.max(0, parcel.weightGrams) / 1000)
        : round2(Math.max(0, parcel.weightGrams) / 453.59237)
    return {
      itemId: String(index + 1),
      sku: `parcel-${index + 1}`,
      name: `Parcel ${index + 1}`,
      storePrice: price,
      weight: Math.max(0.01, weight),
      qty: 1,
      type: 'SIMPLE',
      basePrice: price,
      taxInclBasePrice: price,
      taxInclStorePrice: price,
      discountPercent: 0,
      discountedBasePrice: price,
      discountedStorePrice: price,
      discountedTaxInclBasePrice: price,
      discountedTaxInclStorePrice: price,
      freeShipping: false,
      fixedPrice: false,
      fixedWeight: false,
      attributes: [],
    }
  })
  return {
    cart: { items, declaredValue: value, freeShipping: false },
    destination: {
      country: input.to.country,
      region: input.to.state ?? '',
      city: input.to.city ?? '',
      street: input.to.line1 ?? '',
      street2: input.to.line2 ?? '',
      zipcode: input.to.postalCode ?? '',
    },
    customer: { customerGroup: 'NOT LOGGED IN' },
    cartType: 'STD',
    siteDetails: {
      appVersion: '1.0.0',
      ecommerceCart: 'Aglyn',
      ecommerceVersion: '1',
      websiteUrl: input.websiteUrl ?? '',
      ipAddress: '',
    },
  }
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** ShipperHQ's answer as checkout quotes, in the currency the cart is priced in. */
export function readShipperHqQuote(quote: ShipperHqQuote | null | undefined, currency: string): ShipperHqQuoteResult {
  const quotes: PluginShippingQuote[] = []
  const messages: string[] = []
  for (const error of quote?.errors ?? []) {
    const text = String(error?.externalErrorMessage ?? error?.internalErrorMessage ?? '').trim()
    if (text) messages.push(text.slice(0, 300))
  }
  for (const carrier of quote?.carriers ?? []) {
    const carrierTitle = String(carrier?.carrierTitle ?? carrier?.carrierCode ?? '').trim()
    const carrierCode = slug(String(carrier?.carrierCode ?? carrierTitle))
    if (carrier?.error) {
      const text = String(carrier.error.externalErrorMessage ?? carrier.error.internalErrorMessage ?? '').trim()
      if (text) messages.push(text.slice(0, 300))
    }
    for (const rate of carrier?.shippingRates ?? []) {
      const code = slug(String(rate?.code ?? ''))
      const amount = Number(rate?.totalCharges)
      if (!carrierCode || !code || !Number.isFinite(amount) || amount < 0) continue
      const title = String(rate?.title ?? rate?.code ?? '').trim()
      quotes.push({
        serviceKey: `${carrierCode}:${code}`,
        carrier: carrierTitle || carrierCode,
        service: title || code,
        label: carrierTitle && title && !title.toLowerCase().includes(carrierTitle.toLowerCase()) ? `${carrierTitle} ${title}` : title || carrierTitle,
        amountCents: decimalToCents(amount),
        currency: currency.toLowerCase(),
      })
    }
  }
  return {
    quotes: quotes.sort((a, b) => a.amountCents - b.amountCents || a.serviceKey.localeCompare(b.serviceKey)),
    messages,
  }
}
