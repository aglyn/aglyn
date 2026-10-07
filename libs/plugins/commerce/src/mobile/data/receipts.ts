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

import { doc, getDoc } from 'firebase/firestore'
import { type HostOrder } from '../../lib/model/commerce-orders'
import { receiptDataFromOrder, type ReceiptData } from '../../lib/model/commerce-receipt'
import { layoutReceipt, type PrintDocument, toPrintable } from '../../lib/printing/print-document'
import { renderText } from '../../lib/printing/render-text'
import type { CommerceMobileContext } from './context'

/*
 * An order's receipt from the phone (AGL-3621): resent to the buyer through
 * the console's own route (`commerce/order-receipt-send`, which owns the
 * role gate and the per-order rate limit), or printed and shared from the
 * device. The printed copy is laid out by the same `layoutReceipt` the
 * cloud printers and the register print from, so the three never disagree
 * about what was sold.
 */

export type ReceiptChannel = 'email' | 'sms'

/** Which channels can carry a receipt right now; text only when SMS is configured. */
export async function receiptChannels(
  context: CommerceMobileContext,
): Promise<{ email: boolean; sms: boolean }> {
  try {
    const body = await context.api.request<{ email?: unknown; sms?: unknown }>('commerce/order-receipt-send', {
      method: 'GET',
      query: { hostId: context.hostId },
    })
    return { email: body?.email === true, sms: body?.sms === true }
  } catch {
    // As the console's dialog: offer email, which the route re-checks.
    return { email: true, sms: false }
  }
}

/** Why a receipt cannot be sent to `to`, or null. The route checks again. */
export function checkReceiptRecipient(channel: ReceiptChannel, to: string): string | null {
  const value = to.trim()
  if (channel === 'sms') return /^\+?[\d\s().-]{7,}$/.test(value) ? null : 'Enter a phone number'
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Enter an email address'
}

export function sendReceipt(
  context: CommerceMobileContext,
  input: { orderId: string; channel: ReceiptChannel; to: string },
): Promise<{ ok: true; channel: ReceiptChannel }> {
  return context.api.request('commerce/order-receipt-send', {
    method: 'POST',
    body: { hostId: context.hostId, orderId: input.orderId, channel: input.channel, to: input.to.trim() },
  })
}

/** The store's name for the top of a printed receipt: the store's own, else the site's. */
export async function receiptStoreName(context: CommerceMobileContext): Promise<string> {
  const store = await getDoc(doc(context.firestore, `hosts/${context.hostId}/settings/store`)).catch(() => null)
  const named = String(store?.data()?.['name'] ?? store?.data()?.['storeName'] ?? '').trim()
  if (named) return named
  const host = await getDoc(doc(context.firestore, 'hosts', context.hostId)).catch(() => null)
  return String(host?.data()?.['name'] ?? '').trim() || 'Receipt'
}

/** Characters per line of the printed copy: an 80 mm receipt's. */
export const PRINTED_RECEIPT_COLUMNS = 42

export function orderReceipt(
  orderId: string,
  order: HostOrder,
  input: { storeName: string; currency?: string; timeZone?: string },
): ReceiptData {
  return receiptDataFromOrder(orderId, order as HostOrder & Record<string, unknown>, {
    storeName: input.storeName,
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  })
}

export function receiptDocument(receipt: ReceiptData): PrintDocument {
  return layoutReceipt(receipt, { columns: PRINTED_RECEIPT_COLUMNS })
}

/** The receipt as plain text, for a share sheet. */
export function receiptText(receipt: ReceiptData): string {
  return renderText(receiptDocument(receipt))
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

/**
 * The receipt as a printable page: the print layout's own lines in a
 * monospace column, so alignment, wrapping and totals are exactly the
 * thermal printer's.
 */
export function receiptHtml(receipt: ReceiptData): string {
  const layout = receiptDocument(receipt)
  const lines: string[] = []
  for (const op of layout.ops) {
    if (op.op === 'text') {
      const text = escapeHtml(toPrintable(op.text).slice(0, layout.columns))
      const style = [
        op.align ? `text-align:${op.align}` : '',
        op.bold ? 'font-weight:700' : '',
        op.size === 2 ? 'font-size:1.6em' : '',
      ]
        .filter(Boolean)
        .join(';')
      lines.push(`<div${style ? ` style="${style}"` : ''}>${text || '&nbsp;'}</div>`)
    } else if (op.op === 'feed') {
      for (let index = 0; index < op.lines; index += 1) lines.push('<div>&nbsp;</div>')
    } else if (op.op === 'barcode') {
      lines.push(`<div style="text-align:center;letter-spacing:0.2em">*${escapeHtml(op.data)}*</div>`)
    }
  }
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(`Order ${receipt.orderNumber}`)}</title>`,
    '<style>body{margin:24px;}main{font-family:Menlo,Courier,monospace;font-size:12px;',
    `width:${layout.columns}ch;margin:0 auto;white-space:pre-wrap;}</style>`,
    `</head><body><main>${lines.join('')}</main></body></html>`,
  ].join('')
}
