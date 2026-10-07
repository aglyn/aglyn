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

'use client'

import { Alert, Divider, Stack, Typography } from '@mui/material'
import {
  posShiftReportRows,
  type PosShift,
  type PosShiftReport,
} from '../../../model/commerce-pos-ops'
import { escapeHtml } from '../../../utils/escape-html'
import { POS_RECEIPT_STYLES } from './pos-receipt'

export { posShiftReportRows }

function Row(props: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color={props.strong ? 'text.primary' : 'text.secondary'}>
        {props.label}
      </Typography>
      <Typography variant={props.strong ? 'subtitle2' : 'body2'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {props.value}
      </Typography>
    </Stack>
  )
}

export interface PosShiftReportViewProps {
  report: PosShiftReport
  shift?: Pick<PosShift, 'countedCashCents' | 'varianceCents'>
}

/** An X report (mid-shift) or a Z report (closed), on screen. */
export function PosShiftReportView(props: PosShiftReportViewProps) {
  const sections = posShiftReportRows(props.report, props.shift)
  return (
    <Stack spacing={1.5}>
      {props.report.truncated ? (
        <Alert severity="warning">
          {'This shift had more sales than one report reads; the figures are partial.'}
        </Alert>
      ) : null}
      {sections.map((section, index) => (
        <Stack key={section.section} spacing={0.5}>
          {index > 0 ? <Divider /> : null}
          <Typography variant="overline">{section.section}</Typography>
          {section.rows.map((row) => (
            <Row key={row.label} {...row} />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}

PosShiftReportView.displayName = 'PosShiftReportView'

/** The report as a printable 80 mm document, for the receipt printer. */
export function posShiftReportDocument(input: {
  title: string
  storeName: string
  subtitle: string
  report: PosShiftReport
  shift?: Pick<PosShift, 'countedCashCents' | 'varianceCents'>
}): string {
  const sections = posShiftReportRows(input.report, input.shift)
  const body = sections
    .map(
      (section) =>
        `<hr class="rule"><div class="title">${escapeHtml(section.section.toUpperCase())}</div>` +
        section.rows
          .map(
            (row) =>
              `<div class="row${row.strong ? ' total' : ''}"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></div>`,
          )
          .join(''),
    )
    .join('')
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(input.title)}</title><style>${POS_RECEIPT_STYLES}</style></head><body>` +
    `<div class="receipt"><div class="center"><div class="store">${escapeHtml(input.storeName)}</div>` +
    `<div class="title">${escapeHtml(input.title)}</div><div class="muted">${escapeHtml(input.subtitle)}</div></div>` +
    `${body}</div></body></html>`
  )
}

/** Prints a document from a hidden frame, as the receipt does. */
export function printPosDocument(html: string): void {
  if (typeof document === 'undefined') return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0' })
  document.body.appendChild(frame)
  const win = frame.contentWindow
  const doc = frame.contentDocument ?? win?.document
  if (!win || !doc) return void frame.remove()
  doc.open()
  doc.write(html)
  doc.close()
  win.addEventListener('afterprint', () => window.setTimeout(() => frame.remove(), 1000), { once: true })
  win.focus()
  win.print()
  window.setTimeout(() => frame.isConnected && frame.remove(), 60_000)
}
