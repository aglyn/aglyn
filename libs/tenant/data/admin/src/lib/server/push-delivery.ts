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

/**
 * The push channel's delivery (AGL-3620): a notification the fan-out wrote
 * is sent to the recipient's registered mobile devices through the Expo Push
 * API, which relays it to APNs and FCM with the credentials uploaded to EAS.
 *
 * Server-only, and imported lazily by `notifyUsers` only when a recipient's
 * preferences say push, so no client bundle and no request that notifies
 * nobody loads it.
 *
 * Sends only when the deployment opts in with `EXPO_PUSH_RELAY=1` and has
 * not pulled the `MOBILE_PUSH_ENABLED=0` kill switch: the title and body
 * would pass through Expo, which is not on the Subprocessors list.
 * `EXPO_ACCESS_TOKEN`, when set, is sent as the bearer Expo's enhanced push
 * security requires.
 */

import {
  isExpoPushToken,
  MOBILE_DEVICE_STALE_MS,
  MOBILE_DEVICES_COLLECTION,
  MOBILE_DEVICES_PER_USER,
  mobilePushData,
} from '@aglyn/aglyn/app-utils/notification-push'
import { normalizeNotificationLink } from '@aglyn/aglyn/server'
import type { AglynNotification } from '@aglyn/aglyn/server'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { expoPushRelayEnabled, mobilePushEnabled } from './mobile-push-switch'

export { expoPushRelayEnabled, mobilePushEnabled }

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH = 100

/** The most messages one notification sends, whatever the audience. */
const MAX_MESSAGES = 1000


export type PushPayload = Omit<AglynNotification, '$id' | 'createdAt' | 'readAt'>

export interface ExpoPushMessage {
  to: string
  title: string
  body?: string
  data: Record<string, string>
  sound: 'default'
  priority: 'high' | 'default'
  channelId: 'default'
}

interface ExpoTicket {
  status?: 'ok' | 'error'
  details?: { error?: string }
}

export interface PushDeliveryDeps {
  db: Firestore
  fetch?: typeof fetch
  env?: Record<string, string | undefined>
  now?: () => number
}

export interface PushDeliveryResult {
  sent: number
  /** Device rows removed because Expo said the token is no longer registered. */
  pruned: number
  failed: number
}

/** A stored timestamp as epoch millis, or null when there is none. */
function millis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  const withMillis = value as { toMillis?: () => number }
  return typeof withMillis.toMillis === 'function' ? withMillis.toMillis() : null
}

export function pushMessage(token: string, payload: PushPayload, link: string | undefined): ExpoPushMessage {
  const data = mobilePushData({ ...payload, link })
  return {
    to: token,
    title: payload.title,
    ...(payload.body ? { body: payload.body } : {}),
    data: data as unknown as Record<string, string>,
    sound: 'default',
    priority: payload.level === 'critical' || payload.level === 'warning' ? 'high' : 'default',
    channelId: 'default',
  }
}

/** The link the app opens: the stored one, rewritten onto today's console routes. */
async function pushLink(db: Firestore, payload: PushPayload): Promise<string | undefined> {
  if (!payload.link) return undefined
  if (!payload.orgId) return normalizeNotificationLink(payload.link, {})
  try {
    const [org, host] = await Promise.all([
      db.collection('orgs').doc(payload.orgId).get(),
      payload.hostId ? db.collection('hosts').doc(payload.hostId).get() : Promise.resolve(null),
    ])
    const slug = org.get('slug')
    const subdomain = host?.get('subdomain')
    return normalizeNotificationLink(payload.link, {
      orgSlug: typeof slug === 'string' ? slug : null,
      hostId: payload.hostId ?? null,
      hostSubdomain: typeof subdomain === 'string' ? subdomain : null,
    })
  } catch {
    return normalizeNotificationLink(payload.link, {})
  }
}

/**
 * Sends one notification to every live device of `uids`. Never throws: the
 * console notification is the record, and a push is a courtesy beside it.
 */
export async function deliverPush(
  uids: readonly string[],
  payload: PushPayload,
  deps: PushDeliveryDeps,
): Promise<PushDeliveryResult> {
  const result: PushDeliveryResult = { sent: 0, pruned: 0, failed: 0 }
  const env = deps.env ?? process.env
  if (!uids.length || !mobilePushEnabled(env) || !expoPushRelayEnabled(env)) return result
  const send = deps.fetch ?? fetch
  const now = (deps.now ?? Date.now)()
  try {
    const { db } = deps
    const targets: Array<{ token: string; ref: DocumentReference }> = []
    const seen = new Set<string>()
    for (const uid of uids) {
      const devices = await db
        .collection('users')
        .doc(uid)
        .collection(MOBILE_DEVICES_COLLECTION)
        .limit(MOBILE_DEVICES_PER_USER)
        .get()
      for (const device of devices.docs) {
        const token = device.get('token')
        const lastSeen = millis(device.get('lastSeen'))
        if (!isExpoPushToken(token) || seen.has(token)) continue
        if (lastSeen !== null && now - lastSeen > MOBILE_DEVICE_STALE_MS) {
          await device.ref.delete().catch(() => undefined)
          result.pruned += 1
          continue
        }
        seen.add(token)
        targets.push({ token, ref: device.ref })
      }
    }
    if (!targets.length) return result
    const link = await pushLink(db, payload)
    const limited = targets.slice(0, MAX_MESSAGES)
    const token = (env['EXPO_ACCESS_TOKEN'] ?? '').trim()
    for (let start = 0; start < limited.length; start += EXPO_PUSH_BATCH) {
      const chunk = limited.slice(start, start + EXPO_PUSH_BATCH)
      try {
        const response = await send(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(chunk.map((target) => pushMessage(target.token, payload, link))),
        })
        if (!response.ok) {
          result.failed += chunk.length
          continue
        }
        const body = (await response.json().catch(() => null)) as { data?: ExpoTicket[] } | null
        const tickets = Array.isArray(body?.data) ? body.data : []
        for (const [index, target] of chunk.entries()) {
          const ticket = tickets[index]
          if (ticket?.status === 'ok') {
            result.sent += 1
          } else if (ticket?.details?.error === 'DeviceNotRegistered') {
            // The app was uninstalled or the token rotated: forget the row,
            // the next launch registers the new one.
            await target.ref.delete().catch(() => undefined)
            result.pruned += 1
          } else {
            result.failed += 1
          }
        }
      } catch {
        result.failed += chunk.length
      }
    }
  } catch (error) {
    console.error('push delivery failed', error)
  }
  return result
}
