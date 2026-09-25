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
  bytesAt,
  concatBytes,
  crc32,
  decodeFreeText,
  indexOfBytes,
  latin1Decode,
  latin1Encode,
  readAscii,
  readU16BE,
  readU16LE,
  readU24LE,
  readU32BE,
  readU32LE,
  trimNul,
  utf16beDecode,
  writeU16BE,
  writeU32BE,
  writeU32LE,
} from './image-blocks'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('image-blocks byte helpers', () => {
  it('reads and writes integers in both byte orders', () => {
    const data = bytes(0xfe, 0xdc, 0xba, 0x98)
    expect(readU16BE(data, 0)).toBe(0xfedc)
    expect(readU16LE(data, 0)).toBe(0xdcfe)
    expect(readU24LE(data, 0)).toBe(0xbadcfe)
    expect(readU32BE(data, 0)).toBe(0xfedcba98)
    expect(readU32LE(data, 0)).toBe(0x98badcfe)
    const out = new Uint8Array(10)
    writeU16BE(out, 0, 0x1234)
    writeU32BE(out, 2, 0xfedcba98)
    writeU32LE(out, 6, 0xfedcba98)
    expect(Array.from(out)).toEqual([
      0x12, 0x34, 0xfe, 0xdc, 0xba, 0x98, 0x98, 0xba, 0xdc, 0xfe,
    ])
  })

  it('reads past the end as zeros instead of throwing', () => {
    expect(readU32BE(bytes(1), 0)).toBe(0x01000000)
    expect(readU32LE(bytes(), 5)).toBe(0)
    expect(readAscii(bytes(0x41, 0x42), 1, 10)).toBe('B')
  })

  it('computes the PNG CRC-32 of the IEND chunk', () => {
    // Every PNG ends with this CRC over the type "IEND".
    expect(crc32(asciiBytes('IEND'))).toBe(0xae426082)
    expect(crc32(asciiBytes('IE'), asciiBytes('ND'))).toBe(0xae426082)
  })

  it('finds and matches byte sequences within bounds', () => {
    const hay = asciiBytes('abcabcd')
    expect(indexOfBytes(hay, asciiBytes('abcd'))).toBe(3)
    expect(indexOfBytes(hay, asciiBytes('abcd'), 0, 6)).toBe(-1)
    expect(indexOfBytes(hay, new Uint8Array(0))).toBe(-1)
    expect(bytesAt(hay, 5, asciiBytes('cd'))).toBe(true)
    expect(bytesAt(hay, 6, asciiBytes('cd'))).toBe(false)
    expect(bytesAt(hay, -1, asciiBytes('a'))).toBe(false)
  })

  it('decodes and encodes text', () => {
    expect(latin1Decode(bytes(0x63, 0x61, 0x66, 0xe9))).toBe('caf\u00e9')
    expect(latin1Encode('caf\u00e9')).toEqual(bytes(0x63, 0x61, 0x66, 0xe9))
    expect(latin1Encode('\u2615')).toBeNull()
    expect(decodeFreeText(bytes(0x63, 0xc3, 0xa9))).toBe('c\u00e9')
    expect(decodeFreeText(bytes(0x63, 0xe9))).toBe('c\u00e9')
    expect(utf16beDecode(bytes(0, 0x41, 0xd8, 0x3d, 0xde, 0x00, 0x7f))).toBe(
      'A\ud83d\ude00',
    )
    expect(trimNul('abc\0\0')).toBe('abc')
    expect(latin1Decode(new Uint8Array(70000).fill(0x41)).length).toBe(70000)
  })

  it('concatenates', () => {
    expect(concatBytes([bytes(1), bytes(), bytes(2, 3)])).toEqual(
      bytes(1, 2, 3),
    )
  })
})
