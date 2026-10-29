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
  EMAIL_THREAD_MAX_REFERENCES,
  emailThreadAfterSend,
  emailThreadSubject,
  isEmailMessageId,
  mintEmailMessageId,
  nextThreadHeaders,
  readEmailThread,
  type EmailThread,
} from './email-thread'

describe('email threads (AGL-4097)', () => {
  it('mints a Message-ID on the sending domain, from a From value when that is what is known', () => {
    const id = mintEmailMessageId(['mail.acme.com'], { label: 'quote', atMs: 36, random: 'abc123' })
    expect(id).toBe('<quote.10.abc123@mail.acme.com>')
    expect(isEmailMessageId(id)).toBe(true)
    expect(mintEmailMessageId([null, 'Acme Signs <hello@send.acme.com>'], { atMs: 0, random: 'f' })).toBe(
      '<m.0.f@send.acme.com>',
    )
    expect(mintEmailMessageId([undefined, 'not a domain'], { atMs: 0, random: 'f' })).toBe('<m.0.f@localhost.localdomain>')
    // Unique without a given random part.
    const minted = new Set(Array.from({ length: 50 }, () => mintEmailMessageId(['acme.com'], { atMs: 1 })))
    expect(minted.size).toBe(50)
    for (const value of minted) expect(isEmailMessageId(value)).toBe(true)
  })

  it('refuses a value that could break out of a header', () => {
    expect(isEmailMessageId('<a@b.com>\r\nBcc: x@y.com')).toBe(false)
    expect(isEmailMessageId('a@b.com')).toBe(false)
    expect(isEmailMessageId('<a b@c.com>')).toBe(false)
    expect(readEmailThread({ messageId: '<a@b.com>\nX: 1', references: [], subject: 's' })).toBeNull()
    expect(
      readEmailThread({ messageId: '<a@b.com>', references: ['<z@b.com>\nX: 1', '<y@b.com>'], subject: 'Hi\r\nBcc: x' }),
    ).toEqual({ messageId: '<a@b.com>', references: ['<y@b.com>', '<a@b.com>'], subject: 'Hi Bcc: x' })
    expect(() => nextThreadHeaders(null, 'nope')).toThrow()
  })

  it('threads three sends: the first starts it, each later one replies to the last with the whole chain', () => {
    const first = '<q.1.a@mail.acme.com>'
    const second = '<q.2.b@mail.acme.com>'
    const third = '<q.3.c@mail.acme.com>'

    expect(nextThreadHeaders(null, first)).toEqual({ 'Message-ID': first })
    let thread: EmailThread = emailThreadAfterSend(null, { messageId: first, subject: 'Quote #1042 from Acme Signs' })
    expect(thread).toEqual({ messageId: first, references: [first], subject: 'Quote #1042 from Acme Signs' })

    expect(nextThreadHeaders(thread, second)).toEqual({
      'Message-ID': second,
      'In-Reply-To': first,
      References: first,
    })
    // A later subject does not move the thread's.
    thread = emailThreadAfterSend(thread, { messageId: second, subject: 'Something else' })
    expect(thread.subject).toBe('Quote #1042 from Acme Signs')

    expect(nextThreadHeaders(thread, third)).toEqual({
      'Message-ID': third,
      'In-Reply-To': second,
      References: `${first} ${second}`,
    })
    thread = emailThreadAfterSend(thread, { messageId: third, subject: 'x' })
    expect(thread.references).toEqual([first, second, third])
    expect(emailThreadSubject(thread, 'fallback')).toBe('Quote #1042 from Acme Signs')
    expect(emailThreadSubject(null, ' Quote #9 ')).toBe('Quote #9')
  })

  it('keeps the root and the latest ids when the chain grows long', () => {
    let thread: EmailThread | null = null
    const ids = Array.from({ length: EMAIL_THREAD_MAX_REFERENCES + 5 }, (_, index) => `<m.${index}.x@acme.com>`)
    for (const id of ids) thread = emailThreadAfterSend(thread, { messageId: id, subject: 'S' })
    expect(thread?.references).toHaveLength(EMAIL_THREAD_MAX_REFERENCES)
    expect(thread?.references[0]).toBe(ids[0])
    expect(thread?.references.at(-1)).toBe(ids.at(-1))
    const headers = nextThreadHeaders(thread, '<next.1.y@acme.com>')
    expect(headers['References'].split(' ')).toHaveLength(EMAIL_THREAD_MAX_REFERENCES)
    expect(headers['In-Reply-To']).toBe(ids.at(-1))
  })
})
