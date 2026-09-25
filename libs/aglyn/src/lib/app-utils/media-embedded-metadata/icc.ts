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
 * The one thing the DAM shows from an ICC profile: its description — "sRGB
 * IEC61966-2.1", "Display P3" (AGL-3331).
 *
 * An ICC profile is a 128-byte header (the signature `acsp` at offset 36), a
 * tag count at 128, then 12-byte tag table entries of signature, offset and
 * size (ICC.1:2010, 7.3). The description is the `desc` tag, whose type
 * depends on the profile's version:
 *
 * - v2: `textDescriptionType` (ICC.1:2001-04) — an ASCII string with its
 *   length, then an optional Unicode and ScriptCode copy.
 * - v4: `multiLocalizedUnicodeType` (ICC.1:2010) — records of language,
 *   country, length and offset over UTF-16BE text. The first record is the
 *   profile's own choice of default.
 * - Some writers use a plain `textType`; that is read as ASCII.
 */

import { readAscii, readU32BE, trimNul, utf16beDecode } from './image-blocks'

/** Tags read before giving up on finding `desc`. */
const MAX_TAGS = 1024
/** A description longer than this is not a name; it is cut here. */
const MAX_DESCRIPTION = 512

/** Keeps a decoded description to something a person can read. */
function clean(text: string): string | null {
  const trimmed = trimNul(text)
    .replace(/\0[\s\S]*$/, '')
    .trim()
  return trimmed ? trimmed.slice(0, MAX_DESCRIPTION) : null
}

/** A `textDescriptionType` body: ASCII first, then its Unicode copy. */
function textDescription(tag: Uint8Array): string | null {
  const asciiCount = readU32BE(tag, 8)
  const asciiEnd = 12 + asciiCount
  if (asciiCount > 0 && asciiEnd <= tag.length) {
    const ascii = clean(readAscii(tag, 12, asciiCount))
    if (ascii) return ascii
  }
  // Unicode language code (4) and character count (4), then UTF-16BE.
  if (asciiEnd + 8 > tag.length) return null
  const unicodeCount = readU32BE(tag, asciiEnd + 4)
  const start = asciiEnd + 8
  const end = Math.min(tag.length, start + unicodeCount * 2)
  return unicodeCount ? clean(utf16beDecode(tag.subarray(start, end))) : null
}

/** A `multiLocalizedUnicodeType` body: its first record. */
function multiLocalized(tag: Uint8Array): string | null {
  const records = readU32BE(tag, 8)
  const recordSize = readU32BE(tag, 12)
  if (!records || recordSize < 12 || 16 + recordSize > tag.length) return null
  const length = readU32BE(tag, 16 + 4)
  const offset = readU32BE(tag, 16 + 8)
  if (offset >= tag.length) return null
  return clean(
    utf16beDecode(tag.subarray(offset, Math.min(tag.length, offset + length))),
  )
}

/**
 * The profile description of an ICC profile, or `null` when the bytes are
 * not a profile, carry no `desc` tag, or it holds no readable text. Never
 * throws.
 */
export function readIccDescription(icc: Uint8Array): string | null {
  if (icc.length < 132 || readAscii(icc, 36, 4) !== 'acsp') return null
  const count = Math.min(readU32BE(icc, 128), MAX_TAGS)
  for (let i = 0; i < count; i += 1) {
    const entry = 132 + i * 12
    if (entry + 12 > icc.length) return null
    if (readAscii(icc, entry, 4) !== 'desc') continue
    const offset = readU32BE(icc, entry + 4)
    const size = readU32BE(icc, entry + 8)
    if (offset < 128 || offset + 12 > icc.length) return null
    const tag = icc.subarray(offset, Math.min(icc.length, offset + size))
    const type = readAscii(tag, 0, 4)
    if (type === 'desc') return textDescription(tag)
    if (type === 'mluc') return multiLocalized(tag)
    if (type === 'text') return clean(readAscii(tag, 8, tag.length - 8))
    return null
  }
  return null
}
