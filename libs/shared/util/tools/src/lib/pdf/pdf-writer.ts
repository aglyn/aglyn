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

import { rgbChannelsOfHex } from '../contrast'
import { buildPdfFile, pdfNumber, type PdfJpegImage, type PdfLinkArea } from './pdf-file'
import { measureText, pdfString, wrapLines, type PdfFont } from './pdf-text'

/*==========================================
 * A FLOWING PAGE LAYOUT over `buildPdfFile`: a cursor that moves down the
 * page and breaks onto a new one when the next thing would not fit.
 *
 * Coordinates are PDF points from the BOTTOM-left corner (72 to the inch).
 * `y` is the top of whatever is drawn next; the content area runs from the
 * top margin down to the bottom margin, and the footer sits in the bottom
 * margin, drawn when the document is finished and the page count is known.
 *
 * What it draws: text (left, right or centered, in a color), paragraphs that
 * wrap and run onto the next page, filled and stroked rectangles, rules, JPEG
 * images fitted to a box, clickable links, and tables whose cells wrap, whose
 * rows split across a page break when they must, and whose header row repeats
 * on every page the table reaches. Every string passes through the WinAnsi
 * mapping in `pdf-text.ts`, so no input can put a byte in a content stream
 * that the font cannot draw.
 *
 * Reached as `@aglyn/shared-util-tools/pdf/pdf-writer`.
 *=========================================*/

/** A color as red, green and blue from 0 to 1. */
export type PdfRgb = readonly [number, number, number]

/** `#rgb` / `#rrggbb` (alpha ignored) as a {@link PdfRgb}, or null for anything else. */
export function pdfRgbFromHex(hex: string | null | undefined): PdfRgb | null {
  const channels = typeof hex === 'string' ? rgbChannelsOfHex(hex) : null
  return channels ? [channels[0] / 255, channels[1] / 255, channels[2] / 255] : null
}

/** Black ink: what text is drawn in when a style names no color. */
const INK: PdfRgb = [0, 0, 0]

export type PdfAlign = 'left' | 'right' | 'center'

export interface PdfTextStyle {
  font?: PdfFont
  size?: number
  color?: PdfRgb
}

export interface PdfMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PdfWriterOptions {
  title: string
  producer?: string
  /** Points; US letter by default. */
  pageWidth?: number
  pageHeight?: number
  /** One number for all four sides, or each; 54 (three quarters of an inch) by default. */
  margin?: number | PdfMargins
  /** Runs at the top of every page after the first, before anything else is drawn on it. */
  onNewPage?: (writer: PdfWriter) => void
}

export interface PdfParagraphOptions {
  x?: number
  width?: number
  style?: PdfTextStyle
  /** Line height as a multiple of the font size; 1.35 by default. */
  leading?: number
  align?: PdfAlign
  /** Space left below the paragraph. */
  after?: number
  /** Each line drawn is also a link to this address. */
  link?: string
}

/** One paragraph inside a table cell, in its own style. */
export interface PdfCellText {
  text: string
  style?: PdfTextStyle
}

/** A table cell: one paragraph in the table's body style, or several, each styled. */
export type PdfTableCell = string | readonly PdfCellText[]

export interface PdfTableColumn {
  header: string
  /** Points; 0 shares out what the fixed columns leave. */
  width: number
  align?: PdfAlign
}

export interface PdfTableOptions {
  columns: readonly PdfTableColumn[]
  rows: ReadonlyArray<readonly PdfTableCell[]>
  x?: number
  width?: number
  headerStyle?: PdfTextStyle
  /** The header row's ground; none by default. */
  headerFill?: PdfRgb | null
  bodyStyle?: PdfTextStyle
  /** Space inside each cell. */
  padding?: { x: number; y: number }
  leading?: number
  /** A hairline under each row; none by default. */
  ruleColor?: PdfRgb | null
}

/** What the footer prints on one page, at its left, center and right. */
export interface PdfFooterText {
  left?: string
  center?: string
  right?: string
}

export interface PdfFinishOptions {
  footer?: (page: number, pageCount: number) => PdfFooterText | null
  footerStyle?: PdfTextStyle
  /** A hairline above the footer, in this color. */
  footerRule?: PdfRgb | null
}

interface Page {
  ops: string[]
  links: PdfLinkArea[]
}

const rgb = (color: PdfRgb) => color.map((channel) => pdfNumber(Math.min(1, Math.max(0, channel)))).join(' ')

const FONT_RESOURCE: Record<PdfFont, string> = { regular: 'F1', bold: 'F2', italic: 'F3' }

export class PdfWriter {
  readonly pageWidth: number
  readonly pageHeight: number
  readonly margin: PdfMargins
  /** The top of whatever is drawn next, in points from the bottom of the page. */
  y: number
  private readonly options: PdfWriterOptions
  private readonly pages: Page[] = []
  private readonly images: PdfJpegImage[] = []
  /** The page drawing goes to when it is not the last one (the footers, drawn at the end). */
  private target: Page | null = null

  constructor(options: PdfWriterOptions) {
    this.options = options
    this.pageWidth = options.pageWidth ?? 612
    this.pageHeight = options.pageHeight ?? 792
    const margin = options.margin ?? 54
    this.margin = typeof margin === 'number' ? { top: margin, right: margin, bottom: margin, left: margin } : margin
    this.pages.push({ ops: [], links: [] })
    this.y = this.top
  }

  /** Where content starts on a page. */
  get top(): number {
    return this.pageHeight - this.margin.top
  }

  /** Where content must stop on a page. */
  get bottom(): number {
    return this.margin.bottom
  }

  get left(): number {
    return this.margin.left
  }

  get right(): number {
    return this.pageWidth - this.margin.right
  }

  get contentWidth(): number {
    return this.right - this.left
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** What is left of this page below the cursor. */
  get room(): number {
    return this.y - this.bottom
  }

  private get page(): Page {
    return this.target ?? this.pages[this.pages.length - 1]
  }

  /** Starts a new page and puts the cursor at its top. */
  addPage(): void {
    this.pages.push({ ops: [], links: [] })
    this.y = this.top
    this.options.onNewPage?.(this)
  }

  /** Starts a new page when `height` would not fit below the cursor; true when it did. */
  ensure(height: number): boolean {
    if (this.y - height >= this.bottom) return false
    this.addPage()
    return true
  }

  /** Moves the cursor down. */
  down(points: number): void {
    this.y -= points
  }

  measure(text: string, style: PdfTextStyle = {}): number {
    return measureText(text, style.size ?? 10, style.font ?? 'regular')
  }

  wrap(text: string, width: number, style: PdfTextStyle = {}): string[] {
    return wrapLines(text, style.size ?? 10, width, style.font ?? 'regular')
  }

  /** A raw operator string on the current page. */
  raw(operators: string): void {
    this.page.ops.push(operators)
  }

  /** One line of text with its baseline at `y`. */
  text(x: number, y: number, text: string, style: PdfTextStyle = {}): void {
    const body = pdfString(text)
    if (!body) return
    const size = style.size ?? 10
    this.page.ops.push(
      `BT ${rgb(style.color ?? INK)} rg /${FONT_RESOURCE[style.font ?? 'regular']} ${pdfNumber(size)} Tf ` +
        `${pdfNumber(x)} ${pdfNumber(y)} Td (${body}) Tj ET`,
    )
  }

  /** One line of text placed in the span from `x` across `width` by `align`. */
  textIn(x: number, width: number, y: number, text: string, style: PdfTextStyle = {}, align: PdfAlign = 'left'): void {
    const measured = this.measure(text, style)
    const at = align === 'right' ? x + width - measured : align === 'center' ? x + (width - measured) / 2 : x
    this.text(at, y, text, style)
  }

  fillRect(x: number, y: number, width: number, height: number, color: PdfRgb): void {
    this.page.ops.push(`q ${rgb(color)} rg ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re f Q`)
  }

  strokeRect(x: number, y: number, width: number, height: number, color: PdfRgb, lineWidth = 0.75): void {
    this.page.ops.push(
      `q ${rgb(color)} RG ${pdfNumber(lineWidth)} w ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re S Q`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, color: PdfRgb, lineWidth = 0.75): void {
    this.page.ops.push(
      `q ${rgb(color)} RG ${pdfNumber(lineWidth)} w ${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l S Q`,
    )
  }

  /** A clickable area opening `url` (web and mail addresses only). */
  link(x: number, y: number, width: number, height: number, url: string): void {
    this.page.links.push({ x, y, width, height, url })
  }

  /**
   * A JPEG fitted into the box whose bottom-left is (`x`, `y`): `contain`
   * keeps its shape inside the box (placed by `align`, at the box's top),
   * `fill` stretches it to the box. Returns where it was drawn.
   */
  image(
    image: PdfJpegImage,
    box: { x: number; y: number; width: number; height: number },
    options: { fit?: 'contain' | 'fill'; align?: PdfAlign } = {},
  ): { x: number; y: number; width: number; height: number } {
    let index = this.images.indexOf(image)
    if (index < 0) {
      this.images.push(image)
      index = this.images.length - 1
    }
    let { x, y, width, height } = box
    if ((options.fit ?? 'contain') === 'contain') {
      const scale = Math.min(box.width / image.width, box.height / image.height)
      width = image.width * scale
      height = image.height * scale
      const align = options.align ?? 'left'
      x = align === 'right' ? box.x + box.width - width : align === 'center' ? box.x + (box.width - width) / 2 : box.x
      y = box.y + box.height - height
    }
    this.page.ops.push(
      `q ${pdfNumber(width)} 0 0 ${pdfNumber(height)} ${pdfNumber(x)} ${pdfNumber(y)} cm /Im${index + 1} Do Q`,
    )
    return { x, y, width, height }
  }

  /** Wrapped text from the cursor down, onto further pages as needed. */
  paragraph(text: string, options: PdfParagraphOptions = {}): void {
    const style = options.style ?? {}
    const size = style.size ?? 10
    const leading = size * (options.leading ?? 1.35)
    const x = options.x ?? this.left
    const width = options.width ?? this.right - x
    for (const line of this.wrap(text, width, style)) {
      this.ensure(leading)
      this.y -= leading
      if (!line) continue
      // The baseline sits a fifth of the line above its bottom, so descenders clear the next line.
      const baseline = this.y + (leading - size) / 2 + size * 0.2
      this.textIn(x, width, baseline, line, style, options.align)
      if (options.link) {
        const measured = this.measure(line, style)
        const at = options.align === 'right' ? x + width - measured : options.align === 'center' ? x + (width - measured) / 2 : x
        this.link(at, this.y, measured, leading, options.link)
      }
    }
    this.y -= options.after ?? 0
  }

  /**
   * A table from the cursor down. Cells wrap to their column; a row moves to
   * the next page whole when it fits on one, and splits between its lines
   * when it is taller than a page. The header row is drawn again at the top
   * of every page the table reaches.
   */
  table(options: PdfTableOptions): void {
    const x = options.x ?? this.left
    const width = options.width ?? this.right - x
    const padding = options.padding ?? { x: 6, y: 5 }
    const leadingRatio = options.leading ?? 1.3
    const bodyStyle = options.bodyStyle ?? {}
    const headerStyle = options.headerStyle ?? { font: 'bold', size: bodyStyle.size ?? 10 }
    const fixed = options.columns.reduce((sum, column) => sum + Math.max(0, column.width), 0)
    const flexible = options.columns.filter((column) => !(column.width > 0)).length
    const share = flexible ? Math.max(0, width - fixed) / flexible : 0
    const widths = options.columns.map((column) => (column.width > 0 ? column.width : share))
    const lefts = widths.map((_, index) => x + widths.slice(0, index).reduce((sum, value) => sum + value, 0))

    type Line = { text: string; style: PdfTextStyle; height: number }
    const cellLines = (cell: PdfTableCell, column: number): Line[] => {
      const parts = typeof cell === 'string' ? [{ text: cell, style: bodyStyle }] : cell
      const lines: Line[] = []
      for (const part of parts) {
        const style = { ...bodyStyle, ...(part.style ?? {}) }
        const height = (style.size ?? 10) * leadingRatio
        for (const text of this.wrap(part.text, widths[column] - padding.x * 2, style)) lines.push({ text, style, height })
      }
      return lines
    }

    const headerSize = headerStyle.size ?? 10
    const headerHeight = headerSize * leadingRatio + padding.y * 2
    const drawHeader = () => {
      if (options.headerFill) this.fillRect(x, this.y - headerHeight, width, headerHeight, options.headerFill)
      const baseline = this.y - padding.y - headerSize * leadingRatio + (headerSize * leadingRatio - headerSize) / 2 + headerSize * 0.2
      options.columns.forEach((column, index) => {
        this.textIn(lefts[index] + padding.x, widths[index] - padding.x * 2, baseline, column.header, headerStyle, column.align)
      })
      this.y -= headerHeight
    }
    const startPage = () => {
      this.addPage()
      drawHeader()
    }
    const drawLines = (cells: Line[][], height: number) => {
      const top = this.y
      cells.forEach((lines, index) => {
        let y = top - padding.y
        for (const line of lines) {
          y -= line.height
          const size = line.style.size ?? 10
          const baseline = y + (line.height - size) / 2 + size * 0.2
          if (line.text) {
            this.textIn(lefts[index] + padding.x, widths[index] - padding.x * 2, baseline, line.text, line.style, options.columns[index].align)
          }
        }
      })
      this.y = top - height
      if (options.ruleColor) this.line(x, this.y, x + width, this.y, options.ruleColor, 0.5)
    }
    const heightOf = (lines: Line[]) => lines.reduce((sum, line) => sum + line.height, 0)

    // The header and one line of the first row go together.
    const firstLine = (bodyStyle.size ?? 10) * leadingRatio
    if (this.room < headerHeight + firstLine + padding.y * 2) this.addPage()
    drawHeader()
    const freshRoom = this.top - headerHeight - this.bottom
    for (const row of options.rows) {
      let remaining = options.columns.map((_, index) => cellLines(row[index] ?? '', index))
      const whole = Math.max(...remaining.map(heightOf)) + padding.y * 2
      if (whole > this.room && whole <= freshRoom) startPage()
      let fresh = false
      while (remaining.some((lines) => lines.length)) {
        const fits = this.room - padding.y * 2
        const tallest = Math.max(...remaining.map(heightOf))
        if (tallest <= fits) {
          drawLines(remaining, tallest + padding.y * 2)
          break
        }
        let taken = remaining.map((lines) => {
          let used = 0
          let count = 0
          while (count < lines.length && used + lines[count].height <= fits) used += lines[count++].height
          return count
        })
        if (taken.every((count) => count === 0)) {
          if (!fresh) {
            startPage()
            fresh = true
            continue
          }
          // Not one line fits even a fresh page: draw a line of each cell anyway, so the table always ends.
          taken = remaining.map((lines) => Math.min(1, lines.length))
        }
        const chunk = remaining.map((lines, index) => lines.slice(0, taken[index]))
        drawLines(chunk, Math.max(...chunk.map(heightOf)) + padding.y * 2)
        remaining = remaining.map((lines, index) => lines.slice(taken[index]))
        startPage()
        fresh = true
      }
    }
  }

  /** The finished file, with each page's footer drawn now that the page count is known. */
  finish(options: PdfFinishOptions = {}): Uint8Array {
    const total = this.pages.length
    if (options.footer) {
      const style: PdfTextStyle = { size: 8, ...(options.footerStyle ?? {}) }
      const baseline = this.margin.bottom / 2
      this.pages.forEach((page, index) => {
        const footer = options.footer?.(index + 1, total)
        if (!footer) return
        this.target = page
        if (options.footerRule) this.line(this.left, baseline + 12, this.right, baseline + 12, options.footerRule, 0.5)
        if (footer.left) this.textIn(this.left, this.contentWidth, baseline, footer.left, style, 'left')
        if (footer.center) this.textIn(this.left, this.contentWidth, baseline, footer.center, style, 'center')
        if (footer.right) this.textIn(this.left, this.contentWidth, baseline, footer.right, style, 'right')
      })
      this.target = null
    }
    return buildPdfFile({
      title: this.options.title,
      ...(this.options.producer !== undefined ? { producer: this.options.producer } : {}),
      images: this.images,
      pages: this.pages.map((page) => ({
        width: this.pageWidth,
        height: this.pageHeight,
        content: page.ops.join('\n'),
        links: page.links,
      })),
    })
  }
}
