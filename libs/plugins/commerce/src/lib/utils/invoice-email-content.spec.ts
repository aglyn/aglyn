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

import type { HostOrder } from '../model'
import { INVOICE_EMAIL_KEY, invoiceEmailContent, type InvoiceEmailContentInput } from './invoice-email-content'
import { commerceTenantEmails } from '../tenant-emails'

/**
 * What the invoice email says (AGL-4099), in its two states: unpaid, asking
 * for payment with one button to the lasting pay link; paid, the record,
 * with no button.
 */

const OCT_28 = Date.UTC(2026, 9, 28, 15)
const OCT_29 = Date.UTC(2026, 9, 29, 15)
const PAY_URL = 'https://shop.example.com/pay-quote?q=d1&t=1.abc'

const DRAFT = {
  number: 2001,
  status: 'pending',
  channel: 'draft',
  lineItems: [{ productId: 'banner', name: 'Banner', productType: 'service', quantity: 2, unitAmountCents: 62_500 }],
  totals: { itemsCents: 125_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 125_000 },
  taxMode: 'none',
  customerEmail: 'jordan@example.com',
  createdAtMs: OCT_28,
} as unknown as HostOrder

function content(over: Partial<InvoiceEmailContentInput> = {}) {
  return invoiceEmailContent({
    order: DRAFT,
    orderId: 'd1',
    businessName: 'Northwind Signs',
    currency: 'USD',
    subject: 'Invoice #2001 from Northwind Signs',
    message: '  Thanks again for your order.  ',
    payUrl: PAY_URL,
    timeZone: 'America/Chicago',
    ...over,
  })
}

describe('the invoice email, unpaid', () => {
  it('asks for payment: heading, context, message, details, next step and a Pay button to the link', () => {
    const { tokens, paid, totalCents } = content()
    expect(paid).toBe(false)
    expect(totalCents).toBe(125_000)
    expect(tokens).toEqual({
      'invoice.subject': 'Invoice #2001 from Northwind Signs',
      'invoice.number': '#2001',
      'invoice.date': 'October 28, 2026',
      'invoice.total': '$1,250.00',
      'invoice.status': 'Unpaid, $1,250.00 due',
      'invoice.heading': 'Invoice #2001 from Northwind Signs',
      'invoice.intro': 'Northwind Signs sent you an invoice for your order. The details are below, and the invoice is attached as a PDF.',
      'invoice.message': 'Thanks again for your order.',
      'invoice.nextStep': 'Use the button below to pay it securely by card. The button keeps working until the invoice is paid.',
      'invoice.buttonLabel': 'Pay $1,250.00',
      'invoice.url': PAY_URL,
    })
  })

  it('says what is added at payment: the rate a draft lets the customer pick, and Stripe Tax', () => {
    const order = {
      ...DRAFT,
      taxMode: 'stripe-automatic',
      lineItems: [{ ...DRAFT.lineItems[0], productType: 'physical' }],
      draftShipping: { countries: ['US'], options: [{ rateId: 'std', name: 'Standard', amountCents: 1_500 }] },
    } as HostOrder
    const { tokens } = content({ order })
    expect(tokens['invoice.total']).toBe('$1,250.00 before shipping and tax')
    expect(tokens['invoice.status']).toBe('Unpaid, $1,250.00 plus shipping and tax due')
    expect(tokens['invoice.buttonLabel']).toBe('Pay $1,250.00 plus shipping and tax')
    expect(tokens['invoice.nextStep']).toContain('Shipping and tax are added when you pay.')
    const shippingOnly = content({ order: { ...order, taxMode: 'none', totals: { ...DRAFT.totals, taxCents: 0 } } as HostOrder })
    expect(shippingOnly.tokens['invoice.nextStep']).toContain('Shipping is added when you pay.')
  })

  it('names a quote’s invoice as for the quote, with the quote’s date and customer’s figures', () => {
    const quote = {
      number: 1042,
      status: 'pending',
      channel: 'quote',
      lineItems: [{ productId: '', name: 'Banner', productType: 'service', quantity: 1, unitAmountCents: 40_000 }],
      totals: { itemsCents: 40_000, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 40_000 },
      quote: { stage: 'sent', revision: 1, tax: { kind: 'none' }, createdAtMs: OCT_28, updatedAtMs: OCT_29, createdBy: 'a', updatedBy: 'a' },
    } as unknown as HostOrder
    const { tokens } = content({ order: quote, orderId: 'q1' })
    expect(tokens['invoice.heading']).toBe('Invoice #1042 from Northwind Signs')
    expect(tokens['invoice.intro']).toContain('an invoice for your quote')
    expect(tokens['invoice.date']).toBe('October 29, 2026')
    expect(tokens['invoice.buttonLabel']).toBe('Pay $400.00')
  })

  it('has a plain-text twin with the same facts and the link', () => {
    const { text } = content()
    expect(text).toContain('Invoice #2001 from Northwind Signs')
    expect(text).toContain('Invoice: #2001\nDate: October 28, 2026\nTotal: $1,250.00\nStatus: Unpaid, $1,250.00 due')
    expect(text).toContain(`Pay $1,250.00: ${PAY_URL}`)
    expect(text).toContain('Reply to this email to reach Northwind Signs.')
  })
})

describe('the invoice email, paid', () => {
  const PAID = { ...DRAFT, status: 'fulfilled', timeline: [{ atMs: OCT_29, event: 'paid' }] } as HostOrder

  it('is the record: paid on its date, keep it, and no button', () => {
    const { tokens, paid, text } = content({ order: PAID, payUrl: null })
    expect(paid).toBe(true)
    expect(tokens).toMatchObject({
      'invoice.status': 'Paid on October 29, 2026',
      'invoice.total': '$1,250.00',
      'invoice.intro': 'Here is the invoice for your order with Northwind Signs, paid on October 29, 2026. It is attached as a PDF for your records.',
      'invoice.nextStep': 'This invoice is paid; keep it for your records.',
      'invoice.buttonLabel': '',
      'invoice.url': '',
    })
    expect(text).not.toContain('pay-quote')
  })

  it('never carries a pay link, even when one is handed over', () => {
    expect(content({ order: PAID }).tokens['invoice.url']).toBe('')
  })

  it('says what was refunded', () => {
    const { tokens } = content({ order: { ...PAID, refundedCents: 25_000 } as HostOrder, payUrl: null })
    expect(tokens['invoice.status']).toBe('Paid on October 29, 2026, $250.00 refunded')
  })
})

describe('the catalog entry', () => {
  it('names every token the content composes, and draws the button from them', () => {
    const entry = commerceTenantEmails().find((email) => email.key === INVOICE_EMAIL_KEY)
    expect(entry).toBeDefined()
    const declared = new Set((entry?.mergeTokens ?? []).map((token) => token.name))
    for (const token of Object.keys(content().tokens)) expect(declared).toContain(token)
    expect(entry?.defaultBody).toContainEqual({ block: 'button', label: '{{invoice.buttonLabel}}', href: '{{invoice.url}}' })
  })
})
