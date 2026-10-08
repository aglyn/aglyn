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
import { aftershipSlugFor, aftershipTrackingStatus } from '../model/carriers'
import { AFTERSHIP_API_BASE } from '../server/config'
import { callProvider, PostPurchaseProviderError, type ProviderFetch } from './http'

/**
 * The AfterShip adapter (AGL-3635): the merchant's own AfterShip account,
 * reached with the API key they connected (`as-api-key`), Tracking API
 * version 2024-04.
 *
 * - **Follow a parcel**: `POST /trackings` with the number, the courier slug
 *   when the carrier is one we know (AfterShip detects it otherwise), and
 *   the site and order as custom fields, so the webhook can say which order
 *   a parcel belongs to without a lookup of ours. A number already followed
 *   (AfterShip's meta code 4003) is success: a retried event must not fail.
 * - **Hear what happened**: AfterShip signs each webhook with the account's
 *   webhook secret — `aftership-hmac-sha256`, base64 HMAC-SHA256 of the raw
 *   body. Verified in constant time before the body is read; an unset secret
 *   refuses everything.
 */

export const AFTERSHIP_DUPLICATE_CODE = 4003

export interface AftershipTrackingRequest {
  apiKey: string
  trackingNumber: string
  carrier?: string | null
  hostId: string
  recordId: string
  orderNumber?: string | null
  /** The buyer's name, for the merchant reading AfterShip's dashboard. */
  customerName?: string | null
  fetchImpl?: ProviderFetch
}

/** Starts following a parcel. `already` when AfterShip follows it already. */
export async function createAftershipTracking(
  request: AftershipTrackingRequest,
): Promise<{ outcome: 'created' | 'already'; trackingId: string | null }> {
  const slug = aftershipSlugFor(request.carrier)
  try {
    const { body } = await callProvider<{ data?: { id?: string; tracking?: { id?: string } } }>({
      vendor: 'AfterShip',
      url: `${AFTERSHIP_API_BASE}/trackings`,
      method: 'POST',
      headers: { 'as-api-key': request.apiKey },
      body: {
        tracking_number: request.trackingNumber,
        ...(slug ? { slug } : {}),
        order_id: request.recordId,
        ...(request.orderNumber ? { order_number: request.orderNumber } : {}),
        ...(request.customerName ? { customer_name: request.customerName } : {}),
        custom_fields: { host_id: request.hostId, record_id: request.recordId },
      },
      fetchImpl: request.fetchImpl,
    })
    return { outcome: 'created', trackingId: body?.data?.id ?? body?.data?.tracking?.id ?? null }
  } catch (error) {
    const code = Number(((error as PostPurchaseProviderError)?.body as { meta?: { code?: unknown } })?.meta?.code)
    if (error instanceof PostPurchaseProviderError && code === AFTERSHIP_DUPLICATE_CODE) {
      return { outcome: 'already', trackingId: null }
    }
    throw error
  }
}

/** Checks the connected key works: one cheap read. */
export async function checkAftershipKey(apiKey: string, fetchImpl?: ProviderFetch): Promise<void> {
  await callProvider({
    vendor: 'AfterShip',
    url: `${AFTERSHIP_API_BASE}/couriers`,
    method: 'GET',
    headers: { 'as-api-key': apiKey },
    fetchImpl,
  })
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** One parcel update an AfterShip webhook carried. */
export interface AftershipTrackingEvent {
  trackingNumber: string
  status: PluginTrackingStatus
  detail?: string
  atMs: number
  hostId: string | null
  recordId: string | null
}

export type AftershipWebhookVerdict =
  | { ok: true; event: AftershipTrackingEvent | null }
  | { ok: false; status: number; error: string }

/** Verifies and reads one webhook delivery. Pure. */
export function verifyAftershipWebhook(input: {
  rawBody: string
  signatureHeader: string | null
  secret: string | null
}): AftershipWebhookVerdict {
  if (!input.secret) return { ok: false, status: 404, error: 'Not found' }
  const signature = String(input.signatureHeader ?? '').trim()
  if (!signature) return { ok: false, status: 401, error: 'Missing signature' }
  const expected = createHmac('sha256', input.secret).update(input.rawBody, 'utf8').digest('base64')
  if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: 'Bad signature' }
  let payload: Record<string, any>
  try {
    payload = JSON.parse(input.rawBody)
  } catch {
    return { ok: false, status: 400, error: 'Unreadable body' }
  }
  const msg = (payload?.['msg'] ?? {}) as Record<string, any>
  const status = aftershipTrackingStatus(msg['tag'], msg['subtag'])
  const trackingNumber = String(msg['tracking_number'] ?? '').trim()
  if (!status || !trackingNumber) return { ok: true, event: null }
  const checkpoints = Array.isArray(msg['checkpoints']) ? msg['checkpoints'] : []
  const latest = checkpoints[checkpoints.length - 1] as Record<string, any> | undefined
  const atMs =
    Date.parse(String(latest?.['checkpoint_time'] ?? '')) ||
    Date.parse(String(msg['updated_at'] ?? '')) ||
    (Number(payload?.['ts']) > 0 ? Number(payload['ts']) * 1000 : Date.now())
  const custom = (msg['custom_fields'] ?? {}) as Record<string, unknown>
  const detail = String(latest?.['message'] ?? msg['subtag_message'] ?? '').trim().slice(0, 200)
  return {
    ok: true,
    event: {
      trackingNumber,
      status,
      ...(detail ? { detail } : {}),
      atMs,
      hostId: typeof custom['host_id'] === 'string' ? custom['host_id'] : null,
      recordId: typeof custom['record_id'] === 'string' ? custom['record_id'] : String(msg['order_id'] ?? '') || null,
    },
  }
}

/** The merchant's tracking page for a parcel: their page base, then the number. */
export function aftershipTrackingPage(base: string, trackingNumber: string): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(trackingNumber.replace(/\s+/g, ''))}`
}
