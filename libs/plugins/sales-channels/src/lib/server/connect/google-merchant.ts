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
  CatalogOffer,
  CatalogShippingPrice,
  CatalogStore,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { currencyExponent, type FeedRow } from '../../model/feed-columns'
import type { ProviderConfig } from './config'
import { ChannelApiError, channelFetch, channelJson, errorMessage } from './http'

/**
 * GOOGLE MERCHANT CENTER THROUGH THE MERCHANT API (AGL-3637, phase 2).
 *
 * The Content API for Shopping was retired on 2026-08-18; this speaks the
 * Merchant API's v1 sub-APIs: `accounts` to list what a grant reaches,
 * `datasources` to create the API data source products are inserted into,
 * and `products` to insert and delete product inputs. Field names follow
 * the `products_v1` discovery document: `gtins` is a list, prices are
 * `{ amountMicros, currencyCode }`, availability and condition are
 * upper-case enums.
 *
 * Every value comes from the Google row `resolveOffer` builds for the feed,
 * so a product pushed here is the same product the feed lists, and an offer
 * the feed leaves out is not sent.
 */

export const GOOGLE_ENDPOINTS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  merchantApi: 'https://merchantapi.googleapis.com',
  /** The Merchant API's products service, v1. */
  merchantProducts: 'https://merchantapi.googleapis.com/products/v1',
} as const

export const GOOGLE_CONTENT_SCOPE = 'https://www.googleapis.com/auth/content'

/** The content language every product input is sent in. */
export const GOOGLE_CONTENT_LANGUAGE = 'en'

/** Product inserts in flight at once. */
export const GOOGLE_INSERT_CONCURRENCY = 8

export function googleAuthorizeUrl(config: ProviderConfig, input: { state: string; redirectUri: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CONTENT_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: input.state,
  })
  return `${GOOGLE_ENDPOINTS.authorize}?${params.toString()}`
}

interface TokenAnswer {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

async function tokenRequest(form: Record<string, string>): Promise<TokenAnswer> {
  return channelJson<TokenAnswer>(GOOGLE_ENDPOINTS.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
}

/** Exchanges the consent screen's code for a refresh token and a first access token. */
export async function googleExchangeCode(
  config: ProviderConfig,
  input: { code: string; redirectUri: string },
): Promise<{ refreshToken: string; accessToken: string }> {
  const answer = await tokenRequest({
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  })
  if (!answer.refresh_token || !answer.access_token) {
    throw new ChannelApiError(400, 'Google granted no offline access. Connect again and allow access.')
  }
  return { refreshToken: answer.refresh_token, accessToken: answer.access_token }
}

/** A fresh access token from the stored refresh token. */
export async function googleAccessToken(config: ProviderConfig, refreshToken: string): Promise<string> {
  const answer = await tokenRequest({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  })
  if (!answer.access_token) throw new ChannelApiError(401, 'Google refused the stored grant. Reconnect Google.')
  return answer.access_token
}

/** Revokes the grant. Best effort: a token Google no longer knows is already gone. */
export async function googleRevoke(refreshToken: string): Promise<void> {
  await channelFetch(GOOGLE_ENDPOINTS.revoke, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  })
}

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` })

/** Every Merchant Center account the grant reaches, by id and name. */
export async function googleListAccounts(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const targets: Array<{ id: string; name: string }> = []
  let pageToken = ''
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ pageSize: '250', ...(pageToken ? { pageToken } : {}) })
    const answer = await channelJson<{
      accounts?: Array<{ accountId?: string; accountName?: string; name?: string }>
      nextPageToken?: string
    }>(`${GOOGLE_ENDPOINTS.merchantApi}/accounts/v1/accounts?${query.toString()}`, { headers: bearer(accessToken) })
    for (const account of answer.accounts ?? []) {
      const id = String(account.accountId ?? account.name?.split('/').pop() ?? '')
      if (/^\d{1,20}$/.test(id)) targets.push({ id, name: String(account.accountName ?? id).slice(0, 120) })
    }
    pageToken = answer.nextPageToken ?? ''
    if (!pageToken) break
  }
  return targets.slice(0, 50)
}

/** The country a currency is sold in, for the feed label and the data source's countries. */
const CURRENCY_COUNTRY: Readonly<Record<string, string>> = {
  USD: 'US', CAD: 'CA', GBP: 'GB', AUD: 'AU', NZD: 'NZ', JPY: 'JP', INR: 'IN', MXN: 'MX', BRL: 'BR',
  CHF: 'CH', SEK: 'SE', NOK: 'NO', DKK: 'DK', PLN: 'PL', CZK: 'CZ', ZAR: 'ZA', SGD: 'SG', HKD: 'HK',
  KRW: 'KR', ILS: 'IL', AED: 'AE', TRY: 'TR',
}

/**
 * The feed label products are sent under: the country the store's currency
 * is sold in, else the first country its shipping reaches, else `US`.
 */
export function googleFeedLabel(store: Pick<CatalogStore, 'currency'>, offers: readonly CatalogOffer[]): string {
  const byCurrency = CURRENCY_COUNTRY[store.currency]
  if (byCurrency) return byCurrency
  const shipped = offers.find((offer) => offer.shipping.length)?.shipping[0]?.country
  return shipped && /^[A-Z]{2}$/.test(shipped) ? shipped : 'US'
}

/** Creates the API data source the products are inserted into; answers its resource name. */
export async function googleCreateDataSource(
  accessToken: string,
  input: { accountId: string; feedLabel: string; displayName: string },
): Promise<string> {
  const answer = await channelJson<{ name?: string }>(
    `${GOOGLE_ENDPOINTS.merchantApi}/datasources/v1/accounts/${encodeURIComponent(input.accountId)}/dataSources`,
    {
      method: 'POST',
      headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: input.displayName.slice(0, 100),
        primaryProductDataSource: {
          feedLabel: input.feedLabel,
          contentLanguage: GOOGLE_CONTENT_LANGUAGE,
          ...(/^[A-Z]{2}$/.test(input.feedLabel) ? { countries: [input.feedLabel] } : {}),
        },
      }),
    },
  )
  if (!answer.name) throw new ChannelApiError(502, 'Merchant Center created no data source.')
  return answer.name
}

const text = (row: FeedRow, key: string): string => {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

/** An amount in minor units, as the Merchant API's price. */
export function googlePrice(minor: number, currency: string): { amountMicros: string; currencyCode: string } {
  const exponent = currencyExponent(currency)
  const micros = Math.max(0, Math.round(minor)) * 10 ** (6 - exponent)
  return { amountMicros: String(Math.round(micros)), currencyCode: currency }
}

const AVAILABILITY: Readonly<Record<CatalogOffer['availability'], string>> = {
  in_stock: 'IN_STOCK',
  out_of_stock: 'OUT_OF_STOCK',
  backorder: 'BACKORDER',
}

export interface GoogleProductInput {
  offerId: string
  contentLanguage: string
  feedLabel: string
  productAttributes: Record<string, unknown>
}

/**
 * The product input for one offer the Google feed includes, from that feed's
 * row: what the feed leaves blank is left out here too.
 */
export function googleProductInput(
  offer: CatalogOffer,
  row: FeedRow,
  context: { store: CatalogStore; feedLabel: string },
): GoogleProductInput {
  const { store } = context
  const attributes: Record<string, unknown> = {
    title: text(row, 'title'),
    description: text(row, 'description'),
    link: text(row, 'link'),
    imageLink: text(row, 'image_link'),
    availability: AVAILABILITY[offer.availability] ?? 'IN_STOCK',
    condition: text(row, 'condition').toUpperCase() || 'NEW',
    price: googlePrice(offer.priceMinor, store.currency),
  }
  const images = row['additional_image_link']
  if (Array.isArray(images) && images.length) attributes['additionalImageLinks'] = images
  if (text(row, 'sale_price') && offer.salePriceMinor !== undefined) {
    attributes['salePrice'] = googlePrice(offer.salePriceMinor, store.currency)
  }
  const optional: Array<[string, string]> = [
    ['brand', 'brand'],
    ['mpn', 'mpn'],
    ['googleProductCategory', 'google_product_category'],
    ['itemGroupId', 'item_group_id'],
    ['color', 'color'],
    ['size', 'size'],
  ]
  for (const [attribute, column] of optional) {
    const value = text(row, column)
    if (value) attributes[attribute] = value
  }
  if (text(row, 'gtin')) attributes['gtins'] = [text(row, 'gtin')]
  if (text(row, 'identifier_exists') === 'no') attributes['identifierExists'] = false
  if (text(row, 'product_type')) attributes['productTypes'] = [text(row, 'product_type')]
  if (text(row, 'shipping_weight') && offer.weightGrams) {
    attributes['shippingWeight'] = { value: offer.weightGrams, unit: 'g' }
  }
  if (text(row, 'shipping_length') && offer.dimensionsCm) {
    attributes['shippingLength'] = { value: offer.dimensionsCm.length, unit: 'cm' }
    attributes['shippingWidth'] = { value: offer.dimensionsCm.width, unit: 'cm' }
    attributes['shippingHeight'] = { value: offer.dimensionsCm.height, unit: 'cm' }
  }
  const shipping = row['shipping']
  if (Array.isArray(shipping) && shipping.length) {
    attributes['shipping'] = (shipping as CatalogShippingPrice[]).map((entry) => ({
      country: entry.country,
      service: entry.service,
      price: googlePrice(entry.priceMinor, store.currency),
    }))
  }
  return {
    offerId: offer.id,
    contentLanguage: GOOGLE_CONTENT_LANGUAGE,
    feedLabel: context.feedLabel,
    productAttributes: attributes,
  }
}

/** Inserts (or replaces) one product input in the data source. */
export async function googleInsertProduct(
  accessToken: string,
  input: { accountId: string; dataSource: string; product: GoogleProductInput },
): Promise<void> {
  const query = new URLSearchParams({ dataSource: input.dataSource })
  await channelJson(
    `${GOOGLE_ENDPOINTS.merchantProducts}/accounts/${encodeURIComponent(input.accountId)}/productInputs:insert?${query.toString()}`,
    {
      method: 'POST',
      headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(input.product),
    },
  )
}

/**
 * A product input's resource segment: `contentLanguage~feedLabel~offerId`,
 * unpadded base64url, the encoding the API reads whatever the offer id holds.
 */
export function googleProductInputSegment(feedLabel: string, offerId: string): string {
  return Buffer.from(`${GOOGLE_CONTENT_LANGUAGE}~${feedLabel}~${offerId}`, 'utf8').toString('base64url')
}

/** Deletes one product input from the data source. A product Google does not hold is already gone. */
export async function googleDeleteProduct(
  accessToken: string,
  input: { accountId: string; dataSource: string; feedLabel: string; offerId: string },
): Promise<void> {
  const query = new URLSearchParams({ dataSource: input.dataSource })
  const response = await channelFetch(
    `${GOOGLE_ENDPOINTS.merchantProducts}/accounts/${encodeURIComponent(input.accountId)}/productInputs/${googleProductInputSegment(input.feedLabel, input.offerId)}?${query.toString()}`,
    { method: 'DELETE', headers: bearer(accessToken) },
  )
  if (response.ok || response.status === 404) return
  throw new ChannelApiError(response.status, await errorMessage(response))
}
