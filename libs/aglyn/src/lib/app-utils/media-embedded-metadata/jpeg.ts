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
 * JPEG metadata blocks: find them, and replace them without touching a
 * single byte of the image (AGL-3331).
 *
 * A JPEG is a run of marker segments (ITU-T T.81, B.1.1.4): `0xFF`, a marker
 * code, and — for every marker but the standalone ones — a 16-bit length that
 * counts itself. Metadata lives in the APPn and COM segments of the header,
 * all of which precede the first Start of Scan. The walk here stops at that
 * SOS and never looks further: everything from SOS to EOI, and anything after
 * EOI (an MPF preview, a motion photo's video), is copied through verbatim,
 * which is the whole of the lossless guarantee.
 *
 * The blocks, by their identifying prefix:
 *
 * - APP1 `Exif\0\0` — EXIF (Exif 2.32, 4.5.4).
 * - APP1 `http://ns.adobe.com/xap/1.0/\0` — the main XMP packet
 *   (XMP Specification Part 3, 1.1.3).
 * - APP1 `http://ns.adobe.com/xmp/extension/\0` — extended XMP. Read by
 *   nobody here and never rewritten; its segments pass through untouched.
 * - APP13 `Photoshop 3.0\0` — Photoshop Image Resource Blocks, which carry
 *   the IPTC-IIM record. Photoshop splits a large one across consecutive
 *   APP13 segments, each repeating the header.
 * - APP2 `ICC_PROFILE\0` — the ICC profile, in numbered chunks
 *   (ICC.1:2010, Annex B.4). Read-only.
 * - COM — free-text comments (T.81, B.2.4.5). Read-only.
 */

import { EmbeddedWriteError } from './types'
import {
  FILE_DAMAGED,
  METADATA_TOO_LARGE,
  asciiBytes,
  bytesAt,
  concatBytes,
  decodeFreeText,
  readU16BE,
  readU32BE,
  trimNul,
  utf8Decode,
  utf8Encode,
  writeU16BE,
  writeU32BE,
  type ImageBlockUpdate,
  type ImageBlocks,
} from './image-blocks'

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const APP0 = 0xe0
const APP1 = 0xe1
const APP2 = 0xe2
const APP13 = 0xed
const COM = 0xfe

/** `Exif\0` — the sixth byte is `\0` by the standard and ignored here. */
const EXIF_ID = asciiBytes('Exif\0')
const EXIF_HEADER = asciiBytes('Exif\0\0')
const XMP_ID = asciiBytes('http://ns.adobe.com/xap/1.0/\0')
const XMP_EXTENSION_ID = asciiBytes('http://ns.adobe.com/xmp/extension/\0')
const PHOTOSHOP_ID = asciiBytes('Photoshop 3.0\0')
const ICC_ID = asciiBytes('ICC_PROFILE\0')
const MPF_ID = asciiBytes('MPF\0')

/** A segment's length field counts itself, so its payload tops out here. */
const MAX_SEGMENT_PAYLOAD = 0xffff - 2
/** `Exif\0\0` plus the TIFF structure must fit one APP1 (65535 − 2 − 6). */
const MAX_EXIF_BYTES = MAX_SEGMENT_PAYLOAD - EXIF_HEADER.length
/**
 * The standard XMP packet's ceiling (XMP Specification Part 3, 1.1.3.1).
 * Anything larger belongs in extended XMP, which this writer does not
 * produce, so a larger packet is refused rather than truncated.
 */
const MAX_XMP_BYTES = 65502
/** Per-APP13 IRB payload once `Photoshop 3.0\0` is paid for (65535 − 16). */
const MAX_IRB_CHUNK = MAX_SEGMENT_PAYLOAD - PHOTOSHOP_ID.length

/**
 * A header past this many segments is not a photo; the walk stops and
 * returns what it read. Real files carry tens — a 4 MB ICC profile split
 * into 64 KB chunks is still under a hundred.
 */
const MAX_SEGMENTS = 20000

/** MPF's `MPEntry` tag (CIPA DC-007, 5.2.3.3). */
const MPF_MP_ENTRY_TAG = 0xb002

/** One marker segment in the header, as byte offsets into the file. */
interface JpegSegment {
  /**
   * Where this segment's run begins: fill bytes (`0xFF` padding, T.81
   * B.1.1.2) and any stray bytes a lenient decoder skips come before the
   * marker and belong to it. They are copied through even when the segment
   * itself is replaced or removed.
   */
  start: number
  /** The `0xFF` that introduces the marker code. */
  marker: number
  code: number
  /** First payload byte, after the length field. */
  dataStart: number
  /** One past the last byte. */
  end: number
}

interface JpegLayout {
  segments: JpegSegment[]
  /** Where the verbatim tail begins: the run holding SOS, or EOI. */
  tailStart: number
  /**
   * False when the header ran out — truncated, a length pointing past the
   * end, or more segments than any photo has. Reads still return what they
   * found; writes refuse.
   */
  complete: boolean
}

/**
 * Markers that carry no length field (T.81, B.1.1.3 and Table B.1): TEM and
 * RST0–RST7, plus a stray repeated SOI.
 */
function isStandalone(code: number): boolean {
  return code === 0x01 || (code >= 0xd0 && code <= 0xd8)
}

/**
 * Walks the header's marker segments up to SOS (or EOI). Returns `null` when
 * the bytes do not open with SOI.
 *
 * Between segments it behaves like libjpeg's `next_marker`: bytes that are
 * not `0xFF` are skipped, a run of `0xFF` is fill, and `0xFF 0x00` is not a
 * marker. Every step moves forward, so the loop ends on any input.
 */
function walkJpeg(bytes: Uint8Array): JpegLayout | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) return null
  const segments: JpegSegment[] = []
  let offset = 2
  while (segments.length < MAX_SEGMENTS) {
    const start = offset
    let marker = -1
    let code = -1
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      let next = offset + 1
      while (next < bytes.length && bytes[next] === 0xff) next += 1
      // Only fill bytes up to the end: no marker, so the header is cut.
      if (next >= bytes.length) break
      const candidate = bytes[next] ?? 0
      if (candidate === 0x00) {
        offset = next + 1
        continue
      }
      marker = next - 1
      code = candidate
      break
    }
    if (code < 0) return { segments, tailStart: start, complete: false }
    if (code === SOS || code === EOI) {
      return { segments, tailStart: start, complete: true }
    }
    if (isStandalone(code)) {
      segments.push({
        start,
        marker,
        code,
        dataStart: marker + 2,
        end: marker + 2,
      })
      offset = marker + 2
      continue
    }
    if (marker + 4 > bytes.length) {
      return { segments, tailStart: start, complete: false }
    }
    const length = readU16BE(bytes, marker + 2)
    const end = marker + 2 + length
    if (length < 2 || end > bytes.length) {
      return { segments, tailStart: start, complete: false }
    }
    segments.push({ start, marker, code, dataStart: marker + 4, end })
    offset = end
  }
  return { segments, tailStart: offset, complete: false }
}

type BlockKind = 'exif' | 'xmp' | 'xmpExtension' | 'irb' | 'icc' | 'mpf' | 'com'

/** Which metadata block a segment is, by its marker and identifying prefix. */
function classify(bytes: Uint8Array, segment: JpegSegment): BlockKind | null {
  const { code, dataStart, end } = segment
  const has = (id: Uint8Array) =>
    end - dataStart >= id.length && bytesAt(bytes, dataStart, id)
  if (code === APP1) {
    if (end - dataStart >= EXIF_HEADER.length && has(EXIF_ID)) return 'exif'
    if (has(XMP_ID)) return 'xmp'
    if (has(XMP_EXTENSION_ID)) return 'xmpExtension'
    return null
  }
  if (code === APP13) return has(PHOTOSHOP_ID) ? 'irb' : null
  if (code === APP2) {
    if (end - dataStart >= ICC_ID.length + 2 && has(ICC_ID)) return 'icc'
    if (has(MPF_ID)) return 'mpf'
    return null
  }
  if (code === COM) return 'com'
  return null
}

/**
 * Reassembles the ICC profile from its APP2 chunks (ICC.1:2010, B.4): each
 * carries a 1-based sequence number and the chunk count. A set with a gap,
 * a duplicate or disagreeing counts is dropped — half a profile is worse
 * than none — except that a lone chunk is taken as the whole profile.
 */
function assembleIcc(
  chunks: { seq: number; count: number; data: Uint8Array }[],
): Uint8Array | undefined {
  const first = chunks[0]
  if (!first) return undefined
  if (chunks.length === 1) return first.data.slice()
  const count = first.count
  if (count !== chunks.length) return undefined
  const ordered: Uint8Array[] = new Array(count)
  for (const chunk of chunks) {
    if (chunk.count !== count || chunk.seq < 1 || chunk.seq > count) {
      return undefined
    }
    if (ordered[chunk.seq - 1]) return undefined
    ordered[chunk.seq - 1] = chunk.data
  }
  return concatBytes(ordered)
}

/**
 * Reads the metadata blocks of a JPEG. Returns `null` when the bytes are not
 * a JPEG (no SOI); a damaged or truncated header yields whatever blocks came
 * before the damage.
 *
 * The first EXIF and first main-XMP segment win, as every reader does; all
 * Photoshop APP13 payloads are concatenated in file order.
 */
export function readJpegBlocks(bytes: Uint8Array): ImageBlocks | null {
  const layout = walkJpeg(bytes)
  if (!layout) return null
  const blocks: ImageBlocks = {}
  const irbParts: Uint8Array[] = []
  const iccChunks: { seq: number; count: number; data: Uint8Array }[] = []
  const comments: string[] = []
  for (const segment of layout.segments) {
    const { dataStart, end } = segment
    switch (classify(bytes, segment)) {
      case 'exif':
        if (!blocks.exif) {
          blocks.exif = bytes.slice(dataStart + EXIF_HEADER.length, end)
        }
        break
      case 'xmp':
        if (blocks.xmp === undefined) {
          blocks.xmp = trimNul(
            utf8Decode(bytes.subarray(dataStart + XMP_ID.length, end)),
          )
        }
        break
      case 'irb':
        irbParts.push(bytes.subarray(dataStart + PHOTOSHOP_ID.length, end))
        break
      case 'icc':
        iccChunks.push({
          seq: bytes[dataStart + ICC_ID.length] ?? 0,
          count: bytes[dataStart + ICC_ID.length + 1] ?? 0,
          data: bytes.subarray(dataStart + ICC_ID.length + 2, end),
        })
        break
      case 'com':
        comments.push(trimNul(decodeFreeText(bytes.subarray(dataStart, end))))
        break
      default:
        break
    }
  }
  if (irbParts.length) blocks.irb = concatBytes(irbParts)
  const icc = assembleIcc(iccChunks)
  if (icc) blocks.icc = icc
  if (comments.length) blocks.comments = comments
  return blocks
}

/** Builds one marker segment: marker, length, identifier, payload. */
function buildSegment(
  code: number,
  id: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const length = 2 + id.length + payload.length
  const out = new Uint8Array(2 + length)
  out[0] = 0xff
  out[1] = code
  writeU16BE(out, 2, length)
  out.set(id, 4)
  out.set(payload, 4 + id.length)
  return out
}

/** The EXIF APP1 to write, or `null` to remove it. */
function exifSegment(exif: Uint8Array | null): Uint8Array | null {
  if (!exif || !exif.length) return null
  // The contract hands over TIFF bytes; a caller that left the APP1 prefix
  // on would otherwise write it twice.
  const tiff =
    exif.length >= EXIF_HEADER.length && bytesAt(exif, 0, EXIF_ID)
      ? exif.subarray(EXIF_HEADER.length)
      : exif
  if (tiff.length > MAX_EXIF_BYTES) {
    throw new EmbeddedWriteError(METADATA_TOO_LARGE)
  }
  return buildSegment(APP1, EXIF_HEADER, tiff)
}

/** The main XMP APP1 to write, or `null` to remove it. */
function xmpSegment(xmp: string | null): Uint8Array | null {
  if (!xmp) return null
  const packet = utf8Encode(xmp)
  if (packet.length > MAX_XMP_BYTES) {
    throw new EmbeddedWriteError(METADATA_TOO_LARGE)
  }
  return buildSegment(APP1, XMP_ID, packet)
}

/**
 * The APP13 segments to write, or `null` to remove them. An IRB larger than
 * one segment is split at the 64 KB boundary into consecutive segments, each
 * repeating `Photoshop 3.0\0`, as Photoshop itself writes them; readers
 * (this one included) concatenate the payloads back.
 */
function irbSegments(irb: Uint8Array | null): Uint8Array[] | null {
  if (!irb || !irb.length) return null
  const out: Uint8Array[] = []
  for (let offset = 0; offset < irb.length; offset += MAX_IRB_CHUNK) {
    out.push(
      buildSegment(
        APP13,
        PHOTOSHOP_ID,
        irb.subarray(offset, offset + MAX_IRB_CHUNK),
      ),
    )
  }
  return out
}

/**
 * One unit of the rewritten header. An original segment keeps its fill
 * prefix whatever happens to its body; an inserted one has no prefix.
 */
interface Piece {
  prefix: Uint8Array
  /** What is written after the prefix — the original, a replacement, or nothing. */
  body: Uint8Array
  kind: BlockKind | null
  /** The original segment, for pieces that came from the file. */
  segment?: JpegSegment
}

/**
 * Applies one block's update to the piece list: replace the first piece of
 * `kind` and drop the rest (a second copy is a stale one the next reader
 * may prefer), insert at `anchor()` when there is none, or remove them all.
 */
function applyBlock(
  pieces: Piece[],
  kind: BlockKind,
  replacement: Uint8Array | null | undefined,
  anchor: () => number,
): void {
  if (replacement === undefined) return
  let replaced = false
  for (const piece of pieces) {
    if (piece.kind !== kind) continue
    if (replacement && !replaced) {
      piece.body = replacement
      replaced = true
    } else {
      piece.body = new Uint8Array(0)
      piece.kind = null
    }
  }
  if (replacement && !replaced) {
    pieces.splice(anchor(), 0, {
      prefix: new Uint8Array(0),
      body: replacement,
      kind,
    })
  }
}

/**
 * Shifts the MP Entry offsets of an MPF segment (CIPA DC-007, 5.2.3.3) by
 * `delta`. MPF locates the secondary images after EOI — a camera's large
 * preview, an Ultra HDR gain map — by offsets from its own TIFF header, so a
 * resized segment between that header and the images would leave them
 * pointing into the wrong bytes. Returns the patched payload, or `null` when
 * the structure cannot be followed.
 */
function shiftMpfOffsets(
  segment: Uint8Array,
  delta: number,
): Uint8Array | null {
  const out = segment.slice()
  // Marker (2) + length (2) + `MPF\0` (4); the TIFF header starts here.
  const tiff = 8
  const little = out[tiff] === 0x49 && out[tiff + 1] === 0x49
  const big = out[tiff] === 0x4d && out[tiff + 1] === 0x4d
  if (!little && !big) return null
  const u16 = (at: number) =>
    little ? (out[at] ?? 0) | ((out[at + 1] ?? 0) << 8) : readU16BE(out, at)
  const u32 = (at: number) =>
    little
      ? ((out[at] ?? 0) |
          ((out[at + 1] ?? 0) << 8) |
          ((out[at + 2] ?? 0) << 16)) +
        (out[at + 3] ?? 0) * 0x1000000
      : readU32BE(out, at)
  const put32 = (at: number, value: number) => {
    if (little) {
      out[at] = value & 0xff
      out[at + 1] = (value >>> 8) & 0xff
      out[at + 2] = (value >>> 16) & 0xff
      out[at + 3] = (value >>> 24) & 0xff
    } else {
      writeU32BE(out, at, value)
    }
  }
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > out.length) return null
  const count = u16(ifd)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > out.length) return null
    if (u16(entry) !== MPF_MP_ENTRY_TAG) continue
    // Type UNDEFINED, so the count is the table's size in bytes.
    if (u16(entry + 2) !== 7) return null
    const size = u32(entry + 4)
    const table = size > 4 ? tiff + u32(entry + 8) : entry + 8
    if (size % 16 !== 0 || table + size > out.length) return null
    for (let at = table; at < table + size; at += 16) {
      const offset = u32(at + 8)
      // Offset 0 is the primary image itself (5.2.3.3.3).
      if (offset === 0) continue
      const moved = offset + delta
      if (moved <= 0 || moved > 0xffffffff) return null
      put32(at + 8, moved)
    }
    return out
  }
  return out
}

/**
 * Writes an update into a JPEG and returns the new file. Only the header's
 * metadata segments change; every other segment and the whole of SOS→EOI
 * and beyond are copied byte for byte.
 *
 * - A block that exists is replaced in place (and any later duplicates of
 *   it removed); `null` removes every copy.
 * - A new block goes to its standard position: EXIF right after SOI and a
 *   leading APP0 JFIF/JFXX run, XMP after EXIF, APP13 after XMP.
 * - Extended XMP, ICC, COM and every other segment are never touched.
 *
 * Throws `EmbeddedWriteError` for a file that is not a JPEG or whose header
 * is truncated, for a block too large for its segment (EXIF over 65527
 * bytes, XMP over 65502), for an MPF index it cannot keep pointing at the
 * right bytes, and for a PNG text update.
 */
export function writeJpegBlocks(
  bytes: Uint8Array,
  update: ImageBlockUpdate,
): Uint8Array {
  const layout = walkJpeg(bytes)
  if (!layout) throw new EmbeddedWriteError('This file is not a JPEG image.')
  if (!layout.complete) throw new EmbeddedWriteError(FILE_DAMAGED)
  if (
    update.pngText &&
    Object.values(update.pngText).some((value) => value !== null)
  ) {
    throw new EmbeddedWriteError(
      'PNG text fields can only be written to a PNG.',
    )
  }

  const exif = update.exif === undefined ? undefined : exifSegment(update.exif)
  const xmp = update.xmp === undefined ? undefined : xmpSegment(update.xmp)
  const irb = update.irb === undefined ? undefined : irbSegments(update.irb)

  const pieces: Piece[] = layout.segments.map((segment) => ({
    prefix: bytes.subarray(segment.start, segment.marker),
    body: bytes.subarray(segment.marker, segment.end),
    kind: classify(bytes, segment),
    segment,
  }))

  const afterJfif = () => {
    let index = 0
    while (pieces[index]?.segment?.code === APP0) index += 1
    return index
  }
  const after = (kind: BlockKind, fallback: () => number) => () => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      if (pieces[i]?.kind === kind) return i + 1
    }
    return fallback()
  }

  const afterExif = after('exif', afterJfif)
  applyBlock(pieces, 'exif', exif, afterJfif)
  applyBlock(pieces, 'xmp', xmp, afterExif)
  applyBlock(
    pieces,
    'irb',
    irb === undefined ? undefined : irb && concatBytes(irb),
    after('xmp', afterExif),
  )

  // Only a size change BETWEEN the MPF segment and the images after EOI moves
  // them relative to it; a change before MPF shifts both alike.
  const mpfIndex = pieces.findIndex((piece) => piece.kind === 'mpf')
  const mpf = pieces[mpfIndex]
  if (mpf?.segment) {
    const oldSpan = layout.tailStart - mpf.segment.end
    let newSpan = 0
    for (const piece of pieces.slice(mpfIndex + 1)) {
      newSpan += piece.prefix.length + piece.body.length
    }
    const delta = newSpan - oldSpan
    if (delta !== 0) {
      const patched = shiftMpfOffsets(mpf.body, delta)
      if (!patched) {
        throw new EmbeddedWriteError(
          "This photo's index of its embedded preview images could not be updated, so its metadata cannot be edited safely.",
        )
      }
      mpf.body = patched
    }
  }

  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  for (const piece of pieces) {
    if (piece.prefix.length) parts.push(piece.prefix)
    if (piece.body.length) parts.push(piece.body)
  }
  parts.push(bytes.subarray(layout.tailStart))
  return concatBytes(parts)
}
