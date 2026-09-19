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

import type { GmailApiMessage, GmailApiMessagePart } from '../../engine/thread-message'
import type { GmailClient, GmailMessageMetadata } from '../../transport/gmail-client'

/**
 * A MAILBOX IN MEMORY, for the runtime's specs (AGL-2981).
 *
 * Implements the whole `GmailClient` the runtime reaches a mailbox through,
 * over messages held here: a send is parsed back out of the raw RFC 5322 it
 * was handed and filed in its thread, and mail "arrives" through
 * {@link FakeGmail.deliver}. The searches the runtime makes are answered with
 * the Gmail operators it uses — `after:`, `-from:me`, `from:`, `to:`,
 * `rfc822msgid:` — so a spec exercises the real queries. Nothing reaches
 * Google and nothing is sent anywhere.
 */

interface Stored {
  message: GmailApiMessage
  from: string
  to: string
  internalDateMs: number
  sent: boolean
  labelIds: string[]
}

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

/** A plain header block and body out of a raw RFC 5322 message. */
function parseRaw(raw: string): { headers: Array<{ name: string; value: string }>; body: string } {
  const text = Buffer.from(raw, 'base64url').toString('utf8')
  const split = text.indexOf('\r\n\r\n')
  const head = split >= 0 ? text.slice(0, split) : text
  const body = split >= 0 ? text.slice(split + 4) : ''
  const headers: Array<{ name: string; value: string }> = []
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += ` ${line.trim()}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon > 0) headers.push({ name: line.slice(0, colon), value: line.slice(colon + 1).trim() })
  }
  return { headers, body }
}

const headerValue = (headers: Array<{ name: string; value: string }>, name: string) =>
  headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? ''

const addressOf = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()

/** One `from:`/`to:` value, or a parenthesized `a OR b` list of them. */
function termValues(value: string): string[] {
  const inner = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1) : value
  return inner
    .split(/\s+OR\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

/** The query's terms, a parenthesized value kept whole. */
function terms(q: string): string[] {
  const found: string[] = []
  let current = ''
  let depth = 0
  for (const character of q) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ' ' && depth === 0) {
      if (current) found.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current) found.push(current)
  return found
}

export interface FakeGmailOptions {
  /** The mailbox's own addresses: what `from:me` means. */
  self: readonly string[]
  /** Makes the next `sendMessage` throw this. */
  failNextSend?: Error | null
}

export class FakeGmail implements GmailClient {
  readonly messages = new Map<string, Stored>()
  readonly sent: Array<{ raw: string; threadId: string | null; headers: Array<{ name: string; value: string }>; body: string }> = []
  readonly calls: string[] = []
  failNextSend: Error | null
  private readonly self: Set<string>
  private sequence = 0

  constructor(options: FakeGmailOptions) {
    this.self = new Set(options.self.map((address) => address.toLowerCase()))
    this.failNextSend = options.failNextSend ?? null
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}${this.sequence.toString(16).padStart(6, '0')}`
  }

  /** Files an inbound message, as the mailbox would receive it. */
  deliver(input: {
    threadId?: string
    from: string
    to: string
    subject: string
    text?: string
    atMs: number
    messageId?: string
    headers?: Record<string, string>
    /** A multipart/report's parts, for a delivery status notification. */
    parts?: GmailApiMessagePart[]
    contentType?: string
  }): GmailApiMessage {
    const id = this.nextId('in')
    const threadId = input.threadId ?? this.nextId('th')
    const headers = [
      { name: 'From', value: input.from },
      { name: 'To', value: input.to },
      { name: 'Subject', value: input.subject },
      { name: 'Message-ID', value: input.messageId ?? `<${id}@mail.example.net>` },
      ...(input.contentType ? [{ name: 'Content-Type', value: input.contentType }] : []),
      ...Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
    ]
    const payload: GmailApiMessagePart = input.parts
      ? { mimeType: 'multipart/report', headers, parts: input.parts }
      : { mimeType: 'text/plain', headers, body: { data: encode(input.text ?? '') } }
    const message: GmailApiMessage = {
      id,
      threadId,
      labelIds: ['INBOX'],
      snippet: (input.text ?? '').slice(0, 100),
      internalDate: String(input.atMs),
      payload,
    }
    this.messages.set(id, {
      message,
      from: addressOf(input.from),
      to: addressOf(input.to),
      internalDateMs: input.atMs,
      sent: false,
      labelIds: ['INBOX'],
    })
    return message
  }

  /** Every message the runtime sent, parsed. */
  sentHeaders(index: number): Record<string, string> {
    return Object.fromEntries((this.sent[index]?.headers ?? []).map((header) => [header.name, header.value]))
  }

  private matches(stored: Stored, q: string): boolean {
    for (const term of terms(q)) {
      const negated = term.startsWith('-')
      const [operator, ...rest] = (negated ? term.slice(1) : term).split(':')
      const value = rest.join(':')
      let hit: boolean
      if (operator === 'after') hit = stored.internalDateMs > Number(value) * 1000
      else if (operator === 'from') {
        hit =
          value === 'me'
            ? this.self.has(stored.from)
            : termValues(value).some((wanted) => stored.from.includes(wanted))
      } else if (operator === 'to') hit = termValues(value).some((wanted) => stored.to.includes(wanted))
      else if (operator === 'rfc822msgid') {
        const header = headerValue(stored.message.payload?.headers ?? [], 'Message-ID')
        hit = header.replace(/^<|>$/g, '') === value
      } else hit = true
      if (negated ? hit : !hit) return false
    }
    return true
  }

  async getAccessToken() {
    return 'fake-access-token'
  }

  async getProfile() {
    return { emailAddress: [...this.self][0] ?? '', messagesTotal: this.messages.size, threadsTotal: 0, historyId: '1' }
  }

  async listSendAs() {
    return []
  }

  async sendMessage(input: { raw: string; threadId?: string | null }) {
    this.calls.push('send')
    if (this.failNextSend) {
      const failure = this.failNextSend
      this.failNextSend = null
      throw failure
    }
    const { headers, body } = parseRaw(input.raw)
    const id = this.nextId('out')
    const threadId = input.threadId || this.nextId('th')
    this.sent.push({ raw: input.raw, threadId: input.threadId ?? null, headers, body })
    const at = Date.now()
    this.messages.set(id, {
      message: {
        id,
        threadId,
        labelIds: ['SENT'],
        internalDate: String(at),
        payload: { mimeType: 'text/plain', headers, body: { data: encode(body) } },
      },
      from: addressOf(headerValue(headers, 'From')),
      to: addressOf(headerValue(headers, 'To')),
      internalDateMs: at,
      sent: true,
      labelIds: ['SENT'],
    })
    return { id, threadId, labelIds: ['SENT'] }
  }

  async getThread(threadId: string) {
    const full = await this.getFullThread(threadId)
    return { id: threadId, historyId: null, messages: full.messages.map((message) => this.metadataOf(message)) }
  }

  async getFullThread(threadId: string) {
    this.calls.push(`thread:${threadId}`)
    const messages = [...this.messages.values()]
      .filter((stored) => stored.message.threadId === threadId)
      .sort((a, b) => a.internalDateMs - b.internalDateMs)
      .map((stored) => stored.message)
    return { id: threadId, historyId: null, messages }
  }

  private metadataOf(message: GmailApiMessage): GmailMessageMetadata {
    return {
      id: message.id,
      threadId: message.threadId ?? '',
      labelIds: message.labelIds ?? [],
      snippet: message.snippet ?? '',
      internalDateMs: Number(message.internalDate) || null,
      headers: (message.payload?.headers ?? []).map((header) => ({ name: header.name, value: header.value })),
    }
  }

  async getMessage(messageId: string) {
    const stored = this.messages.get(messageId)
    if (!stored) throw new Error(`no message ${messageId}`)
    return this.metadataOf(stored.message)
  }

  async getFullMessage(messageId: string) {
    this.calls.push(`message:${messageId}`)
    const stored = this.messages.get(messageId)
    if (!stored) throw new Error(`no message ${messageId}`)
    return stored.message
  }

  async listMessages(options: { q: string; maxResults?: number; pageToken?: string | null }) {
    this.calls.push(`list:${options.q}`)
    const found = [...this.messages.values()]
      .filter((stored) => this.matches(stored, options.q))
      .sort((a, b) => b.internalDateMs - a.internalDateMs)
      .slice(0, options.maxResults ?? 100)
      .map((stored) => ({ id: stored.message.id, threadId: stored.message.threadId ?? '' }))
    return { messages: found, nextPageToken: null, resultSizeEstimate: found.length }
  }

  async revoke(): Promise<'revoked'> {
    return 'revoked'
  }
}
