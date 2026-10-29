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

import { appendOrderEvent, type HostOrder } from './commerce-orders'
import { quoteLinkVersion } from './commerce-quote-pay'
import { latestQuoteResponse } from './commerce-quote-proofs'
import {
  formatQuoteNumber,
  isQuote,
  isUnpaidQuote,
  type OrderQuote,
  type QuoteEmailThread,
  type QuoteSendRecord,
} from './commerce-quotes'

/*==========================================
 * EMAILING A QUOTE TO THE CUSTOMER (AGL-4097).
 *
 * The business sends the quote from the console: one email in the site's
 * look with its message, the proof, the PDF and the pay button, in the
 * customer's existing conversation when there is one. Each send is recorded
 * on the quote (`quote.sends`) with the revision it carried and the pay link
 * version it carried, and the conversation is kept as `quote.emailThread`.
 *
 * THE PAY LINK ON A NEW REVISION. When the customer was emailed an earlier
 * revision, the first email of a new revision gives them a new pay link and
 * retires the old one (slice 2's Replace link), so the link in the earlier
 * email opens a page saying the quote was updated. A resend of the same
 * revision keeps the link. "Was the link already replaced since that email"
 * is read off the record (the link version it carried), which is also what
 * keeps a send that failed after replacing the link from replacing it again
 * when it is retried.
 *
 * Pure: the console's Send button and the server's send action read the
 * same answers.
 *=========================================*/

/** The most sends a quote keeps on record; the oldest go first. */
export const QUOTE_MAX_SENDS = 50

/** The longest message a send carries. */
export const QUOTE_MAX_SEND_MESSAGE = 5_000

/** The longest subject a send carries. */
export const QUOTE_MAX_SEND_SUBJECT = 200

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The quote's sends on record, oldest first. */
export function quoteSends(quote: Pick<OrderQuote, 'sends'> | null | undefined): QuoteSendRecord[] {
  return Array.isArray(quote?.sends) ? quote.sends.filter((send) => send && typeof send === 'object') : []
}

/** The last time the quote was emailed, or null. */
export function lastQuoteSend(quote: Pick<OrderQuote, 'sends'> | null | undefined): QuoteSendRecord | null {
  const sends = quoteSends(quote)
  return sends.length ? sends[sends.length - 1] : null
}

/**
 * Whether emailing the quote now gives the customer a new pay link: they were
 * emailed an earlier revision, and the link has not been replaced since.
 */
export function quoteSendReplacesLink(
  quote: Pick<OrderQuote, 'sends' | 'revision' | 'linkVersion'> | null | undefined,
): boolean {
  const last = lastQuoteSend(quote)
  if (!last) return false
  if (!(Number(last.revision) < Number(quote?.revision ?? 1))) return false
  return Number(last.linkVersion) === quoteLinkVersion(quote)
}

/** What the console's Send button says: `Send quote`, `Send again`, or `Send revision 2`. */
export function quoteSendLabel(quote: Pick<OrderQuote, 'sends' | 'revision'> | null | undefined): string {
  const last = lastQuoteSend(quote)
  if (!last) return 'Send quote'
  const revision = Number(quote?.revision ?? 1)
  return Number(last.revision) < revision ? `Send revision ${revision}` : 'Send again'
}

/** Where the quote goes: what was typed in the dialog, else the customer's email. */
export function quoteSendRecipient(
  order: Pick<HostOrder, 'quote'> | null | undefined,
  typed: string | null | undefined,
): string {
  return String(typed ?? '').trim() || String(order?.quote?.customer?.email ?? '').trim()
}

export type QuoteSendRefusal = 'not-a-quote' | 'paid' | 'no-address' | 'bad-address'

/** Why the quote cannot be emailed to `to` now, if it cannot. */
export function quoteSendRefusal(
  order: Pick<HostOrder, 'channel' | 'status' | 'quote'> | null | undefined,
  to: string,
): QuoteSendRefusal | null {
  if (!order || !isQuote(order) || !order.quote) return 'not-a-quote'
  if (!isUnpaidQuote(order)) return 'paid'
  if (!to) return 'no-address'
  if (to.length > 320 || !EMAIL.test(to)) return 'bad-address'
  return null
}

export function quoteSendRefusalMessage(reason: QuoteSendRefusal): string {
  switch (reason) {
    case 'not-a-quote':
      return 'Unknown quote'
    case 'paid':
      return 'This quote has been paid, so it is an order now and is not sent again.'
    case 'no-address':
      return 'This quote has no email for the customer. Add one to the quote, or type where to send it.'
    case 'bad-address':
      return 'Enter a valid email address to send the quote to.'
  }
}

/**
 * The subject a send defaults to: the conversation's, so it stays one
 * conversation, else `Quote #1042 from Acme Signs`.
 */
export function quoteEmailDefaultSubject(
  order: Pick<HostOrder, 'number' | 'quote'>,
  businessName: string,
  quoteId?: string,
): string {
  const thread = String(order.quote?.emailThread?.subject ?? '').trim()
  if (thread) return thread
  const name = String(businessName ?? '').trim()
  const number = formatQuoteNumber(order, quoteId)
  return name ? `${number} from ${name}` : number
}

/** What the console sends: where, under what subject, and the business's message. */
export interface QuoteSendInput {
  to: string
  subject: string
  message: string
}

/** A send as the route received it, trimmed, or what to fix. `to` and `subject` may be empty: the defaults fill them. */
export function parseQuoteSendInput(raw: unknown): { ok: true; input: QuoteSendInput } | { ok: false; error: string } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const to = text(source['to']).trim()
  // A subject is one header line.
  const subject = text(source['subject']).replace(/[\r\n]+/g, ' ').trim()
  const message = text(source['message']).replace(/\r\n?/g, '\n').trim()
  if (subject.length > QUOTE_MAX_SEND_SUBJECT) {
    return { ok: false, error: `Keep the subject under ${QUOTE_MAX_SEND_SUBJECT} characters.` }
  }
  if (message.length > QUOTE_MAX_SEND_MESSAGE) {
    return { ok: false, error: `Keep the message under ${QUOTE_MAX_SEND_MESSAGE.toLocaleString('en-US')} characters.` }
  }
  return { ok: true, input: { to, subject, message } }
}

/**
 * The quote once an email went out: the send on record, the conversation
 * moved on, a line on the timeline, and the quote at Sent, unless the
 * customer has already answered this revision (approved it, or asked for
 * changes), which stays what it says.
 */
export function quoteAfterSend(
  order: HostOrder,
  send: QuoteSendRecord,
  thread: QuoteEmailThread,
): HostOrder {
  const quote = order.quote as OrderQuote
  const answered = latestQuoteResponse(quote) !== null
  return {
    ...order,
    timeline: appendOrderEvent(
      order,
      'quote-sent',
      `Revision ${send.revision} emailed to ${send.to} by ${send.by}`,
      send.atMs,
    ),
    quote: {
      ...quote,
      stage: answered ? quote.stage : 'sent',
      sends: [...quoteSends(quote), send].slice(-QUOTE_MAX_SENDS),
      emailThread: thread,
    },
  }
}
