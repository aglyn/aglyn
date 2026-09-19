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
 * A MESSAGE IN A THREAD, AS THE CLASSIFIER READS IT (AGL-2979).
 *
 * The runtime reads an enrollment's thread from the provider and hands each
 * message over in this shape: the headers, the text, and — for a delivery
 * report — the parts, because a bounce's recipient and status code live in
 * its `message/delivery-status` part and not in any header.
 *
 * {@link outreachThreadMessageFromGmail} builds it from a Gmail API message
 * resource fetched with `format=full`, so the base64url bodies, the nested
 * multiparts and the character sets are decoded in one place.
 *==========================================*/

/** One MIME part: its media type, and its body as text when it is textual. */
export interface OutreachThreadMessagePart {
  /** Lowercase media type without parameters: `text/plain`, `message/delivery-status`. */
  mimeType: string
  /** The decoded body, for a textual part whose body was delivered inline. */
  text?: string
}

export interface OutreachThreadMessage {
  /** The provider's message id. */
  id: string
  /** The provider's thread id. */
  threadId?: string
  /** When the provider received the message, epoch ms — Gmail's `internalDate`. */
  internalDateMs: number
  /** The raw `From` header value. */
  from: string
  /** The raw `To` header value. */
  to: string
  subject: string
  /** The top-level headers by name. Names are matched without regard to case. */
  headers: Record<string, string>
  /** The provider's plain-text preview. */
  snippet?: string
  labelIds?: string[]
  /** The first `text/plain` body that is not an attachment, decoded. */
  textBody?: string
  /** The first `text/html` body, decoded — read when there is no text body. */
  htmlBody?: string
  /** Every part, depth first. */
  parts?: OutreachThreadMessagePart[]
}

/** A header's value by name, matched without regard to case; `''` when absent. */
export function outreachHeader(
  message: Pick<OutreachThreadMessage, 'headers'>,
  name: string,
): string {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(message?.headers ?? {})) {
    if (key.toLowerCase() === wanted) return String(value ?? '')
  }
  return ''
}

/*==========================================
 * THE GMAIL API MESSAGE RESOURCE.
 *==========================================*/

export interface GmailApiHeader {
  name: string
  value: string
}

export interface GmailApiMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailApiHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailApiMessagePart[]
}

/** `users.messages.get` or a message of `users.threads.get`, with `format=full`. */
export interface GmailApiMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  /** Epoch milliseconds, as a string. */
  internalDate?: string | number
  payload?: GmailApiMessagePart
}

const TEXTUAL = /^(text\/|message\/(delivery-status|disposition-notification|global-delivery-status|global-headers|rfc822-headers)$)/

function headerOf(headers: readonly GmailApiHeader[] | undefined, name: string): string {
  const wanted = name.toLowerCase()
  return headers?.find((header) => header?.name?.toLowerCase() === wanted)?.value ?? ''
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return match ? match[1].toLowerCase() : 'utf-8'
}

/** A base64url body decoded to text in the part's own character set. */
function decodeBody(data: string, charset: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Gmail's snippet arrives HTML-escaped: `wasn&#39;t`. */
function unescapeSnippet(snippet: string): string {
  return snippet.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (/^#x/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/**
 * The classifier's shape for a Gmail API message. Never throws: a body that
 * does not decode is left out, and a message with no payload has no text.
 */
export function outreachThreadMessageFromGmail(message: GmailApiMessage): OutreachThreadMessage {
  const payload = message?.payload ?? {}
  const headers: Record<string, string> = {}
  for (const header of payload.headers ?? []) {
    if (header?.name && !(header.name in headers)) headers[header.name] = String(header.value ?? '')
  }
  const parts: OutreachThreadMessagePart[] = []
  let textBody: string | undefined
  let htmlBody: string | undefined
  const walk = (part: GmailApiMessagePart | undefined) => {
    if (!part) return
    const mimeType = String(part.mimeType ?? '').toLowerCase().split(';')[0].trim()
    const entry: OutreachThreadMessagePart = { mimeType }
    const data = part.body?.data
    if (data && TEXTUAL.test(mimeType)) {
      try {
        entry.text = decodeBody(data, charsetOf(headerOf(part.headers, 'Content-Type')))
      } catch {
        // A body that is not valid base64 is treated as absent.
      }
    }
    parts.push(entry)
    const attachment = Boolean(part.filename) || /^attachment/i.test(headerOf(part.headers, 'Content-Disposition'))
    if (entry.text !== undefined && !attachment) {
      if (mimeType === 'text/plain' && textBody === undefined) textBody = entry.text
      if (mimeType === 'text/html' && htmlBody === undefined) htmlBody = entry.text
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(message?.payload)
  const internalDateMs = Number(message?.internalDate)
  return {
    id: String(message?.id ?? ''),
    ...(message?.threadId ? { threadId: message.threadId } : {}),
    internalDateMs: Number.isFinite(internalDateMs) ? internalDateMs : 0,
    from: headerOf(payload.headers, 'From'),
    to: headerOf(payload.headers, 'To'),
    subject: headerOf(payload.headers, 'Subject'),
    headers,
    ...(message?.snippet ? { snippet: unescapeSnippet(message.snippet) } : {}),
    ...(message?.labelIds ? { labelIds: [...message.labelIds] } : {}),
    ...(textBody !== undefined ? { textBody } : {}),
    ...(htmlBody !== undefined ? { htmlBody } : {}),
    parts,
  }
}
