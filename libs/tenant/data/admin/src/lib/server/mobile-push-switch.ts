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

import type { AglynNotification } from '@aglyn/aglyn/server'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * Whether this deployment sends mobile push (AGL-3648).
 *
 * On unless `MOBILE_PUSH_ENABLED=0`: the variable is a kill switch, not an
 * opt-in, and it governs every push sender. Kept apart from the senders so
 * `notifyUsers` can ask before it calls one, and every caller reads the same
 * answer.
 */
export function mobilePushEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env['MOBILE_PUSH_ENABLED'] ?? '').trim() !== '0'
}

/** The notification a push sender is handed, as the fan-out wrote it. */
export type MobilePushPayload = Omit<AglynNotification, '$id' | 'createdAt' | 'readAt'>

/**
 * A push transport (APNs, FCM): sends one notification to the registered
 * devices (`users/{uid}/devices`) of `uids`. Must not throw on a delivery
 * failure; the console notification is the record and a push is a courtesy.
 */
export type MobilePushSender = (
  uids: readonly string[],
  payload: MobilePushPayload,
  context: { db: Firestore },
) => Promise<void>

const senders = new Set<MobilePushSender>()

/**
 * Adds a push transport to the fan-out. `notifyUsers` hands every registered
 * sender the recipients whose preferences say push, after the feed entries
 * are committed and only while the kill switch is up. With none registered,
 * nothing is pushed. Returns the unregister function.
 */
export function registerMobilePushSender(sender: MobilePushSender): () => void {
  senders.add(sender)
  return () => {
    senders.delete(sender)
  }
}

/** The registered push transports, in registration order. */
export function mobilePushSenders(): MobilePushSender[] {
  return [...senders]
}
