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

import { normalizeContactEmail } from './contacts'

/**
 * READING A RECEIVED EMAIL (AGL-2657): the address in a header value, the
 * thread a subject belongs to, the words of an HTML part, the message a
 * forward carries and the reply above the quoted history.
 *
 * Pure, and the platform's: every surface that receives mail — a capture
 * address filing a message on a record, a sequence reading a prospect's
 * reply — reads a message the same way, so two of them can never disagree
 * about who wrote it or what they said.
 */

/** The most a subject keeps, which is also what a one-to-one email may send. */
export const EMAIL_SUBJECT_MAX = 200

/** The most an excerpt keeps: a letter, not a thread. */
export const EMAIL_EXCERPT_MAX = 4_000

/**
 * The bare address in a header value — `Ada <ada@example.com>` and
 * `ada@example.com` both answer `ada@example.com` — normalized as every
 * contact address is, or `null` for anything that is not one.
 */
export function emailAddressOf(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const angled = /<([^<>]+)>\s*$/.exec(raw)
  return normalizeContactEmail(angled ? angled[1] : raw)
}

/** The part after the `@`, or `null` — what an unmatched message is logged by. */
export function emailDomainOf(value: unknown): string | null {
  const address = emailAddressOf(value)
  if (!address) return null
  const at = address.lastIndexOf('@')
  return at > 0 ? address.slice(at + 1) : null
}

/**
 * The subject with its reply and forward prefixes removed, however many
 * were stacked — `Re: Fwd: RE: Renewal` is the `Renewal` thread — and
 * whitespace collapsed, so two rows of one conversation carry one value.
 */
export function threadSubject(subject: unknown): string {
  let value = String(subject ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const prefix = /^(re|fwd?|aw|wg|tr|sv|vs)\s*(\[\d+\])?\s*:\s*/i
  while (prefix.test(value)) value = value.replace(prefix, '')
  return value.slice(0, EMAIL_SUBJECT_MAX)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * The words in an HTML part, for a message that carried no text part.
 * Block boundaries become line breaks, tags go, the common entities are
 * read back — a best effort over a bounded slice, never a renderer.
 */
export function htmlToPlainText(html: unknown): string {
  return String(html ?? '')
    .slice(0, 200_000)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(parseInt(code.slice(2), 16))
      }
      if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
      return ENTITIES[code.toLowerCase()] ?? whole
    })
}

/** What a forwarded message's header block says, and the words after it. */
export interface ForwardedSection {
  /** The address on the block's `From:` line, or `null` when it carried none. */
  from: string | null
  /** The forwarded message's own text, header block removed. */
  body: string
}

const FORWARD_MARKER = /^\s*(-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:)\s*$/i
const HEADER_LINE = /^\s*\*?(From|Sent|Date|To|Cc|Subject|Reply-To)\s*:\*?\s*(.*)$/i

/**
 * The forwarded message inside a forward — the block a mail client puts
 * under "Forwarded message" or, with no marker, a run of `From:` … `Subject:`
 * header lines — or `null` when the text carries none. The `From:` line is
 * where the correspondent of a forwarded reply is named, since the forward's
 * own headers name only the teammate who forwarded it.
 */
export function forwardedSection(text: string): ForwardedSection | null {
  const lines = text.split('\n')
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (FORWARD_MARKER.test(lines[index])) {
      start = index + 1
      break
    }
    if (/^\s*\*?From\s*:/i.test(lines[index]) && !lines[index].trimStart().startsWith('>')) {
      const window = lines.slice(index, index + 8)
      if (window.some((line) => /^\s*\*?Subject\s*:/i.test(line))) {
        start = index
        break
      }
    }
  }
  if (start < 0) return null
  let from: string | null = null
  let cursor = start
  // The header block: header lines, blank lines between them allowed, up to
  // the first line that is neither.
  let sawHeader = false
  while (cursor < lines.length) {
    const line = lines[cursor]
    const header = HEADER_LINE.exec(line)
    if (header) {
      sawHeader = true
      if (header[1].toLowerCase() === 'from') from = from ?? emailAddressOf(header[2])
      cursor += 1
      continue
    }
    if (!line.trim() && !sawHeader) {
      cursor += 1
      continue
    }
    if (!line.trim() && sawHeader) {
      // A blank line after a header run may precede more headers (Apple
      // Mail) or the body; look past it.
      const next = lines[cursor + 1] ?? ''
      if (HEADER_LINE.test(next)) {
        cursor += 1
        continue
      }
      cursor += 1
      break
    }
    break
  }
  return { from, body: lines.slice(cursor).join('\n') }
}

const QUOTE_INTRO = /^\s*On\b.{0,300}$/
const QUOTE_END = /wrote:\s*$/i
const HISTORY_MARKERS = [
  /^\s*>/,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*From:\s.+$/,
  /^\s*Sent from my\b/i,
  /^\s*Le .{0,200} a écrit\s*:\s*$/i,
  /^\s*Am .{0,200} schrieb .{0,100}:\s*$/i,
]

/**
 * The words above the quoted history: everything before the first `On …
 * wrote:` line, quote mark, "Original Message" rule or reply header block.
 * The intro may wrap onto a second line, so a line that begins `On` is
 * read together with the one after it.
 */
export function stripQuotedHistory(text: string): string {
  const lines = text.split('\n')
  let end = lines.length
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (HISTORY_MARKERS.some((marker) => marker.test(line))) {
      end = index
      break
    }
    if (QUOTE_INTRO.test(line)) {
      const joined = `${line} ${lines[index + 1] ?? ''}`
      if (QUOTE_END.test(line) || QUOTE_END.test(joined)) {
        end = index
        break
      }
    }
  }
  return lines.slice(0, end).join('\n')
}

/**
 * What is worth keeping of a received message: the text part — or the
 * words of the HTML part when there is none — with a forward's header
 * block and the quoted history below the reply removed, whitespace
 * settled, bounded. Never the whole thread: the thread is in the mailbox,
 * and a record of the message is a note that this exchange happened.
 */
export function emailExcerpt(text: unknown, html?: unknown): string {
  let body = String(text ?? '')
  if (!body.trim() && html) body = htmlToPlainText(html)
  body = body.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  const forwarded = forwardedSection(body)
  if (forwarded) body = forwarded.body
  body = stripQuotedHistory(body)
  return body
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, EMAIL_EXCERPT_MAX)
}
