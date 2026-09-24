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
 * WebP metadata blocks: the `EXIF`, `XMP ` and `ICCP` chunks, read and
 * rewritten without touching the image (AGL-3331).
 *
 * A WebP is a RIFF file (RFC 9649, section 2): `RIFF`, a little-endian
 * size, `WEBP`, then chunks of a FourCC, a little-endian size and the data,
 * padded with one zero byte to an even length. A simple file holds a single
 * `VP8 ` (lossy) or `VP8L` (lossless) chunk; metadata needs the extended
 * format (2.7), which opens with a `VP8X` chunk whose flags announce the
 * optional chunks, in this order:
 *
 *   VP8X, ICCP, ANIM, (ALPH + VP8 | VP8L | ANMF…), EXIF, XMP
 *
 * The writer rebuilds only the `EXIF` and `XMP ` chunks and the `VP8X`
 * flags byte; every image, frame, alpha and unknown chunk is copied byte for
 * byte. Adding metadata to a simple file converts it to the extended format
 * by prepending a `VP8X` whose canvas is read from the bitstream header —
 * the image chunk itself is unchanged.
 */

import { EmbeddedWriteError } from './types'
import {
  FILE_DAMAGED,
  METADATA_TOO_LARGE,
  asciiBytes,
  bytesAt,
  concatBytes,
  readAscii,
  readU16LE,
  readU32LE,
  trimNul,
  utf8Decode,
  utf8Encode,
  writeU32LE,
  type ImageBlockUpdate,
  type ImageBlocks,
} from './image-blocks'

const RIFF = asciiBytes('RIFF')
const WEBP = asciiBytes('WEBP')
const EXIF_HEADER = asciiBytes('Exif\0\0')

/** VP8X flag bits (RFC 9649, 2.7): ICC, alpha, EXIF, XMP, animation. */
const FLAG_ICC = 0x20
const FLAG_ALPHA = 0x10
const FLAG_EXIF = 0x08
const FLAG_XMP = 0x04

/** A RIFF size field is 32 bits; the file tops out at 2^32 − 2 bytes. */
const MAX_RIFF_SIZE = 0xfffffffe - 8
/** Chunk count past which a file is not an image; the walk stops. */
const MAX_CHUNKS = 1 << 20

/** Chunks that make up the image, after which EXIF and XMP belong. */
const IMAGE_CHUNKS = new Set([
  'VP8X',
  'ICCP',
  'ANIM',
  'ANMF',
  'ALPH',
  'VP8 ',
  'VP8L',
])

interface RiffChunk {
  fourcc: string
  start: number
  dataStart: number
  size: number
  /** One past the data and its pad byte (clamped to the RIFF payload). */
  end: number
}

interface WebpLayout {
  chunks: RiffChunk[]
  /** One past the RIFF payload the header declares, clamped to the file. */
  riffEnd: number
  /** False when a chunk runs past the RIFF payload or the file. */
  complete: boolean
}

/** Walks the RIFF chunks. `null` when the bytes are not `RIFF….WEBP`. */
function walkWebp(bytes: Uint8Array): WebpLayout | null {
  if (!bytesAt(bytes, 0, RIFF) || !bytesAt(bytes, 8, WEBP)) return null
  const declared = 8 + readU32LE(bytes, 4)
  const riffEnd = Math.min(declared, bytes.length)
  const chunks: RiffChunk[] = []
  let offset = 12
  let complete = declared <= bytes.length
  while (offset + 8 <= riffEnd && chunks.length < MAX_CHUNKS) {
    const size = readU32LE(bytes, offset + 4)
    const dataEnd = offset + 8 + size
    if (dataEnd > riffEnd) {
      complete = false
      break
    }
    const end = Math.min(dataEnd + (size & 1), riffEnd)
    chunks.push({
      fourcc: readAscii(bytes, offset, 4),
      start: offset,
      dataStart: offset + 8,
      size,
      end,
    })
    offset = end
  }
  // Bytes left inside the RIFF payload that are not a whole chunk.
  if (offset < riffEnd) complete = false
  return { chunks, riffEnd, complete }
}

/** Strips the `Exif\0\0` prefix some writers put in front of the TIFF bytes. */
function bareTiff(exif: Uint8Array): Uint8Array {
  return bytesAt(exif, 0, EXIF_HEADER)
    ? exif.subarray(EXIF_HEADER.length)
    : exif
}

/**
 * Reads the metadata blocks of a WebP. Returns `null` when the bytes are not
 * a WebP; a damaged file yields what came before the damage.
 */
export function readWebpBlocks(bytes: Uint8Array): ImageBlocks | null {
  const layout = walkWebp(bytes)
  if (!layout) return null
  const blocks: ImageBlocks = {}
  for (const chunk of layout.chunks) {
    const data = bytes.subarray(chunk.dataStart, chunk.dataStart + chunk.size)
    if (chunk.fourcc === 'EXIF' && !blocks.exif)
      blocks.exif = bareTiff(data).slice()
    if (chunk.fourcc === 'XMP ' && blocks.xmp === undefined) {
      blocks.xmp = trimNul(utf8Decode(data))
    }
    if (chunk.fourcc === 'ICCP' && !blocks.icc) blocks.icc = data.slice()
  }
  return blocks
}

/** Builds a chunk: FourCC, little-endian size, data, and the pad byte. */
function buildChunk(fourcc: string, data: Uint8Array): Uint8Array {
  if (data.length > MAX_RIFF_SIZE)
    throw new EmbeddedWriteError(METADATA_TOO_LARGE)
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(asciiBytes(fourcc), 0)
  writeU32LE(out, 4, data.length)
  out.set(data, 8)
  return out
}

/**
 * The canvas size and alpha of a simple file's image chunk, for the `VP8X`
 * a conversion adds, or `null` when the bitstream header is unreadable.
 *
 * - `VP8 `: a 3-byte frame tag whose low bit is 0 on a key frame, the start
 *   code `9D 01 2A`, then 14-bit width and height (RFC 6386, 9.1).
 * - `VP8L`: the signature `0x2F`, then 14 bits of width − 1, 14 of
 *   height − 1 and the alpha hint (RFC 9649, section 3, the lossless header).
 */
function simpleCanvas(
  bytes: Uint8Array,
  chunk: RiffChunk,
): { width: number; height: number; alpha: boolean } | null {
  const data = bytes.subarray(chunk.dataStart, chunk.dataStart + chunk.size)
  if (chunk.fourcc === 'VP8 ') {
    if (data.length < 10 || (data[0] ?? 1) & 1) return null
    if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null
    const width = readU16LE(data, 6) & 0x3fff
    const height = readU16LE(data, 8) & 0x3fff
    return width && height ? { width, height, alpha: false } : null
  }
  if (chunk.fourcc === 'VP8L') {
    if (data.length < 5 || data[0] !== 0x2f) return null
    const bits = readU32LE(data, 1)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: ((bits >>> 28) & 1) === 1,
    }
  }
  return null
}

/** A `VP8X` chunk (RFC 9649, 2.7): flags, 3 reserved bytes, canvas − 1. */
function vp8xChunk(flags: number, width: number, height: number): Uint8Array {
  const data = new Uint8Array(10)
  data[0] = flags
  data[4] = (width - 1) & 0xff
  data[5] = ((width - 1) >>> 8) & 0xff
  data[6] = ((width - 1) >>> 16) & 0xff
  data[7] = (height - 1) & 0xff
  data[8] = ((height - 1) >>> 8) & 0xff
  data[9] = ((height - 1) >>> 16) & 0xff
  return buildChunk('VP8X', data)
}

interface Piece {
  fourcc: string
  bytes: Uint8Array
}

/**
 * Writes an update into a WebP and returns the new file.
 *
 * An existing `EXIF` or `XMP ` chunk is replaced in place (later duplicates
 * removed); a new one goes after the image — EXIF before any existing XMP,
 * XMP after EXIF — as the extended format orders them. `null` removes every
 * copy. The `VP8X` EXIF and XMP flags are set to match what the file then
 * holds; ICC, alpha and animation flags are left as they were.
 *
 * Throws `EmbeddedWriteError` for a file that is not a WebP or is truncated,
 * for a layout that is neither simple nor extended, for a simple file whose
 * bitstream header cannot give the canvas size a conversion needs, and for
 * an IRB or PNG text update.
 */
export function writeWebpBlocks(
  bytes: Uint8Array,
  update: ImageBlockUpdate,
): Uint8Array {
  const layout = walkWebp(bytes)
  if (!layout) throw new EmbeddedWriteError('This file is not a WebP image.')
  if (!layout.complete) throw new EmbeddedWriteError(FILE_DAMAGED)
  if (update.irb?.length) {
    throw new EmbeddedWriteError(
      'A WebP has no place for Photoshop or IPTC metadata.',
    )
  }
  if (
    update.pngText &&
    Object.values(update.pngText).some((value) => value !== null)
  ) {
    throw new EmbeddedWriteError(
      'PNG text fields can only be written to a PNG.',
    )
  }

  const first = layout.chunks[0]
  const extended = first?.fourcc === 'VP8X'
  if (
    !first ||
    (!extended && first.fourcc !== 'VP8 ' && first.fourcc !== 'VP8L')
  ) {
    throw new EmbeddedWriteError(FILE_DAMAGED)
  }

  const pieces: Piece[] = layout.chunks.map((chunk) => {
    const expected = 8 + chunk.size + (chunk.size & 1)
    const original = bytes.subarray(chunk.start, chunk.end)
    // A last chunk missing its pad byte gets one, or anything after it
    // would start on an odd offset.
    const padded =
      original.length < expected
        ? concatBytes([original, new Uint8Array(1)])
        : original
    return { fourcc: chunk.fourcc, bytes: padded }
  })

  const lastImage = () => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      if (IMAGE_CHUNKS.has(pieces[i]?.fourcc ?? '')) return i + 1
    }
    return pieces.length
  }
  const indexOf = (fourcc: string) =>
    pieces.findIndex((p) => p.fourcc === fourcc)

  const place = (
    fourcc: string,
    data: Uint8Array | null,
    anchor: () => number,
  ) => {
    const chunk = data && data.length ? buildChunk(fourcc, data) : null
    const at = indexOf(fourcc)
    for (let i = pieces.length - 1; i > at; i -= 1) {
      if (pieces[i]?.fourcc === fourcc) pieces.splice(i, 1)
    }
    const existing = pieces[at]
    if (existing && chunk) existing.bytes = chunk
    else if (existing) pieces.splice(at, 1)
    else if (chunk) pieces.splice(anchor(), 0, { fourcc, bytes: chunk })
  }

  if (update.exif !== undefined) {
    place('EXIF', update.exif && bareTiff(update.exif), () => {
      const xmp = indexOf('XMP ')
      return xmp >= lastImage() ? xmp : lastImage()
    })
  }
  if (update.xmp !== undefined) {
    place('XMP ', update.xmp ? utf8Encode(update.xmp) : null, () => {
      const exif = indexOf('EXIF')
      return exif >= 0 ? Math.max(exif + 1, lastImage()) : lastImage()
    })
  }

  const hasExif = indexOf('EXIF') >= 0
  const hasXmp = indexOf('XMP ') >= 0
  const vp8x = pieces[0]
  if (extended && vp8x) {
    const chunk = vp8x.bytes.slice()
    let flags = chunk[8] ?? 0
    flags = hasExif ? flags | FLAG_EXIF : flags & ~FLAG_EXIF
    flags = hasXmp ? flags | FLAG_XMP : flags & ~FLAG_XMP
    chunk[8] = flags
    vp8x.bytes = chunk
  } else if (hasExif || hasXmp) {
    const canvas = simpleCanvas(bytes, first)
    if (!canvas) throw new EmbeddedWriteError(FILE_DAMAGED)
    let flags = (hasExif ? FLAG_EXIF : 0) | (hasXmp ? FLAG_XMP : 0)
    if (canvas.alpha) flags |= FLAG_ALPHA
    if (indexOf('ICCP') >= 0) flags |= FLAG_ICC
    pieces.unshift({
      fourcc: 'VP8X',
      bytes: vp8xChunk(flags, canvas.width, canvas.height),
    })
  }

  const body = concatBytes(pieces.map((piece) => piece.bytes))
  if (body.length + 4 > MAX_RIFF_SIZE)
    throw new EmbeddedWriteError(METADATA_TOO_LARGE)
  const header = new Uint8Array(12)
  header.set(RIFF, 0)
  writeU32LE(header, 4, body.length + 4)
  header.set(WEBP, 8)
  return concatBytes([header, body, bytes.subarray(layout.riffEnd)])
}
