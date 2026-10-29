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

/*==========================================
 * ONE CONVERSATION IN THE CUSTOMER'S MAILBOX (AGL-4097).
 *
 * A site that writes to one customer about one thing more than once (a
 * request's confirmation, the quote, a revised quote, the invoice) keeps those
 * messages in a single conversation by sending each one as a reply to the one
 * before:
 *
 *   - the first message carries a `Message-ID` minted here, and the record it
 *     is about keeps it as an {@link EmailThread};
 *   - every later message carries its own `Message-ID`, `In-Reply-To` naming
 *     the last one, and `References` naming the chain, and keeps the thread's
 *     subject ({@link nextThreadHeaders}, {@link emailThreadAfterSend}).
 *
 * How clients group (what is documented or widely reported, not measured
 * here): Apple Mail and Thunderbird thread by `In-Reply-To`/`References`;
 * Gmail groups by subject together with those headers; Outlook groups by
 * subject (its conversation topic) and its own `Thread-Index`, which only
 * Outlook writes. Keeping the subject the same is what every one of them
 * honors, which is why the thread remembers it.
 *
 * Whether a provider keeps a caller's `Message-ID` is the provider's call:
 * both built-in providers hand the header over unchanged, and the sender
 * records the provider's own id beside it so a replaced one can be traced.
 *
 * Pure, and free of Node built-ins: this barrel is reached from the browser.
 *=========================================*/

/** A conversation as the record it is about keeps it. */
export interface EmailThread {
  /** The latest message's `Message-ID`, angle brackets included: `<a.b@example.com>`. */
  messageId: string
  /** Every `Message-ID` in the conversation, oldest first; the last is {@link messageId}. */
  references: string[]
  /** The subject the conversation runs under, without any `Re:`. */
  subject: string
}

/**
 * The most ids a `References` header carries. RFC 5322 sets no limit, but
 * some servers refuse very long header lines; the first id (the conversation's
 * root) and the latest ones are what threading reads, so the middle goes.
 */
export const EMAIL_THREAD_MAX_REFERENCES = 20

/** The longest subject kept on a thread. */
const MAX_SUBJECT = 300

/** `dot-atom-text` on each side of the `@`, as RFC 5322 §3.6.4 allows a `msg-id`. */
const MESSAGE_ID = /^<[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+>$/

/** A host name a `Message-ID` may end in. */
const DOMAIN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** Whether `value` is one well-formed `Message-ID`, brackets included. */
export function isEmailMessageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 250 && MESSAGE_ID.test(value)
}

/** A domain as a `Message-ID` can carry it, or null. */
function messageIdDomain(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase()
  // A `From` value ("Acme <hello@acme.com>") gives its address's domain.
  const domain = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1).replace(/>.*$/, '') : raw
  return DOMAIN.test(domain) ? domain : null
}

/** Sixteen random hex characters, from the platform's crypto. */
function randomHex(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * A fresh `Message-ID` on the first usable domain of `domains` (the sending
 * domain first; an address such as a `From` value gives its domain):
 * `<label.k3x9m1.9f2c4e1a0b7d3e65@mail.acme.com>`. The time and 64 random bits
 * keep it unique; nothing in it identifies the customer or the record.
 * Falls back to `localhost.localdomain` only when no domain is usable, which
 * a send on a resolved identity never meets.
 */
export function mintEmailMessageId(
  domains: ReadonlyArray<string | null | undefined>,
  options: { label?: string; atMs?: number; random?: string } = {},
): string {
  const domain = domains.map(messageIdDomain).find(Boolean) ?? 'localhost.localdomain'
  const label = String(options.label ?? 'm').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'm'
  const time = Math.max(0, Math.floor(Number(options.atMs ?? Date.now()) || 0)).toString(36)
  const random = String(options.random ?? randomHex()).toLowerCase().replace(/[^a-z0-9]+/g, '') || randomHex()
  return `<${label}.${time}.${random}@${domain}>`
}

/** The root and the latest ids, at most {@link EMAIL_THREAD_MAX_REFERENCES}. */
function capReferences(ids: readonly string[]): string[] {
  const unique = ids.filter((id, index) => ids.indexOf(id) === index)
  if (unique.length <= EMAIL_THREAD_MAX_REFERENCES) return unique
  return [unique[0], ...unique.slice(unique.length - (EMAIL_THREAD_MAX_REFERENCES - 1))]
}

/**
 * A stored thread, checked, or null. Every id must be a well-formed
 * `Message-ID`, because each is written back into a header: a value that
 * could carry a line break never reaches one.
 */
export function readEmailThread(raw: unknown): EmailThread | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const messageId = source['messageId']
  if (!isEmailMessageId(messageId)) return null
  const listed = Array.isArray(source['references']) ? (source['references'] as unknown[]).filter(isEmailMessageId) : []
  const references = capReferences([...listed.filter((id) => id !== messageId), messageId])
  const subject = String(source['subject'] ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT)
  return { messageId, references, subject }
}

/** The subject a message in `thread` goes under: the thread's, else `fallback`. */
export function emailThreadSubject(thread: EmailThread | null | undefined, fallback: string): string {
  const own = readEmailThread(thread)?.subject
  return own || String(fallback ?? '').replace(/[\r\n]+/g, ' ').trim()
}

/**
 * The headers that send a message with `Message-ID` `messageId` into
 * `thread`: the id itself, and, when the thread has begun, `In-Reply-To` the
 * latest message and `References` the chain. With no thread, the message
 * starts one and carries only its own id.
 */
export function nextThreadHeaders(
  thread: EmailThread | null | undefined,
  messageId: string,
): Record<string, string> {
  if (!isEmailMessageId(messageId)) throw new Error('nextThreadHeaders: not a Message-ID')
  const current = readEmailThread(thread)
  if (!current) return { 'Message-ID': messageId }
  return {
    'Message-ID': messageId,
    'In-Reply-To': current.messageId,
    References: capReferences(current.references).join(' '),
  }
}

/**
 * The thread once a message went out in it: the message is the latest, the
 * chain grows by it, and the subject stays the thread's (or becomes this
 * message's, when it started the thread).
 */
export function emailThreadAfterSend(
  thread: EmailThread | null | undefined,
  sent: { messageId: string; subject: string },
): EmailThread {
  if (!isEmailMessageId(sent.messageId)) throw new Error('emailThreadAfterSend: not a Message-ID')
  const current = readEmailThread(thread)
  return {
    messageId: sent.messageId,
    references: capReferences([...(current?.references ?? []), sent.messageId]),
    subject: emailThreadSubject(current, sent.subject).slice(0, MAX_SUBJECT),
  }
}
