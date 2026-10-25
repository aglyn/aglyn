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
import type { WaiverStrokes } from './waiver-signature'

/*==========================================
 * THE SIGNED COPY AS A PDF (AGL-4042), written by hand so neither the server
 * nor a signer's email needs a PDF library: letter pages, the three standard
 * Helvetica faces in WinAnsi, the waiver's words wrapped to the page, the
 * signer's details, a drawn signature redrawn as vector strokes (sharper than
 * the stored picture) or a typed one in italics, and the audit trail. Pure,
 * so a spec reads the bytes it makes.
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

/** Helvetica advance widths, 1/1000 em, for the printable ASCII range 32–126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

/** Characters outside ASCII that WinAnsi holds at another code point. */
const WIN_ANSI: Record<string, number> = {
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '…': 0x85,
  '€': 0x80,
  '™': 0x99,
}

/** One character's WinAnsi byte, `?` for anything the standard fonts cannot draw. */
function winAnsiByte(char: string): number {
  const code = char.codePointAt(0) ?? 63
  if (code >= 32 && code <= 126) return code
  if (code >= 0xa0 && code <= 0xff) return code
  return WIN_ANSI[char] ?? 63
}

function charWidth(byte: number): number {
  if (byte >= 32 && byte <= 126) return HELVETICA_WIDTHS[byte - 32]
  if (byte === 0x95) return 350
  if (byte === 0x97 || byte === 0x85) return 1000
  return 556
}

/** A string's width in points at `size`; bold runs a little wider. */
export function textWidth(text: string, size: number, bold = false): number {
  let total = 0
  for (const char of text) total += charWidth(winAnsiByte(char))
  return (total / 1000) * size * (bold ? 1.07 : 1)
}

/** Words wrapped into lines no wider than `width`; an overlong word is broken. */
export function wrapText(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = []
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      while (textWidth(word, size, bold) > width) {
        let cut = word.length - 1
        while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > width) cut -= 1
        if (line) {
          lines.push(line)
          line = ''
        }
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const next = line ? `${line} ${word}` : word
      if (textWidth(next, size, bold) > width && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** A PDF string literal's body: WinAnsi bytes, with `\`, `(` and `)` escaped and the rest octal above ASCII. */
function pdfString(text: string): string {
  let out = ''
  for (const char of text) {
    const byte = winAnsiByte(char)
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) out += `\\${String.fromCharCode(byte)}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(byte)
  }
  return out
}

const num = (value: number) => (Math.round(value * 100) / 100).toString()

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

  // Objects: 1 catalog, 2 pages, 3–5 fonts, 6 info, then a page and its content per page.
  const objects: string[] = []
  const pageIds = layout.pages.map((_, index) => 7 + index * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'
  objects[6] = `<< /Title (${pdfString(input.title)}) /Producer (${pdfString(PLATFORM_BRAND_NAME)}) >>`
  layout.pages.forEach((ops, index) => {
    const pageId = pageIds[index]
    const stream = ops.join('\n')
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })

  // Every string above is single-byte (WinAnsi escapes are ASCII), so a
  // character offset is a byte offset.
  let out = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length)
  for (let index = 0; index < out.length; index += 1) bytes[index] = out.charCodeAt(index) & 0xff
  return bytes
}
