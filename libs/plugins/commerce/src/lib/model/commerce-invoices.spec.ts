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
  buildInvoicePageView,
  formatInvoiceNumber,
  invoiceCheckoutCharge,
  invoiceEmailDefaultSubject,
  invoiceEmailThread,
  invoiceIsPaid,
  invoicePayRefusal,
  invoicePayRefusalMessage,
  invoiceSendPatch,
  invoiceSendPrefill,
  invoiceSendRecipient,
  invoiceSendRefusal,
  invoiceSendRefusalMessage,
  invoiceTaxBasis,
  lastInvoiceSend,
  orderPaidAtMs,
  orderPayLinkKind,
} from './commerce-invoices'
import { orderPayLinkUnmatched, orderPayLinkVersion, quotePaymentDisposition } from './commerce-quote-pay'
import type { OrderInvoiceSendRecord } from './commerce-quotes'

/**
 * Invoices for orders and quotes (AGL-4099): which orders the lasting pay
 * link opens, the version it is signed for, what it charges, the page it
 * opens, and the send's refusals and record. Pure.
 */

const DRAFT: HostOrder = {
  number: 2001,
  status: 'pending',
  channel: 'draft',
  lineItems: [{ productId: 'canopy', name: 'Canopy 10x10', productType: 'physical', quantity: 2, unitAmountCents: 120_000 }],
  totals: { itemsCents: 240_000, discountCents: 24_000, shippingCents: 0, taxCents: 17_820, feeCents: 0, totalCents: 233_820 },
  taxMode: 'manual',
  customerEmail: 'jordan@example.com',
  customerName: 'Jordan Lee',
  createdAtMs: 1_000,
  draftShipping: { countries: ['US'], options: [{ rateId: 'standard', name: 'Standard', amountCents: 1_500 }] },
} as HostOrder

const QUOTE: HostOrder = {
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [{ productId: '', name: 'Banner', productType: 'physical', quantity: 1, unitAmountCents: 50_000 }],
  totals: { itemsCents: 50_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 50_000 },
  quote: {
    stage: 'sent',
    revision: 1,
    linkVersion: 3,
    customer: { name: 'Pat Lee', email: 'pat@example.com' },
    tax: { kind: 'none', reason: 'not-collected' },
    emailThread: { messageId: '<quote.1@acme.example.com>', references: ['<quote.1@acme.example.com>'], subject: 'Quote #1042 from Acme Signs' },
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    createdBy: 'owner@example.com',
    updatedBy: 'owner@example.com',
  },
} as HostOrder

const send = (overrides: Partial<OrderInvoiceSendRecord> = {}): OrderInvoiceSendRecord => ({
  to: 'jordan@example.com',
  subject: 'Invoice #2001 from Acme Signs',
  atMs: 9_000,
  by: 'owner@example.com',
  messageId: '<invoice.1@acme.example.com>',
  providerId: 'msg_1',
  paid: false,
  linkVersion: 1,
  totalCents: 233_820,
  ...overrides,
})

describe('which orders the lasting pay link opens', () => {
  it('opens a quote as a quote and a draft order as an invoice, and nothing else', () => {
    expect(orderPayLinkKind(QUOTE)).toBe('quote')
    expect(orderPayLinkKind(DRAFT)).toBe('invoice')
    expect(orderPayLinkKind({ channel: 'quote' })).toBeNull()
    for (const channel of ['online', 'pos', 'subscription', 'marketplace', undefined] as const) {
      expect(orderPayLinkKind({ channel })).toBeNull()
    }
  })

  it('names an invoice by the order’s own number, which a paid quote keeps', () => {
    expect(formatInvoiceNumber(DRAFT, 'd-1')).toBe('Invoice #2001')
    expect(formatInvoiceNumber({}, 'abcdef123456')).toBe('Invoice #123456')
  })
})

describe('the link version', () => {
  it('reads a quote’s off the quote, so every link already sent keeps verifying', () => {
    expect(orderPayLinkVersion(QUOTE)).toBe(3)
    // A quote never reads `payLink`, whatever is there.
    expect(orderPayLinkVersion({ ...QUOTE, payLink: { version: 9 } })).toBe(3)
    expect(orderPayLinkVersion({ quote: { ...QUOTE.quote, linkVersion: undefined } as never })).toBe(1)
  })

  it('reads any other order’s off payLink, absent reading as the first', () => {
    expect(orderPayLinkVersion(DRAFT)).toBe(1)
    expect(orderPayLinkVersion({ ...DRAFT, payLink: { version: 2 } })).toBe(2)
    expect(orderPayLinkVersion({ ...DRAFT, payLink: { version: 0 } })).toBe(1)
  })

  it('keeps a payment the link could not take where the version is', () => {
    const entry = { sessionId: 'cs_2', paymentIntentId: 'pi_2', amountCents: 100, atMs: 1, reason: 'already-paid' as const }
    expect(orderPayLinkUnmatched({ ...DRAFT, payLink: { unmatchedPayments: [entry] } })).toEqual([entry])
    expect(orderPayLinkUnmatched({ ...QUOTE, quote: { ...QUOTE.quote, unmatchedPayments: [entry] } as never })).toEqual([entry])
  })

  it('tells an invoice payment for a replaced link from one for the link as it stands', () => {
    const payment = { sessionId: 'cs_1', paymentIntentId: 'pi_1', linkVersion: '1' }
    expect(quotePaymentDisposition(DRAFT, payment)).toBe('pay')
    expect(quotePaymentDisposition({ ...DRAFT, payLink: { version: 2 } }, payment)).toBe('superseded')
    expect(quotePaymentDisposition({ ...DRAFT, status: 'paid', checkoutSessionId: 'cs_0' }, payment)).toBe('already-paid')
    expect(quotePaymentDisposition({ ...DRAFT, status: 'paid', checkoutSessionId: 'cs_1' }, payment)).toBe('redelivery')
  })
})

describe('what an invoice’s link charges', () => {
  it('prices a draft from its lines, its discount, its frozen tax and the rates it was made with', () => {
    const charge = invoiceCheckoutCharge(DRAFT, 'd-1')
    expect(charge).toMatchObject({
      itemsCents: 240_000,
      discountCents: 24_000,
      goodsCents: 216_000,
      taxCents: 17_820,
      taxPct: 8.25,
      shippingCents: 0,
      totalCents: 233_820,
      shippingOptions: [{ rateId: 'standard', name: 'Standard', amountCents: 1_500 }],
      shippingCountries: ['US'],
    })
    expect(charge.lines).toEqual([expect.objectContaining({ name: 'Invoice #2001', amountCents: 216_000, taxable: true })])
  })

  it('reads the tax basis off the stored order', () => {
    expect(invoiceTaxBasis({ taxMode: 'stripe-automatic', totals: DRAFT.totals })).toEqual({ kind: 'at-payment' })
    expect(invoiceTaxBasis(DRAFT)).toEqual({ kind: 'service', taxCents: 17_820 })
    expect(invoiceTaxBasis({ taxMode: 'none', totals: { ...DRAFT.totals, taxCents: 0 } })).toEqual({ kind: 'none', reason: 'not-collected' })
  })

  it('charges a quote exactly as its own link does, with no rates to pick', () => {
    expect(invoiceCheckoutCharge(QUOTE, 'q-1')).toMatchObject({ totalCents: 50_000, shippingOptions: [], shippingCountries: [] })
    expect(invoiceCheckoutCharge(QUOTE, 'q-1').lines[0].name).toBe('Quote #1042')
  })

  it('refuses what it cannot charge', () => {
    expect(invoicePayRefusal(DRAFT, 'd-1')).toBeNull()
    expect(invoicePayRefusal({ ...DRAFT, draftShipping: undefined }, 'd-1')).toBe('shipping-unknown')
    // A draft of a service made before drafts kept their rates ships nothing, so it can be paid.
    expect(
      invoicePayRefusal({ ...DRAFT, draftShipping: undefined, lineItems: [{ ...DRAFT.lineItems[0], productType: 'service' }] }, 'd-1'),
    ).toBeNull()
    expect(invoicePayRefusal({ ...DRAFT, status: 'paid' }, 'd-1')).toBe('paid')
    expect(invoicePayRefusal({ ...DRAFT, status: 'refunded' }, 'd-1')).toBe('closed')
    expect(invoicePayRefusal({ ...DRAFT, channel: 'pos' }, 'd-1')).toBe('not-payable')
    expect(
      invoicePayRefusal({ ...DRAFT, lineItems: [{ ...DRAFT.lineItems[0], quantity: 1, unitAmountCents: 30 }], totals: { ...DRAFT.totals, discountCents: 0, taxCents: 0 } }, 'd-1'),
    ).toBe('nothing-to-pay')
  })

  it('tells the customer in the page’s own word', () => {
    expect(invoicePayRefusalMessage('paid', 'Acme Signs', 'invoice')).toBe('This invoice has been paid.')
    expect(invoicePayRefusalMessage('paid', 'Acme Signs', 'quote')).toBe('This quote has been paid.')
    expect(invoicePayRefusalMessage('shipping-unknown', 'Acme Signs', 'invoice')).toBe(
      'This invoice can’t be paid online. Contact Acme Signs to pay it.',
    )
  })
})

describe('the invoice’s page', () => {
  it('is "Invoice #N" with no proofs or approval, the shipping picked when the customer pays', () => {
    const view = buildInvoicePageView({ order: DRAFT, orderId: 'd-1', storeName: 'Acme Signs', currency: 'USD' })
    expect(view).toMatchObject({
      kind: 'invoice',
      number: 'Invoice #2001',
      customerName: 'Jordan Lee',
      status: 'unpaid',
      payable: true,
      shippingAtPayment: true,
      approvalRequired: false,
      respondable: false,
      proofs: [],
      notes: null,
      terms: null,
      totals: { itemsCents: 240_000, discountCents: 24_000, taxCents: 17_820, totalCents: 233_820 },
    })
    expect(JSON.stringify(view)).not.toContain('jordan@example.com')
  })

  it('shows a paid one’s stored totals and when it was paid', () => {
    const view = buildInvoicePageView({
      order: { ...DRAFT, status: 'paid', totals: { ...DRAFT.totals, shippingCents: 1_500, totalCents: 235_320 }, timeline: [{ atMs: 7_000, event: 'paid' }] },
      orderId: 'd-1',
      storeName: 'Acme Signs',
      currency: 'USD',
      receiptUrl: 'https://acme.example.com/order-status?o=d-1&t=x',
    })
    expect(view).toMatchObject({ status: 'paid', paidAtMs: 7_000, payable: false, shippingAtPayment: false, receiptUrl: 'https://acme.example.com/order-status?o=d-1&t=x' })
    expect(view.totals.totalCents).toBe(235_320)
  })
})

describe('sending an invoice', () => {
  it('goes to what was typed, else the order’s customer, else a quote’s', () => {
    expect(invoiceSendRecipient(DRAFT, ' other@example.com ')).toBe('other@example.com')
    expect(invoiceSendRecipient(DRAFT, '')).toBe('jordan@example.com')
    expect(invoiceSendRecipient(QUOTE, '')).toBe('pat@example.com')
  })

  it('starts the form addressed to the customer, else where the last invoice went, else where the quote went', () => {
    expect(invoiceSendPrefill(DRAFT)).toBe('jordan@example.com')
    const sent = (to: string, atMs: number): OrderInvoiceSendRecord => ({
      to,
      subject: 'Invoice #2001',
      atMs,
      by: 'owner@example.com',
      messageId: `<i.${atMs}@acme.example.com>`,
      providerId: null,
      paid: false,
      linkVersion: 1,
      totalCents: 233_820,
    })
    const unnamed = { ...DRAFT, customerEmail: '', invoiceSends: [sent('old@example.com', 1), sent('billing@example.com', 2)] }
    expect(invoiceSendPrefill(unnamed)).toBe('billing@example.com')
    const quoted = {
      ...QUOTE,
      quote: {
        ...QUOTE.quote,
        customer: { name: 'Pat Lee', email: '' },
        sends: [{ revision: 1, to: 'pat.work@example.com', subject: 's', atMs: 1, by: 'o', messageId: '<q@a>', providerId: null, linkVersion: 3 }],
      },
    } as HostOrder
    expect(invoiceSendPrefill(quoted)).toBe('pat.work@example.com')
    expect(invoiceSendPrefill({ ...DRAFT, customerEmail: '' })).toBe('')
  })

  it('replies into the quote’s conversation for a quote, and the order’s own otherwise', () => {
    expect(invoiceEmailThread(QUOTE)?.messageId).toBe('<quote.1@acme.example.com>')
    expect(invoiceEmailThread(DRAFT)).toBeNull()
    expect(invoiceEmailDefaultSubject(QUOTE, 'Acme Signs', 'q-1')).toBe('Quote #1042 from Acme Signs')
    expect(invoiceEmailDefaultSubject(DRAFT, 'Acme Signs', 'd-1')).toBe('Invoice #2001 from Acme Signs')
    const threaded = { ...DRAFT, emailThread: { messageId: '<invoice.1@acme.example.com>', references: [], subject: 'Your invoice' } }
    expect(invoiceEmailDefaultSubject(threaded, 'Acme Signs', 'd-1')).toBe('Your invoice')
  })

  it('refuses with a plain reason', () => {
    const refusal = (order: HostOrder | null, to = 'jordan@example.com') => invoiceSendRefusal(order, 'd-1', to)
    expect(refusal(DRAFT)).toBeNull()
    expect(refusal({ ...DRAFT, status: 'paid' })).toBeNull()
    expect(refusal({ ...DRAFT, status: 'fulfilled', channel: 'online' })).toBeNull()
    expect(refusal(null)).toBe('unknown')
    expect(refusal({ ...DRAFT, status: 'cancelled' })).toBe('closed')
    expect(refusal({ ...DRAFT, status: 'refunded' })).toBe('closed')
    expect(refusal({ ...DRAFT, status: 'paid', lineItems: [], totals: { ...DRAFT.totals, totalCents: 0 } })).toBe('empty')
    expect(refusal({ ...DRAFT, channel: 'pos' })).toBe('not-payable')
    expect(refusal({ ...DRAFT, draftShipping: undefined })).toBe('shipping-unknown')
    expect(refusal(DRAFT, '')).toBe('no-address')
    expect(refusal(DRAFT, 'not-an-address')).toBe('bad-address')
    expect(
      refusal({
        ...QUOTE,
        quote: { ...QUOTE.quote, requireProofApproval: true, revision: 1, proofs: [{ id: 'p1', revision: 1 }] } as never,
      }),
    ).toBe('approval-required')
    // A paid quote is invoiced as the record whatever its approval said.
    expect(refusal({ ...QUOTE, status: 'paid', quote: { ...QUOTE.quote, requireProofApproval: true } as never })).toBeNull()
    for (const reason of ['closed', 'empty', 'not-payable', 'shipping-unknown', 'no-address'] as const) {
      expect(invoiceSendRefusalMessage(reason)).toMatch(/\.$/)
    }
  })

  it('records the send, the timeline line (without the address) and the conversation where it belongs', () => {
    const thread = { messageId: '<invoice.1@acme.example.com>', references: ['<invoice.1@acme.example.com>'], subject: 'Invoice #2001 from Acme Signs' }
    const patch = invoiceSendPatch(DRAFT, send(), thread)
    expect(patch.invoiceSends).toEqual([send()])
    expect(patch.emailThread).toEqual(thread)
    expect(patch.quote).toBeUndefined()
    expect(patch.timeline.at(-1)).toEqual({ atMs: 9_000, event: 'invoice-sent', detail: 'Invoice emailed to the customer by owner@example.com' })
    const quotePatch = invoiceSendPatch(QUOTE, send({ paid: true, linkVersion: null }), thread)
    expect(quotePatch.quote).toEqual({ emailThread: thread })
    expect(quotePatch.emailThread).toBeUndefined()
    expect(quotePatch.timeline.at(-1)?.detail).toBe('Paid invoice emailed to the customer by owner@example.com')
    expect(lastInvoiceSend({ invoiceSends: [send({ atMs: 1 }), send({ atMs: 2 })] })?.atMs).toBe(2)
  })

  it('reads paid and when', () => {
    expect(invoiceIsPaid({ status: 'delivered' })).toBe(true)
    expect(invoiceIsPaid({ status: 'pending' })).toBe(false)
    expect(invoiceIsPaid({ status: 'refunded' })).toBe(false)
    expect(orderPaidAtMs({ ...QUOTE, status: 'paid', quote: { ...QUOTE.quote, paidAtMs: 4_000 } as never })).toBe(4_000)
    expect(orderPaidAtMs({ ...DRAFT, status: 'paid', timeline: [{ atMs: 6_000, event: 'paid' }] })).toBe(6_000)
    expect(orderPaidAtMs({ status: 'paid', createdAtMs: 8_000 } as never)).toBe(8_000)
    expect(orderPaidAtMs(DRAFT)).toBeNull()
  })
})
