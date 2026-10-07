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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'

/**
 * Printable pages for a batch (AGL-3612): one packing slip per parcel, and
 * a sheet of every label bought. Pure, and every value a customer or a
 * merchant typed is escaped — a product named `<script>` prints as its name.
 */

export interface PackingSlip {
  recordRef: string
  shipTo: PluginShippingAddress
  lines: Array<{ name: string; sku: string | null; quantity: number }>
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const PAGE_STYLE =
  'body{font-family:system-ui,sans-serif;margin:0}section{page-break-after:always;padding:32px}' +
  'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}' +
  'h1{font-size:20px}address{font-style:normal;margin:12px 0 20px;white-space:pre-line}'

export function renderPackingSlips(storeName: string, slips: readonly PackingSlip[]): string {
  const sections = slips
    .map((slip) => {
      const to = slip.shipTo
      const address = [to.name, to.company, to.line1, to.line2, [to.city, to.state, to.postalCode].filter(Boolean).join(' '), to.country]
        .filter(Boolean)
        .map(escapeHtml)
        .join('\n')
      const rows = slip.lines
        .map(
          (line) =>
            `<tr><td>${escapeHtml(line.name)}</td><td>${escapeHtml(line.sku ?? '')}</td><td>${escapeHtml(line.quantity)}</td></tr>`,
        )
        .join('')
      return (
        `<section><h1>${escapeHtml(storeName)} — ${escapeHtml(slip.recordRef)}</h1>` +
        `<address>${address}</address>` +
        `<table><thead><tr><th>Item</th><th>SKU</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table></section>`
      )
    })
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slips</title><style>${PAGE_STYLE}</style></head><body>${sections}</body></html>`
}

export interface LabelSheetEntry {
  recordRef: string
  serviceLabel: string
  trackingNumber: string
  labelUrl: string
}

/** One page naming every label, each a link to its file; only https links are written. */
export function renderLabelSheet(entries: readonly LabelSheetEntry[]): string {
  const rows = entries
    .map((entry) => {
      const safe = /^https:\/\//.test(entry.labelUrl) ? escapeHtml(entry.labelUrl) : ''
      return (
        `<tr><td>${escapeHtml(entry.recordRef)}</td><td>${escapeHtml(entry.serviceLabel)}</td>` +
        `<td>${escapeHtml(entry.trackingNumber)}</td><td>${safe ? `<a href="${safe}" target="_blank" rel="noopener">Open label</a>` : ''}</td></tr>`
      )
    })
    .join('')
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>${PAGE_STYLE}</style></head><body>` +
    `<section><h1>Labels</h1><table><thead><tr><th>Order</th><th>Service</th><th>Tracking</th><th></th></tr></thead>` +
    `<tbody>${rows}</tbody></table></section></body></html>`
  )
}

/** Opens printable HTML in a tab of its own, without handing it this page. */
export function openPrintable(html: string): void {
  if (typeof window === 'undefined') return
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
