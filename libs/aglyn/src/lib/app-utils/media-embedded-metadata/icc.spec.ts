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

import { readIccDescription } from './icc'
import { asciiBytes, concatBytes, writeU32BE } from './image-blocks'

// ---------------------------------------------------------------------------
// Fixtures: a profile header and tag table, with the `desc` tag in each of
// the encodings writers use.
// ---------------------------------------------------------------------------

const ascii = asciiBytes
const u32 = (v: number) => {
  const out = new Uint8Array(4)
  writeU32BE(out, 0, v)
  return out
}
const utf16be = (text: string) => {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i += 1) {
    out[i * 2] = text.charCodeAt(i) >> 8
    out[i * 2 + 1] = text.charCodeAt(i) & 0xff
  }
  return out
}

/** A profile whose tag table holds the given tags, laid out after it. */
function profile(tags: [string, Uint8Array][]): Uint8Array {
  const header = new Uint8Array(128)
  header.set(ascii('acsp'), 36)
  const tableSize = 4 + tags.length * 12
  let offset = 128 + tableSize
  const table: Uint8Array[] = [u32(tags.length)]
  const data: Uint8Array[] = []
  for (const [signature, tag] of tags) {
    table.push(ascii(signature), u32(offset), u32(tag.length))
    data.push(tag)
    offset += tag.length
  }
  const out = concatBytes([header, ...table, ...data])
  writeU32BE(out, 0, out.length)
  return out
}

/** v2 `textDescriptionType`: ASCII, then Unicode, then ScriptCode. */
function textDescription(asciiText: string, unicode = ''): Uint8Array {
  return concatBytes([
    ascii('desc'),
    u32(0),
    u32(asciiText.length ? asciiText.length + 1 : 0),
    asciiText.length ? ascii(`${asciiText}\0`) : new Uint8Array(0),
    u32(0),
    u32(unicode.length),
    utf16be(unicode),
    new Uint8Array(2 + 1 + 67),
  ])
}

/** v4 `multiLocalizedUnicodeType` with one record per `[lang, text]`. */
function mluc(records: [string, string][]): Uint8Array {
  const head = [ascii('mluc'), u32(0), u32(records.length), u32(12)]
  let offset = 16 + records.length * 12
  const entries: Uint8Array[] = []
  const strings: Uint8Array[] = []
  for (const [lang, text] of records) {
    const encoded = utf16be(text)
    entries.push(ascii(lang), u32(encoded.length), u32(offset))
    strings.push(encoded)
    offset += encoded.length
  }
  return concatBytes([...head, ...entries, ...strings])
}

const OTHER = concatBytes([ascii('XYZ '), u32(0), new Uint8Array(12)])

// ---------------------------------------------------------------------------

describe('readIccDescription', () => {
  it('reads a v2 textDescriptionType', () => {
    const icc = profile([
      ['wtpt', OTHER],
      ['desc', textDescription('sRGB IEC61966-2.1')],
    ])
    expect(readIccDescription(icc)).toBe('sRGB IEC61966-2.1')
  })

  it('falls back to the Unicode copy when the ASCII one is empty', () => {
    const icc = profile([['desc', textDescription('', 'Caf\u00e9 RGB')]])
    expect(readIccDescription(icc)).toBe('Caf\u00e9 RGB')
  })

  it('reads the first record of a v4 multiLocalizedUnicodeType', () => {
    const icc = profile([
      [
        'desc',
        mluc([
          ['enUS', 'Display P3'],
          ['deDE', 'Anzeige P3'],
        ]),
      ],
      ['cprt', mluc([['enUS', 'Copyright Apple Inc.']])],
    ])
    expect(readIccDescription(icc)).toBe('Display P3')
  })

  it('reads a plain textType description', () => {
    const icc = profile([
      ['desc', concatBytes([ascii('text'), u32(0), ascii('Plain name\0')])],
    ])
    expect(readIccDescription(icc)).toBe('Plain name')
  })

  it('returns null for bytes that are not a profile, or have no description', () => {
    expect(readIccDescription(new Uint8Array(0))).toBeNull()
    expect(readIccDescription(new Uint8Array(200))).toBeNull()
    expect(readIccDescription(profile([['wtpt', OTHER]]))).toBeNull()
    expect(readIccDescription(profile([['desc', OTHER]]))).toBeNull()
    expect(
      readIccDescription(profile([['desc', textDescription('   ')]])),
    ).toBeNull()
  })

  it('returns null rather than throw on hostile offsets and counts', () => {
    const icc = profile([['desc', mluc([['enUS', 'Name']])]])
    const lying = icc.slice()
    writeU32BE(lying, 128, 0xffffffff)
    expect(() => readIccDescription(lying)).not.toThrow()
    const pastEnd = icc.slice()
    writeU32BE(pastEnd, 132 + 4, 0x7fffffff)
    expect(readIccDescription(pastEnd)).toBeNull()
    const badRecord = icc.slice()
    // The mluc record's string offset, pointed past the tag.
    writeU32BE(badRecord, 128 + 16 + 16 + 8, 0xffff)
    expect(readIccDescription(badRecord)).toBeNull()
    expect(readIccDescription(icc.subarray(0, icc.length - 3))).toBe('Na')
    let seed = 17
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 500; round += 1) {
      const mutated = icc.slice(0, 40 + (random() % (icc.length - 39)))
      for (let flips = random() % 6; flips > 0; flips -= 1) {
        mutated[40 + (random() % Math.max(1, mutated.length - 40))] =
          random() & 0xff
      }
      expect(() => readIccDescription(mutated)).not.toThrow()
    }
  })
})
