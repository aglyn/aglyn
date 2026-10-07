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

import { toPrintable, type PrintDocument } from './print-document'

/**
 * ePOS-Print XML for a {@link PrintDocument} (AGL-3619), wrapped in the
 * Server Direct Print response an Epson TM printer receives when it polls.
 *
 * `<PrintRequestInfo Version="2.00">` so the job carries a `printjobid` that
 * the printer echoes back in its result: the only way to tell which job a
 * `SetResponse` is about when a printer has had more than one.
 */
export const EPOS_PRINT_NAMESPACE = 'http://www.epson-pos.com/schemas/2011/03/epos-print'

/** The drawer kick on its own: pin 2, a 100 ms pulse. */
export const EPSON_DRAWER_KICK = '<pulse drawer="drawer_1" time="pulse_100"/>'

/** Print job ids are 1-30 of `A-Z a-z 0-9 - _ .`; a Firestore id is 20 of them. */
export function epsonJobId(jobId: string): string {
  return String(jobId).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 30)
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Epson's two-byte NV logo key, `48,48` → `[48, 48]`; anything else prints no logo. */
export function epsonLogoKeys(logoKey: string | undefined): [number, number] | null {
  const parts = String(logoKey ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length !== 2) return null
  return parts.every((part) => Number.isInteger(part) && part >= 32 && part <= 126)
    ? [parts[0], parts[1]]
    : null
}

/** The `<epos-print>` element alone. */
export function renderEposPrint(document: PrintDocument, options: { logoKey?: string } = {}): string {
  const parts: string[] = [`<epos-print xmlns="${EPOS_PRINT_NAMESPACE}">`, '<text lang="en" smooth="true"/>']
  const logo = epsonLogoKeys(options.logoKey)
  let align = 'left'
  let bold = false
  let size = 1
  const setAlign = (next: string) => {
    if (next === align) return
    parts.push(`<text align="${next}"/>`)
    align = next
  }
  for (const op of document.ops) {
    switch (op.op) {
      case 'text': {
        setAlign(op.align ?? 'left')
        const nextSize = op.size === 2 ? 2 : 1
        if (nextSize !== size) {
          parts.push(`<text width="${nextSize}" height="${nextSize}"/>`)
          size = nextSize
        }
        const nextBold = Boolean(op.bold)
        if (nextBold !== bold) {
          parts.push(`<text em="${nextBold}"/>`)
          bold = nextBold
        }
        parts.push(`<text>${escapeXml(toPrintable(op.text))}&#10;</text>`)
        break
      }
      case 'feed':
        parts.push(`<feed line="${Math.max(1, Math.min(10, op.lines))}"/>`)
        break
      case 'barcode':
        setAlign('center')
        // `{B` selects code set B, which carries printable ASCII.
        parts.push(
          `<barcode type="code128" hri="below" font="font_a" width="2" height="64">` +
            `${escapeXml(`{B${toPrintable(op.data)}`)}</barcode>`,
          '<feed/>',
        )
        break
      case 'logo':
        if (logo) {
          setAlign('center')
          parts.push(`<logo key1="${logo[0]}" key2="${logo[1]}"/>`)
        }
        break
      case 'drawer':
        parts.push(EPSON_DRAWER_KICK)
        break
      case 'cut':
        parts.push('<cut type="feed"/>')
        break
    }
  }
  parts.push('</epos-print>')
  return parts.join('')
}

/** The whole Server Direct Print response body for one job. */
export function renderEpsonServerDirectPrint(
  document: PrintDocument,
  options: { jobId: string; logoKey?: string; timeoutMs?: number },
): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<PrintRequestInfo Version="2.00">' +
    '<ePOSPrint>' +
    '<Parameter>' +
    '<devid>local_printer</devid>' +
    `<timeout>${Math.round(options.timeoutMs ?? 10000)}</timeout>` +
    `<printjobid>${escapeXml(epsonJobId(options.jobId))}</printjobid>` +
    '</Parameter>' +
    `<PrintData>${renderEposPrint(document, options)}</PrintData>` +
    '</ePOSPrint>' +
    '</PrintRequestInfo>'
  )
}

export interface EpsonPrintResult {
  jobId: string
  success: boolean
  code: string
  status?: number
}

const attribute = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1]

/**
 * The results in a printer's `ResponseFile` (`<PrintResponseInfo>`), one per
 * `<ePOSPrint>`. Read with patterns rather than an XML parser: the document is
 * small, machine-written and fixed in shape, and nothing in it is trusted
 * beyond the job id (looked up under the printer that posted it) and the
 * result it reports for that job.
 */
export function parseEpsonPrintResults(responseFile: string): EpsonPrintResult[] {
  const xml = String(responseFile ?? '').slice(0, 64 * 1024)
  const results: EpsonPrintResult[] = []
  for (const block of xml.match(/<ePOSPrint\b[\s\S]*?<\/ePOSPrint>/g) ?? []) {
    const jobId = block.match(/<printjobid>\s*([^<]*?)\s*<\/printjobid>/)?.[1] ?? ''
    const response = block.match(/<response\b[^>]*>/)?.[0]
    if (!jobId || !response) continue
    const status = Number(attribute(response, 'status'))
    results.push({
      jobId,
      success: /^(true|1)$/i.test(attribute(response, 'success') ?? ''),
      code: attribute(response, 'code') ?? '',
      ...(Number.isFinite(status) ? { status } : {}),
    })
  }
  return results
}
