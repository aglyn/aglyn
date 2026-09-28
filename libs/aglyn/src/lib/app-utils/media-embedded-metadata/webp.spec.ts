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
  asciiBytes,
  concatBytes,
  readAscii,
  readU24LE,
  readU32LE,
  utf8Encode,
  writeU32LE,
} from './image-blocks'
import { EmbeddedWriteError } from './types'
import { readWebpBlocks, writeWebpBlocks } from './webp'

// ---------------------------------------------------------------------------
// Fixtures: RIFF containers around bitstream headers. The bitstreams are not
// decodable, but their headers are the real layouts the converter reads.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = asciiBytes

function chunk(fourcc: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(ascii(fourcc), 0)
  writeU32LE(out, 4, data.length)
  out.set(data, 8)
  return out
}

function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(chunks)
  const out = new Uint8Array(12 + body.length)
  out.set(ascii('RIFF'), 0)
  writeU32LE(out, 4, body.length + 4)
  out.set(ascii('WEBP'), 8)
  out.set(body, 12)
  return out
}

/** A lossy key frame header for a 64×48 image, and an odd-length payload. */
const VP8 = chunk(
  'VP8 ',
  concatBytes([
    bytes(0x50, 0x02, 0x00, 0x9d, 0x01, 0x2a, 64, 0, 48, 0),
    new Uint8Array(21).fill(7),
  ]),
)
/** A lossless header for 300×200 with the alpha hint set. */
function vp8l(width: number, height: number, alpha: boolean): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)
  const header = new Uint8Array(5)
  header[0] = 0x2f
  writeU32LE(header, 1, bits >>> 0)
  return chunk('VP8L', concatBytes([header, new Uint8Array(12).fill(3)]))
}

function vp8x(flags: number, width: number, height: number): Uint8Array {
  const data = new Uint8Array(10)
  data[0] = flags
  data[4] = (width - 1) & 0xff
  data[5] = ((width - 1) >> 8) & 0xff
  data[7] = (height - 1) & 0xff
  data[8] = ((height - 1) >> 8) & 0xff
  return chunk('VP8X', data)
}

const TIFF = concatBytes([ascii('II*\0'), bytes(8, 0, 0, 0, 0, 0, 1)])
const XMP = (title: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>${title}</dc:title></x:xmpmeta>`

interface Chunk {
  fourcc: string
  bytes: Uint8Array
}

function chunksOf(file: Uint8Array): Chunk[] {
  const out: Chunk[] = []
  let offset = 12
  while (offset + 8 <= file.length) {
    const size = readU32LE(file, offset + 4)
    const end = offset + 8 + size + (size & 1)
    out.push({
      fourcc: readAscii(file, offset, 4),
      bytes: file.subarray(offset, end),
    })
    offset = end
  }
  return out
}

const fourccs = (file: Uint8Array) => chunksOf(file).map((c) => c.fourcc)
const chunkOf = (file: Uint8Array, fourcc: string) =>
  chunksOf(file).find((c) => c.fourcc === fourcc)?.bytes
const flagsOf = (file: Uint8Array) => chunkOf(file, 'VP8X')?.[8] ?? -1

function expectValidRiff(file: Uint8Array) {
  expect(readAscii(file, 0, 4)).toBe('RIFF')
  expect(readU32LE(file, 4)).toBe(file.length - 8)
  expect(file.length % 2).toBe(0)
  let total = 12
  for (const c of chunksOf(file)) total += c.bytes.length
  expect(total).toBe(file.length)
}

// ---------------------------------------------------------------------------

describe('readWebpBlocks', () => {
  it('returns null for bytes that are not a WebP', () => {
    expect(readWebpBlocks(new Uint8Array(0))).toBeNull()
    expect(readWebpBlocks(ascii('RIFF\0\0\0\0WAVE'))).toBeNull()
    expect(readWebpBlocks(bytes(0xff, 0xd8))).toBeNull()
  })

  it('returns an empty record for a simple file', () => {
    expect(readWebpBlocks(riff(VP8))).toEqual({})
  })

  it('reads EXIF, XMP and ICCP from an extended file', () => {
    const file = riff(
      vp8x(0x2c, 64, 48),
      chunk('ICCP', ascii('profile')),
      VP8,
      chunk('EXIF', TIFF),
      chunk('XMP ', utf8Encode(XMP('Harbor'))),
    )
    const blocks = readWebpBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP('Harbor'))
    expect(blocks?.icc).toEqual(ascii('profile'))
  })

  it('strips an Exif prefix from the EXIF chunk', () => {
    const file = riff(
      vp8x(0x08, 64, 48),
      VP8,
      chunk('EXIF', concatBytes([ascii('Exif\0\0'), TIFF])),
    )
    expect(readWebpBlocks(file)?.exif).toEqual(TIFF)
  })

  it('returns what it found before a truncation, without throwing', () => {
    const file = riff(
      vp8x(0x0c, 64, 48),
      chunk('EXIF', TIFF),
      VP8,
      chunk('XMP ', ascii('<x/>')),
    )
    const cut = file.subarray(0, file.length - 3)
    expect(readWebpBlocks(cut)).toEqual({ exif: TIFF })
  })

  it('never throws on garbage', () => {
    const base = riff(
      vp8x(0x2c, 64, 48),
      chunk('ICCP', ascii('p')),
      VP8,
      chunk('EXIF', TIFF),
      chunk('XMP ', ascii('<x/>')),
    )
    let seed = 3
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round += 1) {
      const mutated = base.slice(0, 12 + (random() % (base.length - 11)))
      for (let flips = random() % 6; flips > 0; flips -= 1) {
        mutated[4 + (random() % Math.max(1, mutated.length - 4))] =
          random() & 0xff
      }
      expect(() => readWebpBlocks(mutated)).not.toThrow()
      try {
        const out = writeWebpBlocks(mutated, { xmp: XMP('New'), exif: TIFF })
        expect(readU32LE(out, 4)).toBe(out.length - 8)
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddedWriteError)
      }
    }
  })
})

describe('writeWebpBlocks', () => {
  it('converts a simple lossy file to extended when metadata is added', () => {
    const file = riff(VP8)
    const out = writeWebpBlocks(file, { exif: TIFF, xmp: XMP('Converted') })
    expect(fourccs(out)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP '])
    expectValidRiff(out)
    const header = chunkOf(out, 'VP8X') ?? new Uint8Array(0)
    expect(header[8]).toBe(0x08 | 0x04)
    expect(readU24LE(header, 12) + 1).toBe(64)
    expect(readU24LE(header, 15) + 1).toBe(48)
    expect(chunkOf(out, 'VP8 ')).toEqual(VP8)
    const blocks = readWebpBlocks(out)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP('Converted'))
  })

  it('carries the lossless alpha hint into the new VP8X', () => {
    const image = vp8l(300, 200, true)
    const out = writeWebpBlocks(riff(image), { xmp: XMP('Alpha') })
    const header = chunkOf(out, 'VP8X') ?? new Uint8Array(0)
    expect(header[8]).toBe(0x10 | 0x04)
    expect(readU24LE(header, 12) + 1).toBe(300)
    expect(readU24LE(header, 15) + 1).toBe(200)
    expect(chunkOf(out, 'VP8L')).toEqual(image)
    const opaque = writeWebpBlocks(riff(vp8l(10, 10, false)), { exif: TIFF })
    expect(flagsOf(opaque)).toBe(0x08)
  })

  it('leaves a simple file simple when nothing is added', () => {
    const file = riff(VP8)
    expect(writeWebpBlocks(file, { exif: null, xmp: null })).toEqual(file)
    expect(writeWebpBlocks(file, {})).toEqual(file)
  })

  it('replaces EXIF and XMP in place, keeping order and other flags', () => {
    const file = riff(
      vp8x(0x20 | 0x10 | 0x08 | 0x04, 64, 48),
      chunk('ICCP', ascii('profile')),
      chunk('ALPH', bytes(1, 2, 3)),
      VP8,
      chunk('EXIF', TIFF),
      chunk('XMP ', utf8Encode(XMP('Old'))),
      chunk('ZZZZ', ascii('unknown')),
    )
    const tiff = concatBytes([ascii('MM\0*'), bytes(0, 0, 0, 8, 0)])
    const out = writeWebpBlocks(file, {
      exif: tiff,
      xmp: XMP('A longer replacement value'),
    })
    expect(fourccs(out)).toEqual(fourccs(file))
    expect(flagsOf(out)).toBe(0x3c)
    expectValidRiff(out)
    for (const fourcc of ['ICCP', 'ALPH', 'VP8 ', 'ZZZZ']) {
      expect(chunkOf(out, fourcc)).toEqual(chunkOf(file, fourcc))
    }
    const blocks = readWebpBlocks(out)
    expect(blocks?.exif).toEqual(tiff)
    expect(blocks?.xmp).toBe(XMP('A longer replacement value'))
    expect(blocks?.icc).toEqual(ascii('profile'))
  })

  it('removes EXIF and XMP and clears their flags', () => {
    const file = riff(
      vp8x(0x20 | 0x08 | 0x04, 64, 48),
      chunk('ICCP', ascii('profile')),
      VP8,
      chunk('EXIF', TIFF),
      chunk('XMP ', utf8Encode(XMP('Gone'))),
    )
    const noExif = writeWebpBlocks(file, { exif: null })
    expect(fourccs(noExif)).toEqual(['VP8X', 'ICCP', 'VP8 ', 'XMP '])
    expect(flagsOf(noExif)).toBe(0x20 | 0x04)
    expect(readWebpBlocks(noExif)?.xmp).toBe(XMP('Gone'))
    const neither = writeWebpBlocks(file, { exif: null, xmp: null })
    expect(fourccs(neither)).toEqual(['VP8X', 'ICCP', 'VP8 '])
    expect(flagsOf(neither)).toBe(0x20)
    expectValidRiff(neither)
  })

  it('inserts EXIF before an existing XMP, and XMP after EXIF', () => {
    const withXmp = riff(
      vp8x(0x04, 64, 48),
      VP8,
      chunk('XMP ', ascii('<x/>')),
      chunk('ZZZZ', ascii('u')),
    )
    expect(fourccs(writeWebpBlocks(withXmp, { exif: TIFF }))).toEqual([
      'VP8X',
      'VP8 ',
      'EXIF',
      'XMP ',
      'ZZZZ',
    ])
    const withExif = riff(
      vp8x(0x08, 64, 48),
      VP8,
      chunk('EXIF', TIFF),
      chunk('ZZZZ', ascii('u')),
    )
    const out = writeWebpBlocks(withExif, { xmp: XMP('After') })
    expect(fourccs(out)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP ', 'ZZZZ'])
    expect(flagsOf(out)).toBe(0x0c)
  })

  it('inserts after the last animation frame', () => {
    const frame = chunk('ANMF', new Uint8Array(17).fill(5))
    const file = riff(
      vp8x(0x02, 64, 48),
      chunk('ANIM', new Uint8Array(6)),
      frame,
      frame,
      chunk('ZZZZ', ascii('u')),
    )
    const out = writeWebpBlocks(file, { xmp: XMP('Animated') })
    expect(fourccs(out)).toEqual([
      'VP8X',
      'ANIM',
      'ANMF',
      'ANMF',
      'XMP ',
      'ZZZZ',
    ])
    expect(flagsOf(out)).toBe(0x06)
    expectValidRiff(out)
  })

  it('pads odd-length metadata and strips an Exif prefix on write', () => {
    const out = writeWebpBlocks(riff(VP8), {
      exif: concatBytes([ascii('Exif\0\0'), TIFF]),
      xmp: '<x/>!',
    })
    expectValidRiff(out)
    expect(chunkOf(out, 'EXIF')?.length).toBe(8 + TIFF.length + 1)
    expect(readWebpBlocks(out)?.exif).toEqual(TIFF)
    expect(readWebpBlocks(out)?.xmp).toBe('<x/>!')
  })

  it('removes duplicate EXIF chunks when it replaces the first', () => {
    const file = riff(
      vp8x(0x08, 64, 48),
      VP8,
      chunk('EXIF', TIFF),
      chunk('EXIF', TIFF),
    )
    const out = writeWebpBlocks(file, { exif: TIFF })
    expect(fourccs(out)).toEqual(['VP8X', 'VP8 ', 'EXIF'])
  })

  it('copies bytes after the RIFF payload through', () => {
    const file = concatBytes([riff(VP8), ascii('tail')])
    const out = writeWebpBlocks(file, { xmp: XMP('t') })
    expect(out.subarray(out.length - 4)).toEqual(ascii('tail'))
  })

  it('refuses what a WebP cannot hold, and ignores removing it', () => {
    expect(() => writeWebpBlocks(riff(VP8), { irb: bytes(1) })).toThrow(
      EmbeddedWriteError,
    )
    expect(() =>
      writeWebpBlocks(riff(VP8), { pngText: { Title: 'x' } }),
    ).toThrow(EmbeddedWriteError)
    expect(
      writeWebpBlocks(riff(VP8), { irb: null, pngText: { Title: null } }),
    ).toEqual(riff(VP8))
  })

  it('refuses damaged files and unreadable bitstream headers', () => {
    expect(() => writeWebpBlocks(ascii('GIF89a'), { xmp: 'x' })).toThrow(
      EmbeddedWriteError,
    )
    const file = riff(VP8, chunk('ZZZZ', ascii('abcd')))
    expect(() =>
      writeWebpBlocks(file.subarray(0, file.length - 2), { xmp: 'x' }),
    ).toThrow(/structure is damaged/)
    const notKeyFrame = riff(
      chunk('VP8 ', bytes(0x01, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0)),
    )
    expect(() => writeWebpBlocks(notKeyFrame, { xmp: 'x' })).toThrow(
      EmbeddedWriteError,
    )
    const alphFirst = riff(chunk('ALPH', bytes(1)), VP8)
    expect(() => writeWebpBlocks(alphFirst, { xmp: 'x' })).toThrow(
      EmbeddedWriteError,
    )
  })
})
