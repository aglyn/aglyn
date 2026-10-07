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

import { COMMERCE_EVENT_NAMES, type CommerceEventName } from './order-events'

/**
 * Merchant order webhooks (AGL-3611): endpoints a store adds so its own
 * systems hear about orders — an ERP, a warehouse, a spreadsheet script.
 *
 * Three collections under the site, every one written only by
 * `/api/commerce/order-webhooks` and by the event subscriber:
 *
 *  - `orderWebhooks/{id}`: the endpoint — its URL, the events it takes,
 *    whether it is on, and the last few characters of its secret so a person
 *    can tell two apart. Read by the order book's readers.
 *  - `orderWebhookSecrets/{id}`: the signing secret, sealed with the shared
 *    secret box. No client reads it; the merchant sees the secret once, when
 *    it is made or rolled.
 *  - `orderWebhookDeliveries/{id}`: the delivery log, one row per event per
 *    endpoint, with each attempt's status. Read by the order book's readers.
 *
 * Each event commerce raises reaches each endpoint that takes it AT LEAST
 * ONCE, through the plugin event outbox, which retries with backoff. A
 * receiver dedupes on the `Aglyn-Event-Id` header, which is the same on every
 * attempt.
 */

/** `hosts/{hostId}/orderWebhooks/{id}`. */
export interface OrderWebhookEndpoint {
  url: string
  /** The event names this endpoint takes. */
  events: CommerceEventName[]
  enabled: boolean
  /** An optional label, e.g. "Warehouse". */
  description?: string
  /** The secret's last four characters, to tell secrets apart. */
  secretHint: string
  /** Deliveries that failed in a row; any success resets it. */
  consecutiveFailures: number
  lastDeliveryAtMs?: number
  lastDeliveryStatus?: OrderWebhookDeliveryStatus
  createdAtMs: number
  updatedAtMs: number
  createdBy: string
}

/** `hosts/{hostId}/orderWebhookSecrets/{id}`, Admin SDK only. */
export interface OrderWebhookSecretRecord {
  /** The signing secret, sealed (`sealSecret`), bound to this endpoint. */
  sealedSecret: string
  /** The id of the key that sealed it, for rotation. */
  secretKeyId: string
  updatedAtMs: number
}

export type OrderWebhookDeliveryStatus = 'delivered' | 'retrying' | 'failed'

/** One attempt at a delivery. */
export interface OrderWebhookAttempt {
  atMs: number
  /** The receiver's HTTP status; `null` when no answer came back. */
  httpStatus: number | null
  /** Why it failed, in words; absent on a success. */
  error?: string
  durationMs: number
}

/** `hosts/{hostId}/orderWebhookDeliveries/{eventId}__{endpointId}`. */
export interface OrderWebhookDelivery {
  endpointId: string
  /** The event's id, the same on every attempt: `Aglyn-Event-Id`. */
  eventId: string
  event: string
  /** The order the event is about. */
  orderId: string | null
  status: OrderWebhookDeliveryStatus
  attempts: OrderWebhookAttempt[]
  /** The JSON body as sent, so a resend sends the same bytes' meaning. */
  body: string
  /** A test ping from the console rather than a real event. */
  test?: boolean
  createdAtMs: number
  updatedAtMs: number
}

/** A store may keep this many endpoints. */
export const ORDER_WEBHOOK_MAX_ENDPOINTS = 10

/** A receiver has this long to answer before the attempt counts as failed. */
export const ORDER_WEBHOOK_TIMEOUT_MS = 8_000

/** Attempts a delivery row keeps; older ones fall off. */
export const ORDER_WEBHOOK_ATTEMPTS_KEPT = 10

/** The most a stored body may hold; a longer one is stored cut, and sent whole. */
export const ORDER_WEBHOOK_BODY_MAX = 200_000

/** A signature is good this long after its timestamp, for a receiver checking it. */
export const ORDER_WEBHOOK_TOLERANCE_SECONDS = 300

export const ORDER_WEBHOOK_SIGNATURE_HEADER = 'Aglyn-Signature'
export const ORDER_WEBHOOK_EVENT_HEADER = 'Aglyn-Event'
export const ORDER_WEBHOOK_EVENT_ID_HEADER = 'Aglyn-Event-Id'

/** The ping the console's Send test event posts. */
export const ORDER_WEBHOOK_TEST_EVENT = 'webhook.test'

/** The document id of one event's delivery to one endpoint. */
export function orderWebhookDeliveryId(eventId: string, endpointId: string): string {
  return `${eventId}__${endpointId}`.replace(/\//g, '_').slice(0, 1400)
}

/** The event names a merchant picked, cleaned: known names only, in list order. */
export function normalizeOrderWebhookEvents(raw: unknown): CommerceEventName[] {
  const wanted = new Set(Array.isArray(raw) ? (raw as unknown[]).map((value) => String(value)) : [])
  return COMMERCE_EVENT_NAMES.filter((name) => wanted.has(name))
}

/** Whether an endpoint should be handed an event that happened at `occurredAtMs`. */
export function orderWebhookTakes(
  endpoint: Pick<OrderWebhookEndpoint, 'enabled' | 'events' | 'createdAtMs'>,
  event: string,
  occurredAtMs: number,
): boolean {
  if (!endpoint.enabled) return false
  if (!(endpoint.events ?? []).includes(event as CommerceEventName)) return false
  // An endpoint added after the fact does not receive it on a retry.
  return !(Number(endpoint.createdAtMs) > occurredAtMs)
}

/** A 2xx is a delivery; anything else, a redirect included, is a failure. */
export function orderWebhookAccepted(httpStatus: number | null): boolean {
  return httpStatus !== null && httpStatus >= 200 && httpStatus < 300
}

/** The string a signature covers: `{timestamp}.{body}`, as Stripe's does. */
export function orderWebhookSignedPayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`
}

/** The `Aglyn-Signature` header value: `t={timestamp},v1={hex HMAC-SHA256}`. */
export function formatOrderWebhookSignature(timestampSeconds: number, hexDigest: string): string {
  return `t=${timestampSeconds},v1=${hexDigest}`
}

/** Reads `t` and every `v1` from a signature header, for a receiver's check. */
export function parseOrderWebhookSignature(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp = Number.NaN
  const signatures: string[] = []
  for (const part of String(header ?? '').split(',')) {
    const [key, value] = part.split('=', 2).map((piece) => piece.trim())
    if (key === 't') timestamp = Number(value)
    else if (key === 'v1' && value) signatures.push(value)
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) return null
  return { timestamp, signatures }
}

/** The JSON a receiver is posted. `data` is the event's payload. */
export interface OrderWebhookBody {
  id: string
  type: string
  createdAt: string
  siteId: string
  data: unknown
}

export function orderWebhookBody(input: {
  eventId: string
  event: string
  occurredAtMs: number
  hostId: string
  payload: unknown
}): string {
  const body: OrderWebhookBody = {
    id: input.eventId,
    type: input.event,
    createdAt: new Date(input.occurredAtMs).toISOString(),
    siteId: input.hostId,
    data: input.payload ?? null,
  }
  return JSON.stringify(body)
}

/** Appends an attempt, keeping the latest few. */
export function appendOrderWebhookAttempt(
  attempts: readonly OrderWebhookAttempt[] | undefined,
  attempt: OrderWebhookAttempt,
): OrderWebhookAttempt[] {
  return [...(attempts ?? []), attempt].slice(-ORDER_WEBHOOK_ATTEMPTS_KEPT)
}

export const ORDER_WEBHOOK_DELIVERY_STATUS_LABELS: Record<OrderWebhookDeliveryStatus, string> = {
  delivered: 'Delivered',
  retrying: 'Retrying',
  failed: 'Failed',
}

export const ORDER_WEBHOOK_DELIVERY_STATUS_COLOR: Record<OrderWebhookDeliveryStatus, 'success' | 'warning' | 'error'> = {
  delivered: 'success',
  retrying: 'warning',
  failed: 'error',
}
