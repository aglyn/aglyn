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

import type { PluginTrackingStatus } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import type {
  FulfillmentNetworkProvider,
  NetworkCancelOutcome,
  NetworkCredential,
  NetworkOrder,
  NetworkOrderRequest,
  NetworkShipment,
  NetworkStock,
} from './provider'

/**
 * FLEXPORT (AGL-3822), through its Logistics API, version 2026-02, with the
 * merchant's OWN API token: a bearer token an administrator of the
 * merchant's Flexport organization creates in Seller Portal → Settings →
 * API Tokens (https://docs.logistics-api.flexport.com/2026-02/#section/Getting-Started/Creating-Access-Tokens).
 * Flexport's OAuth flow is for registered partner apps; a merchant's own
 * token needs no app or approval from Flexport. Placing orders needs a
 * Flexport billing account, which is the merchant's own.
 *
 * - Orders name Flexport's own product id (`logisticsSku`), not the store's
 *   SKU, so each order, stock read and count first reads the merchant's
 *   catalog (`merchantSku` → `logisticsSku`), once per credential.
 * - An order is created with our reference as its `externalOrderId` and as
 *   its `idempotency-key`, and looked up by it before every create; a create
 *   that answers 409 (Flexport's duplicate order) is adopted, never sent
 *   twice.
 * - Each line carries its index on the order as `lineItemId`, so a parcel's
 *   units land on the right lines.
 * - A package has shipped once its shipment has; each package with a label
 *   is a parcel, followed until Flexport reports the carrier delivered it.
 * - Webhooks are registered through the API at connect, sending a token in a
 *   header of our choosing; each names an order, which is then read back.
 *
 * Rate limits: Flexport publishes no fixed figure; a 429 carries
 * `Retry-After` in seconds (…/#section/Errors/429-Too-Many-Requests), which
 * the shared HTTP door honors.
 *
 * Token scopes the merchant grants (…/#section/Common-Resources/Permission-Scopes):
 * `read_logistics_orders`, `write_logistics_orders`, `read_logistics_products`,
 * `read_logistics_webhooks` and `write_logistics_webhooks`.
 */

export const FLEXPORT_API_BASE = 'https://logistics-api.flexport.com'
export const FLEXPORT_API_VERSION = '2026-02'

/** The header Flexport sends each webhook's token in; Flexport lets the subscriber name it. */
export const FLEXPORT_WEBHOOK_TOKEN_HEADER = 'x-aglyn-webhook-token'

/**
 * The events a connection subscribes to
 * (https://docs.logistics-api.flexport.com/2026-02/#tag/Webhooks/operation/CreateWebhook):
 * each names an order, which is then read back.
 */
export const FLEXPORT_WEBHOOK_EVENTS = [
  'Shipment.Shipped',
  'Order.Shipped',
  'Shipment.Delivered',
  'Order.Delivered',
  'Order.Cancelled',
  'Order.Held',
] as const

/** The products endpoint answers at most 1,000 a page. */
const PRODUCT_PAGE = 1_000
const CATALOG_MAX_PAGES = 50
/** The inventory cursor answers at most 100 a page. */
const INVENTORY_PAGE = 100
const SKUS_PER_SEND = 50

/** An external id that is never one of ours, to check the token may read orders. */
const PROBE_ORDER = 'aglyn-connection-check'

const SHIPPED_SHIPMENT_STATUSES = new Set(['SHIPPED', 'PARTIALLY_SHIPPED', 'OVER_SHIPPED'])
const SHIPPED_ORDER_STATUSES = new Set(['SHIPPED', 'DELIVERED'])

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const int = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const timeMs = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** Our line index, echoed back as the line's `lineItemId`. */
const lineIndexOf = (lineItemId: unknown): number | undefined => {
  const raw = String(lineItemId ?? '')
  return /^[0-9]{1,6}$/.test(raw) ? Number(raw) : undefined
}

/** Where one package is, from the carrier times Flexport records on it. */
export function flexportPackageStatus(pkg: any, order: any): { status: PluginTrackingStatus; detail: string | null } {
  if (timeMs(pkg?.carrierDeliveryTime) !== null || String(order?.state?.fulfillmentStatus ?? '') === 'DELIVERED') {
    return { status: 'delivered', detail: null }
  }
  if (timeMs(pkg?.attemptedDeliveryTime) !== null) {
    return { status: 'exception', detail: 'The carrier attempted delivery and could not deliver the parcel.' }
  }
  if (timeMs(pkg?.carrierPickUpTime) !== null || timeMs(pkg?.carrierShipTime) !== null) return { status: 'in_transit', detail: null }
  return { status: 'pre_transit', detail: null }
}

/**
 * The parcels of one Flexport order. A package's units are placed on the
 * order's lines that carry its `logisticsSku`, in line order, across every
 * package of the order, so the same placement comes back on every read.
 */
function readShipments(raw: any): NetworkShipment[] {
  const room = new Map<number, number>()
  const linesBySku = new Map<string, number[]>()
  for (const line of Array.isArray(raw?.lineItems) ? raw.lineItems : []) {
    const lineIndex = lineIndexOf(line?.lineItemId)
    const sku = text(line?.logisticsSku)
    if (lineIndex === undefined || !sku) continue
    room.set(lineIndex, (room.get(lineIndex) ?? 0) + int(line?.quantity))
    linesBySku.set(sku, [...(linesBySku.get(sku) ?? []), lineIndex])
  }
  const orderId = text(raw?.id)
  const orderShippedAtMs = timeMs(raw?.shippedAt)
  const parcels: NetworkShipment[] = []
  for (const shipment of Array.isArray(raw?.shipments) ? raw.shipments : []) {
    const shippedAtMs = timeMs(shipment?.shippedAt)
    const shipped = SHIPPED_SHIPMENT_STATUSES.has(String(shipment?.status ?? '')) || shippedAtMs !== null
    for (const pkg of Array.isArray(shipment?.packages) ? shipment.packages : []) {
      const items: NetworkShipment['items'] = []
      for (const item of Array.isArray(pkg?.lineItems) ? pkg.lineItems : []) {
        const sku = text(item?.logisticsSku)
        let left = int(item?.quantity)
        if (!sku || !left) continue
        for (const lineIndex of linesBySku.get(sku) ?? []) {
          const taken = Math.min(left, room.get(lineIndex) ?? 0)
          if (taken <= 0) continue
          room.set(lineIndex, (room.get(lineIndex) ?? 0) - taken)
          items.push({ sku, quantity: taken, lineIndex })
          left -= taken
        }
        if (left > 0) items.push({ sku, quantity: left })
      }
      const trackingNumber = text(pkg?.label?.trackingCode)
      const id = text(pkg?.id)
      if (!shipped || !trackingNumber || !id) continue
      const where = flexportPackageStatus(pkg, raw)
      parcels.push({
        id,
        carrier: text(pkg?.label?.carrier),
        trackingNumber,
        trackingUrl: text(pkg?.label?.trackingUrl),
        items,
        trackingStatus: where.status,
        trackingDetail: where.detail,
        shippedAtMs: timeMs(pkg?.carrierShipTime) ?? shippedAtMs ?? orderShippedAtMs,
        packageNumber: orderId,
      })
    }
  }
  return parcels
}

/** The order as the engine reads it. */
export function readFlexportOrder(raw: any): NetworkOrder {
  const status = String(raw?.state?.internalStatus ?? '')
  const shipments = readShipments(raw)
  const errorMessage = text(raw?.error?.message)
  let state: NetworkOrder['state'] = 'open'
  let detail: string | null = null
  if (status === 'CANCELLED') state = 'canceled'
  else if (status === 'ERROR') {
    if (raw?.error?.retriable === true) {
      detail = `Flexport could not route the order yet${errorMessage ? `: ${errorMessage}` : ''}. Check it in Flexport.`
    } else {
      state = 'refused'
      detail = `Flexport could not fulfill the order${errorMessage ? `: ${errorMessage}` : ''}.`
    }
  } else if (status === 'ON_HOLD') detail = 'Flexport put the order on hold. Check it in Flexport.'
  else if (SHIPPED_ORDER_STATUSES.has(status)) state = shipments.length ? 'shipped' : 'open'
  if (state === 'open' && !detail && raw?.hasUnfulfillableItems === true) {
    detail = 'Flexport cannot fulfill some items on the order. Check it in Flexport.'
  }
  return {
    id: String(raw?.id ?? ''),
    reference: String(raw?.externalOrderId ?? ''),
    state,
    detail: detail ? detail.slice(0, 300) : null,
    shipments,
  }
}

interface FlexportCatalog {
  /** The store's SKU → Flexport's `logisticsSku`. */
  bySku: Map<string, string>
  /** Flexport's `logisticsSku` → the store's SKU. */
  byLogisticsSku: Map<string, string>
}

export function createFlexportProvider(options: { http: ProviderHttp }): FulfillmentNetworkProvider {
  const root = `${FLEXPORT_API_BASE}/logistics/api/${FLEXPORT_API_VERSION}`
  const call = (
    credential: NetworkCredential,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    extra: { retry?: boolean; idempotencyKey?: string } = {},
  ) =>
    providerRequest(options.http, {
      provider: 'Flexport',
      method,
      url: `${root}/${path}`,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(extra.idempotencyKey ? { 'idempotency-key': extra.idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body }),
      ...(extra.retry === undefined ? {} : { retry: extra.retry }),
    })

  // One catalog read per credential: a run opens its credential once and
  // reads stock, looks up and sends with it.
  const catalogs = new WeakMap<NetworkCredential, Promise<FlexportCatalog>>()
  // The last read of each order, so following its parcels does not read it again.
  const lastRead = new WeakMap<NetworkCredential, Map<string, any>>()

  /** https://docs.logistics-api.flexport.com/2026-02/#tag/Products/operation/GetProducts */
  const readCatalog = async (credential: NetworkCredential): Promise<FlexportCatalog> => {
    const bySku = new Map<string, string>()
    const byLogisticsSku = new Map<string, string>()
    for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(PRODUCT_PAGE), offset: String(page * PRODUCT_PAGE) })
      const answer = await call(credential, 'GET', `products?${query.toString()}`)
      const list: any[] = Array.isArray(answer) ? answer : []
      for (const product of list) {
        const sku = text(product?.merchantSku)
        const logisticsSku = text(product?.logisticsSku)
        if (!sku || !logisticsSku) continue
        if (!bySku.has(sku)) bySku.set(sku, logisticsSku)
        if (!byLogisticsSku.has(logisticsSku)) byLogisticsSku.set(logisticsSku, sku)
      }
      if (list.length < PRODUCT_PAGE) break
    }
    return { bySku, byLogisticsSku }
  }

  const catalog = (credential: NetworkCredential): Promise<FlexportCatalog> => {
    let found = catalogs.get(credential)
    if (!found) {
      found = readCatalog(credential)
      catalogs.set(credential, found)
      found.catch(() => catalogs.delete(credential))
    }
    return found
  }

  const remember = (credential: NetworkCredential, raw: any): any => {
    const id = text(raw?.id)
    if (id) {
      const reads = lastRead.get(credential) ?? new Map<string, any>()
      reads.set(id, raw)
      lastRead.set(credential, reads)
    }
    return raw
  }

  /** https://docs.logistics-api.flexport.com/2026-02/#tag/Orders/operation/GetOrderByExternalIdV2 */
  const byReference = async (credential: NetworkCredential, reference: string): Promise<any | null> => {
    try {
      const raw = await call(credential, 'GET', `orders/external_id/${encodeURIComponent(reference)}`)
      return raw && typeof raw === 'object' && text(raw.id) ? remember(credential, raw) : null
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-found') return null
      throw error
    }
  }

  /** https://docs.logistics-api.flexport.com/2026-02/#tag/Orders/operation/GetOrder */
  const byId = async (credential: NetworkCredential, id: string): Promise<any> =>
    remember(credential, await call(credential, 'GET', `orders/${encodeURIComponent(id)}`))

  /** The order as Flexport holds it, by its id, or by our reference where no id was kept. */
  const readRaw = async (credential: NetworkCredential, id: string, reference: string): Promise<any> => {
    if (id && id !== reference) return byId(credential, id)
    const raw = await byReference(credential, reference)
    if (!raw) throw new ProviderError('not-found', 'Flexport has no order under this reference', { status: 404 })
    return raw
  }

  /** https://docs.logistics-api.flexport.com/2026-02/#tag/Products/operation/GetInventory */
  const available = async (credential: NetworkCredential, logisticsSku: string): Promise<number | null> => {
    try {
      const answer = await call(
        credential,
        'GET',
        `products/${encodeURIComponent(logisticsSku)}/inventory?${new URLSearchParams({ aggregatePacks: 'true' }).toString()}`,
      )
      return Math.max(0, Math.floor(Number(answer?.available) || 0))
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-found') return null
      throw error
    }
  }

  return {
    id: 'flexport',

    async account(credential) {
      // Reads every connection needs: the catalog, and an order lookup. A
      // refused or under-scoped token is a 401 or 403 here, not at the first order.
      await call(credential, 'GET', `products?${new URLSearchParams({ limit: '1', offset: '0' }).toString()}`)
      await byReference(credential, PROBE_ORDER)
      return { accountName: null }
    },

    async findOrder(credential, reference) {
      const raw = await byReference(credential, reference)
      return raw ? readFlexportOrder(raw) : null
    },

    /** https://docs.logistics-api.flexport.com/2026-02/#tag/Orders/operation/CreateOrder */
    async createOrder(credential, request: NetworkOrderRequest) {
      const { bySku } = await catalog(credential)
      const missing = request.items.filter((item) => !bySku.has(item.sku)).map((item) => item.sku)
      if (missing.length) {
        throw new ProviderError('invalid', `Flexport has no product with SKU ${missing.slice(0, 3).join(', ')}`)
      }
      const currencyCode = (request.currency || 'usd').toUpperCase()
      const body = {
        externalOrderId: request.reference,
        lineItems: request.items.map((item) => ({
          lineItemId: String(item.lineIndex),
          logisticsSku: bySku.get(item.sku) as string,
          quantity: item.quantity,
          ...(item.unitValueCents > 0 ? { customsUnitValue: { amount: item.unitValueCents / 100, currencyCode } } : {}),
        })),
        address: {
          name: request.address.name,
          address1: request.address.line1,
          ...(request.address.line2 ? { address2: request.address.line2 } : {}),
          city: request.address.city,
          ...(request.address.state ? { provinceCode: request.address.state } : {}),
          zip: request.address.postalCode,
          countryCode: request.address.country,
          ...(request.address.phone ? { phone: request.address.phone } : {}),
          ...(request.address.email ? { email: request.address.email } : {}),
        },
        ...(request.shippingMethod ? { shipMethod: request.shippingMethod } : {}),
      }
      let answer: any
      try {
        answer = await call(credential, 'POST', 'orders', body, { retry: false, idempotencyKey: request.reference })
      } catch (error) {
        // Flexport already has an order under this reference: adopt it.
        if (error instanceof ProviderError && error.status === 409) {
          const existing = await byReference(credential, request.reference)
          if (existing) return readFlexportOrder(existing)
        }
        throw error
      }
      if (answer && typeof answer === 'object' && text(answer.id)) return readFlexportOrder(remember(credential, answer))
      const created = await byReference(credential, request.reference)
      return created
        ? readFlexportOrder(created)
        : { id: request.reference, reference: request.reference, state: 'open', detail: null, shipments: [] }
    },

    async getOrder(credential, id, reference) {
      return readFlexportOrder(await readRaw(credential, id, reference))
    },

    /** https://docs.logistics-api.flexport.com/2026-02/#tag/Orders/operation/CancelOrder */
    async cancelOrder(credential, id, reference): Promise<NetworkCancelOutcome> {
      let raw: any
      try {
        raw = await readRaw(credential, id, reference)
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') return 'canceled'
        throw error
      }
      const before = String(raw?.state?.internalStatus ?? '')
      if (before === 'CANCELLED') return 'canceled'
      if (SHIPPED_ORDER_STATUSES.has(before)) return 'too_late'
      let after: any
      try {
        after = await call(credential, 'POST', `orders/${encodeURIComponent(String(raw.id))}/cancel`, undefined, { retry: false })
      } catch (error) {
        // Flexport refuses to cancel an order it has already processed.
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
      const now = String(after?.state?.internalStatus ?? '')
      if (now === 'CANCELLED') return 'canceled'
      return SHIPPED_ORDER_STATUSES.has(now) ? 'too_late' : 'requested'
    },

    async stock(credential, skus) {
      const wanted = [...new Set(skus.filter(Boolean))].slice(0, SKUS_PER_SEND)
      const { bySku } = await catalog(credential)
      const found: NetworkStock[] = []
      for (const sku of wanted) {
        const logisticsSku = bySku.get(sku)
        if (!logisticsSku) continue
        const units = await available(credential, logisticsSku)
        if (units !== null) found.push({ sku, fulfillable: units })
      }
      return found
    },

    /** https://docs.logistics-api.flexport.com/2026-02/#tag/Products/operation/GetAllInventoryByCursor */
    async allStock(credential, max) {
      const { byLogisticsSku } = await catalog(credential)
      const found = new Map<string, number>()
      let cursor: string | null = null
      for (let page = 0; page < 200 && found.size < max; page += 1) {
        const query = new URLSearchParams({ limit: String(INVENTORY_PAGE) })
        if (cursor) query.set('cursor', cursor)
        const answer = await call(credential, 'GET', `products/inventory/cursor?${query.toString()}`)
        for (const record of Array.isArray(answer?.inventories) ? answer.inventories : []) {
          // A record for a pack or a SKU outside the merchant's catalog is not a store SKU.
          const sku = byLogisticsSku.get(String(record?.logisticsSku ?? ''))
          if (!sku || (!found.has(sku) && found.size >= max)) continue
          found.set(sku, (found.get(sku) ?? 0) + Math.max(0, Math.floor(Number(record?.available) || 0)))
        }
        cursor = text(answer?.nextCursor)
        if (!cursor) break
      }
      return [...found].map(([sku, fulfillable]) => ({ sku, fulfillable }))
    },

    async tracking(credential, shipment) {
      if (!shipment.packageNumber) return null
      const raw = lastRead.get(credential)?.get(shipment.packageNumber) ?? (await byId(credential, shipment.packageNumber))
      for (const part of Array.isArray(raw?.shipments) ? raw.shipments : []) {
        const pkg = (Array.isArray(part?.packages) ? part.packages : []).find((entry: any) => text(entry?.id) === shipment.id)
        if (pkg) return flexportPackageStatus(pkg, raw)
      }
      return null
    },

    /**
     * https://docs.logistics-api.flexport.com/2026-02/#tag/Webhooks/operation/GetWebhooks,
     * …/DeleteWebhook and …/CreateWebhook. Every hook of the connection is
     * removed and the wanted ones registered afresh, so a token from an
     * earlier connect stops working.
     */
    async syncWebhooks(credential, target) {
      const existing = await call(credential, 'GET', 'webhooks')
      for (const hook of Array.isArray(existing) ? existing : []) {
        if (typeof hook?.url !== 'string' || !hook.url.startsWith(target.prefix) || hook?.id === undefined) continue
        try {
          await call(credential, 'DELETE', `webhooks/${encodeURIComponent(String(hook.id))}`)
        } catch (error) {
          if (!(error instanceof ProviderError && error.kind === 'not-found')) throw error
        }
      }
      if (!target.url) return
      for (const type of FLEXPORT_WEBHOOK_EVENTS) {
        await call(
          credential,
          'POST',
          'webhooks',
          {
            type,
            url: target.url,
            method: 'POST',
            ...(target.token
              ? { authMethod: 'TOKEN', token: target.token, tokenHeader: FLEXPORT_WEBHOOK_TOKEN_HEADER }
              : { authMethod: 'NONE' }),
          },
          { retry: false },
        )
      }
    },
  }
}
