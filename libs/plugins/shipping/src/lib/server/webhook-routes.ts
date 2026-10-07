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

import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { readOwnAccountKinds, readShippingConfig, readShippingKeyring } from './config'
import { isDocumentId, shippingDb } from './db'
import { openOwnAccount, readOwnAccount } from './own-accounts'
import { settleVoid } from './labels'
import { applyTrackingEvent, trackerDocId, type StoredTracker } from './trackers'
import {
  verifyEasypostWebhook,
  verifyEasyshipWebhook,
  verifySendcloudWebhook,
  verifyShippoWebhook,
  type ParsedWebhookEvent,
} from './webhooks'

/**
 * The providers' webhook doors (AGL-3612): machine routes, so the console's
 * dispatcher skips its per-site gates and each door verifies its caller
 * itself before it reads a byte of the payload (see `webhooks.ts`).
 *
 * A verified event is applied and answered 200 even when it names a parcel
 * this deployment does not follow — a provider retries a non-2xx for days,
 * and a parcel nobody here bought is not going to start existing. An event
 * in the other mode than the deployment's (a test event at a live
 * deployment) is acknowledged and ignored.
 */

async function applyEvents(events: ParsedWebhookEvent[]): Promise<Record<string, number>> {
  const configured = readShippingConfig()
  const testMode = configured.configured ? configured.config.testMode : false
  const counts: Record<string, number> = {}
  for (const event of events) {
    if (event.test !== testMode) {
      counts['other_mode'] = (counts['other_mode'] ?? 0) + 1
      continue
    }
    if (event.kind === 'tracking') {
      const outcome = await applyTrackingEvent(event)
      counts[outcome] = (counts[outcome] ?? 0) + 1
      continue
    }
    const tracker = (
      await shippingDb()
        .collection(SHIPPING_COLLECTIONS.trackers)
        .doc(trackerDocId(event.providerId, event.trackingNumber))
        .get()
    ).data() as StoredTracker | undefined
    if (!tracker?.labelId) {
      counts['unknown_parcel'] = (counts['unknown_parcel'] ?? 0) + 1
      continue
    }
    await settleVoid(tracker.orgId, tracker.labelId, event.refunded ? 'refunded' : 'rejected')
    counts['refund'] = (counts['refund'] ?? 0) + 1
  }
  return counts
}

export async function shippoWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const rawBody = await request.text()
  const verdict = verifyShippoWebhook({
    rawBody,
    urlToken: new URL(request.url).searchParams.get('token'),
    signatureHeader: request.headers.get('shippo-auth-signature'),
  })
  if ('error' in verdict) return Response.json({ error: verdict.error }, { status: verdict.status })
  return Response.json({ ok: true, applied: await applyEvents(verdict.events) })
}

export async function easypostWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const rawBody = await request.text()
  const verdict = verifyEasypostWebhook({
    rawBody,
    signatureHeader: request.headers.get('x-hmac-signature'),
  })
  if ('error' in verdict) return Response.json({ error: verdict.error }, { status: verdict.status })
  return Response.json({ ok: true, applied: await applyEvents(verdict.events) })
}

/**
 * The merchant-account webhooks (AGL-3632): one address per WORKSPACE
 * (`?org=`), because each is signed with that workspace's own secret —
 * Sendcloud's secret key, Easyship's webhook secret key — opened from its
 * connection. A workspace with no such connection, or a deployment that no
 * longer offers the service, refuses with 404 like an unset secret. A
 * verified event moves only a parcel of that workspace's.
 */
async function ownAccountSecret(
  orgId: string,
  kind: 'easyship' | 'sendcloud',
): Promise<string> {
  if (!isDocumentId(orgId) || !readOwnAccountKinds().includes(kind)) return ''
  const keyring = readShippingKeyring()
  if (!keyring) return ''
  const stored = await readOwnAccount(orgId, kind).catch(() => null)
  if (!stored) return ''
  try {
    const opened = openOwnAccount(stored, keyring)
    return (kind === 'sendcloud' ? opened.apiSecret : opened.webhookSecret) ?? ''
  } catch {
    return ''
  }
}

async function applyOwnAccountEvents(orgId: string, events: ParsedWebhookEvent[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const event of events) {
    if (event.kind !== 'tracking') continue
    const outcome = await applyTrackingEvent({ ...event, orgId })
    counts[outcome] = (counts[outcome] ?? 0) + 1
  }
  return counts
}

export async function sendcloudWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const orgId = new URL(request.url).searchParams.get('org') ?? ''
  const rawBody = await request.text()
  const verdict = verifySendcloudWebhook({
    rawBody,
    signatureHeader: request.headers.get('sendcloud-signature'),
    secret: await ownAccountSecret(orgId, 'sendcloud'),
  })
  if ('error' in verdict) return Response.json({ error: verdict.error }, { status: verdict.status })
  return Response.json({ ok: true, applied: await applyOwnAccountEvents(orgId, verdict.events) })
}

export async function easyshipWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const orgId = new URL(request.url).searchParams.get('org') ?? ''
  const rawBody = await request.text()
  const verdict = verifyEasyshipWebhook({
    rawBody,
    signatureHeader: request.headers.get('x-easyship-signature'),
    secret: await ownAccountSecret(orgId, 'easyship'),
  })
  if ('error' in verdict) return Response.json({ error: verdict.error }, { status: verdict.status })
  return Response.json({ ok: true, applied: await applyOwnAccountEvents(orgId, verdict.events) })
}
