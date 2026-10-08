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
import type { DoordashConfig } from '../server/config'
import { providerRequest, type ProviderHttp } from './http'
import {
  cents,
  readJson,
  safeEqual,
  shortName,
  text,
  timeMs,
  type DeliveryEvent,
  type DeliveryProvider,
  type IncomingOrder,
  type IncomingOrderLine,
  type Menu,
  type OrderRef,
  type WebhookRequest,
} from './provider'

/**
 * DoorDash Marketplace (AGL-3644), the point-of-sale integration DoorDash
 * opens to an approved provider.
 *
 * - **Webhooks.** DoorDash posts each order event to the provider's endpoint
 *   with the token configured for the integration in `Authorization`
 *   (`Bearer <token>` or the bare token); anything else is refused. The body
 *   is `{ event: { type }, order }`: `OrderCreate`, `OrderCancel`, and
 *   `OrderAdjust` when DoorDash changed the items.
 * - **Calls.** Each request carries a JWT (HS256, `dd-ver: DD-JWT-V1`)
 *   signed with the integration's signing secret: confirm an order
 *   (`PATCH /marketplace/api/v1/orders/{id}`, `success` or `fail`), mark it
 *   ready (`…/events/order_ready_for_pickup`), and push the menu.
 *
 * Every amount DoorDash sends is in cents.
 */

/** DoorDash's Marketplace API, whole, so its path is never read as a console page. */
const API = 'https://openapi.doordash.com/marketplace/api/v1'
const NAME = 'DoorDash'
/** The order event DoorDash takes as "ready for pickup". */
const READY_EVENT = 'events/order_ready_for_pickup'

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

/** The JWT DoorDash authenticates a provider's request with: five minutes, signed with the decoded secret. */
export function doordashJwt(config: Pick<DoordashConfig, 'developerId' | 'keyId' | 'signingSecret'>, nowMs: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' }))
  const iat = Math.floor(nowMs / 1000)
  const payload = b64url(JSON.stringify({ aud: 'doordash', iss: config.developerId, kid: config.keyId, iat, exp: iat + 300 }))
  const signature = createHmac('sha256', Buffer.from(config.signingSecret, 'base64url')).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function storeIds(order: any): string[] {
  return [text(order?.store?.merchant_supplied_id), text(order?.store?.id)].filter(Boolean)
}

function line(item: any, index: number, categoryIndex: number): IncomingOrderLine {
  const options: string[] = []
  let extraCents = 0
  for (const extra of Array.isArray(item?.extras) ? item.extras : []) {
    for (const option of Array.isArray(extra?.options) ? extra.options : []) {
      const quantity = Math.max(1, Number(option?.quantity) || 1)
      const name = text(option?.name, 80)
      if (name) options.push(quantity > 1 ? `${quantity} × ${name}` : name)
      extraCents += (cents(option?.price) ?? 0) * quantity
    }
  }
  return {
    externalLineId: text(item?.id) || `${categoryIndex}-${index}`,
    externalItemId: text(item?.merchant_supplied_id) || null,
    name: text(item?.name) || 'Item',
    quantity: Number(item?.quantity),
    unitPriceCents: (cents(item?.price) ?? NaN) + extraCents,
    options,
    instructions: text(item?.special_instructions, 300) || null,
  }
}

/** A DoorDash order in the plugin's words. */
export function readDoordashOrder(order: any, nowMs = Date.now()): IncomingOrder {
  const lines: IncomingOrderLine[] = []
  const categories = Array.isArray(order?.categories) ? order.categories : []
  categories.forEach((category: any, categoryIndex: number) => {
    const items = Array.isArray(category?.items) ? category.items : []
    items.forEach((item: any, index: number) => lines.push(line(item, index, categoryIndex)))
  })
  const subtotal = cents(order?.subtotal) ?? lines.reduce((sum, entry) => sum + entry.unitPriceCents * entry.quantity, 0)
  const tax = cents(order?.tax) ?? 0
  const discount = cents(order?.merchant_funded_discount) ?? 0
  return {
    externalOrderId: text(order?.id),
    externalRef: text(order?.delivery_short_code, 40) || text(order?.id, 12),
    storeIds: storeIds(order),
    placedAtMs: timeMs(order?.created_at) ?? nowMs,
    pickupAtMs: timeMs(order?.estimated_pickup_time),
    currency: text(order?.currency, 3).toUpperCase() || 'USD',
    lines,
    subtotalCents: subtotal,
    taxCents: tax,
    discountCents: discount,
    totalCents: Math.max(0, subtotal - discount) + tax,
    customerName: shortName(order?.consumer?.first_name, order?.consumer?.last_name),
    instructions: text(order?.special_instructions, 500) || null,
    handoff: order?.is_pickup === true ? 'customer' : 'courier',
  }
}

export function createDoordashProvider(input: { config: DoordashConfig; http: ProviderHttp; now?: () => number }): DeliveryProvider {
  const { config, http } = input
  const now = input.now ?? Date.now
  const headers = () => ({ Authorization: `Bearer ${doordashJwt(config, now())}`, 'Content-Type': 'application/json' })

  return {
    id: 'doordash',

    verify(request: WebhookRequest): boolean {
      const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
      return safeEqual(presented, config.webhookSecret)
    },

    async parse(request: WebhookRequest): Promise<DeliveryEvent[]> {
      const body = readJson(request.rawBody)
      const type = text(body?.['event']?.type, 60)
      const order = body?.['order']
      if (!order) return [{ kind: 'ignored', reason: `no order in ${type || 'event'}` }]
      switch (type) {
        case 'OrderCreate':
          return [{ kind: 'created', order: readDoordashOrder(order, now()) }]
        case 'OrderAdjust':
          return [{
            kind: 'updated',
            eventId: text(body?.['event']?.id) || `adjust:${text(order?.updated_at) || now()}`,
            order: readDoordashOrder(order, now()),
          }]
        case 'OrderCancel':
          return [{
            kind: 'cancelled',
            externalOrderId: text(order?.id),
            storeIds: storeIds(order),
            reason: text(order?.cancel_reason, 200) || 'Canceled on DoorDash',
          }]
        default:
          return [{ kind: 'ignored', reason: `event ${type || 'unnamed'}` }]
      }
    },

    async accept(order: OrderRef, prepMinutes: number, nowMs: number): Promise<void> {
      await providerRequest(http, {
        provider: NAME,
        method: 'PATCH',
        url: `${API}/orders/${encodeURIComponent(order.externalOrderId)}`,
        headers: headers(),
        body: {
          merchant_supplied_id: order.recordId ?? order.externalOrderId,
          order_status: 'success',
          prep_time: new Date(nowMs + prepMinutes * 60_000).toISOString(),
        },
      })
    },

    async reject(order: OrderRef, reason: string): Promise<void> {
      await providerRequest(http, {
        provider: NAME,
        method: 'PATCH',
        url: `${API}/orders/${encodeURIComponent(order.externalOrderId)}`,
        headers: headers(),
        body: { order_status: 'fail', failure_reason: reason.slice(0, 200) },
      })
    },

    async ready(order: OrderRef): Promise<void> {
      await providerRequest(http, {
        provider: NAME,
        method: 'PATCH',
        url: `${API}/orders/${encodeURIComponent(order.externalOrderId)}/${READY_EVENT}`,
        headers: headers(),
        body: { merchant_supplied_id: order.recordId ?? order.externalOrderId },
      })
    },

    async publishMenu(externalStoreId: string, menu: Menu): Promise<void> {
      await providerRequest(http, {
        provider: NAME,
        method: 'POST',
        url: `${API}/menus`,
        headers: headers(),
        retry: false,
        body: {
          reference: `aglyn-${externalStoreId}`,
          store: { merchant_supplied_id: externalStoreId, ...(config.providerType ? { provider_type: config.providerType } : {}) },
          menu: {
            name: menu.name,
            active: true,
            categories: menu.categories.map((category) => ({
              name: category.name,
              merchant_supplied_id: category.id,
              active: true,
              items: category.items.map((item) => ({
                name: item.name,
                description: item.description,
                merchant_supplied_id: item.externalItemId,
                active: item.available,
                price: item.priceCents,
                ...(item.imageUrl ? { original_image_url: item.imageUrl } : {}),
                extras: [],
              })),
            })),
          },
        },
      })
    },
  }
}
