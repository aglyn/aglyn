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
import {
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_SUBJECT_MAX,
  type CrmActivity,
  type CrmActivityLink,
  type CrmEmailDirection,
} from './crm'

/**
 * EMAIL CAPTURE (AGL-2657): the pure half.
 *
 * A workspace gets one address — `crm+<token>@<capture domain>` — and a
 * reply forwarded to it, or a message a teammate copies to it from their
 * own mailbox, is filed on the record of whoever the message was with.
 * This module is everything about that which needs no Firestore and no
 * provider: the shape of the address, the token in it, which of a
 * message's addresses is the correspondent, what of the body is worth
 * keeping, and the activity row the whole thing becomes. The webhook route
 * and the address route read it; the dialog and the settings card read the
 * address helpers; the specs read all of it.
 *
 * ## The token is the whole secret
 *
 * The address is public the moment a member pastes it into a mailbox rule,
 * and the domain is the platform's, so the token is the only thing that
 * says which workspace a message is for. Thirty-two characters from a
 * lowercase alphabet — mail servers may fold the local part's case, and a
 * token that survived folding is one that never depended on case — drawn
 * from the platform's random source, which is the same entropy an API key
 * carries. Rotation replaces it; the old address then files nothing.
 *
 * ## Who the message was with
 *
 * A message names several addresses and exactly one of them is the person
 * the record is about. The rule: the first address among From, To and Cc
 * that is not the capture address and not a member of the workspace — the
 * workspace's own people are never the correspondent — in that order,
 * because a reply's From is the correspondent and a copied send's To is.
 * A message a teammate forwarded names the correspondent nowhere in its
 * headers, only in the forwarded block of the body, so that block's `From:`
 * is the last candidate. Which candidate matched decides the direction:
 * one the correspondent wrote is `inbound`, one the workspace wrote is
 * `outbound`.
 */

/** Where captured mail arrives when the deployment names no domain. */
export const CRM_INBOUND_DEFAULT_DOMAIN = 'in.aglyn.com'

/** The local part every capture address begins with: `crm+<token>@…`. */
export const CRM_INBOUND_LOCAL_PART = 'crm'

/** How many characters a minted token has. */
export const CRM_INBOUND_TOKEN_LENGTH = 32

/** The most a captured message's excerpt keeps: a letter, not a thread. */
export const CRM_INBOUND_EXCERPT_MAX = 4_000

/** What the org's feed says about a message that matched no record. */
export const CRM_INBOUND_UNMATCHED_ACTION = 'Inbound email matched no record'

/** What the org's feed says about a message the record's ceiling refused. */
export const CRM_INBOUND_CEILING_ACTION = 'Inbound email not filed: activity log full'

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const TOKEN_PATTERN = /^[a-z0-9]{24,64}$/
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * The domain captured mail is addressed at: `CRM_INBOUND_DOMAIN`, or the
 * platform's default when the deployment names none or names something
 * that is not a hostname. Lowercased, because a domain is.
 */
export function crmInboundDomain(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = String(env['CRM_INBOUND_DOMAIN'] ?? '')
    .trim()
    .toLowerCase()
  return DOMAIN_PATTERN.test(configured) ? configured : CRM_INBOUND_DEFAULT_DOMAIN
}

/**
 * A fresh token from the platform's random source. One byte per character
 * folded onto a 36-symbol alphabet: the fold is very slightly uneven and
 * the token is thirty-two symbols long, which is more than an API key
 * carries and far more than an address anyone guesses.
 */
export function mintCrmInboundToken(): string {
  const bytes = new Uint8Array(CRM_INBOUND_TOKEN_LENGTH)
  globalThis.crypto.getRandomValues(bytes)
  let token = ''
  for (const byte of bytes) token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]
  return token
}

export function isCrmInboundToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

/** `crm+<token>@<domain>` — the address a member pastes into a mailbox. */
export function crmInboundAddress(token: string, domain: string): string {
  return `${CRM_INBOUND_LOCAL_PART}+${token}@${domain}`
}

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
 * The token a recipient address carries, or `null` when the address is not
 * a capture address on `domain`. The local part is read case-folded — a
 * relay may fold it and the alphabet has no case to lose — and the domain
 * is compared the way domains compare.
 */
export function crmInboundTokenOf(recipient: unknown, domain: string): string | null {
  const raw = String(recipient ?? '').trim()
  const angled = /<([^<>]+)>\s*$/.exec(raw)
  const address = (angled ? angled[1] : raw).trim()
  const at = address.lastIndexOf('@')
  if (at <= 0) return null
  if (address.slice(at + 1).toLowerCase() !== domain.toLowerCase()) return null
  const local = address.slice(0, at).toLowerCase()
  const match = new RegExp(`^${CRM_INBOUND_LOCAL_PART}\\+([a-z0-9]{24,64})$`).exec(local)
  return match ? match[1] : null
}

/** Every distinct token among a message's recipients, in the order met. */
export function crmInboundTokensIn(
  recipients: readonly unknown[],
  domain: string,
): string[] {
  const tokens: string[] = []
  for (const recipient of recipients) {
    const token = crmInboundTokenOf(recipient, domain)
    if (token && !tokens.includes(token)) tokens.push(token)
  }
  return tokens
}

export function isCrmInboundAddress(address: unknown, domain: string): boolean {
  return crmInboundTokenOf(address, domain) !== null
}

/**
 * The subject with its reply and forward prefixes removed, however many
 * were stacked — `Re: Fwd: RE: Renewal` is the `Renewal` thread — and
 * whitespace collapsed, so two rows of one conversation carry one value.
 */
export function crmThreadSubject(subject: unknown): string {
  let value = String(subject ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const prefix = /^(re|fwd?|aw|wg|tr|sv|vs)\s*(\[\d+\])?\s*:\s*/i
  while (prefix.test(value)) value = value.replace(prefix, '')
  return value.slice(0, CRM_EMAIL_SUBJECT_MAX)
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
 * What the timeline keeps of a captured message: the text part — or the
 * words of the HTML part when there is none — with a forward's header
 * block and the quoted history below the reply removed, whitespace
 * settled, bounded. Never the whole thread: the thread is in the mailbox,
 * and the row is a note that this exchange happened.
 */
export function crmInboundExcerpt(text: unknown, html?: unknown): string {
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
    .slice(0, CRM_INBOUND_EXCERPT_MAX)
}

/** One address the message might be with, in the order the rule tries them. */
export interface CrmInboundCandidate {
  email: string
  /** What a row filed on a match with this address says about the message. */
  direction: CrmEmailDirection
  /** Which header the address came from, for the spec and the log. */
  via: 'from' | 'to' | 'cc' | 'forwarded'
}

export interface CrmInboundCandidatesInput {
  from: unknown
  to: readonly unknown[]
  cc?: readonly unknown[]
  /** The forwarded block's `From:`, when the body carried one. */
  forwardedFrom?: unknown
  /** The capture domain, so the capture address itself is never a candidate. */
  domain: string
  /** Every address on the workspace's roster; none of them is a correspondent. */
  memberEmails: readonly string[]
}

export interface CrmInboundCandidates {
  /** The normalized From, or `null` when the header carried no address. */
  sender: string | null
  /** Whether a member of the workspace wrote the message. */
  senderIsMember: boolean
  candidates: CrmInboundCandidate[]
}

/**
 * The addresses to try against the workspace's records, in order — see the
 * module comment — each already stamped with the direction a match would
 * mean: a message a member wrote went OUT to whoever it matches, and one
 * anybody else wrote came IN from them.
 */
export function crmInboundCandidates(input: CrmInboundCandidatesInput): CrmInboundCandidates {
  const members = new Set<string>()
  for (const email of input.memberEmails) {
    const normalized = normalizeContactEmail(email)
    if (normalized) members.add(normalized)
  }
  const sender = emailAddressOf(input.from)
  const senderIsMember = sender !== null && members.has(sender)
  const seen = new Set<string>()
  const candidates: CrmInboundCandidate[] = []
  const consider = (
    value: unknown,
    direction: CrmEmailDirection,
    via: CrmInboundCandidate['via'],
  ) => {
    const email = emailAddressOf(value)
    if (!email || seen.has(email) || members.has(email)) return
    if (isCrmInboundAddress(email, input.domain)) return
    seen.add(email)
    candidates.push({ email, direction, via })
  }
  consider(input.from, 'inbound', 'from')
  const headed = senderIsMember ? 'outbound' : 'inbound'
  for (const value of input.to) consider(value, headed, 'to')
  for (const value of input.cc ?? []) consider(value, headed, 'cc')
  consider(input.forwardedFrom, 'inbound', 'forwarded')
  return { sender, senderIsMember, candidates }
}

/**
 * The key one message is filed under, so a second delivery of it is a
 * no-op: its `Message-ID`, which every mail client stamps and every relay
 * preserves, else the provider's own id, which a redelivery of one
 * webhook event repeats. `null` when the message has neither — a message
 * that cannot be told from its own redelivery is filed by a fresh id.
 */
export function crmCapturedEmailKey(messageId: unknown, providerId: unknown): string | null {
  const id = String(messageId ?? '').trim()
  if (id) return `mid:${id}`
  const provider = String(providerId ?? '').trim()
  return provider ? `provider:${provider}` : null
}

/** What a captured message is logged from — see {@link buildCrmCapturedEmailActivity}. */
export interface CrmCapturedEmailInput {
  direction: CrmEmailDirection
  subject: string
  /** The excerpt, already reduced by {@link crmInboundExcerpt}. */
  excerpt: string
  /** The address on the message's From. */
  from: string
  /** The address the message was addressed to, when one is worth showing. */
  to?: string | null
  messageId: string
  inReplyTo?: string | null
  /** When the message was received. */
  atMs: number
  /** The member who wrote it, or `''` for a message a correspondent wrote. */
  byUid: string
  byName?: string | null
  link: CrmActivityLink
  hostId: string
  visibleTo: readonly string[]
}

/**
 * The activity row a captured message is filed as (AGL-2657): `kind:
 * 'email'`, with the direction the match decided, the excerpt for a body,
 * and the thread facts a later reader groups by. No delivery state — the
 * platform did not send it and can say nothing about where it got to —
 * which is also how the timeline tells a captured send from a platform
 * send. The same shape `buildCrmEmailActivity` writes, so the timeline
 * draws both with one row.
 */
export function buildCrmCapturedEmailActivity(input: CrmCapturedEmailInput): CrmActivity {
  const { link } = input
  const subject = String(input.subject ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CRM_EMAIL_SUBJECT_MAX)
  const inReplyTo = String(input.inReplyTo ?? '').trim()
  const to = String(input.to ?? '').trim()
  const byName = String(input.byName ?? '').trim()
  return {
    kind: 'email',
    subject,
    body: String(input.excerpt ?? '').slice(0, CRM_EMAIL_BODY_MAX),
    direction: input.direction,
    from: input.from,
    ...(to ? { to } : {}),
    messageId: String(input.messageId ?? '').trim(),
    ...(inReplyTo ? { inReplyTo } : {}),
    threadSubject: crmThreadSubject(subject),
    atMs: input.atMs,
    byUid: input.byUid,
    ...(byName ? { byName } : {}),
    ...(link.contactId ? { contactId: String(link.contactId) } : {}),
    ...(link.companyId ? { companyId: String(link.companyId) } : {}),
    ...(link.dealId ? { dealId: String(link.dealId) } : {}),
    ...(link.leadId ? { leadId: String(link.leadId) } : {}),
    hostId: input.hostId,
    visibleTo: [...input.visibleTo],
  }
}
