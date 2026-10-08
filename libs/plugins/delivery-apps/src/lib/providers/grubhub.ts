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
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { SIGNATURE_SKEW_MS } from '../constants'
import type { GrubhubConfig } from '../server/config'
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
 * Grubhub (AGL-3644), through the point-of-sale API Grubhub opens to an
 * approved partner.
 *
 * - **Every request, both ways, is MAC-signed** (the OAuth 2.0 MAC scheme):
 *   `Authorization: MAC id="<client id>",nonce="<epoch seconds>:<random>",
 *   bodyhash="<base64 SHA-256 of the body>",mac="<base64 HMAC-SHA256>"`, the
 *   MAC taken over `nonce`, the method, the path and query, the host, the
 *   port, the body hash and an empty extension, one per line. A webhook
 *   whose MAC, body hash or client id does not match, or whose nonce is more
 *   than five minutes from now, is refused. Outbound calls also carry the
 *   partner key in `X-GH-PARTNER-KEY`.
 * - **Webhooks**: `{ type, order }` with `ORDER_CREATED`, `ORDER_ADJUSTED`,
 *   `ORDER_CANCELLED` and `ORDER_REFUNDED` (`refund: { id, amount, reason }`).
 * - **Calls**: `PUT /pos/v1/merchant/{merchant}/orders/{order}/status` with
 *   `CONFIRMED` (and the wait time), `REJECTED` or `READY_FOR_PICKUP`, and
 *   the menu at `PUT /pos/v1/merchant/{merchant}/menu`.
 *
 * Every amount Grubhub sends is in cents.
 */

const NAME = 'Grubhub'
/** The partner API's version root, joined to the host as a segment. */
const POS_API = 'pos/v1'
const HOSTS = { live: 'https://api-third-party-gtm.grubhub.com', sandbox: 'https://api-third-party-gtm-pp.grubhub.com' }

export const grubhubBodyHash = (body: string) => createHash('sha256').update(body, 'utf8').digest('base64')

/** The MAC over one request, by the scheme's normalized string. */
export function grubhubMac(input: {
  secretKey: string
  nonce: string
  method: string
  url: string
  bodyHash: string
}): string {
  const url = new URL(input.url)
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const normalized = [input.nonce, input.method.toUpperCase(), `${url.pathname}${url.search}`, url.hostname, port, input.bodyHash, '', ''].join('\n')
  return createHmac('sha256', Buffer.from(input.secretKey, 'base64')).update(normalized, 'utf8').digest('base64')
}

/** The `Authorization` header for one request. */
export function grubhubAuthorization(
  config: Pick<GrubhubConfig, 'clientId' | 'secretKey'>,
  request: { method: string; url: string; body: string },
  nowMs: number,
  random: () => string = () => randomBytes(8).toString('hex'),
): string {
  const nonce = `${Math.floor(nowMs / 1000)}:${random()}`
  const bodyHash = grubhubBodyHash(request.body)
  const mac = grubhubMac({ secretKey: config.secretKey, nonce, method: request.method, url: request.url, bodyHash })
  return `MAC id="${config.clientId}",nonce="${nonce}",bodyhash="${bodyHash}",mac="${mac}"`
}

/** The fields of a MAC `Authorization` header; `null` when it is not one. */
function readMacHeader(value: string): Record<string, string> | null {
  if (!/^MAC\s/i.test(value)) return null
  const fields: Record<string, string> = {}
  for (const match of value.slice(4).matchAll(/(\w+)="([^"]*)"/g)) fields[match[1]] = match[2]
  return fields['id'] && fields['nonce'] && fields['mac'] ? fields : null
}

function readLine(item: any, index: number): IncomingOrderLine {
  const options: string[] = []
  let extraCents = 0
  for (const option of Array.isArray(item?.options) ? item.options : []) {
    const quantity = Math.max(1, Number(option?.quantity) || 1)
    const name = text(option?.name, 80)
    if (name) options.push(quantity > 1 ? `${quantity} × ${name}` : name)
    extraCents += (cents(option?.price) ?? 0) * quantity
  }
  return {
    externalLineId: text(item?.id) || String(index),
    externalItemId: text(item?.external_id) || null,
    name: text(item?.name) || 'Item',
    quantity: Number(item?.quantity),
    unitPriceCents: (cents(item?.price) ?? NaN) + extraCents,
    options,
    instructions: text(item?.special_instructions, 300) || null,
  }
}

/** A Grubhub order in the plugin's words. */
export function readGrubhubOrder(order: any, nowMs = Date.now()): IncomingOrder {
  const charges = order?.charges ?? {}
  const items = Array.isArray(charges?.lines?.line_items) ? charges.lines.line_items : []
  const lines = items.map(readLine)
  const subtotal = cents(charges.diner_subtotal) ?? lines.reduce((sum: number, entry: IncomingOrderLine) => sum + entry.unitPriceCents * entry.quantity, 0)
  const tax = cents(charges.taxes?.total ?? charges.tax) ?? 0
  const discount = cents(charges.merchant_funded_discount) ?? 0
  return {
    externalOrderId: text(order?.id),
    externalRef: text(order?.order_number, 40) || text(order?.id, 8),
    storeIds: [text(order?.merchant_id)].filter(Boolean),
    placedAtMs: timeMs(order?.time_placed) ?? nowMs,
    pickupAtMs: timeMs(order?.estimated_pickup_time),
    currency: text(order?.currency, 3).toUpperCase() || 'USD',
    lines,
    subtotalCents: subtotal,
    taxCents: tax,
    discountCents: discount,
    totalCents: Math.max(0, subtotal - discount) + tax,
    customerName: shortName(order?.diner?.name),
    instructions: text(order?.special_instructions, 500) || null,
    handoff: text(order?.type).toUpperCase() === 'PICKUP' ? 'customer' : 'courier',
  }
}

export function createGrubhubProvider(input: {
  config: GrubhubConfig
  http: ProviderHttp
  now?: () => number
  random?: () => string
}): DeliveryProvider {
  const { config, http } = input
  const now = input.now ?? Date.now
  const base = config.sandbox ? HOSTS.sandbox : HOSTS.live

  const call = async (method: 'PUT', path: string, body: unknown) => {
    const url = `${base}${path}`
    const encoded = JSON.stringify(body)
    return providerRequest(http, {
      provider: NAME,
      method,
      url,
      headers: {
        Authorization: grubhubAuthorization(config, { method, url, body: encoded }, now(), input.random),
        'X-GH-PARTNER-KEY': config.partnerKey,
        'Content-Type': 'application/json',
      },
      body: encoded,
    })
  }

  const statusPath = (ref: OrderRef) =>
    `/${POS_API}/merchant/${encodeURIComponent(ref.externalStoreId)}/orders/${encodeURIComponent(ref.externalOrderId)}/status`

  return {
    id: 'grubhub',

    verify(request: WebhookRequest, nowMs: number): boolean {
      const fields = readMacHeader(request.headers.get('authorization') ?? '')
      if (!fields || fields['id'] !== config.clientId) return false
      const issuedMs = Number(fields['nonce'].split(':')[0]) * 1000
      if (!Number.isFinite(issuedMs) || Math.abs(nowMs - issuedMs) > SIGNATURE_SKEW_MS) return false
      const bodyHash = grubhubBodyHash(request.rawBody)
      if (fields['bodyhash'] !== undefined && !safeEqual(fields['bodyhash'], bodyHash)) return false
      let expected: string
      try {
        expected = grubhubMac({ secretKey: config.secretKey, nonce: fields['nonce'], method: request.method, url: request.url, bodyHash })
      } catch {
        return false
      }
      return safeEqual(fields['mac'], expected)
    },

    async parse(request: WebhookRequest): Promise<DeliveryEvent[]> {
      const body = readJson(request.rawBody)
      const type = text(body?.['type'], 60)
      const order = body?.['order']
      if (!order) return [{ kind: 'ignored', reason: `no order in ${type || 'event'}` }]
      const storeIds = [text(order?.merchant_id)].filter(Boolean)
      switch (type) {
        case 'ORDER_CREATED':
          return [{ kind: 'created', order: readGrubhubOrder(order, now()) }]
        case 'ORDER_ADJUSTED':
          return [{ kind: 'updated', eventId: text(body?.['id']) || `adjust:${text(order?.updated_at) || now()}`, order: readGrubhubOrder(order, now()) }]
        case 'ORDER_CANCELLED':
          return [{ kind: 'cancelled', externalOrderId: text(order?.id), storeIds, reason: text(order?.cancel_reason, 200) || 'Canceled on Grubhub' }]
        case 'ORDER_REFUNDED': {
          const refund = body?.['refund'] ?? {}
          const amount = cents(refund?.amount)
          if (amount === null || !text(refund?.id)) return [{ kind: 'ignored', reason: 'a refund with no id or amount' }]
          return [{
            kind: 'refunded',
            externalOrderId: text(order?.id),
            storeIds,
            refundId: text(refund.id),
            amountCents: amount,
            reason: text(refund?.reason, 200) || 'Refunded on Grubhub',
          }]
        }
        default:
          return [{ kind: 'ignored', reason: `event ${type || 'unnamed'}` }]
      }
    },

    async accept(ref: OrderRef, prepMinutes: number): Promise<void> {
      await call('PUT', statusPath(ref), { status: 'CONFIRMED', wait_time_in_minutes: prepMinutes })
    },

    async reject(ref: OrderRef, reason: string): Promise<void> {
      await call('PUT', statusPath(ref), { status: 'REJECTED', reason: reason.slice(0, 200) })
    },

    async ready(ref: OrderRef): Promise<void> {
      await call('PUT', statusPath(ref), { status: 'READY_FOR_PICKUP' })
    },

    async publishMenu(externalStoreId: string, menu: Menu): Promise<void> {
      await call('PUT', `/${POS_API}/merchant/${encodeURIComponent(externalStoreId)}/menu`, {
        name: menu.name,
        currency: menu.currency,
        sections: menu.categories.map((category) => ({
          external_id: category.id,
          name: category.name,
          items: category.items.map((item) => ({
            external_id: item.externalItemId,
            name: item.name,
            description: item.description,
            price: item.priceCents,
            available: item.available,
            ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
          })),
        })),
      })
    },
  }
}
