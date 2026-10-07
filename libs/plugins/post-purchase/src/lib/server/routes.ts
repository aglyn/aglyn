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

import { pluginShipmentRecords } from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { POST_PURCHASE_VENDORS, type PostPurchaseVendor } from '../constants/bundle-common'
import type { PostPurchaseSettingsWrite } from '../model/post-purchase-settings'
import { checkAftershipKey, verifyAftershipWebhook } from '../providers/aftership'
import { PostPurchaseProviderError } from '../providers/http'
import { offersVendor, readPostPurchaseConfig } from './config'
import { isDocumentId } from './db'
import { orderStateRef, toOrderView, type StoredPostPurchaseOrder } from './order-sync'
import { json, postPurchaseGate, refuse } from './route-gate'
import {
  applySettingsWrite,
  openVendor,
  readStoredSettings,
  settingsRef,
  SettingsRefusal,
  toSettingsView,
} from './settings-store'
import { resolvePostPurchaseSite } from './site-context'

/**
 * The console routes and AfterShip's webhook door (AGL-3635). Each console
 * route climbs {@link postPurchaseGate}: reading needs any role on the site,
 * changing a service — which stores a credential — needs admin.
 */

function offered(config: Parameters<typeof offersVendor>[0]): PostPurchaseVendor[] {
  return POST_PURCHASE_VENDORS.filter((vendor) => offersVendor(config, vendor))
}

/** `GET ?hostId` — which services this deployment offers the site. */
export async function availabilityRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const gate = await postPurchaseGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  return json({ available: true, vendors: offered(gate.config) })
}

/** `GET ?hostId` — the site's services; `POST {hostId, change}` — change one. */
export async function settingsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'Method not allowed')
  const gate = await postPurchaseGate(request, { role: request.method === 'GET' ? 'viewer' : 'admin' })
  if (gate instanceof Response) return gate
  const stored = await readStoredSettings(gate.orgId, gate.hostId)
  if (request.method === 'GET') {
    return json({ settings: toSettingsView({ ...stored, orgId: gate.orgId, hostId: gate.hostId }, gate.config), vendors: offered(gate.config) })
  }
  const change = (gate.body['change'] ?? {}) as PostPurchaseSettingsWrite
  if (!(POST_PURCHASE_VENDORS as readonly string[]).includes(String(change.vendor)) || !offersVendor(gate.config, change.vendor)) {
    return refuse(400, 'That service is not offered here.')
  }
  // A key is checked against the vendor before it is kept, where the
  // vendor has a cheap way to ask; a typo is caught here, not at the first
  // parcel.
  if (change.vendor === 'aftership' && typeof change.apiKey === 'string' && change.apiKey.trim()) {
    try {
      await checkAftershipKey(change.apiKey.trim(), gate.config.fetchImpl)
    } catch (error) {
      if (error instanceof PostPurchaseProviderError && error.permanent) {
        return refuse(400, 'AfterShip did not accept that API key.')
      }
      return refuse(502, 'AfterShip could not be reached. Try again.')
    }
  }
  let next
  try {
    next = applySettingsWrite({ ...stored, orgId: gate.orgId, hostId: gate.hostId }, change, gate.config)
  } catch (error) {
    if (error instanceof SettingsRefusal) return refuse(400, error.message)
    throw error
  }
  await settingsRef(gate.orgId, gate.hostId).set({ ...next, updatedAtMs: Date.now(), updatedBy: gate.uid })
  return json({ settings: toSettingsView(next, gate.config), vendors: offered(gate.config) })
}

/** `GET ?hostId&recordId` — what each service was told about one order. */
export async function orderRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const gate = await postPurchaseGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const recordId = new URL(request.url).searchParams.get('recordId') ?? ''
  if (!isDocumentId(recordId)) return refuse(400, 'Missing recordId')
  const state = (await orderStateRef(gate.orgId, gate.hostId, recordId).get()).data() as StoredPostPurchaseOrder | undefined
  return json({ order: toOrderView(state) })
}

/**
 * `POST ?hostId` — AfterShip's tracking webhook, which the merchant points
 * at this address from their AfterShip account. A machine door: no member,
 * so it verifies the delivery against the site's own webhook secret before
 * reading a byte, and a parcel it cannot place is acknowledged (AfterShip
 * retries anything else) and ignored.
 */
export async function aftershipWebhookRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  const rawBody = await request.text()
  const configured = readPostPurchaseConfig()
  if (!configured.configured || !isDocumentId(hostId)) return refuse(404, 'Not found')
  const site = await resolvePostPurchaseSite(hostId)
  if (!site) return refuse(404, 'Not found')
  const aftership = openVendor(await readStoredSettings(site.orgId, hostId), configured.config, 'aftership', {
    ignoreSwitch: true,
  })
  const verdict = verifyAftershipWebhook({
    rawBody,
    signatureHeader: request.headers.get('aftership-hmac-sha256'),
    secret: aftership?.webhookSecret ?? null,
  })
  if ('error' in verdict) return refuse(verdict.status, verdict.error)
  const event = verdict.event
  if (!event) return json({ ok: true, applied: 'ignored' })
  // A parcel this site's own AfterShip account followed for another site —
  // or one it never followed through us — names no order here.
  if (event.hostId !== hostId || !event.recordId || !isDocumentId(event.recordId)) {
    return json({ ok: true, applied: 'unknown_parcel' })
  }
  const state = (await orderStateRef(site.orgId, hostId, event.recordId).get()).data() as StoredPostPurchaseOrder | undefined
  if (!state?.parcels?.[event.trackingNumber]) return json({ ok: true, applied: 'unknown_parcel' })
  const records = pluginShipmentRecords()
  if (!records) return json({ ok: true, applied: 'no_seller' })
  const outcome = await records.recordTracking({
    hostId,
    recordId: event.recordId,
    trackingNumber: event.trackingNumber,
    status: event.status,
    ...(event.detail ? { detail: event.detail } : {}),
    atMs: event.atMs,
  })
  return json({ ok: true, applied: outcome.outcome })
}

