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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { buildPdfFile, pdfNumber } from '@aglyn/shared-util-tools/pdf/pdf-file'
import { pdfString, wrapText } from '@aglyn/shared-util-tools/pdf/pdf-text'
import type { WaiverStrokes } from './waiver-signature'

/*==========================================
 * THE SIGNED COPY AS A PDF (AGL-4042), written by hand so neither the server
 * nor a signer's email needs a PDF library: letter pages, the three standard
 * Helvetica faces in WinAnsi, the waiver's words wrapped to the page, the
 * signer's details, a drawn signature redrawn as vector strokes (sharper than
 * the stored picture) or a typed one in italics, and the audit trail. Pure,
 * so a spec reads the bytes it makes.
 *
 * The text encoding, the widths it wraps by and the file itself come from the
 * shared writer (`@aglyn/shared-util-tools/pdf/*`); the layout is this
 * document's own. It wraps by the writer's quick estimate (`wrapText`), so
 * the same signature always makes the same bytes.
 *=========================================*/

export interface WaiverPdfInput {
  businessName: string
  title: string
  version: number
  /** The waiver's words as plain text, paragraphs split by blank lines. */
  bodyText: string
  checkboxes: readonly string[]
  validityText: string
  signerLines: ReadonlyArray<readonly [string, string]>
  minors: ReadonlyArray<{ name: string; dateOfBirth: string }>
  relationship: string | null
  signature: { kind: 'drawn'; strokes: WaiverStrokes } | { kind: 'typed'; text: string } | { kind: 'paper' }
  consentText: string | null
  auditLines: ReadonlyArray<readonly [string, string]>
  sha256: string
  /** Set when the signature was voided: printed across the top. */
  voidedText?: string | null
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_SPACE = 36

const num = pdfNumber

type Font = 'F1' | 'F2' | 'F3'

class Layout {
  pages: string[][] = [[]]
  y = PAGE_HEIGHT - MARGIN

  private get ops(): string[] {
    return this.pages[this.pages.length - 1]
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.pages.push([])
      this.y = PAGE_HEIGHT - MARGIN
    }
  }

  text(x: number, y: number, text: string, font: Font, size: number, gray = 0): void {
    this.ops.push(
      `BT ${num(gray)} g /${font} ${num(size)} Tf ${num(x)} ${num(y)} Td (${pdfString(text)}) Tj ET`,
    )
  }

  paragraph(text: string, options: { font?: Font; size?: number; gap?: number; gray?: number; indent?: number } = {}): void {
    const font = options.font ?? 'F1'
    const size = options.size ?? 10
    const leading = size * 1.4
    const indent = options.indent ?? 0
    for (const line of wrapText(text, size, CONTENT_WIDTH - indent, font === 'F2')) {
      this.ensure(leading)
      this.y -= leading
      if (line) this.text(MARGIN + indent, this.y, line, font, size, options.gray ?? 0)
    }
    this.y -= options.gap ?? 6
  }

  heading(text: string, size = 12): void {
    this.ensure(size * 3)
    this.y -= 6
    this.paragraph(text, { font: 'F2', size, gap: 4 })
  }

  rule(): void {
    this.ensure(12)
    this.y -= 6
    this.ops.push(`0.8 G 0.5 w ${MARGIN} ${num(this.y)} m ${MARGIN + CONTENT_WIDTH} ${num(this.y)} l S 0 G`)
    this.y -= 6
  }

  pairs(lines: ReadonlyArray<readonly [string, string]>, size = 9.5): void {
    const labelWidth = 120
    for (const [label, value] of lines) {
      const wrapped = wrapText(value || '—', size, CONTENT_WIDTH - labelWidth)
      const leading = size * 1.4
      this.ensure(leading * wrapped.length)
      wrapped.forEach((line, index) => {
        this.y -= leading
        if (index === 0) this.text(MARGIN, this.y, label, 'F2', size, 0.25)
        this.text(MARGIN + labelWidth, this.y, line, 'F1', size)
      })
    }
    this.y -= 6
  }

  signatureBox(signature: WaiverPdfInput['signature']): void {
    const height = 90
    this.ensure(height + 20)
    this.y -= height
    const top = this.y + height
    this.ops.push(`0.6 G 0.75 w ${MARGIN} ${num(this.y)} ${num(CONTENT_WIDTH * 0.6)} ${height} re S 0 G`)
    if (signature.kind === 'drawn') {
      const boxWidth = CONTENT_WIDTH * 0.6 - 16
      const boxHeight = height - 16
      const path: string[] = ['1 J 1 j 1.4 w 0 G']
      for (const stroke of signature.strokes) {
        stroke.forEach(([x, y], index) => {
          const px = MARGIN + 8 + (x / 1000) * boxWidth
          const py = top - 8 - (y / 1000) * boxHeight
          path.push(`${num(px)} ${num(py)} ${index === 0 ? 'm' : 'l'}`)
        })
        if (stroke.length === 1) {
          const [x, y] = stroke[0]
          path.push(`${num(MARGIN + 8 + (x / 1000) * boxWidth + 0.5)} ${num(top - 8 - (y / 1000) * boxHeight)} l`)
        }
        path.push('S')
      }
      this.ops.push(path.join(' '))
    } else if (signature.kind === 'typed') {
      this.text(MARGIN + 12, this.y + height / 2 - 8, signature.text, 'F3', 24)
    } else {
      this.text(MARGIN + 12, this.y + height / 2 - 4, 'Signed on paper. A photo of the page is kept with this record.', 'F3', 10, 0.3)
    }
    this.y -= 10
  }
}

/** The bytes of a signed copy. */
export function renderWaiverPdf(input: WaiverPdfInput): Uint8Array {
  const layout = new Layout()
  if (input.voidedText) layout.paragraph(input.voidedText, { font: 'F2', size: 11, gap: 8 })
  layout.paragraph(input.businessName, { size: 9, gray: 0.35, gap: 2 })
  layout.paragraph(input.title, { font: 'F2', size: 18, gap: 2 })
  layout.paragraph(`Version ${input.version} · ${input.validityText}`, { size: 9, gray: 0.35, gap: 10 })
  for (const paragraph of input.bodyText.split(/\n{2,}/)) layout.paragraph(paragraph, { size: 10, gap: 6 })
  if (input.checkboxes.length) {
    layout.heading('Agreed')
    for (const box of input.checkboxes) layout.paragraph(`[x] ${box}`, { size: 10, gap: 3 })
  }
  layout.rule()
  layout.heading('Signer')
  layout.pairs(input.signerLines)
  if (input.minors.length) {
    layout.heading(`Signed for ${input.minors.length === 1 ? 'a minor' : `${input.minors.length} minors`}`)
    layout.pairs([
      ...input.minors.map((minor, index) => [`Minor ${index + 1}`, `${minor.name}, born ${minor.dateOfBirth}`] as const),
      ['Relationship', input.relationship ?? ''],
    ])
  }
  layout.heading('Signature')
  layout.signatureBox(input.signature)
  if (input.consentText) {
    layout.heading('Consent to sign electronically', 10)
    layout.paragraph(input.consentText, { size: 9, gray: 0.2 })
  }
  layout.rule()
  layout.heading('Audit trail', 10)
  layout.pairs([...input.auditLines, ['Text fingerprint', `SHA-256 ${input.sha256}`]], 8.5)

  const total = layout.pages.length
  layout.pages.forEach((ops, index) => {
    ops.push(
      `BT 0.45 g /F1 7.5 Tf ${MARGIN} ${MARGIN - 18} Td (${pdfString(
        `${input.title} · signed copy · page ${index + 1} of ${total}`,
      )}) Tj ET`,
    )
  })

  return buildPdfFile({
    title: input.title,
    producer: PLATFORM_BRAND_NAME,
    pages: layout.pages.map((ops) => ({ width: PAGE_WIDTH, height: PAGE_HEIGHT, content: ops.join('\n') })),
  })
}
