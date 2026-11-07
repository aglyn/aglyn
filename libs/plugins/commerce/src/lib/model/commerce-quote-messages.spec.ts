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

import type { HostOrder } from './commerce-orders'
import {
  parseQuoteMessageBody,
  quoteAfterReply,
  quoteConsoleMessages,
  quoteMessageEmailTokens,
  quotePageMessages,
  quoteReplyRecipient,
  quoteReplyRefusal,
  quoteReplyRefusalMessage,
  QUOTE_MESSAGE_MAX,
  type QuoteMessage,
} from './commerce-quote-messages'
import type { OrderQuote } from './commerce-quotes'

/** A quote's conversation with its customer (AGL-4207), pure. */

function order(section: Partial<OrderQuote> = {}, overrides: Partial<HostOrder> = {}): HostOrder {
  return {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [{ productId: '', custom: true, name: 'Banner', productType: 'physical', quantity: 1, unitAmountCents: 40_000 }],
    timeline: [],
    quote: {
      stage: 'sent',
      revision: 2,
      customer: { name: 'Jordan Lee', email: 'jordan@example.com' },
      tax: { kind: 'none', reason: 'not-collected' },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  } as HostOrder
}

const OUT: QuoteMessage = {
  direction: 'out',
  body: 'The new proof is on its way.',
  atMs: 3_000,
  revision: 1,
  by: 'sam@shop.test',
  to: 'jordan@example.com',
  messageId: '<a@b.test>',
  providerId: 'p-1',
}
const IN: QuoteMessage = { direction: 'in', body: 'Can the logo be bigger?', atMs: 2_000, revision: 1, name: 'Jordan Lee', ip: '203.0.113.9', userAgent: 'UA' }

describe('what a message may say', () => {
  it('trims it and needs something in it', () => {
    expect(parseQuoteMessageBody('  Hello\r\nthere  ')).toEqual({ ok: true, body: 'Hello\nthere' })
    expect(parseQuoteMessageBody('   ')).toEqual({ ok: false, error: 'Write a message first.' })
    expect(parseQuoteMessageBody(7)).toMatchObject({ ok: false })
  })

  it('holds up to its length, and refuses more rather than cutting it', () => {
    expect(parseQuoteMessageBody('x'.repeat(QUOTE_MESSAGE_MAX))).toMatchObject({ ok: true })
    expect(parseQuoteMessageBody('x'.repeat(QUOTE_MESSAGE_MAX + 1))).toEqual({ ok: false, error: 'A message holds up to 5,000 characters.' })
  })
})

describe('who a reply goes to', () => {
  it('is the customer’s email, else where the quote was last emailed', () => {
    expect(quoteReplyRecipient(order())).toBe('jordan@example.com')
    const sentOnly = order({
      customer: { name: 'Jordan Lee' },
      sends: [{ revision: 1, to: 'j.lee@example.com', subject: 's', atMs: 1, by: 'a', messageId: '<m@x.test>', providerId: null, linkVersion: 1 }],
    })
    expect(quoteReplyRecipient(sentOnly)).toBe('j.lee@example.com')
  })

  it('refuses a quote with nobody to write to, and takes a paid one', () => {
    expect(quoteReplyRefusal(order({ customer: { name: 'Walk-in' } }))).toBe('no-address')
    expect(quoteReplyRefusal(order({ customer: { email: 'not an address' } }))).toBe('bad-address')
    expect(quoteReplyRefusal(null)).toBe('not-a-quote')
    expect(quoteReplyRefusal(order({}, { status: 'paid' }))).toBeNull()
    expect(quoteReplyRefusalMessage('no-address')).toMatch(/no customer email/)
  })
})

describe('the conversation as each side reads it', () => {
  const entries = [
    { id: 'm2', data: OUT },
    { id: 'm1', data: IN },
    { id: 'junk', data: { direction: 'sideways', body: 'x' } as never },
  ]

  it('shows the customer who said what, oldest first, and never an address, browser or team member', () => {
    expect(quotePageMessages(entries)).toEqual([
      { id: 'm1', from: 'customer', body: 'Can the logo be bigger?', atMs: 2_000 },
      { id: 'm2', from: 'business', body: 'The new proof is on its way.', atMs: 3_000 },
    ])
  })

  it('shows the team who sent each reply, and to whom', () => {
    expect(quoteConsoleMessages(entries)).toEqual([
      { id: 'm1', direction: 'in', body: 'Can the logo be bigger?', atMs: 2_000, label: 'Jordan Lee wrote on the quote page' },
      { id: 'm2', direction: 'out', body: 'The new proof is on its way.', atMs: 3_000, label: 'Sent to jordan@example.com by sam@shop.test' },
    ])
  })
})

describe('the reply email', () => {
  it('names the quote and keeps the conversation’s subject, with a button back to the quote', () => {
    const { tokens, text } = quoteMessageEmailTokens({
      order: order(),
      quoteId: 'q-1',
      businessName: 'Acme Signs',
      subject: 'Quote #1042 from Acme Signs',
      body: 'We can make it bigger.',
      url: 'https://acme.test/pay-quote?q=q-1&t=1.x',
    })
    expect(tokens).toEqual({
      'message.subject': 'Quote #1042 from Acme Signs',
      'quote.label': 'Quote',
      'quote.number': '#1042',
      'quote.revision': '2',
      'message.heading': 'A message about your quote',
      'message.body': 'We can make it bigger.',
      'message.buttonLabel': 'View your quote',
      'quote.url': 'https://acme.test/pay-quote?q=q-1&t=1.x',
    })
    expect(text).toContain('Reply to this email to reach Acme Signs, or answer on your quote page.')
  })

  it('says proof for a proof with no price yet', () => {
    const { tokens } = quoteMessageEmailTokens({
      order: order({}, { lineItems: [] }),
      quoteId: 'q-1',
      businessName: 'Acme Signs',
      subject: 's',
      body: 'b',
      url: 'u',
    })
    expect(tokens['message.heading']).toBe('A message about your proof')
    expect(tokens['message.buttonLabel']).toBe('View your proof')
  })

  it('moves the quote’s conversation on to the reply, and leaves the edit stamp', () => {
    const thread = { messageId: '<r@acme.test>', references: ['<a@acme.test>', '<r@acme.test>'], subject: 'Quote #1042 from Acme Signs' }
    const next = quoteAfterReply(order(), { to: 'jordan@example.com', by: 'sam@shop.test', atMs: 9_000 }, thread)
    expect(next.quote?.emailThread).toEqual(thread)
    expect(next.quote?.updatedAtMs).toBe(2_000)
    expect(next.timeline?.at(-1)).toMatchObject({ event: 'quote-message-sent', detail: 'Reply emailed to jordan@example.com by sam@shop.test', atMs: 9_000 })
  })
})
