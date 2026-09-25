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
 * The dispatcher (AGL-3331): format sniffing, the fold of several blocks
 * into one field, and the fan-out of one edit to every block that holds it.
 * The format modules have their own specs; this one is about the seams
 * between them, which none of those can see.
 */

import {
  embeddedFormatFor,
  mergeEmbeddedCandidates,
  readMediaEmbeddedMetadata,
  writeMediaEmbeddedMetadata,
} from './index'
import { readJpegBlocks, writeJpegBlocks } from './jpeg'
import { readPngBlocks, writePngBlocks } from './png'
import { readPdf } from './pdf'
import { readIrbIptc } from './iptc'
import { readExif } from './exif'
import { bytesReader, EmbeddedWriteError } from './types'

const encoder = new TextEncoder()

/** A minimal JPEG whose scan data every write must carry through intact. */
function baseJpeg(): Uint8Array {
  const segment = (marker: number, payload: number[]) => [
    0xff,
    marker,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 0xff,
    ...payload,
  ]
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xdb, [0x00, ...Array.from({ length: 64 }, () => 1)]),
    ...segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    ...Array.from({ length: 48 }, (_, i) => (i * 29) & 0x7f),
    0xff, 0xd9,
  ])
}

/** Little-endian TIFF with IFD0 ImageDescription + Artist (ASCII). */
function exifBlock(description: string, artist: string): Uint8Array {
  const strings = [description, artist].map((s) => [...encoder.encode(s), 0])
  const entries = 2
  const ifdSize = 2 + entries * 12 + 4
  let offset = 8 + ifdSize
  const out: number[] = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, entries, 0]
  const values: number[] = []
  const tags = [0x010e, 0x013b]
  strings.forEach((bytes, index) => {
    const tag = tags[index] as number
    out.push(tag & 0xff, tag >> 8, 2, 0)
    out.push(bytes.length & 0xff, (bytes.length >> 8) & 0xff, 0, 0)
    out.push(offset & 0xff, (offset >> 8) & 0xff, 0, 0)
    values.push(...bytes)
    if (bytes.length % 2) values.push(0)
    offset += bytes.length + (bytes.length % 2)
  })
  out.push(0, 0, 0, 0)
  return new Uint8Array([...out, ...values])
}

/** A Photoshop IRB holding an IIM block with a caption and a by-line. */
function irbBlock(caption: string, byline: string): Uint8Array {
  const dataset = (id: number, text: string) => {
    const bytes = [...encoder.encode(text)]
    return [0x1c, 2, id, bytes.length >> 8, bytes.length & 0xff, ...bytes]
  }
  const iim = [
    // 2:00 RecordVersion, the binary 0x0004 every IIM block opens with.
    ...dataset(0, '\u0000\u0004'),
    ...dataset(80, byline),
    ...dataset(120, caption),
  ]
  const size = iim.length
  return new Uint8Array([
    ...encoder.encode('8BIM'),
    0x04, 0x04,
    0, 0, // empty Pascal name, padded
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    ...iim,
    ...(size % 2 ? [0] : []),
  ])
}

const XMP = (description: string) =>
  `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>` +
  `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`

/** A photo holding its caption in all three blocks, disagreeing. */
const threeBlockJpeg = () =>
  writeJpegBlocks(baseJpeg(), {
    exif: exifBlock('exif caption', 'Ana Ruiz'),
    irb: irbBlock('iptc caption', 'Ana Ruiz'),
    xmp: XMP('xmp caption'),
  })

const scan = (bytes: Uint8Array) => {
  const buffer = Buffer.from(bytes)
  return buffer.subarray(buffer.indexOf(Buffer.from([0xff, 0xda])))
}

const read = (contentType: string, bytes: Uint8Array) =>
  readMediaEmbeddedMetadata({ contentType, reader: bytesReader(bytes) })

describe('embeddedFormatFor', () => {
  const head = (...bytes: number[]) => new Uint8Array(bytes)
  const text = (s: string) => encoder.encode(s)

  it('trusts the signature over the label', () => {
    expect(embeddedFormatFor('image/png', head(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(embeddedFormatFor('application/octet-stream', text('%PDF-1.7'))).toBe('pdf')
  })

  it('lets the label settle an ftyp box and a ZIP', () => {
    const ftyp = text('\u0000\u0000\u0000\u0018ftypheic')
    expect(embeddedFormatFor('image/heic', ftyp)).toBe('heif')
    expect(embeddedFormatFor('video/mp4', ftyp)).toBe('mp4')
    const zip = head(0x50, 0x4b, 0x03, 0x04)
    expect(
      embeddedFormatFor(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        zip,
      ),
    ).toBe('ooxml')
    expect(embeddedFormatFor('application/zip', zip)).toBeNull()
  })

  it('has no reader for a CSV', () => {
    expect(embeddedFormatFor('text/csv', text('a,b\n1,2'))).toBeNull()
  })
})

describe('mergeEmbeddedCandidates', () => {
  it('values a field from the most-believed block and names every block', () => {
    const { fields } = mergeEmbeddedCandidates('jpeg', [
      { key: 'description', value: 'from exif', source: 'exif' },
      { key: 'description', value: 'from xmp', source: 'xmp' },
      { key: 'description', value: 'from iptc', source: 'iptc' },
    ])
    expect(fields).toEqual([
      expect.objectContaining({
        key: 'description',
        value: 'from xmp',
        sources: ['xmp', 'iptc', 'exif'],
        editable: true,
      }),
    ])
  })

  it('shows a clipped value but never offers it for editing', () => {
    const { fields, truncated } = mergeEmbeddedCandidates('jpeg', [
      { key: 'description', value: 'x'.repeat(5000), source: 'xmp' },
    ])
    expect(truncated).toBe(true)
    expect(fields[0]?.value).toHaveLength(2000)
    expect(fields[0]?.editable).toBe(false)
  })

  it('drops empty values and dedupes list items', () => {
    const { fields } = mergeEmbeddedCandidates('jpeg', [
      { key: 'title', value: '  ', source: 'xmp' },
      { key: 'keywords', value: ['a', 'b', 'a', ' '], source: 'xmp' },
    ])
    expect(fields.map((f) => f.key)).toEqual(['keywords'])
    expect(fields[0]?.values).toEqual(['a', 'b'])
  })

  it('keeps a value a block marked unwritable out of the editor', () => {
    const { fields } = mergeEmbeddedCandidates('jpeg', [
      { key: 'title', value: 'x', source: 'xmp', editable: false },
    ])
    expect(fields[0]?.editable).toBe(false)
  })

  it('orders by group, then the catalog, then other fields by label', () => {
    const { fields } = mergeEmbeddedCandidates('jpeg', [
      { key: 'make', value: 'Canon', source: 'exif' },
      { key: 'xmp|urn:x|b', label: 'x:b', value: '2', source: 'xmp' },
      { key: 'xmp|urn:x|a', label: 'x:a', value: '1', source: 'xmp' },
      { key: 'copyright', value: '©', source: 'xmp' },
      { key: 'title', value: 't', source: 'xmp' },
    ])
    expect(fields.map((f) => f.key)).toEqual([
      'title',
      'copyright',
      'make',
      'xmp|urn:x|a',
      'xmp|urn:x|b',
    ])
  })
})

describe('reading a photo (AGL-3331)', () => {
  it('folds the three copies of a caption into one field', async () => {
    const record = await read('image/jpeg', threeBlockJpeg())
    const description = record?.fields.find((f) => f.key === 'description')
    expect(description).toMatchObject({
      value: 'xmp caption',
      sources: ['xmp', 'iptc', 'exif'],
      editable: true,
    })
    expect(record?.writable).toBe(true)
  })

  it('answers null for a file with no reader', async () => {
    expect(await read('text/csv', encoder.encode('a,b'))).toBeNull()
  })
})

describe('writing a photo', () => {
  it('updates every block that held the caption, and not a scan byte', () => {
    const before = threeBlockJpeg()
    const after = writeMediaEmbeddedMetadata({
      contentType: 'image/jpeg',
      bytes: before,
      patch: { description: 'Harbor at dusk' },
      now: new Date('2026-09-24T12:00:00Z'),
    })
    expect(scan(after).equals(scan(before))).toBe(true)
    const blocks = readJpegBlocks(after)
    expect(blocks?.xmp).toContain('Harbor at dusk')
    expect(
      readIrbIptc(blocks?.irb as Uint8Array).find((c) => c.key === 'description')
        ?.value,
    ).toBe('Harbor at dusk')
    expect(
      readExif(blocks?.exif as Uint8Array).find((c) => c.key === 'description')
        ?.value,
    ).toBe('Harbor at dusk')
  })

  it('writes a new field into XMP only, planting no EXIF or IPTC block', async () => {
    const after = writeMediaEmbeddedMetadata({
      contentType: 'image/jpeg',
      bytes: baseJpeg(),
      patch: { credit: 'Aglyn' },
    })
    const blocks = readJpegBlocks(after)
    expect(blocks?.exif).toBeUndefined()
    expect(blocks?.irb).toBeUndefined()
    const record = await read('image/jpeg', after)
    expect(record?.fields).toContainEqual(
      expect.objectContaining({ key: 'credit', value: 'Aglyn' }),
    )
  })

  it('refuses a key the format cannot take, in words', () => {
    expect(() =>
      writeMediaEmbeddedMetadata({
        contentType: 'image/jpeg',
        bytes: baseJpeg(),
        patch: { producer: 'x' },
      }),
    ).toThrow(EmbeddedWriteError)
  })
})

describe('writing a PNG', () => {
  /** A 1×1 PNG with a tEXt Title, built by the PNG writer on a bare file. */
  const png = () => {
    const chunk = (type: string, data: number[]) => {
      const body = [...encoder.encode(type), ...data]
      // CRC is recomputed by the writer on anything it touches; the reader
      // must tolerate a zero CRC on this untouched fixture chunk.
      return [
        (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff,
        (data.length >>> 8) & 0xff, data.length & 0xff,
        ...body, 0, 0, 0, 0,
      ]
    }
    const bare = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01]),
      ...chunk('IEND', []),
    ])
    return writePngBlocks(bare, { pngText: { Title: 'Old title' } })
  }

  it('updates the text chunk it had and mirrors the edit into XMP', () => {
    const after = writeMediaEmbeddedMetadata({
      contentType: 'image/png',
      bytes: png(),
      patch: { title: 'New title' },
    })
    const blocks = readPngBlocks(after)
    expect(blocks?.pngText?.find((c) => c.keyword === 'Title')?.text).toBe('New title')
    expect(blocks?.xmp).toContain('New title')
  })
})

describe('writing a PDF', () => {
  const pdf = () => {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
      '<< /Title (Old) /Author (Ana) >>',
    ]
    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, index) => {
      offsets.push(body.length)
      body += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = body.length
    body +=
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`
    return encoder.encode(body)
  }

  it('appends the edit, stamps ModDate, and keeps the original a prefix', () => {
    const before = pdf()
    const after = writeMediaEmbeddedMetadata({
      contentType: 'application/pdf',
      bytes: before,
      patch: { title: 'Brand guidelines', creator: ['Ana', 'Ben'] },
      now: new Date('2026-09-24T12:00:00Z'),
    })
    expect(Buffer.from(after.subarray(0, before.length)).equals(Buffer.from(before))).toBe(
      true,
    )
    const info = Object.fromEntries(
      (readPdf(after)?.info ?? []).map((entry) => [entry.name, entry.value]),
    )
    expect(info['Title']).toBe('Brand guidelines')
    expect(info['Author']).toBe('Ana; Ben')
    expect(info['ModDate']).toMatch(/^2026-09-24T12:00:00/)
  })
})
