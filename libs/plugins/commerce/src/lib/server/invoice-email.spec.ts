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
 *
 * @jest-environment node
 */

import type { HostOrder } from '../model'
import {
  defaultInvoiceMailerDeps,
  invoiceMailer,
  type InvoiceDeliveryInput,
  type InvoiceMailerDeps,
} from './invoice-email'
import { defaultQuoteMailerDeps, quoteMailer, type QuoteMailerDeps } from './quote-email'

// The mailers' own imports, none of which these cases reach.
jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))

// The lazily loaded PDF module: the sends load it only to make the files.
const mockInvoicePdfFile = jest.fn()
const mockQuotePdfFile = jest.fn()
jest.mock('./commerce-pdf', () => ({
  orderInvoicePdfFile: (...args: unknown[]) => mockInvoicePdfFile(...args),
  quotePdfFile: (...args: unknown[]) => mockQuotePdfFile(...args),
}))

/**
 * The invoice email's send (AGL-4099): the invoice PDF from the lazy module
 * (with the pay link only while unpaid), the catalog key, who a reply
 * reaches, and the conversation: a quote's invoice replies into the quote's
 * emails, and any other order's starts its own and continues it.
 */

const DRAFT = {
  number: 2001,
  status: 'pending',
  channel: 'draft',
  lineItems: [{ productId: 'canopy', name: 'Canopy', productType: 'service', quantity: 1, unitAmountCents: 50_000 }],
  totals: { itemsCents: 50_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 50_000 },
  taxMode: 'none',
  customerEmail: 'jane@example.com',
  createdAtMs: Date.UTC(2026, 9, 28, 15),
} as unknown as HostOrder

const QUOTE = {
  number: 1042,
  status: 'pending',
  channel: 'quote',
  lineItems: [{ productId: '', name: 'Banner', productType: 'physical', quantity: 1, unitAmountCents: 5_000 }],
  totals: { itemsCents: 5_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 5_000 },
  quote: {
    stage: 'draft',
    revision: 1,
    customer: { email: 'jane@example.com' },
    tax: { kind: 'none' },
    createdAtMs: 1,
    updatedAtMs: 1,
    createdBy: 'a',
    updatedBy: 'a',
  },
} as unknown as HostOrder

const sent: Array<Parameters<InvoiceMailerDeps['send']>[0]> = []
const metered: string[] = []
const rendered: Array<{ key: string; tokens: Record<string, string> }> = []

const identity = async () =>
  ({ from: 'Northwind Signs <hello@mail.northwind.test>', source: 'site', domain: 'mail.northwind.test', summary: '', refusal: null }) as never

const send = async (options: Parameters<InvoiceMailerDeps['send']>[0]) => {
  sent.push(options)
  return { sent: true as const, id: `re_${sent.length}` }
}

function deps(over: Partial<InvoiceMailerDeps> = {}): InvoiceMailerDeps {
  return {
    ...defaultInvoiceMailerDeps(),
    configured: () => true,
    sendingIdentity: identity,
    render: async (_hostId, key, tokens) => {
      rendered.push({ key, tokens })
      return { subject: tokens['invoice.subject'], html: `<p>${key}</p>`, text: tokens['invoice.heading'] }
    },
    send,
    meter: async (hostId) => void metered.push(hostId),
    suppression: async () => null,
    ...over,
  }
}

function quoteDeps(): QuoteMailerDeps {
  return {
    ...defaultQuoteMailerDeps(),
    configured: () => true,
    sendingIdentity: identity,
    render: async () => null,
    theme: async () => null,
    send,
    meter: async () => undefined,
    suppression: async () => null,
  }
}

const PAY_URL = 'https://northwind.aglyn.app/pay-quote?q=d1&t=1.abc'

function delivery(over: Partial<InvoiceDeliveryInput> = {}): InvoiceDeliveryInput {
  return {
    hostId: 'site1',
    orderId: 'd1',
    order: DRAFT,
    host: { displayName: 'Northwind Signs', subdomain: 'northwind', business: { supportEmail: 'help@northwind.test' } },
    store: { currency: 'USD' },
    owner: null,
    to: 'jane@example.com',
    subject: '',
    message: 'Thanks for the order.',
    payUrl: PAY_URL,
    senderEmail: 'owner@example.com',
    atMs: 1_000,
    ...over,
  }
}

beforeEach(() => {
  sent.length = 0
  metered.length = 0
  rendered.length = 0
  mockInvoicePdfFile.mockReset()
  mockInvoicePdfFile.mockImplementation(async () => ({ bytes: new Uint8Array([37, 80, 68, 70, 45]), filename: 'northwind-signs-invoice-2001.pdf' }))
  mockQuotePdfFile.mockReset()
  mockQuotePdfFile.mockImplementation(async () => ({ bytes: new Uint8Array([37, 80, 68, 70, 45]), filename: 'northwind-signs-quote-1042.pdf' }))
})

describe('the invoice email’s send (AGL-4099)', () => {
  it('sends the order-invoice email with the invoice PDF, made with the pay link while unpaid', async () => {
    const outcome = await invoiceMailer(deps()).deliver(delivery())
    expect(outcome).toMatchObject({ sent: true, providerId: 're_1', subject: 'Invoice #2001 from Northwind Signs', paid: false, totalCents: 50_000 })
    expect(rendered.map((entry) => entry.key)).toEqual(['order-invoice'])
    expect(rendered[0].tokens).toMatchObject({ 'invoice.url': PAY_URL, 'invoice.buttonLabel': 'Pay $500.00' })
    expect(mockInvoicePdfFile.mock.calls[0][0]).toMatchObject({ hostId: 'site1', orderId: 'd1', payUrl: PAY_URL })
    expect(sent[0]).toMatchObject({
      to: 'jane@example.com',
      replyTo: 'help@northwind.test',
      audience: 'tenant',
      context: 'invoice',
      html: '<p>order-invoice</p>',
      attachments: [{ filename: 'northwind-signs-invoice-2001.pdf', contentType: 'application/pdf', content: 'JVBERi0=' }],
    })
    expect(metered).toEqual(['site1'])
  })

  it('makes a paid invoice the record: no link on the PDF and no button', async () => {
    const paid = { ...DRAFT, status: 'paid', timeline: [{ atMs: Date.UTC(2026, 9, 29, 15), event: 'paid' }] } as HostOrder
    const outcome = await invoiceMailer(deps()).deliver(delivery({ order: paid, payUrl: null }))
    expect(outcome).toMatchObject({ sent: true, paid: true })
    expect(mockInvoicePdfFile.mock.calls[0][0].payUrl).toBeNull()
    expect(rendered[0].tokens).toMatchObject({ 'invoice.url': '', 'invoice.buttonLabel': '', 'invoice.status': 'Paid on October 29, 2026' })
  })

  it('sends nothing when the PDF cannot be made, since the email says it is attached', async () => {
    mockInvoicePdfFile.mockRejectedValueOnce(new Error('sharp'))
    const outcome = await invoiceMailer(deps()).deliver(delivery())
    expect(outcome).toEqual({ sent: false, status: 500, error: 'The invoice’s PDF could not be made, so nothing was sent. Try again.' })
    expect(sent).toEqual([])
    expect(metered).toEqual([])
  })

  it('starts an order’s own conversation with the first invoice, and continues it with the next', async () => {
    const mailer = invoiceMailer(deps())
    const first = await mailer.deliver(delivery())
    if (!('thread' in first)) throw new Error('not sent')
    expect(first.messageId).toMatch(/^<invoice\.[a-z0-9]+\.[a-z0-9]+@mail\.northwind\.test>$/)
    const root = `<thread.${first.messageId.slice(1)}`
    expect(sent[0].headers).toEqual({ 'Message-ID': first.messageId, References: root })
    const order = { ...DRAFT, emailThread: first.thread } as HostOrder
    const second = await mailer.deliver(delivery({ order }))
    if (!('thread' in second)) throw new Error('not sent')
    expect(sent[1].headers).toEqual({
      'Message-ID': second.messageId,
      'In-Reply-To': first.messageId,
      References: `${root} ${first.messageId}`,
    })
    expect(sent[1].subject).toBe('Invoice #2001 from Northwind Signs')
    expect(second.thread.references).toEqual([root, first.messageId, second.messageId])
  })

  it('replies into a quote’s conversation: the quote email, then its invoice, one thread', async () => {
    const quoteSend = await quoteMailer(quoteDeps()).deliver({
      hostId: 'site1',
      quoteId: 'q1',
      order: QUOTE,
      host: { displayName: 'Northwind Signs', subdomain: 'northwind' },
      store: { currency: 'USD' },
      owner: null,
      to: 'jane@example.com',
      subject: '',
      message: '',
      payUrl: 'https://northwind.aglyn.app/pay-quote?q=q1&t=1.abc',
      proofUrl: () => null,
      linkReplaced: false,
      senderEmail: null,
      atMs: 1_000,
    })
    if (!('thread' in quoteSend)) throw new Error('not sent')
    const quoted = { ...QUOTE, quote: { ...QUOTE.quote, emailThread: quoteSend.thread } } as HostOrder
    const invoice = await invoiceMailer(deps()).deliver(delivery({ orderId: 'q1', order: quoted }))
    if (!('thread' in invoice)) throw new Error('not sent')
    // The root the quote email started the conversation under, then the chain.
    const root = `<thread.${quoteSend.messageId.slice(1)}`
    expect(sent[0].headers).toEqual({ 'Message-ID': quoteSend.messageId, References: root })
    expect(sent[1].headers).toEqual({
      'Message-ID': invoice.messageId,
      'In-Reply-To': quoteSend.messageId,
      References: `${root} ${quoteSend.messageId}`,
    })
    // The conversation's subject, so every mailbox keeps it one conversation.
    expect(sent[1].subject).toBe('Quote #1042 from Northwind Signs')
    expect(invoice.thread).toEqual({
      messageId: invoice.messageId,
      references: [root, quoteSend.messageId, invoice.messageId],
      subject: 'Quote #1042 from Northwind Signs',
    })
    // The invoice still says what it is.
    expect(rendered[0].tokens['invoice.heading']).toBe('Invoice #1042 from Northwind Signs')
  })

  it.each([
    [{ sent: false, reason: 'unconfigured' }, 503],
    [{ sent: false, reason: 'rate-limited', retryAtMs: 1 }, 429],
    [{ sent: false, reason: 'suppressed' }, 409],
    [{ sent: false, reason: 'undeliverable' }, 409],
    [{ sent: false, reason: 'unverified-domain' }, 409],
    [{ sent: false, reason: 'suspended' }, 423],
    [{ sent: false, reason: 'held-for-review', detail: 'Reference HS-1.' }, 409],
    [{ sent: false, reason: 'rejected', status: 422 }, 502],
  ])('a refused send (%o) is answered in words, and is not metered', async (answer, status) => {
    const outcome = await invoiceMailer(deps({ send: async () => answer as never })).deliver(delivery())
    expect(outcome).toMatchObject({ sent: false, status })
    expect(String((outcome as { error: string }).error)).toMatch(/invoice|email|Too many/)
    expect(metered).toEqual([])
  })
})
