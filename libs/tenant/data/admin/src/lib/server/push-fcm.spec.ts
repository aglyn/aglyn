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

jest.mock('./firebase-admin', () => ({}))
jest.mock('firebase-admin/app', () => ({ getApp: jest.fn() }))
jest.mock('firebase-admin/messaging', () => ({ getMessaging: jest.fn() }))

import type { BatchResponse, TokenMessage } from 'firebase-admin/messaging'
import type { PushMessage, PushTarget } from './push-delivery'
import { createFcmTransport, FCM_BATCH, fcmMessage, type FcmMessaging } from './push-fcm'

const MESSAGE: PushMessage = {
  title: 'New order #1042',
  body: '$12.50 from Acme',
  data: { type: 'content.order', link: '/acme/orders/o1', orgId: 'org-1' },
  urgent: false,
}
const target = (token: string): PushTarget => ({ token, app: 'aglyn', topic: 'com.aglyn.app' })

function fakeMessaging(answer: (message: TokenMessage) => { success: boolean; code?: string }) {
  const batches: TokenMessage[][] = []
  const messaging: FcmMessaging = {
    sendEach: async (messages) => {
      batches.push(messages)
      const responses = messages.map((message) => {
        const { success, code } = answer(message)
        return success ? { success: true, messageId: 'm' } : { success: false, error: { code, message: code } }
      })
      return { responses, successCount: 0, failureCount: 0 } as unknown as BatchResponse
    },
  }
  return { batches, messaging }
}

describe('FCM transport (AGL-3651)', () => {
  it('sends the notification with the tap data, at Android high priority', async () => {
    expect(fcmMessage('tok', MESSAGE)).toEqual({
      token: 'tok',
      notification: { title: 'New order #1042', body: '$12.50 from Acme' },
      data: { type: 'content.order', link: '/acme/orders/o1', orgId: 'org-1' },
      android: { priority: 'high', notification: { sound: 'default' } },
    })
    const { batches, messaging } = fakeMessaging(() => ({ success: true }))
    expect(await createFcmTransport(messaging).send([target('t1'), target('t2')], MESSAGE)).toEqual(['sent', 'sent'])
    expect(batches[0].map((m) => m.token)).toEqual(['t1', 't2'])
  })

  it('prunes an unregistered or invalid token, and fails anything else', async () => {
    const codes: Record<string, string> = {
      gone: 'messaging/registration-token-not-registered',
      invalid: 'messaging/invalid-registration-token',
      argument: 'messaging/invalid-argument',
      busy: 'messaging/server-unavailable',
    }
    const { messaging } = fakeMessaging((m) => ({ success: false, code: codes[m.token] }))
    expect(
      await createFcmTransport(messaging).send(Object.keys(codes).map(target), MESSAGE),
    ).toEqual(['prune', 'prune', 'prune', 'failed'])
  })

  it('sends in batches of 500, and fails a batch whose call throws', async () => {
    const targets = Array.from({ length: FCM_BATCH + 3 }, (_, i) => target(`t${i}`))
    const { batches, messaging } = fakeMessaging(() => ({ success: true }))
    const outcomes = await createFcmTransport(messaging).send(targets, MESSAGE)
    expect(batches.map((b) => b.length)).toEqual([FCM_BATCH, 3])
    expect(outcomes.every((o) => o === 'sent')).toBe(true)
    const down = createFcmTransport({
      sendEach: async () => {
        throw new Error('unavailable')
      },
    })
    expect(await down.send([target('a'), target('b')], MESSAGE)).toEqual(['failed', 'failed'])
  })
})
