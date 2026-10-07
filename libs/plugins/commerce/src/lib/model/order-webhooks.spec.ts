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

import {
  appendOrderWebhookAttempt,
  formatOrderWebhookSignature,
  normalizeOrderWebhookEvents,
  orderWebhookAccepted,
  orderWebhookBody,
  orderWebhookDeliveryId,
  orderWebhookTakes,
  parseOrderWebhookSignature,
  ORDER_WEBHOOK_ATTEMPTS_KEPT,
} from './order-webhooks'

/** The pure rules of merchant order webhooks (AGL-3611). */

describe('order webhook rules', () => {
  it('keeps only known event names, in the list’s order', () => {
    expect(normalizeOrderWebhookEvents(['order.refunded', 'x.y', 'order.paid', 'order.paid'])).toEqual(['order.paid', 'order.refunded'])
    expect(normalizeOrderWebhookEvents('order.paid')).toEqual([])
  })

  it('hands an event only to an enabled endpoint that takes it and existed when it happened', () => {
    const endpoint = { enabled: true, events: ['order.paid' as const], createdAtMs: 100 }
    expect(orderWebhookTakes(endpoint, 'order.paid', 150)).toBe(true)
    expect(orderWebhookTakes(endpoint, 'order.refunded', 150)).toBe(false)
    expect(orderWebhookTakes(endpoint, 'order.paid', 50)).toBe(false)
    expect(orderWebhookTakes({ ...endpoint, enabled: false }, 'order.paid', 150)).toBe(false)
  })

  it('counts only a 2xx as delivered', () => {
    expect([200, 204, 299].every(orderWebhookAccepted)).toBe(true)
    expect([null, 199, 301, 404, 500].some(orderWebhookAccepted)).toBe(false)
  })

  it('round-trips the signature header and ignores what it does not know', () => {
    const header = formatOrderWebhookSignature(1700000000, 'abc')
    expect(header).toBe('t=1700000000,v1=abc')
    expect(parseOrderWebhookSignature(`${header},v0=old`)).toEqual({ timestamp: 1700000000, signatures: ['abc'] })
    expect(parseOrderWebhookSignature('v1=abc')).toBeNull()
  })

  it('builds the posted body and a slash-free delivery id', () => {
    expect(JSON.parse(orderWebhookBody({ eventId: 'e', event: 'order.paid', occurredAtMs: 0, hostId: 'h', payload: { a: 1 } }))).toEqual({
      id: 'e',
      type: 'order.paid',
      createdAt: '1970-01-01T00:00:00.000Z',
      siteId: 'h',
      data: { a: 1 },
    })
    expect(orderWebhookDeliveryId('a/b', 'w')).toBe('a_b__w')
  })

  it('keeps the latest attempts only', () => {
    let attempts = appendOrderWebhookAttempt(undefined, { atMs: 0, httpStatus: 500, durationMs: 1 })
    for (let i = 1; i < ORDER_WEBHOOK_ATTEMPTS_KEPT + 3; i++) {
      attempts = appendOrderWebhookAttempt(attempts, { atMs: i, httpStatus: 500, durationMs: 1 })
    }
    expect(attempts).toHaveLength(ORDER_WEBHOOK_ATTEMPTS_KEPT)
    expect(attempts[attempts.length - 1].atMs).toBe(ORDER_WEBHOOK_ATTEMPTS_KEPT + 2)
  })
})
