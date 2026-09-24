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

import { readGifBlocks } from './gif'
import { asciiBytes, concatBytes, utf8Encode } from './image-blocks'

// ---------------------------------------------------------------------------
// Fixtures: a decodable 1×1 GIF89a, with extensions spliced in before and
// between its frames.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = asciiBytes

/** Header, 1×1 screen, a 2-color global table. */
const HEAD = concatBytes([
  ascii('GIF89a'),
  bytes(1, 0, 1, 0, 0x80, 0, 0),
  bytes(0, 0, 0, 255, 255, 255),
])
/** Image descriptor with a 2-color local table, LZW code size 2, one pixel. */
const FRAME = concatBytes([
  bytes(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80),
  bytes(0, 0, 0, 255, 0, 0),
  bytes(0x02, 0x02, 0x44, 0x01, 0x00),
])
const TRAILER = bytes(0x3b)

/** A payload as sub-blocks of at most `size` bytes, then the terminator. */
function subBlocks(data: Uint8Array, size = 255): Uint8Array {
  const parts: Uint8Array[] = []
  for (let i = 0; i < data.length; i += size) {
    const part = data.subarray(i, i + size)
    parts.push(bytes(part.length), part)
  }
  return concatBytes([...parts, bytes(0)])
}

const comment = (data: Uint8Array, size?: number) =>
  concatBytes([bytes(0x21, 0xfe), subBlocks(data, size)])
const application = (id: string, data: Uint8Array) =>
  concatBytes([bytes(0x21, 0xff, 11), ascii(id), subBlocks(data)])
const graphicControl = bytes(0x21, 0xf9, 4, 0, 10, 0, 0, 0)

/** The XMP magic trailer: 0x01, 0xFF down to 0x00, then the terminator. */
const MAGIC = concatBytes([
  bytes(1),
  Uint8Array.from({ length: 256 }, (_, i) => 255 - i),
  bytes(0),
])
const xmpExtension = (packet: string) =>
  concatBytes([
    bytes(0x21, 0xff, 11),
    ascii('XMP DataXMP'),
    utf8Encode(packet),
    MAGIC,
  ])

const XMP =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>'

function gif(...blocks: Uint8Array[]): Uint8Array {
  return concatBytes([HEAD, ...blocks, TRAILER])
}

// ---------------------------------------------------------------------------

describe('readGifBlocks', () => {
  it('returns null for bytes that are not a GIF', () => {
    expect(readGifBlocks(new Uint8Array(0))).toBeNull()
    expect(readGifBlocks(ascii('GIF88a'))).toBeNull()
    expect(readGifBlocks(bytes(0xff, 0xd8, 0xff))).toBeNull()
  })

  it('returns an empty record for a GIF with no metadata', () => {
    expect(readGifBlocks(gif(FRAME))).toEqual({})
    expect(
      readGifBlocks(
        concatBytes([ascii('GIF87a'), HEAD.subarray(6), FRAME, TRAILER]),
      ),
    ).toEqual({})
  })

  it('reads comments, joining sub-blocks, in file order', () => {
    const long = 'x'.repeat(600)
    const file = gif(
      comment(ascii(long)),
      graphicControl,
      FRAME,
      comment(utf8Encode('caf\u00e9 \u2615'), 3),
      comment(bytes(0x63, 0x61, 0x66, 0xe9)),
      FRAME,
    )
    expect(readGifBlocks(file)?.comments).toEqual([
      long,
      'caf\u00e9 \u2615',
      'caf\u00e9',
    ])
  })

  it('reads the XMP packet up to its magic trailer, and walks on past it', () => {
    const file = gif(
      application('NETSCAPE2.0', bytes(1, 0, 0)),
      xmpExtension(XMP),
      FRAME,
      comment(ascii('after the packet')),
    )
    const blocks = readGifBlocks(file)
    expect(blocks?.xmp).toBe(XMP)
    expect(blocks?.comments).toEqual(['after the packet'])
  })

  it('reads a multi-byte UTF-8 XMP packet', () => {
    const packet =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>\u6771\u4eac</dc:title></x:xmpmeta>'
    expect(readGifBlocks(gif(xmpExtension(packet), FRAME))?.xmp).toBe(packet)
  })

  it('reads an ICC profile from its application extension', () => {
    const profile = Uint8Array.from({ length: 700 }, (_, i) => i & 0xff)
    const file = gif(application('ICCRGBG1012', profile), FRAME)
    expect(readGifBlocks(file)?.icc).toEqual(profile)
  })

  it('skips an XMP extension with no trailer rather than guessing its end', () => {
    const broken = concatBytes([
      bytes(0x21, 0xff, 11),
      ascii('XMP DataXMP'),
      subBlocks(ascii('<x/>')),
    ])
    const blocks = readGifBlocks(
      gif(broken, comment(ascii('still read')), FRAME),
    )
    expect(blocks?.xmp).toBeUndefined()
    expect(blocks?.comments).toEqual(['still read'])
  })

  it('returns what it found before a truncation or a bad block', () => {
    const file = gif(
      comment(ascii('first')),
      FRAME,
      comment(ascii('second, cut short')),
    )
    expect(readGifBlocks(file.subarray(0, file.length - 8))?.comments).toEqual([
      'first',
      'second, cut',
    ])
    const bad = concatBytes([
      HEAD,
      comment(ascii('kept')),
      bytes(0x99),
      comment(ascii('lost')),
    ])
    expect(readGifBlocks(bad)?.comments).toEqual(['kept'])
    expect(readGifBlocks(ascii('GIF89a'))).toEqual({})
  })

  it('never throws on garbage', () => {
    const base = gif(
      comment(ascii('c')),
      xmpExtension(XMP),
      application('ICCRGBG1012', bytes(1, 2)),
      FRAME,
    )
    let seed = 5
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round += 1) {
      const mutated = base.slice(0, 6 + (random() % (base.length - 5)))
      for (let flips = random() % 6; flips > 0; flips -= 1) {
        mutated[6 + (random() % Math.max(1, mutated.length - 6))] =
          random() & 0xff
      }
      expect(() => readGifBlocks(mutated)).not.toThrow()
    }
  })
})
