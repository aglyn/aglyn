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

import { callProvider, centsToAmount, ReviewPlatformError, type ProviderFetch } from './http'

/**
 * Yotpo Reviews through Yotpo's Core API (v3) with the merchant's OWN app
 * key and secret key (AGL-3699), both from the Yotpo Reviews admin's
 * settings. No app of Aglyn's. This is not the API the loyalty plugin's
 * Yotpo connector speaks: that is Yotpo Loyalty & Referrals, a separate
 * product keyed by a GUID and a loyalty API key, so nothing it stores can
 * open this one.
 *
 *   POST /core/v3/stores/{app_key}/access_tokens   { secret } → access_token
 *   POST /core/v3/stores/{app_key}/products        409 when it already exists
 *   POST /core/v3/stores/{app_key}/orders          409 when it already exists
 *
 * Yotpo sends the review request itself, after the delay set in the
 * merchant's Yotpo account, for an order with a `success` fulfillment and a
 * fulfillment date. An order's products must already be known to Yotpo, so
 * each is created first; one Yotpo knows answers 409, which is fine.
 */

export const YOTPO_API_BASE = 'https://api.yotpo.com/core/v3'

const VENDOR = 'Yotpo'

export interface YotpoCredentials {
  appKey: string
  secretKey: string
  fetchImpl?: ProviderFetch
}

/** One of a store's Core API collections: `access_tokens`, `products` or `orders`. */
const store = (appKey: string, collection: 'access_tokens' | 'products' | 'orders') =>
  [YOTPO_API_BASE, 'stores', encodeURIComponent(appKey), collection].join('/')

/** A token for the merchant's store. Also how a key pair is checked before it is kept. */
export async function yotpoAccessToken(credentials: YotpoCredentials): Promise<string> {
  const answer = await callProvider<{ access_token?: unknown }>({
    vendor: VENDOR,
    method: 'POST',
    url: store(credentials.appKey, 'access_tokens'),
    json: { secret: credentials.secretKey },
    fetchImpl: credentials.fetchImpl,
  })
  const token = typeof answer.body?.access_token === 'string' ? answer.body.access_token.trim() : ''
  if (!token) throw new ReviewPlatformError(VENDOR, 502, 'Yotpo issued no access token', answer.body)
  return token
}

export interface YotpoOrderLine {
  productId: string
  name: string
  sku: string | null
  quantity: number
  unitCents: number
}

export interface YotpoOrder {
  externalId: string
  orderDateIso: string
  currency: string
  totalCents: number
  customer: { email: string; firstName: string; lastName: string }
  lines: YotpoOrderLine[]
  fulfillment: { externalId: string; dateIso: string }
}

/**
 * Sends one fulfilled order so Yotpo asks its buyer for a review. Answers
 * `created` or `exists` (Yotpo already had it — a repeat, which is the
 * idempotent outcome).
 */
export async function sendYotpoOrder(credentials: YotpoCredentials, order: YotpoOrder): Promise<'created' | 'exists'> {
  const token = await yotpoAccessToken(credentials)
  const headers = { 'X-Yotpo-Token': token }
  const products = new Map<string, YotpoOrderLine>()
  for (const line of order.lines) if (!products.has(line.productId)) products.set(line.productId, line)
  for (const line of products.values()) {
    await callProvider({
      vendor: VENDOR,
      method: 'POST',
      url: store(credentials.appKey, 'products'),
      headers,
      accept: [409],
      json: {
        product: {
          external_id: line.productId,
          name: line.name.slice(0, 255) || 'Item',
          price: centsToAmount(line.unitCents),
          currency: order.currency.toUpperCase(),
          ...(line.sku ? { sku: line.sku } : {}),
        },
      },
      fetchImpl: credentials.fetchImpl,
    })
  }
  const answer = await callProvider({
    vendor: VENDOR,
    method: 'POST',
    url: store(credentials.appKey, 'orders'),
    headers,
    accept: [409],
    json: {
      order: {
        external_id: order.externalId,
        order_date: order.orderDateIso,
        currency: order.currency.toUpperCase(),
        total_price: centsToAmount(order.totalCents),
        customer: {
          email: order.customer.email,
          first_name: order.customer.firstName,
          last_name: order.customer.lastName,
        },
        line_items: order.lines.map((line) => ({
          external_product_id: line.productId,
          quantity: line.quantity,
          total_price: centsToAmount(line.unitCents * line.quantity),
        })),
        fulfillments: [
          {
            external_id: order.fulfillment.externalId,
            fulfillment_date: order.fulfillment.dateIso,
            status: 'success',
            fulfilled_items: order.lines.map((line) => ({
              external_product_id: line.productId,
              quantity: line.quantity,
            })),
          },
        ],
      },
    },
    fetchImpl: credentials.fetchImpl,
  })
  return answer.status === 409 ? 'exists' : 'created'
}
