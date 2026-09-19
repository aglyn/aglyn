/**
 * @jest-environment node
 *
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
  buildRfc5322Message,
  encodeGmailRawMessage,
  encodeQuotedPrintable,
  formatRfc5322Date,
  LIST_UNSUBSCRIBE_ONE_CLICK,
  Rfc5322MessageError,
  type OutreachComposedMessage,
  type Rfc5322MessageErrorCode,
} from './rfc5322'

/**
 * The RFC 5322 output Outreach hands Gmail (AGL-2978).
 *
 * The first case pins one message byte for byte, so a change to the wire
 * format is a visible diff. The rest go through a small, independent reader
 * written here — unfold, decode the encoded-words, decode quoted-printable —
 * and require that what comes back out is what went in: a builder can only
 * be checked against a parser that is not itself.
 */

const DATE = new Date(Date.UTC(2026, 8, 14, 23, 45, 7))

const BASE: OutreachComposedMessage = {
  from: { address: 'avery@rep.example.com', name: 'Avery Rep' },
  to: { address: 'jordan@prospect.example.org', name: 'Jordan Prospect' },
  subject: 'Quick question',
  text: 'Hi Jordan,\nIs this a good week?\n\nAvery',
}

const build = (overrides: Partial<OutreachComposedMessage> = {}) =>
  buildRfc5322Message({ ...BASE, ...overrides }, { date: DATE, messageIdLocalPart: 'fixed-id' })

/** Headers, unfolded, keyed lower-case; and the body as sent. */
function parse(raw: string): { headers: Map<string, string>; lines: string[]; body: string } {
  const split = raw.indexOf('\r\n\r\n')
  const head = raw.slice(0, split)
  const lines = head.split('\r\n')
  const headers = new Map<string, string>()
  for (const field of head.replace(/\r\n(?=[ \t])/g, '').split('\r\n')) {
    const colon = field.indexOf(':')
    headers.set(field.slice(0, colon).toLowerCase(), field.slice(colon + 1).replace(/^ /, ''))
  }
  return { headers, lines, body: raw.slice(split + 4) }
}

/** RFC 2047 `B` words decoded, the whitespace between adjacent words dropped. */
function decodeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_match, encoded: string) =>
      Buffer.from(encoded, 'base64').toString('utf8'),
    )
}

/** Quoted-printable decoded to text. */
function decodeQuotedPrintable(value: string): string {
  const joined = value.replace(/=\r\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < joined.length; index += 1) {
    if (joined[index] === '=') {
      bytes.push(parseInt(joined.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(joined.charCodeAt(index))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function codeOf(run: () => unknown): Rfc5322MessageErrorCode | 'no-throw' | 'other' {
  try {
    run()
    return 'no-throw'
  } catch (error) {
    return error instanceof Rfc5322MessageError ? error.code : 'other'
  }
}

describe('buildRfc5322Message — the wire format (AGL-2978)', () => {
  it('writes a plain ASCII message exactly, CRLF throughout', () => {
    const { raw, messageId } = build()
    expect(messageId).toBe('<fixed-id@rep.example.com>')
    expect(raw).toBe(
      [
        'From: "Avery Rep" <avery@rep.example.com>',
        'To: "Jordan Prospect" <jordan@prospect.example.org>',
        'Subject: Quick question',
        'Date: Mon, 14 Sep 2026 23:45:07 +0000',
        'Message-ID: <fixed-id@rep.example.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        'Hi Jordan,',
        'Is this a good week?',
        '',
        'Avery',
        '',
      ].join('\r\n'),
    )
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('sends nothing but the plain text: no HTML part, no pixel, no rewritten link', () => {
    const { raw } = build({ text: 'See https://prospect.example.org/pricing' })
    expect(raw).not.toMatch(/text\/html|multipart|<img|<a /i)
    expect(parse(raw).body).toBe('See https://prospect.example.org/pricing\r\n')
  })

  it('gives the Message-ID a random UUID on the From domain unless told otherwise', () => {
    const { messageId } = buildRfc5322Message(BASE, { date: DATE })
    expect(messageId).toMatch(/^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@rep\.example\.com>$/)
    expect(
      buildRfc5322Message(BASE, { date: DATE, messageIdLocalPart: 'x1', messageIdDomain: 'mail.example.net' })
        .messageId,
    ).toBe('<x1@mail.example.net>')
  })

  it('writes a bare address when there is no display name', () => {
    const { headers } = parse(build({ from: 'avery@rep.example.com', to: { address: 'jordan@prospect.example.org' } }).raw)
    expect(headers.get('from')).toBe('avery@rep.example.com')
    expect(headers.get('to')).toBe('jordan@prospect.example.org')
  })

  it('formats the Date header in RFC 5322 form', () => {
    expect(formatRfc5322Date(new Date(Date.UTC(2027, 0, 3, 4, 5, 6)))).toBe('Sun, 03 Jan 2027 04:05:06 +0000')
  })
})

describe('buildRfc5322Message — encodings that round-trip (AGL-2978)', () => {
  it('encodes a non-ASCII subject and names as RFC 2047 words that decode back', () => {
    const subject = 'Réunion à Zürich — 東京の件について、ご相談があります 🚀'
    const { raw } = build({
      subject,
      from: { address: 'avery@rep.example.com', name: 'Avéry Ölmez' },
      to: { address: 'jordan@prospect.example.org', name: '山田 花子' },
    })
    const { headers, lines } = parse(raw)
    expect(decodeWords(headers.get('subject') ?? '')).toBe(subject)
    expect(decodeWords(headers.get('from') ?? '')).toBe('Avéry Ölmez <avery@rep.example.com>')
    expect(decodeWords(headers.get('to') ?? '')).toBe('山田 花子 <jordan@prospect.example.org>')
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78)
    for (const word of raw.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) {
      expect(word.length).toBeLessThanOrEqual(75)
    }
  })

  it('folds a long ASCII subject under 78 columns and unfolds to it exactly, spaces kept', () => {
    const subject = `A  long subject ${'that keeps going '.repeat(8)}to the end`
    const { raw } = build({ subject })
    const { headers, lines } = parse(raw)
    expect(headers.get('subject')).toBe(subject)
    expect(lines.filter((line) => line.startsWith(' ')).length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(78)
      expect(line.trim()).not.toBe('')
    }
  })

  it('encodes an ASCII subject a mail client would otherwise decode as a word', () => {
    const subject = 'Hello =?utf-8?q?not-a-word?= there'
    const { raw } = build({ subject })
    expect(raw).not.toContain('=?utf-8?q?')
    expect(decodeWords(parse(raw).headers.get('subject') ?? '')).toBe(subject)
  })

  it('sends a non-ASCII body as quoted-printable that decodes to the text, lines at most 76', () => {
    const text = 'Grüße aus Köln!\nPrice: 5 = 5 \t\nこんにちは'
    const { raw } = build({ text })
    const { headers, body } = parse(raw)
    expect(headers.get('content-transfer-encoding')).toBe('quoted-printable')
    expect(decodeQuotedPrintable(body)).toBe('Grüße aus Köln!\r\nPrice: 5 = 5 \t\r\nこんにちは\r\n')
    for (const line of body.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76)
      expect(line).not.toMatch(/[ \t]$/)
    }
  })

  it('soft-breaks an ASCII line longer than 998 octets rather than sending it 7bit', () => {
    const text = 'x'.repeat(1200)
    const { raw } = build({ text })
    const { headers, body } = parse(raw)
    expect(headers.get('content-transfer-encoding')).toBe('quoted-printable')
    expect(decodeQuotedPrintable(body)).toBe(`${text}\r\n`)
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
  })

  it('normalizes LF, CR and CRLF line breaks to CRLF', () => {
    const { body } = parse(build({ text: 'one\ntwo\rthree\r\nfour' }).raw)
    expect(body).toBe('one\r\ntwo\r\nthree\r\nfour\r\n')
  })

  it('encodes quoted-printable per RFC 2045 at the byte level', () => {
    expect(encodeQuotedPrintable('a=b')).toBe('a=3Db')
    expect(encodeQuotedPrintable('trailing ')).toBe('trailing=20')
    expect(encodeQuotedPrintable('tab\t')).toBe('tab=09')
    expect(encodeQuotedPrintable('é')).toBe('=C3=A9')
    // A soft break never splits an =XX triple.
    const encoded = encodeQuotedPrintable(`${'a'.repeat(74)}é`)
    expect(encoded).toBe(`${'a'.repeat(74)}=\r\n=C3=A9`)
  })

  it('base64url-encodes the raw message for messages.send', () => {
    const { raw } = build({ text: 'Ümlaut' })
    const encoded = encodeGmailRawMessage(raw)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(raw)
  })
})

describe('buildRfc5322Message — reply and unsubscribe headers (AGL-2978)', () => {
  it('writes In-Reply-To, References and the one-click unsubscribe pair', () => {
    const { raw } = build({
      headers: {
        'In-Reply-To': '<first@rep.example.com>',
        References: '<first@rep.example.com> <second@rep.example.com>',
        'List-Unsubscribe': '<https://app.example.com/u/abc>, <mailto:u@example.com>',
        'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK,
        'X-Outreach-Enrollment': 'enr-1',
      },
    })
    const { headers } = parse(raw)
    expect(headers.get('in-reply-to')).toBe('<first@rep.example.com>')
    expect(headers.get('references')).toBe('<first@rep.example.com> <second@rep.example.com>')
    expect(headers.get('list-unsubscribe')).toBe('<https://app.example.com/u/abc>, <mailto:u@example.com>')
    expect(headers.get('list-unsubscribe-post')).toBe('List-Unsubscribe=One-Click')
    expect(headers.get('x-outreach-enrollment')).toBe('enr-1')
    // Structural headers stay in their place, after the caller's.
    expect(raw.indexOf('In-Reply-To:')).toBeLessThan(raw.indexOf('MIME-Version:'))
  })

  it('omits a header whose value is empty, null or undefined', () => {
    const { headers } = parse(build({ headers: { 'In-Reply-To': '', References: null, 'Reply-To': undefined } }).raw)
    expect(headers.has('in-reply-to')).toBe(false)
    expect(headers.has('references')).toBe(false)
    expect(headers.has('reply-to')).toBe(false)
  })

  it('folds a long References header without losing a message id', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `<message-${index}@rep.example.com>`).join(' ')
    const { headers, lines } = parse(build({ headers: { References: ids } }).raw)
    expect(headers.get('references')).toBe(ids)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(78)
  })

  it('refuses one-click unsubscribe without an https List-Unsubscribe, or with another value', () => {
    expect(codeOf(() => build({ headers: { 'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK } }))).toBe('invalid-header')
    expect(
      codeOf(() =>
        build({
          headers: {
            'List-Unsubscribe': '<mailto:u@example.com>',
            'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_ONE_CLICK,
          },
        }),
      ),
    ).toBe('invalid-header')
    expect(
      codeOf(() =>
        build({
          headers: { 'List-Unsubscribe': '<https://app.example.com/u/abc>', 'List-Unsubscribe-Post': 'yes' },
        }),
      ),
    ).toBe('invalid-header')
  })
})

describe('buildRfc5322Message — refusals (AGL-2978)', () => {
  it('refuses a line break in the subject, a display name or a header value', () => {
    expect(codeOf(() => build({ subject: 'Hi\r\nBcc: victim@example.com' }))).toBe('invalid-subject')
    expect(codeOf(() => build({ from: { address: 'avery@rep.example.com', name: 'Avery\nBcc: x@example.com' } }))).toBe(
      'invalid-address',
    )
    expect(codeOf(() => build({ headers: { 'X-Note': 'ok\r\nBcc: victim@example.com' } }))).toBe('invalid-header')
  })

  it('refuses a structural header, whatever its case', () => {
    for (const name of ['Bcc', 'cc', 'FROM', 'Content-Type', 'content-transfer-encoding', 'Message-ID', 'Date']) {
      expect([name, codeOf(() => build({ headers: { [name]: 'value' } }))]).toEqual([name, 'reserved-header'])
    }
  })

  it('refuses a header Outreach does not send, a malformed name, a duplicate and a non-ASCII value', () => {
    expect(codeOf(() => build({ headers: { Precedence: 'bulk' } }))).toBe('unsupported-header')
    expect(codeOf(() => build({ headers: { 'Bad Name': 'x' } }))).toBe('invalid-header')
    expect(codeOf(() => build({ headers: { 'X-Tag': 'a', 'x-tag': 'b' } }))).toBe('invalid-header')
    expect(codeOf(() => build({ headers: { 'X-Tag': 'café' } }))).toBe('invalid-header')
  })

  it('refuses an address that is not a plain ASCII mailbox', () => {
    for (const address of ['not-an-address', 'a@b', 'spaced name@example.com', 'josé@example.com', 'a@example.com>']) {
      expect([address, codeOf(() => build({ to: address }))]).toEqual([address, 'invalid-address'])
    }
  })

  it('refuses a Message-ID part that would not be valid', () => {
    expect(
      codeOf(() => buildRfc5322Message(BASE, { date: DATE, messageIdLocalPart: 'has space' })),
    ).toBe('invalid-message-id')
    expect(
      codeOf(() => buildRfc5322Message(BASE, { date: DATE, messageIdDomain: 'not a domain' })),
    ).toBe('invalid-message-id')
  })
})
