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

import {
  readExif,
  readTiffTagBytes,
  writeExif,
  writeTiffTags,
  type TiffTagWrite,
} from './exif'
import {
  EmbeddedWriteError,
  type EmbeddedCandidate,
  type EmbeddedPatch,
} from './types'

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
const latin1 = (text: string) => Array.from(Buffer.from(text, 'latin1'))
/** A Windows XP tag: UCS-2LE with a 2-byte terminator. */
const xp = (text: string) => [...Buffer.from(text, 'utf16le'), 0, 0]

/** Lays out a TIFF block: data is appended, IFDs after their values. */
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

  get length() {
    return this.out.length
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

  rational(...pairs: Array<[number, number]>): number[] {
    return pairs.flatMap(([n, d]) => this.u32(n, d))
  }

  ascii(text: string): number[] {
    return [...utf8(text), 0]
  }

  /** Raw bytes at the next even offset. */
  data(bytes: ArrayLike<number>): number {
    if (this.out.length % 2) this.out.push(0)
    const at = this.out.length
    for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i] ?? 0)
    return at
  }

  /** Bytes exactly where the block ends, with no alignment. */
  raw(bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i] ?? 0)
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

interface Camera {
  bytes: Uint8Array
  little: boolean
  /** The raw GPSLatitude rationals, which a scrub must leave nowhere. */
  latitude: number[]
  preview: number[]
  previewAt: number
  thumbnail: number[]
  thumbnailAt: number
}

/**
 * A camera-like EXIF block: IFD0 with every mapped text tag and the XP
 * tags, an Exif IFD with a MakerNote that points by ABSOLUTE offset at a
 * preview no IFD references, a GPS IFD, and IFD1 with a thumbnail.
 */
function camera(order: Order): Camera {
  const t = new TiffBuilder(order)
  const preview = utf8('PREVIEW-IMAGE-BYTES-0123456789')
  const previewAt = t.data(preview)
  const makerNote = [
    ...utf8('MKNT'),
    ...t.u32(previewAt, preview.length),
    ...utf8('private-camera-data'),
  ]
  const thumbnail = [0xff, 0xd8, ...utf8('thumbnail'), 0xff, 0xd9]
  const thumbnailAt = t.data(thumbnail)
  const ifd1 = t.ifd([
    { tag: 0x0103, type: SHORT, value: t.u16(6) },
    { tag: 0x0201, type: LONG, value: t.u32(thumbnailAt) },
    { tag: 0x0202, type: LONG, value: t.u32(thumbnail.length) },
  ])
  const latitude = t.rational([48, 1], [51, 1], [2964, 100])
  const gps = t.ifd([
    { tag: 0x0000, type: BYTE, value: [2, 3, 0, 0] },
    { tag: 0x0001, type: ASCII, value: t.ascii('N') },
    { tag: 0x0002, type: RATIONAL, value: latitude },
    { tag: 0x0003, type: ASCII, value: t.ascii('E') },
    {
      tag: 0x0004,
      type: RATIONAL,
      value: t.rational([2, 1], [17, 1], [4020, 100]),
    },
    { tag: 0x0005, type: BYTE, value: [0] },
    { tag: 0x0006, type: RATIONAL, value: t.rational([351, 10]) },
  ])
  const exif = t.ifd([
    { tag: 0x829a, type: RATIONAL, value: t.rational([1, 250]) },
    { tag: 0x829d, type: RATIONAL, value: t.rational([28, 10]) },
    { tag: 0x8827, type: SHORT, value: t.u16(400) },
    { tag: 0x9003, type: ASCII, value: t.ascii('2021:05:03 10:11:12') },
    { tag: 0x9010, type: ASCII, value: t.ascii('+02:00') },
    { tag: 0x9011, type: ASCII, value: t.ascii('+02:00') },
    { tag: 0x9209, type: SHORT, value: t.u16(0x19) },
    { tag: 0x920a, type: RATIONAL, value: t.rational([35, 1]) },
    { tag: 0x927c, type: UNDEFINED, value: makerNote },
    {
      tag: 0x9286,
      type: UNDEFINED,
      value: [...utf8('ASCII\0\0\0'), ...utf8('Shot from the pier')],
    },
    { tag: 0xa434, type: ASCII, value: t.ascii('RF24-105mm F4 L IS USM') },
  ])
  const ifd0 = t.ifd(
    [
      { tag: 0x010e, type: ASCII, value: t.ascii('A quiet harbor at dawn') },
      { tag: 0x010f, type: ASCII, value: t.ascii('Canon') },
      { tag: 0x0110, type: ASCII, value: t.ascii('Canon EOS R5') },
      { tag: 0x0112, type: SHORT, value: t.u16(6) },
      { tag: 0x0131, type: ASCII, value: t.ascii('Lightroom Classic') },
      { tag: 0x0132, type: ASCII, value: t.ascii('2021:05:04 09:00:00') },
      { tag: 0x013b, type: ASCII, value: t.ascii('Ann Author; Bob Builder') },
      {
        tag: 0x8298,
        type: ASCII,
        value: [...utf8('© 2021 Ann Author'), 0, ...utf8('Ed Itor'), 0],
      },
      { tag: 0x8769, type: LONG, value: t.u32(exif) },
      { tag: 0x8825, type: LONG, value: t.u32(gps) },
      { tag: 0x9c9b, type: BYTE, value: xp('Harbor') },
      { tag: 0x9c9c, type: BYTE, value: xp('XP comment') },
      { tag: 0x9c9d, type: BYTE, value: xp('Ann Author') },
      { tag: 0x9c9e, type: BYTE, value: xp('harbor;dawn;boats') },
    ],
    ifd1,
  )
  return {
    bytes: t.build(ifd0),
    little: t.little,
    latitude,
    preview,
    previewAt,
    thumbnail,
    thumbnailAt,
  }
}

const CAMERA_FIELDS = {
  title: 'Harbor',
  description: 'A quiet harbor at dawn',
  keywords: ['harbor', 'dawn', 'boats'],
  comment: 'Shot from the pier',
  creator: ['Ann Author', 'Bob Builder'],
  copyright: '© 2021 Ann Author',
  gps: '48.858233,2.294500',
  gpsAltitude: '35.1 m',
  createdAt: '2021-05-03T10:11:12+02:00',
  make: 'Canon',
  model: 'Canon EOS R5',
  lens: 'RF24-105mm F4 L IS USM',
  exposure: '1/250 s',
  aperture: 'f/2.8',
  iso: '400',
  focalLength: '35 mm',
  flash: 'Fired, auto mode',
  modifiedAt: '2021-05-04T09:00:00+02:00',
  software: 'Lightroom Classic',
  orientation: 'Rotate 90 CW',
}

/** The camera's fields minus some keys. */
function without(...keys: Array<keyof typeof CAMERA_FIELDS>) {
  const rest: Partial<typeof CAMERA_FIELDS> = { ...CAMERA_FIELDS }
  for (const key of keys) delete rest[key]
  return rest
}

function fields(candidates: EmbeddedCandidate[]) {
  return Object.fromEntries(candidates.map((c) => [c.key, c.value]))
}

// An independent reader, so the specs do not grade the module with itself.

function view(bytes: Uint8Array) {
  const little = bytes[0] === 0x49
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    little,
    u16: (at: number) => dv.getUint16(at, little),
    u32: (at: number) => dv.getUint32(at, little),
  }
}

interface RawEntry {
  tag: number
  type: number
  count: number
  field: number
  at: number
}

function table(bytes: Uint8Array, at: number) {
  const v = view(bytes)
  const n = v.u16(at)
  const entries: RawEntry[] = []
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12
    entries.push({
      tag: v.u16(e),
      type: v.u16(e + 2),
      count: v.u32(e + 4),
      field: v.u32(e + 8),
      at: e,
    })
  }
  return { entries, next: v.u32(at + 2 + n * 12), size: 2 + n * 12 + 4 }
}

function ifd0At(bytes: Uint8Array) {
  return view(bytes).u32(4)
}

function pointerOf(bytes: Uint8Array, tag: number) {
  return table(bytes, ifd0At(bytes)).entries.find((e) => e.tag === tag)?.field
}

/** Offsets in the common prefix where the two differ, as [start, end). */
function changedSpans(before: Uint8Array, after: Uint8Array) {
  const spans: Array<[number, number]> = []
  const n = Math.min(before.length, after.length)
  for (let i = 0; i < n; i++) {
    if (before[i] === after[i]) continue
    const start = i
    while (i < n && before[i] !== after[i]) i++
    spans.push([start, i])
  }
  return spans
}

function within(
  spans: Array<[number, number]>,
  allowed: Array<[number, number]>,
) {
  return spans.every(([s, e]) => allowed.some(([a, b]) => s >= a && e <= b))
}

function indexOfBytes(haystack: Uint8Array, needle: number[]) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Where a tag's out-of-line value sits, via the module's own reader. */
function valueAt(bytes: Uint8Array, ifd: 'ifd0' | 'exif' | 'gps', tag: number) {
  const value = readTiffTagBytes(bytes, ifd, tag)
  if (!value) throw new Error(`no tag ${tag}`)
  return value.bytes.byteOffset - bytes.byteOffset
}

/**
 * The bytes the writer can never see into: the MakerNote, the preview it
 * points at by absolute offset, and the IFD1 thumbnail. All must come
 * through where they were and byte-identical, still reachable.
 */
function expectOpaqueDataIntact(cam: Camera, after: Uint8Array) {
  const note = readTiffTagBytes(cam.bytes, 'exif', 0x927c)
  const noteAfter = readTiffTagBytes(after, 'exif', 0x927c)
  expect(note).not.toBeNull()
  expect(noteAfter?.bytes.byteOffset).toBe(note?.bytes.byteOffset)
  expect(Array.from(noteAfter?.bytes ?? [])).toEqual(
    Array.from(note?.bytes ?? []),
  )
  const v = view(after)
  const pointed = v.u32(valueAt(after, 'exif', 0x927c) + 4)
  expect(pointed).toBe(cam.previewAt)
  expect(
    Array.from(after.subarray(pointed, pointed + cam.preview.length)),
  ).toEqual(cam.preview)
  const ifd1 = table(after, table(after, ifd0At(after)).next)
  const thumbAt = ifd1.entries.find((e) => e.tag === 0x0201)?.field ?? -1
  expect(thumbAt).toBe(cam.thumbnailAt)
  expect(
    Array.from(after.subarray(thumbAt, thumbAt + cam.thumbnail.length)),
  ).toEqual(cam.thumbnail)
}

// ---------------------------------------------------------------------------

describe.each<Order>(['II', 'MM'])('readExif (%s)', (order) => {
  it('maps IFD0, the Exif IFD and the GPS IFD onto canonical keys', () => {
    const candidates = readExif(camera(order).bytes)
    expect(fields(candidates)).toEqual(CAMERA_FIELDS)
    expect(candidates.every((c) => c.source === 'exif')).toBe(true)
    expect(candidates.every((c) => c.editable === undefined)).toBe(true)
  })
})

describe('readExif', () => {
  function single(
    fieldsList: Field[],
    exifFields: Field[] = [],
    order: Order = 'II',
  ) {
    const t = new TiffBuilder(order)
    const extra: Field[] = []
    if (exifFields.length) {
      extra.push({ tag: 0x8769, type: LONG, value: t.u32(t.ifd(exifFields)) })
    }
    return fields(readExif(t.build(t.ifd([...fieldsList, ...extra]))))
  }

  it('names every orientation', () => {
    const t = new TiffBuilder('II')
    const names = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (n) =>
        single([{ tag: 0x0112, type: SHORT, value: t.u16(n) }])['orientation'],
    )
    expect(names).toEqual([
      'Horizontal (normal)',
      'Mirror horizontal',
      'Rotate 180',
      'Mirror vertical',
      'Mirror horizontal and rotate 270 CW',
      'Rotate 90 CW',
      'Mirror horizontal and rotate 90 CW',
      'Rotate 270 CW',
      undefined,
    ])
  })

  it('prints exposure, aperture and focal length the way photographers read them', () => {
    const t = new TiffBuilder('MM')
    const read = (
      exposure: [number, number],
      f: [number, number],
      mm: [number, number],
    ) =>
      single(
        [],
        [
          { tag: 0x829a, type: RATIONAL, value: t.rational(exposure) },
          { tag: 0x829d, type: RATIONAL, value: t.rational(f) },
          { tag: 0x920a, type: RATIONAL, value: t.rational(mm) },
        ],
        'MM',
      )
    expect(read([1, 250], [28, 10], [35, 1])).toMatchObject({
      exposure: '1/250 s',
      aperture: 'f/2.8',
      focalLength: '35 mm',
    })
    expect(read([10, 300], [8, 1], [42, 10])).toMatchObject({
      exposure: '1/30 s',
      aperture: 'f/8',
      focalLength: '4.2 mm',
    })
    expect(read([1, 3], [56, 10], [50, 1])).toMatchObject({ exposure: '0.3 s' })
    expect(read([2, 1], [16, 1], [200, 1])).toMatchObject({ exposure: '2 s' })
    // A zero denominator is "unknown", never Infinity.
    expect(read([1, 0], [0, 0], [0, 0])).toEqual({})
  })

  it('describes the flash', () => {
    const t = new TiffBuilder('II')
    const flash = (value: number) =>
      single([], [{ tag: 0x9209, type: SHORT, value: t.u16(value) }])['flash']
    expect(flash(0x00)).toBe('Did not fire')
    expect(flash(0x01)).toBe('Fired')
    expect(flash(0x19)).toBe('Fired, auto mode')
    expect(flash(0x10)).toBe('Did not fire, flash suppressed')
    expect(flash(0x09)).toBe('Fired, compulsory flash mode')
    expect(flash(0x20)).toBe('No flash function')
    expect(flash(0x5f)).toBe(
      'Fired, auto mode, return detected, red-eye reduction',
    )
  })

  it('reads dates as ISO, with an offset only when one was recorded', () => {
    const t = new TiffBuilder('II')
    const read = (original: string, offset?: string) =>
      single(
        [],
        [
          { tag: 0x9003, type: ASCII, value: t.ascii(original) },
          ...(offset
            ? [{ tag: 0x9011, type: ASCII, value: t.ascii(offset) }]
            : []),
        ],
      )['createdAt']
    expect(read('2021:05:03 10:11:12')).toBe('2021-05-03T10:11:12')
    expect(read('2021:05:03 10:11:12', '-07:00')).toBe(
      '2021-05-03T10:11:12-07:00',
    )
    expect(read('2021:05:03 10:11:12', '   :  ')).toBe('2021-05-03T10:11:12')
    expect(read('2021:05:03   :  :  ')).toBe('2021-05-03')
    expect(read('0000:00:00 00:00:00')).toBeUndefined()
    expect(read('    :  :     :  :  ')).toBeUndefined()
    expect(read('2021:13:03 10:11:12')).toBeUndefined()
  })

  it('decodes UTF-8 strings and falls back to Latin-1', () => {
    const read = (bytes: number[]) =>
      single([{ tag: 0x010e, type: ASCII, value: [...bytes, 0] }])[
        'description'
      ]
    expect(read(utf8('Café in Zürich — 東京'))).toBe('Café in Zürich — 東京')
    expect(read(latin1('Café in Zürich'))).toBe('Café in Zürich')
    // 0x93/0x94 are Windows-1252 curly quotes, as "Latin-1" text really is.
    expect(read([0x93, ...utf8('quoted'), 0x94])).toBe('“quoted”')
    expect(
      read([...utf8('  padded  '), 0, ...utf8('junk after the NUL')]),
    ).toBe('padded')
    expect(read(utf8('   '))).toBeUndefined()
  })

  it('decodes UserComment in ASCII and UNICODE, in either byte order', () => {
    const comment = (order: Order, body: number[]) =>
      single([], [{ tag: 0x9286, type: UNDEFINED, value: body }], order)[
        'comment'
      ]
    const unicode = utf8('UNICODE\0')
    const le = Array.from(Buffer.from('Grüße', 'utf16le'))
    const be = Array.from(Buffer.from('Grüße', 'utf16le').swap16())
    expect(comment('II', [...unicode, ...le])).toBe('Grüße')
    expect(comment('MM', [...unicode, ...be])).toBe('Grüße')
    // Microsoft writes little-endian into a big-endian block.
    expect(comment('MM', [...unicode, ...le])).toBe('Grüße')
    expect(comment('MM', [...unicode, 0xff, 0xfe, ...le])).toBe('Grüße')
    expect(comment('II', [...utf8('ASCII\0\0\0'), ...utf8('plain')])).toBe(
      'plain',
    )
    // JIS and the undefined code are not decoded.
    expect(
      comment('II', [...utf8('JIS\0\0\0\0\0'), 0x30, 0x42]),
    ).toBeUndefined()
    expect(
      comment('II', [0, 0, 0, 0, 0, 0, 0, 0, ...utf8('text')]),
    ).toBeUndefined()
    expect(comment('II', utf8('ASCII'))).toBeUndefined()
  })

  it('prefers the standard tag over the Windows XP spelling of the same idea', () => {
    const t = new TiffBuilder('II')
    expect(
      single([
        { tag: 0x013b, type: ASCII, value: t.ascii('Ann') },
        { tag: 0x9c9d, type: BYTE, value: xp('Someone Else') },
        { tag: 0x9c9c, type: BYTE, value: xp('Only in XP') },
      ]),
    ).toEqual({ creator: ['Ann'], comment: 'Only in XP' })
    expect(
      single([{ tag: 0x9c9d, type: BYTE, value: xp('Ann; Bob;; Ann') }]),
    ).toEqual({ creator: ['Ann', 'Bob'] })
  })

  it('signs GPS by its references and reads altitude below sea level', () => {
    const gps = (refs: [string, string] | null, altitudeRef: number) => {
      const t = new TiffBuilder('MM')
      const g = t.ifd([
        ...(refs
          ? [
              { tag: 1, type: ASCII, value: t.ascii(refs[0]) },
              { tag: 3, type: ASCII, value: t.ascii(refs[1]) },
            ]
          : []),
        {
          tag: 2,
          type: RATIONAL,
          value: t.rational([33, 1], [51, 1], [5400, 100]),
        },
        {
          tag: 4,
          type: RATIONAL,
          value: t.rational([151, 1], [12, 1], [3600, 100]),
        },
        { tag: 5, type: BYTE, value: [altitudeRef] },
        { tag: 6, type: RATIONAL, value: t.rational([1234, 100]) },
      ])
      return fields(
        readExif(
          t.build(t.ifd([{ tag: 0x8825, type: LONG, value: t.u32(g) }])),
        ),
      )
    }
    expect(gps(['S', 'E'], 1)).toEqual({
      gps: '-33.865000,151.210000',
      gpsAltitude: '-12.3 m',
    })
    expect(gps(['N', 'W'], 0)).toMatchObject({ gps: '33.865000,-151.210000' })
    expect(gps(null, 0)).toMatchObject({ gps: '33.865000,151.210000' })
  })

  it('skips a coordinate whose degrees are unknown or out of range', () => {
    const t = new TiffBuilder('II')
    const g = t.ifd([
      { tag: 2, type: RATIONAL, value: t.rational([0, 0], [0, 0], [0, 0]) },
      { tag: 4, type: RATIONAL, value: t.rational([200, 1], [0, 1], [0, 1]) },
    ])
    expect(
      readExif(t.build(t.ifd([{ tag: 0x8825, type: LONG, value: t.u32(g) }]))),
    ).toEqual([])
  })

  it('reads BigTIFF, and marks what it read as not editable', () => {
    // BigTIFF: II, 43, offset size 8, reserved 0, 8-byte IFD0 offset, then
    // 8-byte counts and 20-byte entries whose values inline up to 8 bytes.
    const bytes = new Uint8Array(96)
    const dv = new DataView(bytes.buffer)
    bytes.set([0x49, 0x49, 43, 0, 8, 0, 0, 0])
    dv.setBigUint64(8, 16n, true)
    dv.setBigUint64(16, 2n, true)
    dv.setUint16(24, 0x010e, true)
    dv.setUint16(26, ASCII, true)
    dv.setBigUint64(28, 20n, true)
    dv.setBigUint64(36, 72n, true)
    dv.setUint16(44, 0x010f, true)
    dv.setUint16(46, ASCII, true)
    dv.setBigUint64(48, 6n, true)
    bytes.set(utf8('Canon\0'), 56)
    bytes.set(utf8('A BigTIFF photograph'), 72)
    const candidates = readExif(bytes)
    expect(fields(candidates)).toEqual({
      description: 'A BigTIFF photograph',
      make: 'Canon',
    })
    expect(candidates.every((c) => c.editable === false)).toBe(true)
    expect(() => writeExif(bytes, { make: 'Nikon' })).toThrow(
      EmbeddedWriteError,
    )
  })
})

describe('readExif on hostile input', () => {
  it('returns nothing for bytes that are not TIFF', () => {
    expect(readExif(new Uint8Array())).toEqual([])
    expect(
      readExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0])),
    ).toEqual([])
    expect(
      readExif(Uint8Array.from([0x49, 0x49, 43, 0, 4, 0, 0, 0, 0, 0])),
    ).toEqual([])
  })

  it('never throws on any truncation of a real block', () => {
    const { bytes } = camera('MM')
    for (let n = 0; n <= bytes.length; n++) {
      expect(() => readExif(bytes.subarray(0, n))).not.toThrow()
    }
  })

  it('ends a walk that loops back on itself', () => {
    const t = new TiffBuilder('II')
    const bytes = t.build(
      t.ifd([
        { tag: 0x010f, type: ASCII, value: t.ascii('Loop') },
        { tag: 0x8769, type: LONG, value: t.u32(0) },
        { tag: 0x8825, type: LONG, value: t.u32(0) },
      ]),
    )
    // Exif points at IFD0, GPS into the middle of it, IFD0's next at itself.
    const at = ifd0At(bytes)
    const dv = new DataView(bytes.buffer)
    for (const e of table(bytes, at).entries) {
      if (e.tag === 0x8769) dv.setUint32(e.at + 8, at, true)
      if (e.tag === 0x8825) dv.setUint32(e.at + 8, at + 2, true)
    }
    dv.setUint32(at + 2 + 3 * 12, at, true)
    expect(fields(readExif(bytes))).toEqual({ make: 'Loop' })
    expect(fields(readExif(writeExif(bytes, { make: 'Loops' })))).toEqual({
      make: 'Loops',
    })
  })

  it('survives a cycle through the Exif and GPS pointers', () => {
    const t = new TiffBuilder('MM')
    const exif = t.ifd([
      { tag: 0x9003, type: ASCII, value: t.ascii('2020:01:01 00:00:00') },
    ])
    const bytes = t.build(
      t.ifd([
        { tag: 0x010f, type: ASCII, value: t.ascii('Cycle') },
        { tag: 0x8769, type: LONG, value: t.u32(exif) },
        { tag: 0x8825, type: LONG, value: t.u32(exif) },
      ]),
    )
    // Patch IFD0's next pointer to IFD0 itself.
    const ifd0 = ifd0At(bytes)
    const n = view(bytes).u16(ifd0)
    new DataView(bytes.buffer).setUint32(ifd0 + 2 + n * 12, ifd0, false)
    expect(fields(readExif(bytes))).toEqual({
      make: 'Cycle',
      createdAt: '2020-01-01T00:00:00',
    })
    // The GPS pointer reaches an IFD already walked: removing "its" location
    // cannot be done safely, and says so.
    expect(() => writeExif(bytes, { gps: null })).toThrow(EmbeddedWriteError)
  })

  it('drops a GPS pointer that points at nothing, and refuses one it cannot read', () => {
    const withPointer = (target: number) => {
      const t = new TiffBuilder('MM')
      return t.build(
        t.ifd([
          { tag: 0x010f, type: ASCII, value: t.ascii('Canon') },
          { tag: 0x8825, type: LONG, value: t.u32(target) },
        ]),
      )
    }
    for (const target of [0, 0xfffffff0]) {
      const out = writeExif(withPointer(target), { gps: null })
      expect(pointerOf(out, 0x8825)).toBeUndefined()
      expect(fields(readExif(out))).toEqual({ make: 'Canon' })
    }
    // Inside the block but not an IFD: it may hide coordinates.
    const bytes = withPointer(0)
    new DataView(bytes.buffer).setUint32(
      (table(bytes, ifd0At(bytes)).entries[1]?.at ?? 0) + 8,
      bytes.length - 1,
    )
    expect(() => writeExif(bytes, { gps: null })).toThrow(EmbeddedWriteError)
  })

  it('skips values that run past the end or whose count overflows', () => {
    const t = new TiffBuilder('II')
    const bytes = t.build(
      t.ifd([
        { tag: 0x010e, type: ASCII, count: 64, value: t.u32(0xfffffff0) },
        { tag: 0x010f, type: RATIONAL, count: 0xffffffff, value: t.u32(8) },
        { tag: 0x0110, type: ASCII, value: t.ascii('Model') },
        { tag: 0x0112, type: 99, value: t.u32(0) },
      ]),
    )
    expect(fields(readExif(bytes))).toEqual({ model: 'Model' })
    // And a write can repair the unreachable value by pointing it anew.
    const out = writeExif(bytes, { description: 'Found again' })
    expect(fields(readExif(out))).toEqual({
      description: 'Found again',
      model: 'Model',
    })
  })

  it('refuses an IFD whose entry count runs past the end', () => {
    const t = new TiffBuilder('II')
    t.raw(t.u16(0xffff))
    t.raw([0, 1, 2, 3, 4, 5])
    expect(readExif(t.build(8))).toEqual([])
  })

  it('never throws on mutated input, and writes only fail cleanly', () => {
    // Deterministic PRNG (mulberry32) so a failure reproduces.
    let seed = 0x3331
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const cameras = [camera('II').bytes, camera('MM').bytes]
    const patch: EmbeddedPatch = {
      description: 'A much longer description than the one before it',
      creator: ['Someone'],
      createdAt: '2020-02-02T02:02:02Z',
      lens: null,
      gps: null,
    }
    let written = 0
    for (let run = 0; run < 1500; run++) {
      const source = cameras[run % 2] ?? new Uint8Array()
      const bytes = source.slice()
      const flips = 1 + Math.floor(random() * 4)
      for (let i = 0; i < flips; i++) {
        bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
      }
      expect(() => readExif(bytes)).not.toThrow()
      let out: Uint8Array | null = null
      try {
        out = writeExif(bytes, patch, { maxLength: 65527 })
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddedWriteError)
      }
      if (out) {
        written++
        expect(() => readExif(out as Uint8Array)).not.toThrow()
        expect(out.length).toBeLessThanOrEqual(65527)
      }
    }
    expect(written).toBeGreaterThan(1000)
  })
})

describe.each<Order>(['II', 'MM'])('writeExif (%s)', (order) => {
  it('overwrites a value that fits in place, NUL-filling the rest', () => {
    const cam = camera(order)
    const slot = valueAt(cam.bytes, 'ifd0', 0x010e)
    const entry = table(cam.bytes, ifd0At(cam.bytes)).entries.find(
      (e) => e.tag === 0x010e,
    )
    const out = writeExif(cam.bytes, { description: 'Calm harbor' })
    expect(out.length).toBe(cam.bytes.length)
    expect(valueAt(out, 'ifd0', 0x010e)).toBe(slot)
    expect(Array.from(out.subarray(slot + 11, slot + 23))).toEqual(
      Array(12).fill(0),
    )
    expect(fields(readExif(out))).toEqual({
      ...CAMERA_FIELDS,
      description: 'Calm harbor',
    })
    // Only the value slot and the entry's count changed.
    expect(
      within(changedSpans(cam.bytes, out), [
        [slot, slot + 23],
        [(entry?.at ?? 0) + 4, (entry?.at ?? 0) + 8],
      ]),
    ).toBe(true)
    expectOpaqueDataIntact(cam, out)
  })

  it('appends a value that does not fit and repoints only its entry', () => {
    const cam = camera(order)
    const slot = valueAt(cam.bytes, 'ifd0', 0x010e)
    const entry = table(cam.bytes, ifd0At(cam.bytes)).entries.find(
      (e) => e.tag === 0x010e,
    )
    const long =
      'A quiet harbor at dawn, fishing boats returning under a pink sky'
    const out = writeExif(cam.bytes, { description: long })
    const moved = valueAt(out, 'ifd0', 0x010e)
    expect(moved).toBeGreaterThanOrEqual(cam.bytes.length)
    expect(moved % 2).toBe(0)
    expect(Array.from(cam.bytes.subarray(slot, slot + 23)).some(Boolean)).toBe(
      true,
    )
    expect(
      Array.from(out.subarray(slot, slot + 23)).every((b) => b === 0),
    ).toBe(true)
    expect(
      within(changedSpans(cam.bytes, out), [
        [slot, slot + 23],
        [(entry?.at ?? 0) + 4, (entry?.at ?? 0) + 12],
      ]),
    ).toBe(true)
    expect(fields(readExif(out))).toEqual({
      ...CAMERA_FIELDS,
      description: long,
    })
    expectOpaqueDataIntact(cam, out)
  })

  it('moves a value that shrinks to four bytes inside its entry', () => {
    const cam = camera(order)
    const slot = valueAt(cam.bytes, 'ifd0', 0x010f)
    const out = writeExif(cam.bytes, { make: 'LG' })
    const entry = table(out, ifd0At(out)).entries.find((e) => e.tag === 0x010f)
    expect(entry?.count).toBe(3)
    expect(valueAt(out, 'ifd0', 0x010f)).toBe((entry?.at ?? 0) + 8)
    expect(Array.from(out.subarray(slot, slot + 6))).toEqual([0, 0, 0, 0, 0, 0])
    expect(fields(readExif(out))['make']).toBe('LG')
  })

  it('round-trips every mapped key and leaves the rest alone', () => {
    const cam = camera(order)
    const out = writeExif(
      cam.bytes,
      {
        title: 'Première lumière',
        description: 'Harbor at first light, looking east',
        keywords: ['harbor', 'sunrise'],
        comment: 'Tourné depuis la jetée',
        creator: ['Zoë Photographer', 'Second Shooter'],
        copyright: '© 2024 Zoë',
        createdAt: '2024-06-01T05:30:00-04:00',
        make: 'Nikon',
        model: 'Z 8',
        lens: 'NIKKOR Z 24-120mm f/4 S',
        software: 'Aglyn',
      },
      { maxLength: 65527 },
    )
    expect(fields(readExif(out))).toEqual({
      ...CAMERA_FIELDS,
      title: 'Première lumière',
      description: 'Harbor at first light, looking east',
      keywords: ['harbor', 'sunrise'],
      comment: 'Tourné depuis la jetée',
      creator: ['Zoë Photographer', 'Second Shooter'],
      copyright: '© 2024 Zoë',
      createdAt: '2024-06-01T05:30:00-04:00',
      make: 'Nikon',
      model: 'Z 8',
      lens: 'NIKKOR Z 24-120mm f/4 S',
      software: 'Aglyn',
    })
    // Artist and XPAuthor both hold the new creators; neither is stale.
    expect(
      Buffer.from(
        readTiffTagBytes(out, 'ifd0', 0x013b)?.bytes ?? [],
      ).toString(),
    ).toBe('Zoë Photographer; Second Shooter\0')
    expect(
      Buffer.from(readTiffTagBytes(out, 'ifd0', 0x9c9d)?.bytes ?? []).toString(
        'utf16le',
      ),
    ).toBe('Zoë Photographer; Second Shooter\0')
    expect(
      Buffer.from(readTiffTagBytes(out, 'ifd0', 0x9c9c)?.bytes ?? []).toString(
        'utf16le',
      ),
    ).toBe('Tourné depuis la jetée\0')
    // The editor's half of the copyright is kept.
    expect(
      Buffer.from(
        readTiffTagBytes(out, 'ifd0', 0x8298)?.bytes ?? [],
      ).toString(),
    ).toBe('© 2024 Zoë\0Ed Itor\0')
    // Non-ASCII text turned the ASCII UserComment into a UNICODE one.
    const comment =
      readTiffTagBytes(out, 'exif', 0x9286)?.bytes ?? new Uint8Array()
    expect(Buffer.from(comment.subarray(0, 8)).toString('latin1')).toBe(
      'UNICODE\0',
    )
    expect(ifd0At(out)).toBe(ifd0At(cam.bytes))
    expectOpaqueDataIntact(cam, out)
  })

  it('changes nothing when the values are already there', () => {
    const cam = camera(order)
    const out = writeExif(cam.bytes, {
      title: 'Harbor',
      description: 'A quiet harbor at dawn',
      keywords: ['harbor', 'dawn', 'boats'],
      copyright: '© 2021 Ann Author',
      createdAt: '2021-05-03T10:11:12+02:00',
      make: 'Canon',
      model: 'Canon EOS R5',
      lens: 'RF24-105mm F4 L IS USM',
      software: 'Lightroom Classic',
    })
    expect(out).toBe(cam.bytes)
  })

  it('never adds a tag, and ignores keys it does not map', () => {
    const t = new TiffBuilder(order)
    const bytes = t.build(
      t.ifd([{ tag: 0x010f, type: ASCII, value: t.ascii('Canon') }]),
    )
    const out = writeExif(bytes, {
      title: 'New',
      description: 'New',
      creator: ['New'],
      createdAt: '2024-01-01T00:00:00',
      headline: 'Not an EXIF field',
      'xmp|http://ns.adobe.com/photoshop/1.0/|City': 'Paris',
      gps: null,
      exposure: '1/8000 s',
    })
    expect(out).toBe(bytes)
  })

  it('removes a tag by relocating IFD0, sorted, next pointer kept', () => {
    const cam = camera(order)
    const before = table(cam.bytes, ifd0At(cam.bytes))
    const slot = valueAt(cam.bytes, 'ifd0', 0x010e)
    const out = writeExif(cam.bytes, { description: null })
    const at = ifd0At(out)
    expect(at).toBeGreaterThanOrEqual(cam.bytes.length)
    const after = table(out, at)
    expect(after.entries.map((e) => e.tag)).toEqual(
      before.entries.map((e) => e.tag).filter((tag) => tag !== 0x010e),
    )
    expect(after.next).toBe(before.next)
    // The old table and the removed value are gone from the bytes.
    const old = ifd0At(cam.bytes)
    expect(out.subarray(old, old + before.size).every((b) => b === 0)).toBe(
      true,
    )
    expect(out.subarray(slot, slot + 23).every((b) => b === 0)).toBe(true)
    expect(
      within(changedSpans(cam.bytes, out), [
        [4, 8],
        [old, old + before.size],
        [slot, slot + 23],
      ]),
    ).toBe(true)
    expect(fields(readExif(out))).toEqual(without('description'))
    expectOpaqueDataIntact(cam, out)
  })

  it('removes an Exif tag by relocating the Exif IFD and repointing 0x8769', () => {
    const cam = camera(order)
    const exifAt = pointerOf(cam.bytes, 0x8769) ?? 0
    const exifSize = table(cam.bytes, exifAt).size
    const out = writeExif(cam.bytes, { lens: null })
    expect(ifd0At(out)).toBe(ifd0At(cam.bytes))
    const moved = pointerOf(out, 0x8769) ?? 0
    expect(moved).toBeGreaterThanOrEqual(cam.bytes.length)
    expect(table(out, moved).entries.map((e) => e.tag)).not.toContain(0xa434)
    expect(out.subarray(exifAt, exifAt + exifSize).every((b) => b === 0)).toBe(
      true,
    )
    expect(fields(readExif(out))).toEqual(without('lens'))
    expectOpaqueDataIntact(cam, out)
  })

  it('scrubs GPS completely: pointer gone, every coordinate byte zeroed', () => {
    const cam = camera(order)
    expect(indexOfBytes(cam.bytes, cam.latitude)).toBeGreaterThan(0)
    const gpsAt = pointerOf(cam.bytes, 0x8825) ?? 0
    const gpsSize = table(cam.bytes, gpsAt).size
    const out = writeExif(cam.bytes, { gps: null })
    expect(indexOfBytes(out, cam.latitude)).toBe(-1)
    expect(out.subarray(gpsAt, gpsAt + gpsSize).every((b) => b === 0)).toBe(
      true,
    )
    expect(pointerOf(out, 0x8825)).toBeUndefined()
    expect(readTiffTagBytes(out, 'gps', 0x0002)).toBeNull()
    expect(fields(readExif(out))).toEqual(without('gps', 'gpsAltitude'))
    expectOpaqueDataIntact(cam, out)
  })

  it('writes createdAt with its zone, without one, and as a date alone', () => {
    const cam = camera(order)
    const read = (createdAt: string | null) =>
      fields(readExif(writeExif(cam.bytes, { createdAt })))['createdAt']
    expect(read('2024-06-01T05:30:00Z')).toBe('2024-06-01T05:30:00+00:00')
    // No zone given: the old offset is blanked, not left to lie.
    expect(read('2024-06-01T05:30')).toBe('2024-06-01T05:30:00')
    expect(read('2024-06-01')).toBe('2024-06-01')
    expect(read('2024-06-01T05:30:00.250+05:30')).toBe(
      '2024-06-01T05:30:00+05:30',
    )
    expect(read(null)).toBeUndefined()
    // A value that is not a date is not written.
    expect(writeExif(cam.bytes, { createdAt: 'yesterday' })).toBe(cam.bytes)
    const blank = writeExif(cam.bytes, { createdAt: '2024-06-01' })
    expect(
      Buffer.from(
        readTiffTagBytes(blank, 'exif', 0x9003)?.bytes ?? [],
      ).toString(),
    ).toBe('2024:06:01   :  :  \0')
  })

  it('keeps only the editor’s copyright when the photographer’s is removed', () => {
    const cam = camera(order)
    const out = writeExif(cam.bytes, { copyright: null })
    expect(
      Buffer.from(
        readTiffTagBytes(out, 'ifd0', 0x8298)?.bytes ?? [],
      ).toString(),
    ).toBe(' \0Ed Itor\0')
    expect(fields(readExif(out))['copyright']).toBeUndefined()
  })

  it('refuses to grow the block past maxLength', () => {
    const cam = camera(order)
    const long = 'x'.repeat(200)
    expect(() =>
      writeExif(
        cam.bytes,
        { description: long },
        { maxLength: cam.bytes.length + 100 },
      ),
    ).toThrow(EmbeddedWriteError)
    // In place needs no room at all.
    expect(
      writeExif(
        cam.bytes,
        { description: 'Short' },
        { maxLength: cam.bytes.length },
      ),
    ).toHaveLength(cam.bytes.length)
  })

  it('keeps word alignment when the block ends on an odd byte', () => {
    const t = new TiffBuilder(order)
    const at = t.ifd([
      { tag: 0x010e, type: ASCII, value: t.ascii('Short one') },
    ])
    t.raw([0xaa])
    const bytes = t.build(at)
    expect(bytes.length % 2).toBe(1)
    const out = writeExif(bytes, {
      description: 'A considerably longer description',
    })
    expect(valueAt(out, 'ifd0', 0x010e) % 2).toBe(0)
    expect(out[bytes.length - 1]).toBe(0xaa)
    expect(fields(readExif(out))['description']).toBe(
      'A considerably longer description',
    )
  })

  it('writes a UNICODE UserComment in the byte order it already used', () => {
    const t = new TiffBuilder(order)
    const le = Array.from(Buffer.from('Hello', 'utf16le'))
    const exif = t.ifd([
      { tag: 0x9286, type: UNDEFINED, value: [...utf8('UNICODE\0'), ...le] },
    ])
    const bytes = t.build(
      t.ifd([{ tag: 0x8769, type: LONG, value: t.u32(exif) }]),
    )
    const out = writeExif(bytes, { comment: 'Héllo wörld' })
    const body = readTiffTagBytes(out, 'exif', 0x9286)?.bytes.subarray(8)
    expect(Buffer.from(body ?? []).toString('utf16le')).toBe('Héllo wörld')
    expect(fields(readExif(out))['comment']).toBe('Héllo wörld')
  })
})

describe('writeExif on a JPEG-sized block', () => {
  it('throws rather than overflow a 64 KB APP1', () => {
    const t = new TiffBuilder('II')
    const makerNote = new Array(65400).fill(0x5a)
    const exif = t.ifd([{ tag: 0x927c, type: UNDEFINED, value: makerNote }])
    const bytes = t.build(
      t.ifd([
        { tag: 0x010e, type: ASCII, value: t.ascii('Caption') },
        { tag: 0x8769, type: LONG, value: t.u32(exif) },
      ]),
    )
    expect(bytes.length).toBeLessThan(65527)
    expect(() =>
      writeExif(bytes, { description: 'y'.repeat(500) }, { maxLength: 65527 }),
    ).toThrow(EmbeddedWriteError)
    expect(
      fields(
        readExif(
          writeExif(bytes, { description: 'Short' }, { maxLength: 65527 }),
        ),
      ),
    ).toEqual({ description: 'Short' })
  })
})

describe('writeTiffTags and readTiffTagBytes', () => {
  it('returns raw bytes in the block’s byte order', () => {
    const cam = camera('MM')
    expect(readTiffTagBytes(cam.bytes, 'ifd0', 0x0112)).toEqual({
      type: SHORT,
      count: 1,
      bytes: Uint8Array.from([0, 6]),
    })
    expect(readTiffTagBytes(cam.bytes, 'gps', 0x0001)?.bytes).toEqual(
      Uint8Array.from(utf8('N\0')),
    )
    expect(readTiffTagBytes(cam.bytes, 'ifd0', 0x9999)).toBeNull()
    expect(
      readTiffTagBytes(Uint8Array.from([1, 2, 3]), 'ifd0', 0x0112),
    ).toBeNull()
  })

  it('adds a tag only with allowAdd, relocating IFD0 with entries sorted', () => {
    const cam = camera('II')
    const write: TiffTagWrite = {
      ifd: 'ifd0',
      tag: 0x0100,
      type: LONG,
      value: Uint8Array.from([0x40, 0x01, 0, 0]),
    }
    expect(writeTiffTags(cam.bytes, [write])).toBe(cam.bytes)
    const out = writeTiffTags(cam.bytes, [write], { allowAdd: true })
    const tags = table(out, ifd0At(out)).entries.map((e) => e.tag)
    expect(tags[0]).toBe(0x0100)
    expect(tags).toEqual([...tags].sort((a, b) => a - b))
    expect(readTiffTagBytes(out, 'ifd0', 0x0100)?.bytes).toEqual(
      Uint8Array.from([0x40, 0x01, 0, 0]),
    )
    expect(fields(readExif(out))).toEqual(CAMERA_FIELDS)
    expectOpaqueDataIntact(cam, out)
  })

  it('adds, changes and removes in one pass, relocating each IFD once', () => {
    const cam = camera('MM')
    const out = writeTiffTags(
      cam.bytes,
      [
        {
          ifd: 'ifd0',
          tag: 700,
          type: BYTE,
          value: Uint8Array.from(utf8('<x:xmpmeta/>')),
        },
        {
          ifd: 'ifd0',
          tag: 0x0131,
          type: ASCII,
          value: Uint8Array.from(utf8('Aglyn\0')),
        },
        { ifd: 'exif', tag: 0xa434, type: ASCII, value: null },
        { ifd: 'gps', tag: 0x0006, type: RATIONAL, value: null },
      ],
      { allowAdd: true },
    )
    const tables = [ifd0At(out), pointerOf(out, 0x8769), pointerOf(out, 0x8825)]
    for (const at of tables) expect(at).toBeGreaterThanOrEqual(cam.bytes.length)
    expect(fields(readExif(out))).toEqual({
      ...without('lens', 'gpsAltitude'),
      software: 'Aglyn',
    })
    expect(
      Buffer.from(readTiffTagBytes(out, 'ifd0', 700)?.bytes ?? []).toString(),
    ).toBe('<x:xmpmeta/>')
    expectOpaqueDataIntact(cam, out)
  })

  it('refuses tags that locate other data, and values that do not fit their type', () => {
    const { bytes } = camera('II')
    const refuse = (write: TiffTagWrite) =>
      expect(() => writeTiffTags(bytes, [write], { allowAdd: true })).toThrow(
        EmbeddedWriteError,
      )
    refuse({ ifd: 'ifd0', tag: 0x0111, type: LONG, value: new Uint8Array(4) })
    refuse({ ifd: 'ifd0', tag: 0x8825, type: LONG, value: null })
    refuse({
      ifd: 'exif',
      tag: 0x927c,
      type: UNDEFINED,
      value: new Uint8Array(8),
    })
    refuse({ ifd: 'ifd0', tag: 0x0100, type: LONG, value: new Uint8Array(3) })
    refuse({
      ifd: 'ifd0',
      tag: 0x0100,
      type: LONG,
      count: 2,
      value: new Uint8Array(4),
    })
    refuse({ ifd: 'ifd0', tag: 0x0100, type: 16, value: new Uint8Array(8) })
    refuse({ ifd: 'ifd0', tag: 0x0100, type: BYTE, value: new Uint8Array() })
  })

  it('cannot add to an Exif IFD the block does not have', () => {
    const t = new TiffBuilder('II')
    const bytes = t.build(
      t.ifd([{ tag: 0x010f, type: ASCII, value: t.ascii('Canon') }]),
    )
    const write: TiffTagWrite = {
      ifd: 'exif',
      tag: 0xa434,
      type: ASCII,
      value: Uint8Array.from(utf8('Lens\0')),
    }
    expect(writeTiffTags(bytes, [write])).toBe(bytes)
    expect(() => writeTiffTags(bytes, [write], { allowAdd: true })).toThrow(
      EmbeddedWriteError,
    )
    expect(
      writeTiffTags(bytes, [{ ...write, value: null }], { allowAdd: true }),
    ).toBe(bytes)
  })

  it('appends instead of overwriting a slot another entry shares', () => {
    const t = new TiffBuilder('II')
    const shared = t.data(t.ascii('Shared text'))
    const bytes = t.build(
      t.ifd([
        { tag: 0x010e, type: ASCII, count: 12, value: t.u32(shared) },
        { tag: 0x0131, type: ASCII, count: 12, value: t.u32(shared) },
      ]),
    )
    const out = writeExif(bytes, { description: 'Mine' })
    expect(fields(readExif(out))).toEqual({
      description: 'Mine',
      software: 'Shared text',
    })
    expect(Buffer.from(out.subarray(shared, shared + 12)).toString()).toBe(
      'Shared text\0',
    )
  })
})
