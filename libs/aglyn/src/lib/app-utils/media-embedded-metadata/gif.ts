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
 * GIF metadata blocks — comments, XMP and an ICC profile — read-only
 * (AGL-3331).
 *
 * A GIF (GIF89a specification) is a header, a logical screen descriptor
 * with an optional global color table, then a run of blocks up to the
 * `0x3B` trailer: image descriptors (`0x2C`) and extensions (`0x21` and a
 * label). Every variable-length payload is a chain of sub-blocks, each a
 * length byte and that many bytes, ended by a zero length.
 *
 * - Comment extensions (label `0xFE`, section 24) are free text.
 * - XMP is an application extension named `XMP Data` with authentication
 *   code `XMP` (XMP Specification Part 3, 1.1.2). It breaks the sub-block
 *   rule on purpose: the packet is written as raw bytes, followed by a
 *   258-byte "magic trailer" (`0x01`, then `0xFF` down to `0x00`, then the
 *   terminator) that lands any sub-block walker on the terminator. The
 *   packet is the bytes before that trailer.
 * - An ICC profile is the application extension `ICCRGBG1` / `012`, in
 *   ordinary sub-blocks.
 *
 * GIF is not writable here (see `MEDIA_EMBEDDED_WRITABLE_FORMATS`).
 */

import {
  asciiBytes,
  bytesAt,
  concatBytes,
  decodeFreeText,
  indexOfBytes,
  trimNul,
  utf8Decode,
  type ImageBlocks,
} from './image-blocks'

const GIF87A = asciiBytes('GIF87a')
const GIF89A = asciiBytes('GIF89a')
const XMP_APP = asciiBytes('XMP DataXMP')
const ICC_APP = asciiBytes('ICCRGBG1012')
/** The start of the XMP magic trailer; XML text never holds `0xFF`. */
const XMP_TRAILER = Uint8Array.from([0x01, 0xff, 0xfe, 0xfd])
const XMP_TRAILER_LENGTH = 258

/** Block count past which the walk stops; every block moves forward. */
const MAX_BLOCKS = 1 << 20
/** Comments kept; a file with more is not carrying captions. */
const MAX_COMMENTS = 256

/**
 * Follows a sub-block chain from `offset`. Returns the offset after its
 * terminator and the payload bytes (when `collect` is set), or `end: -1`
 * when the chain runs off the end of the file.
 */
function subBlocks(
  bytes: Uint8Array,
  offset: number,
  collect: boolean,
): { end: number; data: Uint8Array } {
  const parts: Uint8Array[] = []
  let at = offset
  while (at < bytes.length) {
    const size = bytes[at] ?? 0
    if (size === 0) {
      return {
        end: at + 1,
        data: collect ? concatBytes(parts) : new Uint8Array(0),
      }
    }
    if (collect) {
      parts.push(bytes.subarray(at + 1, Math.min(bytes.length, at + 1 + size)))
    }
    at += 1 + size
  }
  return { end: -1, data: collect ? concatBytes(parts) : new Uint8Array(0) }
}

/** The size in bytes of a color table from a packed-fields byte. */
function colorTableSize(packed: number): number {
  return packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0
}

/**
 * Reads the metadata blocks of a GIF. Returns `null` when the bytes are not
 * a GIF; a truncated or malformed file yields what came before the damage.
 */
export function readGifBlocks(bytes: Uint8Array): ImageBlocks | null {
  if (!bytesAt(bytes, 0, GIF89A) && !bytesAt(bytes, 0, GIF87A)) return null
  const blocks: ImageBlocks = {}
  const comments: string[] = []
  // Header (6) + logical screen descriptor (7), then the global color table.
  let offset = 13 + colorTableSize(bytes[10] ?? 0)
  for (let count = 0; count < MAX_BLOCKS && offset < bytes.length; count += 1) {
    const introducer = bytes[offset]
    if (introducer === 0x2c) {
      // Image descriptor (10 bytes), local color table, LZW code size, data.
      if (offset + 10 > bytes.length) break
      offset += 10 + colorTableSize(bytes[offset + 9] ?? 0) + 1
      offset = subBlocks(bytes, offset, false).end
      if (offset < 0) break
      continue
    }
    if (introducer !== 0x21) break
    const label = bytes[offset + 1]
    const start = offset + 2
    if (label === 0xfe) {
      const { end, data } = subBlocks(bytes, start, true)
      if (data.length && comments.length < MAX_COMMENTS) {
        comments.push(trimNul(decodeFreeText(data)))
      }
      offset = end
    } else if (
      label === 0xff &&
      bytes[start] === 11 &&
      bytesAt(bytes, start + 1, XMP_APP)
    ) {
      const packetStart = start + 12
      const trailer = indexOfBytes(bytes, XMP_TRAILER, packetStart)
      if (trailer >= 0 && blocks.xmp === undefined) {
        blocks.xmp = trimNul(utf8Decode(bytes.subarray(packetStart, trailer)))
      }
      // The trailer makes the sub-block walk land on the terminator.
      offset = subBlocks(bytes, start, false).end
      if (
        offset < 0 &&
        trailer >= 0 &&
        trailer + XMP_TRAILER_LENGTH <= bytes.length
      ) {
        offset = trailer + XMP_TRAILER_LENGTH
      }
    } else if (
      label === 0xff &&
      bytes[start] === 11 &&
      bytesAt(bytes, start + 1, ICC_APP)
    ) {
      const { end, data } = subBlocks(bytes, start + 12, true)
      if (end > 0 && data.length && !blocks.icc) blocks.icc = data
      offset = end
    } else {
      offset = subBlocks(bytes, start, false).end
    }
    if (offset < 0) break
  }
  if (comments.length) blocks.comments = comments
  return blocks
}
