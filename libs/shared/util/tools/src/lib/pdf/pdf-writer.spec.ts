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

import { buildPdfFile, pdfUri, readJpeg, type PdfJpegImage } from './pdf-file'
import { measureText, pdfString, textWidth, toWinAnsiText, winAnsiByte, wrapLines } from './pdf-text'
import { PdfWriter, pdfRgbFromHex } from './pdf-writer'

/** The bytes as one character per byte, which is how a PDF's structure reads. */
const text = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/** A minimal baseline JPEG header: SOI, an APP0, then a frame of `width`×`height` with `components`. */
function fakeJpeg(width: number, height: number, components = 3, extra: number[] = []): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...extra,
    0xff, 0xc0, 0x00, 8 + components * 3, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, components,
    ...Array.from({ length: components * 3 }, () => 0x11),
    0xff, 0xda, 0x00, 0x02,
    0x12, 0x34, 0x56,
    0xff, 0xd9,
  ])
}

/** Every `n 0 obj` the cross-reference table points at, checked against the bytes at that offset. */
function expectValidXref(pdf: string) {
  expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
  expect(pdf.endsWith('%%EOF\n')).toBe(true)
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1])
  expect(pdf.slice(startxref, startxref + 4)).toBe('xref')
  const size = Number(/\/Size (\d+)/.exec(pdf)?.[1])
  const offsets = pdf
    .slice(startxref)
    .split('\n')
    .filter((line) => /^\d{10} 00000 n $/.test(line))
    .map((line) => Number(line.slice(0, 10)))
  expect(offsets).toHaveLength(size - 1)
  offsets.forEach((offset, index) => {
    expect(pdf.slice(offset, offset + `${index + 1} 0 obj\n`.length)).toBe(`${index + 1} 0 obj\n`)
  })
  // Each stream's /Length is the count of bytes between `stream\n` and `\nendstream`.
  for (const match of pdf.matchAll(/\/Length (\d+)[^]*?>>\nstream\n/g)) {
    const start = (match.index ?? 0) + match[0].length
    expect(pdf.slice(start + Number(match[1]), start + Number(match[1]) + 10)).toBe('\nendstream')
  }
}

/** The text of every content stream in the file. */
const contents = (pdf: string) =>
  [...pdf.matchAll(/<< \/Length \d+ >>\nstream\n([^]*?)\nendstream/g)].map((match) => match[1]).join('\n')

describe('WinAnsi text', () => {
  it('keeps Latin-1 and the WinAnsi marks as they are', () => {
    const latin = 'Café Zoë — “quoted” ‘single’ • … € ™ Š Œ ƒ ‰ ½ ×'
    expect(toWinAnsiText(latin)).toBe(latin)
    expect(winAnsiByte('€')).toBe(0x80)
    expect(winAnsiByte('Š')).toBe(0x8a)
    expect(winAnsiByte('é')).toBe(0xe9)
  })

  it('swaps a look-alike in, drops accents it cannot draw, and drops emoji', () => {
    expect(toWinAnsiText('Łódź → Kraków − 5 ≥ 3')).toBe('Lódz -> Kraków - 5 >= 3')
    expect(toWinAnsiText('Ştefan Ăn ﬁne Ａ')).toBe('Stefan An fine A')
    expect(toWinAnsiText('Party 🎉✨ time​!')).toBe('Party  time!')
    expect(toWinAnsiText('tab\there\r\nnext')).toBe('tab here\nnext')
    expect(toWinAnsiText('₹1,200 ₩300')).toBe('Rs1,200 W300')
  })

  it('prints a question mark for a script the standard fonts do not have', () => {
    expect(toWinAnsiText('日本 Ωμέγα')).toBe('?? ?????')
  })

  it('reads text already decomposed as the composed character', () => {
    expect(toWinAnsiText('Café')).toBe('Café')
  })

  it('escapes a string literal to plain ASCII', () => {
    expect(pdfString('a (b) \\ c')).toBe('a \\(b\\) \\\\ c')
    expect(pdfString('é—€')).toBe('\\351\\227\\200')
    expect(pdfString('🎉')).toBe('')
    expect(pdfString('line\nbreak')).toBe('line break')
    for (const sample of ['日本語', 'Ωμέγα', '😀👍🏽', '\u0000\u0007\u001b', '\ud800']) {
      expect([...pdfString(sample)].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) < 127)).toBe(true)
    }
  })

  it('measures by Helvetica’s own widths, bold wider where its glyphs are', () => {
    expect(measureText('1,234.56', 10)).toBeCloseTo(((556 * 6 + 278 * 2) / 1000) * 10)
    // Digits are the same width in both weights, so totals line up in a column.
    expect(measureText('$1,234.56', 10, 'bold')).toBeCloseTo(measureText('$1,234.56', 10))
    expect(measureText('Total', 10, 'bold')).toBeGreaterThan(measureText('Total', 10))
    expect(measureText('é', 10)).toBeCloseTo(5.56)
  })

  it('wraps to a width by those widths and breaks a word longer than a line', () => {
    const lines = wrapLines('alpha beta gamma delta epsilon zeta', 10, 60)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(measureText(line, 10)).toBeLessThanOrEqual(60)
    expect(wrapLines('x'.repeat(200), 10, 100).length).toBeGreaterThan(1)
    expect(wrapLines('one\n\ntwo', 10, 200)).toEqual(['one', '', 'two'])
  })

  it('keeps the quick estimate the first document wraps by', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(((722 + 556 + 222 + 222 + 556) / 1000) * 10)
    expect(textWidth('Hello', 10, true)).toBeCloseTo(textWidth('Hello', 10) * 1.07)
    expect(textWidth('é', 10)).toBeCloseTo(5.56)
  })
})

describe('JPEG images', () => {
  it('reads the size and channels from the frame header', () => {
    expect(readJpeg(fakeJpeg(640, 200))).toEqual(expect.objectContaining({ width: 640, height: 200, components: 3 }))
    expect(readJpeg(fakeJpeg(10, 20, 1))?.components).toBe(1)
    const adobe = [0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x02]
    expect(readJpeg(fakeJpeg(10, 20, 4, adobe))).toEqual(expect.objectContaining({ components: 4, invertedCmyk: true }))
  })

  it('refuses bytes that are not a JPEG it can place', () => {
    expect(readJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(readJpeg(fakeJpeg(10, 10, 2))).toBeNull()
    expect(readJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBeNull()
  })

  it('embeds the bytes untouched as a DCTDecode image the page draws', () => {
    const jpeg = readJpeg(fakeJpeg(300, 100)) as PdfJpegImage
    const writer = new PdfWriter({ title: 'Logo' })
    const drawn = writer.image(jpeg, { x: 54, y: 600, width: 150, height: 150 })
    // Contained: the 3:1 image is 150 wide and 50 tall, at the top of its box.
    expect(drawn).toEqual({ x: 54, y: 700, width: 150, height: 50 })
    const bytes = writer.finish()
    const pdf = text(bytes)
    expectValidXref(pdf)
    expect(pdf).toContain('/XObject << /Im1 9 0 R >>')
    expect(pdf).toContain('/Subtype /Image /Width 300 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode')
    expect(pdf).toContain('150 0 0 50 54 700 cm /Im1 Do')
    expect(pdf).toContain(text(jpeg.bytes))
  })

  it('places a contained image at the right or the center of its box', () => {
    const jpeg = readJpeg(fakeJpeg(100, 100)) as PdfJpegImage
    const writer = new PdfWriter({ title: 'Logo' })
    expect(writer.image(jpeg, { x: 0, y: 0, width: 200, height: 50 }, { align: 'right' })).toEqual({ x: 150, y: 0, width: 50, height: 50 })
    expect(writer.image(jpeg, { x: 0, y: 0, width: 200, height: 50 }, { align: 'center' }).x).toBe(75)
    expect(writer.image(jpeg, { x: 0, y: 0, width: 200, height: 50 }, { fit: 'fill' })).toEqual({ x: 0, y: 0, width: 200, height: 50 })
  })
})

describe('the writer', () => {
  it('makes a well-formed file whose cross-reference table points at every object', () => {
    const writer = new PdfWriter({ title: 'Empty (test)', producer: 'Tests' })
    writer.text(54, 700, 'Hello')
    const pdf = text(writer.finish())
    expectValidXref(pdf)
    expect(pdf).toContain('<< /Title (Empty \\(test\\)) /Producer (Tests) >>')
    expect(contents(pdf)).toContain('BT 0 0 0 rg /F1 10 Tf 54 700 Td (Hello) Tj ET')
  })

  it('leaves the producer out when none is given', () => {
    expect(text(new PdfWriter({ title: 'Plain' }).finish())).toContain('<< /Title (Plain) >>')
  })

  it('draws text in a color, right-aligned and centered by the exact widths', () => {
    const writer = new PdfWriter({ title: 'Align' })
    const blue = pdfRgbFromHex('#1976d2')
    expect(blue).toEqual([25 / 255, 118 / 255, 210 / 255])
    writer.textIn(100, 200, 500, '$12.00', { color: blue ?? undefined, font: 'bold' }, 'right')
    writer.textIn(100, 200, 480, 'Mid', {}, 'center')
    const stream = contents(text(writer.finish()))
    const width = measureText('$12.00', 10, 'bold')
    expect(stream).toContain(`BT 0.1 0.46 0.82 rg /F2 10 Tf ${Math.round((300 - width) * 100) / 100} 500 Td ($12.00) Tj ET`)
    expect(stream).toContain(`${Math.round((100 + (200 - measureText('Mid', 10)) / 2) * 100) / 100} 480 Td (Mid) Tj`)
  })

  it('fills rectangles and draws rules in a given color', () => {
    const writer = new PdfWriter({ title: 'Shapes' })
    writer.fillRect(0, 782, 612, 10, [1, 0.5, 0])
    writer.line(54, 400, 558, 400, [0.8, 0.8, 0.8], 0.5)
    writer.strokeRect(10, 10, 20, 20, [0, 0, 1])
    const stream = contents(text(writer.finish()))
    expect(stream).toContain('q 1 0.5 0 rg 0 782 612 10 re f Q')
    expect(stream).toContain('q 0.8 0.8 0.8 RG 0.5 w 54 400 m 558 400 l S Q')
    expect(stream).toContain('q 0 0 1 RG 0.75 w 10 10 20 20 re S Q')
  })

  it('makes a link a URI annotation on its page, and refuses other schemes', () => {
    const writer = new PdfWriter({ title: 'Links' })
    writer.link(54, 100, 200, 14, 'https://shop.example.com/pay-quote?q=a1&t=1.ab(c)')
    writer.link(54, 80, 200, 14, 'javascript:alert(1)')
    const pdf = text(writer.finish())
    expectValidXref(pdf)
    expect(pdf).toContain('/Annots [9 0 R]')
    expect(pdf).toContain('<< /Type /Annot /Subtype /Link /Rect [54 100 254 114] /Border [0 0 0] /A << /Type /Action /S /URI /URI (https://shop.example.com/pay-quote?q=a1&t=1.ab\\(c\\)) >> >>')
    expect(pdf).not.toContain('javascript')
    expect(pdfUri('https://example.com/é')).toBe('https://example.com/%C3%A9')
  })

  it('runs a paragraph onto further pages and numbers each in the footer', () => {
    const writer = new PdfWriter({ title: 'Long', margin: 54 })
    writer.paragraph(Array(400).fill('A sentence that keeps going.').join(' '), { style: { size: 10 } })
    const pdf = text(
      writer.finish({ footer: (page, total) => ({ left: 'Long document', right: `Page ${page} of ${total}` }) }),
    )
    expectValidXref(pdf)
    const count = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(count).toBeGreaterThan(1)
    expect(writer.pageCount).toBe(count)
    expect(pdf).toContain(`(Page 1 of ${count}) Tj`)
    expect(pdf).toContain(`(Page ${count} of ${count}) Tj`)
  })

  it('calls back at the top of every page after the first', () => {
    const started: number[] = []
    const writer = new PdfWriter({
      title: 'Hook',
      onNewPage: (current) => {
        started.push(current.pageCount)
        current.text(current.left, current.top - 10, `continued ${current.pageCount}`)
        current.down(20)
      },
    })
    writer.paragraph(Array(300).fill('word').join('\n'))
    expect(started[0]).toBe(2)
    expect(started.length).toBe(writer.pageCount - 1)
    expect(text(writer.finish())).toContain('(continued 2) Tj')
  })
})

describe('tables', () => {
  const columns = [
    { header: 'Item', width: 0 },
    { header: 'Qty', width: 50, align: 'right' as const },
    { header: 'Amount', width: 90, align: 'right' as const },
  ]

  it('wraps a cell within its column and lines amounts up on the right edge', () => {
    const writer = new PdfWriter({ title: 'Table' })
    writer.table({
      columns,
      rows: [[[{ text: 'Banner', style: { font: 'bold' } }, { text: 'Vinyl, '.repeat(30), style: { size: 8 } }], '2', '$1,250.00']],
      headerFill: [0.1, 0.4, 0.8],
      headerStyle: { font: 'bold', size: 9, color: [1, 1, 1] },
      ruleColor: [0.9, 0.9, 0.9],
    })
    const stream = contents(text(writer.finish()))
    expect(stream).toMatch(/q 0.1 0.4 0.8 rg 54 \d+(\.\d+)? 504 [\d.]+ re f Q/)
    expect(stream).toContain('/F2 9 Tf')
    expect((stream.match(/\(Vinyl,/g) ?? []).length).toBeGreaterThan(1)
    // Right-aligned inside the last column's padding: the text ends 6pt short of 558.
    const right = 558 - 6 - measureText('$1,250.00', 10)
    expect(stream).toContain(`${Math.round(right * 100) / 100}`)
  })

  it('repeats the header on every page the table reaches', () => {
    const writer = new PdfWriter({ title: 'Long table' })
    writer.table({
      columns,
      rows: Array.from({ length: 120 }, (_, index) => [`Line ${index + 1}`, '1', '$1.00']),
    })
    const pdf = text(writer.finish())
    expectValidXref(pdf)
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(pages).toBeGreaterThan(1)
    expect((contents(pdf).match(/\(Qty\) Tj/g) ?? []).length).toBe(pages)
    expect(pdf).toContain('(Line 120) Tj')
  })

  it('splits a row taller than a page between its lines, header repeated', () => {
    const writer = new PdfWriter({ title: 'Tall row' })
    writer.table({ columns, rows: [[Array(300).fill('A long description').join('\n'), '1', '$5.00']] })
    const pdf = text(writer.finish())
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1])
    expect(pages).toBeGreaterThan(2)
    expect((contents(pdf).match(/\(A long description\) Tj/g) ?? []).length).toBe(300)
    expect((contents(pdf).match(/\(Amount\) Tj/g) ?? []).length).toBe(pages)
  })
})

describe('the file', () => {
  it('lays objects out in a fixed order, so the same input is the same bytes', () => {
    const input = {
      title: 'Same',
      pages: [{ width: 612, height: 792, content: 'BT /F1 10 Tf 1 1 Td (x) Tj ET' }],
    }
    expect(text(buildPdfFile(input))).toBe(text(buildPdfFile(input)))
    expect(text(buildPdfFile(input))).toContain(
      '7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents 8 0 R >>\nendobj\n',
    )
  })
})
