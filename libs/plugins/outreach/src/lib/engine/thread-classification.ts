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
 * WHAT CAME BACK (AGL-2979).
 *
 * The runtime reads each enrollment's threads and asks what the new
 * messages mean. Each message is one of:
 *
 * - `self` — the mailbox's own: a step, or the rep writing in the thread.
 * - `hard_bounce` / `soft_bounce` — a delivery report (`./delivery-status.ts`).
 * - `delivery_report` — a mail system's message that reports no failure.
 * - `auto_reply` — an out-of-office or an autoresponder. It POSTPONES the
 *   next step and does not stop the sequence: nobody answered.
 * - `opt_out` — a reply that asks to be left alone (`./opt-out-intent.ts`),
 *   or a message sent to the unsubscribe address.
 * - `reply` — any other message from anybody else.
 *
 * ## Automatic replies
 *
 * Read from the headers the standards give an autoresponder —
 * `Auto-Submitted` with any value but `no` (RFC 3834), `X-Autoreply`,
 * `X-Autorespond`, `Precedence: auto_reply`, `bulk` or `junk` — and, for
 * the servers that set none, from an out-of-office subject in the usual
 * languages.
 *
 * ## The thread's outcome
 *
 * `opted_out` outranks `replied`, which outranks `bounced`, which outranks
 * `postpone`: an opt-out is a reply that also has to reach the do-not-contact
 * list, a person who wrote back matters more than a report about an earlier
 * send, and an out-of-office only matters when nothing else happened. The
 * bounces that report this recipient are counted either way, because mailbox
 * health counts every one.
 *==========================================*/

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { crmThreadSubject, emailAddressOf, htmlToPlainText } from '@aglyn/aglyn/app-utils/crm-inbound'
import { readOutreachDeliveryReport, isMailerDaemonMessage } from './delivery-status'
import { detectOutreachOptOutIntent, detectOutreachOptOutSubject } from './opt-out-intent'
import { outreachHeader, type OutreachThreadMessage } from './thread-message'

export type OutreachMessageKind =
  | 'self'
  | 'hard_bounce'
  | 'soft_bounce'
  | 'delivery_report'
  | 'auto_reply'
  | 'opt_out'
  | 'reply'

export interface OutreachBounceDetail {
  /** The addresses the report says failed; empty when it names none. */
  recipients: string[]
  status: string | null
  diagnostic: string | null
  /** The receiving server the report names, when it does (AGL-3326). */
  remoteMta: string | null
}

export interface OutreachMessageClassification {
  messageId: string
  atMs: number
  kind: OutreachMessageKind
  /** The sender's address, normalized, when the `From` carried one. */
  from: string | null
  /** Set on a bounce. */
  bounce: OutreachBounceDetail | null
  /** An opt-out that calls the email spam. */
  complaint: boolean
  /** What decided it, for the timeline and the log. */
  evidence: string | null
}

export interface OutreachMessageContext {
  /** The mailbox's own addresses: the account's and every alias it sends as. */
  selfAddresses: readonly string[]
  /** The address a `List-Unsubscribe` mailto points at, when the runtime set one. */
  unsubscribeAddress?: string | null
  /** The subject the thread was started with, so a new subject can be read on its own. */
  threadSubject?: string | null
}

const AUTO_REPLY_SUBJECT = new RegExp(
  [
    '^\\s*\\[?\\s*(',
    'auto(matic)?[\\s-]*(reply|response|responder|answer)',
    '|out[\\s-]+of[\\s-]+(the[\\s-]+)?office',
    '|ooo\\b',
    "|i('m| am) (currently )?(out of the office|away|on (vacation|leave|holiday))",
    '|(on )?(vacation|holiday|annual leave)[\\s-]*(reply|response|notice|message|autoreply)',
    '|away from (the |my )?(office|desk)',
    '|abwesenheitsnotiz|abwesenheit',
    '|r[ée]ponse automatique|absence du bureau',
    '|respuesta autom[áa]tica|fuera de la oficina',
    '|risposta automatica|fuori ufficio',
    '|automatisch antwoord|afwezigheidsbericht',
    '|resposta autom[áa]tica|fora do escrit[óo]rio',
    '|autosvar|automaattinen vastaus',
    ')',
  ].join(''),
  'i',
)

/**
 * Why a message is an automatic reply, or `null` when it is not one — see
 * the module note for the headers and subjects read.
 */
export function outreachAutoReplyEvidence(
  message: Pick<OutreachThreadMessage, 'headers' | 'subject'>,
): string | null {
  const autoSubmitted = outreachHeader(message, 'Auto-Submitted').split(';')[0].trim().toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return `Auto-Submitted: ${autoSubmitted}`
  for (const name of ['X-Autoreply', 'X-Autorespond']) {
    const value = outreachHeader(message, name).trim()
    if (value && value.toLowerCase() !== 'no') return `${name}: ${value}`
  }
  const precedence = outreachHeader(message, 'Precedence').trim().toLowerCase()
  if (['auto_reply', 'bulk', 'junk'].includes(precedence)) return `Precedence: ${precedence}`
  const subject = String(message?.subject ?? '').replace(/^\s*(re|fwd?)\s*:\s*/i, '')
  const match = AUTO_REPLY_SUBJECT.exec(subject)
  return match ? `Subject: ${match[0].trim()}` : null
}

function addressesIn(header: string): string[] {
  return header
    .split(',')
    .map((part) => emailAddressOf(part))
    .filter((address): address is string => address !== null)
}

function readableText(message: OutreachThreadMessage): string {
  if (message.textBody && message.textBody.trim()) return message.textBody
  if (message.htmlBody && message.htmlBody.trim()) return htmlToPlainText(message.htmlBody)
  return message.snippet ?? ''
}

/** What one message in an enrollment's thread is — see the module note. */
export function classifyOutreachMessage(
  message: OutreachThreadMessage,
  context: OutreachMessageContext,
): OutreachMessageClassification {
  const from = emailAddressOf(message.from)
  const base = {
    messageId: String(message.id ?? ''),
    atMs: Number.isFinite(message.internalDateMs) ? message.internalDateMs : 0,
    from,
    bounce: null,
    complaint: false,
    evidence: null,
  }

  const report = readOutreachDeliveryReport(message)
  if (report) {
    if (!report.kind) return { ...base, kind: 'delivery_report', evidence: 'delivery report' }
    return {
      ...base,
      kind: report.kind === 'hard' ? 'hard_bounce' : 'soft_bounce',
      bounce: {
        recipients: report.failedAddresses,
        status: report.status,
        diagnostic: report.diagnostic,
        remoteMta: report.remoteMta,
      },
      evidence: report.status ? `Status: ${report.status}` : 'delivery report',
    }
  }

  const self = new Set(
    (context.selfAddresses ?? [])
      .map((address) => normalizeContactEmail(address))
      .filter((address): address is string => address !== null),
  )
  if (from && self.has(from)) return { ...base, kind: 'self' }
  if (isMailerDaemonMessage(message)) {
    return { ...base, kind: 'delivery_report', evidence: 'mail system message' }
  }

  const unsubscribe = normalizeContactEmail(context.unsubscribeAddress)
  if (unsubscribe && addressesIn(message.to ?? '').includes(unsubscribe)) {
    return { ...base, kind: 'opt_out', evidence: `To: ${unsubscribe}` }
  }

  const autoReply = outreachAutoReplyEvidence(message)
  if (autoReply) return { ...base, kind: 'auto_reply', evidence: autoReply }

  const intent = detectOutreachOptOutIntent(readableText(message))
  if (intent.optOut) {
    return { ...base, kind: 'opt_out', complaint: intent.complaint, evidence: intent.matched }
  }
  // A subject is read only on a message that starts fresh — no `Re:`, and
  // not the thread's own — and only when it says nothing but stop.
  const subject = String(message.subject ?? '').replace(/\s+/g, ' ').trim()
  const fresh = crmThreadSubject(subject) === subject
  if (subject && fresh && subject !== crmThreadSubject(context.threadSubject)) {
    const subjectIntent = detectOutreachOptOutSubject(subject)
    if (subjectIntent.optOut) {
      return { ...base, kind: 'opt_out', evidence: `Subject: ${subjectIntent.matched}` }
    }
  }
  return { ...base, kind: 'reply' }
}

export type OutreachThreadOutcome = 'none' | 'postpone' | 'bounced' | 'replied' | 'opted_out'

export interface OutreachThreadDecisionInput extends OutreachMessageContext {
  /** The thread's messages, in any order. */
  messages: readonly OutreachThreadMessage[]
  /** The enrollment's recipient. */
  recipient: string
  /** Messages received at or before this instant were handled by an earlier run. */
  afterMs?: number | null
  /** Ids of messages an earlier run handled. */
  handledMessageIds?: readonly string[]
}

export interface OutreachThreadDecision {
  outcome: OutreachThreadOutcome
  /** The message that decided the outcome; `null` for `none`. */
  decidedBy: OutreachMessageClassification | null
  /** Every new message, classified, oldest first. */
  classifications: OutreachMessageClassification[]
  /** A new reply called the email spam: the mailbox is paused as well. */
  complaint: boolean
  /** New hard bounces that report this recipient. */
  hardBounces: number
  /** New soft bounces that report this recipient. */
  softBounces: number
}

const RANK: Record<OutreachThreadOutcome, number> = {
  none: 0,
  postpone: 1,
  bounced: 2,
  replied: 3,
  opted_out: 4,
}

const OUTCOME_OF: Partial<Record<OutreachMessageKind, OutreachThreadOutcome>> = {
  auto_reply: 'postpone',
  hard_bounce: 'bounced',
  reply: 'replied',
  opt_out: 'opted_out',
}

/** What the new messages in an enrollment's thread mean for it — see the module note. */
export function decideOutreachThread(input: OutreachThreadDecisionInput): OutreachThreadDecision {
  const recipient = normalizeContactEmail(input.recipient)
  const handled = new Set(input.handledMessageIds ?? [])
  const afterMs = typeof input.afterMs === 'number' ? input.afterMs : null
  const fresh = [...(input.messages ?? [])]
    .filter((message) => message && !handled.has(message.id))
    .filter((message) => afterMs === null || message.internalDateMs > afterMs)
    .sort((a, b) => a.internalDateMs - b.internalDateMs)

  const decision: OutreachThreadDecision = {
    outcome: 'none',
    decidedBy: null,
    classifications: [],
    complaint: false,
    hardBounces: 0,
    softBounces: 0,
  }
  for (const message of fresh) {
    const classification = classifyOutreachMessage(message, input)
    decision.classifications.push(classification)
    const bounce = classification.bounce
    const aboutRecipient =
      !bounce || !bounce.recipients.length || (recipient !== null && bounce.recipients.includes(recipient))
    if (classification.kind === 'hard_bounce' && aboutRecipient) decision.hardBounces += 1
    if (classification.kind === 'soft_bounce' && aboutRecipient) decision.softBounces += 1
    if (classification.complaint) decision.complaint = true
    const outcome = OUTCOME_OF[classification.kind]
    if (!outcome || (classification.kind === 'hard_bounce' && !aboutRecipient)) continue
    if (RANK[outcome] > RANK[decision.outcome]) {
      decision.outcome = outcome
      decision.decidedBy = classification
    }
  }
  return decision
}
