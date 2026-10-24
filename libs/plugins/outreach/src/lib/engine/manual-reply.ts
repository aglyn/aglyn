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
 * ANSWERING A PERSON WHO WROTE BACK (AGL-4020).
 *
 * A person who answers a sequence email is answered from the same mailbox,
 * in the same thread, by a member: the reply is a one-to-one email, never a
 * step of the sequence. This module is the engine's half of it — what the
 * person wrote, as the enrollment keeps it, and the answer, as the
 * transport sends it — and decides nothing about storage or delivery.
 *
 * ## What the person wrote
 *
 * {@link outreachInboundMessagesOf} keeps the messages of a thread the
 * classifier reads as theirs: a reply, an automatic answer, an opt-out. Each
 * carries its sender, its time, its `Message-ID` and `References` (what an
 * answer threads by), and its text with the quoted history trimmed, the way
 * the record's timeline keeps it (`emailExcerpt`).
 *
 * ## The answer
 *
 * {@link composeOutreachManualReply} writes it as every mail client writes a
 * reply: `Re:` the subject of the message it answers, `In-Reply-To` that
 * message's `Message-ID`, and `References` the whole chain — the sequence's
 * own sends, what the person's message already named, and the message
 * itself — so it lands in the same thread in the person's mailbox and in
 * ours. Plain text, the member's words first and the message answered quoted
 * beneath. No footer and no `List-Unsubscribe`: the person wrote first, and
 * this is the answer a person would type in their own mail client.
 *
 * On a sequence that tracks link clicks, the links in the member's words go
 * out as the same short links a step's do (AGL-4022), through the caller's
 * minter — never the links in the quoted message, which are theirs.
 *
 * ## What still refuses
 *
 * {@link outreachManualReplyRefusal}: an address or a domain on the
 * do-not-contact list, a person who opted out or whose address bounced, and
 * a mailbox that is paused, waiting to be reconnected, or gone. The cold
 * rules — the allowed countries, the company-domain rule, the personal line,
 * the daily cap — do not apply to someone who wrote first, and are not
 * asked.
 *==========================================*/

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { CRM_EMAIL_SUBJECT_MAX } from '@aglyn/aglyn/app-utils/crm'
import { emailAddressOf, emailExcerpt, threadSubject } from '@aglyn/aglyn/app-utils/email-text'
import {
  OUTREACH_INBOUND_KINDS,
  OUTREACH_INBOUND_MESSAGES_MAX,
  type OutreachEnrollment,
  type OutreachInboundKind,
  type OutreachInboundMessage,
  type OutreachMailbox,
} from '../model/outreach.types'
import { rewriteOutreachBodyLinks } from './click-tracking'
import { outreachMessageIdHeader } from './compose'
import { outreachEmailDomain } from './do-not-contact-domain'
import { classifyOutreachMessage, type OutreachMessageContext } from './thread-classification'
import { outreachHeader, type OutreachThreadMessage } from './thread-message'

/** The most a member may write in one answer. */
export const OUTREACH_MANUAL_REPLY_BODY_MAX = 10_000

/** The most of an answer the enrollment and the record keep: the timeline's excerpt length. */
export const OUTREACH_MANUAL_REPLY_STORED_MAX = 4_000

/** The most `Message-ID`s one answer's `References` names: the first, and the latest. */
const REFERENCES_MAX = 20

/** The display name in a `From` value — `"Ada Lovelace" <ada@example.com>` answers `Ada Lovelace` — or `''`. */
export function outreachDisplayNameOf(value: unknown): string {
  const raw = String(value ?? '').trim()
  const angled = raw.lastIndexOf('<')
  if (angled <= 0) return ''
  return raw
    .slice(0, angled)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\(.)/g, '$1')
    .trim()
}

/** Every `Message-ID` a `References` or `In-Reply-To` value names, in header form, in order, once each. */
export function outreachMessageIdList(value: unknown): string[] {
  const found: string[] = []
  for (const match of String(value ?? '').matchAll(/<[^<>\s]+>/g)) {
    const id = outreachMessageIdHeader(match[0])
    if (id && !found.includes(id)) found.push(id)
  }
  return found
}

/** A message's text as the record keeps it: the text part, else the HTML's words, else the preview. */
function bodyOf(message: OutreachThreadMessage): string {
  return emailExcerpt(message.textBody ?? '', message.htmlBody ?? '') || emailExcerpt(message.snippet ?? '')
}

/**
 * The person's own messages among a thread's — see the module note — oldest
 * first. A message with no sender address is left out: it could be neither
 * shown as theirs nor answered.
 */
export function outreachInboundMessagesOf(
  messages: readonly OutreachThreadMessage[],
  context: OutreachMessageContext,
): OutreachInboundMessage[] {
  const kept: OutreachInboundMessage[] = []
  for (const message of messages) {
    if (!message?.id) continue
    const classification = classifyOutreachMessage(message, context)
    if (!(OUTREACH_INBOUND_KINDS as readonly string[]).includes(classification.kind)) continue
    const from = emailAddressOf(message.from)
    if (!from) continue
    const replyTo = emailAddressOf(outreachHeader(message, 'Reply-To'))
    kept.push({
      id: message.id,
      threadId: message.threadId ?? null,
      messageId: outreachMessageIdHeader(outreachHeader(message, 'Message-ID')),
      references: outreachMessageIdList(outreachHeader(message, 'References')),
      from,
      fromName: outreachDisplayNameOf(message.from),
      replyTo: replyTo && replyTo !== from ? replyTo : null,
      subject: String(message.subject ?? '').replace(/\s+/g, ' ').trim(),
      atMs: classification.atMs,
      kind: classification.kind as OutreachInboundKind,
      body: bodyOf(message),
    })
  }
  return kept.sort((a, b) => a.atMs - b.atMs)
}

/**
 * What an enrollment keeps once more of the person's messages are read: one
 * entry per message — a re-read replaces the earlier copy — oldest first,
 * the last {@link OUTREACH_INBOUND_MESSAGES_MAX}.
 */
export function mergeOutreachInboundMessages(
  stored: readonly OutreachInboundMessage[] | null | undefined,
  found: readonly OutreachInboundMessage[],
): OutreachInboundMessage[] {
  const byId = new Map<string, OutreachInboundMessage>()
  for (const message of [...(stored ?? []), ...found]) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.atMs - b.atMs).slice(-OUTREACH_INBOUND_MESSAGES_MAX)
}

/**
 * The message an answer replies to: the one named, when the enrollment
 * kept it, else the newest the person wrote. `null` when they wrote nothing
 * the enrollment kept.
 */
export function outreachMessageToAnswer(
  inbound: readonly OutreachInboundMessage[] | null | undefined,
  id?: string | null,
): OutreachInboundMessage | null {
  const messages = [...(inbound ?? [])].sort((a, b) => a.atMs - b.atMs)
  if (id) return messages.find((message) => message.id === id) ?? null
  return messages.at(-1) ?? null
}

/** Whether a member may answer this enrollment at all: the person wrote something it kept, or a reply stopped it. */
export function outreachEnrollmentHasInbound(
  enrollment: Pick<OutreachEnrollment, 'inboundMessages' | 'stopReason' | 'status'>,
): boolean {
  return Boolean(enrollment.inboundMessages?.length) || enrollment.stopReason === 'reply' || enrollment.status === 'replied'
}

/**
 * The answer's `References` — see the module note: the sequence's own sends,
 * then what the answered message named, then the message itself, each once.
 * A long chain keeps its first id and its latest, as RFC 5322 §3.6.4 allows.
 */
export function outreachReplyReferences(
  sentMessageIds: readonly string[],
  answering: Pick<OutreachInboundMessage, 'references' | 'messageId'>,
): string[] {
  const chain: string[] = []
  for (const id of [...sentMessageIds, ...answering.references, answering.messageId]) {
    const header = outreachMessageIdHeader(id)
    if (header && !chain.includes(header)) chain.push(header)
  }
  return chain.length > REFERENCES_MAX ? [chain[0], ...chain.slice(-(REFERENCES_MAX - 1))] : chain
}

/** `Re:` the subject of the message answered, else of the thread the sequence started. */
export function outreachReplySubject(
  answering: Pick<OutreachInboundMessage, 'subject'>,
  enrollmentThreadSubject: string | null | undefined,
): string {
  const base = threadSubject(answering.subject) || threadSubject(enrollmentThreadSubject)
  return (base ? `Re: ${base}` : 'Re:').slice(0, CRM_EMAIL_SUBJECT_MAX)
}

/** "Tue, Oct 21, 2026, 8:02 AM", in the mailbox's zone. */
function quotedTime(atMs: number, timeZone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  // Plain spaces: newer ICU puts a narrow no-break space before "AM".
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(atMs).replace(/[\u00a0\u202f]/g, ' ')
  try {
    return format(timeZone || 'UTC')
  } catch {
    return format('UTC')
  }
}

/** The answered message beneath the answer, quoted the way mail clients quote: `On …, … wrote:` and `> ` lines. */
export function outreachReplyQuote(
  answering: Pick<OutreachInboundMessage, 'atMs' | 'from' | 'fromName' | 'body'>,
  timeZone: string | null | undefined,
): string {
  const who = answering.fromName ? `${answering.fromName} <${answering.from}>` : answering.from
  const lines = answering.body.split('\n').map((line) => (line ? `> ${line}` : '>'))
  return [`On ${quotedTime(answering.atMs, timeZone)}, ${who} wrote:`, ...lines].join('\n')
}

/** An answer, written: what the transport sends and the records keep. */
export interface OutreachManualReply {
  to: string
  subject: string
  /** The whole text sent: the member's words, then the quote. */
  text: string
  /** The member's words alone, as sent — tracked links in place — bounded, as the records keep them. */
  body: string
  /**
   * The destinations the minter rewrote, in the order a short link's
   * `linkIndex` names them (AGL-4022). Empty when nothing was rewritten.
   */
  trackedLinks: string[]
  /** The provider thread it is filed into; `null` lets the provider thread it by its headers. */
  threadId: string | null
  /** The answered message's `Message-ID`; `null` when it carried none. */
  inReplyTo: string | null
  references: string[]
}

export type OutreachManualReplyErrorCode = 'empty' | 'too_long' | 'invalid_recipient'

export interface OutreachManualReplyCompose {
  reply: OutreachManualReply | null
  error: { code: OutreachManualReplyErrorCode; message: string } | null
}

/** Writes the answer — see the module note. */
export function composeOutreachManualReply(input: {
  enrollment: Pick<OutreachEnrollment, 'messageIds' | 'threadSubject'>
  answering: OutreachInboundMessage
  body: unknown
  /** The mailbox's zone, for the quote's time. */
  timeZone: string | null | undefined
  /**
   * Mints the short link for the link at `index` in the member's words, or
   * `null` to leave it as written (AGL-4022). Absent — a sequence that does
   * not track clicks — sends every link as written.
   */
  rewriteLink?: ((link: { url: string; index: number }) => string | null) | null
}): OutreachManualReplyCompose {
  const words = String(input.body ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '')
  if (!words.trim()) return { reply: null, error: { code: 'empty', message: 'Write your answer before sending it.' } }
  if (words.length > OUTREACH_MANUAL_REPLY_BODY_MAX) {
    return {
      reply: null,
      error: {
        code: 'too_long',
        message: `An answer can be at most ${OUTREACH_MANUAL_REPLY_BODY_MAX.toLocaleString('en-US')} characters.`,
      },
    }
  }
  const to = normalizeContactEmail(input.answering.replyTo ?? input.answering.from)
  if (!to) {
    return { reply: null, error: { code: 'invalid_recipient', message: 'Their message names no address to answer.' } }
  }
  const rewritten = input.rewriteLink ? rewriteOutreachBodyLinks(words, input.rewriteLink) : { text: words, links: [] }
  return {
    reply: {
      to,
      subject: outreachReplySubject(input.answering, input.enrollment.threadSubject),
      text: `${rewritten.text}\n\n${outreachReplyQuote(input.answering, input.timeZone)}`,
      body: rewritten.text.slice(0, OUTREACH_MANUAL_REPLY_STORED_MAX),
      trackedLinks: rewritten.links,
      threadId: input.answering.threadId,
      inReplyTo: input.answering.messageId,
      references: outreachReplyReferences(input.enrollment.messageIds ?? [], input.answering),
    },
    error: null,
  }
}

export type OutreachManualReplyRefusalCode =
  | 'opted-out'
  | 'bounced'
  | 'do-not-contact'
  | 'unchecked'
  | 'mailbox-unavailable'
  | 'permission'

export interface OutreachManualReplyRefusal {
  code: OutreachManualReplyRefusalCode
  message: string
}

/** The address a mailbox sends as. */
export const outreachMailboxAddress = (mailbox: Pick<OutreachMailbox, 'sendAs' | 'email'>): string =>
  mailbox.sendAs || mailbox.email

/**
 * Why an answer cannot go now, in the member's words, or `null` — see the
 * module note. The person's own state first, then the lists, then the
 * mailbox, then who may send from it.
 */
export function outreachManualReplyRefusal(input: {
  enrollment: Pick<OutreachEnrollment, 'status' | 'email'>
  /** Every address the answer would reach, each looked up. */
  doNotContact: boolean | null
  doNotContactDomain: boolean | null
  mailbox: Pick<OutreachMailbox, 'status' | 'sendAs' | 'email'> | null
  /** The member is the mailbox's own, or an organization owner or admin. */
  mayUseMailbox: boolean
}): OutreachManualReplyRefusal | null {
  const { enrollment, mailbox } = input
  if (enrollment.status === 'opted_out') {
    return { code: 'opted-out', message: 'They asked not to be emailed, so no answer can be sent to them.' }
  }
  if (enrollment.status === 'bounced') {
    return { code: 'bounced', message: 'Their address bounced, so an answer would not reach them.' }
  }
  if (input.doNotContact === true) {
    return {
      code: 'do-not-contact',
      message: `${enrollment.email} is on your do-not-contact list. Take it off the list on the Compliance page to answer them.`,
    }
  }
  if (input.doNotContactDomain === true) {
    const domain = outreachEmailDomain(enrollment.email) ?? 'Their domain'
    return {
      code: 'do-not-contact',
      message: `${domain} is on your do-not-contact list. Take it off the list on the Compliance page to answer them.`,
    }
  }
  if (input.doNotContact === null || input.doNotContactDomain === null) {
    return { code: 'unchecked', message: 'The do-not-contact list could not be checked. Try again in a moment.' }
  }
  if (!mailbox) {
    return {
      code: 'mailbox-unavailable',
      message: 'The mailbox that wrote to them is no longer connected, so the answer cannot go from it.',
    }
  }
  const address = outreachMailboxAddress(mailbox)
  if (mailbox.status === 'paused') {
    return {
      code: 'mailbox-unavailable',
      message: `${address} is paused. Resume it on the Mailboxes page to answer from it.`,
    }
  }
  if (mailbox.status !== 'connected') {
    return {
      code: 'mailbox-unavailable',
      message: `${address} needs to be connected again. Reconnect it on the Mailboxes page to answer from it.`,
    }
  }
  if (!input.mayUseMailbox) {
    return {
      code: 'permission',
      message: `Only the member who connected ${address}, or an organization owner or admin, can answer from it.`,
    }
  }
  return null
}
