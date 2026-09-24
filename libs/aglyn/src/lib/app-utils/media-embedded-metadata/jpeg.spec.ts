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
  indexOfBytes,
  readU16BE,
  readU32BE,
} from './image-blocks'
import { readJpegBlocks, writeJpegBlocks } from './jpeg'
import { EmbeddedWriteError } from './types'

// ---------------------------------------------------------------------------
// Fixtures, built from bytes. None of them decodes to pixels; the walk only
// needs a well-formed marker structure, and the lossless assertions need a
// scan whose bytes are distinctive (stuffed zeros, restart markers, and a
// trailer after EOI).
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = asciiBytes

function segment(code: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concatBytes(payload)
  const length = body.length + 2
  return concatBytes([bytes(0xff, code, length >> 8, length & 0xff), body])
}

const SOI = bytes(0xff, 0xd8)
const JFIF = segment(0xe0, ascii('JFIF\0'), bytes(1, 1, 0, 0, 1, 0, 1, 0, 0))
const DQT = segment(0xdb, bytes(0), new Uint8Array(64).fill(1))
const SOF0 = segment(0xc0, bytes(8, 0, 16, 0, 16, 1, 1, 0x11, 0))
const DHT = segment(0xc4, bytes(0), new Uint8Array(16), bytes())
/** SOS + entropy-coded data with a stuffed 0xFF00 and an RST0 + EOI. */
const SCAN = concatBytes([
  segment(0xda, bytes(1, 1, 0, 0, 0x3f, 0)),
  bytes(0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78, 0xff, 0xd9),
])

const TIFF = concatBytes([ascii('MM\0*'), bytes(0, 0, 0, 8, 0, 0)])
const exifSegment = (tiff: Uint8Array = TIFF) =>
  segment(0xe1, ascii('Exif\0\0'), tiff)
const xmpPacket = (title: string) =>
  `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>${title}</dc:title></x:xmpmeta><?xpacket end="w"?>`
const xmpSegment = (text: string) =>
  segment(
    0xe1,
    ascii('http://ns.adobe.com/xap/1.0/\0'),
    new TextEncoder().encode(text),
  )
const xmpExtensionSegment = () =>
  segment(
    0xe1,
    ascii('http://ns.adobe.com/xmp/extension/\0'),
    ascii('0123456789ABCDEF0123456789ABCDEF'),
    bytes(0, 0, 0, 4, 0, 0, 0, 0),
    ascii('<x/>'),
  )
const irbSegment = (payload: Uint8Array) =>
  segment(0xed, ascii('Photoshop 3.0\0'), payload)
const iccSegment = (seq: number, count: number, data: Uint8Array) =>
  segment(0xe2, ascii('ICC_PROFILE\0'), bytes(seq, count), data)
const comSegment = (payload: Uint8Array) => segment(0xfe, payload)

/** A minimal Photoshop IRB: one 8BIM 0x0404 (IPTC) resource. */
function irb(payload: Uint8Array): Uint8Array {
  const pad = payload.length % 2 ? bytes(0) : bytes()
  return concatBytes([
    ascii('8BIM'),
    bytes(0x04, 0x04, 0, 0),
    bytes(
      (payload.length >>> 24) & 0xff,
      (payload.length >>> 16) & 0xff,
      (payload.length >>> 8) & 0xff,
      payload.length & 0xff,
    ),
    payload,
    pad,
  ])
}

function jpeg(...header: Uint8Array[]): Uint8Array {
  return concatBytes([SOI, ...header, DQT, SOF0, DHT, SCAN])
}

/** Offsets of each top-level marker in the header, as `[code, offset]`. */
function markers(file: Uint8Array): [number, number][] {
  const out: [number, number][] = []
  let offset = 2
  while (offset + 4 <= file.length) {
    while (file[offset] === 0xff && file[offset + 1] === 0xff) offset += 1
    const code = file[offset + 1] ?? 0
    out.push([code, offset])
    if (code === 0xda) break
    offset += 2 + readU16BE(file, offset + 2)
  }
  return out
}

/** Everything from the SOS marker to the end of the file. */
function scanOf(file: Uint8Array): Uint8Array {
  const sos = markers(file).find(([code]) => code === 0xda)
  if (!sos) throw new Error('no SOS')
  return file.subarray(sos[1])
}

const codes = (file: Uint8Array) =>
  markers(file).map(([code]) => code.toString(16))

// ---------------------------------------------------------------------------

describe('readJpegBlocks', () => {
  it('returns null for bytes that are not a JPEG', () => {
    expect(readJpegBlocks(new Uint8Array(0))).toBeNull()
    expect(readJpegBlocks(bytes(0xff))).toBeNull()
    expect(readJpegBlocks(ascii('\x89PNG\r\n\x1a\n'))).toBeNull()
  })

  it('returns an empty record for a JPEG with no metadata', () => {
    expect(readJpegBlocks(jpeg(JFIF))).toEqual({})
  })

  it('reads EXIF, XMP, IRB, ICC and comments', () => {
    const file = jpeg(
      JFIF,
      exifSegment(),
      xmpSegment(xmpPacket('Harbor')),
      xmpExtensionSegment(),
      irbSegment(irb(ascii('abc'))),
      iccSegment(2, 2, ascii('world')),
      iccSegment(1, 2, ascii('hello ')),
      comSegment(new TextEncoder().encode('caf\u00e9 \u2615')),
      comSegment(bytes(0x63, 0x61, 0x66, 0xe9)),
    )
    const blocks = readJpegBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(xmpPacket('Harbor'))
    expect(blocks?.irb).toEqual(irb(ascii('abc')))
    expect(new TextDecoder().decode(blocks?.icc)).toBe('hello world')
    expect(blocks?.comments).toEqual(['caf\u00e9 \u2615', 'caf\u00e9'])
  })

  it('concatenates consecutive Photoshop APP13 segments in order', () => {
    const whole = irb(new Uint8Array(300).map((_, i) => i & 0xff))
    const file = jpeg(
      irbSegment(whole.subarray(0, 100)),
      irbSegment(whole.subarray(100)),
    )
    expect(readJpegBlocks(file)?.irb).toEqual(whole)
  })

  it('takes the first EXIF and first main XMP when a file repeats them', () => {
    const other = concatBytes([ascii('II*\0'), bytes(8, 0, 0, 0)])
    const file = jpeg(
      exifSegment(),
      exifSegment(other),
      xmpSegment(xmpPacket('One')),
      xmpSegment(xmpPacket('Two')),
    )
    const blocks = readJpegBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(xmpPacket('One'))
  })

  it('drops an ICC profile whose chunks are incomplete', () => {
    const file = jpeg(
      iccSegment(1, 3, ascii('a')),
      iccSegment(3, 3, ascii('c')),
    )
    expect(readJpegBlocks(file)?.icc).toBeUndefined()
    const lone = jpeg(iccSegment(1, 1, ascii('whole')))
    expect(new TextDecoder().decode(readJpegBlocks(lone)?.icc)).toBe('whole')
  })

  it('walks fill bytes, standalone markers and stray bytes like libjpeg', () => {
    const file = concatBytes([
      SOI,
      bytes(0xff, 0xff, 0xff),
      exifSegment(),
      bytes(0xff, 0x01), // TEM
      bytes(0xff, 0xd3), // RST3, out of place but lengthless
      bytes(0x00, 0x00, 0x42), // stray bytes a lenient decoder skips
      xmpSegment(xmpPacket('Fill')),
      DQT,
      SOF0,
      SCAN,
    ])
    const blocks = readJpegBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(xmpPacket('Fill'))
  })

  it('returns what it found before a truncation, without throwing', () => {
    const file = jpeg(exifSegment(), xmpSegment(xmpPacket('Cut')))
    const xmpAt = markers(file)[1]?.[1] ?? 0
    const cut = file.subarray(0, xmpAt + 20)
    expect(readJpegBlocks(cut)).toEqual({ exif: TIFF })
    // A length that points past the end.
    const lying = concatBytes([
      SOI,
      exifSegment(),
      bytes(0xff, 0xe1, 0xff, 0xff, 1, 2),
    ])
    expect(readJpegBlocks(lying)).toEqual({ exif: TIFF })
    // A length below its own two bytes.
    expect(readJpegBlocks(concatBytes([SOI, bytes(0xff, 0xe1, 0, 1)]))).toEqual(
      {},
    )
  })

  it('never throws on garbage', () => {
    const base = jpeg(
      JFIF,
      exifSegment(),
      xmpSegment(xmpPacket('Fuzz')),
      irbSegment(irb(ascii('x'))),
    )
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round += 1) {
      const mutated = base.slice(0, 2 + (random() % (base.length - 1)))
      for (let flips = random() % 8; flips > 0; flips -= 1) {
        mutated[2 + (random() % Math.max(1, mutated.length - 2))] =
          random() & 0xff
      }
      expect(() => readJpegBlocks(mutated)).not.toThrow()
      try {
        writeJpegBlocks(mutated, { xmp: xmpPacket('New'), exif: TIFF })
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddedWriteError)
      }
    }
  })
})

describe('writeJpegBlocks', () => {
  it('inserts EXIF after APP0 JFIF, XMP after EXIF and APP13 after XMP', () => {
    const file = jpeg(JFIF, iccSegment(1, 1, ascii('icc')))
    const out = writeJpegBlocks(file, {
      exif: TIFF,
      xmp: xmpPacket('New'),
      irb: irb(ascii('iptc')),
    })
    expect(codes(out)).toEqual([
      'e0',
      'e1',
      'e1',
      'ed',
      'e2',
      'db',
      'c0',
      'c4',
      'da',
    ])
    const blocks = readJpegBlocks(out)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(xmpPacket('New'))
    expect(blocks?.irb).toEqual(irb(ascii('iptc')))
    expect(new TextDecoder().decode(blocks?.icc)).toBe('icc')
    expect(scanOf(out)).toEqual(scanOf(file))
  })

  it('inserts right after SOI when there is no APP0', () => {
    const out = writeJpegBlocks(jpeg(), { xmp: xmpPacket('Bare') })
    expect(codes(out)).toEqual(['e1', 'db', 'c0', 'c4', 'da'])
    expect(readJpegBlocks(out)?.xmp).toBe(xmpPacket('Bare'))
  })

  it('replaces blocks in place and keeps every other segment byte-identical', () => {
    const file = jpeg(
      JFIF,
      exifSegment(),
      iccSegment(1, 1, ascii('profile')),
      xmpSegment(xmpPacket('Old')),
      xmpExtensionSegment(),
      irbSegment(irb(ascii('old'))),
      comSegment(ascii('keep me')),
    )
    const tiff = concatBytes([ascii('II*\0'), bytes(8, 0, 0, 0, 0, 0)])
    const out = writeJpegBlocks(file, {
      exif: tiff,
      xmp: xmpPacket('A much longer replacement title than before'),
      irb: irb(ascii('new')),
    })
    expect(codes(out)).toEqual(codes(file))
    const blocks = readJpegBlocks(out)
    expect(blocks?.exif).toEqual(tiff)
    expect(blocks?.xmp).toBe(
      xmpPacket('A much longer replacement title than before'),
    )
    expect(blocks?.irb).toEqual(irb(ascii('new')))
    expect(blocks?.comments).toEqual(['keep me'])
    expect(new TextDecoder().decode(blocks?.icc)).toBe('profile')
    expect(indexOfBytes(out, xmpExtensionSegment())).toBeGreaterThan(0)
    expect(indexOfBytes(out, comSegment(ascii('keep me')))).toBeGreaterThan(0)
    expect(
      indexOfBytes(out, iccSegment(1, 1, ascii('profile'))),
    ).toBeGreaterThan(0)
    expect(scanOf(out)).toEqual(scanOf(file))
  })

  it('leaves untouched blocks alone when only one is updated', () => {
    const file = jpeg(
      JFIF,
      exifSegment(),
      xmpSegment(xmpPacket('Keep')),
      irbSegment(irb(ascii('k'))),
    )
    const out = writeJpegBlocks(file, { xmp: xmpPacket('Changed') })
    const blocks = readJpegBlocks(out)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.irb).toEqual(irb(ascii('k')))
    expect(blocks?.xmp).toBe(xmpPacket('Changed'))
    expect(writeJpegBlocks(file, {})).toEqual(file)
  })

  it('removes a block, every copy of it, on null', () => {
    const file = jpeg(
      JFIF,
      exifSegment(),
      exifSegment(),
      xmpSegment(xmpPacket('Gone')),
      xmpExtensionSegment(),
      irbSegment(irb(ascii('a'))),
      irbSegment(irb(ascii('b'))),
    )
    const out = writeJpegBlocks(file, { exif: null, xmp: null, irb: null })
    const blocks = readJpegBlocks(out)
    expect(blocks?.exif).toBeUndefined()
    expect(blocks?.xmp).toBeUndefined()
    expect(blocks?.irb).toBeUndefined()
    // Extended XMP is never rewritten.
    expect(indexOfBytes(out, xmpExtensionSegment())).toBeGreaterThan(0)
    expect(codes(out)).toEqual(['e0', 'e1', 'db', 'c0', 'c4', 'da'])
    expect(scanOf(out)).toEqual(scanOf(file))
  })

  it('drops later duplicates when it replaces the first copy', () => {
    const file = jpeg(
      exifSegment(),
      exifSegment(),
      xmpSegment(xmpPacket('1')),
      xmpSegment(xmpPacket('2')),
    )
    const out = writeJpegBlocks(file, { exif: TIFF, xmp: xmpPacket('3') })
    expect(codes(out)).toEqual(['e1', 'e1', 'db', 'c0', 'c4', 'da'])
    expect(readJpegBlocks(out)?.xmp).toBe(xmpPacket('3'))
  })

  it('strips an Exif prefix a caller left on', () => {
    const out = writeJpegBlocks(jpeg(), {
      exif: concatBytes([ascii('Exif\0\0'), TIFF]),
    })
    expect(readJpegBlocks(out)?.exif).toEqual(TIFF)
  })

  it('splits a large IRB across consecutive APP13 segments', () => {
    const big = irb(new Uint8Array(150_000).map((_, i) => (i * 7) & 0xff))
    const out = writeJpegBlocks(jpeg(JFIF), { irb: big })
    expect(codes(out)).toEqual(['e0', 'ed', 'ed', 'ed', 'db', 'c0', 'c4', 'da'])
    for (const [code, offset] of markers(out)) {
      if (code === 0xed) {
        expect(readU16BE(out, offset + 2)).toBeLessThanOrEqual(0xffff)
      }
    }
    expect(readJpegBlocks(out)?.irb).toEqual(big)
    // And a replacement collapses the three back into one.
    const again = writeJpegBlocks(out, { irb: irb(ascii('small')) })
    expect(codes(again)).toEqual(['e0', 'ed', 'db', 'c0', 'c4', 'da'])
  })

  it('enforces the segment limits', () => {
    const header = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'
    const exactly = (size: number) => header + ' '.repeat(size - header.length)
    expect(() => writeJpegBlocks(jpeg(), { xmp: exactly(65502) })).not.toThrow()
    expect(() => writeJpegBlocks(jpeg(), { xmp: exactly(65503) })).toThrow(
      "This file's embedded metadata is too large to edit here.",
    )
    expect(() =>
      writeJpegBlocks(jpeg(), { exif: new Uint8Array(65527) }),
    ).not.toThrow()
    expect(() =>
      writeJpegBlocks(jpeg(), { exif: new Uint8Array(65528) }),
    ).toThrow(EmbeddedWriteError)
  })

  it('keeps fill bytes and stray bytes that preceded a replaced segment', () => {
    const file = concatBytes([
      SOI,
      bytes(0xff, 0xff),
      xmpSegment(xmpPacket('Old')),
      bytes(0x00, 0x00),
      DQT,
      SOF0,
      SCAN,
    ])
    const out = writeJpegBlocks(file, { xmp: xmpPacket('New') })
    expect(Array.from(out.subarray(0, 6))).toEqual([
      0xff, 0xd8, 0xff, 0xff, 0xff, 0xe1,
    ])
    expect(readJpegBlocks(out)?.xmp).toBe(xmpPacket('New'))
    expect(indexOfBytes(out, concatBytes([bytes(0, 0), DQT]))).toBeGreaterThan(
      0,
    )
  })

  it('refuses a file that is not a JPEG, or whose header is truncated', () => {
    expect(() => writeJpegBlocks(ascii('GIF89a'), { xmp: 'x' })).toThrow(
      EmbeddedWriteError,
    )
    const file = jpeg(exifSegment(), xmpSegment(xmpPacket('Cut')))
    expect(() => writeJpegBlocks(file.subarray(0, 30), { xmp: 'x' })).toThrow(
      /structure is damaged/,
    )
  })

  it('refuses a PNG text update, and ignores a PNG text removal', () => {
    expect(() => writeJpegBlocks(jpeg(), { pngText: { Title: 'x' } })).toThrow(
      EmbeddedWriteError,
    )
    expect(writeJpegBlocks(jpeg(), { pngText: { Title: null } })).toEqual(
      jpeg(),
    )
  })

  it('copies a trailer after EOI through verbatim', () => {
    const trailer = concatBytes([
      ascii('MotionPhoto_Data'),
      new Uint8Array(64).fill(9),
    ])
    const file = concatBytes([jpeg(JFIF, xmpSegment(xmpPacket('A'))), trailer])
    const out = writeJpegBlocks(file, { xmp: xmpPacket('Bee'), exif: TIFF })
    expect(out.subarray(out.length - trailer.length)).toEqual(trailer)
    expect(scanOf(out)).toEqual(scanOf(file))
  })

  describe('MPF', () => {
    /**
     * An APP2 MPF index (CIPA DC-007) with two entries: the primary image
     * (offset 0) and a secondary image appended after EOI, located by its
     * offset from the MPF TIFF header.
     */
    function mpfSegment(offset: number, little: boolean): Uint8Array {
      const u16 = (v: number) =>
        little ? bytes(v & 0xff, v >> 8) : bytes(v >> 8, v & 0xff)
      const u32 = (v: number) =>
        little
          ? bytes(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24)
          : bytes(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
      // TIFF header (8) + IFD count (2) + 3 entries (36) + next IFD (4) = 50.
      const tableAt = 50
      return segment(
        0xe2,
        ascii('MPF\0'),
        little ? ascii('II*\0') : ascii('MM\0*'),
        u32(8),
        u16(3),
        concatBytes([u16(0xb000), u16(7), u32(4), ascii('0100')]),
        concatBytes([u16(0xb001), u16(4), u32(1), u32(2)]),
        concatBytes([u16(0xb002), u16(7), u32(32), u32(tableAt)]),
        u32(0),
        concatBytes([u32(0x030000), u32(1000), u32(0), u16(0), u16(0)]),
        concatBytes([u32(0x010001), u32(1000), u32(offset), u16(0), u16(0)]),
      )
    }

    function secondaryOffset(file: Uint8Array, little: boolean): number {
      const at = indexOfBytes(file, ascii('MPF\0')) + 4
      const table = at + 50 + 16
      const read = little
        ? (o: number) =>
            ((file[o] ?? 0) |
              ((file[o + 1] ?? 0) << 8) |
              ((file[o + 2] ?? 0) << 16)) +
            (file[o + 3] ?? 0) * 0x1000000
        : (o: number) => readU32BE(file, o)
      return at + read(table + 8)
    }

    const SECONDARY = concatBytes([SOI, ascii('secondary'), bytes(0xff, 0xd9)])

    function mpfFile(little: boolean, ...after: Uint8Array[]): Uint8Array {
      // Build once to measure, then again with the right offset.
      const build = (offset: number) =>
        concatBytes([
          jpeg(JFIF, exifSegment(), mpfSegment(offset, little), ...after),
          SECONDARY,
        ])
      const draft = build(0)
      const tiffAt = indexOfBytes(draft, ascii('MPF\0')) + 4
      return build(draft.length - SECONDARY.length - tiffAt)
    }

    it.each([true, false])(
      'shifts the secondary image offset when a segment after MPF resizes (little=%s)',
      (little) => {
        const file = mpfFile(little, xmpSegment(xmpPacket('Short')))
        expect(
          file.subarray(
            secondaryOffset(file, little),
            secondaryOffset(file, little) + 11,
          ),
        ).toEqual(SECONDARY.subarray(0, 11))
        const out = writeJpegBlocks(file, {
          xmp: xmpPacket(
            'A considerably longer title, which moves the secondary image',
          ),
        })
        const at = secondaryOffset(out, little)
        expect(out.subarray(at, at + SECONDARY.length)).toEqual(SECONDARY)
        expect(out.subarray(out.length - SECONDARY.length)).toEqual(SECONDARY)
      },
    )

    it('leaves the MPF segment alone when the change is before it', () => {
      const file = mpfFile(false, xmpSegment(xmpPacket('After')))
      const mpfBefore = file.subarray(indexOfBytes(file, ascii('MPF\0')) - 4)
      const out = writeJpegBlocks(file, {
        exif: concatBytes([TIFF, new Uint8Array(100)]),
      })
      const at = secondaryOffset(out, false)
      expect(out.subarray(at, at + SECONDARY.length)).toEqual(SECONDARY)
      expect(indexOfBytes(out, mpfBefore.subarray(0, 60))).toBeGreaterThan(0)
    })

    it('shifts for an insert after MPF and a removal after MPF alike', () => {
      const file = mpfFile(true, comSegment(ascii('c')))
      const inserted = writeJpegBlocks(file, { xmp: xmpPacket('Inserted') })
      // XMP goes after EXIF, which is before MPF: no shift needed, still valid.
      let at = secondaryOffset(inserted, true)
      expect(inserted.subarray(at, at + SECONDARY.length)).toEqual(SECONDARY)
      const withIrb = mpfFile(true, irbSegment(irb(ascii('drop me'))))
      const removed = writeJpegBlocks(withIrb, { irb: null })
      at = secondaryOffset(removed, true)
      expect(removed.subarray(at, at + SECONDARY.length)).toEqual(SECONDARY)
    })

    it('refuses rather than leave an MPF index it cannot follow', () => {
      const broken = segment(
        0xe2,
        ascii('MPF\0'),
        ascii('XX'),
        new Uint8Array(20),
      )
      const file = jpeg(broken, xmpSegment(xmpPacket('x')))
      expect(() =>
        writeJpegBlocks(file, { xmp: xmpPacket('longer value') }),
      ).toThrow(EmbeddedWriteError)
    })
  })
})
