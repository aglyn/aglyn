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

import { buildEmailPalette } from '@aglyn/shared-util-email'
import { readJpeg } from '@aglyn/shared-util-tools/pdf/pdf-file'
import { pdfRgbFromHex } from '@aglyn/shared-util-tools/pdf/pdf-writer'
import { buildQuotePageView } from '../model/commerce-quote-pay'
import type { HostOrder } from '../model/commerce-orders'
import {
  COMMERCE_PDF_NEUTRAL_COLORS,
  commercePdfColorsFromPalette,
  formatPdfDate,
  renderOrderInvoicePdf,
  renderQuotePdf,
  type CommercePdfBrand,
} from './commerce-document-pdf'

/**
 * The branded quote and invoice PDFs (AGL-4095): what each says, in which
 * colors, and that the file is one a reader opens. Read from the bytes the
 * renderers make, the way a PDF reader reads them.
 */

const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/** Every content stream's operators, joined. */
const contents = (pdf: string) =>
  [...pdf.matchAll(/<< \/Length \d+ >>\nstream\n([^]*?)\nendstream/g)].map((match) => match[1]).join('\n')

/** The strings drawn, in order, with their escapes undone. */
const drawn = (pdf: string) =>
  [...contents(pdf).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => match[1].replace(/\\([()\\])/g, '$1'))

function expectWellFormed(pdf: string) {
  expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
  expect(pdf.endsWith('%%EOF\n')).toBe(true)
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1])
  expect(pdf.slice(startxref, startxref + 4)).toBe('xref')
  const offsets = pdf
    .slice(startxref)
    .split('\n')
    .filter((line) => /^\d{10} 00000 n $/.test(line))
    .map((line) => Number(line.slice(0, 10)))
  offsets.forEach((offset, index) => expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true))
}

const rg = (hex: string) =>
  `${(pdfRgbFromHex(hex) ?? [0, 0, 0]).map((channel) => Math.round(channel * 100) / 100).join(' ')} rg`

/** A JPEG header with a frame, enough for the writer to place it. */
const LOGO = readJpeg(
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0xc8, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9,
  ]),
)

const GREEN = buildEmailPalette({ base: 'tenant', colors: { primary: { main: '#0b6e4f' } } })

const BRAND: CommercePdfBrand = {
  businessName: 'Acme Signs (Austin)',
  contactLines: ['1200 Congress Ave', 'Austin, TX 78701', 'hello@example.com', '(512) 555-0142', 'acme.example.com'],
  logo: LOGO,
  colors: commercePdfColorsFromPalette(GREEN),
  timeZone: 'America/Chicago',
}

/** Thursday October 29, 2026 at 03:00 UTC: still October 28 in Austin. */
const LATE = Date.UTC(2026, 9, 29, 3)

function quoteOrder(overrides: Partial<HostOrder> = {}, section: Record<string, unknown> = {}): HostOrder {
  return {
    number: 1042,
    status: 'pending',
    channel: 'quote',
    lineItems: [
      { productId: 'banner', name: 'Vinyl banner', variantLabel: '3 ft × 8 ft', sku: 'BAN-3X8', quantity: 2, unitAmountCents: 18_900, description: 'Hemmed edges.' },
      { productId: '', custom: true, name: 'Yard signs — “Grand Opening”', quantity: 25, unitAmountCents: 1_450 },
      { productId: 'proof', name: 'Design proof', quantity: 1, unitAmountCents: 0, included: true },
    ],
    totals: { itemsCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0, totalCents: 0 },
    quote: {
      stage: 'sent',
      revision: 2,
      customer: { name: 'Jordan Lee', company: 'Lee Family Bakery', email: 'jordan@example.com', phone: '+1 512 555 0100' },
      billTo: { name: 'Lee Family Bakery', line1: '88 Market St', city: 'Austin', state: 'TX', postalCode: '78702', country: 'US' },
      shipTo: { name: 'Jordan Lee', line1: '410 W 2nd St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'CA' },
      notes: 'Install on November 3.',
      terms: 'Half up front.',
      discount: { kind: 'percent', pct: 10 },
      shipping: { amountCents: 2_500 },
      tax: { kind: 'rate', pct: 8.25, label: 'Texas sales tax' },
      createdAtMs: LATE,
      updatedAtMs: LATE,
      createdBy: 'owner@example.com',
      updatedBy: 'owner@example.com',
      ...section,
    },
    ...overrides,
  } as HostOrder
}

const viewOf = (order: HostOrder) => buildQuotePageView({ order, orderId: 'q-1', storeName: BRAND.businessName, currency: 'USD' })
const PAY = 'https://acme.example.com/pay-quote?q=q-1&t=2.abc'

describe('the quote PDF', () => {
  it('is a well-formed PDF titled with the quote and the business', () => {
    const pdf = text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), revision: 2, payUrl: PAY }))
    expectWellFormed(pdf)
    expect(pdf).toContain('/Title (Quote #1042 - Acme Signs \\(Austin\\))')
    expect(pdf).not.toContain('/Producer')
  })

  it('says who it is from, what it is, when and to whom', () => {
    const strings = drawn(text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), revision: 2, payUrl: PAY })))
    for (const expected of [
      'Acme Signs (Austin)',
      '1200 Congress Ave',
      'hello@example.com',
      '(512) 555-0142',
      'QUOTE',
      'Quote #1042',
      // In the site's time zone, not the server's.
      'October 28, 2026',
      'Revision',
      '2',
      'BILL TO',
      'Jordan Lee',
      'Lee Family Bakery',
      'Austin, TX 78702',
      'SHIP TO',
      'CA',
    ]) {
      expect(strings).toContain(expected)
    }
    // A US address prints no country line, as a US envelope does.
    expect(strings).not.toContain('US')
    // The customer's email and phone stay off it, as they stay off the quote page.
    expect(strings.join(' ')).not.toContain('jordan@example.com')
    expect(strings.join(' ')).not.toContain('555 0100')
  })

  it('lists each line with its option, description, SKU, quantity and amounts, and marks what is included', () => {
    const strings = drawn(text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), revision: 2, payUrl: PAY })))
    for (const expected of ['Item', 'Qty', 'Unit price', 'Amount', 'Vinyl banner', '3 ft \\327 8 ft', 'Hemmed edges.', 'SKU BAN-3X8', '$189.00', '$378.00', 'Included']) {
      expect(strings).toContain(expected)
    }
    // Curly quotes and the dash in WinAnsi, never a broken byte.
    expect(strings).toContain('Yard signs \\227 \\223Grand Opening\\224')
  })

  it('carries the discount, shipping, tax and total the quote page shows', () => {
    const view = viewOf(quoteOrder())
    const strings = drawn(text(renderQuotePdf({ brand: BRAND, view, revision: 2, payUrl: PAY })))
    expect(view.totals).toEqual({ itemsCents: 74_050, discountCents: 7_405, shippingCents: 2_500, taxCents: 5_498, totalCents: 74_643 })
    for (const expected of ['Subtotal', '$740.50', 'Discount (10% off)', '-$74.05', 'Shipping', '$25.00', 'Texas sales tax (8.25%)', '$54.98', 'Total', '$746.43']) {
      expect(strings).toContain(expected)
    }
  })

  it('says tax is added at payment under Stripe Tax, with no figure', () => {
    const strings = drawn(
      text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder({}, { tax: { kind: 'at-payment' } })), payUrl: PAY })),
    )
    expect(strings).toContain('Tax is added at payment')
    expect(strings).toContain('Total before tax')
  })

  it('prints the pay link as a button and as text, both clickable', () => {
    const pdf = text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), revision: 2, payUrl: PAY }))
    expect(drawn(pdf)).toEqual(expect.arrayContaining(['Pay online', 'Pay this quote', PAY]))
    const links = [...pdf.matchAll(/\/Subtype \/Link [^]*?\/URI \(([^)]*)\)/g)].map((match) => match[1])
    expect(links.length).toBeGreaterThanOrEqual(2)
    expect(new Set(links)).toEqual(new Set([PAY]))
  })

  it('leaves the pay link off when the reader may not have it', () => {
    const pdf = text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), payUrl: null }))
    expect(drawn(pdf)).not.toContain('Pay online')
    expect(pdf).not.toContain('/Subtype /Link')
  })

  it('says Paid with the date once paid, and offers no pay link', () => {
    const paid = quoteOrder(
      { status: 'paid', totals: { itemsCents: 74_050, discountCents: 7_405, shippingCents: 2_500, taxCents: 5_498, feeCents: 0, totalCents: 74_643 } },
      { paidAtMs: Date.UTC(2026, 9, 30, 15) },
    )
    const pdf = text(renderQuotePdf({ brand: BRAND, view: viewOf(paid), revision: 2, payUrl: PAY }))
    expect(drawn(pdf)).toContain('Paid October 30, 2026')
    expect(drawn(pdf)).not.toContain('Pay online')
    expect(pdf).not.toContain('/Subtype /Link')
  })

  it('prints the notes and terms', () => {
    const strings = drawn(text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), payUrl: null })))
    expect(strings).toEqual(expect.arrayContaining(['Notes', 'Install on November 3.', 'Terms', 'Half up front.']))
  })

  it('wears the site’s primary color on the band and the table header, with readable text on it', () => {
    const colors = commercePdfColorsFromPalette(GREEN)
    const stream = contents(text(renderQuotePdf({ brand: BRAND, view: viewOf(quoteOrder()), payUrl: PAY })))
    expect(stream).toContain(`q ${rg(colors.accent)} 0 782 612 10 re f Q`)
    expect(stream).toContain(`BT ${rg(colors.onAccent)} /F2 8.5 Tf`)
    expect(stream).toContain('/Im1 Do')
  })

  it('picks dark text on a light primary color', () => {
    const yellow = commercePdfColorsFromPalette(buildEmailPalette({ base: 'tenant', colors: { primary: { main: '#ffd600' } } }))
    const white = commercePdfColorsFromPalette(buildEmailPalette({ base: 'tenant', colors: { primary: { main: '#0b6e4f' } } }))
    expect(yellow.onAccent).not.toBe(white.onAccent)
    expect(pdfRgbFromHex(yellow.onAccent)?.[0]).toBeLessThan(0.5)
    expect(pdfRgbFromHex(white.onAccent)?.[0]).toBeGreaterThan(0.5)
  })

  it('falls back to neutral colors, and stands without a logo', () => {
    const pdf = text(
      renderQuotePdf({ brand: { businessName: 'Plain Co', contactLines: [] }, view: viewOf(quoteOrder()), payUrl: null }),
    )
    expectWellFormed(pdf)
    expect(contents(pdf)).toContain(`q ${rg(COMMERCE_PDF_NEUTRAL_COLORS.accent)} 0 782 612 10 re f Q`)
    expect(pdf).not.toContain('/XObject')
  })

  it('runs a long quote onto more pages, header repeated and every page numbered', () => {
    const many = quoteOrder({
      lineItems: Array.from({ length: 80 }, (_, index) => ({
        productId: `p${index}`,
        name: `Line ${index + 1}`,
        quantity: 1,
        unitAmountCents: 100,
      })),
    })
    const pdf = text(renderQuotePdf({ brand: BRAND, view: viewOf(many), payUrl: PAY }))
    expectWellFormed(pdf)
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(pages).toBeGreaterThan(1)
    const strings = drawn(pdf)
    expect(strings.filter((value) => value === 'Unit price')).toHaveLength(pages)
    expect(strings).toContain(`Page ${pages} of ${pages}`)
    expect(strings).toContain('Quote #1042 (continued)')
    expect(strings).toContain('Line 80')
  })
})

describe('the invoice PDF', () => {
  const order = {
    number: 2001,
    status: 'fulfilled',
    channel: 'web',
    createdAtMs: LATE,
    customerName: 'Ada Park',
    customerEmail: 'ada@example.com',
    shippingAddress: { name: 'Ada Park', line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    lineItems: [
      { productId: 'p1', name: 'Mug', variantLabel: 'Blue', sku: 'MUG-1', quantity: 2, unitAmountCents: 1_250 },
      { productId: 'p2', name: 'Gift wrap', quantity: 1, unitAmountCents: 0, included: true },
    ],
    totals: { itemsCents: 2_500, shippingCents: 500, taxCents: 206, discountCents: 250, totalCents: 2_956, feeCents: 0, tipCents: 300 },
    refundedCents: 1_250,
  } as unknown as HostOrder
  const store = { name: 'Acme Signs (Austin)', currency: 'USD', footer: 'Thanks for shopping with us!', termsUrl: 'https://acme.example.com/terms' }

  it('is a well-formed PDF named as the order’s invoice', () => {
    const pdf = text(renderOrderInvoicePdf({ brand: BRAND, order, orderId: 'o-1', store }))
    expectWellFormed(pdf)
    expect(pdf).toContain('/Title (Invoice #2001 - Acme Signs \\(Austin\\))')
  })

  it('carries the invoice number, order date, payment standing and the printed invoice’s totals', () => {
    const strings = drawn(text(renderOrderInvoicePdf({ brand: BRAND, order, orderId: 'o-1', store })))
    for (const expected of [
      'INVOICE',
      'Invoice #2001',
      'Order date',
      'October 28, 2026',
      'Paid, partially refunded',
      'BILL TO',
      'ada@example.com',
      'Mug',
      'Blue \\267 SKU MUG-1',
      '$12.50',
      '$25.00',
      'Included',
      'Subtotal',
      'Discount',
      '-$2.50',
      'Shipping',
      '$5.00',
      'Tax',
      '$2.06',
      'Total',
      '$29.56',
      'Tip',
      '$3.00',
      'Refunded',
      '-$12.50',
      'Net paid',
      '$17.06',
      'Thanks for shopping with us!',
      'https://acme.example.com/terms',
    ]) {
      expect(strings).toContain(expected)
    }
  })

  it('says a draft order is awaiting payment', () => {
    const strings = drawn(
      text(renderOrderInvoicePdf({ brand: BRAND, order: { ...order, status: 'pending', refundedCents: 0 } as HostOrder, orderId: 'o-1', store })),
    )
    expect(strings).toContain('Awaiting payment')
  })

  it('prints a paid quote as its order’s invoice', () => {
    const paidQuote = {
      ...quoteOrder({ status: 'paid' }),
      createdAtMs: LATE,
      customerName: 'Jordan Lee',
      billingAddress: { name: 'Lee Family Bakery', line1: '88 Market St', city: 'Austin', state: 'TX', postalCode: '78702' },
      totals: { itemsCents: 74_050, discountCents: 7_405, shippingCents: 2_500, taxCents: 5_498, feeCents: 0, totalCents: 74_643 },
    } as HostOrder
    const strings = drawn(text(renderOrderInvoicePdf({ brand: BRAND, order: paidQuote, orderId: 'q-1', store })))
    expect(strings).toEqual(expect.arrayContaining(['Invoice #1042', 'Paid', 'Hemmed edges.', 'Included', '$746.43']))
  })
})

it('gives dates the American way in the site’s zone', () => {
  expect(formatPdfDate(LATE, 'America/Chicago')).toBe('October 28, 2026')
  expect(formatPdfDate(LATE, 'Not/AZone')).toBe('October 29, 2026')
  expect(formatPdfDate(0, 'UTC')).toBe('')
})
