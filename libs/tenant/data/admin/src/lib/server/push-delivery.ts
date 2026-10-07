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
 * The native apps' push delivery (AGL-3651): a notification the fan-out
 * wrote goes to each recipient's registered devices, grouped by transport —
 * APNs for iOS and macOS (`push-apns.ts`), FCM for Android (`push-fcm.ts`).
 *
 * Server-only. `registerNativePushSenders` (`native-push.ts`) registers
 * `nativePushSender` with the fan-out and imports this file only when a
 * notification has push recipients, and this file imports each transport
 * only when a device needs it.
 *
 * A row the registry no longer accepts is pruned here: an Expo row from the
 * React Native app, a row with no transport, a token that does not fit its
 * transport, and a device not seen for `MOBILE_DEVICE_STALE_MS`. A token a
 * transport reports as gone is pruned after the send.
 */

import {
  isMobilePushToken,
  MOBILE_APP_BUNDLES,
  MOBILE_DEVICE_STALE_MS,
  MOBILE_DEVICES_COLLECTION,
  MOBILE_DEVICES_PER_USER,
  mobilePushData,
  type ApnsEnvironment,
  type MobileDeviceApp,
  type MobilePushData,
  type MobilePushTransport,
} from '@aglyn/aglyn/app-utils/notification-push'
import { normalizeNotificationLink } from '@aglyn/aglyn/server'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { MobilePushPayload, MobilePushSender } from './mobile-push-switch'

/** The most devices one notification is sent to, whatever the audience. */
const MAX_DEVICES = 1000

/** One device a transport sends to. */
export interface PushTarget {
  token: string
  app: MobileDeviceApp
  /** APNs: the app's bundle id, which is the push topic. */
  topic: string
  apnsEnvironment?: ApnsEnvironment
}

/** What every device of one notification is sent. */
export interface PushMessage {
  title: string
  body?: string
  data: MobilePushData
  /** Critical and warning notifications ask the platform to deliver now. */
  urgent: boolean
}

/** A transport's verdict for each target, in order. `prune`: the token is gone; forget the row. */
export type PushOutcome = 'sent' | 'prune' | 'failed'

export interface PushTransport {
  send(targets: readonly PushTarget[], message: PushMessage): Promise<PushOutcome[]>
}

export interface PushDeliveryDeps {
  db: Firestore
  /** Each transport, or null when the deployment has none configured. Resolved only when a device needs it. */
  transport: (kind: MobilePushTransport) => Promise<PushTransport | null>
  now?: () => number
}

export interface PushDeliveryResult {
  sent: number
  /** Rows removed: stale, Expo or malformed rows, and tokens a transport reported gone. */
  pruned: number
  failed: number
  /** Devices not sent to because their transport is not configured. */
  skipped: number
}

/** A stored timestamp as epoch millis, or null when there is none. */
function millis(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  const withMillis = value as { toMillis?: () => number }
  return typeof withMillis.toMillis === 'function' ? withMillis.toMillis() : null
}

export function pushMessage(payload: MobilePushPayload, link: string | undefined): PushMessage {
  return {
    title: payload.title,
    ...(payload.body ? { body: payload.body } : {}),
    data: mobilePushData({ ...payload, link }),
    urgent: payload.level === 'critical' || payload.level === 'warning',
  }
}

/** The link the app opens: the stored one, rewritten onto today's console routes. */
async function pushLink(db: Firestore, payload: MobilePushPayload): Promise<string | undefined> {
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

const isApp = (value: unknown): value is MobileDeviceApp => value === 'aglyn' || value === 'aglyn-pos'

/**
 * Sends one notification to every live device of `uids`, each through its
 * own transport. Never throws: the console notification is the record, and a
 * push is a courtesy beside it.
 */
export async function deliverNativePush(
  uids: readonly string[],
  payload: MobilePushPayload,
  deps: PushDeliveryDeps,
): Promise<PushDeliveryResult> {
  const result: PushDeliveryResult = { sent: 0, pruned: 0, failed: 0, skipped: 0 }
  if (!uids.length) return result
  const now = (deps.now ?? Date.now)()
  const prune = async (ref: DocumentReference) => {
    await ref.delete().catch(() => undefined)
    result.pruned += 1
  }
  try {
    const { db } = deps
    const groups = new Map<MobilePushTransport, Array<{ target: PushTarget; ref: DocumentReference }>>()
    const seen = new Set<string>()
    let total = 0
    for (const uid of uids) {
      const devices = await db
        .collection('users')
        .doc(uid)
        .collection(MOBILE_DEVICES_COLLECTION)
        .limit(MOBILE_DEVICES_PER_USER)
        .get()
      for (const device of devices.docs) {
        const transport = device.get('transport')
        const token = device.get('token')
        const app = device.get('app')
        if (!isMobilePushToken(transport, token) || !isApp(app)) {
          await prune(device.ref)
          continue
        }
        const lastSeen = millis(device.get('lastSeen'))
        if (lastSeen !== null && now - lastSeen > MOBILE_DEVICE_STALE_MS) {
          await prune(device.ref)
          continue
        }
        if (seen.has(token) || total >= MAX_DEVICES) continue
        seen.add(token)
        total += 1
        const environment = device.get('apnsEnvironment')
        const target: PushTarget = {
          token,
          app,
          topic: MOBILE_APP_BUNDLES[app],
          ...(transport === 'apns' && (environment === 'sandbox' || environment === 'production')
            ? { apnsEnvironment: environment }
            : {}),
        }
        const group = groups.get(transport) ?? []
        group.push({ target, ref: device.ref })
        groups.set(transport, group)
      }
    }
    if (!groups.size) return result
    const message = pushMessage(payload, await pushLink(db, payload))
    for (const [kind, entries] of groups) {
      let transport: PushTransport | null = null
      try {
        transport = await deps.transport(kind)
      } catch (error) {
        console.error(`push transport ${kind} failed to load`, error)
      }
      if (!transport) {
        result.skipped += entries.length
        continue
      }
      let outcomes: PushOutcome[]
      try {
        outcomes = await transport.send(
          entries.map((entry) => entry.target),
          message,
        )
      } catch (error) {
        console.error(`push transport ${kind} failed`, error)
        result.failed += entries.length
        continue
      }
      for (const [index, entry] of entries.entries()) {
        const outcome = outcomes[index] ?? 'failed'
        if (outcome === 'sent') result.sent += 1
        else if (outcome === 'prune') await prune(entry.ref)
        else result.failed += 1
      }
    }
  } catch (error) {
    console.error('push delivery failed', error)
  }
  return result
}

/** The deployment's transports, each imported the first time a device needs it. */
async function deploymentTransport(kind: MobilePushTransport): Promise<PushTransport | null> {
  if (kind === 'apns') return (await import('./push-apns')).apnsTransport()
  return (await import('./push-fcm')).fcmTransport()
}

/** The sender `registerNativePushSenders` hands the fan-out. */
export const nativePushSender: MobilePushSender = async (uids, payload, { db }) => {
  await deliverNativePush(uids, payload, { db, transport: deploymentTransport })
}
