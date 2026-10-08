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
import type { UberEatsConfig } from '../server/config'
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
 * Uber Eats (AGL-3644), through the Eats Marketplace APIs Uber opens to an
 * approved integrator.
 *
 * - **Webhooks** are signed: `X-Uber-Signature` is the lowercase hex
 *   HMAC-SHA256 of the raw body under the app's client secret. The body only
 *   NAMES the order (`meta.resource_id`, the store in `meta.user_id`); the
 *   order itself is read from `GET /v2/eats/order/{id}`. Events read:
 *   `orders.notification` (a new order), `orders.cancel` and
 *   `orders.failure` (it will not happen), and
 *   `orders.fulfillment_issues.resolved` (Uber changed its items).
 * - **Calls** carry a client-credentials token from `auth.uber.com`, kept
 *   until a minute before it lapses: `accept_pos_order`, `deny_pos_order`,
 *   and `PUT /v2/eats/stores/{id}/menus`. Uber takes no "ready" signal from
 *   a store, so this adapter has none.
 *
 * Every amount Uber sends is an integer `amount` in minor units.
 */

const API = 'https://api.uber.com'
const AUTH = 'https://auth.uber.com/oauth/v2/token'
const NAME = 'Uber Eats'
const SCOPE = 'eats.order eats.store eats.store.orders.read'

/** The signature Uber sends a webhook with. */
export function uberSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

const amount = (money: any) => cents(money?.amount)

function readLine(item: any, index: number): IncomingOrderLine {
  const options: string[] = []
  let extraCents = 0
  for (const group of Array.isArray(item?.selected_modifier_groups) ? item.selected_modifier_groups : []) {
    for (const choice of Array.isArray(group?.selected_items) ? group.selected_items : []) {
      const quantity = Math.max(1, Number(choice?.quantity) || 1)
      const name = text(choice?.title, 80)
      if (name) options.push(quantity > 1 ? `${quantity} × ${name}` : name)
      extraCents += (amount(choice?.price?.unit_price) ?? 0) * quantity
    }
  }
  return {
    externalLineId: text(item?.instance_id) || text(item?.id) || String(index),
    externalItemId: text(item?.external_data) || null,
    name: text(item?.title) || 'Item',
    quantity: Number(item?.quantity),
    unitPriceCents: (amount(item?.price?.unit_price) ?? NaN) + extraCents,
    options,
    instructions: text(item?.special_instructions, 300) || null,
  }
}

/** An Uber Eats order (v2) in the plugin's words. */
export function readUberOrder(order: any, nowMs = Date.now()): IncomingOrder {
  const items = Array.isArray(order?.cart?.items) ? order.cart.items : []
  const lines = items.map(readLine)
  const charges = order?.payment?.charges ?? {}
  const subtotal = amount(charges.sub_total) ?? lines.reduce((sum: number, entry: IncomingOrderLine) => sum + entry.unitPriceCents * entry.quantity, 0)
  const tax = amount(charges.tax) ?? 0
  const discount = amount(charges.total_promo_applied) ?? 0
  const currency = text(charges.total?.currency_code ?? items[0]?.price?.unit_price?.currency_code, 3).toUpperCase() || 'USD'
  const type = text(order?.type, 40)
  return {
    externalOrderId: text(order?.id),
    externalRef: text(order?.display_id, 40) || text(order?.id, 8),
    storeIds: [text(order?.store?.id)].filter(Boolean),
    placedAtMs: timeMs(order?.placed_at) ?? nowMs,
    pickupAtMs: timeMs(order?.estimated_ready_for_pickup_at),
    currency,
    lines,
    subtotalCents: subtotal,
    taxCents: tax,
    discountCents: discount,
    totalCents: Math.max(0, subtotal - discount) + tax,
    customerName: shortName(order?.eater?.first_name, order?.eater?.last_name),
    instructions: text(order?.cart?.special_instructions, 500) || null,
    handoff: type === 'PICK_UP' || type === 'DINE_IN' ? 'customer' : 'courier',
  }
}

export function createUberEatsProvider(input: { config: UberEatsConfig; http: ProviderHttp; now?: () => number }): DeliveryProvider {
  const { config, http } = input
  const now = input.now ?? Date.now
  let token: { value: string; expiresAtMs: number } | null = null

  const accessToken = async (): Promise<string> => {
    if (token && token.expiresAtMs - 60_000 > now()) return token.value
    const answer = await providerRequest(http, {
      provider: NAME,
      method: 'POST',
      url: AUTH,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
        scope: SCOPE,
      }).toString(),
    })
    const value = text(answer?.access_token, 4000)
    if (!value) throw new Error('Uber Eats issued no access token')
    token = { value, expiresAtMs: now() + (Number(answer?.expires_in) || 3600) * 1000 }
    return value
  }

  const call = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) =>
    providerRequest(http, {
      provider: NAME,
      method,
      url: `${API}${path}`,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body }),
    })

  const order = async (id: string) => readUberOrder(await call('GET', `/v2/eats/order/${encodeURIComponent(id)}`), now())

  return {
    id: 'uber-eats',

    verify(request: WebhookRequest): boolean {
      const presented = (request.headers.get('x-uber-signature') ?? '').trim().toLowerCase()
      return safeEqual(presented, uberSignature(request.rawBody, config.clientSecret))
    },

    async parse(request: WebhookRequest): Promise<DeliveryEvent[]> {
      const body = readJson(request.rawBody)
      const type = text(body?.['event_type'], 80)
      const orderId = text(body?.['meta']?.resource_id)
      const storeId = text(body?.['meta']?.user_id)
      if (!orderId) return [{ kind: 'ignored', reason: `no order in ${type || 'event'}` }]
      switch (type) {
        case 'orders.notification':
          return [{ kind: 'created', order: await order(orderId) }]
        case 'orders.fulfillment_issues.resolved':
          return [{ kind: 'updated', eventId: text(body?.['event_id']) || `${type}:${orderId}`, order: await order(orderId) }]
        case 'orders.cancel':
        case 'orders.failure':
          return [{
            kind: 'cancelled',
            externalOrderId: orderId,
            storeIds: [storeId].filter(Boolean),
            reason: type === 'orders.failure' ? 'Uber Eats could not complete the order' : 'Canceled on Uber Eats',
          }]
        default:
          return [{ kind: 'ignored', reason: `event ${type || 'unnamed'}` }]
      }
    },

    async accept(ref: OrderRef): Promise<void> {
      await call('POST', `/v1/eats/orders/${encodeURIComponent(ref.externalOrderId)}/accept_pos_order`, {
        reason: 'accepted',
        ...(ref.recordId ? { external_reference_id: ref.recordId } : {}),
      })
    },

    async reject(ref: OrderRef, reason: string): Promise<void> {
      await call('POST', `/v1/eats/orders/${encodeURIComponent(ref.externalOrderId)}/deny_pos_order`, {
        reason: { explanation: reason.slice(0, 200), code: 'STORE_CLOSED' },
      })
    },

    async publishMenu(externalStoreId: string, menu: Menu): Promise<void> {
      const en = (value: string) => ({ translations: { en_us: value } })
      const allDay = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => ({
        day_of_week: day,
        time_periods: [{ start_time: '00:00', end_time: '23:59' }],
      }))
      const items = menu.categories.flatMap((category) => category.items)
      await call('PUT', `/v2/eats/stores/${encodeURIComponent(externalStoreId)}/menus`, {
        items: items.map((item) => ({
          id: item.externalItemId,
          external_data: item.externalItemId,
          title: en(item.name),
          description: en(item.description),
          price_info: { price: item.priceCents },
          ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
          // A sold-out item stays on the menu, unavailable until the next send.
          ...(item.available ? {} : { suspension_info: { suspension: { suspend_until: 4102444800, reason: 'Sold out' } } }),
        })),
        categories: menu.categories.map((category) => ({
          id: category.id,
          title: en(category.name),
          entities: category.items.map((item) => ({ id: item.externalItemId, type: 'ITEM' })),
        })),
        menus: [
          {
            id: 'aglyn-menu',
            title: en(menu.name),
            service_availability: allDay,
            category_ids: menu.categories.map((category) => category.id),
          },
        ],
        menu_type: 'MENU_TYPE_FULFILLMENT_DELIVERY',
      })
    },
  }
}
