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

import {
  formatReceiptMoney,
  formatReceiptTime,
  type ReceiptData,
} from '../model/commerce-receipt'

/**
 * A printer-neutral document (AGL-3619): what a receipt, a test page or a
 * drawer kick IS, laid out in fixed columns, before any vendor's bytes. Each
 * renderer (`render-star.ts`, `render-epson.ts`, `render-text.ts`) translates
 * these operations one for one, so the layout is decided once and a Star and
 * an Epson print the same receipt.
 *
 * Text operations are one printed LINE each and already fit the paper: the
 * layout wraps and pads here, because a thermal printer's own wrapping breaks
 * mid-word and cannot right-align a price.
 */
export type PrintAlign = 'left' | 'center' | 'right'

export type PrintOp =
  | { op: 'text'; text: string; align?: PrintAlign; bold?: boolean; size?: 1 | 2 }
  | { op: 'feed'; lines: number }
  | { op: 'barcode'; data: string }
  | { op: 'logo' }
  | { op: 'drawer' }
  | { op: 'cut' }

export interface PrintDocument {
  /** Characters per line at size 1. */
  columns: number
  ops: PrintOp[]
}

const SYMBOLS: Record<string, string> = {
  '•': '*', // bullet
  '·': '*',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
  ' ': ' ',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
}

/**
 * Text as the printer's built-in ASCII font can print it. Accents are folded
 * (`Crème brûlée` → `Creme brulee`), the punctuation a product name or a money
 * format carries is spelled in ASCII, and anything left becomes `?` rather
 * than the mojibake a raw UTF-8 byte prints as on a code-page printer.
 */
export function toPrintable(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, (char) => SYMBOLS[char] ?? (/\s/.test(char) ? ' ' : '?'))
}

/** Words wrapped to `width`, breaking a word only when it alone is too long. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of toPrintable(text).split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > width) {
      if (current) {
        lines.push(current)
        current = ''
      }
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (!rest) continue
    if (!current) current = rest
    else if (current.length + 1 + rest.length <= width) current += ` ${rest}`
    else {
      lines.push(current)
      current = rest
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/**
 * A left label and a right amount on one line; a label too long to share the
 * line wraps above, so the amount always lands flush right.
 */
export function twoColumnLines(left: string, right: string, width: number): string[] {
  const amount = toPrintable(right)
  const room = Math.max(1, width - amount.length - 1)
  const wrapped = wrapText(left, room)
  const last = wrapped.pop() ?? ''
  return [...wrapped, `${last}${' '.repeat(Math.max(1, width - last.length - amount.length))}${amount}`]
}

const rule = (columns: number): PrintOp => ({ op: 'text', text: '-'.repeat(columns) })

export interface LayoutOptions {
  columns: number
  /** Print the logo stored in the printer. */
  logo?: boolean
  /** Kick the cash drawer as the receipt starts printing. */
  openDrawer?: boolean
}

/** The customer receipt. */
export function layoutReceipt(receipt: ReceiptData, options: LayoutOptions): PrintDocument {
  const { columns } = options
  const money = (cents: number) => formatReceiptMoney(cents, receipt.currency)
  const ops: PrintOp[] = []
  const line = (left: string, right: string, bold = false) => {
    for (const text of twoColumnLines(left, right, columns)) ops.push({ op: 'text', text, bold })
  }
  // The drawer first: the cashier makes change while the receipt prints.
  if (options.openDrawer) ops.push({ op: 'drawer' })
  if (options.logo) ops.push({ op: 'logo' })
  if (receipt.banner) {
    ops.push({ op: 'text', text: toPrintable(receipt.banner).slice(0, Math.floor(columns / 2)), align: 'center', bold: true, size: 2 })
  }
  for (const text of wrapText(receipt.storeName, Math.floor(columns / 2))) {
    ops.push({ op: 'text', text, align: 'center', bold: true, size: 2 })
  }
  for (const storeLine of receipt.storeLines ?? []) {
    for (const text of wrapText(storeLine, columns)) ops.push({ op: 'text', text, align: 'center' })
  }
  ops.push({ op: 'feed', lines: 1 })
  line(`Order #${receipt.orderNumber}`, formatReceiptTime(receipt.createdAtMs, receipt.timeZone))
  const who = [receipt.registerName, receipt.cashierName].filter(Boolean).join(' - ')
  if (who) for (const text of wrapText(who, columns)) ops.push({ op: 'text', text })
  ops.push(rule(columns))
  for (const item of receipt.lines) {
    const label = item.quantity > 1 ? `${item.quantity} x ${item.name}` : item.name
    line(label, money(item.totalCents))
    if (item.detail) {
      for (const text of wrapText(item.detail, columns - 2)) ops.push({ op: 'text', text: `  ${text}` })
    }
    if (item.quantity > 1) {
      ops.push({ op: 'text', text: toPrintable(`  @ ${money(item.unitCents)} each`).slice(0, columns) })
    }
  }
  ops.push(rule(columns))
  line('Subtotal', money(receipt.subtotalCents))
  if (receipt.discountCents) line('Discount', `-${money(receipt.discountCents)}`)
  if (receipt.shippingCents) line('Shipping', money(receipt.shippingCents))
  if (receipt.taxCents) line('Tax', money(receipt.taxCents))
  if (receipt.tipCents) line('Tip', money(receipt.tipCents))
  for (const text of twoColumnLines('TOTAL', money(receipt.totalCents), Math.floor(columns / 2))) {
    ops.push({ op: 'text', text, bold: true, size: 2 })
  }
  if (receipt.tenders?.length || receipt.changeCents) ops.push({ op: 'feed', lines: 1 })
  for (const tender of receipt.tenders ?? []) line(tender.label, money(tender.amountCents))
  if (receipt.changeCents) line('Change', money(receipt.changeCents), true)
  if (receipt.refundedCents) line('Refunded', `-${money(receipt.refundedCents)}`)
  const barcode = code128Printable(receipt.barcode ?? receipt.orderNumber)
  if (barcode) {
    ops.push({ op: 'feed', lines: 1 })
    ops.push({ op: 'barcode', data: barcode })
  }
  if (receipt.footer) {
    ops.push({ op: 'feed', lines: 1 })
    for (const text of wrapText(receipt.footer, columns)) ops.push({ op: 'text', text, align: 'center' })
  }
  ops.push({ op: 'feed', lines: 2 })
  ops.push({ op: 'cut' })
  return { columns, ops }
}

/**
 * Code128 code set B carries printable ASCII, and a scanner reads a short
 * symbol more reliably than a long one, so the data is the order number
 * reduced to those characters and capped well under a receipt's width.
 */
export function code128Printable(value: unknown): string {
  return toPrintable(value).replace(/[^\x21-\x7e]/g, '').slice(0, 20)
}

/** The page "Print test" sends: proves the URL, the paper, the cutter and, if asked, the drawer. */
export function layoutTestPage(input: {
  columns: number
  printerName: string
  storeName: string
  atMs: number
  timeZone?: string
  logo?: boolean
  openDrawer?: boolean
}): PrintDocument {
  const { columns } = input
  const ops: PrintOp[] = []
  if (input.openDrawer) ops.push({ op: 'drawer' })
  if (input.logo) ops.push({ op: 'logo' })
  ops.push({ op: 'text', text: 'TEST PRINT', align: 'center', bold: true, size: 2 })
  for (const text of wrapText(input.storeName, columns)) ops.push({ op: 'text', text, align: 'center' })
  ops.push({ op: 'feed', lines: 1 })
  for (const text of twoColumnLines('Printer', input.printerName, columns)) ops.push({ op: 'text', text })
  for (const text of twoColumnLines('Sent', formatReceiptTime(input.atMs, input.timeZone), columns)) {
    ops.push({ op: 'text', text })
  }
  ops.push({ op: 'text', text: '-'.repeat(columns) })
  ops.push({ op: 'text', text: 'Left aligned' })
  ops.push({ op: 'text', text: 'Centered', align: 'center' })
  ops.push({ op: 'text', text: 'Right aligned', align: 'right' })
  ops.push({ op: 'text', text: 'Bold text', bold: true })
  ops.push({ op: 'text', text: 'Large', size: 2 })
  ops.push({ op: 'text', text: '0123456789'.repeat(Math.ceil(columns / 10)).slice(0, columns) })
  ops.push({ op: 'feed', lines: 1 })
  ops.push({ op: 'barcode', data: 'TEST-PRINT' })
  ops.push({ op: 'feed', lines: 1 })
  for (const text of wrapText('If you can read this, receipts will print here.', columns)) {
    ops.push({ op: 'text', text, align: 'center' })
  }
  ops.push({ op: 'feed', lines: 2 })
  ops.push({ op: 'cut' })
  return { columns, ops }
}

/** A drawer kick with nothing printed: a paid-out, a cash refund, "Open drawer". */
export function layoutDrawerKick(columns: number): PrintDocument {
  return { columns, ops: [{ op: 'drawer' }] }
}
