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
  normalizeResendReceivedEmail,
  RESEND_RECEIVING_ENDPOINT,
  resendReceivedEmailSource,
  resendReceivedEventId,
  resendReceivedEventRecipients,
} from './received-email'

/** Resend's documented `email.received` event, as the webhook delivers it. */
const EVENT = {
  type: 'email.received',
  created_at: '2026-09-07T23:41:12.126Z',
  data: {
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    created_at: '2026-09-07T23:41:11.894Z',
    from: 'Ada <ada@example.com>',
    to: ['crm+k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3@in.aglyn.com'],
    bcc: [],
    cc: ['sam@acme.com'],
    received_for: ['forwarded@example.com'],
    message_id: '<111-222-333@email.example.com>',
    subject: 'Re: Renewal',
    attachments: [],
  },
}

/** Resend's documented receiving-API answer. */
const MESSAGE = {
  object: 'email',
  id: '56761188-7520-42d8-8898-ff6fc54ce618',
  to: ['crm+k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3@in.aglyn.com'],
  from: 'Ada <ada@example.com>',
  created_at: '2026-09-07T23:41:11.894Z',
  subject: 'Re: Renewal',
  html: '<p>October, please.</p>',
  html_format: 'data_uri',
  text: 'October, please.',
  headers: { From: 'Ada <ada@example.com>', 'In-Reply-To': '<prev@acme.com>' },
  bcc: [],
  cc: ['sam@acme.com'],
  reply_to: [],
  received_for: ['forwarded@example.com'],
  message_id: '<111-222-333@email.example.com>',
  raw: null,
  attachments: [],
}

describe('the received event', () => {
  it('names the message id of an email.received event and nothing else', () => {
    expect(resendReceivedEventId(EVENT)).toBe('56761188-7520-42d8-8898-ff6fc54ce618')
    expect(resendReceivedEventId({ ...EVENT, type: 'email.delivered' })).toBeNull()
    expect(resendReceivedEventId({ type: 'email.received', data: {} })).toBeNull()
    expect(resendReceivedEventId(null)).toBeNull()
  })

  it('lists every recipient the event carries, received-for included', () => {
    expect(resendReceivedEventRecipients(EVENT)).toEqual([
      'crm+k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3@in.aglyn.com',
      'sam@acme.com',
      'forwarded@example.com',
    ])
    expect(resendReceivedEventRecipients({})).toEqual([])
  })
})

describe('the received message', () => {
  it('reads the documented answer into the neutral shape, headers case-folded', () => {
    expect(normalizeResendReceivedEmail(MESSAGE)).toEqual({
      id: '56761188-7520-42d8-8898-ff6fc54ce618',
      messageId: '<111-222-333@email.example.com>',
      inReplyTo: '<prev@acme.com>',
      from: 'Ada <ada@example.com>',
      to: ['crm+k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3@in.aglyn.com'],
      cc: ['sam@acme.com'],
      bcc: [],
      receivedFor: ['forwarded@example.com'],
      subject: 'Re: Renewal',
      text: 'October, please.',
      html: '<p>October, please.</p>',
      receivedAtMs: Date.parse('2026-09-07T23:41:11.894Z'),
    })
  })

  it('falls back to the header for the Message-ID, to the clock for the instant, and to nothing for a null text', () => {
    const now = 1_700_000_000_000
    const row = normalizeResendReceivedEmail(
      {
        ...MESSAGE,
        message_id: undefined,
        created_at: 'not a date',
        text: null,
        headers: { 'message-id': '<h@x>' },
      },
      now,
    )
    expect(row?.messageId).toBe('<h@x>')
    expect(row?.inReplyTo).toBe('')
    expect(row?.text).toBe('')
    expect(row?.receivedAtMs).toBe(now)
    expect(normalizeResendReceivedEmail({ object: 'email' })).toBeNull()
  })

  it('reads by id with the key, answers null for a 404 and throws the status otherwise', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const answers: Array<{ status: number; body: unknown }> = [
      { status: 200, body: MESSAGE },
      { status: 404, body: { message: 'not found' } },
      { status: 401, body: { name: 'restricted_api_key' } },
    ]
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init])
      const next = answers.shift() as { status: number; body: unknown }
      return {
        ok: next.status < 300,
        status: next.status,
        json: async () => next.body,
        text: async () => JSON.stringify(next.body),
      } as Response
    }) as typeof fetch
    const read = resendReceivedEmailSource('re_full', fetchImpl)
    expect((await read('em 1'))?.id).toBe(MESSAGE.id)
    expect(calls[0][0]).toBe(`${RESEND_RECEIVING_ENDPOINT}/em%201`)
    expect((calls[0][1]?.headers as Record<string, string>)['Authorization']).toBe('Bearer re_full')
    expect(await read('gone')).toBeNull()
    await expect(read('em_3')).rejects.toThrow('HTTP 401')
  })
})
