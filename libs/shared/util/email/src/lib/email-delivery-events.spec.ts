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
  normalizeEventTags,
  normalizeResendDeliveryEvents,
  worstDeliveryStatus,
} from './email-delivery-events'

const RECEIVED_AT = 1_756_000_000_000

describe('normalizeResendDeliveryEvents', () => {
  /*
   * This function is the entire vendor seam. Everything downstream — the
   * delivery log, the staff card, the erasure sweep — reads the shape it
   * produces and never a provider's field names, so these tests are the
   * contract that makes replacing the sender a one-file change.
   */
  it('translates a send into our own vocabulary', () => {
    const [event] = normalizeResendDeliveryEvents(
      {
        type: 'email.sent',
        created_at: '2026-08-26T04:48:46.000Z',
        data: {
          email_id: 'msg_1',
          to: ['Person@Example.com'],
          subject: 'Confirm your email address',
          tags: [{ name: 'context', value: 'email-verification' }],
        },
      },
      RECEIVED_AT,
    )

    expect(event).toMatchObject({
      type: 'sent',
      provider: 'resend',
      providerMessageId: 'msg_1',
      // Lowercased: the delivery log is keyed on a hash of the address, and a
      // record filed under a different casing is a record nothing looks up.
      to: 'person@example.com',
      subject: 'Confirm your email address',
      context: 'email-verification',
    })
    expect(event.at).toBe(Date.parse('2026-08-26T04:48:46.000Z'))
  })

  it('emits one event per recipient of a multi-recipient send', () => {
    const events = normalizeResendDeliveryEvents(
      {
        type: 'email.delivered',
        data: {
          email_id: 'msg_2',
          to: ['a@example.com', 'b@example.com'],
          subject: 'Usage alert',
        },
      },
      RECEIVED_AT,
    )

    // The staff view is keyed on a PERSON. One webhook covering three admins
    // has to be findable under each of them, not just the first.
    expect(events.map((event) => event.to)).toEqual([
      'a@example.com',
      'b@example.com',
    ])
    expect(new Set(events.map((event) => event.providerMessageId))).toEqual(
      new Set(['msg_2']),
    )
  })

  it('prefers the click timestamp over the message creation time', () => {
    const clickedAt = '2026-08-27T10:00:00.000Z'
    const [event] = normalizeResendDeliveryEvents(
      {
        type: 'email.clicked',
        created_at: '2026-08-20T00:00:00.000Z',
        data: {
          email_id: 'msg_3',
          to: 'a@example.com',
          click: { link: 'https://app.aglyn.com/billing', timestamp: clickedAt },
        },
      },
      RECEIVED_AT,
    )

    // A click a week after the send is the fact worth recording. Stamping it
    // with the send time would make every open and click look instantaneous.
    expect(event.at).toBe(Date.parse(clickedAt))
    expect(event.link).toBe('https://app.aglyn.com/billing')
  })

  it('normalizes a bounce type to lowercase so a reader need not know the vendor’s casing', () => {
    const [event] = normalizeResendDeliveryEvents(
      {
        type: 'email.bounced',
        data: {
          email_id: 'msg_4',
          to: 'gone@example.com',
          bounce: { type: 'Permanent', message: 'mailbox does not exist' },
        },
      },
      RECEIVED_AT,
    )

    expect(event.bounceType).toBe('permanent')
    expect(event.detail).toBe('mailbox does not exist')
  })

  it('falls back to receipt time when the payload carries no timestamp', () => {
    const [event] = normalizeResendDeliveryEvents(
      { type: 'email.delivered', data: { email_id: 'msg_5', to: 'a@example.com' } },
      RECEIVED_AT,
    )
    // Never zero and never absent: the log orders on this, and `orderBy` drops
    // documents whose sort field is missing.
    expect(event.at).toBe(RECEIVED_AT)
  })

  describe('what it declines to translate', () => {
    /*
     * Silence, never a throw. A webhook handler that 500s on an unfamiliar
     * event teaches the provider to retry it forever, and a provider is free
     * to add event types after this was written.
     */
    it.each([
      ['a contact event', { type: 'contact.created', data: { id: 'c_1' } }],
      ['inbound mail', { type: 'email.received', data: { email_id: 'm', to: 'a@b.com' } }],
      ['a type added later', { type: 'email.teleported', data: { email_id: 'm', to: 'a@b.com' } }],
      ['a payload with no message id', { type: 'email.sent', data: { to: 'a@b.com' } }],
      ['a payload with no usable recipient', { type: 'email.sent', data: { email_id: 'm', to: ['not-an-address'] } }],
      ['nothing at all', null],
    ])('returns nothing for %s', (_label, payload) => {
      expect(normalizeResendDeliveryEvents(payload, RECEIVED_AT)).toEqual([])
    })
  })
})

describe('normalizeEventTags', () => {
  it('accepts the array form the webhook sends', () => {
    expect(
      normalizeEventTags([
        { name: 'context', value: 'invite' },
        { name: 'hostId', value: 'host_1' },
      ]),
    ).toEqual({ context: 'invite', hostId: 'host_1' })
  })

  it('accepts a plain map, which is what the send API takes', () => {
    expect(normalizeEventTags({ context: 'invite' })).toEqual({
      context: 'invite',
    })
  })

  it('is an empty map for anything else', () => {
    expect(normalizeEventTags(undefined)).toEqual({})
    expect(normalizeEventTags('nonsense')).toEqual({})
  })
})

describe('worstDeliveryStatus', () => {
  /*
   * Events arrive out of order — an `opened` can beat its own `delivered`
   * through the queue. The status shown to a staffer must not depend on which
   * one landed last, and a bounce must never be overwritten by the `sent` that
   * preceded it.
   */
  it('takes the first status when there is nothing to compare against', () => {
    expect(worstDeliveryStatus(null, 'sent')).toBe('sent')
  })

  it('advances along the lifecycle', () => {
    expect(worstDeliveryStatus('sent', 'delivered')).toBe('delivered')
    expect(worstDeliveryStatus('delivered', 'opened')).toBe('opened')
  })

  it('does not walk backwards when an earlier event arrives late', () => {
    expect(worstDeliveryStatus('clicked', 'sent')).toBe('clicked')
    expect(worstDeliveryStatus('delivered', 'sent')).toBe('delivered')
  })

  it('keeps a failure once it has one', () => {
    expect(worstDeliveryStatus('bounced', 'delivered')).toBe('bounced')
    expect(worstDeliveryStatus('opened', 'complained')).toBe('complained')
  })
})
