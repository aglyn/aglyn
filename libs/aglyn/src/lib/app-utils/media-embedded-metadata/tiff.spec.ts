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

import { createHash } from 'crypto'

import { readExif, readTiffTagBytes } from './exif'
import { readIim, writeIim } from './iptc'
import { readTiffFile, writeTiffFile } from './tiff'
import { EmbeddedWriteError, type EmbeddedCandidate } from './types'

// Fixtures are built here, byte by byte, rather than committed as files.

const BYTE = 1
const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5
const UNDEFINED = 7
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }

type Order = 'II' | 'MM'

interface Field {
  tag: number
  type: number
  count?: number
  value: ArrayLike<number>
}

const utf8 = (text: string) => Array.from(Buffer.from(text, 'utf8'))

/** Lays out a TIFF file: data is appended, IFDs after their values. */
class TiffBuilder {
  readonly little: boolean
  private readonly out: number[] = []

  constructor(order: Order) {
    this.little = order === 'II'
    this.out.push(
      ...(this.little ? [0x49, 0x49, 0x2a, 0] : [0x4d, 0x4d, 0, 0x2a]),
      0,
      0,
      0,
      0,
    )
  }

  u16(...values: number[]): number[] {
    return values.flatMap((v) =>
      this.little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff],
    )
  }

  u32(...values: number[]): number[] {
    return values.flatMap((v) => {
      const bytes = [
        (v >>> 24) & 0xff,
        (v >>> 16) & 0xff,
        (v >>> 8) & 0xff,
        v & 0xff,
      ]
      return this.little ? bytes.reverse() : bytes
    })
  }

  data(bytes: ArrayLike<number>): number {
    if (this.out.length % 2) this.out.push(0)
    const at = this.out.length
    for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i] ?? 0)
    return at
  }

  ifd(fields: Field[], next = 0): number {
    const placed = [...fields]
      .sort((a, b) => a.tag - b.tag)
      .map((f) => ({
        ...f,
        offset: f.value.length > 4 ? this.data(f.value) : -1,
      }))
    if (this.out.length % 2) this.out.push(0)
    const at = this.out.length
    this.out.push(...this.u16(placed.length))
    for (const f of placed) {
      const count = f.count ?? f.value.length / (SIZES[f.type] ?? 1)
      this.out.push(...this.u16(f.tag, f.type), ...this.u32(count))
      if (f.offset >= 0) {
        this.out.push(...this.u32(f.offset))
      } else {
        const inline = Array.from(f.value)
        while (inline.length < 4) inline.push(0)
        this.out.push(...inline)
      }
    }
    this.out.push(...this.u32(next))
    return at
  }

  build(ifd0: number): Uint8Array {
    const bytes = Uint8Array.from(this.out)
    bytes.set(this.u32(ifd0), 4)
    return bytes
  }
}

function ds(record: number, dataset: number, text: string): number[] {
  const bytes = utf8(text)
  return [
    0x1c,
    record,
    dataset,
    bytes.length >> 8,
    bytes.length & 0xff,
    ...bytes,
  ]
}

function resource(id: number, data: ArrayLike<number>) {
  const n = data.length
  return [
    ...utf8('8BIM'),
    id >> 8,
    id & 0xff,
    0,
    0,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
    ...Array.from(data),
    ...(n % 2 ? [0] : []),
  ]
}

const IIM = Uint8Array.from([
  ...ds(2, 0, '\0\x04'),
  ...ds(2, 5, 'Gray card'),
  ...ds(2, 80, 'Ann Author'),
  ...ds(2, 120, 'A calibration target'),
])

const XMP =
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>'

const md5 = (bytes: Uint8Array) =>
  Array.from(createHash('md5').update(bytes).digest())

const RESOLUTION = resource(
  0x03ed,
  [0, 72, 0, 0, 0, 1, 0, 1, 0, 72, 0, 0, 0, 1, 0, 1],
)

interface Image {
  bytes: Uint8Array
  /** The raw pixel strips, which no write may touch. */
  strips: number[][]
  secret: number[]
  secretAt: number
}

/**
 * An 8×4 grayscale TIFF in two strips, with an Exif IFD whose MakerNote-like
 * blob points by ABSOLUTE offset at data no IFD references.
 */
function image(
  order: Order,
  extra: {
    xmp?: string
    iimType?: number
    iim?: Uint8Array
    irb?: number[]
    stripsLast?: boolean
  } = {},
): Image {
  const t = new TiffBuilder(order)
  const strips = [
    Array.from({ length: 16 }, (_, i) => i * 16),
    Array.from({ length: 16 }, (_, i) => 255 - i * 16),
  ]
  const secret = utf8('camera-private-block')
  const secretAt = t.data(secret)
  const placeStrips = () => strips.map((strip) => t.data(strip))
  const offsets = extra.stripsLast ? [] : placeStrips()
  const exif = t.ifd([
    { tag: 0x9003, type: ASCII, value: [...utf8('2022:08:09 07:06:05'), 0] },
    {
      tag: 0x927c,
      type: UNDEFINED,
      value: [...utf8('NOTE'), ...t.u32(secretAt, secret.length)],
    },
  ])
  const tags: Field[] = [
    { tag: 256, type: SHORT, value: t.u16(8) },
    { tag: 257, type: SHORT, value: t.u16(4) },
    { tag: 258, type: SHORT, value: t.u16(8) },
    { tag: 259, type: SHORT, value: t.u16(1) },
    { tag: 262, type: SHORT, value: t.u16(1) },
    { tag: 270, type: ASCII, value: [...utf8('Gray ramp test chart'), 0] },
    { tag: 277, type: SHORT, value: t.u16(1) },
    { tag: 278, type: SHORT, value: t.u16(2) },
    { tag: 279, type: LONG, value: t.u32(16, 16) },
    { tag: 282, type: RATIONAL, value: t.u32(72, 1) },
    { tag: 283, type: RATIONAL, value: t.u32(72, 1) },
    { tag: 296, type: SHORT, value: t.u16(2) },
    { tag: 315, type: ASCII, value: [...utf8('Ann Author'), 0] },
    { tag: 0x8769, type: LONG, value: t.u32(exif) },
  ]
  if (extra.xmp)
    tags.push({ tag: 700, type: BYTE, value: [...utf8(extra.xmp), 0, 0] })
  if (extra.iim) {
    const type = extra.iimType ?? LONG
    const padded = [...extra.iim]
    while (type === LONG && padded.length % 4) padded.push(0)
    tags.push({ tag: 33723, type, value: padded })
  }
  if (extra.irb) tags.push({ tag: 34377, type: BYTE, value: extra.irb })
  // StripOffsets last: when the strips follow the IFD their offsets are
  // only known once the table is laid out, so they are patched in below.
  const pending = extra.stripsLast ? [0, 0] : offsets
  const stripField: Field = { tag: 273, type: LONG, value: t.u32(...pending) }
  const at = t.ifd([...tags, stripField])
  if (!extra.stripsLast) return { bytes: t.build(at), strips, secret, secretAt }
  const late = placeStrips()
  const bytes = t.build(at)
  const entry = entries(bytes, at).find((e) => e.tag === 273)
  bytes.set(t.u32(...late), entry?.field ?? 0)
  return { bytes, strips, secret, secretAt }
}

// An independent reader, so the specs do not grade the module with itself.

function view(bytes: Uint8Array) {
  const little = bytes[0] === 0x49
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    u16: (at: number) => dv.getUint16(at, little),
    u32: (at: number) => dv.getUint32(at, little),
  }
}

function entries(bytes: Uint8Array, at: number) {
  const v = view(bytes)
  return Array.from({ length: v.u16(at) }, (_, i) => {
    const e = at + 2 + i * 12
    return {
      tag: v.u16(e),
      type: v.u16(e + 2),
      count: v.u32(e + 4),
      field: v.u32(e + 8),
      at: e,
    }
  })
}

function ifd0(bytes: Uint8Array) {
  return view(bytes).u32(4)
}

/** Every strip, read through the file's own StripOffsets/StripByteCounts. */
function stripsOf(bytes: Uint8Array) {
  const v = view(bytes)
  const list = entries(bytes, ifd0(bytes))
  const offsets = list.find((e) => e.tag === 273)
  const counts = list.find((e) => e.tag === 279)
  if (!offsets || !counts) throw new Error('no strips')
  return Array.from({ length: offsets.count }, (_, i) => {
    const at = v.u32(offsets.field + i * 4)
    const size = v.u32(counts.field + i * 4)
    return { at, bytes: Array.from(bytes.subarray(at, at + size)) }
  })
}

function fields(candidates: EmbeddedCandidate[]) {
  return Object.fromEntries(candidates.map((c) => [c.key, c.value]))
}

function changedSpans(before: Uint8Array, after: Uint8Array) {
  const spans: Array<[number, number]> = []
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue
    const start = i
    while (i < before.length && before[i] !== after[i]) i++
    spans.push([start, i])
  }
  return spans
}

/** The pixels and the MakerNote's private data: where they were, unchanged. */
function expectImageIntact(source: Image, out: Uint8Array) {
  const before = stripsOf(source.bytes)
  expect(stripsOf(out)).toEqual(before)
  expect(before.map((s) => s.bytes)).toEqual(source.strips)
  const note = readTiffTagBytes(out, 'exif', 0x927c)?.bytes ?? new Uint8Array()
  const pointed = new DataView(note.buffer, note.byteOffset).getUint32(
    4,
    out[0] === 0x49,
  )
  expect(pointed).toBe(source.secretAt)
  expect(
    Array.from(out.subarray(pointed, pointed + source.secret.length)),
  ).toEqual(source.secret)
}

const BASE_FIELDS = {
  description: 'Gray ramp test chart',
  creator: ['Ann Author'],
  createdAt: '2022-08-09T07:06:05',
}

describe('readTiffFile', () => {
  it('is null for anything that is not a TIFF', () => {
    expect(readTiffFile(new Uint8Array())).toBeNull()
    expect(
      readTiffFile(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])),
    ).toBeNull()
    expect(() =>
      writeTiffFile(Uint8Array.from([1, 2, 3]), { xmp: XMP }),
    ).toThrow(EmbeddedWriteError)
  })

  it('finds nothing in a plain TIFF, whose EXIF readExif reads directly', () => {
    const { bytes } = image('II')
    expect(readTiffFile(bytes)).toEqual({ xmp: null, iim: null, irb: null })
    expect(fields(readExif(bytes))).toEqual(BASE_FIELDS)
  })

  it('reads the XMP packet, the IIM and the Photoshop resource block', () => {
    const irb = [...RESOLUTION, ...resource(0x0404, IIM)]
    const { bytes } = image('MM', { xmp: XMP, iim: IIM, irb })
    const read = readTiffFile(bytes)
    expect(read?.xmp).toBe(XMP)
    expect(fields(readIim(read?.iim ?? new Uint8Array()))).toEqual({
      title: 'Gray card',
      creator: ['Ann Author'],
      description: 'A calibration target',
    })
    expect(Array.from(read?.irb ?? [])).toEqual(irb)
  })

  it('falls back to the IIM inside the resource block', () => {
    const irb = [...RESOLUTION, ...resource(0x0404, IIM)]
    const read = readTiffFile(image('II', { irb }).bytes)
    expect(Array.from(read?.iim ?? [])).toEqual(Array.from(IIM))
  })

  it('never throws on a truncated file', () => {
    const { bytes } = image('MM', { xmp: XMP, iim: IIM })
    for (let n = 0; n <= bytes.length; n++) {
      expect(() => readTiffFile(bytes.subarray(0, n))).not.toThrow()
    }
  })
})

describe.each<Order>(['II', 'MM'])('writeTiffFile (%s)', (order) => {
  it('adds XMP by relocating IFD0, and nothing before it moves', () => {
    const source = image(order)
    const out = writeTiffFile(source.bytes, { xmp: XMP })
    expect(ifd0(out)).toBeGreaterThanOrEqual(source.bytes.length)
    expect(readTiffFile(out)?.xmp).toBe(XMP)
    expect(readTiffTagBytes(out, 'ifd0', 700)?.type).toBe(BYTE)
    const tags = entries(out, ifd0(out)).map((e) => e.tag)
    expect(tags).toEqual([...tags].sort((a, b) => a - b))
    // The only bytes that changed before the old end: the header's IFD0
    // offset and the old IFD0 table, zeroed.
    const old = ifd0(source.bytes)
    const oldSize = 2 + entries(source.bytes, old).length * 12 + 4
    for (const [start, end] of changedSpans(source.bytes, out)) {
      expect(
        (start >= 4 && end <= 8) || (start >= old && end <= old + oldSize),
      ).toBe(true)
    }
    expect(out.subarray(old, old + oldSize).every((b) => b === 0)).toBe(true)
    expect(fields(readExif(out))).toEqual(BASE_FIELDS)
    expectImageIntact(source, out)
  })

  it('replaces XMP in place when it fits and appends it when it does not', () => {
    const source = image(order, { xmp: XMP })
    const shorter = XMP.replace('W5M0MpCehiHzreSzNTczkc9d', 'x')
    const inPlace = writeTiffFile(source.bytes, { xmp: shorter })
    expect(inPlace).toHaveLength(source.bytes.length)
    expect(readTiffFile(inPlace)?.xmp).toBe(shorter)
    const longer = XMP.replace('/>', '><rdf:RDF/></x:xmpmeta>').repeat(3)
    const appended = writeTiffFile(source.bytes, { xmp: longer })
    expect(ifd0(appended)).toBe(ifd0(source.bytes))
    expect(readTiffFile(appended)?.xmp).toBe(longer)
    expectImageIntact(source, inPlace)
    expectImageIntact(source, appended)
  })

  it('removes XMP on null', () => {
    const source = image(order, { xmp: XMP })
    const out = writeTiffFile(source.bytes, { xmp: null })
    expect(readTiffFile(out)?.xmp).toBeNull()
    expect(indexOf(out, utf8('xpacket'))).toBe(-1)
    expectImageIntact(source, out)
  })

  it('adds IPTC as an UNDEFINED tag padded to four bytes', () => {
    // UNDEFINED, not LONG: ImageMagick 7.1 loses a LONG-typed IIM in a
    // big-endian file, and reads UNDEFINED in either byte order.
    const source = image(order)
    const iim = writeIim(new Uint8Array(), {
      title: 'New title',
      creator: ['Zoë'],
    })
    const out = writeTiffFile(source.bytes, { iim })
    const tag = readTiffTagBytes(out, 'ifd0', 33723)
    expect(tag?.type).toBe(UNDEFINED)
    expect(tag?.count).toBe(Math.ceil(iim.length / 4) * 4)
    // The padding is the tag's, not the stream's: it does not come back.
    expect(Array.from(readTiffFile(out)?.iim ?? [])).toEqual(Array.from(iim))
    expect(fields(readIim(readTiffFile(out)?.iim ?? new Uint8Array()))).toEqual(
      {
        title: 'New title',
        creator: ['Zoë'],
      },
    )
    expectImageIntact(source, out)
  })

  it('keeps a LONG-typed IPTC tag LONG when it rewrites it', () => {
    const source = image(order, { iim: IIM })
    const iim = writeIim(IIM, { title: 'Still LONG' })
    const out = writeTiffFile(source.bytes, { iim })
    const tag = readTiffTagBytes(out, 'ifd0', 33723)
    expect(tag?.type).toBe(LONG)
    expect(tag?.count).toBe(Math.ceil(iim.length / 4))
    expect(
      fields(readIim(readTiffFile(out)?.iim ?? new Uint8Array()))['title'],
    ).toBe('Still LONG')
    expectImageIntact(source, out)
  })

  it('keeps the resource block’s copy of the IIM, and its digest, in step', () => {
    const irb = [
      ...RESOLUTION,
      ...resource(0x0404, IIM),
      ...resource(0x0425, md5(IIM)),
    ]
    const source = image(order, { iim: IIM, iimType: UNDEFINED, irb })
    const iim = writeIim(IIM, { title: 'Renamed card', city: 'Oslo' })
    const out = writeTiffFile(source.bytes, { iim })
    const read = readTiffFile(out)
    expect(readTiffTagBytes(out, 'ifd0', 33723)?.type).toBe(UNDEFINED)
    expect(Array.from(read?.iim ?? [])).toEqual(Array.from(iim))
    const block = read?.irb ?? new Uint8Array()
    const expected = [
      ...RESOLUTION,
      ...resource(0x0404, iim),
      ...resource(0x0425, md5(iim)),
    ]
    expect(Array.from(block)).toEqual(expected)
    expectImageIntact(source, out)
  })

  it('updates IPTC only in the resource block when that is its only home', () => {
    const irb = [...RESOLUTION, ...resource(0x0404, IIM)]
    const source = image(order, { irb })
    const iim = writeIim(IIM, { title: 'Only here' })
    const out = writeTiffFile(source.bytes, { iim })
    expect(readTiffTagBytes(out, 'ifd0', 33723)).toBeNull()
    expect(
      fields(readIim(readTiffFile(out)?.iim ?? new Uint8Array()))['title'],
    ).toBe('Only here')
  })

  it('removes IPTC from the tag and the resource block on null', () => {
    const irb = [
      ...RESOLUTION,
      ...resource(0x0404, IIM),
      ...resource(0x0425, md5(IIM)),
    ]
    const source = image(order, { iim: IIM, irb })
    const out = writeTiffFile(source.bytes, { iim: null })
    expect(readTiffFile(out)).toEqual({
      xmp: null,
      iim: null,
      irb: Uint8Array.from(RESOLUTION),
    })
    expect(indexOf(out, utf8('Gray card'))).toBe(-1)
    expectImageIntact(source, out)
  })

  it('writes EXIF, XMP and IPTC in one pass, relocating IFD0 once', () => {
    const source = image(order, { stripsLast: true })
    const iim = writeIim(new Uint8Array(), { title: 'All at once' })
    const out = writeTiffFile(source.bytes, {
      exifPatch: {
        description: 'A gray ramp, remeasured',
        creator: ['Bea Builder'],
        createdAt: '2023-01-02T03:04:05',
        headline: 'not an EXIF key',
      },
      xmp: XMP,
      iim,
    })
    expect(fields(readExif(out))).toEqual({
      description: 'A gray ramp, remeasured',
      creator: ['Bea Builder'],
      createdAt: '2023-01-02T03:04:05',
    })
    expect(readTiffFile(out)?.xmp).toBe(XMP)
    expect(fields(readIim(readTiffFile(out)?.iim ?? new Uint8Array()))).toEqual(
      {
        title: 'All at once',
      },
    )
    // One new IFD0 table: after it, the file ends.
    const at = ifd0(out)
    expect(at + 2 + entries(out, at).length * 12 + 4).toBe(out.length)
    expectImageIntact(source, out)
  })

  it('returns the same bytes when nothing changes', () => {
    const source = image(order, { xmp: XMP, iim: IIM })
    expect(writeTiffFile(source.bytes, {})).toBe(source.bytes)
    expect(writeTiffFile(source.bytes, { xmp: XMP, iim: IIM })).toBe(
      source.bytes,
    )
    expect(
      writeTiffFile(source.bytes, { exifPatch: { creator: ['Ann Author'] } }),
    ).toBe(source.bytes)
  })
})

describe('writeTiffFile limits', () => {
  it('refuses a BigTIFF', () => {
    const bytes = new Uint8Array(32)
    bytes.set([0x49, 0x49, 43, 0, 8, 0, 0, 0, 16])
    expect(readTiffFile(bytes)).toEqual({ xmp: null, iim: null, irb: null })
    expect(() => writeTiffFile(bytes, { xmp: XMP })).toThrow(EmbeddedWriteError)
  })
})

function indexOf(haystack: Uint8Array, needle: number[]) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
