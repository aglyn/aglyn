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
import { createHmac, timingSafeEqual } from 'node:crypto'
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
 * SHIPMONK (AGL-3697), through its public API v1 with the merchant's OWN
 * key (`Api-Key` header), created on the merchant's ShipMonk "Integration API
 * Keys" page for an API store.
 *
 * - An order is created under our reference as its `order_key`. ShipMonk
 *   upserts by `store_id` + `order_key` and never creates a duplicate, and
 *   it is looked up by that key before every create besides, so a create that
 *   timed out after ShipMonk took it is adopted rather than sent again.
 * - Each line carries its index on the order as `line_key`, which ShipMonk
 *   echoes on every packed item, so a parcel's units land on the right lines.
 * - A cancel is the same upsert with `order_status: cancelled`; the
 *   warehouse may first answer `cancellation_requested`.
 * - A package has shipped once the order's processing status is past
 *   packing, or it has a ship date; each package with a tracking number is a
 *   parcel. A split order's parts are read too, each under its own number.
 * - Stock is the product's `quantity_total_available`, read through the
 *   cursor search ShipMonk built for inventory sync.
 *
 * Rate limits (ShipMonk's docs, "Getting Started"): 100,000 requests a minute
 * on every endpoint but the order list, which this adapter never calls; a 429
 * carries `Retry-After`, which the shared HTTP door honors.
 */

export const SHIPMONK_API_BASE = 'https://api.shipmonk.com'
export const SHIPMONK_SANDBOX_API_BASE = 'https://sandbox.shipmonk.dev'

/** The header ShipMonk signs each webhook with: HMAC-SHA512 of the raw body. */
export const SHIPMONK_SIGNATURE_HEADER = 'x-sm-signature'

const PRODUCT_PAGE = 500
const SKUS_PER_SEND = 50

/** Processing statuses after which the order's packages have left, or are about to. */
const SHIPPED_STATUSES = new Set([
  'awaiting_pick_up',
  'awaiting_carrier_processing',
  'en_route',
  'delivered',
  'undeliverable',
  'shipped_untrackable',
])

/** Processing statuses at which a cancel is too late: the warehouse is working on it, or it left. */
const TOO_LATE_STATUSES = new Set(['pick_in_progress', 'pack_in_progress', 'packed', ...SHIPPED_STATUSES])

/** Why ShipMonk is holding an order, in the merchant's words. */
const HELD_DETAIL: Readonly<Record<string, string>> = {
  backorder: 'ShipMonk has the order on backorder: it is waiting for stock.',
  unable_to_submit: 'ShipMonk could not submit the order. Check it in ShipMonk.',
  on_hold: 'ShipMonk put the order on hold.',
  cancellation_requested: 'A cancellation was requested at ShipMonk; its warehouse confirms it.',
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const int = (value: unknown): number => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** A ShipMonk time: ISO 8601, or the `{ date, timezone }` object some stores get. */
const timeMs = (value: unknown): number | null => {
  const raw = typeof value === 'string' ? value : typeof (value as any)?.date === 'string' ? (value as any).date.replace(' ', 'T') : null
  const parsed = raw ? Date.parse(raw) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** A package's or order's whereabouts, in the carrier-neutral word. */
export function shipmonkTrackingStatus(processingStatus: unknown): PluginTrackingStatus | null {
  switch (String(processingStatus ?? '')) {
    case 'awaiting_pick_up':
    case 'awaiting_carrier_processing':
      return 'pre_transit'
    case 'en_route':
      return 'in_transit'
    case 'delivered':
      return 'delivered'
    case 'undeliverable':
      return 'exception'
    default:
      return null
  }
}

/** The line a packed item belongs to: our line index, echoed as `line_key`. */
const lineIndexOf = (lineKey: unknown): number | undefined => {
  const raw = String(lineKey ?? '')
  return /^[0-9]{1,6}$/.test(raw) ? Number(raw) : undefined
}

function packageItems(pkg: any): NetworkShipment['items'] {
  const items: NetworkShipment['items'] = []
  const packed = Array.isArray(pkg?.packed_items) && pkg.packed_items.length ? pkg.packed_items : null
  if (packed) {
    for (const item of packed) {
      const sku = text(item?.sku)
      const quantity = int(item?.quantity)
      if (!sku || !quantity) continue
      const lineIndex = lineIndexOf(item?.line_key)
      items.push(lineIndex === undefined ? { sku, quantity } : { sku, quantity, lineIndex })
    }
    return items
  }
  for (const product of Array.isArray(pkg?.packed_products) ? pkg.packed_products : []) {
    const sku = text(product?.sku)
    const quantity = int(product?.quantity)
    if (sku && quantity) items.push({ sku, quantity })
  }
  return items
}

/** The parcels of one ShipMonk order (or one part of a split order). */
function readShipments(raw: any): NetworkShipment[] {
  const processing = String(raw?.processing_status ?? '')
  const shippedAtMs = timeMs(raw?.shipped_at)
  if (!SHIPPED_STATUSES.has(processing) && shippedAtMs === null) return []
  const data = raw?.shipment_data ?? {}
  const carrier = text(data?.carrier)
  const orderNumber = text(raw?.order_number) ?? text(raw?.order_key) ?? 'order'
  const orderKey = text(raw?.order_key)
  const trackingStatus = shipmonkTrackingStatus(processing) ?? 'in_transit'
  const packages: any[] = Array.isArray(raw?.packages) ? raw.packages : []
  const shipments: NetworkShipment[] = []
  for (const pkg of packages) {
    const trackingNumber = text(pkg?.tracking_number)
    if (!trackingNumber) continue
    shipments.push({
      id: `${orderNumber}:${pkg?.number ?? trackingNumber}`,
      carrier,
      trackingNumber,
      trackingUrl: text(pkg?.tracking_url) ?? text(data?.carrier_tracking_url) ?? text(raw?.tracking_url),
      items: packageItems(pkg),
      trackingStatus,
      trackingDetail: null,
      shippedAtMs,
      packageNumber: orderKey,
    })
  }
  // An order shipped as one piece may carry its tracking on the order only.
  const master = text(raw?.master_tracking_number)
  if (!shipments.length && master) {
    const items: NetworkShipment['items'] = []
    for (const line of Array.isArray(raw?.items) ? raw.items : []) {
      const sku = text(line?.sku)
      const quantity = int(line?.fulfilled_quantity)
      if (!sku || !quantity) continue
      const lineIndex = lineIndexOf(line?.line_key)
      items.push(lineIndex === undefined ? { sku, quantity } : { sku, quantity, lineIndex })
    }
    shipments.push({
      id: `${orderNumber}:${master}`,
      carrier,
      trackingNumber: master,
      trackingUrl: text(data?.carrier_tracking_url) ?? text(raw?.tracking_url),
      items,
      trackingStatus,
      trackingDetail: null,
      shippedAtMs,
      packageNumber: orderKey,
    })
  }
  return shipments
}

/** The order as the engine reads it; `parts` are the split order's other parts, already read. */
export function readShipmonkOrder(raw: any, parts: any[] = []): NetworkOrder {
  const status = String(raw?.order_status ?? '')
  const processing = String(raw?.processing_status ?? '')
  const shipments = [raw, ...parts].flatMap(readShipments)
  const seen = new Set<string>()
  const unique = shipments.filter((shipment) => (seen.has(shipment.id) ? false : (seen.add(shipment.id), true)))
  let state: NetworkOrder['state'] = 'open'
  let detail: string | null = HELD_DETAIL[processing] ?? (status === 'onHold' ? HELD_DETAIL['on_hold'] : null)
  if (status === 'cancelled' || processing === 'cancelled') state = 'canceled'
  else if (processing === 'fulfilled_by_3rd') {
    state = 'refused'
    detail = 'The order was marked fulfilled outside ShipMonk, so ShipMonk will not ship it. Ship it here, or check it in ShipMonk.'
  } else if (status === 'fulfilled' || SHIPPED_STATUSES.has(processing)) state = unique.length ? 'shipped' : 'open'
  const required = raw?.actions_required
  if (state === 'open' && !detail && required && typeof required === 'object') {
    const flagged = Object.entries(required).filter(([, value]) => value === true).map(([key]) => key.replace(/_/g, ' '))
    if (flagged.length) detail = `ShipMonk needs action on the order: ${flagged.slice(0, 3).join(', ')}. Check it in ShipMonk.`
  }
  return {
    id: String(raw?.order_key ?? ''),
    reference: String(raw?.order_key ?? ''),
    state,
    detail,
    shipments: unique,
  }
}

/** Whether `signature` is ShipMonk's HMAC-SHA512 of `rawBody` under `secret`, as hex or base64. */
export function verifyShipmonkSignature(rawBody: string, signature: string | null, secret: string): boolean {
  const presented = String(signature ?? '').trim()
  if (!presented || !secret) return false
  const mac = createHmac('sha512', secret).update(rawBody, 'utf8').digest()
  const candidates = [mac.toString('hex'), mac.toString('base64')]
  const given = Buffer.from(presented.replace(/^sha512=/i, ''))
  return candidates.some((candidate) => {
    const expected = Buffer.from(candidate)
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}

export function createShipmonkProvider(options: { http: ProviderHttp; sandbox: boolean }): FulfillmentNetworkProvider {
  const base = options.sandbox ? SHIPMONK_SANDBOX_API_BASE : SHIPMONK_API_BASE
  const call = (
    credential: NetworkCredential,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extra: { retry?: boolean } = {},
  ) =>
    providerRequest(options.http, {
      provider: 'ShipMonk',
      method,
      url: `${base}${path}`,
      headers: {
        'Api-Key': credential.accessToken,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...extra,
    })

  const storeOf = (credential: NetworkCredential): number => {
    const id = Number(credential.storeId)
    if (!Number.isInteger(id) || id < 1) throw new ProviderError('auth', 'The ShipMonk store id is missing. Connect again.')
    return id
  }

  /** One order by a query; `null` when ShipMonk has none. */
  const readOne = async (credential: NetworkCredential, query: Record<string, string>): Promise<any | null> => {
    try {
      const answer = await call(
        credential,
        'GET',
        `/v1/integrations/orders?${new URLSearchParams({ ...query, storeId: String(storeOf(credential)) }).toString()}`,
      )
      const data = answer?.data ?? null
      return data && typeof data === 'object' && !Array.isArray(data) && data.order_key !== undefined ? data : null
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-found') return null
      throw error
    }
  }

  /** The order with each part of a split read too. */
  const readWithParts = async (credential: NetworkCredential, reference: string): Promise<NetworkOrder | null> => {
    const raw = await readOne(credential, { orderKey: reference })
    if (!raw) return null
    const ownNumber = text(raw?.order_number)
    const partNumbers: string[] = (Array.isArray(raw?.order_parts?.main_order?.parts) ? raw.order_parts.main_order.parts : [])
      .map((part: any) => text(part?.order_number))
      .filter((number: string | null): number is string => Boolean(number) && number !== ownNumber)
    const parts: any[] = []
    for (const number of partNumbers.slice(0, 10)) {
      const part = await readOne(credential, { orderNumber: number })
      if (part) parts.push(part)
    }
    return readShipmonkOrder(raw, parts)
  }

  const productsPage = async (credential: NetworkCredential, cursor: string) =>
    call(credential, 'GET', `/v1/integrations/products/search/paginate?${new URLSearchParams({ cursor, pageSize: String(PRODUCT_PAGE) }).toString()}`)

  const available = (product: any): number => Math.max(0, Math.floor(Number(product?.inventory?.quantity_total_available) || 0))

  return {
    id: 'shipmonk',

    async account(credential) {
      const store = storeOf(credential)
      // A call every key may make: a refused key is a 401 here, not at the first order.
      await call(credential, 'GET', '/v1/integrations/warehouses')
      return { accountName: `Store ${store}` }
    },

    async findOrder(credential, reference) {
      return readWithParts(credential, reference)
    },

    async createOrder(credential, request: NetworkOrderRequest) {
      await call(
        credential,
        'POST',
        '/v1/integrations/order',
        {
          store_id: storeOf(credential),
          order_key: request.reference,
          order_number: request.displayRef,
          order_status: 'unfulfilled',
          ordered_at: new Date(request.orderedAtMs).toISOString(),
          requested_shipping_service: request.shippingMethod,
          currency_code: (request.currency || 'usd').toUpperCase(),
          ...(request.address.email ? { customer_email: request.address.email } : {}),
          ship_to: {
            name: request.address.name,
            street1: request.address.line1,
            ...(request.address.line2 ? { street2: request.address.line2 } : {}),
            city: request.address.city,
            ...(request.address.state ? { state: request.address.state } : {}),
            zip: request.address.postalCode,
            country_code: request.address.country,
            ...(request.address.phone ? { phone: request.address.phone } : {}),
          },
          items: request.items.map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
            line_key: String(item.lineIndex),
            name: item.name,
            price: item.unitValueCents / 100,
          })),
        },
        { retry: false },
      )
      // ShipMonk answers only "created"; the order is keyed by our reference.
      return { id: request.reference, reference: request.reference, state: 'open', detail: null, shipments: [] }
    },

    async getOrder(credential, _id, reference) {
      const order = await readWithParts(credential, reference)
      if (!order) throw new ProviderError('not-found', 'ShipMonk has no order under this reference', { status: 404 })
      return order
    },

    async cancelOrder(credential, _id, reference): Promise<NetworkCancelOutcome> {
      const raw = await readOne(credential, { orderKey: reference })
      if (!raw) return 'canceled'
      const processing = String(raw?.processing_status ?? '')
      if (raw?.order_status === 'cancelled' || processing === 'cancelled') return 'canceled'
      if (TOO_LATE_STATUSES.has(processing) || raw?.order_status === 'fulfilled') return 'too_late'
      const shipTo = raw?.ship_to ?? {}
      try {
        // The upsert needs the order's required fields again; they are sent as ShipMonk holds them.
        await call(
          credential,
          'POST',
          '/v1/integrations/order',
          {
            store_id: storeOf(credential),
            order_key: reference,
            order_number: String(raw?.order_number ?? reference),
            order_status: 'cancelled',
            ordered_at: String(raw?.ordered_at ?? new Date().toISOString()),
            requested_shipping_service: String(raw?.requested_shipping_service ?? 'Standard'),
            ship_to: {
              name: shipTo?.name ?? null,
              street1: shipTo?.street1 ?? shipTo?.address1 ?? null,
              street2: shipTo?.street2 ?? shipTo?.address2 ?? null,
              city: shipTo?.city ?? null,
              state: shipTo?.state ?? null,
              zip: shipTo?.zip ?? null,
              country_code: shipTo?.country_code ?? shipTo?.country ?? null,
              phone: shipTo?.phone ?? null,
            },
            items: (Array.isArray(raw?.items) ? raw.items : [])
              .filter((item: any) => text(item?.sku))
              .map((item: any) => ({
                sku: String(item.sku),
                quantity: Math.max(0, Math.floor(Number(item?.quantity) || 0)),
                ...(item?.line_key ? { line_key: String(item.line_key) } : {}),
              })),
          },
          { retry: false },
        )
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'invalid') return 'too_late'
        throw error
      }
      const after = await readOne(credential, { orderKey: reference })
      const now = String(after?.processing_status ?? '')
      if (!after || after.order_status === 'cancelled' || now === 'cancelled') return 'canceled'
      return TOO_LATE_STATUSES.has(now) ? 'too_late' : 'requested'
    },

    async stock(credential, skus) {
      const wanted = [...new Set(skus.filter(Boolean))].slice(0, SKUS_PER_SEND)
      const found: NetworkStock[] = []
      for (const sku of wanted) {
        const answer = await call(credential, 'GET', `/v1/products?${new URLSearchParams({ search: sku, pageSize: '50' }).toString()}`)
        const match = (Array.isArray(answer?.data) ? answer.data : []).find((product: any) => product?.sku === sku)
        if (match) found.push({ sku, fulfillable: available(match) })
      }
      return found
    },

    async allStock(credential, max) {
      const opened = await call(credential, 'POST', '/v1/integrations/products/search', {
        filters: { status: 'active' },
        sort: { sort_by: 'id', sort_order: 'ASC' },
      })
      let cursor = text(opened?.cursor)
      const found = new Map<string, number>()
      for (let page = 0; cursor && page < 200 && found.size < max; page += 1) {
        const answer = await productsPage(credential, cursor)
        for (const product of Array.isArray(answer?.data) ? answer.data : []) {
          const sku = text(product?.sku)
          if (sku && found.size < max) found.set(sku, (found.get(sku) ?? 0) + available(product))
        }
        cursor = text(answer?.next_cursor)
      }
      return [...found].map(([sku, fulfillable]) => ({ sku, fulfillable }))
    },

    async tracking(credential, shipment) {
      if (!shipment.packageNumber) return null
      const raw = await readOne(credential, { orderKey: shipment.packageNumber })
      const status = shipmonkTrackingStatus(raw?.processing_status)
      return status ? { status, detail: status === 'exception' ? 'ShipMonk reported the parcel undeliverable' : null } : null
    },
  }
}
