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
import {
  asciiBytes,
  concatBytes,
  crc32,
  readAscii,
  readU32BE,
  utf8Encode,
  writeU32BE,
} from './image-blocks'
import { readPngBlocks, writePngBlocks } from './png'
import { EmbeddedWriteError } from './types'

// ---------------------------------------------------------------------------
// Fixtures: a real, decodable 2×2 RGB PNG assembled chunk by chunk.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = asciiBytes
const SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function chunk(type: string, ...data: Uint8Array[]): Uint8Array {
  const body = concatBytes(data)
  const out = new Uint8Array(12 + body.length)
  writeU32BE(out, 0, body.length)
  out.set(ascii(type), 4)
  out.set(body, 8)
  writeU32BE(out, 8 + body.length, crc32(ascii(type), body))
  return out
}

const IHDR = chunk('IHDR', bytes(0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0))
const PIXELS = new Uint8Array(
  deflateSync(bytes(0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9)),
)
const IDAT_A = chunk('IDAT', PIXELS.subarray(0, 5))
const IDAT_B = chunk('IDAT', PIXELS.subarray(5))
const IEND = chunk('IEND')

const tEXt = (keyword: string, text: string) =>
  chunk('tEXt', ascii(keyword), bytes(0), ascii(text))
const zTXt = (keyword: string, text: string) =>
  chunk(
    'zTXt',
    ascii(keyword),
    bytes(0, 0),
    new Uint8Array(deflateSync(ascii(text))),
  )
const iTXt = (
  keyword: string,
  text: string,
  { compressed = false, language = '', translated = '' } = {},
) =>
  chunk(
    'iTXt',
    ascii(keyword),
    bytes(0, compressed ? 1 : 0, 0),
    ascii(language),
    bytes(0),
    utf8Encode(translated),
    bytes(0),
    compressed
      ? new Uint8Array(deflateSync(utf8Encode(text)))
      : utf8Encode(text),
  )

const TIFF = concatBytes([ascii('II*\0'), bytes(8, 0, 0, 0, 0, 0)])
const eXIf = (tiff: Uint8Array = TIFF) => chunk('eXIf', tiff)
const XMP = (title: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>${title}</dc:title></x:xmpmeta>`
const xmpChunk = (title: string) => iTXt('XML:com.adobe.xmp', XMP(title))
const iCCP = (profile: Uint8Array) =>
  chunk(
    'iCCP',
    ascii('ICC profile'),
    bytes(0, 0),
    new Uint8Array(deflateSync(profile)),
  )

/** ImageMagick's hex raw profile text. */
function rawProfile(name: string, payload: Uint8Array): string {
  const hex = Array.from(payload, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )
  const lines = hex.match(/.{1,72}/g) ?? []
  return `\n${name}\n${String(payload.length).padStart(8)}\n${lines.join('\n')}\n`
}

function png(...beforeIdat: Uint8Array[]): Uint8Array {
  return concatBytes([SIGNATURE, IHDR, ...beforeIdat, IDAT_A, IDAT_B, IEND])
}

interface Chunk {
  type: string
  bytes: Uint8Array
  crcOk: boolean
}

function chunksOf(file: Uint8Array): Chunk[] {
  const out: Chunk[] = []
  let offset = 8
  while (offset + 12 <= file.length) {
    const length = readU32BE(file, offset)
    const type = readAscii(file, offset + 4, 4)
    const end = offset + 12 + length
    const crc = readU32BE(file, end - 4)
    out.push({
      type,
      bytes: file.subarray(offset, end),
      crcOk: crc === crc32(file.subarray(offset + 4, end - 4)),
    })
    offset = end
    if (type === 'IEND') break
  }
  return out
}

const types = (file: Uint8Array) => chunksOf(file).map((c) => c.type)
const idats = (file: Uint8Array) =>
  concatBytes(
    chunksOf(file)
      .filter((c) => c.type === 'IDAT')
      .map((c) => c.bytes),
  )

function expectValid(file: Uint8Array) {
  expect(Array.from(file.subarray(0, 8))).toEqual(Array.from(SIGNATURE))
  for (const c of chunksOf(file)) expect(c.crcOk).toBe(true)
}

// ---------------------------------------------------------------------------

describe('readPngBlocks', () => {
  it('returns null for bytes that are not a PNG', () => {
    expect(readPngBlocks(new Uint8Array(0))).toBeNull()
    expect(readPngBlocks(bytes(0xff, 0xd8, 0xff))).toBeNull()
    expect(readPngBlocks(ascii('\x89PNG\r\n\x1a'))).toBeNull()
  })

  it('returns an empty record for a PNG with no metadata', () => {
    expect(readPngBlocks(png())).toEqual({})
  })

  it('reads every text chunk type, eXIf, XMP and iCCP', () => {
    const file = png(
      iCCP(ascii('profile bytes')),
      tEXt('Title', 'Caf\xe9'),
      zTXt('Comment', 'squeezed'),
      iTXt('Description', '\u6771\u4eac', {
        language: 'ja',
        translated: '\u8aac\u660e',
      }),
      iTXt('Author', 'Zipped \u00e9', { compressed: true }),
      eXIf(),
      xmpChunk('Harbor'),
    )
    const blocks = readPngBlocks(file)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP('Harbor'))
    expect(new TextDecoder().decode(blocks?.icc)).toBe('profile bytes')
    expect(blocks?.pngText).toEqual([
      { keyword: 'Title', type: 'tEXt', text: 'Caf\u00e9' },
      { keyword: 'Comment', type: 'zTXt', text: 'squeezed' },
      {
        keyword: 'Description',
        type: 'iTXt',
        text: '\u6771\u4eac',
        language: 'ja',
        translatedKeyword: '\u8aac\u660e',
      },
      { keyword: 'Author', type: 'iTXt', text: 'Zipped \u00e9' },
    ])
  })

  it('reads XMP from a text chunk of any type', () => {
    const file = png(zTXt('XML:com.adobe.xmp', XMP('Z')))
    expect(readPngBlocks(file)?.xmp).toBe(XMP('Z'))
    expect(readPngBlocks(file)?.pngText).toBeUndefined()
  })

  it('falls back to legacy raw profiles only when the modern chunks are absent', () => {
    const legacyTiff = concatBytes([ascii('MM\0*'), bytes(0, 0, 0, 8, 0, 0)])
    const exifProfile = zTXt(
      'Raw profile type exif',
      rawProfile('exif', concatBytes([ascii('Exif\0\0'), legacyTiff])),
    )
    const xmpProfile = zTXt(
      'Raw profile type xmp',
      rawProfile('xmp', utf8Encode(XMP('Legacy'))),
    )
    const legacyOnly = readPngBlocks(png(exifProfile, xmpProfile))
    expect(legacyOnly?.exif).toEqual(legacyTiff)
    expect(legacyOnly?.xmp).toBe(XMP('Legacy'))
    expect(legacyOnly?.pngText).toBeUndefined()

    const both = readPngBlocks(
      png(exifProfile, xmpProfile, eXIf(), xmpChunk('Modern')),
    )
    expect(both?.exif).toEqual(TIFF)
    expect(both?.xmp).toBe(XMP('Modern'))
  })

  it('sorts a Raw profile type APP1 into EXIF or XMP by its prefix', () => {
    const asXmp = tEXt(
      'Raw profile type APP1',
      rawProfile(
        'APP1',
        concatBytes([
          ascii('http://ns.adobe.com/xap/1.0/\0'),
          utf8Encode(XMP('A')),
        ]),
      ),
    )
    expect(readPngBlocks(png(asXmp))?.xmp).toBe(XMP('A'))
    const asExif = tEXt(
      'Raw profile type APP1',
      rawProfile('APP1', concatBytes([ascii('Exif\0\0'), TIFF])),
    )
    expect(readPngBlocks(png(asExif))?.exif).toEqual(TIFF)
  })

  it('ignores a malformed raw profile and malformed text chunks', () => {
    const file = png(
      tEXt('Raw profile type exif', '\nexif\n      99\nzz\n'),
      chunk('zTXt', ascii('Broken'), bytes(0, 0), ascii('not zlib')),
      chunk('iTXt', ascii('NoTerminators'), bytes(0, 0)),
      chunk('tEXt', ascii('no keyword terminator')),
      tEXt('Fine', 'ok'),
    )
    const blocks = readPngBlocks(file)
    expect(blocks?.exif).toBeUndefined()
    expect(blocks?.pngText).toEqual([
      { keyword: 'Fine', type: 'tEXt', text: 'ok' },
    ])
  })

  it('refuses to inflate a compression bomb, without throwing', () => {
    const bomb = chunk(
      'zTXt',
      ascii('Bomb'),
      bytes(0, 0),
      new Uint8Array(deflateSync(new Uint8Array(40 * 1024 * 1024))),
    )
    expect(
      readPngBlocks(png(bomb, tEXt('After', 'still read')))?.pngText,
    ).toEqual([{ keyword: 'After', type: 'tEXt', text: 'still read' }])
  })

  it('returns what it found before a truncation', () => {
    const file = png(tEXt('Title', 'kept'), eXIf())
    const cut = file.subarray(0, file.length - IEND.length - IDAT_B.length - 3)
    expect(readPngBlocks(cut)?.pngText).toEqual([
      { keyword: 'Title', type: 'tEXt', text: 'kept' },
    ])
    // A length pointing past the end.
    const lying = concatBytes([
      SIGNATURE,
      IHDR,
      bytes(0x7f, 0xff, 0xff, 0xff),
      ascii('tEXt'),
    ])
    expect(readPngBlocks(lying)).toEqual({})
  })

  it('never throws on garbage', () => {
    const base = png(
      tEXt('Title', 'x'),
      zTXt('Comment', 'y'),
      eXIf(),
      xmpChunk('z'),
    )
    let seed = 11
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round += 1) {
      const mutated = base.slice(0, 8 + (random() % (base.length - 7)))
      for (let flips = random() % 8; flips > 0; flips -= 1) {
        mutated[8 + (random() % Math.max(1, mutated.length - 8))] =
          random() & 0xff
      }
      expect(() => readPngBlocks(mutated)).not.toThrow()
      try {
        const out = writePngBlocks(mutated, {
          xmp: XMP('New'),
          pngText: { Title: 'new' },
        })
        expect(() => readPngBlocks(out)).not.toThrow()
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddedWriteError)
      }
    }
  })
})

describe('writePngBlocks', () => {
  it('inserts eXIf, XMP and text immediately before the first IDAT', () => {
    const file = png(chunk('gAMA', bytes(0, 0, 0xb1, 0x8f)))
    const out = writePngBlocks(file, {
      exif: TIFF,
      xmp: XMP('New'),
      pngText: { Title: 'Hello', Author: '\u5c71\u7530' },
    })
    expect(types(out)).toEqual([
      'IHDR',
      'gAMA',
      'eXIf',
      'iTXt',
      'tEXt',
      'iTXt',
      'IDAT',
      'IDAT',
      'IEND',
    ])
    expectValid(out)
    expect(idats(out)).toEqual(idats(file))
    const blocks = readPngBlocks(out)
    expect(blocks?.exif).toEqual(TIFF)
    expect(blocks?.xmp).toBe(XMP('New'))
    expect(blocks?.pngText).toEqual([
      { keyword: 'Title', type: 'tEXt', text: 'Hello' },
      { keyword: 'Author', type: 'iTXt', text: '\u5c71\u7530' },
    ])
  })

  it('writes XMP as an uncompressed iTXt with empty language fields', () => {
    const out = writePngBlocks(png(), { xmp: XMP('Plain') })
    const xmp = chunksOf(out).find((c) => c.type === 'iTXt')
    expect(xmp?.bytes).toEqual(xmpChunk('Plain'))
  })

  it('replaces chunks in place, keeping their type and language', () => {
    const file = png(
      tEXt('Title', 'old'),
      zTXt('Comment', 'old comment'),
      iTXt('Description', 'alt', {
        language: 'fr',
        translated: 'Description',
        compressed: true,
      }),
      eXIf(),
      xmpChunk('Old'),
      tEXt('Keep', 'untouched'),
    )
    const tiff = concatBytes([ascii('MM\0*'), bytes(0, 0, 0, 8, 0, 0)])
    const out = writePngBlocks(file, {
      exif: tiff,
      xmp: XMP('Replaced'),
      pngText: {
        Title: 'new',
        Comment: 'new comment',
        Description: 'nouvelle',
      },
    })
    expect(types(out)).toEqual(types(file))
    expectValid(out)
    expect(idats(out)).toEqual(idats(file))
    const blocks = readPngBlocks(out)
    expect(blocks?.exif).toEqual(tiff)
    expect(blocks?.xmp).toBe(XMP('Replaced'))
    expect(blocks?.pngText).toEqual([
      { keyword: 'Title', type: 'tEXt', text: 'new' },
      { keyword: 'Comment', type: 'zTXt', text: 'new comment' },
      {
        keyword: 'Description',
        type: 'iTXt',
        text: 'nouvelle',
        language: 'fr',
        translatedKeyword: 'Description',
      },
      { keyword: 'Keep', type: 'tEXt', text: 'untouched' },
    ])
    // The untouched chunk is the very same bytes.
    expect(chunksOf(out)[6]?.bytes).toEqual(tEXt('Keep', 'untouched'))
  })

  it('turns a tEXt into an iTXt when the new value is not Latin-1', () => {
    const out = writePngBlocks(png(tEXt('Title', 'old')), {
      pngText: { Title: 'caf\u00e9 \u2615' },
    })
    expect(readPngBlocks(out)?.pngText).toEqual([
      { keyword: 'Title', type: 'iTXt', text: 'caf\u00e9 \u2615' },
    ])
    expectValid(out)
  })

  it('removes text, EXIF and XMP on null, and duplicates on a set', () => {
    const file = png(
      tEXt('Title', 'one'),
      tEXt('Title', 'two'),
      tEXt('Gone', 'bye'),
      eXIf(),
      xmpChunk('Bye'),
    )
    const out = writePngBlocks(file, {
      exif: null,
      xmp: null,
      pngText: { Gone: null, Title: 'only' },
    })
    expect(types(out)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IDAT', 'IEND'])
    const blocks = readPngBlocks(out)
    expect(blocks).toEqual({
      pngText: [{ keyword: 'Title', type: 'tEXt', text: 'only' }],
    })
    expect(idats(out)).toEqual(idats(file))
  })

  it('removes the legacy raw profiles along with the block they duplicate', () => {
    const file = png(
      zTXt(
        'Raw profile type exif',
        rawProfile('exif', concatBytes([ascii('Exif\0\0'), TIFF])),
      ),
      zTXt(
        'Raw profile type xmp',
        rawProfile('xmp', utf8Encode(XMP('Legacy'))),
      ),
      zTXt('Raw profile type iptc', rawProfile('iptc', ascii('8BIM'))),
    )
    const removed = writePngBlocks(file, { exif: null, xmp: null })
    expect(readPngBlocks(removed)).toEqual({})
    // The IPTC profile is not EXIF or XMP and stays.
    expect(types(removed)).toEqual(['IHDR', 'zTXt', 'IDAT', 'IDAT', 'IEND'])

    const replaced = writePngBlocks(file, { exif: TIFF })
    expect(readPngBlocks(replaced)?.exif).toEqual(TIFF)
    expect(readPngBlocks(replaced)?.xmp).toBe(XMP('Legacy'))
    expect(types(replaced)).toEqual([
      'IHDR',
      'zTXt',
      'zTXt',
      'eXIf',
      'IDAT',
      'IDAT',
      'IEND',
    ])
  })

  it('moves an eXIf that an older writer put after IDAT to before it', () => {
    const file = concatBytes([SIGNATURE, IHDR, IDAT_A, IDAT_B, eXIf(), IEND])
    const out = writePngBlocks(file, { exif: TIFF })
    expect(types(out)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IDAT', 'IEND'])
    expect(idats(out)).toEqual(idats(file))
  })

  it('leaves an unchanged file identical, trailing bytes included', () => {
    const file = concatBytes([png(tEXt('A', 'b')), ascii('trailing')])
    expect(writePngBlocks(file, {})).toEqual(file)
    const out = writePngBlocks(file, { pngText: { A: 'c' } })
    expect(out.subarray(out.length - 8)).toEqual(ascii('trailing'))
  })

  it('inserts before the fcTL that introduces an APNG default image', () => {
    const acTL = chunk('acTL', bytes(0, 0, 0, 1, 0, 0, 0, 0))
    const fcTL = chunk('fcTL', new Uint8Array(26))
    const file = concatBytes([SIGNATURE, IHDR, acTL, fcTL, IDAT_A, IEND])
    const out = writePngBlocks(file, { pngText: { Title: 'anim' } })
    expect(types(out)).toEqual(['IHDR', 'acTL', 'tEXt', 'fcTL', 'IDAT', 'IEND'])
  })

  it('refuses what a PNG cannot hold, and ignores removing it', () => {
    expect(() => writePngBlocks(png(), { irb: bytes(1, 2) })).toThrow(
      EmbeddedWriteError,
    )
    expect(writePngBlocks(png(), { irb: null })).toEqual(png())
  })

  it('refuses keywords the PNG spec does not allow, and NUL in text', () => {
    for (const keyword of [
      '',
      ' Lead',
      'Trail ',
      'Two  spaces',
      'x'.repeat(80),
      'Tab\t',
      'XML:com.adobe.xmp',
    ]) {
      expect(() =>
        writePngBlocks(png(), { pngText: { [keyword]: 'v' } }),
      ).toThrow(EmbeddedWriteError)
    }
    expect(() => writePngBlocks(png(), { pngText: { Title: 'a\0b' } })).toThrow(
      EmbeddedWriteError,
    )
    expect(() =>
      writePngBlocks(png(), {
        pngText: { ['Caf\u00e9 ' + 'x'.repeat(74)]: 'v' },
      }),
    ).not.toThrow()
  })

  it('round-trips a keyword the file already has, even one off the rules', () => {
    const file = png(tEXt('Trailing ', 'old'))
    const out = writePngBlocks(file, { pngText: { 'Trailing ': 'new' } })
    expect(readPngBlocks(out)?.pngText).toEqual([
      { keyword: 'Trailing ', type: 'tEXt', text: 'new' },
    ])
    expect(
      readPngBlocks(writePngBlocks(file, { pngText: { 'Trailing ': null } })),
    ).toEqual({})
  })

  it('refuses a file that is not a PNG, or that ends before IEND', () => {
    expect(() => writePngBlocks(ascii('GIF89a'), { xmp: 'x' })).toThrow(
      EmbeddedWriteError,
    )
    const file = png(tEXt('A', 'b'))
    expect(() =>
      writePngBlocks(file.subarray(0, file.length - 4), { xmp: 'x' }),
    ).toThrow(/structure is damaged/)
  })
})
