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
import { htmlToPlainText, type PodOrderStatus } from '../model/print-on-demand'
import { PodProviderError, sendProviderRequest, type ProviderFetch } from './http'
import type {
  PodCatalogPage,
  PodCredentials,
  PodOrderRequest,
  PodProvider,
  PodSourceOrder,
  PodSourceProduct,
  PodSourceVariant,
  PodStore,
  PodWebhookOutcome,
} from './types'

/**
 * Printify, through its REST API v1 with the merchant's own personal access
 * token (AGL-3641). A personal token needs no app of Aglyn's: the merchant
 * generates it in their own Printify account. Calls name a shop, and the API
 * asks every caller to say who it is in `User-Agent`.
 *
 * Printify states amounts as integer cents with no currency field; its
 * merchants are billed, and set their prices, in US dollars, so the adapter
 * says USD. Its shipments name no lines, so the store learns which were
 * shipped from each line's own status.
 */

export const PRINTIFY_API_BASE = 'https://api.printify.com/v1'

/** Printify's page size ceiling for a shop's products. */
const PAGE_SIZE = 50

/** Recent orders read to find one by the store's key. */
const FIND_PAGES = 2

export const PRINTIFY_CURRENCY = 'USD'

/** The notices a store asks Printify for. */
export const PRINTIFY_WEBHOOK_TOPICS = [
  'order:updated',
  'order:sent-to-production',
  'order:shipment:created',
  'order:shipment:delivered',
] as const

function refusal(status: number, body: any): PodProviderError {
  const sentence =
    (typeof body?.message === 'string' && body.message) ||
    (typeof body?.error === 'string' && body.error) ||
    (typeof body?.errors?.reason === 'string' && body.errors.reason) ||
    ''
  if (status === 401) {
    return new PodProviderError('Printify refused the token. Generate a new personal access token and connect again.', 401)
  }
  if (status === 403) {
    return new PodProviderError(
      `Printify refused the request${sentence ? `: ${sentence}` : ''}. Check that the token may read shops and products and write orders and webhooks.`,
      403,
    )
  }
  return new PodProviderError(sentence ? `Printify: ${sentence}` : `Printify answered ${status}.`, status)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

function cents(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

function time(value: unknown): number | null {
  if (!value) return null
  const parsed = Date.parse(String(value).replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : null
}

/** Printify's order status, in the store's words. */
export function printifyStatus(raw: string, sentToProduction: boolean): PodOrderStatus {
  switch (raw) {
    case 'pending':
    case 'on-hold':
      return sentToProduction ? 'on_hold' : 'draft'
    case 'payment-not-received':
    case 'has-issues':
    case 'had-issues':
      return 'on_hold'
    case 'sending-to-production':
    case 'in-production':
      return 'in_production'
    case 'partially-fulfilled':
      return 'partially_shipped'
    case 'fulfilled':
      return 'shipped'
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      return sentToProduction ? 'submitted' : 'draft'
  }
}

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first_name: parts[0] ?? '', last_name: '' }
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] }
}

export function createPrintifyProvider(fetchImpl: ProviderFetch): PodProvider {
  /**
   * `path` is relative to the API's root, with no leading slash; a shop's
   * own paths are built by {@link shopPath}. The service's `orders` and
   * `products` are its own, and a literal spelled `/orders` reads to the
   * plugin-domain guard as a console page.
   */
  async function call(token: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return sendProviderRequest(fetchImpl, {
      method,
      url: `${PRINTIFY_API_BASE}/${path}`,
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': PLATFORM_BRAND_NAME },
      ...(body === undefined ? {} : { body }),
    })
  }

  async function ok(token: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const response = await call(token, method, path, body)
    if (response.status < 200 || response.status >= 300) throw refusal(response.status, response.body)
    return response.body
  }

  function shop(credentials: PodCredentials): string {
    if (!credentials.storeId) throw new PodProviderError('Choose the Printify shop to connect.', 400)
    return encodeURIComponent(credentials.storeId)
  }

  /** A path under the connected shop: `rest` is relative to it, its own ids encoded by the caller. */
  function shopPath(credentials: PodCredentials, rest: string): string {
    return ['shops', shop(credentials), rest].join('/')
  }

  function readOrder(order: any): PodSourceOrder {
    const raw = text(order?.status).toLowerCase()
    const lines: any[] = Array.isArray(order?.line_items) ? order.line_items : []
    const sent = Boolean(order?.sent_to_production_at) || lines.some((line) => line?.sent_to_production_at)
    const items = cents(order?.total_price)
    const shipping = cents(order?.total_shipping)
    const tax = cents(order?.total_tax)
    return {
      id: text(order?.id),
      externalId: text(order?.external_id || order?.metadata?.shop_order_id) || null,
      status: printifyStatus(raw, sent),
      rawStatus: raw,
      costs:
        order && (order.total_price !== undefined || order.total_shipping !== undefined)
          ? { currency: PRINTIFY_CURRENCY, itemsMinor: items, shippingMinor: shipping, taxMinor: tax, totalMinor: items + shipping + tax }
          : null,
      shipments: (Array.isArray(order?.shipments) ? order.shipments : [])
        .filter((shipment: any) => shipment && shipment.number)
        .map((shipment: any) => ({
          id: `${text(shipment.carrier)}:${text(shipment.number)}`,
          carrier: text(shipment.carrier) || 'Carrier',
          service: null,
          trackingNumber: text(shipment.number),
          trackingUrl: shipment.url ? text(shipment.url) : null,
          lines: null,
          shippedAtMs: null,
          deliveredAtMs: time(shipment.delivered_at),
        })),
      fulfilledVariantIds: lines
        .filter((line) => text(line?.status).toLowerCase() === 'fulfilled' || line?.fulfilled_at)
        .map((line) => text(line.variant_id)),
      dashboardUrl: null,
    }
  }

  const provider: PodProvider = {
    id: 'printify',

    async listStores(token): Promise<PodStore[]> {
      const body = await ok(token, 'GET', 'shops.json')
      return (Array.isArray(body) ? body : []).map((entry: any) => ({
        id: text(entry?.id),
        name: text(entry?.title) || `Shop ${text(entry?.id)}`,
        currency: PRINTIFY_CURRENCY,
      }))
    },

    async listProducts(credentials, cursor): Promise<PodCatalogPage> {
      const page = Math.max(1, Number(cursor) || 1)
      const body = await ok(credentials.token, 'GET', shopPath(credentials, `products.json?limit=${PAGE_SIZE}&page=${page}`))
      const rows: any[] = Array.isArray(body?.data) ? body.data : []
      const last = Number(body?.last_page)
      const total = Number(body?.total)
      return {
        products: rows.map((row) => {
          const images: any[] = Array.isArray(row?.images) ? row.images : []
          const cover = images.find((image) => image?.is_default) ?? images[0]
          return {
            id: text(row?.id),
            name: text(row?.title),
            thumbnailUrl: cover?.src ? text(cover.src) : null,
            variantCount: (Array.isArray(row?.variants) ? row.variants : []).filter((variant: any) => variant?.is_enabled).length,
          }
        }),
        nextCursor: Number.isFinite(last) && page < last ? String(page + 1) : null,
        total: Number.isFinite(total) ? total : null,
      }
    },

    async getProduct(credentials, productId): Promise<PodSourceProduct> {
      const product = await ok(credentials.token, 'GET', shopPath(credentials, `products/${encodeURIComponent(productId)}.json`))
      const optionDefs: any[] = Array.isArray(product?.options) ? product.options : []
      const valueName = new Map<string, { option: number; title: string }>()
      optionDefs.forEach((option, index) => {
        for (const value of Array.isArray(option?.values) ? option.values : []) {
          valueName.set(text(value?.id), { option: index, title: text(value?.title) })
        }
      })
      const images: any[] = Array.isArray(product?.images) ? product.images : []
      const enabled: any[] = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => variant?.is_enabled)
      const variants: PodSourceVariant[] = enabled.map((variant) => {
        const options: Record<string, string> = {}
        for (const valueId of Array.isArray(variant?.options) ? variant.options : []) {
          const value = valueName.get(text(valueId))
          if (value) options[text(optionDefs[value.option]?.name) || `Option ${value.option + 1}`] = value.title
        }
        const pictures = images.filter((image) => Array.isArray(image?.variant_ids) && image.variant_ids.map(Number).includes(Number(variant.id)))
        const picture = pictures.find((image) => image?.is_default) ?? pictures[0]
        return {
          id: text(variant.id),
          name: text(variant.title),
          sku: variant.sku ? text(variant.sku) : null,
          options,
          retailMinor: cents(variant.price),
          costMinor: variant.cost === undefined || variant.cost === null ? null : cents(variant.cost),
          available: variant.is_available !== false,
          imageUrl: picture?.src ? text(picture.src) : null,
          weightGrams: Number(variant.grams) > 0 ? Math.round(Number(variant.grams)) : null,
        }
      })
      // Only the choices an enabled variant uses, in the shop's own order.
      const options = optionDefs
        .map((option, index) => {
          const name = text(option?.name) || `Option ${index + 1}`
          const used = new Set(variants.map((variant) => variant.options[name]).filter(Boolean))
          return { name, values: (Array.isArray(option?.values) ? option.values : []).map((value: any) => text(value?.title)).filter((title: string) => used.has(title)) }
        })
        .filter((option) => option.values.length > 0)
      if (variants.length <= 1) {
        for (const variant of variants) variant.options = {}
      }
      const ordered = [...images.filter((image) => image?.is_default), ...images.filter((image) => !image?.is_default)]
      return {
        id: text(product?.id || productId),
        name: text(product?.title),
        description: htmlToPlainText(text(product?.description)),
        tags: (Array.isArray(product?.tags) ? product.tags : []).map(text).filter(Boolean).slice(0, 20),
        currency: PRINTIFY_CURRENCY,
        imageUrls: [...new Set(ordered.map((image) => text(image?.src)).filter(Boolean))],
        options: variants.length <= 1 ? [] : options,
        variants,
      }
    },

    async findOrder(credentials, externalId) {
      for (let page = 1; page <= FIND_PAGES; page += 1) {
        const body = await ok(credentials.token, 'GET', shopPath(credentials, `orders.json?limit=50&page=${page}`))
        const rows: any[] = Array.isArray(body?.data) ? body.data : []
        const found = rows.find((row) => text(row?.external_id || row?.metadata?.shop_order_id) === externalId)
        if (found) return readOrder(found)
        if (!(Number(body?.last_page) > page)) break
      }
      return null
    },

    async createOrder(credentials, request: PodOrderRequest) {
      const recipient = request.recipient
      const created = await ok(credentials.token, 'POST', shopPath(credentials, 'orders.json'), {
        external_id: request.externalId,
        label: request.label,
        line_items: request.lines.map((line) => ({
          product_id: line.sourceProductId,
          variant_id: Number(line.sourceVariantId),
          quantity: line.quantity,
        })),
        shipping_method: 1,
        send_shipping_notification: false,
        address_to: {
          ...splitName(recipient.name),
          ...(recipient.email ? { email: recipient.email } : {}),
          ...(recipient.phone ? { phone: recipient.phone } : {}),
          country: recipient.country,
          ...(recipient.state ? { region: recipient.state } : {}),
          address1: recipient.line1,
          ...(recipient.line2 ? { address2: recipient.line2 } : {}),
          city: recipient.city,
          zip: recipient.postalCode,
        },
      })
      const orderId = text(created?.id)
      if (!orderId) throw new PodProviderError('Printify did not return the order it made.', 502)
      if (request.confirm) return provider.confirmOrder(credentials, orderId)
      return provider.getOrder(credentials, orderId)
    },

    async confirmOrder(credentials, orderId) {
      await ok(credentials.token, 'POST', shopPath(credentials, `orders/${encodeURIComponent(orderId)}/send_to_production.json`))
      return provider.getOrder(credentials, orderId)
    },

    async getOrder(credentials, orderId) {
      return readOrder(await ok(credentials.token, 'GET', shopPath(credentials, `orders/${encodeURIComponent(orderId)}.json`)))
    },

    async cancelOrder(credentials, orderId) {
      await ok(credentials.token, 'POST', shopPath(credentials, `orders/${encodeURIComponent(orderId)}/cancel.json`))
      return provider.getOrder(credentials, orderId)
    },

    async registerWebhooks(credentials, url, secret): Promise<PodWebhookOutcome> {
      const existing = await ok(credentials.token, 'GET', shopPath(credentials, 'webhooks.json'))
      const ours = new Set(
        (Array.isArray(existing) ? existing : []).filter((hook: any) => text(hook?.url) === url).map((hook: any) => text(hook?.topic)),
      )
      for (const topic of PRINTIFY_WEBHOOK_TOPICS) {
        if (ours.has(topic)) continue
        await ok(credentials.token, 'POST', shopPath(credentials, 'webhooks.json'), { topic, url, secret })
      }
      return { registered: true, detail: null }
    },

    async removeWebhooks(credentials, url) {
      const existing = await ok(credentials.token, 'GET', shopPath(credentials, 'webhooks.json')).catch(() => [])
      const host = encodeURIComponent(new URL(url).host)
      for (const hook of Array.isArray(existing) ? existing : []) {
        if (text(hook?.url) !== url) continue
        await ok(credentials.token, 'DELETE', shopPath(credentials, `webhooks/${encodeURIComponent(text(hook.id))}.json?host=${host}`)).catch(
          () => undefined,
        )
      }
    },

    webhookOrderId(body) {
      const resource = (body as any)?.resource
      return resource && text(resource.type) === 'order' && resource.id ? text(resource.id) : null
    },
  }
  return provider
}
