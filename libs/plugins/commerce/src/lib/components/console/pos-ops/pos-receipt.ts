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

import { posMoney, type PosReceipt } from '../../../model/commerce-pos-ops'
import { code128Svg } from '../../../utils/code128'
import { escapeHtml } from '../../../utils/escape-html'

/*==========================================
 * THE THERMAL RECEIPT (AGL-3609).
 *
 * An 80 mm roll prints a 72 mm column. The page is sized to the roll and has
 * no margin, so the printer driver feeds exactly as much paper as the receipt
 * needs; everything is black on white because a thermal head prints nothing
 * else, and the type is the printer's own monospace stack so columns line up.
 *
 * Most network receipt printers open the cash drawer wired to them when they
 * print, so printing the receipt for a cash sale is also what opens the
 * drawer. That is the printer's setting, not this page's.
 *=========================================*/

export const POS_RECEIPT_STYLES = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 80mm; padding: 4mm; font: 12px/1.35 ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace; }
.receipt { width: 72mm; }
.center { text-align: center; }
.logo { display: block; max-width: 48mm; max-height: 20mm; margin: 0 auto 2mm; }
.store { font-size: 15px; font-weight: 700; }
.muted { font-size: 11px; }
.rule { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
.row { display: flex; justify-content: space-between; gap: 2mm; }
.row > span:first-child { flex: 1; overflow-wrap: anywhere; }
.row > span:last-child { white-space: nowrap; }
.item { margin-bottom: 1mm; }
.total { font-size: 14px; font-weight: 700; }
.barcode { margin: 3mm auto 1mm; text-align: center; }
.barcode svg { width: 60mm; height: 12mm; }
.title { font-weight: 700; letter-spacing: 0.1em; }
@media screen { body { margin: 0 auto; } }
`

const row = (left: string, right: string, className = 'row') =>
  `<div class="${className}"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`

/** The receipt's body as HTML, every value escaped. */
export function posReceiptHtml(receipt: PosReceipt): string {
  const parts: string[] = ['<div class="receipt">', '<div class="center">']
  if (receipt.logoUrl && /^https:\/\//.test(receipt.logoUrl)) {
    parts.push(`<img class="logo" src="${escapeHtml(receipt.logoUrl)}" alt="">`)
  }
  parts.push(`<div class="store">${escapeHtml(receipt.storeName)}</div>`)
  for (const line of receipt.addressLines) parts.push(`<div class="muted">${escapeHtml(line)}</div>`)
  if (receipt.gift) parts.push('<div class="title">GIFT RECEIPT</div>')
  parts.push('</div><hr class="rule">')
  parts.push(row(`Order ${receipt.orderNumber}`, receipt.dateLabel, 'row muted'))
  if (receipt.registerName) parts.push(row('Register', receipt.registerName, 'row muted'))
  if (receipt.cashierName) parts.push(row('Cashier', receipt.cashierName, 'row muted'))
  if (receipt.customerName) parts.push(row('Customer', receipt.customerName, 'row muted'))
  parts.push('<hr class="rule">')
  for (const line of receipt.lines) {
    const label = `${line.quantity} × ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}`
    parts.push(
      receipt.gift
        ? `<div class="item">${escapeHtml(label)}</div>`
        : `<div class="item">${row(label, posMoney(line.lineCents))}${
            line.quantity > 1
              ? `<div class="muted">&nbsp;&nbsp;${escapeHtml(posMoney(line.unitAmountCents))} each</div>`
              : ''
          }</div>`,
    )
  }
  if (!receipt.gift) {
    parts.push('<hr class="rule">')
    parts.push(row('Subtotal', posMoney(receipt.subtotalCents)))
    if (receipt.discountCents > 0) parts.push(row('Discount', `-${posMoney(receipt.discountCents)}`))
    if (receipt.taxCents > 0) parts.push(row('Tax', posMoney(receipt.taxCents)))
    parts.push(row('Total', posMoney(receipt.totalCents), 'row total'))
    if (receipt.tipCents > 0) parts.push(row('Tip', posMoney(receipt.tipCents)))
    if (receipt.tenders.length) {
      parts.push('<hr class="rule">')
      for (const tender of receipt.tenders) parts.push(row(tender.label, posMoney(tender.amountCents)))
      if (receipt.changeCents > 0) parts.push(row('Change', posMoney(receipt.changeCents)))
    }
    if (receipt.refundedCents > 0) parts.push(row('Refunded', `-${posMoney(receipt.refundedCents)}`))
  }
  try {
    parts.push(
      `<div class="barcode">${code128Svg(receipt.barcodeValue, {
        height: 48,
        moduleWidth: 2,
        title: receipt.orderNumber,
      })}<div class="muted">${escapeHtml(receipt.orderNumber)}</div></div>`,
    )
  } catch {
    // An order id code 128 cannot carry prints its number alone.
  }
  if (receipt.footer || receipt.returnPolicy) parts.push('<hr class="rule">')
  if (receipt.footer) parts.push(`<div class="center muted">${escapeHtml(receipt.footer)}</div>`)
  if (receipt.returnPolicy) {
    parts.push(`<div class="center muted">${escapeHtml(receipt.returnPolicy)}</div>`)
  }
  parts.push('</div>')
  return parts.join('')
}

/** A whole printable document: the receipt and its 80 mm page. */
export function posReceiptDocument(receipt: PosReceipt): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(`Receipt ${receipt.orderNumber}`)}</title>` +
    `<style>${POS_RECEIPT_STYLES}</style></head><body>${posReceiptHtml(receipt)}</body></html>`
  )
}

/**
 * Prints the receipt through the browser's print dialog from a hidden frame,
 * so the register page itself never reflows. Waits for the logo (if any) so
 * the first print is not missing it, and removes the frame afterwards.
 */
export function printPosReceipt(receipt: PosReceipt): void {
  if (typeof document === 'undefined') return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.style.right = '0'
  frame.style.bottom = '0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  const doc = frame.contentDocument ?? win?.document
  if (!win || !doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(posReceiptDocument(receipt))
  doc.close()
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
  const go = () => {
    win.addEventListener('afterprint', cleanup, { once: true })
    win.focus()
    win.print()
    // Browsers that never fire `afterprint` still drop the frame.
    window.setTimeout(() => frame.isConnected && frame.remove(), 60_000)
  }
  const images = Array.from(doc.images)
  if (!images.length) return go()
  let waiting = images.length
  const done = () => {
    waiting -= 1
    if (waiting === 0) go()
  }
  for (const image of images) {
    if (image.complete) done()
    else {
      image.addEventListener('load', done, { once: true })
      image.addEventListener('error', done, { once: true })
    }
  }
}
