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

import { REVIEW_PLATFORMS } from '../constants/bundle-common'
import type { ReviewPlatformsSettingsWrite } from '../model/review-platforms-settings'
import { ReviewPlatformError } from '../providers/http'
import { trustpilotAccessToken } from '../providers/trustpilot'
import { yotpoAccessToken } from '../providers/yotpo'
import { isDocumentId } from './db'
import { invitationRef, toOrderView, type StoredInvitations } from './invitations'
import { json, refuse, reviewPlatformsGate } from './route-gate'
import {
  applySettingsWrite,
  readStoredSettings,
  settingsRef,
  SettingsRefusal,
  toSettingsView,
} from './settings-store'

/**
 * The console routes (AGL-3699). Each climbs {@link reviewPlatformsGate}:
 * reading needs any role on the site; changing a service — which may store
 * a credential, or point a copy of every order email at an address — needs
 * admin.
 */

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** `GET ?hostId` — the site's settings; `POST {hostId, change}` — change one service. */
export async function settingsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return refuse(405, 'Method not allowed')
  const gate = await reviewPlatformsGate(request, { role: request.method === 'GET' ? 'viewer' : 'admin' })
  if (gate instanceof Response) return gate
  const stored = await readStoredSettings(gate.orgId, gate.hostId)
  if (request.method === 'GET') return json({ settings: toSettingsView(stored, gate.config) })
  const change = (gate.body['change'] ?? {}) as ReviewPlatformsSettingsWrite
  if (!(REVIEW_PLATFORMS as readonly string[]).includes(String(change.platform))) {
    return refuse(400, 'That service is not offered here.')
  }
  let next
  try {
    next = applySettingsWrite(stored, change, gate.config)
  } catch (error) {
    if (error instanceof SettingsRefusal) return refuse(400, error.message)
    throw error
  }
  // A new key is checked against the service before it is kept, so a typo
  // is caught here rather than at the first order.
  try {
    if (change.platform === 'trustpilot' && (text(change.apiKey) || text(change.apiSecret))) {
      if (!(text(change.apiKey) && text(change.apiSecret))) {
        return refuse(400, 'Paste both the Trustpilot API key and its secret.')
      }
      await trustpilotAccessToken({ apiKey: text(change.apiKey), apiSecret: text(change.apiSecret), fetchImpl: gate.config.fetchImpl })
    }
    if (change.platform === 'yotpo' && text(change.secretKey)) {
      if (!next.yotpo?.appKey) return refuse(400, 'Add your Yotpo app key with the secret key.')
      await yotpoAccessToken({ appKey: next.yotpo.appKey, secretKey: text(change.secretKey), fetchImpl: gate.config.fetchImpl })
    }
  } catch (error) {
    const vendor = change.platform === 'trustpilot' ? 'Trustpilot' : 'Yotpo'
    if (error instanceof ReviewPlatformError && error.permanent) {
      return refuse(400, `${vendor} did not accept those keys.`)
    }
    return refuse(502, `${vendor} could not be reached. Try again.`)
  }
  await settingsRef(gate.orgId, gate.hostId).set({ ...next, updatedAtMs: Date.now(), updatedBy: gate.uid })
  return json({ settings: toSettingsView(next, gate.config) })
}

/** `GET ?hostId&recordId` — whether each service was asked to invite one order's buyer. */
export async function orderRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const gate = await reviewPlatformsGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const recordId = new URL(request.url).searchParams.get('recordId') ?? ''
  if (!isDocumentId(recordId)) return refuse(400, 'Missing recordId')
  const state = (await invitationRef(gate.orgId, gate.hostId, recordId).get()).data() as StoredInvitations | undefined
  return json({ order: toOrderView(state) })
}
