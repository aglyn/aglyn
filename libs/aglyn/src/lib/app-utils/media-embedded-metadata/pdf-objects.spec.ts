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

/**
 * The PDF object layer (AGL-3331): tokenizer, parser, serializer, text
 * strings and FlateDecode with predictors. Every fixture is built here from
 * bytes; the section numbers are ISO 32000-2.
 */

import { deflateSync } from 'zlib'

import {
  decodePdfStream,
  decodePdfTextString,
  encodePdfTextString,
  inflatePdf,
  latin1Bytes,
  PdfLexer,
  pdfNameFromText,
  pdfNameText,
  PdfParser,
  serializePdfObject,
  unpredict,
  type PdfDict,
  type PdfObject,
  type PdfStream,
  type PdfString,
} from './pdf-objects'

const bin = (text: string) => latin1Bytes(text)
const parse = (text: string) => new PdfParser(bin(text)).parseObject()
const str = (obj: PdfObject | null) => (obj as PdfString).bytes
const dict = (obj: PdfObject | null) => (obj as PdfDict).entries
const direct = (obj: PdfObject | undefined) => obj

describe('PdfLexer', () => {
  it('skips white-space and comments between tokens (§7.2.3, §7.2.4)', () => {
    const lexer = new PdfLexer(bin('  %comment\r\n\f\t/Name %x\n 12'))
    expect(lexer.next()).toEqual({ type: 'name', name: 'Name' })
    expect(lexer.next()).toEqual({ type: 'number', value: 12, text: '12' })
    expect(lexer.next()).toEqual({ type: 'eof' })
  })

  it('reads the number forms of §7.3.3 and nothing else as a number', () => {
    const tokens = ['+17', '-98', '0', '34.5', '-3.62', '+123.6', '4.', '-.002', '009.87']
    for (const text of tokens) {
      expect(new PdfLexer(bin(text)).next()).toEqual({ type: 'number', value: Number(text), text })
    }
    expect(new PdfLexer(bin('1.2.3')).next()).toEqual({ type: 'keyword', text: '1.2.3' })
    expect(new PdfLexer(bin('--5')).next()).toEqual({ type: 'keyword', text: '--5' })
  })

  it('decodes #xx escapes in names and leaves a malformed # alone (§7.3.5)', () => {
    expect(new PdfLexer(bin('/A#20B#2fC')).next()).toEqual({ type: 'name', name: 'A B/C' })
    expect(new PdfLexer(bin('/Caf#C3#A9')).next()).toEqual({ type: 'name', name: 'Caf\xC3\xA9' })
    expect(new PdfLexer(bin('/A#zz')).next()).toEqual({ type: 'name', name: 'A#zz' })
    expect(new PdfLexer(bin('/')).next()).toEqual({ type: 'name', name: '' })
  })

  it('stops at the end it was given', () => {
    const lexer = new PdfLexer(bin('123456'), 0, 3)
    expect(lexer.next()).toEqual({ type: 'number', value: 123, text: '123' })
    expect(lexer.next()).toEqual({ type: 'eof' })
  })
})

describe('literal strings (§7.3.4.2)', () => {
  it('balances nested parentheses', () => {
    expect(latin1(str(parse('(a (b (c)) d)')))).toBe('a (b (c)) d')
  })

  it('processes every escape', () => {
    expect(latin1(str(parse('(\\n\\r\\t\\b\\f\\(\\)\\\\\\q)')))).toBe('\n\r\t\b\f()\\q')
  })

  it('reads one to three octal digits, and no more', () => {
    expect(Array.from(str(parse('(\\0\\53\\053\\0534\\377)')))).toEqual([
      0, 0o53, 0o53, 0o53, 0x34, 0o377,
    ])
  })

  it('drops a backslash-EOL line continuation and reads a bare EOL as LF', () => {
    expect(latin1(str(parse('(ab\\\ncd\\\r\nef\\\rgh)')))).toBe('abcdefgh')
    expect(latin1(str(parse('(a\r\nb\rc\nd)')))).toBe('a\nb\nc\nd')
  })

  it('ends an unterminated string at the buffer', () => {
    expect(latin1(str(parse('(never (closed')))).toBe('never (closed')
    expect(latin1(str(parse('(trailing \\')))).toBe('trailing ')
  })
})

describe('hex strings (§7.3.4.3)', () => {
  it('ignores white-space and pads an odd final digit with 0', () => {
    expect(Array.from(str(parse('<90 1f a>')))).toEqual([0x90, 0x1f, 0xa0])
    expect((parse('<4142>') as PdfString).hex).toBe(true)
  })

  it('skips stray bytes rather than ending early', () => {
    expect(latin1(str(parse('<41zz42>')))).toBe('AB')
  })
})

describe('PdfParser', () => {
  it('parses the object types of §7.3', () => {
    const obj = parse(
      '<< /B true /F false /N null /I -3 /R 4.50 /S (x) /H <41> /Na /V /A [1 2 0 R [/x]] /D << /K 5 0 R >> >>',
    )
    const entries = dict(obj)
    expect(entries.get('B')).toEqual({ kind: 'boolean', value: true })
    expect(entries.get('F')).toEqual({ kind: 'boolean', value: false })
    expect(entries.get('N')).toEqual({ kind: 'null' })
    expect(entries.get('I')).toEqual({ kind: 'number', value: -3, text: '-3' })
    expect(entries.get('R')).toEqual({ kind: 'number', value: 4.5, text: '4.50' })
    expect(entries.get('Na')).toEqual({ kind: 'name', name: 'V' })
    expect(entries.get('A')).toEqual({
      kind: 'array',
      items: [
        { kind: 'number', value: 1, text: '1' },
        { kind: 'ref', num: 2, gen: 0 },
        { kind: 'array', items: [{ kind: 'name', name: 'x' }] },
      ],
    })
    expect(dict(entries.get('D') ?? null).get('K')).toEqual({ kind: 'ref', num: 5, gen: 0 })
  })

  it('does not take two numbers that are not followed by R for a reference', () => {
    expect(parse('[1 2 3]')).toEqual({
      kind: 'array',
      items: [1, 2, 3].map((n) => ({ kind: 'number', value: n, text: String(n) })),
    })
    expect(parse('[1 -2 R]')).toMatchObject({ items: [{ value: 1 }, { value: -2 }] })
  })

  it('keeps the first of two duplicate keys, as Poppler does', () => {
    expect(dict(parse('<< /T (a) /T (b) >>')).get('T')).toMatchObject({ bytes: bin('a') })
  })

  it('closes a container at a structural keyword instead of swallowing the next object', () => {
    const parser = new PdfParser(bin('<< /A [1 2 endobj 3 0 obj'))
    expect(parser.parseObject()).toEqual({
      kind: 'dict',
      entries: new Map([
        [
          'A',
          {
            kind: 'array',
            items: [
              { kind: 'number', value: 1, text: '1' },
              { kind: 'number', value: 2, text: '2' },
            ],
          },
        ],
      ]),
    })
    expect(new PdfLexer(parser.bytes, parser.pos).next()).toEqual({ type: 'keyword', text: 'endobj' })
  })

  it('skips a key that is not a name', () => {
    expect(dict(parse('<< (junk) /A 1 >>')).get('A')).toMatchObject({ value: 1 })
  })

  it('refuses nesting past its depth limit instead of recursing', () => {
    expect(parse('['.repeat(100_000))).toBeNull()
    expect(parse('<< /A '.repeat(10_000))).toBeNull()
    expect(parse('['.repeat(30) + ']'.repeat(30))).not.toBeNull()
  })

  it('returns null for a keyword, a stray delimiter or nothing', () => {
    for (const text of ['', 'endobj', ']', '>>', ')', '{', 'R']) expect(parse(text)).toBeNull()
  })

  describe('indirect objects (§7.3.10) and streams (§7.3.8)', () => {
    it('reads `N G obj … endobj`, with or without endobj', () => {
      expect(new PdfParser(bin('12 3 obj (x) endobj')).parseIndirectObject()).toMatchObject({
        num: 12,
        gen: 3,
        obj: { kind: 'string' },
      })
      expect(new PdfParser(bin('1 0 obj 5')).parseIndirectObject()).toMatchObject({
        obj: { value: 5 },
      })
      expect(new PdfParser(bin('1 0 obj endobj')).parseIndirectObject()?.obj).toEqual({
        kind: 'null',
      })
      expect(new PdfParser(bin('1 0 ob (x)')).parseIndirectObject()).toBeNull()
      expect(new PdfParser(bin('x 0 obj (x)')).parseIndirectObject()).toBeNull()
    })

    it('takes exactly /Length bytes after the EOL that ends `stream`', () => {
      const text = '1 0 obj\n<< /Length 5 >>\nstream\r\nab\ncd\r\nendstream\nendobj'
      const parsed = new PdfParser(bin(text)).parseIndirectObject()
      expect(latin1((parsed?.obj as PdfStream).data)).toBe('ab\ncd')
    })

    it('resolves an indirect /Length through the callback', () => {
      const text = '1 0 obj\n<< /Length 9 0 R >>\nstream\nxyz\nendstream\nendobj'
      const parsed = new PdfParser(bin(text), 0, {
        resolveLength: (ref) => (ref.num === 9 ? 3 : null),
      }).parseIndirectObject()
      expect(latin1((parsed?.obj as PdfStream).data)).toBe('xyz')
    })

    it('falls back to the next endstream when /Length is wrong, missing or unresolvable', () => {
      for (const length of ['/Length 999', '/Length 2', '', '/Length 9 0 R', '/Length -4']) {
        const text = `1 0 obj\n<< ${length} >>\nstream\nhello\r\nendstream\nendobj`
        const parsed = new PdfParser(bin(text)).parseIndirectObject()
        expect(latin1((parsed?.obj as PdfStream).data)).toBe('hello')
      }
    })

    it('ends a stream with no endstream at the buffer', () => {
      const parsed = new PdfParser(bin('1 0 obj << >> stream\nabc')).parseIndirectObject()
      expect(latin1((parsed?.obj as PdfStream).data)).toBe('abc')
    })
  })
})

describe('serializePdfObject', () => {
  it('writes back what it parsed, byte for byte in meaning', () => {
    const source =
      '<< /Type /Catalog /Pages 2 0 R /Odd#20Name (a\\(b\\)\\\\) /Bin (\\000\\377\\n) /Hex <00FF> /Real 0.50 /Arr [1 /x null true] /Nested << /K [] >> >>'
    const parsed = parse(source)
    expect(parsed).not.toBeNull()
    if (!parsed) return
    const written = serializePdfObject(parsed)
    expect(parse(written)).toEqual(parsed)
    expect(written).toContain('/Real 0.50')
    expect(written).toContain('/Odd#20Name')
    expect(written).toContain('<00FF>')
  })

  it('escapes names so a delimiter or non-ASCII byte cannot end them (§7.3.5)', () => {
    const name = 'a b/c(d)#\xE9'
    const written = serializePdfObject({ kind: 'name', name })
    expect(written).toBe('/a#20b#2Fc#28d#29#23#E9')
    expect(parse(written)).toEqual({ kind: 'name', name })
  })
})

describe('text strings (§7.9.2.2)', () => {
  it('decodes PDFDocEncoding, including the code points it does not share with Latin-1', () => {
    expect(decodePdfTextString(bin('Caf\xE9 \x80 \x92 \xA0 \x18'))).toBe('Café • ™ € ˘')
  })

  it('decodes UTF-16BE after a BOM, with surrogate pairs', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0xe9, 0xd8, 0x3d, 0xde, 0x00])
    expect(decodePdfTextString(bytes)).toBe('Hé😀')
  })

  it('decodes UTF-8 after a BOM (PDF 2.0) and tolerates UTF-16LE', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Grüße')])
    expect(decodePdfTextString(utf8)).toBe('Grüße')
    expect(decodePdfTextString(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]))).toBe('AB')
  })

  it('removes language escapes and trailing NULs', () => {
    const bytes = new Uint8Array([
      0xfe, 0xff, 0x00, 0x1b, 0x00, 0x65, 0x00, 0x6e, 0x00, 0x1b, 0x00, 0x48, 0x00, 0x69, 0x00, 0x00,
    ])
    expect(decodePdfTextString(bytes)).toBe('Hi')
  })

  it('reads an odd-length UTF-16 string without throwing', () => {
    expect(decodePdfTextString(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0xd8]))).toBe('A')
    expect(decodePdfTextString(new Uint8Array([0xfe, 0xff, 0xd8, 0x3d]))).toBe('�')
  })

  it('encodes printable ASCII as a literal and anything else as UTF-16BE hex', () => {
    expect(encodePdfTextString('Plain (text)\n')).toEqual({
      kind: 'string',
      bytes: bin('Plain (text)\n'),
      hex: false,
    })
    const encoded = encodePdfTextString('Café 😀')
    expect(encoded.hex).toBe(true)
    expect(serializePdfObject(encoded)).toBe('<FEFF00430061006600E90020D83DDE00>')
    expect(decodePdfTextString(encoded.bytes)).toBe('Café 😀')
  })

  it('round-trips name text through UTF-8 name bytes', () => {
    expect(pdfNameText(pdfNameFromText('Überprüfung'))).toBe('Überprüfung')
    expect(pdfNameText('Caf\xE9')).toBe('Caf\xE9') // one byte E9 is not UTF-8: Latin-1
  })
})

describe('FlateDecode and predictors (§7.4.4)', () => {
  const text = bin('<x:xmpmeta>hello</x:xmpmeta>'.repeat(20))

  it('inflates zlib data, and a stream missing its checksum', () => {
    const full = deflateSync(text)
    expect(inflatePdf(full, 1 << 20)).toEqual(text)
    expect(inflatePdf(full.subarray(0, full.length - 4), 1 << 20)).toEqual(text)
  })

  it('returns null past the output cap, and for garbage', () => {
    const bomb = deflateSync(new Uint8Array(10 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(20_000)
    expect(inflatePdf(bomb, 1024 * 1024)).toBeNull()
    expect(inflatePdf(bin('not deflate at all'), 1 << 20)).toBeNull()
  })

  it('undoes every PNG row filter', () => {
    // Two columns of 3 bytes, a row per filter type: None, Sub, Up, Average, Paeth.
    const rows = [
      [10, 20, 30],
      [5, 6, 7],
      [100, 200, 250],
      [1, 2, 3],
      [255, 0, 128],
    ]
    const encoded: number[] = []
    let prev = [0, 0, 0]
    rows.forEach((row, type) => {
      encoded.push(type)
      row.forEach((value, i) => {
        const left = i > 0 ? (row[i - 1] ?? 0) : 0
        const up = prev[i] ?? 0
        const upLeft = i > 0 ? (prev[i - 1] ?? 0) : 0
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        const predictor = [0, left, up, (left + up) >> 1, paeth][type] ?? 0
        encoded.push((value - predictor) & 0xff)
      })
      prev = row
    })
    const params: PdfDict = {
      kind: 'dict',
      entries: new Map<string, PdfObject>([
        ['Predictor', { kind: 'number', value: 12, text: '12' }],
        ['Columns', { kind: 'number', value: 3, text: '3' }],
      ]),
    }
    expect(Array.from(unpredict(new Uint8Array(encoded), params) ?? [])).toEqual(rows.flat())
  })

  it('refuses predictor parameters it cannot honor, and never allocates past its input', () => {
    const params = (entries: Array<[string, number]>): PdfDict => ({
      kind: 'dict',
      entries: new Map(entries.map(([k, v]) => [k, { kind: 'number', value: v, text: String(v) }])),
    })
    expect(unpredict(new Uint8Array(4), params([['Predictor', 2], ['BitsPerComponent', 4]]))).toBeNull()
    expect(unpredict(new Uint8Array(4), params([['Predictor', 7]]))).toBeNull()
    const huge = unpredict(
      new Uint8Array(8),
      params([['Predictor', 12], ['Columns', 1 << 24], ['Colors', 32], ['BitsPerComponent', 16]]),
    )
    expect(huge?.length).toBeLessThanOrEqual(8)
  })

  it('decodes a stream through its /Filter and /DecodeParms, and only Flate', () => {
    const stream = (filter: string, data: Uint8Array) =>
      new PdfParser(
        new Uint8Array([
          ...bin(`1 0 obj << ${filter} /Length ${data.length} >>\nstream\n`),
          ...data,
          ...bin('\nendstream endobj'),
        ]),
      ).parseIndirectObject()?.obj as PdfStream
    expect(decodePdfStream(stream('', text), direct, 1 << 20)).toEqual(text)
    expect(decodePdfStream(stream('/Filter /FlateDecode', deflateSync(text)), direct, 1 << 20)).toEqual(text)
    expect(decodePdfStream(stream('/Filter [/Fl]', deflateSync(text)), direct, 1 << 20)).toEqual(text)
    expect(decodePdfStream(stream('/Filter /ASCIIHexDecode', bin('41>')), direct, 1 << 20)).toBeNull()
    expect(decodePdfStream(stream('/Filter 7', text), direct, 1 << 20)).toBeNull()
    expect(decodePdfStream(stream('', text), direct, 10)).toBeNull()
  })
})

function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}
