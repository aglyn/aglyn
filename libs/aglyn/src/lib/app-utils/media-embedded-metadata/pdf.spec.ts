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
 * PDF document metadata, read and written as an incremental update
 * (AGL-3331).
 *
 * Every PDF here is laid out in code by {@link PdfBuilder}, which computes
 * the byte offsets a cross-reference section needs — classic tables, xref
 * streams with a PNG predictor, object streams, hybrids and a linearized
 * layout. The property every write test holds is the lossless one: the
 * original file is a byte-for-byte prefix of the written one, so no page,
 * font or image byte can have moved.
 */

import { deflateSync } from 'zlib'

import { inflatePdf, latin1Bytes, latin1Text, PdfParser, type PdfDict } from './pdf-objects'
import { isoToPdfDate, pdfDateToIso, readPdf, writePdf, type PdfMetadataRead } from './pdf'
import { EmbeddedWriteError } from './types'

type Part = string | Uint8Array

const bin = (text: string) => latin1Bytes(text)
const text = (bytes: Uint8Array) => latin1Text(bytes)
const partBytes = (part: Part) => (typeof part === 'string' ? bin(part) : part)
const pad = (value: number, width: number) => String(value).padStart(width, '0')

function concat(...parts: Part[]): Uint8Array {
  const chunks = parts.map(partBytes)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** Consecutive numbers grouped into runs, for cross-reference subsections. */
function runsOf(nums: number[]): number[][] {
  const runs: number[][] = []
  for (const num of [...nums].sort((a, b) => a - b)) {
    const run = runs.at(-1)
    if (run && (run.at(-1) ?? -2) + 1 === num) run.push(num)
    else runs.push([num])
  }
  return runs
}

/**
 * Lays out a PDF and computes the offsets its cross-reference sections
 * need. Objects written since the last section are that section's entries.
 */
class PdfBuilder {
  private readonly parts: Uint8Array[] = []
  size = 0
  maxNum = 0
  readonly pending = new Map<number, { offset: number; gen: number }>()

  constructor(header: Part = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n') {
    this.add(header)
  }

  add(part: Part): number {
    const at = this.size
    const bytes = partBytes(part)
    this.parts.push(bytes)
    this.size += bytes.length
    return at
  }

  obj(num: number, body: Part, gen = 0): number {
    const at = this.add(`${num} ${gen} obj\n`)
    this.add(body)
    this.add('\nendobj\n')
    this.pending.set(num, { offset: at, gen })
    this.maxNum = Math.max(this.maxNum, num)
    return at
  }

  stream(num: number, dict: string, data: Part, gen = 0): number {
    const bytes = partBytes(data)
    return this.obj(
      num,
      concat(`<<${dict} /Length ${bytes.length}>>\nstream\n`, bytes, '\nendstream'),
      gen,
    )
  }

  /** A classic section (§7.5.4) for the objects written since the last one. */
  table(trailer: string, options: { free?: number[]; zero?: boolean } = {}): number {
    const at = this.size
    const rows = new Map<number, string>()
    if (options.zero !== false) rows.set(0, '0000000000 65535 f\r\n')
    for (const num of options.free ?? []) rows.set(num, '0000000000 00001 f\r\n')
    for (const [num, { offset, gen }] of this.pending) {
      rows.set(num, `${pad(offset, 10)} ${pad(gen, 5)} n\r\n`)
    }
    let out = 'xref\n'
    for (const run of runsOf([...rows.keys()])) {
      out += `${run[0]} ${run.length}\n` + run.map((num) => rows.get(num)).join('')
    }
    out += `trailer\n<<${trailer}>>\nstartxref\n${at}\n%%EOF\n`
    this.add(out)
    this.pending.clear()
    return at
  }

  /**
   * A cross-reference stream (§7.5.8), `/W [1 4 2]`, Flate-compressed with
   * a PNG Up predictor unless `raw`. It lists itself, the `compressed`
   * entries and — unless `direct` is false — the objects written since the
   * last section.
   */
  xrefStream(
    num: number,
    trailer: string,
    options: {
      compressed?: Array<[number, number, number]>
      raw?: boolean
      direct?: boolean
      tail?: boolean
    } = {},
  ): number {
    const at = this.size
    const rows = new Map<number, [number, number, number]>()
    if (options.direct !== false) {
      rows.set(0, [0, 0, 65535])
      for (const [n, { offset, gen }] of this.pending) rows.set(n, [1, offset, gen])
      this.pending.clear()
    }
    for (const [n, stm, index] of options.compressed ?? []) rows.set(n, [2, stm, index])
    rows.set(num, [1, at, 0])
    this.maxNum = Math.max(this.maxNum, num, ...rows.keys())
    const runs = runsOf([...rows.keys()])
    const plain: number[] = []
    for (const run of runs) {
      for (const n of run) {
        const [type, a, b] = rows.get(n) ?? [0, 0, 0]
        plain.push(type, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, b >> 8, b & 255)
      }
    }
    let data = new Uint8Array(plain)
    let filter = ''
    if (!options.raw) {
      const predicted: number[] = []
      for (let row = 0; row < plain.length; row += 7) {
        predicted.push(2)
        for (let i = 0; i < 7; i++) {
          predicted.push(((plain[row + i] ?? 0) - (row ? (plain[row - 7 + i] ?? 0) : 0)) & 255)
        }
      }
      data = deflateSync(new Uint8Array(predicted))
      filter = '/Filter /FlateDecode /DecodeParms <</Predictor 12 /Columns 7>>'
    }
    const index = runs.map((run) => `${run[0]} ${run.length}`).join(' ')
    this.add(
      `${num} 0 obj\n<</Type /XRef /Size ${this.maxNum + 1} /W [1 4 2] /Index [${index}] ${trailer} ${filter} /Length ${data.length}>>\nstream\n`,
    )
    this.add(data)
    this.add('\nendstream\nendobj\n')
    if (options.tail !== false) this.add(`startxref\n${at}\n%%EOF\n`)
    return at
  }

  /** An object stream (§7.5.7); returns its objects' compressed entries. */
  objStm(num: number, objects: Array<[number, string]>): Array<[number, number, number]> {
    let header = ''
    let body = ''
    for (const [n, source] of objects) {
      header += `${n} ${body.length} `
      body += source + '\n'
      this.maxNum = Math.max(this.maxNum, n)
    }
    this.stream(
      num,
      `/Type /ObjStm /N ${objects.length} /First ${header.length} /Filter /FlateDecode`,
      deflateSync(bin(header + body)),
    )
    return objects.map(([n], index) => [n, num, index])
  }

  bytes(): Uint8Array {
    return concat(...this.parts)
  }
}

const ID = '/ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>]'
const PAGE_CONTENT = 'BT /F1 24 Tf 40 100 Td (Hello, page) Tj ET'
const INFO =
  "<</Title (Quarterly report) /Author (Ada Lovelace) /Subject (Numbers) /Producer (Hand-built) /CreationDate (D:20210503101112+05'00')>>"

function pageObjects(b: PdfBuilder): void {
  b.obj(2, '<</Type /Pages /Kids [3 0 R] /Count 1>>')
  b.obj(
    3,
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources <</Font <</F1 <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>>>>>>>',
  )
  b.stream(4, '', PAGE_CONTENT)
}

/** A one-page PDF with a classic table: catalog 1, pages 2–4, Info 5. */
function classicPdf(
  options: {
    info?: string | null
    catalog?: string
    trailer?: string
    header?: Part
    extra?: (b: PdfBuilder) => void
  } = {},
): Uint8Array {
  const b = new PdfBuilder(options.header)
  b.obj(1, `<</Type /Catalog /Pages 2 0 R${options.catalog ?? ''}>>`)
  pageObjects(b)
  const info = options.info === undefined ? INFO : options.info
  if (info !== null) b.obj(5, info)
  options.extra?.(b)
  b.table(
    `/Size ${b.maxNum + 1} /Root 1 0 R${info !== null ? ' /Info 5 0 R' : ''} ${ID}${options.trailer ?? ''}`,
  )
  return b.bytes()
}

/** The same document with the catalog and Info in an object stream and an xref stream. */
function streamPdf(options: { catalog?: string; raw?: boolean } = {}): Uint8Array {
  const b = new PdfBuilder('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')
  pageObjects(b)
  const compressed = b.objStm(6, [
    [1, `<</Type /Catalog /Pages 2 0 R${options.catalog ?? ''}>>`],
    [5, INFO],
  ])
  b.xrefStream(7, `/Root 1 0 R /Info 5 0 R ${ID}`, { compressed, raw: options.raw })
  return b.bytes()
}

/** §7.5.8.4: a table that marks the compressed objects free, plus /XRefStm. */
function hybridPdf(): Uint8Array {
  const b = new PdfBuilder('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')
  pageObjects(b)
  const compressed = b.objStm(6, [
    [1, '<</Type /Catalog /Pages 2 0 R>>'],
    [5, INFO],
  ])
  const stm = b.xrefStream(7, '', { compressed, direct: false, tail: false })
  b.table(`/Size 8 /Root 1 0 R /Info 5 0 R ${ID} /XRefStm ${stm}`, { free: [1, 5] })
  return b.bytes()
}

/**
 * Word's hybrid layout: the main table marks the compressed objects free
 * (gen 65535), and a newer, EMPTY section (`xref 0 0`) carries `/XRefStm`
 * and a `/Prev` to it — so the stream's entries are newer than the table's.
 */
function wordHybridPdf(): Uint8Array {
  const b = new PdfBuilder('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')
  pageObjects(b)
  const compressed = b.objStm(6, [
    [1, '<</Type /Catalog /Pages 2 0 R>>'],
    [5, INFO],
  ])
  const main = b.size
  b.add('xref\n0 8\n0000000000 65535 f\r\n0000000000 65535 f\r\n')
  for (const num of [2, 3, 4]) b.add(`${pad(b.pending.get(num)?.offset ?? 0, 10)} 00000 n\r\n`)
  b.add('0000000000 65535 f\r\n')
  b.add(`${pad(b.pending.get(6)?.offset ?? 0, 10)} 00000 n\r\n0000000000 65535 f\r\n`)
  b.add(`trailer\n<</Size 8 /Root 1 0 R /Info 5 0 R ${ID}>>\nstartxref\n${main}\n%%EOF\n`)
  b.pending.clear()
  const stm = b.xrefStream(7, '', { compressed, direct: false, tail: false })
  const last = b.add(
    `xref\n0 0\ntrailer\n<</Size 8 /Root 1 0 R /Info 5 0 R ${ID} /Prev ${main} /XRefStm ${stm}>>\n`,
  )
  b.add(`startxref\n${last}\n%%EOF\n`)
  return b.bytes()
}

/**
 * Annex F's layout: the first-page section right after the linearization
 * dictionary, its /Prev naming the main section at the end, and the final
 * startxref naming the FIRST-page section. Every variable number is padded
 * to ten digits so a second pass can fill in the offsets the first measured.
 */
function linearizedPdf(): Uint8Array {
  const layout = (known: Map<number, number>, main: number, length: number) => {
    const b = new PdfBuilder('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
    const at = new Map<number, number>()
    at.set(10, b.add(`10 0 obj\n<</Linearized 1 /L ${pad(length, 10)} /O 3 /E 0 /N 1 /T 0 /H [0 0]>>\nendobj\n`))
    const row = (num: number) => `${pad(known.get(num) ?? 0, 10)} 00000 n\r\n`
    const first = b.add(
      `xref\n10 1\n${row(10)}1 1\n${row(1)}3 1\n${row(3)}trailer\n<</Size 11 /Prev ${pad(main, 10)} /Root 1 0 R /Info 5 0 R ${ID}>>\nstartxref\n0\n%%EOF\n`,
    )
    at.set(1, b.obj(1, '<</Type /Catalog /Pages 2 0 R>>'))
    at.set(
      3,
      b.obj(3, '<</Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R>>'),
    )
    at.set(2, b.obj(2, '<</Type /Pages /Kids [3 0 R] /Count 1>>'))
    at.set(4, b.stream(4, '', PAGE_CONTENT))
    at.set(5, b.obj(5, INFO))
    const mainAt = b.add(
      `xref\n0 3\n0000000000 65535 f\r\n0000000000 00000 f\r\n${row(2)}4 2\n${row(4)}${row(5)}trailer\n<</Size 11>>\nstartxref\n${first}\n%%EOF\n`,
    )
    return { bytes: b.bytes(), at, mainAt }
  }
  const draft = layout(new Map(), 0, 0)
  const final = layout(draft.at, draft.mainAt, draft.bytes.length)
  expect(final.bytes.length).toBe(draft.bytes.length)
  return final.bytes
}

/** The offset the file's last startxref gives. */
function startxrefOf(bytes: Uint8Array): number {
  const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text(bytes))
  return Number(match?.[1])
}

/** An incremental update redefining `objects`, chained onto `base` with a classic table. */
function withUpdate(base: Uint8Array, objects: Array<[number, string]>, trailer: string, free: number[] = []): Uint8Array {
  const b = new PdfBuilder(base)
  for (const [num, body] of objects) b.obj(num, body)
  b.table(`${trailer} /Prev ${startxrefOf(base)}`, { zero: false, free })
  return b.bytes()
}

function info(read: PdfMetadataRead | null): Record<string, string> {
  return Object.fromEntries((read?.info ?? []).map((entry) => [entry.name, entry.value]))
}

/** LOSSLESS: the input is a byte-for-byte prefix of the output. */
function expectPrefix(input: Uint8Array, output: Uint8Array): void {
  expect(output.length).toBeGreaterThan(input.length)
  expect(Buffer.compare(Buffer.from(output.subarray(0, input.length)), Buffer.from(input))).toBe(0)
}

/**
 * An independent check of an appended classic section: every entry's
 * offset holds `num gen obj`, and startxref names the table.
 */
function expectSoundTable(output: Uint8Array, inputLength: number): string {
  const tail = text(output.subarray(inputLength))
  const xrefAt = startxrefOf(output)
  expect(text(output.subarray(xrefAt, xrefAt + 5))).toBe('xref\n')
  const body = /xref\n([\s\S]*?)trailer/.exec(text(output.subarray(xrefAt)))?.[1] ?? ''
  const lines = body.split(/\r?\n/).filter(Boolean)
  let num = 0
  let checked = 0
  for (const line of lines) {
    const sub = /^(\d+) (\d+)$/.exec(line)
    if (sub) {
      num = Number(sub[1])
      continue
    }
    const entry = /^(\d{10}) (\d{5}) n$/.exec(line)
    expect(entry).not.toBeNull()
    const offset = Number(entry?.[1])
    expect(text(output.subarray(offset, offset + 20))).toMatch(
      new RegExp(`^${num} ${Number(entry?.[2])} obj\\n`),
    )
    num++
    checked++
  }
  expect(checked).toBeGreaterThan(0)
  return tail
}

describe('readPdf', () => {
  it('reads the Info dictionary, page count and version of a classic file', () => {
    expect(readPdf(classicPdf())).toEqual({
      info: [
        { name: 'Title', value: 'Quarterly report', editable: true },
        { name: 'Author', value: 'Ada Lovelace', editable: true },
        { name: 'Subject', value: 'Numbers', editable: true },
        { name: 'Producer', value: 'Hand-built', editable: true },
        { name: 'CreationDate', value: '2021-05-03T10:11:12+05:00', editable: true },
      ],
      xmp: null,
      pageCount: 1,
      version: '1.7',
      encrypted: false,
      signed: false,
    })
  })

  it('decodes every text-string form (§7.9.2.2)', () => {
    const read = readPdf(
      classicPdf({
        info: [
          '<</Literal (Nested \\(parens\\) and \\\\ back\\\nslash)',
          '/Utf16 <FEFF004800690020D83DDE00>',
          '/Utf16Literal (\\376\\377\\000O\\000K)',
          '/DocEncoding (\\200 bullet \\222 \\240)',
          '/Utf8 <EFBBBF4772C3BC20C39F65>',
          '/Lang <FEFF001B0065006E001B00480069>>>',
        ].join(' '),
      }),
    )
    expect(info(read)).toEqual({
      Literal: 'Nested (parens) and \\ backslash',
      Utf16: 'Hi 😀',
      Utf16Literal: 'OK',
      DocEncoding: '• bullet ™ €',
      Utf8: 'Grü ße',
      Lang: 'Hi',
    })
  })

  it('reads names and other non-strings as read-only text, and resolves references', () => {
    const read = readPdf(
      classicPdf({
        info: '<</Title 9 0 R /Trapped /True /Pages 3 /Ratio 0.50 /Arr [1 (x)] /Gone null /My#20Key (custom) /Missing 99 0 R>>',
        extra: (b) => b.obj(9, '(Indirect title)'),
      }),
    )
    expect(read?.info).toEqual([
      { name: 'Title', value: 'Indirect title', editable: true },
      { name: 'Trapped', value: 'True', editable: false },
      { name: 'Pages', value: '3', editable: false },
      { name: 'Ratio', value: '0.50', editable: false },
      { name: 'Arr', value: '[1 (x)]', editable: false },
      { name: 'My Key', value: 'custom', editable: true },
    ])
  })

  it('reads an XMP stream, compressed or not, but not through another filter', () => {
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>'
    const withXmp = (dict: string, data: Part) =>
      classicPdf({
        catalog: ' /Metadata 8 0 R',
        extra: (b) => b.stream(8, `/Type /Metadata /Subtype /XML${dict}`, data),
      })
    expect(readPdf(withXmp('', xmp))?.xmp).toBe(xmp)
    expect(readPdf(withXmp(' /Filter /FlateDecode', deflateSync(bin(xmp))))?.xmp).toBe(xmp)
    expect(readPdf(withXmp(' /Filter /ASCIIHexDecode', '41>'))?.xmp).toBeNull()
    const utf16 = concat(new Uint8Array([0xfe, 0xff]), ...[...'<x/>'].map((c) => new Uint8Array([0, c.charCodeAt(0)])))
    expect(readPdf(withXmp('', utf16))?.xmp).toBe('<x/>')
  })

  it('takes a later catalog /Version over the header, never an earlier one', () => {
    expect(readPdf(classicPdf({ catalog: ' /Version /2.0' }))?.version).toBe('2.0')
    expect(readPdf(classicPdf({ catalog: ' /Version /1.4' }))?.version).toBe('1.7')
    expect(readPdf(classicPdf({ catalog: ' /Version (junk)' }))?.version).toBe('1.7')
    expect(readPdf(classicPdf({ header: '%PDF-1.3\n' }))?.version).toBe('1.3')
  })

  it('reads an xref stream with a PNG predictor, and objects in an object stream', () => {
    for (const raw of [false, true]) {
      const read = readPdf(streamPdf({ raw }))
      expect(info(read)).toMatchObject({ Title: 'Quarterly report', Author: 'Ada Lovelace' })
      expect(read).toMatchObject({ pageCount: 1, version: '1.5', encrypted: false, signed: false })
    }
  })

  it('reads a hybrid file through its /XRefStm (§7.5.8.4), in both layouts', () => {
    for (const bytes of [hybridPdf(), wordHybridPdf()]) {
      const read = readPdf(bytes)
      expect(info(read).Title).toBe('Quarterly report')
      expect(read?.pageCount).toBe(1)
    }
  })

  it('reads a linearized file from its first-page section (Annex F)', () => {
    const read = readPdf(linearizedPdf())
    expect(info(read).Title).toBe('Quarterly report')
    expect(read).toMatchObject({ pageCount: 1, version: '1.4' })
  })

  it('lets the newest incremental update win, and a free entry delete (§7.5.6)', () => {
    const base = classicPdf({
      info: '<</Title (First) /Subject 9 0 R>>',
      extra: (b) => b.obj(9, '(Referenced)'),
    })
    const once = withUpdate(base, [[5, '<</Title (Second) /Subject 9 0 R>>']], `/Size 10 /Root 1 0 R /Info 5 0 R`)
    expect(info(readPdf(once))).toEqual({ Title: 'Second', Subject: 'Referenced' })
    const twice = withUpdate(once, [], '/Size 10 /Root 1 0 R /Info 5 0 R', [9])
    expect(info(readPdf(twice))).toEqual({ Title: 'Second' })
  })

  it('survives a /Prev loop and reads what the chain held', () => {
    const base = classicPdf()
    const at = startxrefOf(base)
    const looped = concat(
      base,
      `xref\n0 1\n0000000000 65535 f\r\ntrailer\n<</Size 6 /Root 1 0 R /Info 5 0 R /Prev ${base.length}>>\nstartxref\n${base.length}\n%%EOF\n`,
    )
    expect(at).toBeGreaterThan(0)
    expect(info(readPdf(looped)).Title).toBe('Quarterly report')
  })

  it('rebuilds from a scan when the cross-reference data is broken', () => {
    const good = classicPdf()
    const s = text(good)
    const variants = [
      // startxref names a byte that is not a section
      bin(s.replace(/startxref\n\d+/, 'startxref\n7')),
      // no startxref at all
      bin(s.replace(/startxref\n\d+\n%%EOF\n$/, '')),
      // every table offset shifted by one
      bin(s.replace(/(\d{10}) 00000 n/g, (_, o) => `${pad(Number(o) + 1, 10)} 00000 n`)),
      // a table that is not one
      bin(s.replace(/xref\n0 6\n/, 'xref\n0 six\n')),
    ]
    for (const bytes of variants) {
      const read = readPdf(bytes)
      expect(info(read).Title).toBe('Quarterly report')
      expect(read?.pageCount).toBe(1)
    }
  })

  it('rebuilds a broken xref-stream file, catalog and Info inside the object stream', () => {
    const good = streamPdf()
    const at = startxrefOf(good)
    const broken = concat(good.subarray(0, good.length - `${at}\n%%EOF\n`.length), '99999\n%%EOF\n')
    const read = readPdf(broken)
    expect(info(read).Author).toBe('Ada Lovelace')
    expect(read?.pageCount).toBe(1)
  })

  it('reports an encrypted file and leaves its ciphertext unread', () => {
    const read = readPdf(
      classicPdf({
        trailer: ' /Encrypt 9 0 R',
        extra: (b) => b.obj(9, '<</Filter /Standard /V 2 /R 3 /Length 128 /O <00> /U <00> /P -4>>'),
      }),
    )
    expect(read).toMatchObject({ encrypted: true, info: [], xmp: null, pageCount: 1 })
  })

  describe('signatures (§12.8)', () => {
    const sigField = (field: string) =>
      classicPdf({
        catalog: ' /AcroForm 10 0 R',
        extra: (b) => {
          b.obj(10, '<</Fields [11 0 R]>>')
          b.obj(11, field)
          b.obj(12, '<</Type /Annot /Subtype /Widget /Parent 11 0 R>>')
        },
      })

    it('finds a /ByteRange anywhere', () => {
      const signed = classicPdf({
        extra: (b) =>
          b.obj(9, '<</Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 10 20 30] /Contents <00>>>'),
      })
      expect(readPdf(signed)?.signed).toBe(true)
    })

    it('finds AcroForm /SigFlags, a signed field (FT inherited by kids), and /Perms', () => {
      expect(readPdf(sigField('<</FT /Sig /T (s) /V 13 0 R>>'))?.signed).toBe(true)
      expect(readPdf(sigField('<</FT /Sig /T (s) /Kids [14 0 R]>>'))?.signed).toBe(false)
      const inherited = classicPdf({
        catalog: ' /AcroForm <</Fields [11 0 R]>>',
        extra: (b) => {
          b.obj(11, '<</FT /Sig /T (parent) /Kids [12 0 R]>>')
          b.obj(12, '<</T (kid) /V 13 0 R /Parent 11 0 R>>')
          b.obj(13, '<</Type /Sig>>')
        },
      })
      expect(readPdf(inherited)?.signed).toBe(true)
      expect(readPdf(classicPdf({ catalog: ' /AcroForm <</Fields [] /SigFlags 3>>' }))?.signed).toBe(true)
      expect(readPdf(classicPdf({ catalog: ' /AcroForm <</Fields [] /SigFlags 0>>' }))?.signed).toBe(false)
      expect(readPdf(classicPdf({ catalog: ' /Perms <</DocMDP 9 0 R>>' }))?.signed).toBe(true)
    })

    it('does not loop on a field tree that cycles', () => {
      const cyclic = classicPdf({
        catalog: ' /AcroForm <</Fields [11 0 R]>>',
        extra: (b) => b.obj(11, '<</T (loop) /Kids [11 0 R 11 0 R]>>'),
      })
      expect(readPdf(cyclic)?.signed).toBe(false)
    })
  })

  it('returns null for what is not a PDF', () => {
    for (const bytes of [
      new Uint8Array(0),
      bin('%PDF-'),
      bin('GIF89a'),
      bin('%PDF-1.7\n' + 'x'.repeat(100)),
      bin('x'.repeat(2000) + '%PDF-1.7'),
    ]) {
      expect(readPdf(bytes)).toBeNull()
    }
  })

  it('finds a header after leading junk, as Acrobat does', () => {
    const shifted = concat('JUNK\n', classicPdf())
    expect(info(readPdf(shifted)).Title).toBe('Quarterly report')
  })
})

describe('hostile input', () => {
  const quickly = (fn: () => unknown) => {
    const start = Date.now()
    expect(fn).not.toThrow()
    expect(Date.now() - start).toBeLessThan(5000)
  }

  it('never throws on any truncation of any layout', () => {
    for (const bytes of [classicPdf(), streamPdf(), hybridPdf(), linearizedPdf()]) {
      quickly(() => {
        for (let length = 0; length < bytes.length; length += 3) readPdf(bytes.subarray(0, length))
      })
    }
  })

  it('never throws on corrupted bytes, and writes only what it can or throws EmbeddedWriteError', () => {
    let seed = 42
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (const original of [classicPdf(), streamPdf(), hybridPdf()]) {
      for (let round = 0; round < 150; round++) {
        const bytes = original.slice()
        for (let flips = 1 + Math.floor(random() * 4); flips > 0; flips--) {
          bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
        }
        expect(() => readPdf(bytes)).not.toThrow()
        try {
          const out = writePdf(bytes, { info: { Title: 'x' } })
          expectPrefix(bytes, out)
          expect(info(readPdf(out)).Title).toBe('x')
        } catch (error) {
          expect(error).toBeInstanceOf(EmbeddedWriteError)
        }
      }
    }
  })

  it('bounds nesting, reference loops, self-referencing streams and object streams', () => {
    const cases = [
      classicPdf({ info: '<</Title ' + '['.repeat(50_000) + '>>' }),
      classicPdf({ info: '<</Title 9 0 R>>', extra: (b) => b.obj(9, '9 0 R') }),
      classicPdf({
        catalog: ' /Metadata 9 0 R',
        extra: (b) => b.obj(9, '<</Length 9 0 R>>\nstream\nabc\nendstream'),
      }),
      (() => {
        const b = new PdfBuilder('%PDF-1.5\n')
        pageObjects(b)
        // The object stream claims to hold itself and the catalog.
        b.xrefStream(7, '/Root 1 0 R', { compressed: [[1, 6, 0], [6, 6, 1]] })
        return b.bytes()
      })(),
    ]
    for (const bytes of cases) quickly(() => readPdf(bytes))
    expect(readPdf(cases[0] ?? new Uint8Array())?.info).toEqual([])
    expect(readPdf(cases[2] ?? new Uint8Array())?.xmp).toBe('abc')
  })

  it('bounds hostile cross-reference data', () => {
    const b = new PdfBuilder('%PDF-1.5\n')
    b.obj(1, '<</Type /Catalog /Pages 2 0 R>>')
    pageObjects(b)
    const at = b.size
    const huge = [
      `9 0 obj\n<</Type /XRef /W [4 8 8] /Index [0 4294967295 5 99999999999] /Size 999999999999 /Root 1 0 R /Length 0>>\nstream\n\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`,
      `9 0 obj\n<</Type /XRef /W [1 1] /Size 5 /Root 1 0 R /Length 0>>\nstream\n\nendstream\nendobj\nstartxref\n${at}\n%%EOF\n`,
      `xref\n0 999999999\ntrailer\n<</Root 1 0 R>>\nstartxref\n${at}\n%%EOF\n`,
      `xref\n0 1\n0000000000 65535 f\r\ntrailer\n<</Root 1 0 R /Prev ${at} /Size 99999999999999>>\nstartxref\n${at}\n%%EOF\n`,
    ]
    for (const tail of huge) {
      const bytes = concat(b.bytes(), tail)
      quickly(() => readPdf(bytes))
      expect(readPdf(bytes)?.pageCount).toBe(1)
      expect(() => writePdf(bytes, { info: { Title: 'x' } })).toThrow(EmbeddedWriteError)
    }
  })

  it('refuses a decompression bomb in an object stream', () => {
    const b = new PdfBuilder('%PDF-1.5\n')
    pageObjects(b)
    const bomb = deflateSync(new Uint8Array(80 * 1024 * 1024))
    b.stream(6, `/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode`, bomb)
    b.xrefStream(7, '/Root 1 0 R', { compressed: [[1, 6, 0]] })
    quickly(() => expect(readPdf(b.bytes())).toBeNull())
  })
})

describe('dates (§7.9.4)', () => {
  it.each([
    ["D:20210503101112+05'00'", '2021-05-03T10:11:12+05:00'],
    ["D:20210503101112-07'30", '2021-05-03T10:11:12-07:30'],
    ['D:20210503101112Z', '2021-05-03T10:11:12Z'],
    ["D:20210503101112Z00'00'", '2021-05-03T10:11:12Z'],
    ['D:20210503101112', '2021-05-03T10:11:12'],
    ['D:202105031011', '2021-05-03T10:11:00'],
    ['D:2021050310', '2021-05-03T10:00:00'],
    ['D:20210503', '2021-05-03'],
    ['D:2021', '2021-01-01'],
    ['20210503101112', '2021-05-03T10:11:12'],
    [' D:20210503101112+05 ', '2021-05-03T10:11:12+05:00'],
  ])('reads %s as %s', (pdf, iso) => {
    expect(pdfDateToIso(pdf)).toBe(iso)
  })

  it.each(['', 'D:', 'D:21', 'D:20211303', 'D:20210532', 'D:20210503256000', 'May 3, 2021', 'D:2021-05-03'])(
    'does not read %j as a date',
    (value) => {
      expect(pdfDateToIso(value)).toBeNull()
    },
  )

  it.each([
    ['2026-09-24T12:34:56Z', 'D:20260924123456Z'],
    ['2026-09-24T12:34:56.789+05:30', "D:20260924123456+05'30'"],
    ['2026-09-24T12:34', 'D:20260924123400'],
    ['2026-09-24', 'D:20260924'],
  ])('writes %s as %s', (iso, pdf) => {
    expect(isoToPdfDate(iso)).toBe(pdf)
    expect(pdfDateToIso(isoToPdfDate(iso) ?? '')).toBe(
      iso.replace(/\.\d+/, '').replace(/T(\d\d:\d\d)$/, 'T$1:00'),
    )
  })

  it('does not write what is not ISO as a date', () => {
    expect(isoToPdfDate('yesterday')).toBeNull()
  })
})

describe('writePdf', () => {
  it('appends an update to a classic file: prefix kept, patch applied, every other entry kept', () => {
    const input = classicPdf({ info: INFO.replace('>>', ' /Trapped /False /Rev 3>>') })
    const output = writePdf(input, {
      info: {
        Title: 'New title',
        Author: 'Zoë Quinn',
        Subject: null,
        ModDate: '2026-09-24T12:34:56Z',
        Custom: 'Added',
      },
    })
    expectPrefix(input, output)
    const tail = expectSoundTable(output, input.length)
    const read = readPdf(output)
    expect(read?.info).toEqual([
      { name: 'Title', value: 'New title', editable: true },
      { name: 'Author', value: 'Zoë Quinn', editable: true },
      { name: 'Producer', value: 'Hand-built', editable: true },
      { name: 'CreationDate', value: '2021-05-03T10:11:12+05:00', editable: true },
      { name: 'Trapped', value: 'False', editable: false },
      { name: 'Rev', value: '3', editable: false },
      { name: 'ModDate', value: '2026-09-24T12:34:56Z', editable: true },
      { name: 'Custom', value: 'Added', editable: true },
    ])
    expect(read).toMatchObject({ pageCount: 1, xmp: null, signed: false, encrypted: false })
    // Same object number, strings encoded per §7.9.2.2, the date per §7.9.4.
    expect(tail).toMatch(/^5 0 obj\n<<\/Title \(New title\) \/Author <FEFF005A006F00EB0020005100750069006E006E>/)
    expect(tail).toContain("/CreationDate (D:20210503101112+05'00')")
    expect(tail).toContain('/ModDate (D:20260924123456Z)')
    expect(tail).toContain('/Trapped /False /Rev 3')
    expect(tail).toContain(`/Prev ${startxrefOf(input)}`)
    expect(tail).toContain(ID)
    expect(tail).toMatch(/xref\n5 1\n\d{10} 00000 n\r\ntrailer/)
    expect(tail).not.toContain('/Encrypt')
  })

  it('writes a new Info object numbered /Size when the file has none', () => {
    const input = classicPdf({ info: null })
    const output = writePdf(input, { info: { Title: 'Fresh' } })
    expectPrefix(input, output)
    const tail = expectSoundTable(output, input.length)
    expect(tail).toMatch(/^5 0 obj\n<<\/Title \(Fresh\)>>/)
    expect(tail).toContain('/Info 5 0 R')
    expect(info(readPdf(output))).toEqual({ Title: 'Fresh' })
  })

  it('replaces an existing XMP stream in place, uncompressed, without touching the catalog', () => {
    const old = '<x:xmpmeta>old</x:xmpmeta>'
    const input = classicPdf({
      catalog: ' /Metadata 8 2 R',
      extra: (b) =>
        b.stream(8, '/Type /Metadata /Subtype /XML /Filter /FlateDecode', deflateSync(bin(old)), 2),
    })
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/">Grüße — new</x:xmpmeta>'
    const output = writePdf(input, { info: {}, xmp })
    expectPrefix(input, output)
    const tail = expectSoundTable(output, input.length)
    expect(tail).toMatch(/^8 2 obj\n<<\/Type \/Metadata \/Subtype \/XML \/Length \d+>>\nstream\n/)
    expect(tail).not.toContain('1 0 obj')
    expect(tail).not.toMatch(/^5 0 obj/m)
    const read = readPdf(output)
    expect(read?.xmp).toBe(xmp)
    expect(info(read).Title).toBe('Quarterly report')
  })

  it('adds an XMP stream and links it from a faithful copy of the catalog', () => {
    const catalogExtra =
      ' /Lang (en-US) /PageMode /UseOutlines /ViewerPreferences <</DisplayDocTitle true>> /Odd#20Key 0.50 /Names <00FF>'
    const input = classicPdf({ catalog: catalogExtra })
    const xmp = '<x:xmpmeta/>'
    const output = writePdf(input, { info: { Title: 'With XMP' }, xmp })
    expectPrefix(input, output)
    expectSoundTable(output, input.length)
    const read = readPdf(output)
    expect(read?.xmp).toBe(xmp)
    expect(info(read).Title).toBe('With XMP')
    expect(read?.pageCount).toBe(1)
    // The new catalog is the old one, entry for entry, plus /Metadata.
    const catalogAt = text(output).lastIndexOf('\n1 0 obj\n') + 1
    const catalog = new PdfParser(output, catalogAt).parseIndirectObject()?.obj as PdfDict
    const original = new PdfParser(input, text(input).indexOf('1 0 obj')).parseIndirectObject()?.obj as PdfDict
    expect([...catalog.entries.keys()]).toEqual([...original.entries.keys(), 'Metadata'])
    for (const [key, value] of original.entries) expect(catalog.entries.get(key)).toEqual(value)
    expect(catalog.entries.get('Metadata')).toEqual({ kind: 'ref', num: 6, gen: 0 })
  })

  it('updates an xref-stream file with an xref stream, redefining a compressed catalog', () => {
    const input = streamPdf({ catalog: ' /Lang (fr)' })
    const xmp = '<x:xmpmeta>stream file</x:xmpmeta>'
    const output = writePdf(input, { info: { Keywords: 'a, b', Title: null }, xmp })
    expectPrefix(input, output)
    const tail = text(output.subarray(input.length))
    // Info 5 and the catalog 1 left the object stream for plain objects;
    // the new XMP is object 8, the new xref stream 9, and it lists itself.
    expect(tail).toMatch(/^5 0 obj\n/)
    expect(tail).toContain('\n8 0 obj\n<</Type /Metadata /Subtype /XML /Length')
    expect(tail).toContain('\n1 0 obj\n<</Type /Catalog /Pages 2 0 R /Lang (fr) /Metadata 8 0 R>>')
    expect(tail).toMatch(
      new RegExp(`9 0 obj\\n<</Type /XRef /Size 10 /Root 1 0 R /Info 5 0 R /Prev ${startxrefOf(input)} /ID \\[.*\\] /W \\[1 4 2\\] /Index \\[1 1 5 1 8 2\\] /Length 28>>\\nstream\\n`),
    )
    expect(tail).not.toContain('/Filter')
    const xrefAt = startxrefOf(output)
    expect(text(output.subarray(xrefAt, xrefAt + 8))).toBe('9 0 obj\n')
    const read = readPdf(output)
    expect(info(read)).toEqual({
      Author: 'Ada Lovelace',
      Subject: 'Numbers',
      Producer: 'Hand-built',
      CreationDate: '2021-05-03T10:11:12+05:00',
      Keywords: 'a, b',
    })
    expect(read).toMatchObject({ xmp, pageCount: 1, version: '1.5' })
  })

  it('updates a hybrid file with a classic section chained to it', () => {
    for (const input of [hybridPdf(), wordHybridPdf()]) {
      const output = writePdf(input, { info: { Title: 'Hybrid' }, xmp: '<x/>' })
      expectPrefix(input, output)
      const tail = expectSoundTable(output, input.length)
      // The compressed catalog is redefined as a plain object.
      expect(tail).toContain('\n1 0 obj\n<</Type /Catalog /Pages 2 0 R /Metadata 8 0 R>>')
      const read = readPdf(output)
      expect(info(read)).toMatchObject({ Title: 'Hybrid', Author: 'Ada Lovelace' })
      expect(read).toMatchObject({ pageCount: 1, xmp: '<x/>' })
    }
  })

  it('updates a linearized file: new section → first-page section → main section', () => {
    const input = linearizedPdf()
    const output = writePdf(input, { info: { Title: 'Linearized' }, xmp: '<x/>' })
    expectPrefix(input, output)
    const tail = expectSoundTable(output, input.length)
    expect(tail).toContain(`/Prev ${startxrefOf(input)}`)
    const read = readPdf(output)
    expect(info(read)).toMatchObject({ Title: 'Linearized', Subject: 'Numbers' })
    expect(read).toMatchObject({ xmp: '<x/>', pageCount: 1 })
  })

  it('stacks updates: a second write builds on the first', () => {
    const input = classicPdf()
    const once = writePdf(input, { info: { Title: 'One', Custom: 'kept' } })
    const twice = writePdf(once, { info: { Title: 'Two' }, xmp: '<x:two/>' })
    expectPrefix(input, once)
    expectPrefix(once, twice)
    expectSoundTable(twice, once.length)
    const read = readPdf(twice)
    expect(info(read)).toMatchObject({ Title: 'Two', Custom: 'kept', Author: 'Ada Lovelace' })
    expect(read?.xmp).toBe('<x:two/>')
    const onStream = writePdf(writePdf(streamPdf(), { info: { Title: 'A' } }), { info: { Author: 'B' } })
    expect(info(readPdf(onStream))).toMatchObject({ Title: 'A', Author: 'B' })
  })

  it('starts the update on a line of its own', () => {
    const input = classicPdf().subarray(0, classicPdf().length - 1) // ends "%%EOF" with no EOL
    expect(text(input).endsWith('%%EOF')).toBe(true)
    const output = writePdf(input, { info: { Title: 'Newline' } })
    expectPrefix(input, output)
    expect(text(output.subarray(input.length, input.length + 9))).toBe('\n5 0 obj\n')
    expectSoundTable(output, input.length)
  })

  it('round-trips a custom name outside ASCII, and matches an existing name as read', () => {
    const input = classicPdf({ info: '<</Title (t) /Caf#C3#A9 (old) /Spaced#20Name (s)>>' })
    const read = readPdf(input)
    expect(info(read)).toEqual({ Title: 't', Café: 'old', 'Spaced Name': 's' })
    const output = writePdf(input, { info: { Café: 'new', 'Spaced Name': null, Überprüft: 'ja' } })
    expect(info(readPdf(output))).toEqual({ Title: 't', Café: 'new', Überprüft: 'ja' })
    expect(text(output.subarray(input.length))).toContain('/Caf#C3#A9 (new)')
  })

  it('writes /Trapped as a name, and a non-ISO date as text', () => {
    const output = writePdf(classicPdf(), { info: { Trapped: 'True', ModDate: 'last Tuesday' } })
    const tail = text(output.subarray(classicPdf().length))
    expect(tail).toContain('/Trapped /True')
    expect(tail).toContain('/ModDate (last Tuesday)')
  })

  it('skips an undefined value rather than writing "undefined"', () => {
    const patch = { Title: 'Set', Subject: undefined } as unknown as Record<string, string>
    const output = writePdf(classicPdf(), { info: patch })
    expect(info(readPdf(output))).toMatchObject({ Title: 'Set', Subject: 'Numbers' })
  })

  it('returns an unchanged copy for an empty edit', () => {
    const input = classicPdf()
    const output = writePdf(input, { info: {} })
    expect(output).toEqual(input)
    expect(output).not.toBe(input)
  })

  describe('refusals', () => {
    const refuses = (bytes: Uint8Array, message: RegExp) => {
      expect(() => writePdf(bytes, { info: { Title: 'x' } })).toThrow(EmbeddedWriteError)
      expect(() => writePdf(bytes, { info: { Title: 'x' } })).toThrow(message)
    }

    it('refuses an encrypted file', () => {
      refuses(classicPdf({ trailer: ' /Encrypt <</Filter /Standard>>' }), /This PDF is encrypted/)
    })

    it('refuses a signed file', () => {
      const message = /This PDF is digitally signed; changing it would invalidate the signature\./
      refuses(
        classicPdf({ extra: (b) => b.obj(9, '<</Type /Sig /ByteRange [0 1 2 3] /Contents <00>>>') }),
        message,
      )
      refuses(classicPdf({ catalog: ' /AcroForm <</Fields [] /SigFlags 1>>' }), message)
    })

    it('refuses a file it could only read by repairing it', () => {
      const s = text(classicPdf())
      refuses(bin(s.replace(/startxref\n\d+/, 'startxref\n7')), /damaged/)
      refuses(bin(s.replace(/(\d{10}) 00000 n/g, (_, o) => `${pad(Number(o) + 1, 10)} 00000 n`)), /damaged/)
      refuses(concat('JUNK\n', classicPdf()), /damaged/)
      const base = classicPdf()
      const looped = concat(
        base,
        `xref\n0 1\n0000000000 65535 f\r\ntrailer\n<</Size 6 /Root 1 0 R /Info 5 0 R /Prev ${base.length}>>\nstartxref\n${base.length}\n%%EOF\n`,
      )
      refuses(looped, /damaged/)
    })

    it('refuses what is not a PDF, and a name no reader could take', () => {
      refuses(bin('GIF89a'), /could not be read as a PDF/)
      expect(() => writePdf(classicPdf(), { info: { '': 'x' } })).toThrow(EmbeddedWriteError)
      expect(() => writePdf(classicPdf(), { info: { ['x'.repeat(200)]: 'x' } })).toThrow(
        EmbeddedWriteError,
      )
    })
  })
})

describe('the fixtures themselves', () => {
  it('compress their xref streams with a predictor the reader must undo', () => {
    const bytes = streamPdf()
    const at = startxrefOf(bytes)
    const parsed = new PdfParser(bytes, at).parseIndirectObject()
    const stream = parsed?.obj
    expect(stream?.kind).toBe('stream')
    if (stream?.kind !== 'stream') return
    expect(text(bytes.subarray(at, at + 400))).toContain('/Predictor 12')
    expect(inflatePdf(stream.data, 1 << 20)?.[0]).toBe(2)
  })
})
