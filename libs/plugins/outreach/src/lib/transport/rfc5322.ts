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

import { LIST_UNSUBSCRIBE_ONE_CLICK } from '@aglyn/shared-util-email/list-unsubscribe'
import { randomUUID } from 'node:crypto'

/**
 * AN OUTREACH MESSAGE AS RFC 5322 TEXT (AGL-2978).
 *
 * Gmail's `messages.send` takes the whole message, headers and body, as one
 * base64url string. This module writes that string for the one kind of mail
 * Outreach sends: a plain-text message from one person to one person.
 *
 * ## What it writes, and what it never does
 *
 * - `From` and `To` with display names — quoted when ASCII, RFC 2047
 *   encoded-words when not.
 * - `Subject`, RFC 2047 when it is not plain ASCII, folded under 78 columns.
 * - `Date` in RFC 5322 form, UTC.
 * - `Message-ID` `<uuid@domain>`, the domain being the From address's unless
 *   the caller names one, so the id belongs to the domain the mail is from.
 * - `MIME-Version: 1.0` and `Content-Type: text/plain; charset=UTF-8`.
 * - The caller's `In-Reply-To`, `References`, `Reply-To`, `List-Unsubscribe`
 *   and `List-Unsubscribe-Post`, plus any `X-` header.
 * - CRLF line endings throughout. The body goes as `7bit` when it is ASCII
 *   with no line over 998 octets, and `quoted-printable` otherwise.
 *
 * No HTML part, no tracking pixel, no rewritten links, no open or click
 * beacon of any kind: the body the caller composed is the body that is sent.
 *
 * ## Refusals
 *
 * A header value containing a line break is a header INJECTION, whoever typed
 * it — a merge field holding a CRLF would append headers of its choosing — so
 * every value is checked and a violation throws {@link Rfc5322MessageError}
 * rather than being cleaned up. Structural headers (`From`, `To`, `Cc`,
 * `Bcc`, `Subject`, `Date`, `Message-ID`, the MIME fields, …) cannot be passed
 * in `headers`: this module writes them, exactly once.
 *
 * Addresses must be ASCII. An internationalized mailbox needs SMTPUTF8 end to
 * end, which a one-to-one prospecting message cannot count on, so one is
 * refused rather than sent in a form some hop would mangle.
 */

/** One mailbox, optionally with the name people see. */
export interface OutreachMailAddress {
  address: string
  name?: string | null
}

/** An address as a bare string, or with a display name. */
export type OutreachMailAddressInput = string | OutreachMailAddress

/**
 * A composed message, as the sequence engine hands it over: who it is from,
 * who it is to, the subject, the plain-text body, and any extra headers.
 */
export interface OutreachComposedMessage {
  from: OutreachMailAddressInput
  to: OutreachMailAddressInput
  subject: string
  text: string
  /**
   * `In-Reply-To`, `References`, `Reply-To`, `List-Unsubscribe`,
   * `List-Unsubscribe-Post`, or an `X-` header. A null, undefined or empty
   * value is omitted.
   */
  headers?: Readonly<Record<string, string | null | undefined>>
}

export interface BuildRfc5322Options {
  /** The `Date` header. Now when omitted. */
  date?: Date
  /** The Message-ID's left part. A random UUID when omitted. */
  messageIdLocalPart?: string
  /** The Message-ID's domain. The From address's domain when omitted. */
  messageIdDomain?: string
}

export interface BuiltRfc5322Message {
  /** The message, CRLF line endings, ready to base64url-encode. */
  raw: string
  /** The `Message-ID`, angle brackets included, to thread replies against. */
  messageId: string
  /** The subject as written, trimmed: what the recipient sees. */
  subject: string
}

export type Rfc5322MessageErrorCode =
  | 'invalid-address'
  | 'invalid-subject'
  | 'invalid-header'
  | 'reserved-header'
  | 'unsupported-header'
  | 'invalid-message-id'

export class Rfc5322MessageError extends Error {
  readonly code: Rfc5322MessageErrorCode

  constructor(code: Rfc5322MessageErrorCode, message: string) {
    super(message)
    this.name = 'Rfc5322MessageError'
    this.code = code
  }
}

const CRLF = '\r\n'

/** RFC 5322 recommends lines of at most 78 characters. */
const FOLD_AT = 78

/** RFC 5322's hard limit on a line, excluding the CRLF. */
const MAX_LINE = 998

/** A pragmatic ASCII addr-spec: no whitespace, specials or control characters. */
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

/** A header field name: printable ASCII, no colon (RFC 5322 §3.6.8). */
const FIELD_NAME = /^[!-9;-~]+$/

/**
 * Whether text holds a character below space other than tab, or DEL. Finding
 * one is the point: a CR or LF in a header value is a header injection.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if ((code < 32 && code !== 9) || code === 127) return true
  }
  return false
}

/** Whether text is printable ASCII and tabs only. */
function isPrintableAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code !== 9 && (code < 32 || code > 126)) return false
  }
  return true
}

/** A Message-ID's left part, kept to the characters a UUID and a caller need. */
const MESSAGE_ID_LOCAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Headers the builder writes itself. Passing one in `headers` is refused, so
 * no message can carry two `From` fields or smuggle a second `Content-Type`.
 */
const RESERVED_HEADERS = new Set([
  'from',
  'sender',
  'to',
  'cc',
  'bcc',
  'subject',
  'date',
  'message-id',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'content-disposition',
  'return-path',
  'received',
  'dkim-signature',
])

/** The extra headers a caller may set, spelled as they are written. */
const EXTRA_HEADERS: Record<string, string> = {
  'in-reply-to': 'In-Reply-To',
  references: 'References',
  'reply-to': 'Reply-To',
  'list-unsubscribe': 'List-Unsubscribe',
  'list-unsubscribe-post': 'List-Unsubscribe-Post',
}

/**
 * The one value RFC 8058 defines for `List-Unsubscribe-Post`, re-exported
 * from the module campaigns and sequences share (AGL-3307).
 */
export { LIST_UNSUBSCRIBE_ONE_CLICK }

const isAscii = (value: string) => isPrintableAscii(value)

/** The address, validated and in its written form. */
function normalizeAddress(input: OutreachMailAddressInput, field: string): OutreachMailAddress {
  const record = typeof input === 'string' ? { address: input } : input
  const address = String(record?.address ?? '').trim()
  if (!address || address.length > 254 || !ADDRESS.test(address)) {
    throw new Rfc5322MessageError('invalid-address', `The ${field} address is not a valid ASCII email address.`)
  }
  const name = typeof record?.name === 'string' ? record.name.trim() : ''
  if (hasControlCharacter(name)) {
    throw new Rfc5322MessageError('invalid-address', `The ${field} display name contains a control character.`)
  }
  return { address, name }
}

/**
 * RFC 2047 `B` encoded-words for a UTF-8 string, each at most 75 characters
 * and never splitting a character between two words.
 */
export function encodeRfc2047Words(value: string): string[] {
  // 42 bytes base64-encode to 56 characters; with `=?UTF-8?B?` and `?=` a
  // word is 68 — inside the 75 the RFC allows, and short enough that the
  // first word still fits on a `Subject: ` line within 78 columns.
  const maxBytes = 42
  const words: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (chunkBytes + bytes > maxBytes && chunk) {
      words.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += character
    chunkBytes += bytes
  }
  if (chunk) words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
}

/** A quoted-string, escaping the two characters RFC 5322 requires. */
const quoted = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`

/**
 * Whether ASCII text would read as an encoded-word to a mail client, which
 * decodes `=?…?=` wherever it appears in a header.
 */
const looksEncoded = (value: string) => /=\?[^?]*\?[bBqQ]\?[^?]*\?=/.test(value)

/**
 * `Name <address>` as tokens to fold, the name quoted or encoded as it needs.
 * The angle-address is its own token, so a long name folds before it.
 */
function formatAddress(address: OutreachMailAddress): string[] {
  if (!address.name) return [address.address]
  const name =
    isAscii(address.name) && !looksEncoded(address.name)
      ? [quoted(address.name)]
      : encodeRfc2047Words(address.name)
  return [...name, `<${address.address}>`]
}

/**
 * A value split at single spaces for folding, with every run of spaces kept:
 * an empty token is merged into the next one, so joining the tokens with one
 * space gives the value back exactly and no fold ever leaves a line of only
 * whitespace.
 */
function spaceTokens(value: string): string[] {
  const tokens: string[] = []
  let pending = ''
  for (const part of value.split(' ')) {
    if (!part) {
      pending += ' '
      continue
    }
    tokens.push(`${pending}${part}`)
    pending = ''
  }
  return tokens
}

/**
 * One header written as folded lines: `tokens` are joined by a space, and a
 * token that would push its line past 78 columns starts the next line.
 */
function foldHeader(name: string, tokens: readonly string[]): string {
  const lines: string[] = []
  let line = `${name}:`
  for (const token of tokens) {
    if (line.length + 1 + token.length > FOLD_AT && line !== `${name}:`) {
      lines.push(line)
      line = ` ${token}`
    } else {
      line += ` ${token}`
    }
  }
  lines.push(line)
  for (const written of lines) {
    if (written.length > MAX_LINE) {
      throw new Rfc5322MessageError('invalid-header', `The ${name} header has a line longer than ${MAX_LINE} characters.`)
    }
  }
  return lines.join(CRLF)
}

/** The subject, as words to fold: plain ASCII split on spaces, or encoded-words. */
function subjectTokens(subject: string): string[] {
  if (typeof subject !== 'string') {
    throw new Rfc5322MessageError('invalid-subject', 'The subject must be text.')
  }
  if (hasControlCharacter(subject)) {
    throw new Rfc5322MessageError('invalid-subject', 'The subject contains a line break or control character.')
  }
  const trimmed = subject.trim()
  if (!trimmed) return []
  if (isAscii(trimmed) && !looksEncoded(trimmed)) {
    const words = spaceTokens(trimmed)
    if (words.every((word) => `Subject: ${word}`.length <= MAX_LINE)) return words
  }
  return encodeRfc2047Words(trimmed)
}

/** RFC 5322 §3.3 date-time, in UTC. */
export function formatRfc5322Date(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

/** The extra headers, validated, named as written, in the order given. */
function extraHeaders(headers: OutreachComposedMessage['headers']): Array<[string, string]> {
  const written: Array<[string, string]> = []
  const seen = new Set<string>()
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    if (rawValue === null || rawValue === undefined || rawValue === '') continue
    const name = String(rawName).trim()
    const lower = name.toLowerCase()
    if (!FIELD_NAME.test(name)) {
      throw new Rfc5322MessageError('invalid-header', 'A header name is not a valid field name.')
    }
    if (RESERVED_HEADERS.has(lower)) {
      throw new Rfc5322MessageError('reserved-header', `The ${name} header is written by the message builder and cannot be set.`)
    }
    const canonical = EXTRA_HEADERS[lower] ?? (lower.startsWith('x-') ? name : null)
    if (!canonical) {
      throw new Rfc5322MessageError('unsupported-header', `The ${name} header is not one a sequence sends.`)
    }
    if (seen.has(lower)) {
      throw new Rfc5322MessageError('invalid-header', `The ${name} header is given twice.`)
    }
    const value = String(rawValue).trim()
    if (hasControlCharacter(value) || !isAscii(value)) {
      throw new Rfc5322MessageError('invalid-header', `The ${name} header value must be printable ASCII on one line.`)
    }
    seen.add(lower)
    written.push([canonical, value])
  }
  const post = written.find(([name]) => name === 'List-Unsubscribe-Post')
  if (post) {
    const unsubscribe = written.find(([name]) => name === 'List-Unsubscribe')
    if (post[1] !== LIST_UNSUBSCRIBE_ONE_CLICK || !unsubscribe || !/<https:\/\/[^>]+>/.test(unsubscribe[1])) {
      throw new Rfc5322MessageError(
        'invalid-header',
        `List-Unsubscribe-Post must be "${LIST_UNSUBSCRIBE_ONE_CLICK}" beside a List-Unsubscribe with an https address (RFC 8058).`,
      )
    }
  }
  return written
}

/** Line breaks of any kind, as CRLF, ending with one. */
function canonicalBody(text: string): string {
  const normalized = String(text ?? '').replace(/\r\n|\r|\n/g, CRLF)
  return normalized.endsWith(CRLF) ? normalized : `${normalized}${CRLF}`
}

/**
 * RFC 2045 §6.7 quoted-printable for CRLF-separated text: `=`, non-ASCII
 * bytes and control characters as `=XX`, whitespace at a line's end encoded,
 * and soft breaks keeping every encoded line to 76 characters.
 */
export function encodeQuotedPrintable(text: string): string {
  const hex = (byte: number) => `=${byte.toString(16).toUpperCase().padStart(2, '0')}`
  return text
    .split(CRLF)
    .map((line) => {
      const bytes = Buffer.from(line, 'utf8')
      let encoded = ''
      let current = ''
      bytes.forEach((byte, index) => {
        const last = index === bytes.length - 1
        const literal =
          (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last)
        const token = literal ? String.fromCharCode(byte) : hex(byte)
        if (current.length + token.length > 75) {
          encoded += `${current}=${CRLF}`
          current = ''
        }
        current += token
      })
      return encoded + current
    })
    .join(CRLF)
}

/** Whether the body can travel as 7bit: ASCII, and no line over 998 octets. */
function isSevenBitSafe(body: string): boolean {
  return body.split(CRLF).every((line) => isAscii(line) && line.length <= MAX_LINE)
}

/** Builds the message. Throws {@link Rfc5322MessageError} on anything unsafe. */
export function buildRfc5322Message(
  message: OutreachComposedMessage,
  options: BuildRfc5322Options = {},
): BuiltRfc5322Message {
  const from = normalizeAddress(message.from, 'From')
  const to = normalizeAddress(message.to, 'To')
  const subject = subjectTokens(message.subject)
  const extras = extraHeaders(message.headers)

  const domain = (options.messageIdDomain ?? from.address.slice(from.address.lastIndexOf('@') + 1)).trim()
  const local = options.messageIdLocalPart ?? randomUUID()
  if (!MESSAGE_ID_LOCAL.test(local) || !ADDRESS.test(`id@${domain}`)) {
    throw new Rfc5322MessageError('invalid-message-id', 'The Message-ID would not be valid.')
  }
  const messageId = `<${local}@${domain}>`

  const body = canonicalBody(message.text)
  const sevenBit = isSevenBitSafe(body)

  const lines = [
    foldHeader('From', formatAddress(from)),
    foldHeader('To', formatAddress(to)),
    ...(subject.length ? [foldHeader('Subject', subject)] : ['Subject:']),
    `Date: ${formatRfc5322Date(options.date ?? new Date())}`,
    `Message-ID: ${messageId}`,
    ...extras.map(([name, value]) => foldHeader(name, spaceTokens(value))),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    `Content-Transfer-Encoding: ${sevenBit ? '7bit' : 'quoted-printable'}`,
  ]
  const encodedBody = sevenBit ? body : encodeQuotedPrintable(body)
  return {
    raw: `${lines.join(CRLF)}${CRLF}${CRLF}${encodedBody}`,
    messageId,
    subject: message.subject.trim(),
  }
}

/** The `raw` field Gmail's `messages.send` takes: the message, base64url. */
export function encodeGmailRawMessage(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url')
}
