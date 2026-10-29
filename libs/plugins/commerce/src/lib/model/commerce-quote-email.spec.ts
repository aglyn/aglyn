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
  QUOTE_MAX_SENDS,
  parseQuoteSendInput,
  quoteAfterSend,
  quoteEmailDefaultSubject,
  quoteSendIsNewRevision,
  quoteSendLabel,
  quoteSendPrefill,
  quoteSendRecipient,
  quoteSendRefusal,
  quoteSendReplacesLink,
} from './commerce-quote-email'
import type { OrderQuote, QuoteSendRecord } from './commerce-quotes'

/** Emailing a quote (AGL-4097): the pure answers the Send button and the route share. */

const record = (revision: number, linkVersion: number, atMs = revision): QuoteSendRecord => ({
  revision,
  to: 'jane@example.com',
  subject: 'Quote #1042 from Acme',
  atMs,
  by: 'owner@example.com',
  messageId: `<q.${atMs}.a@acme.test>`,
  providerId: null,
  linkVersion,
})

const quote = (over: Partial<OrderQuote> = {}): OrderQuote =>
  ({
    stage: 'draft',
    revision: 1,
    customer: { email: 'jane@example.com' },
    tax: { kind: 'none' },
    createdAtMs: 1,
    updatedAtMs: 1,
    createdBy: 'a',
    updatedBy: 'a',
    ...over,
  }) as OrderQuote

const order = (over: Partial<OrderQuote> = {}, status = 'pending'): HostOrder =>
  ({ number: 1042, status, channel: 'quote', lineItems: [], quote: quote(over) }) as unknown as HostOrder

describe('when a send replaces the pay link', () => {
  it('never on the first email, nor on a resend of the same revision', () => {
    expect(quoteSendReplacesLink(quote())).toBe(false)
    expect(quoteSendReplacesLink(quote({ sends: [record(1, 1)] }))).toBe(false)
  })

  it('on a new revision’s first email, when the link is still the one the customer was sent', () => {
    expect(quoteSendReplacesLink(quote({ revision: 2, sends: [record(1, 1)] }))).toBe(true)
    expect(quoteSendReplacesLink(quote({ revision: 3, linkVersion: 2, sends: [record(1, 1), record(2, 2)] }))).toBe(true)
  })

  it('not again once it was replaced since that email, by hand or by a send that then failed', () => {
    expect(quoteSendReplacesLink(quote({ revision: 2, linkVersion: 2, sends: [record(1, 1)] }))).toBe(false)
  })
})

describe('when a send hands the customer an updated quote', () => {
  it('only on a new revision’s first email, after an earlier revision was emailed', () => {
    expect(quoteSendIsNewRevision(quote({ revision: 2, sends: [record(1, 1)] }))).toBe(true)
    expect(quoteSendIsNewRevision(quote({ revision: 4, sends: [record(3, 1)] }))).toBe(true)
  })

  it('never on the quote’s first email, whatever revision it is at, nor on a resend of the same revision', () => {
    expect(quoteSendIsNewRevision(quote())).toBe(false)
    expect(quoteSendIsNewRevision(quote({ revision: 3 }))).toBe(false)
    expect(quoteSendIsNewRevision(quote({ revision: 3, sends: [record(3, 1)] }))).toBe(false)
    expect(quoteSendIsNewRevision(quote({ revision: 2, sends: [record(1, 1), record(2, 2)] }))).toBe(false)
  })
})

describe('the Send button and the form', () => {
  it('says Send quote, Send again or Send revision N', () => {
    expect(quoteSendLabel(quote())).toBe('Send quote')
    expect(quoteSendLabel(quote({ sends: [record(1, 1)] }))).toBe('Send again')
    expect(quoteSendLabel(quote({ revision: 2, sends: [record(1, 1)] }))).toBe('Send revision 2')
  })

  it('defaults the subject to the conversation’s, else Quote #N from the business', () => {
    expect(quoteEmailDefaultSubject(order(), 'Acme Signs')).toBe('Quote #1042 from Acme Signs')
    expect(quoteEmailDefaultSubject(order(), '')).toBe('Quote #1042')
    expect(
      quoteEmailDefaultSubject(order({ emailThread: { messageId: '<a@b.co>', references: ['<a@b.co>'], subject: 'Your request' } }), 'Acme'),
    ).toBe('Your request')
  })

  it('sends to what was typed, else the customer’s email', () => {
    expect(quoteSendRecipient(order(), ' buyer@example.org ')).toBe('buyer@example.org')
    expect(quoteSendRecipient(order(), '')).toBe('jane@example.com')
  })

  it('starts the form addressed to the customer’s email, else where the quote was last emailed', () => {
    expect(quoteSendPrefill(order({ sends: [{ ...record(1, 1), to: 'buyer@example.org' }] }))).toBe('jane@example.com')
    expect(
      quoteSendPrefill(
        order({ customer: { email: '' }, sends: [record(1, 1), { ...record(1, 1, 2), to: 'buyer@example.org' }] }),
      ),
    ).toBe('buyer@example.org')
    expect(quoteSendPrefill(order({ customer: { email: '' } }))).toBe('')
  })

  it('refuses a paid quote, an order, nowhere to send and a bad address', () => {
    expect(quoteSendRefusal(order(), 'jane@example.com')).toBeNull()
    expect(quoteSendRefusal(order({}, 'paid'), 'jane@example.com')).toBe('paid')
    expect(quoteSendRefusal({ channel: 'draft', status: 'pending' } as HostOrder, 'jane@example.com')).toBe('not-a-quote')
    expect(quoteSendRefusal(order(), '')).toBe('no-address')
    expect(quoteSendRefusal(order(), 'jane@')).toBe('bad-address')
  })

  it('keeps the subject to one line, and refuses what is too long', () => {
    expect(parseQuoteSendInput({ to: ' a@b.co ', subject: 'Line one\r\nBcc: x', message: ' Hi\r\nthere ' })).toEqual({
      ok: true,
      input: { to: 'a@b.co', subject: 'Line one Bcc: x', message: 'Hi\nthere' },
    })
    expect(parseQuoteSendInput({ subject: 'x'.repeat(201) }).ok).toBe(false)
    expect(parseQuoteSendInput({ message: 'x'.repeat(5_001) }).ok).toBe(false)
  })
})

describe('the quote once it was emailed', () => {
  const thread = { messageId: '<q.9.a@acme.test>', references: ['<q.9.a@acme.test>'], subject: 'Quote #1042 from Acme' }

  it('is Sent, with the send on record and the conversation moved on', () => {
    const after = quoteAfterSend(order(), record(1, 1, 9), thread)
    expect(after.quote?.stage).toBe('sent')
    expect(after.quote?.sends).toEqual([record(1, 1, 9)])
    expect(after.quote?.emailThread).toEqual(thread)
    expect(after.timeline?.at(-1)).toEqual({
      atMs: 9,
      event: 'quote-sent',
      detail: 'Revision 1 emailed to jane@example.com by owner@example.com',
    })
  })

  it('stays where the customer put an answered revision, and keeps the latest sends', () => {
    const answered = order({
      stage: 'changes_requested',
      responses: [{ action: 'changes', revision: 1, atMs: 2, comment: 'Bigger', ip: null, userAgent: null }],
      sends: Array.from({ length: QUOTE_MAX_SENDS }, (_, index) => record(1, 1, index)),
    })
    const after = quoteAfterSend(answered, record(1, 1, 999), thread)
    expect(after.quote?.stage).toBe('changes_requested')
    expect(after.quote?.sends).toHaveLength(QUOTE_MAX_SENDS)
    expect(after.quote?.sends?.at(-1)?.atMs).toBe(999)
  })
})
