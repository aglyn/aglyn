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
import { quoteSendPrefill } from './commerce-quote-email'
import { formatQuoteNumber, isQuote, quoteIsProofOnly, type OrderQuote, type QuoteEmailThread } from './commerce-quotes'

/*==========================================
 * A QUOTE'S CONVERSATION (AGL-4207): what the business and its customer say
 * to each other about one quote, kept under it at
 * `hosts/{hostId}/orders/{quoteId}/messages/{id}`, so it stays through every
 * revision and after the quote is paid.
 *
 *   - `out`: a reply the business sent from the quote. It went by email, in
 *     the quote's own conversation in the customer's mailbox
 *     (`quote.emailThread`), under the `quote-message` catalog email.
 *   - `in`: what the customer wrote on the quote page. The business is told
 *     in Aglyn and by email.
 *
 * Nothing receives mail: a customer who answers an email reaches the
 * business's own mailbox (its Reply-To), as an Inbox reply's answer does.
 *=========================================*/

/** The catalog email a reply from the quote goes out as. */
export const QUOTE_MESSAGE_EMAIL_KEY = 'quote-message'

/** The longest message either side may send. */
export const QUOTE_MESSAGE_MAX = 5_000

/** The most messages a page or the console lists, newest kept. */
export const QUOTE_MESSAGES_SHOWN = 50

/** One message in a quote's conversation, as stored. */
export interface QuoteMessage {
  direction: 'out' | 'in'
  body: string
  atMs: number
  /** The revision the quote was on when it was said. */
  revision: number
  /** With `out`: who on the team sent it, an email else a uid. */
  by?: string
  /** With `out`: the address it went to. */
  to?: string
  /** With `out`: the `Message-ID` it was sent with, and the provider's own id. */
  messageId?: string
  providerId?: string | null
  /** With `in`: the name on the quote when the customer wrote. */
  name?: string
  /** With `in`: the address and browser it came from, kept as the record. */
  ip?: string | null
  userAgent?: string | null
}

/** A message as typed, trimmed, or what to fix. */
export function parseQuoteMessageBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : ''
  if (!body) return { ok: false, error: 'Write a message first.' }
  if (body.length > QUOTE_MESSAGE_MAX) return { ok: false, error: `A message holds up to ${QUOTE_MESSAGE_MAX.toLocaleString('en-US')} characters.` }
  return { ok: true, body }
}

/** Who a reply from the quote goes to: the customer's email, else where the quote was last emailed. */
export function quoteReplyRecipient(order: Pick<HostOrder, 'quote'> | null | undefined): string {
  return quoteSendPrefill(order)
}

export type QuoteReplyRefusal = 'not-a-quote' | 'no-address' | 'bad-address'

/** Why the business cannot reply to the quote's customer now, if it cannot. A paid quote still takes replies. */
export function quoteReplyRefusal(order: Pick<HostOrder, 'channel' | 'quote'> | null | undefined): QuoteReplyRefusal | null {
  if (!order || !isQuote(order) || !order.quote) return 'not-a-quote'
  const to = quoteReplyRecipient(order)
  if (!to) return 'no-address'
  if (to.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'bad-address'
  return null
}

export function quoteReplyRefusalMessage(reason: QuoteReplyRefusal): string {
  switch (reason) {
    case 'not-a-quote':
      return 'Unknown quote'
    case 'no-address':
      return 'This quote has no customer email, so there is nobody to reply to. Add their email to the quote first.'
    case 'bad-address':
      return 'The customer email on this quote isn’t a valid address. Fix it on the quote first.'
  }
}

/**
 * The quote after a reply went out: the conversation moved on to it, so the
 * next email answers it, and the timeline says who wrote to whom. Nothing the
 * customer sees changes, so the quote's edit stamp stays.
 */
export function quoteAfterReply(
  order: HostOrder,
  sent: { to: string; by: string; atMs: number },
  thread: QuoteEmailThread,
): HostOrder {
  return {
    ...order,
    timeline: appendOrderEvent(order, 'quote-message-sent', `Reply emailed to ${sent.to} by ${sent.by}`, sent.atMs),
    quote: { ...(order.quote as OrderQuote), emailThread: thread },
  }
}

/** A message as the customer's page shows it: who said it and what, never an address, browser or team member. */
export interface QuotePageMessage {
  id: string
  from: 'business' | 'customer'
  body: string
  atMs: number
}

/** The stored messages, oldest first, as the page may show them. */
export function quotePageMessages(entries: ReadonlyArray<{ id: string; data: Partial<QuoteMessage> | undefined }>): QuotePageMessage[] {
  return entries
    .filter((entry) => typeof entry.data?.body === 'string' && (entry.data.direction === 'out' || entry.data.direction === 'in'))
    .map((entry) => ({
      id: entry.id,
      from: entry.data?.direction === 'out' ? ('business' as const) : ('customer' as const),
      body: String(entry.data?.body),
      atMs: Number(entry.data?.atMs) || 0,
    }))
    .sort((a, b) => a.atMs - b.atMs)
}

/** A message as the console lists it. */
export interface QuoteConsoleMessage {
  id: string
  direction: 'out' | 'in'
  body: string
  atMs: number
  /** `to jordan@example.com by sam@shop.test`, or `Jordan Lee wrote on the quote page`. */
  label: string
}

/** The stored messages, oldest first, as the team reads them. */
export function quoteConsoleMessages(entries: ReadonlyArray<{ id: string; data: Partial<QuoteMessage> | undefined }>): QuoteConsoleMessage[] {
  return entries
    .filter((entry) => typeof entry.data?.body === 'string' && (entry.data.direction === 'out' || entry.data.direction === 'in'))
    .map((entry) => {
      const data = entry.data as QuoteMessage
      const label =
        data.direction === 'out'
          ? `Sent to ${data.to || 'the customer'}${data.by ? ` by ${data.by}` : ''}`
          : `${data.name || 'The customer'} wrote on the quote page`
      return { id: entry.id, direction: data.direction, body: data.body, atMs: Number(data.atMs) || 0, label }
    })
    .sort((a, b) => a.atMs - b.atMs)
}

/** The reply email's words (the `quote-message` catalog email), and its plain-text twin. */
export function quoteMessageEmailTokens(input: {
  order: HostOrder
  quoteId: string
  businessName: string
  subject: string
  body: string
  url: string
}): { tokens: Record<string, string>; text: string } {
  const quote = (input.order.quote ?? {}) as OrderQuote
  const proofOnly = quoteIsProofOnly(input.order)
  const label = proofOnly ? 'Proof' : 'Quote'
  const noun = proofOnly ? 'proof' : 'quote'
  const number = formatQuoteNumber(input.order, input.quoteId).replace(/^Quote\s+/, '')
  const business = input.businessName.trim() || 'the business'
  const heading = `A message about your ${noun}`
  const tokens: Record<string, string> = {
    'message.subject': input.subject,
    'quote.label': label,
    'quote.number': number,
    'quote.revision': String(Math.max(1, Number(quote.revision ?? 1) || 1)),
    'message.heading': heading,
    'message.body': input.body,
    'message.buttonLabel': `View your ${noun}`,
    'quote.url': input.url,
  }
  const text = [
    heading,
    input.body,
    `${label}: ${number}`,
    `View your ${noun}: ${input.url}`,
    `Reply to this email to reach ${business}, or answer on your ${noun} page.`,
  ].join('\n\n')
  return { tokens, text }
}
