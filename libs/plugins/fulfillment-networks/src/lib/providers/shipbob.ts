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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import type {
  FulfillmentNetworkProvider,
  NetworkCredential,
  NetworkOrder,
  NetworkOrderRequest,
  NetworkShipment,
  NetworkStock,
} from './provider'

/**
 * SHIPBOB (AGL-3634), through its REST API 1.0 with the merchant's OAuth
 * grant (`server/oauth.ts`).
 *
 * - Every order call names the channel the grant created
 *   (`shipbob_channel_id`), read from `GET /channel` at connect.
 * - An order is created with our reference as its `reference_id`, which
 *   ShipBob keeps unique per channel, and looked up by it before every
 *   create, so a create that timed out after ShipBob took it is found rather
 *   than sent twice.
 * - Products are matched by SKU: a ShipBob product's `reference_id` is the
 *   store's SKU when it was imported from a store, and its `sku` otherwise.
 * - A shipment has shipped when its status is `Completed`; ShipBob reports a
 *   delivery by webhook (`shipment_delivered`), never on the shipment.
 */

export const SHIPBOB_API_BASE = 'https://api.shipbob.com/1.0'
export const SHIPBOB_SANDBOX_API_BASE = 'https://sandbox-api.shipbob.com/1.0'

/** The webhook topics this plugin subscribes to; each address carries its topic. */
export const SHIPBOB_WEBHOOK_TOPICS = ['order_shipped', 'shipment_delivered', 'shipment_exception', 'shipment_cancelled'] as const

export type ShipbobWebhookTopic = (typeof SHIPBOB_WEBHOOK_TOPICS)[number]

const PRODUCT_PAGE = 250
const SKUS_PER_LOOKUP = 50

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const timeMs = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** A product's units ShipBob can ship now, from whichever total its shape carries. */
export function shipbobFulfillable(product: any): number {
  if (Number.isFinite(Number(product?.total_fulfillable_quantity))) return Math.max(0, num(product.total_fulfillable_quantity))
  if (Array.isArray(product?.fulfillable_quantity_by_fulfillment_center)) {
    return product.fulfillable_quantity_by_fulfillment_center.reduce(
      (sum: number, center: any) => sum + Math.max(0, num(center?.fulfillable_quantity)),
      0,
    )
  }
  if (Array.isArray(product?.fulfillable_inventory_items)) {
    return product.fulfillable_inventory_items.reduce((sum: number, item: any) => sum + Math.max(0, num(item?.quantity)), 0)
  }
  return 0
}

const productSku = (product: any): string | null => text(product?.reference_id) ?? text(product?.sku)

function readShipment(raw: any): NetworkShipment | null {
  if (String(raw?.status ?? '') !== 'Completed') return null
  const tracking = raw?.tracking ?? {}
  const items: NetworkShipment['items'] = []
  for (const product of Array.isArray(raw?.products) ? raw.products : []) {
    const sku = productSku(product)
    if (!sku) continue
    const quantity = Array.isArray(product?.inventory_items)
      ? product.inventory_items.reduce((sum: number, item: any) => sum + Math.max(0, num(item?.quantity)), 0)
      : Math.max(0, num(product?.quantity))
    if (quantity > 0) items.push({ sku, quantity })
  }
  return {
    id: String(raw.id),
    carrier: text(tracking.carrier),
    trackingNumber: text(tracking.tracking_number),
    trackingUrl: text(tracking.tracking_url),
    items,
    trackingStatus: 'in_transit',
    trackingDetail: null,
    shippedAtMs: timeMs(tracking.shipping_date) ?? timeMs(raw?.actual_fulfillment_date),
  }
}

/** The order as the engine reads it. */
export function readShipbobOrder(raw: any): NetworkOrder {
  const status = String(raw?.status ?? '')
  const shipments = (Array.isArray(raw?.shipments) ? raw.shipments : [])
    .map(readShipment)
    .filter((shipment: NetworkShipment | null): shipment is NetworkShipment => shipment !== null)
  const stuck = (Array.isArray(raw?.shipments) ? raw.shipments : []).find((shipment: any) =>
    ['Exception', 'OnHold'].includes(String(shipment?.status ?? '')),
  )
  const stuckDetail = stuck
    ? text(stuck?.status_details?.[0]?.description) ??
      (String(stuck.status) === 'OnHold' ? 'ShipBob put the order on hold.' : 'ShipBob reported a problem with the order.')
    : null
  return {
    id: String(raw?.id ?? ''),
    reference: String(raw?.reference_id ?? ''),
    state: status === 'Cancelled' ? 'canceled' : status === 'Fulfilled' ? 'shipped' : 'open',
    detail: stuckDetail,
    shipments,
  }
}

export function createShipbobProvider(options: { http: ProviderHttp; sandbox: boolean }): FulfillmentNetworkProvider {
  const base = options.sandbox ? SHIPBOB_SANDBOX_API_BASE : SHIPBOB_API_BASE
  const call = (
    credential: NetworkCredential,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(options.http, {
      provider: 'ShipBob',
      method,
      url: `${base}${path}`,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(credential.channelId ? { shipbob_channel_id: credential.channelId } : {}),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const products = async (credential: NetworkCredential, query: URLSearchParams): Promise<any[]> => {
    const answer = await call(credential, 'GET', `/product?${query.toString()}`)
    return Array.isArray(answer) ? answer : []
  }

  return {
    id: 'shipbob',

    async account(credential) {
      const channels = await call(credential, 'GET', '/channel')
      const list: any[] = Array.isArray(channels) ? channels : []
      // The grant's own channel is the one that may write orders.
      const channel = list.find((entry) => Array.isArray(entry?.scopes) && entry.scopes.includes('orders_write')) ?? list[0]
      if (!channel?.id) throw new ProviderError('auth', 'ShipBob gave this connection no channel to send orders through')
      return { accountName: text(channel.name) ?? text(channel.application_name), channelId: String(channel.id) }
    },

    async findOrder(credential, reference) {
      const answer = await call(credential, 'GET', `/order?${new URLSearchParams({ ReferenceIds: reference }).toString()}`)
      const found = (Array.isArray(answer) ? answer : []).find((order: any) => order?.reference_id === reference)
      return found ? readShipbobOrder(found) : null
    },

    async createOrder(credential, request: NetworkOrderRequest) {
      const answer = await call(
        credential,
        'POST',
        '/order',
        {
          reference_id: request.reference,
          order_number: request.displayRef,
          type: 'DTC',
          shipping_method: request.shippingMethod,
          purchase_date: new Date(request.orderedAtMs).toISOString(),
          tags: [{ name: 'source', value: PLATFORM_BRAND_NAME }],
          recipient: {
            name: request.address.name,
            address: {
              address1: request.address.line1,
              ...(request.address.line2 ? { address2: request.address.line2 } : {}),
              city: request.address.city,
              ...(request.address.state ? { state: request.address.state } : {}),
              zip_code: request.address.postalCode,
              country: request.address.country,
            },
            ...(request.address.email ? { email: request.address.email } : {}),
            ...(request.address.phone ? { phone_number: request.address.phone } : {}),
          },
          products: request.items.map((item) => ({
            reference_id: item.sku,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unitValueCents / 100,
          })),
        },
        { retry: false },
      )
      return readShipbobOrder(answer)
    },

    async getOrder(credential, id) {
      return readShipbobOrder(await call(credential, 'GET', `/order/${encodeURIComponent(id)}`))
    },

    async cancelOrder(credential, id) {
      try {
        const answer = await call(credential, 'POST', `/order/${encodeURIComponent(id)}/cancel`, {}, { retry: false })
        const results: any[] = Array.isArray(answer?.canceled_shipment_results) ? answer.canceled_shipment_results : []
        return results.some((result) => result?.is_success === false) ? 'too_late' : 'canceled'
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
    },

    async stock(credential, skus) {
      const wanted = [...new Set(skus.filter(Boolean))]
      const found: NetworkStock[] = []
      for (let index = 0; index < wanted.length; index += SKUS_PER_LOOKUP) {
        const chunk = wanted.slice(index, index + SKUS_PER_LOOKUP)
        const list = await products(credential, new URLSearchParams({ ReferenceIds: chunk.join(','), Limit: String(PRODUCT_PAGE) }))
        for (const product of list) {
          const sku = productSku(product)
          if (sku && chunk.includes(sku)) found.push({ sku, fulfillable: shipbobFulfillable(product) })
        }
      }
      return found
    },

    async allStock(credential, max) {
      const found = new Map<string, number>()
      for (let page = 1; page <= 200 && found.size < max; page += 1) {
        const list = await products(credential, new URLSearchParams({ Page: String(page), Limit: String(PRODUCT_PAGE) }))
        for (const product of list) {
          const sku = productSku(product)
          if (sku && found.size < max) found.set(sku, (found.get(sku) ?? 0) + shipbobFulfillable(product))
        }
        if (list.length < PRODUCT_PAGE) break
      }
      return [...found].map(([sku, fulfillable]) => ({ sku, fulfillable }))
    },

    async syncWebhooks(credential, target) {
      const existing = await call(credential, 'GET', '/webhook')
      const ours = (Array.isArray(existing) ? existing : []).filter(
        (hook: any) => typeof hook?.subscription_url === 'string' && hook.subscription_url.startsWith(target.prefix),
      )
      const kept = new Set<string>()
      for (const hook of ours) {
        // A hook at an address this connection no longer answers (an older
        // token, or a disconnect) is removed, so ShipBob stops calling it.
        if (target.url && String(hook.subscription_url).startsWith(target.url)) {
          kept.add(String(hook.topic))
          continue
        }
        if (hook?.id !== undefined) await call(credential, 'DELETE', `/webhook/${encodeURIComponent(String(hook.id))}`)
      }
      if (!target.url) return
      for (const topic of SHIPBOB_WEBHOOK_TOPICS) {
        if (kept.has(topic)) continue
        const url = new URL(target.url)
        url.searchParams.set('topic', topic)
        await call(credential, 'POST', '/webhook', { topic, subscription_url: url.toString() }, { retry: false })
      }
    },
  }
}
