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

import { decimalToMinor, minorToDecimal, type PodOrderStatus } from '../model/print-on-demand'
import { mapLimited, PodProviderError, sendProviderRequest, type ProviderFetch } from './http'
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
 * Printful, through its REST API v1 with the merchant's own private token
 * (AGL-3641). A private token needs no app of Aglyn's: the merchant makes it
 * in Printful's Developer Portal for their own store. A token made for the
 * whole account names the store in `X-PF-Store-Id`; one made for a store
 * needs nothing more.
 *
 * Every answer is wrapped as `{ code, result, paging }`, and a refusal says
 * why in `error.message` (or, in older answers, `result` as a sentence).
 */

export const PRINTFUL_API_BASE = 'https://api.printful.com'

/** Printful's own page size ceiling for the store's products. */
const PAGE_SIZE = 100

/** Catalog price lookups in flight at once while a product is read. */
const COST_LOOKUPS_IN_FLIGHT = 4

/** The notices a store asks Printful for. */
export const PRINTFUL_WEBHOOK_TYPES = [
  'package_shipped',
  'package_returned',
  'order_updated',
  'order_failed',
  'order_canceled',
  'order_put_hold',
  'order_remove_hold',
] as const

const STATUS: Record<string, PodOrderStatus> = {
  draft: 'draft',
  pending: 'submitted',
  inreview: 'on_hold',
  onhold: 'on_hold',
  inprocess: 'in_production',
  partial: 'partially_shipped',
  fulfilled: 'shipped',
  archived: 'shipped',
  failed: 'failed',
  canceled: 'canceled',
}

function refusal(status: number, body: any): PodProviderError {
  const sentence =
    (typeof body?.error?.message === 'string' && body.error.message) ||
    (typeof body?.result === 'string' && body.result) ||
    (typeof body?.message === 'string' && body.message) ||
    ''
  const reason = typeof body?.error?.reason === 'string' ? body.error.reason : null
  if (status === 401) {
    return new PodProviderError('Printful refused the token. Make a new private token and connect again.', 401, reason)
  }
  if (status === 403) {
    return new PodProviderError(
      `Printful refused the request${sentence ? `: ${sentence}` : ''}. Check that the token may manage this store’s orders, products and webhooks.`,
      403,
      reason,
    )
  }
  return new PodProviderError(sentence ? `Printful: ${sentence}` : `Printful answered ${status}.`, status, reason)
}

function stamp(value: unknown): number | null {
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

export function createPrintfulProvider(fetchImpl: ProviderFetch): PodProvider {
  /**
   * `path` is relative to the API's root, with no leading slash: the
   * service's `orders` and `store/products` are its own, and a literal
   * spelled `/orders` reads to the plugin-domain guard as a console page.
   */
  async function call(credentials: Partial<PodCredentials> & { token: string }, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const response = await sendProviderRequest(fetchImpl, {
      method,
      url: `${PRINTFUL_API_BASE}/${path}`,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        ...(credentials.storeId ? { 'X-PF-Store-Id': credentials.storeId } : {}),
      },
      ...(body === undefined ? {} : { body }),
    })
    return response
  }

  async function ok(credentials: Partial<PodCredentials> & { token: string }, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    const response = await call(credentials, method, path, body)
    if (response.status < 200 || response.status >= 300) throw refusal(response.status, response.body)
    return response.body?.result
  }

  function readOrder(result: any): PodSourceOrder {
    const raw = text(result?.status).toLowerCase()
    const items: any[] = Array.isArray(result?.items) ? result.items : []
    const lineOf = new Map<string, number>()
    for (const item of items) {
      const index = Number(item?.external_id)
      if (item?.id !== undefined && Number.isInteger(index) && index >= 0) lineOf.set(String(item.id), index)
    }
    const costs = result?.costs
    const minor = (value: unknown) => decimalToMinor(value) ?? 0
    return {
      id: text(result?.id),
      externalId: result?.external_id ? text(result.external_id) : null,
      status: STATUS[raw] ?? 'submitted',
      rawStatus: raw,
      costs:
        costs && costs.total !== undefined && costs.total !== null
          ? {
              currency: text(costs.currency || 'USD').toUpperCase(),
              itemsMinor: minor(costs.subtotal) - minor(costs.discount),
              shippingMinor: minor(costs.shipping),
              taxMinor: minor(costs.tax) + minor(costs.vat),
              totalMinor: minor(costs.total),
            }
          : null,
      shipments: (Array.isArray(result?.shipments) ? result.shipments : [])
        .filter((shipment: any) => shipment && shipment.tracking_number)
        .map((shipment: any) => {
          const lines: Array<{ lineIndex: number; quantity: number }> = []
          for (const item of Array.isArray(shipment.items) ? shipment.items : []) {
            const lineIndex = lineOf.get(text(item?.item_id))
            const quantity = Number(item?.quantity)
            if (lineIndex !== undefined && quantity > 0) lines.push({ lineIndex, quantity })
          }
          return {
            id: text(shipment.id),
            carrier: text(shipment.carrier) || 'Carrier',
            service: shipment.service ? text(shipment.service) : null,
            trackingNumber: text(shipment.tracking_number),
            trackingUrl: shipment.tracking_url ? text(shipment.tracking_url) : null,
            lines: lines.length ? lines : null,
            shippedAtMs: stamp(shipment.shipped_at) ?? stamp(shipment.created),
            deliveredAtMs: null,
          }
        }),
      fulfilledVariantIds: [],
      dashboardUrl: result?.dashboard_url ? text(result.dashboard_url) : null,
    }
  }

  return {
    id: 'printful',

    async listStores(token): Promise<PodStore[]> {
      const result = await ok({ token }, 'GET', 'stores')
      return (Array.isArray(result) ? result : []).map((store: any) => ({
        id: text(store?.id),
        name: text(store?.name) || `Store ${text(store?.id)}`,
        currency: store?.currency ? text(store.currency).toUpperCase() : null,
      }))
    },

    async listProducts(credentials, cursor): Promise<PodCatalogPage> {
      const offset = Math.max(0, Number(cursor) || 0)
      const response = await call(credentials, 'GET', `store/products?offset=${offset}&limit=${PAGE_SIZE}`)
      if (response.status !== 200) throw refusal(response.status, response.body)
      const rows: any[] = Array.isArray(response.body?.result) ? response.body.result : []
      const total = Number(response.body?.paging?.total)
      const next = offset + rows.length
      return {
        products: rows
          .filter((row) => row && row.is_ignored !== true)
          .map((row) => ({
            id: text(row.id),
            name: text(row.name),
            thumbnailUrl: row.thumbnail_url ? text(row.thumbnail_url) : null,
            variantCount: Number(row.variants) || 0,
          })),
        nextCursor: rows.length > 0 && Number.isFinite(total) && next < total ? String(next) : null,
        total: Number.isFinite(total) ? total : null,
      }
    },

    async getProduct(credentials, productId): Promise<PodSourceProduct> {
      const result = await ok(credentials, 'GET', `store/products/${encodeURIComponent(productId)}`)
      const product = result?.sync_product ?? {}
      const synced: any[] = (Array.isArray(result?.sync_variants) ? result.sync_variants : []).filter(
        (variant) => variant && variant.is_ignored !== true,
      )
      // What Printful charges the merchant is the catalog variant's price, read
      // once per catalog variant; the catalog product's words come with it.
      const catalogIds = [...new Set(synced.map((variant) => text(variant?.variant_id ?? variant?.product?.variant_id)).filter(Boolean))]
      let description = ''
      const costs = new Map<string, number | null>()
      await mapLimited(catalogIds, COST_LOOKUPS_IN_FLIGHT, async (catalogId) => {
        const response = await call(credentials, 'GET', `products/variant/${encodeURIComponent(catalogId)}`).catch(() => null)
        const found = response && response.status === 200 ? response.body?.result : null
        costs.set(catalogId, found ? decimalToMinor(found.variant?.price) : null)
        if (!description && typeof found?.product?.description === 'string') description = found.product.description
      })
      const productName = text(product.name)
      const variants: PodSourceVariant[] = synced.map((variant) => {
        const preview = (Array.isArray(variant.files) ? variant.files : []).find((file: any) => file?.type === 'preview')
        const options: Record<string, string> = {}
        if (variant.color) options['Color'] = text(variant.color)
        if (variant.size) options['Size'] = text(variant.size)
        const availability = text(variant.availability_status || 'active').toLowerCase()
        return {
          id: text(variant.id),
          name: text(variant.name),
          sku: variant.sku ? text(variant.sku) : null,
          options,
          retailMinor: decimalToMinor(variant.retail_price) ?? 0,
          costMinor: costs.get(text(variant.variant_id ?? variant.product?.variant_id)) ?? null,
          available: availability === 'active',
          imageUrl: text(preview?.preview_url || variant.product?.image) || null,
          weightGrams: null,
        }
      })
      // Options from color and size, unless two variants share a choice: then
      // one option naming each variant, so every choice is a variant.
      const combos = new Set(variants.map((variant) => JSON.stringify(variant.options)))
      const optionNames = ['Color', 'Size'].filter((name) => variants.every((variant) => variant.options[name]))
      let options: Array<{ name: string; values: string[] }>
      if (variants.length > 1 && (combos.size !== variants.length || optionNames.length === 0)) {
        const label = (variant: PodSourceVariant) =>
          variant.name.startsWith(`${productName} / `) ? variant.name.slice(productName.length + 3) : variant.name
        options = [{ name: 'Style', values: variants.map(label) }]
        for (const variant of variants) variant.options = { Style: label(variant) }
      } else if (variants.length <= 1) {
        options = []
        for (const variant of variants) variant.options = {}
      } else {
        options = optionNames.map((name) => ({ name, values: [...new Set(variants.map((variant) => variant.options[name]))] }))
        for (const variant of variants) {
          variant.options = Object.fromEntries(optionNames.map((name) => [name, variant.options[name]]))
        }
      }
      const imageUrls = [
        ...new Set([text(product.thumbnail_url), ...variants.map((variant) => variant.imageUrl ?? '')].filter(Boolean)),
      ]
      return {
        id: text(product.id || productId),
        name: productName,
        description,
        tags: [],
        currency: text(synced[0]?.currency || 'USD').toUpperCase(),
        imageUrls,
        options,
        variants,
      }
    },

    async findOrder(credentials, externalId) {
      const response = await call(credentials, 'GET', `orders/@${encodeURIComponent(externalId)}`)
      if (response.status === 404) return null
      if (response.status !== 200) throw refusal(response.status, response.body)
      return readOrder(response.body?.result)
    },

    async createOrder(credentials, request: PodOrderRequest) {
      const recipient = request.recipient
      const result = await ok(credentials, 'POST', `orders?confirm=${request.confirm ? 'true' : 'false'}`, {
        external_id: request.externalId,
        shipping: 'STANDARD',
        recipient: {
          name: recipient.name,
          address1: recipient.line1,
          ...(recipient.line2 ? { address2: recipient.line2 } : {}),
          city: recipient.city,
          ...(recipient.state ? { state_code: recipient.state } : {}),
          country_code: recipient.country,
          zip: recipient.postalCode,
          ...(recipient.phone ? { phone: recipient.phone } : {}),
          ...(recipient.email ? { email: recipient.email } : {}),
        },
        items: request.lines.map((line) => ({
          external_id: String(line.lineIndex),
          sync_variant_id: Number(line.sourceVariantId),
          quantity: line.quantity,
          retail_price: minorToDecimal(line.retailMinor),
          name: line.name,
        })),
      })
      return readOrder(result)
    },

    async confirmOrder(credentials, orderId) {
      return readOrder(await ok(credentials, 'POST', `orders/${encodeURIComponent(orderId)}/confirm`))
    },

    async getOrder(credentials, orderId) {
      return readOrder(await ok(credentials, 'GET', `orders/${encodeURIComponent(orderId)}`))
    },

    async cancelOrder(credentials, orderId) {
      return readOrder(await ok(credentials, 'DELETE', `orders/${encodeURIComponent(orderId)}`))
    },

    async registerWebhooks(credentials, url): Promise<PodWebhookOutcome> {
      // Printful keeps ONE notice address per store. One set by another app
      // is that app's, and replacing it would silently break it: the store
      // asks after its orders instead.
      const current = await ok(credentials, 'GET', 'webhooks')
      const existing = text(current?.url)
      if (existing && existing !== url) {
        return {
          registered: false,
          detail:
            'Printful already sends this store’s notices to another app, and a store keeps only one address, so shipments are checked every 15 minutes instead.',
        }
      }
      await ok(credentials, 'POST', 'webhooks', { url, types: [...PRINTFUL_WEBHOOK_TYPES] })
      return { registered: true, detail: null }
    },

    async removeWebhooks(credentials, url) {
      const current = await ok(credentials, 'GET', 'webhooks').catch(() => null)
      if (current && text(current.url) === url) await ok(credentials, 'DELETE', 'webhooks').catch(() => undefined)
    },

    webhookOrderId(body) {
      const id = (body as any)?.data?.order?.id
      return id === undefined || id === null || id === '' ? null : String(id)
    },
  }
}
