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
 * TIFF image files, `image/tiff` (AGL-3331).
 *
 * A TIFF file IS the TIFF structure EXIF borrows, so `readExif(bytes)`
 * reads its EXIF directly and this module only finds the other two blocks,
 * which live as IFD0 tags:
 *
 * - 700 XMP (XMP Specification Part 3 §1.1.4): the packet, as BYTE, UTF-8.
 * - 33723 IPTC-NAA: the raw IIM stream, typed LONG by Photoshop and
 *   UNDEFINED by ImageMagick, padded to a multiple of four.
 * - 34377 Photoshop: an image resource block, which in a file from
 *   Photoshop carries a second copy of the IIM (0x0404) and its digest.
 *
 * Writing goes through `editTiff` with `allowAdd`, so XMP can be added to a
 * file that has none. Strip and tile offsets are absolute and nothing
 * before the old end of the file moves, so the pixels come through
 * byte-identical; the only bytes that change are IFD entries, the old slot
 * of a replaced value, and a relocated IFD0's old table (zeroed).
 */

import {
  TIFF_TYPE,
  editTiff,
  isTiff,
  readTiffTagBytes,
  type TiffTagWrite,
} from './exif'
import { irbIim, replaceIrbIim, trimIimPadding } from './iptc'
import { EmbeddedWriteError, type EmbeddedPatch } from './types'

const XMP_TAG = 700
const IPTC_TAG = 33723
const PHOTOSHOP_TAG = 34377

const utf8Lenient = new TextDecoder('utf-8')

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
const encoder = new TextEncoder()

function decodeXmp(bytes: Uint8Array): string | null {
  // TextDecoder drops a leading BOM by default (WHATWG Encoding §7.2).
  const text = utf8Lenient.decode(bytes)
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0) end--
  const packet = text.slice(0, end)
  return packet.trim() ? packet : null
}

/**
 * The XMP packet and the IPTC of a TIFF file, or null when the bytes are
 * not a TIFF. `iim` is the stream without the tag's zero padding, and falls
 * back to the copy inside the Photoshop resource block when tag 33723 is
 * absent. Never throws.
 */
export function readTiffFile(bytes: Uint8Array): {
  xmp: string | null
  iim: Uint8Array | null
  irb: Uint8Array | null
} | null {
  if (!isTiff(bytes)) return null
  const xmp = readTiffTagBytes(bytes, 'ifd0', XMP_TAG)
  const iim = readTiffTagBytes(bytes, 'ifd0', IPTC_TAG)
  const irb = readTiffTagBytes(bytes, 'ifd0', PHOTOSHOP_TAG)
  const irbCopy = irb ? irb.bytes.slice() : null
  return {
    xmp: xmp ? decodeXmp(xmp.bytes) : null,
    iim: iim
      ? trimIimPadding(iim.bytes).slice()
      : irbCopy
        ? (irbIim(irbCopy)?.slice() ?? null)
        : null,
    irb: irbCopy,
  }
}

/**
 * Tag 33723. An existing tag keeps its own type. A new one is UNDEFINED:
 * a LONG-typed IIM in a big-endian file is byte-swapped by ImageMagick
 * 7.1 (libtiff 4.7) and lost, while UNDEFINED reads back in either order
 * (checked for AGL-3331). The stream is padded to a multiple of four, as
 * Photoshop and ImageMagick write it, so a reader that counts the tag in
 * LONGs still sees all of it.
 */
function iimWrite(
  current: { type: number } | null,
  iim: Uint8Array | null,
): TiffTagWrite {
  const write = { ifd: 'ifd0' as const, tag: IPTC_TAG }
  if (!iim) return { ...write, type: TIFF_TYPE.UNDEFINED, value: null }
  const kept: number[] = [TIFF_TYPE.BYTE, TIFF_TYPE.UNDEFINED, TIFF_TYPE.LONG]
  const type =
    current && kept.includes(current.type) ? current.type : TIFF_TYPE.UNDEFINED
  const padded = new Uint8Array(Math.ceil(iim.length / 4) * 4)
  padded.set(iim)
  return { ...write, type, value: padded }
}

/**
 * Write edits into a TIFF file: `exifPatch` to its EXIF tags (existing
 * tags only, as `writeExif`), `xmp` to tag 700 and `iim` to tag 33723 —
 * each added when missing and removed by `null`. When the Photoshop
 * resource block (34377) also holds the IIM, that copy and its digest are
 * kept in step, so no reader is left to prefer a stale one.
 */
export function writeTiffFile(
  bytes: Uint8Array,
  update: {
    exifPatch?: EmbeddedPatch
    xmp?: string | null
    iim?: Uint8Array | null
  },
): Uint8Array {
  if (!isTiff(bytes)) {
    throw new EmbeddedWriteError('This file is not a TIFF image.')
  }
  const writes: TiffTagWrite[] = []
  const currentXmp = readTiffTagBytes(bytes, 'ifd0', XMP_TAG)
  // The packet already there, NUL padding aside, is not rewritten.
  const sameXmp =
    currentXmp !== null &&
    update.xmp !== undefined &&
    decodeXmp(currentXmp.bytes) === (update.xmp?.trim() ? update.xmp : null)
  if (update.xmp !== undefined && !sameXmp) {
    const current = currentXmp
    writes.push({
      ifd: 'ifd0',
      tag: XMP_TAG,
      type:
        current?.type === TIFF_TYPE.UNDEFINED
          ? TIFF_TYPE.UNDEFINED
          : TIFF_TYPE.BYTE,
      value: update.xmp?.trim() ? encoder.encode(update.xmp) : null,
    })
  }
  if (update.iim !== undefined) {
    const iim = update.iim?.length ? trimIimPadding(update.iim) : null
    const current = readTiffTagBytes(bytes, 'ifd0', IPTC_TAG)
    // The stream already there, padding aside, is not rewritten.
    const sameIim =
      current !== null &&
      iim !== null &&
      sameBytes(trimIimPadding(current.bytes), iim)
    const irb = readTiffTagBytes(bytes, 'ifd0', PHOTOSHOP_TAG)
    const irbHoldsIim = irb ? irbIim(irb.bytes) !== null : false
    // 33723 is the TIFF home of IPTC; a file that keeps it only in the
    // resource block has it updated there and nowhere else.
    if ((current || !irbHoldsIim) && !sameIim) {
      writes.push(iimWrite(current, iim))
    }
    if (irb && irbHoldsIim) {
      writes.push({
        ifd: 'ifd0',
        tag: PHOTOSHOP_TAG,
        type:
          irb.type === TIFF_TYPE.UNDEFINED
            ? TIFF_TYPE.UNDEFINED
            : TIFF_TYPE.BYTE,
        value: replaceIrbIim(irb.bytes, iim),
      })
    }
  }
  return editTiff(bytes, { patch: update.exifPatch, writes, allowAdd: true })
}
