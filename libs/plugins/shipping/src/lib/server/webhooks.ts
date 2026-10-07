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
import { easypostTrackingStatus, shippoTrackingStatus } from '../model/tracking-status'
import type { ShippingProviderId } from '../providers/types'
import { readEasypostWebhookSecret, readShippoWebhookSecrets } from './config'

/**
 * VERIFYING AND READING A PROVIDER'S WEBHOOK (AGL-3612). Pure: a request's
 * raw body and headers in, a verdict and our words out. The route applies
 * the result; nothing here reads a document.
 *
 * - **Shippo** offers a self-generated token on the webhook URL and, on
 *   request, HMAC (docs.goshippo.com, Webhook security). The URL token is
 *   required — `SHIPPO_WEBHOOK_TOKEN` — and when `SHIPPO_WEBHOOK_HMAC_SECRET`
 *   is set the `Shippo-Auth-Signature` header (`t=…,v1=…`, HMAC-SHA256 of
 *   `{t}.{body}`) must verify too, within five minutes.
 * - **EasyPost** signs every event with the webhook's secret:
 *   `X-Hmac-Signature: hmac-sha256-hex=…`, HMAC-SHA256 of the raw body under
 *   the NFKD-normalized secret, as its client libraries verify it.
 *
 * Every comparison is constant-time, and an unset secret refuses everything:
 * a webhook that cannot be verified is not read.
 */

export type WebhookVerdict =
  | { ok: true; events: ParsedWebhookEvent[] }
  | { ok: false; status: number; error: string }

export type ParsedWebhookEvent =
  | {
      kind: 'tracking'
      providerId: ShippingProviderId
      trackingNumber: string
      status: PluginTrackingStatus
      detail?: string
      atMs: number
      test: boolean
    }
  | { kind: 'refund'; providerId: ShippingProviderId; trackingNumber: string; refunded: boolean; test: boolean }

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseJson(body: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

export function verifyShippoWebhook(input: {
  rawBody: string
  urlToken: string | null
  signatureHeader: string | null
  nowMs?: number
  secrets?: { token: string; hmacSecret: string }
}): WebhookVerdict {
  const secrets = input.secrets ?? readShippoWebhookSecrets()
  if (!secrets.token) return { ok: false, status: 404, error: 'Not found' }
  if (!input.urlToken || !safeEqual(input.urlToken, secrets.token)) {
    return { ok: false, status: 401, error: 'Bad token' }
  }
  if (secrets.hmacSecret) {
    const parts = Object.fromEntries(
      String(input.signatureHeader ?? '')
        .split(',')
        .map((part) => part.trim().split('='))
        .filter((pair) => pair.length === 2),
    ) as Record<string, string>
    const timestamp = Number(parts['t'])
    const signature = String(parts['v1'] ?? '')
    if (!timestamp || !signature) return { ok: false, status: 401, error: 'Missing signature' }
    const nowMs = input.nowMs ?? Date.now()
    const stampMs = timestamp > 1e12 ? timestamp : timestamp * 1000
    if (Math.abs(nowMs - stampMs) > SIGNATURE_TOLERANCE_MS) {
      return { ok: false, status: 401, error: 'Stale signature' }
    }
    const expected = createHmac('sha256', secrets.hmacSecret)
      .update(`${parts['t']}.${input.rawBody}`)
      .digest('hex')
    if (!safeEqual(signature, expected)) return { ok: false, status: 401, error: 'Bad signature' }
  }
  const payload = parseJson(input.rawBody)
  if (!payload) return { ok: false, status: 400, error: 'Unreadable body' }
  const events: ParsedWebhookEvent[] = []
  if (payload['event'] === 'track_updated') {
    const data = (payload['data'] ?? {}) as Record<string, any>
    const status = shippoTrackingStatus(
      data['tracking_status']?.['status'],
      data['tracking_status']?.['substatus']?.['code'],
    )
    const trackingNumber = String(data['tracking_number'] ?? '').trim()
    if (status && trackingNumber) {
      events.push({
        kind: 'tracking',
        providerId: 'shippo',
        trackingNumber,
        status,
        ...(data['tracking_status']?.['status_details']
          ? { detail: String(data['tracking_status']['status_details']) }
          : {}),
        atMs: Date.parse(String(data['tracking_status']?.['status_date'] ?? '')) || (input.nowMs ?? Date.now()),
        test: payload['test'] === true,
      })
    }
  }
  return { ok: true, events }
}

export function verifyEasypostWebhook(input: {
  rawBody: string
  signatureHeader: string | null
  secret?: string
  nowMs?: number
}): WebhookVerdict {
  const secret = input.secret ?? readEasypostWebhookSecret()
  if (!secret) return { ok: false, status: 404, error: 'Not found' }
  const header = String(input.signatureHeader ?? '')
  const expected = `hmac-sha256-hex=${createHmac('sha256', secret.normalize('NFKD'))
    .update(input.rawBody, 'utf8')
    .digest('hex')}`
  if (!header || !safeEqual(header, expected)) return { ok: false, status: 401, error: 'Bad signature' }
  const payload = parseJson(input.rawBody)
  if (!payload) return { ok: false, status: 400, error: 'Unreadable body' }
  const result = (payload['result'] ?? {}) as Record<string, any>
  const test = payload['mode'] === 'test'
  const events: ParsedWebhookEvent[] = []
  if (payload['description'] === 'tracker.updated' || payload['description'] === 'tracker.created') {
    const status = easypostTrackingStatus(result['status'])
    const trackingNumber = String(result['tracking_code'] ?? '').trim()
    if (status && trackingNumber) {
      const details = Array.isArray(result['tracking_details']) ? result['tracking_details'] : []
      const last = details[details.length - 1] as Record<string, any> | undefined
      events.push({
        kind: 'tracking',
        providerId: 'easypost',
        trackingNumber,
        status,
        ...(last?.['message'] ? { detail: String(last['message']) } : {}),
        atMs:
          Date.parse(String(last?.['datetime'] ?? result['updated_at'] ?? '')) || (input.nowMs ?? Date.now()),
        test,
      })
    }
  }
  if (payload['description'] === 'refund.successful') {
    const trackingNumber = String(result['tracking_code'] ?? '').trim()
    if (trackingNumber) {
      events.push({
        kind: 'refund',
        providerId: 'easypost',
        trackingNumber,
        refunded: String(result['status'] ?? 'refunded') === 'refunded',
        test,
      })
    }
  }
  return { ok: true, events }
}
