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
  emailThreadRootId,
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

  it('derives a root no message carries from the id that starts the conversation', () => {
    expect(emailThreadRootId('<quote.k3x9m1.9f2c4e1a0b7d3e65@mail.acme.com>')).toBe(
      '<thread.quote.k3x9m1.9f2c4e1a0b7d3e65@mail.acme.com>',
    )
    const id = mintEmailMessageId(['mail.acme.com'], { label: 'form' })
    const root = emailThreadRootId(id)
    expect(isEmailMessageId(root)).toBe(true)
    expect(root).not.toBe(id)
    // The same id always gives the same root: the headers and the stored thread agree.
    expect(emailThreadRootId(id)).toBe(root)
    expect(emailThreadRootId('nope')).toBeNull()
    // A root too long to be a Message-ID is no root, never a malformed header.
    const longest = `<${'a'.repeat(250 - '<@acme.com>'.length)}@acme.com>`
    expect(isEmailMessageId(longest)).toBe(true)
    expect(emailThreadRootId(longest)).toBeNull()
    expect(nextThreadHeaders(null, longest)).toEqual({ 'Message-ID': longest })
    expect(emailThreadAfterSend(null, { messageId: longest, subject: 'S' }).references).toEqual([longest])
  })

  it('threads three sends under one root: the first carries it, each later one replies to the last with root and chain', () => {
    const first = '<q.1.a@mail.acme.com>'
    const second = '<q.2.b@mail.acme.com>'
    const third = '<q.3.c@mail.acme.com>'
    const root = '<thread.q.1.a@mail.acme.com>'

    // The first message already carries the root, so a provider that replaces
    // its Message-ID still leaves it sharing a reference with every later one.
    expect(nextThreadHeaders(null, first)).toEqual({ 'Message-ID': first, References: root })
    let thread: EmailThread = emailThreadAfterSend(null, { messageId: first, subject: 'Quote #1042 from Acme Signs' })
    expect(thread).toEqual({ messageId: first, references: [root, first], subject: 'Quote #1042 from Acme Signs' })

    expect(nextThreadHeaders(thread, second)).toEqual({
      'Message-ID': second,
      'In-Reply-To': first,
      References: `${root} ${first}`,
    })
    // A later subject does not move the thread's.
    thread = emailThreadAfterSend(thread, { messageId: second, subject: 'Something else' })
    expect(thread.subject).toBe('Quote #1042 from Acme Signs')
    expect(thread.references).toEqual([root, first, second])

    expect(nextThreadHeaders(thread, third)).toEqual({
      'Message-ID': third,
      'In-Reply-To': second,
      References: `${root} ${first} ${second}`,
    })
    thread = emailThreadAfterSend(thread, { messageId: third, subject: 'x' })
    expect(thread.references).toEqual([root, first, second, third])
    // A stored thread reads back with its root first.
    expect(readEmailThread(JSON.parse(JSON.stringify(thread)))).toEqual(thread)
    expect(emailThreadSubject(thread, 'fallback')).toBe('Quote #1042 from Acme Signs')
    expect(emailThreadSubject(null, ' Quote #9 ')).toBe('Quote #9')
  })

  it('leaves a thread stored before roots as it was: later messages share its first id', () => {
    const first = '<q.1.a@mail.acme.com>'
    const second = '<q.2.b@mail.acme.com>'
    const third = '<q.3.c@mail.acme.com>'
    let thread: EmailThread = { messageId: first, references: [first], subject: 'Quote #1042 from Acme Signs' }

    expect(nextThreadHeaders(thread, second)).toEqual({ 'Message-ID': second, 'In-Reply-To': first, References: first })
    thread = emailThreadAfterSend(thread, { messageId: second, subject: 'x' })
    expect(thread.references).toEqual([first, second])
    expect(nextThreadHeaders(thread, third)).toEqual({
      'Message-ID': third,
      'In-Reply-To': second,
      References: `${first} ${second}`,
    })
    expect(emailThreadAfterSend(thread, { messageId: third, subject: 'x' }).references).toEqual([first, second, third])
  })

  it('keeps the root and the latest ids when the chain grows long', () => {
    let thread: EmailThread | null = null
    const ids = Array.from({ length: EMAIL_THREAD_MAX_REFERENCES + 5 }, (_, index) => `<m.${index}.x@acme.com>`)
    for (const id of ids) thread = emailThreadAfterSend(thread, { messageId: id, subject: 'S' })
    expect(thread?.references).toHaveLength(EMAIL_THREAD_MAX_REFERENCES)
    expect(thread?.references[0]).toBe('<thread.m.0.x@acme.com>')
    expect(thread?.references.at(-1)).toBe(ids.at(-1))
    const headers = nextThreadHeaders(thread, '<next.1.y@acme.com>')
    expect(headers['References'].split(' ')).toHaveLength(EMAIL_THREAD_MAX_REFERENCES)
    expect(headers['References'].split(' ')[0]).toBe('<thread.m.0.x@acme.com>')
    expect(headers['In-Reply-To']).toBe(ids.at(-1))
  })

  it('keeps a rootless thread\'s first id when its chain grows long', () => {
    const ids = Array.from({ length: EMAIL_THREAD_MAX_REFERENCES + 5 }, (_, index) => `<m.${index}.x@acme.com>`)
    let thread: EmailThread = { messageId: ids[0], references: [ids[0]], subject: 'S' }
    for (const id of ids.slice(1)) thread = emailThreadAfterSend(thread, { messageId: id, subject: 'S' })
    expect(thread.references).toHaveLength(EMAIL_THREAD_MAX_REFERENCES)
    expect(thread.references[0]).toBe(ids[0])
    expect(thread.references.at(-1)).toBe(ids.at(-1))
  })
})
