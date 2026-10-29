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

import { buildEmailPalette, emailAccent, resolveEmailColor, type EmailPalette } from '@aglyn/shared-util-email'
import { relativeLuminanceOfRgb, rgbChannelsOfHex } from '@aglyn/shared-util-tools/contrast'
import type { PdfJpegImage } from '@aglyn/shared-util-tools/pdf/pdf-file'
import { PdfWriter, pdfRgbFromHex, type PdfRgb, type PdfTableCell } from '@aglyn/shared-util-tools/pdf/pdf-writer'
import type { QuotePageAddress, QuotePageView } from '../model/commerce-quote-pay'
import { buildOrderInvoiceData, invoiceAddressLines, invoiceMoney, type InvoiceOrder, type OrderInvoiceStore } from './order-invoice'

/*==========================================
 * A QUOTE AND AN INVOICE AS BRANDED PDFs (AGL-4095).
 *
 *   renderQuotePdf({ brand, view, revision, payUrl })     → Uint8Array
 *   renderOrderInvoicePdf({ brand, order, orderId, store }) → Uint8Array
 *
 * Both are one layout: the business's logo, name and contact at the top left
 * under a band of the site's primary color, the document's name, number,
 * date and standing at the top right, who it is billed and shipped to, the
 * lines in a table whose header wears the primary color, the totals, then
 * notes, terms and (for a quote still to be paid) the pay link as a button
 * and as text, both clickable. Every page ends with the document's name and
 * its page number.
 *
 * Pure over its input: the server reads the site, its theme and its logo
 * (`server/commerce-pdf-brand.ts`) and the quote or order, and these turn
 * them into bytes, so the console's download, the customer's download and
 * the emails that attach a quote or an invoice all make the same file.
 *
 * A quote is drawn from `buildQuotePageView`, the customer-safe projection
 * the quote page shows, so the PDF never says more than the page does. An
 * invoice is drawn from `buildOrderInvoiceData`, the content the printed
 * invoice shows.
 *=========================================*/

/** The colors a document is drawn in, as `#rrggbb`. */
export interface CommercePdfColors {
  /** The band, the table's header and the pay button: the site's primary color. */
  accent: string
  /** Text set on the accent. */
  onAccent: string
  /** The accent as text on white: the document's name, links. */
  accentText: string
  /** A wash of the accent, behind the total. */
  tint: string
  ink: string
  muted: string
  rule: string
}

/** Who the document is from. */
export interface CommercePdfBrand {
  businessName: string
  /** Address lines, email, phone and web address, in that order. */
  contactLines: readonly string[]
  /** The site's logo as a JPEG; the business name stands alone without one. */
  logo?: PdfJpegImage | null
  /** The site theme's colors; any left out are the neutral ones. */
  colors?: Partial<CommercePdfColors> | null
  /** The site's time zone, which dates are given in. */
  timeZone?: string | null
}

const NEUTRAL_PALETTE = buildEmailPalette({ base: 'tenant' })
const neutral = (path: string) => resolveEmailColor(path, NEUTRAL_PALETTE) ?? ''

/** The colors a document wears where its site's theme gives none: the default site theme's greys. */
export const COMMERCE_PDF_NEUTRAL_COLORS: Readonly<CommercePdfColors> = Object.freeze({
  accent: neutral('grey.800'),
  onAccent: neutral('background.paper'),
  accentText: neutral('grey.800'),
  tint: neutral('grey.100'),
  ink: neutral('text.primary'),
  muted: neutral('text.secondary'),
  rule: neutral('divider'),
})

/** WCAG contrast between two `#rrggbb` colors; 1 when either cannot be read. */
function contrast(one: string, other: string): number {
  const a = rgbChannelsOfHex(one)
  const b = rgbChannelsOfHex(other)
  if (!a || !b) return 1
  const la = relativeLuminanceOfRgb(...a)
  const lb = relativeLuminanceOfRgb(...b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * A document's colors from a site's resolved palette: the primary color for
 * the accent, the theme's own text and divider colors, and text on the
 * accent that reads at 4.5:1 (the theme's contrast text when it does, else
 * the theme's dark ink or white, whichever reads better).
 */
export function commercePdfColorsFromPalette(palette: EmailPalette): CommercePdfColors {
  const accent = emailAccent(palette)
  const read = (path: string, fallback: string) => resolveEmailColor(path, palette) ?? fallback
  const ink = read('text.primary', COMMERCE_PDF_NEUTRAL_COLORS.ink)
  const paper = read('background.paper', COMMERCE_PDF_NEUTRAL_COLORS.onAccent)
  const onAccent =
    contrast(accent.label, accent.fill) >= 4.5
      ? accent.label
      : contrast(ink, accent.fill) >= contrast(paper, accent.fill)
        ? ink
        : paper
  return {
    accent: accent.fill,
    onAccent,
    accentText: contrast(accent.link, paper) >= 4.5 ? accent.link : ink,
    tint: read('tint.primary', COMMERCE_PDF_NEUTRAL_COLORS.tint),
    ink,
    muted: read('text.secondary', COMMERCE_PDF_NEUTRAL_COLORS.muted),
    rule: read('divider', COMMERCE_PDF_NEUTRAL_COLORS.rule),
  }
}

/*==========================================
 * WHAT A DOCUMENT SAYS
 *=========================================*/

interface DocumentLine {
  name: string
  details: string[]
  quantity: number
  unit: string
  amount: string
}

interface SummaryRow {
  label: string
  value: string
  emphasis?: boolean
  /** A note in place of a figure, such as "Tax is added at payment". */
  note?: boolean
}

interface CommerceDocument {
  /** QUOTE or INVOICE, across the top. */
  kind: string
  /** `Quote #1042`. */
  title: string
  facts: Array<[string, string]>
  /** A short standing, set in a pill under the facts: `Paid October 30, 2026`. */
  stamp: string | null
  parties: Array<{ label: string; lines: string[] }>
  lines: DocumentLine[]
  summary: SummaryRow[]
  sections: Array<{ heading: string; text: string; link?: string }>
  pay: { url: string; label: string; intro: string } | null
}

/** A date the American way, in the site's time zone: `October 28, 2026`. */
export function formatPdfDate(ms: number | null | undefined, timeZone?: string | null): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(ms))
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(ms))
  }
}

const minus = (text: string) => `-${text}`

/*==========================================
 * THE QUOTE
 *=========================================*/

export interface QuotePdfInput {
  brand: CommercePdfBrand
  /** The quote as its customer may see it: `buildQuotePageView`. */
  view: QuotePageView
  /** The quote's revision, printed beside its date. */
  revision?: number | null
  /** The pay link, printed on a quote still to be paid; left off when the reader may not have it. */
  payUrl?: string | null
}

function quoteAddressLines(address: QuotePageAddress | null): string[] {
  return invoiceAddressLines(address as never, { phone: false })
}

function quoteDocument(input: QuotePdfInput): CommerceDocument {
  const { view, brand } = input
  const money = (cents: number) => invoiceMoney(cents, view.currency)
  const date = (ms: number | null) => formatPdfDate(ms, brand.timeZone)
  const customer = [view.customerName ?? '', view.company ?? ''].filter(Boolean)
  const billTo = quoteAddressLines(view.billTo)
  const parties: CommerceDocument['parties'] = []
  if (billTo.length) {
    // The bill-to's own name leads; the customer's name and company are added when it does not carry them.
    const named = customer.filter((part) => !billTo.includes(part))
    parties.push({ label: 'Bill to', lines: [...named, ...billTo] })
  } else if (customer.length) {
    parties.push({ label: 'Prepared for', lines: customer })
  }
  const shipTo = quoteAddressLines(view.shipTo)
  if (shipTo.length) parties.push({ label: 'Ship to', lines: shipTo })

  const summary: SummaryRow[] = [{ label: 'Subtotal', value: money(view.totals.itemsCents) }]
  if (view.totals.discountCents > 0) {
    summary.push({
      label: view.discountLabel ? `Discount (${view.discountLabel})` : 'Discount',
      value: minus(money(view.totals.discountCents)),
    })
  }
  if (view.totals.shippingCents > 0) summary.push({ label: 'Shipping', value: money(view.totals.shippingCents) })
  if (view.taxAtPayment) summary.push({ label: 'Tax is added at payment', value: '', note: true })
  else if (view.totals.taxCents > 0) summary.push({ label: view.taxLabel || 'Tax', value: money(view.totals.taxCents) })
  else if (view.taxLabel && view.taxLabel !== 'Tax') summary.push({ label: view.taxLabel, value: '', note: true })
  summary.push({ label: view.taxAtPayment ? 'Total before tax' : 'Total', value: money(view.totals.totalCents), emphasis: true })

  const stamp =
    view.status === 'paid'
      ? `Paid${view.paidAtMs ? ` ${date(view.paidAtMs)}` : ''}`
      : view.status === 'canceled'
        ? 'Canceled'
        : view.status === 'refunded'
          ? 'Refunded'
          : null
  const facts: Array<[string, string]> = []
  if (view.dateMs) facts.push(['Date', date(view.dateMs)])
  if (input.revision && input.revision > 0) facts.push(['Revision', String(input.revision)])

  const sections: CommerceDocument['sections'] = []
  if (view.notes) sections.push({ heading: 'Notes', text: view.notes })
  if (view.terms) sections.push({ heading: 'Terms', text: view.terms })

  const payUrl = view.status === 'unpaid' && input.payUrl ? input.payUrl : null
  return {
    kind: 'QUOTE',
    title: view.number,
    facts,
    stamp,
    parties,
    lines: view.lines.map((line) => ({
      name: line.name,
      details: [line.variantLabel ?? '', line.description ?? '', line.sku ? `SKU ${line.sku}` : ''].filter(Boolean),
      quantity: line.quantity,
      unit: line.included ? '' : money(line.unitAmountCents),
      amount: line.included ? 'Included' : money(line.amountCents),
    })),
    summary,
    sections,
    pay: payUrl
      ? {
          url: payUrl,
          label: 'Pay this quote',
          intro: view.approvalRequired
            ? `${view.storeName || 'We'} will ask you to approve the proof first, at this link:`
            : 'Open the quote on our site to pay it securely by card:',
        }
      : null,
  }
}

/** The quote as a PDF. */
export function renderQuotePdf(input: QuotePdfInput): Uint8Array {
  return renderCommerceDocument(input.brand, quoteDocument(input))
}

/*==========================================
 * THE INVOICE
 *=========================================*/

export interface OrderInvoicePdfInput {
  brand: CommercePdfBrand
  order: InvoiceOrder
  orderId: string
  /** The store's currency, receipt footer and terms address (`invoiceStoreFrom`). */
  store: OrderInvoiceStore
  /**
   * The order's pay link (AGL-4099), printed on an invoice still to be paid
   * as Pay online with a button and the address; left off when absent.
   */
  payUrl?: string | null
}

function invoiceDocument(input: OrderInvoicePdfInput): CommerceDocument {
  const data = buildOrderInvoiceData(input)
  const money = (cents: number) => invoiceMoney(cents, data.currency)
  const parties: CommerceDocument['parties'] = []
  if (data.billTo.length) parties.push({ label: 'Bill to', lines: data.billTo })
  if (data.shipTo.length) parties.push({ label: 'Ship to', lines: data.shipTo })
  const facts: Array<[string, string]> = []
  if (data.dateMs) facts.push(['Order date', formatPdfDate(data.dateMs, input.brand.timeZone)])
  const sections: CommerceDocument['sections'] = []
  if (data.footer) sections.push({ heading: '', text: data.footer })
  if (data.termsUrl) sections.push({ heading: 'Terms', text: data.termsUrl, link: data.termsUrl })
  const payUrl = input.order.status === 'pending' && input.payUrl ? input.payUrl : null
  return {
    kind: 'INVOICE',
    title: `Invoice ${data.number}`,
    facts,
    stamp: data.paymentStatus,
    parties,
    lines: data.lines.map((line) => ({
      name: line.name,
      details: [line.detail, line.description].filter(Boolean),
      quantity: line.quantity,
      unit: line.included ? '' : money(line.unitCents),
      amount: line.included ? 'Included' : money(line.amountCents),
    })),
    summary: data.summary.map((row) => ({
      label: row.label,
      value: row.minus ? minus(money(row.cents)) : money(row.cents),
      emphasis: row.emphasis,
    })),
    sections,
    pay: payUrl
      ? { url: payUrl, label: 'Pay this invoice', intro: 'Open the invoice on our site to pay it securely by card:' }
      : null,
  }
}

/** Any order's invoice as a PDF, a paid quote's included. */
export function renderOrderInvoicePdf(input: OrderInvoicePdfInput): Uint8Array {
  return renderCommerceDocument(input.brand, invoiceDocument(input))
}

/*==========================================
 * THE LAYOUT
 *=========================================*/

const PAGE_MARGIN = { top: 48, right: 48, bottom: 60, left: 48 }
const BAND_HEIGHT = 10
const LOGO_BOX = { width: 180, height: 50 }

function renderCommerceDocument(brand: CommercePdfBrand, document: CommerceDocument): Uint8Array {
  const palette = { ...COMMERCE_PDF_NEUTRAL_COLORS, ...(brand.colors ?? {}) }
  const color = (hex: string, fallback: string): PdfRgb =>
    pdfRgbFromHex(hex) ?? pdfRgbFromHex(fallback) ?? [0, 0, 0]
  const colors = {
    accent: color(palette.accent, COMMERCE_PDF_NEUTRAL_COLORS.accent),
    onAccent: color(palette.onAccent, COMMERCE_PDF_NEUTRAL_COLORS.onAccent),
    accentText: color(palette.accentText, COMMERCE_PDF_NEUTRAL_COLORS.accentText),
    tint: color(palette.tint, COMMERCE_PDF_NEUTRAL_COLORS.tint),
    ink: color(palette.ink, COMMERCE_PDF_NEUTRAL_COLORS.ink),
    muted: color(palette.muted, COMMERCE_PDF_NEUTRAL_COLORS.muted),
    rule: color(palette.rule, COMMERCE_PDF_NEUTRAL_COLORS.rule),
  }
  const businessName = brand.businessName.trim()
  const documentTitle = businessName ? `${document.title} - ${businessName}` : document.title

  const writer: PdfWriter = new PdfWriter({
    title: documentTitle,
    margin: PAGE_MARGIN,
    onNewPage: (page) => {
      page.fillRect(0, page.pageHeight - BAND_HEIGHT / 2, page.pageWidth, BAND_HEIGHT / 2, colors.accent)
      const baseline = page.top + 14
      if (businessName) page.textIn(page.left, page.contentWidth, baseline, businessName, { size: 8.5, font: 'bold', color: colors.muted })
      page.textIn(page.left, page.contentWidth, baseline, `${document.title} (continued)`, { size: 8.5, color: colors.muted }, 'right')
    },
  })
  const { left, right } = writer

  // The band across the top of the first page.
  writer.fillRect(0, writer.pageHeight - BAND_HEIGHT, writer.pageWidth, BAND_HEIGHT, colors.accent)

  // Left: logo, business name, contact.
  const leftWidth = writer.contentWidth * 0.55
  let leftY = writer.top
  if (brand.logo) {
    const drawn = writer.image(brand.logo, { x: left, y: leftY - LOGO_BOX.height, width: LOGO_BOX.width, height: LOGO_BOX.height })
    leftY = drawn.y - 12
  }
  writer.y = leftY
  if (businessName) writer.paragraph(businessName, { width: leftWidth, style: { font: 'bold', size: 14, color: colors.ink }, leading: 1.25, after: 2 })
  for (const line of brand.contactLines) {
    writer.paragraph(line, { width: leftWidth, style: { size: 9, color: colors.muted }, leading: 1.3 })
  }
  leftY = writer.y

  // Right: the document's name, number, facts and standing.
  const factsWidth = 210
  const factsX = right - factsWidth
  let rightY = writer.top - 22
  writer.textIn(factsX, factsWidth, rightY, document.kind, { font: 'bold', size: 24, color: colors.accentText }, 'right')
  rightY -= 20
  writer.textIn(factsX, factsWidth, rightY, document.title, { font: 'bold', size: 11, color: colors.ink }, 'right')
  for (const [label, value] of document.facts) {
    rightY -= 14
    const valueWidth = writer.measure(value, { size: 9.5 })
    writer.textIn(factsX, factsWidth, rightY, value, { size: 9.5, color: colors.ink }, 'right')
    writer.textIn(factsX, factsWidth - valueWidth - 8, rightY, label, { size: 9.5, color: colors.muted }, 'right')
  }
  if (document.stamp) {
    rightY -= 24
    const style = { font: 'bold' as const, size: 8.5, color: colors.onAccent }
    const width = writer.measure(document.stamp, style) + 16
    writer.fillRect(right - width, rightY - 5, width, 17, colors.accent)
    writer.textIn(right - width, width, rightY, document.stamp, style, 'center')
    rightY -= 5
  }

  writer.y = Math.min(leftY, rightY) - 22

  // Who it is for.
  if (document.parties.length) {
    const columnWidth = Math.min(220, writer.contentWidth / document.parties.length)
    const top = writer.y
    let lowest = top
    document.parties.forEach((party, index) => {
      const x = left + index * (columnWidth + 16)
      writer.y = top
      writer.paragraph(party.label.toUpperCase(), { x, width: columnWidth, style: { font: 'bold', size: 8, color: colors.muted }, after: 2 })
      party.lines.forEach((line, lineIndex) => {
        writer.paragraph(line, {
          x,
          width: columnWidth,
          style: { size: 9.5, color: colors.ink, font: lineIndex === 0 ? 'bold' : 'regular' },
        })
      })
      lowest = Math.min(lowest, writer.y)
    })
    writer.y = lowest - 18
  }

  // The lines.
  const rows: PdfTableCell[][] = document.lines.map((line) => [
    [
      { text: line.name, style: { font: 'bold', size: 9.5, color: colors.ink } },
      ...line.details.map((detail) => ({ text: detail, style: { size: 8.5, color: colors.muted } })),
    ],
    String(line.quantity),
    line.unit,
    line.amount,
  ])
  writer.table({
    columns: [
      { header: 'Item', width: 0 },
      { header: 'Qty', width: 48, align: 'right' },
      { header: 'Unit price', width: 86, align: 'right' },
      { header: 'Amount', width: 90, align: 'right' },
    ],
    rows,
    headerFill: colors.accent,
    headerStyle: { font: 'bold', size: 8.5, color: colors.onAccent },
    bodyStyle: { size: 9.5, color: colors.ink },
    padding: { x: 8, y: 6 },
    ruleColor: colors.rule,
  })

  // The totals on the right; beside them on the left, paying it.
  const summaryWidth = 250
  const summaryX = right - summaryWidth
  const payWidth = writer.contentWidth - summaryWidth - 28
  const rowHeight = 17
  const summaryHeight = document.summary.reduce((sum, row) => sum + (row.emphasis ? rowHeight + 8 : rowHeight), 0)
  const pay = document.pay
  const buttonStyle = { font: 'bold' as const, size: 10.5, color: colors.onAccent }
  const buttonHeight = 26
  const payParts = pay
    ? {
        intro: writer.wrap(pay.intro, payWidth, { size: 9 }),
        url: writer.wrap(pay.url, payWidth, { size: 8 }),
      }
    : null
  const payHeight = payParts ? 18 + payParts.intro.length * 12 + 6 + buttonHeight + 8 + payParts.url.length * 11 : 0
  writer.down(12)
  writer.ensure(Math.max(summaryHeight, payHeight))
  const blockTop = writer.y
  for (const row of document.summary) {
    const height = row.emphasis ? rowHeight + 8 : rowHeight
    if (row.emphasis) writer.fillRect(summaryX, writer.y - height, summaryWidth, height, colors.tint)
    const size = row.emphasis ? 11.5 : 9.5
    const baseline = writer.y - height / 2 - size * 0.35
    const style = row.emphasis
      ? { font: 'bold' as const, size, color: colors.ink }
      : { size, color: row.note ? colors.muted : colors.ink, ...(row.note ? { font: 'italic' as const } : {}) }
    writer.textIn(summaryX + 8, summaryWidth - 16, baseline, row.label, style, 'left')
    if (row.value) writer.textIn(summaryX + 8, summaryWidth - 16, baseline, row.value, style, 'right')
    writer.down(height)
  }
  const summaryBottom = writer.y
  if (pay && payParts) {
    let y = blockTop - 12
    writer.text(left, y, 'Pay online', { font: 'bold', size: 11, color: colors.ink })
    y -= 6
    for (const line of payParts.intro) {
      y -= 12
      writer.text(left, y + 2, line, { size: 9, color: colors.muted })
    }
    y -= 6
    const buttonWidth = writer.measure(pay.label, buttonStyle) + 36
    writer.fillRect(left, y - buttonHeight, buttonWidth, buttonHeight, colors.accent)
    writer.textIn(left, buttonWidth, y - buttonHeight / 2 - 10.5 * 0.35, pay.label, buttonStyle, 'center')
    writer.link(left, y - buttonHeight, buttonWidth, buttonHeight, pay.url)
    y -= buttonHeight + 8
    for (const line of payParts.url) {
      y -= 11
      writer.text(left, y + 2, line, { size: 8, color: colors.accentText })
      writer.link(left, y, writer.measure(line, { size: 8 }), 11, pay.url)
    }
    writer.y = Math.min(summaryBottom, y)
  }
  writer.down(22)

  // Notes, terms, the store's footer.
  for (const section of document.sections) {
    if (section.heading) {
      writer.ensure(36)
      writer.paragraph(section.heading, { style: { font: 'bold', size: 10, color: colors.ink }, after: 1 })
    }
    writer.paragraph(section.text, {
      style: { size: 9, color: section.link ? colors.accentText : colors.muted },
      ...(section.link ? { link: section.link } : {}),
      after: 12,
    })
  }

  return writer.finish({
    footer: (page, pages) => ({
      left: businessName ? `${businessName} · ${document.title}` : document.title,
      right: `Page ${page} of ${pages}`,
    }),
    footerStyle: { size: 8, color: colors.muted },
    footerRule: colors.rule,
  })
}
