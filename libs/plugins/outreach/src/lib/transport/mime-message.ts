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

import type { GmailApiHeader, GmailApiMessage, GmailApiMessagePart } from '../engine/thread-message'

/**
 * A RAW MIME MESSAGE AS THE GMAIL API'S `format=full` RESOURCE (AGL-3489).
 *
 * The engine's classifier reads a message in Gmail's wire shape
 * (`outreachThreadMessageFromGmail`): headers as a list, every multipart
 * nested under `parts`, and each leaf's body decoded from its transfer
 * encoding and carried as base64url. A provider that hands over the message
 * itself — Microsoft Graph's `/messages/{id}/$value` — is read into that
 * shape here, so a reply, an automatic answer and a delivery report are
 * classified by the same code whoever delivered them.
 *
 * The message is read as bytes (`latin1` keeps one character per byte), so
 * a base64 or 8-bit body is decoded from what was sent rather than from a
 * re-encoding of it. Header values are unfolded and their RFC 2047 encoded
 * words decoded, as Gmail decodes them. Never throws: a part that cannot be
 * read is kept with no body, which the classifier treats as absent.
 */

/** Deepest multipart nesting read; a delivery report is three deep. */
const MAX_DEPTH = 8

const decoderFor = (charset: string): TextDecoder => {
  try {
    return new TextDecoder(charset || 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

/** RFC 2047 encoded words in a header value, decoded. */
export function decodeMimeHeaderValue(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?[^?]+\?[bq]\?[^?]*\?=)/gi, '$1')
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (whole, charset: string, kind: string, text: string) => {
      try {
        const bytes =
          kind.toLowerCase() === 'b'
            ? Buffer.from(text, 'base64')
            : quotedPrintableBytes(text.replace(/_/g, ' '), false)
        return decoderFor(charset.split('*')[0].toLowerCase()).decode(bytes)
      } catch {
        return whole
      }
    })
}

/** A quoted-printable body's bytes; soft line breaks joined when `body`. */
function quotedPrintableBytes(text: string, body = true): Buffer {
  const joined = body ? text.replace(/=\r?\n/g, '') : text
  const bytes: number[] = []
  for (let index = 0; index < joined.length; index += 1) {
    const hex = joined.slice(index + 1, index + 3)
    if (joined[index] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16))
      index += 2
    } else {
      bytes.push(joined.charCodeAt(index) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

/** A header block (bytes as `latin1`) as Gmail lists it: unfolded, decoded. */
function readHeaders(block: string): GmailApiHeader[] {
  const text = Buffer.from(block, 'latin1').toString('utf8')
  const headers: GmailApiHeader[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1].value += ` ${line.trim()}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon > 0) headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
  }
  for (const header of headers) header.value = decodeMimeHeaderValue(header.value)
  return headers
}

const headerOf = (headers: readonly GmailApiHeader[], name: string): string =>
  headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? ''

/** A media type parameter, quoted or not. */
const parameterOf = (value: string, name: string): string =>
  new RegExp(`(?:^|;)\\s*${name}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(value)?.slice(1).find(Boolean) ?? ''

/** Splits a part's bytes into its header block and body at the first blank line. */
function splitHead(raw: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw)
  if (!match) return { head: raw, body: '' }
  return { head: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) }
}

function readPart(raw: string, partId: string, depth: number): GmailApiMessagePart {
  const { head, body } = splitHead(raw)
  const headers = readHeaders(head)
  const contentType = headerOf(headers, 'Content-Type') || 'text/plain'
  const mimeType = contentType.split(';')[0].trim().toLowerCase()
  const filename = parameterOf(headerOf(headers, 'Content-Disposition'), 'filename') || parameterOf(contentType, 'name')
  if (mimeType.startsWith('multipart/') && depth < MAX_DEPTH) {
    const boundary = parameterOf(contentType, 'boundary')
    const parts: GmailApiMessagePart[] = []
    if (boundary) {
      const delimiter = new RegExp(`(?:^|\\r?\\n)--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(--)?[ \\t]*(?:\\r?\\n|$)`, 'g')
      const marks: Array<{ start: number; end: number; closing: boolean }> = []
      for (let match = delimiter.exec(body); match; match = delimiter.exec(body)) {
        marks.push({ start: match.index, end: match.index + match[0].length, closing: Boolean(match[1]) })
        if (match[1]) break
      }
      for (let index = 0; index < marks.length - 1; index += 1) {
        if (marks[index].closing) break
        const section = body.slice(marks[index].end, marks[index + 1].start)
        parts.push(readPart(section, partId ? `${partId}.${parts.length}` : String(parts.length), depth + 1))
      }
    }
    return { partId, mimeType, filename, headers, body: { size: 0 }, parts }
  }
  if (mimeType === 'message/rfc822' && depth < MAX_DEPTH) {
    // The original message a report carries: its own tree, under this part.
    const inner = readPart(body, partId ? `${partId}.0` : '0', depth + 1)
    return { partId, mimeType, filename, headers, body: { size: 0 }, parts: [inner] }
  }
  const encoding = headerOf(headers, 'Content-Transfer-Encoding').toLowerCase().trim()
  let bytes: Buffer
  try {
    bytes =
      encoding === 'base64'
        ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
        : encoding === 'quoted-printable'
          ? quotedPrintableBytes(body)
          : Buffer.from(body, 'latin1')
  } catch {
    return { partId, mimeType, filename, headers, body: { size: 0 } }
  }
  return { partId, mimeType, filename, headers, body: { size: bytes.length, data: bytes.toString('base64url') } }
}

const escapeSnippet = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function firstPlainText(part: GmailApiMessagePart): string | null {
  if (part.mimeType === 'text/plain' && part.body?.data && !part.filename) {
    const charset = parameterOf(headerOf(part.headers ?? [], 'Content-Type'), 'charset').toLowerCase()
    return decoderFor(charset).decode(Buffer.from(part.body.data, 'base64url'))
  }
  for (const child of part.parts ?? []) {
    const found = firstPlainText(child)
    if (found !== null) return found
  }
  return null
}

/**
 * A raw RFC 5322 message — bytes, or a string of them — as a Gmail API
 * message resource. The provider's ids, its received time and any labels
 * are the caller's to supply: they are not in the message.
 */
export function gmailApiMessageFromMime(
  raw: Uint8Array | string,
  meta: { id: string; threadId?: string; internalDateMs?: number | null; labelIds?: string[] },
): GmailApiMessage {
  const binary = typeof raw === 'string' ? raw : Buffer.from(raw).toString('latin1')
  let payload: GmailApiMessagePart
  try {
    payload = readPart(binary, '', 0)
  } catch {
    payload = { partId: '', mimeType: 'text/plain', headers: [], body: { size: 0 } }
  }
  const text = firstPlainText(payload) ?? ''
  return {
    id: meta.id,
    ...(meta.threadId ? { threadId: meta.threadId } : {}),
    ...(meta.labelIds ? { labelIds: [...meta.labelIds] } : {}),
    snippet: escapeSnippet(text.replace(/\s+/g, ' ').trim().slice(0, 200)),
    ...(typeof meta.internalDateMs === 'number' && Number.isFinite(meta.internalDateMs)
      ? { internalDate: String(meta.internalDateMs) }
      : {}),
    payload,
  }
}
