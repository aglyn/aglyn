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
 * Firebase Cloud Messaging for the Android app (AGL-3651), through
 * firebase-admin's `getMessaging().sendEach` with the project credentials
 * the server already holds, so it needs no secret of its own. The
 * notification is shown by the system; the tap data rides in `data`, and
 * Android delivers it at high priority.
 *
 * A token FCM reports unregistered or invalid is gone, and the row is pruned.
 *
 * Server-only, imported by `push-delivery.ts` only when a device is on FCM.
 */

import { getApp } from 'firebase-admin/app'
import { getMessaging, type BatchResponse, type TokenMessage } from 'firebase-admin/messaging'
import './firebase-admin'
import type { PushMessage, PushOutcome, PushTarget, PushTransport } from './push-delivery'

/** `sendEach` takes at most 500 messages. */
export const FCM_BATCH = 500

const GONE = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

/** The slice of firebase-admin's Messaging this transport uses; injected in tests. */
export interface FcmMessaging {
  sendEach(messages: TokenMessage[]): Promise<BatchResponse>
}

export function fcmMessage(token: string, message: PushMessage): TokenMessage {
  return {
    token,
    notification: { title: message.title, ...(message.body ? { body: message.body } : {}) },
    // FCM data values are strings; MobilePushData's are.
    data: { ...message.data },
    android: { priority: 'high', notification: { sound: 'default' } },
  }
}

export function createFcmTransport(messaging: FcmMessaging): PushTransport {
  return {
    async send(targets: readonly PushTarget[], message: PushMessage): Promise<PushOutcome[]> {
      const outcomes: PushOutcome[] = []
      for (let start = 0; start < targets.length; start += FCM_BATCH) {
        const batch = targets.slice(start, start + FCM_BATCH)
        try {
          const { responses } = await messaging.sendEach(batch.map((target) => fcmMessage(target.token, message)))
          for (const [index] of batch.entries()) {
            const response = responses[index]
            if (response?.success) outcomes.push('sent')
            else outcomes.push(GONE.has(response?.error?.code ?? '') ? 'prune' : 'failed')
          }
        } catch {
          outcomes.push(...batch.map((): PushOutcome => 'failed'))
        }
      }
      return outcomes
    },
  }
}

let configured: PushTransport | null = null

/** The deployment's FCM transport, on the firebase-admin default app. */
export function fcmTransport(): PushTransport {
  configured ??= createFcmTransport(getMessaging(getApp()))
  return configured
}
