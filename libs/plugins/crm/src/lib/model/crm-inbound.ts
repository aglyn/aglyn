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
  CRM_EMAIL_BODY_MAX,
  CRM_EMAIL_SUBJECT_MAX,
  type CrmActivity,
  type CrmActivityLink,
  type CrmEmailDirection,
} from '@aglyn/aglyn/app-utils/crm'
import { emailAddressOf, threadSubject } from '@aglyn/aglyn/app-utils/email-text'
import {
  type MemberAddresses,
  memberEmailAddresses,
} from '@aglyn/aglyn/app-utils/member-email-aliases'

/**
 * EMAIL CAPTURE (AGL-2657): the pure half.
 *
 * A workspace gets one address — `crm+<token>@<capture domain>` — and a
 * reply forwarded to it, or a message a teammate copies to it from their
 * own mailbox, is filed on the record of whoever the message was with.
 * This module is everything about that which needs no Firestore and no
 * provider: the shape of the address, the token in it, which of a
 * message's addresses is the correspondent, and the activity row the whole
 * thing becomes. How a message is read — the address in a header, the
 * reply above the quoted history — is the platform's (`email-text.ts`), and
 * so is the domain mail arrives on (`inbound-mail-domain.ts`). The webhook
 * route and the address route read it; the specs read all of it.
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
 * A member is every address that is theirs: the one they sign in with and
 * each alias they have confirmed (`member-email-aliases.ts`), so a send
 * from an outbound-domain alias is read as the member's, not as a stranger.
 * A message a teammate forwarded names the correspondent nowhere in its
 * headers, only in the forwarded block of the body, so that block's `From:`
 * is the last candidate. Which candidate matched decides the direction:
 * one the correspondent wrote is `inbound`, one the workspace wrote is
 * `outbound`.
 */

/** The local part every capture address begins with: `crm+<token>@…`. */
export const CRM_INBOUND_LOCAL_PART = 'crm'

/** How many characters a minted token has. */
export const CRM_INBOUND_TOKEN_LENGTH = 32

/** What the org's feed says about a message that matched no record. */
export const CRM_INBOUND_UNMATCHED_ACTION = 'Inbound email matched no record'

/** What the org's feed says about a message the record's ceiling refused. */
export const CRM_INBOUND_CEILING_ACTION = 'Inbound email not filed: activity log full'

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const TOKEN_PATTERN = /^[a-z0-9]{24,64}$/

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
  /**
   * The workspace's roster. Every address that is a member's — the one
   * they sign in with and each alias they have confirmed — is theirs, and
   * none of them is ever a correspondent.
   */
  members: readonly MemberAddresses[]
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
  for (const member of input.members) {
    for (const address of memberEmailAddresses(member)) members.add(address)
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
  /** The excerpt, already reduced by `emailExcerpt`. */
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
    threadSubject: threadSubject(subject),
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
