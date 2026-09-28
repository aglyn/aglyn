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

import { deflateSync } from 'zlib'
import { readHeifBlocks } from './heif'
import { asciiBytes, concatBytes, utf8Encode, writeU32BE } from './image-blocks'

// ---------------------------------------------------------------------------
// Fixtures: an ISO BMFF item catalogue built box by box, with an `mdat`
// whose item offsets are patched in once the layout is known.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = asciiBytes
const u16 = (v: number) => bytes((v >> 8) & 0xff, v & 0xff)
const u32 = (v: number) => {
  const out = new Uint8Array(4)
  writeU32BE(out, 0, v)
  return out
}
const u64 = (v: number) =>
  concatBytes([u32(Math.floor(v / 0x100000000)), u32(v >>> 0)])

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concatBytes(payload)
  return concatBytes([u32(8 + body.length), ascii(type), body])
}
const fullBox = (type: string, version: number, ...payload: Uint8Array[]) =>
  box(type, bytes(version, 0, 0, 0), ...payload)

const TIFF = concatBytes([ascii('MM\0*'), u32(8), u16(0), u32(0)])
const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>Ridge</dc:title></x:xmpmeta>'
const ICC = concatBytes([u32(200), ascii('lcms'), new Uint8Array(40).fill(1)])

interface Item {
  id: number
  type: string
  contentType?: string
  contentEncoding?: string
  /** The item's bytes, split into this many extents. */
  data: Uint8Array
  extents?: number
  constructionMethod?: number
  /** The item this one describes (`cdsc`). */
  describes?: number
}

interface Options {
  brands?: string[]
  ilocVersion?: 0 | 1 | 2
  infeVersion?: 2 | 3
  offsetSize?: 4 | 8
  baseOffset?: boolean
  colr?: 'prof' | 'rICC' | 'nclx'
  /** Write the `mdat` header with a 64-bit size (size field 1). */
  largeMdat?: boolean
  items: Item[]
}

const exifItem = (tiff: Uint8Array, offset = 6, prefix = ascii('Exif\0\0')) =>
  concatBytes([u32(offset), prefix, tiff])

/**
 * Builds a HEIF file: `ftyp`, `meta` (hdlr, pitm, iinf, iref, iprp, iloc)
 * and an `mdat` holding every item's bytes. The `iloc` offsets are real.
 */
function heif(options: Options): Uint8Array {
  const {
    brands = ['heic', 'mif1'],
    ilocVersion = 1,
    infeVersion = 2,
    offsetSize = 4,
    baseOffset = false,
    colr = 'prof',
    largeMdat = false,
    items,
  } = options
  const ftyp = box(
    'ftyp',
    ascii(brands[0] ?? 'heic'),
    u32(0),
    ...brands.map((b) => ascii(b)),
  )
  const id = (v: number) => (infeVersion === 3 ? u32(v) : u16(v))
  const infes = items.map((item) =>
    fullBox(
      'infe',
      infeVersion,
      id(item.id),
      u16(0),
      ascii(item.type),
      ascii('\0'),
      item.contentType !== undefined ? ascii(`${item.contentType}\0`) : bytes(),
      item.contentEncoding !== undefined
        ? ascii(`${item.contentEncoding}\0`)
        : bytes(),
    ),
  )
  const iinf = fullBox('iinf', 0, u16(items.length), ...infes)
  const references = items
    .filter((item) => item.describes !== undefined)
    .map((item) => box('cdsc', u16(item.id), u16(1), u16(item.describes ?? 0)))
  const iref = fullBox('iref', 0, ...references)
  const colrBox =
    colr === 'nclx'
      ? box('colr', ascii('nclx'), u16(1), u16(13), u16(6), bytes(0x80))
      : box('colr', ascii(colr), ICC)
  const iprp = box(
    'iprp',
    box('ipco', box('ispe', u32(0), u32(64), u32(48)), colrBox),
  )
  const hdlr = fullBox(
    'hdlr',
    0,
    u32(0),
    ascii('pict'),
    new Uint8Array(12),
    bytes(0),
  )
  const pitm = fullBox('pitm', 0, u16(1))

  const mdatBody = concatBytes(items.map((item) => item.data))
  const ilocFor = (mdatPayload: number) => {
    const sizes = bytes((offsetSize << 4) | 4, baseOffset ? 4 << 4 : 0)
    const entries: Uint8Array[] = []
    let cursor = mdatPayload
    for (const item of items) {
      const count = item.extents ?? 1
      const piece = Math.ceil(item.data.length / count)
      const extents: Uint8Array[] = []
      for (let e = 0; e < count; e += 1) {
        const start = cursor + e * piece
        const length = Math.min(piece, item.data.length - e * piece)
        const offset = baseOffset ? start - cursor : start
        extents.push(offsetSize === 8 ? u64(offset) : u32(offset), u32(length))
      }
      entries.push(
        ilocVersion === 2 ? u32(item.id) : u16(item.id),
        ilocVersion === 0 ? bytes() : u16(item.constructionMethod ?? 0),
        u16(0),
        baseOffset ? u32(cursor) : bytes(),
        u16(count),
        ...extents,
      )
      cursor += item.data.length
    }
    return fullBox(
      'iloc',
      ilocVersion,
      sizes,
      ilocVersion === 2 ? u32(items.length) : u16(items.length),
      ...entries,
    )
  }
  // Measure with a placeholder, then build for real: the iloc is the same
  // size either way.
  const metaFor = (mdatPayload: number) =>
    fullBox('meta', 0, hdlr, pitm, iinf, iref, iprp, ilocFor(mdatPayload))
  const draft = metaFor(0)
  const mdatPayload = ftyp.length + draft.length + (largeMdat ? 16 : 8)
  const mdat = largeMdat
    ? concatBytes([u32(1), ascii('mdat'), u64(16 + mdatBody.length), mdatBody])
    : box('mdat', mdatBody)
  return concatBytes([ftyp, metaFor(mdatPayload), mdat])
}

const IMAGE: Item = { id: 1, type: 'hvc1', data: new Uint8Array(32).fill(0xaa) }

// ---------------------------------------------------------------------------

describe('readHeifBlocks', () => {
  it('returns null for bytes that are not in the HEIF family', () => {
    expect(readHeifBlocks(new Uint8Array(0))).toBeNull()
    expect(readHeifBlocks(bytes(0xff, 0xd8, 0xff))).toBeNull()
    expect(
      readHeifBlocks(heif({ brands: ['isom', 'mp42'], items: [IMAGE] })),
    ).toBeNull()
    expect(readHeifBlocks(box('moov', bytes(1, 2)))).toBeNull()
  })

  it('reads EXIF, XMP and the ICC profile of a HEIC', () => {
    const file = heif({
      items: [
        IMAGE,
        { id: 2, type: 'Exif', data: exifItem(TIFF), describes: 1 },
        {
          id: 3,
          type: 'mime',
          contentType: 'application/rdf+xml',
          data: utf8Encode(XMP),
          describes: 1,
        },
      ],
    })
    const blocks = readHeifBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP)
    expect(blocks?.icc).toEqual(ICC)
  })

  it('reads an AVIF, a restricted ICC, and a file with no metadata items', () => {
    const avif = heif({
      brands: ['avif', 'mif1', 'miaf'],
      colr: 'rICC',
      items: [
        { ...IMAGE, type: 'av01' },
        { id: 2, type: 'Exif', data: exifItem(TIFF) },
      ],
    })
    expect(readHeifBlocks(avif)).toEqual({ exif: TIFF, icc: ICC })
    expect(readHeifBlocks(heif({ colr: 'nclx', items: [IMAGE] }))).toEqual({})
  })

  it.each([
    [{ ilocVersion: 0 as const }],
    [{ ilocVersion: 2 as const, infeVersion: 3 as const }],
    [{ offsetSize: 8 as const }],
    [{ baseOffset: true }],
  ])('follows iloc layout %j', (layout) => {
    const file = heif({
      ...layout,
      items: [
        IMAGE,
        { id: 2, type: 'Exif', data: exifItem(TIFF), describes: 1, extents: 3 },
        {
          id: 3,
          type: 'mime',
          contentType: 'application/rdf+xml',
          data: utf8Encode(XMP),
          extents: 2,
        },
      ],
    })
    const blocks = readHeifBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP)
  })

  it('honors the TIFF header offset, and finds a header a writer misplaced', () => {
    const bare = heif({
      items: [IMAGE, { id: 2, type: 'Exif', data: exifItem(TIFF, 0, bytes()) }],
    })
    expect(readHeifBlocks(bare)?.exif).toEqual(TIFF)
    const wrong = heif({
      items: [IMAGE, { id: 2, type: 'Exif', data: exifItem(TIFF, 0) }],
    })
    expect(readHeifBlocks(wrong)?.exif).toEqual(TIFF)
    const junk = heif({
      items: [
        IMAGE,
        {
          id: 2,
          type: 'Exif',
          data: exifItem(ascii('not a tiff at all'), 0, bytes()),
        },
      ],
    })
    expect(readHeifBlocks(junk)?.exif).toBeUndefined()
  })

  it("prefers the primary image's EXIF over a thumbnail's", () => {
    const thumbTiff = concatBytes([ascii('II*\0'), bytes(8, 0, 0, 0, 0, 0)])
    const file = heif({
      items: [
        IMAGE,
        { id: 4, type: 'hvc1', data: new Uint8Array(8) },
        { id: 5, type: 'Exif', data: exifItem(thumbTiff), describes: 4 },
        { id: 2, type: 'Exif', data: exifItem(TIFF), describes: 1 },
      ],
    })
    expect(readHeifBlocks(file)?.exif).toEqual(TIFF)
  })

  it('decodes a deflate-encoded XMP item and skips unknown encodings', () => {
    const deflated = heif({
      items: [
        IMAGE,
        {
          id: 3,
          type: 'mime',
          contentType: 'application/rdf+xml',
          contentEncoding: 'deflate',
          data: new Uint8Array(deflateSync(utf8Encode(XMP))),
        },
      ],
    })
    expect(readHeifBlocks(deflated)?.xmp).toBe(XMP)
    const brotli = heif({
      items: [
        IMAGE,
        {
          id: 3,
          type: 'mime',
          contentType: 'application/rdf+xml',
          contentEncoding: 'br',
          data: bytes(1, 2, 3),
        },
      ],
    })
    expect(readHeifBlocks(brotli)?.xmp).toBeUndefined()
  })

  it('ignores items stored anywhere but this file', () => {
    const file = heif({
      items: [
        IMAGE,
        { id: 2, type: 'Exif', data: exifItem(TIFF), constructionMethod: 1 },
      ],
    })
    expect(readHeifBlocks(file)?.exif).toBeUndefined()
  })

  it('reads a box with a 64-bit size', () => {
    const file = heif({
      largeMdat: true,
      items: [IMAGE, { id: 2, type: 'Exif', data: exifItem(TIFF) }],
    })
    expect(readHeifBlocks(file)).toEqual({ exif: TIFF, icc: ICC })
  })

  it('does not take bytes that merely resemble EXIF', () => {
    // Offsets that miss the item by a few bytes must not yield a TIFF found
    // further in.
    const shifted = exifItem(concatBytes([ascii('pad!'), TIFF]), 0, bytes())
    expect(
      readHeifBlocks(
        heif({ items: [IMAGE, { id: 2, type: 'Exif', data: shifted }] }),
      )?.exif,
    ).toBeUndefined()
  })

  it('returns what it could read from a truncated or hostile file', () => {
    const file = heif({
      items: [
        IMAGE,
        { id: 2, type: 'Exif', data: exifItem(TIFF), describes: 1 },
      ],
    })
    // Cutting the mdat leaves the extents pointing past the end.
    const cut = file.subarray(0, file.length - 4)
    expect(readHeifBlocks(cut)).toEqual({ icc: ICC })
    let seed = 13
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 800; round += 1) {
      const mutated = file.slice(0, 12 + (random() % (file.length - 11)))
      for (let flips = random() % 6; flips > 0; flips -= 1) {
        mutated[8 + (random() % Math.max(1, mutated.length - 8))] =
          random() & 0xff
      }
      expect(() => readHeifBlocks(mutated)).not.toThrow()
    }
  })
})
