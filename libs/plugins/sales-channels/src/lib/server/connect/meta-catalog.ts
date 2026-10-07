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
import type { CatalogShippingPrice, CatalogStore } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { formatFeedPrice, type FeedRow } from '../../model/feed-columns'
import type { ProviderConfig } from './config'
import { ChannelApiError, channelFetch, channelJson } from './http'

/**
 * A META CATALOG THROUGH THE GRAPH API (AGL-3637, phase 2).
 *
 * Facebook Login grants `catalog_management` and `business_management`; the
 * short-lived user token is exchanged at once for a long-lived one (about
 * sixty days), which is what is sealed and stored, with its expiry, so the
 * card can ask for a reconnect before it lapses. Products go to the
 * catalog's `items_batch` edge as `PRODUCT_ITEM` requests — `UPDATE`, which
 * upserts, for every offer the Meta feed includes, `DELETE` for one it no
 * longer does — in chunks well under the edge's ceiling.
 *
 * Every call carries `appsecret_proof`, the HMAC of the token under the app
 * secret, so a token lifted from storage is useless without the secret.
 */

export const META_HOSTS = {
  dialog: 'https://www.facebook.com',
  graph: 'https://graph.facebook.com',
} as const

export const META_SCOPES = ['catalog_management', 'business_management'] as const

/** Requests per `items_batch` call: the edge takes 5,000 and recommends staying under 3,000. */
export const META_BATCH_SIZE = 3000

/** How close to its expiry a token is called due for a reconnect. */
export const META_RECONNECT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const graph = (config: ProviderConfig, path: string) => `${META_HOSTS.graph}/${config.graphVersion}/${path}`

export const appSecretProof = (config: ProviderConfig, token: string): string =>
  createHmac('sha256', config.clientSecret).update(token).digest('hex')

export function metaAuthorizeUrl(config: ProviderConfig, input: { state: string; redirectUri: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    response_type: 'code',
    scope: META_SCOPES.join(','),
  })
  return `${META_HOSTS.dialog}/${config.graphVersion}/dialog/oauth?${params.toString()}`
}

interface TokenAnswer {
  access_token?: string
  expires_in?: number
}

/**
 * Exchanges the dialog's code for a user token, and that for a long-lived
 * one. Answers the long-lived token and its expiry, epoch ms.
 */
export async function metaExchangeCode(
  config: ProviderConfig,
  input: { code: string; redirectUri: string; nowMs: number },
): Promise<{ accessToken: string; expiresAtMs: number | null }> {
  const short = await channelJson<TokenAnswer>(
    `${graph(config, 'oauth/access_token')}?${new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    }).toString()}`,
  )
  if (!short.access_token) throw new ChannelApiError(400, 'Facebook granted no access. Connect again.')
  const long = await channelJson<TokenAnswer>(
    `${graph(config, 'oauth/access_token')}?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      fb_exchange_token: short.access_token,
    }).toString()}`,
  )
  if (!long.access_token) throw new ChannelApiError(400, 'Facebook did not extend the grant. Connect again.')
  return {
    accessToken: long.access_token,
    expiresAtMs: Number(long.expires_in) > 0 ? input.nowMs + Number(long.expires_in) * 1000 : null,
  }
}

const authorized = (token: string) => ({
  Authorization: `Bearer ${token}`,
})

const proofQuery = (config: ProviderConfig, token: string) =>
  new URLSearchParams({ appsecret_proof: appSecretProof(config, token) })

/** Every catalog the businesses the member manages own, by id and name. */
export async function metaListCatalogs(
  config: ProviderConfig,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const query = proofQuery(config, token)
  query.set('fields', 'id,name')
  query.set('limit', '50')
  const businesses = await channelJson<{ data?: Array<{ id?: string; name?: string }> }>(
    `${graph(config, 'me/businesses')}?${query.toString()}`,
    { headers: authorized(token) },
  )
  const targets: Array<{ id: string; name: string }> = []
  for (const business of (businesses.data ?? []).slice(0, 20)) {
    if (!business.id || !/^\d{1,30}$/.test(business.id)) continue
    const catalogQuery = proofQuery(config, token)
    catalogQuery.set('fields', 'id,name')
    catalogQuery.set('limit', '100')
    const catalogs = await channelJson<{ data?: Array<{ id?: string; name?: string }> }>(
      `${graph(config, `${business.id}/owned_product_catalogs`)}?${catalogQuery.toString()}`,
      { headers: authorized(token) },
    )
    for (const catalog of catalogs.data ?? []) {
      if (!catalog.id || !/^\d{1,30}$/.test(catalog.id)) continue
      if (targets.some((held) => held.id === catalog.id)) continue
      const name = catalog.name ? `${catalog.name}${business.name ? ` (${business.name})` : ''}` : catalog.id
      targets.push({ id: catalog.id, name: name.slice(0, 120) })
    }
  }
  return targets.slice(0, 50)
}

/** Revokes the app's permissions. Best effort. */
export async function metaRevoke(config: ProviderConfig, token: string): Promise<void> {
  await channelFetch(`${graph(config, 'me/permissions')}?${proofQuery(config, token).toString()}`, {
    method: 'DELETE',
    headers: authorized(token),
  })
}

const text = (row: FeedRow, key: string): string => {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

/** The `items_batch` data for one offer the Meta feed includes, from that feed's row. */
export function metaItemData(row: FeedRow, store: Pick<CatalogStore, 'currency'>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: text(row, 'id'),
    title: text(row, 'title'),
    description: text(row, 'description'),
    availability: text(row, 'availability'),
    condition: text(row, 'condition'),
    price: text(row, 'price'),
    link: text(row, 'link'),
    image_link: text(row, 'image_link'),
  }
  for (const column of [
    'sale_price',
    'brand',
    'gtin',
    'mpn',
    'google_product_category',
    'product_type',
    'item_group_id',
    'color',
    'size',
    'shipping_weight',
  ]) {
    const value = text(row, column)
    if (value) data[column] = value
  }
  const images = row['additional_image_link']
  if (Array.isArray(images) && images.length) data['additional_image_link'] = images
  const quantity = text(row, 'quantity_to_sell_on_facebook')
  if (quantity) data['quantity_to_sell_on_facebook'] = Number(quantity)
  const shipping = row['shipping']
  if (Array.isArray(shipping) && shipping.length) {
    data['shipping'] = (shipping as CatalogShippingPrice[]).map((entry) => ({
      country: entry.country,
      service: entry.service,
      price: formatFeedPrice(entry.priceMinor, store.currency),
    }))
  }
  return data
}

export type MetaBatchRequest =
  | { method: 'UPDATE'; data: Record<string, unknown> }
  | { method: 'DELETE'; data: { id: string } }

export interface MetaBatchOutcome {
  /** The retailer ids Meta refused, with its first sentence for each. */
  refused: Map<string, string>
  handles: string[]
}

/** Posts one chunk of requests to the catalog's `items_batch` edge. */
export async function metaPostBatch(
  config: ProviderConfig,
  token: string,
  input: { catalogId: string; requests: readonly MetaBatchRequest[] },
): Promise<MetaBatchOutcome> {
  const body = new URLSearchParams({
    item_type: 'PRODUCT_ITEM',
    allow_upsert: 'true',
    requests: JSON.stringify(input.requests),
    appsecret_proof: appSecretProof(config, token),
  })
  const answer = await channelJson<{
    handles?: string[]
    validation_status?: Array<{ retailer_id?: string; errors?: Array<{ message?: string }> }>
  }>(graph(config, `${encodeURIComponent(input.catalogId)}/items_batch`), {
    method: 'POST',
    headers: { ...authorized(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const refused = new Map<string, string>()
  for (const status of answer.validation_status ?? []) {
    const message = status.errors?.find((error) => error?.message)?.message
    if (status.retailer_id && message) refused.set(String(status.retailer_id), String(message).slice(0, 300))
  }
  return { refused, handles: (answer.handles ?? []).map(String) }
}

/** Requests in chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}
