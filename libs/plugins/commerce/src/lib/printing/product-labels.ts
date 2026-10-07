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

import { escapeHtml } from '../utils/escape-html'
import { barcodeSvg, encodeBarcode, type EncodedBarcode } from '../barcode/barcode-encode'
import { formatReceiptMoney } from '../model/commerce-receipt'
import { toPrintable } from './print-document'

/**
 * Product and shelf labels (AGL-3619): a product's name, its options, its
 * price and a barcode the register scans back, on the small thermal labels
 * a Zebra, Rollo, DYMO or Brother label printer takes.
 *
 * Two outputs from one description. A printable page (one label per page,
 * the page sized to the label) prints through the label printer's own
 * driver from any browser. ZPL is the Zebra printer language, sent to a
 * Zebra as a file; it prints sharper and faster and needs no driver
 * settings, so a store with a Zebra can skip the print dialog altogether.
 */

export interface ProductLabel {
  name: string
  /** A variant's options, e.g. `Large / Blue`. */
  detail?: string
  priceCents?: number
  currency?: string
  /** The variant's barcode, else its SKU: what the register looks up. */
  code: string
  copies: number
}

export interface LabelSize {
  id: string
  label: string
  widthIn: number
  heightIn: number
}

/** The two sizes almost every label printer stocks for product labels. */
export const LABEL_SIZES: readonly LabelSize[] = [
  { id: '2.25x1.25', label: '2.25 x 1.25 in (57 x 32 mm)', widthIn: 2.25, heightIn: 1.25 },
  { id: '2x1', label: '2 x 1 in (51 x 25 mm)', widthIn: 2, heightIn: 1 },
]

/** One print run is capped; a typo of 5000 copies should not drain a roll. */
export const MAX_LABEL_COPIES = 500

export function labelSize(id: string | undefined): LabelSize {
  return LABEL_SIZES.find((size) => size.id === id) ?? LABEL_SIZES[0]
}

const copiesOf = (label: ProductLabel) => Math.max(0, Math.min(MAX_LABEL_COPIES, Math.floor(Number(label.copies) || 0)))

const priceText = (label: ProductLabel) =>
  label.priceCents != null && Number.isFinite(label.priceCents)
    ? formatReceiptMoney(Math.round(label.priceCents), label.currency ?? 'usd')
    : ''

/*==========================================
 * The printable page
 *=========================================*/

export function productLabelsHtml(labels: ProductLabel[], sizeId?: string): string {
  const size = labelSize(sizeId)
  const pages: string[] = []
  for (const label of labels) {
    const encoded = encodeBarcode(label.code)
    const page =
      '<section class="label">' +
      `<div class="name">${escapeHtml(label.name)}</div>` +
      (label.detail ? `<div class="detail">${escapeHtml(label.detail)}</div>` : '') +
      (priceText(label) ? `<div class="price">${escapeHtml(priceText(label))}</div>` : '') +
      (encoded
        ? `<div class="bars">${barcodeSvg(encoded)}</div><div class="code">${escapeHtml(encoded.text)}</div>`
        : '') +
      '</section>'
    for (let copy = 0; copy < copiesOf(label); copy += 1) pages.push(page)
  }
  const width = `${size.widthIn}in`
  const height = `${size.heightIn}in`
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>' +
    `@page{size:${width} ${height};margin:0}` +
    '*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}' +
    `.label{width:${width};height:${height};padding:0.06in 0.08in;overflow:hidden;display:flex;flex-direction:column;page-break-after:always;break-after:page}` +
    '.label:last-child{page-break-after:auto;break-after:auto}' +
    '.name{font-size:9pt;font-weight:700;line-height:1.1;max-height:2.2em;overflow:hidden}' +
    '.detail{font-size:7pt;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.price{font-size:11pt;font-weight:700;line-height:1.2}' +
    '.bars{flex:1;min-height:0.3in}.bars svg{width:100%;height:100%;display:block}' +
    '.code{font-size:7pt;text-align:center;letter-spacing:0.05em}' +
    '</style></head><body>' +
    pages.join('') +
    '</body></html>'
  )
}

/*==========================================
 * ZPL
 *=========================================*/

/** Zebra's desktop printers print at 203 dpi; the 300 dpi models are listed by name. */
export type ZplDpi = 203 | 300

/**
 * Field text for ZPL. `^FH` makes `_` the escape, so the three characters
 * ZPL treats as commands or that escape (`^`, `~`, `_`) are written as hex,
 * and the rest is folded to the printer's ASCII font.
 */
export function zplText(value: unknown): string {
  return toPrintable(value).replace(/[_^~]/g, (char) => `_${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function zplBarcode(encoded: EncodedBarcode, x: number, y: number, height: number, moduleDots: number): string {
  const at = `^FO${x},${y}^BY${moduleDots}`
  switch (encoded.format) {
    case 'ean_13':
      // ZPL takes the 12 data digits and adds the check digit itself.
      return `${at}^BEN,${height},Y,N^FD${encoded.text.slice(0, 12)}^FS`
    case 'upc_a':
      return `${at}^BUN,${height},Y,N,Y^FD${encoded.text.slice(0, 11)}^FS`
    case 'ean_8':
      return `${at}^B8N,${height},Y,N^FD${encoded.text.slice(0, 7)}^FS`
    default:
      // Mode A: the printer picks sets B and C itself, as the page does.
      return `${at}^BCN,${height},Y,N,N,A^FH^FD${zplText(encoded.text)}^FS`
  }
}

export function productLabelsZpl(labels: ProductLabel[], sizeId?: string, dpi: ZplDpi = 203): string {
  const size = labelSize(sizeId)
  const width = Math.round(size.widthIn * dpi)
  const height = Math.round(size.heightIn * dpi)
  const margin = Math.round(0.08 * dpi)
  const font = Math.round(dpi / 9)
  const small = Math.round(dpi / 12)
  const moduleDots = dpi >= 300 ? 3 : 2
  const out: string[] = []
  for (const label of labels) {
    const copies = copiesOf(label)
    if (!copies) continue
    const encoded = encodeBarcode(label.code)
    let y = margin
    const fields: string[] = []
    fields.push(`^FO${margin},${y}^A0N,${font},${font}^FB${width - margin * 2},2,0,L^FH^FD${zplText(label.name)}^FS`)
    y += font * 2 + 2
    if (label.detail) {
      fields.push(`^FO${margin},${y}^A0N,${small},${small}^FB${width - margin * 2},1,0,L^FH^FD${zplText(label.detail)}^FS`)
      y += small + 2
    }
    const price = priceText(label)
    if (price) {
      fields.push(`^FO${margin},${y}^A0N,${font},${font}^FH^FD${zplText(price)}^FS`)
      y += font + 4
    }
    if (encoded) {
      // What is left of the label, less the printed digits under the bars.
      const barHeight = Math.max(Math.round(dpi * 0.2), height - y - margin - small - 4)
      fields.push(zplBarcode(encoded, margin, y, barHeight, moduleDots))
    }
    out.push(`^XA^CI0^PW${width}^LL${height}^LH0,0${fields.join('')}^PQ${copies},0,1,Y^XZ`)
  }
  return out.join('\n')
}
