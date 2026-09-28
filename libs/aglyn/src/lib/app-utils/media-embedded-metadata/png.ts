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
 * PNG metadata blocks: text chunks, `eXIf`, XMP and the ICC profile, read
 * and rewritten without touching the image (AGL-3331).
 *
 * A PNG is an 8-byte signature and a run of chunks (PNG 3rd edition, 5.3):
 * a 4-byte length, a 4-byte type, the data, and a CRC-32 over type and data.
 * The writer rebuilds only the metadata chunks it changes, with fresh CRCs,
 * and copies every other chunk — IHDR, PLTE, every IDAT, APNG's frames, and
 * any chunk it has never heard of — through byte for byte.
 *
 * The blocks:
 *
 * - `tEXt` (Latin-1), `zTXt` (zlib-compressed Latin-1) and `iTXt` (UTF-8,
 *   optionally compressed, with a language tag and a translated keyword),
 *   11.3.3. Every one of them is reported as text except the XMP one.
 * - XMP is the `iTXt` chunk with keyword `XML:com.adobe.xmp` (XMP
 *   Specification Part 3, 1.1.5); it is read from any of the three types
 *   and always written back as an uncompressed `iTXt`, which is what that
 *   section asks for so that packet scanners can find it.
 * - `eXIf` holds EXIF as a bare TIFF structure (11.3.3.6), and must come
 *   before the first IDAT.
 * - `iCCP` holds a zlib-compressed ICC profile (11.3.2.3). Read-only.
 * - ImageMagick's legacy `Raw profile type exif` / `APP1` / `xmp` text
 *   chunks hold the same payloads as hex. They are read only when the
 *   modern chunk is absent, and a write that replaces or removes EXIF or
 *   XMP removes them too, so no stale copy is left for a reader to fall back
 *   on — a GPS removal that left the legacy EXIF behind would not be one.
 */

import { deflateSync, inflateSync } from 'zlib'
import { EmbeddedWriteError } from './types'
import {
  FILE_DAMAGED,
  METADATA_TOO_LARGE,
  asciiBytes,
  bytesAt,
  concatBytes,
  crc32,
  latin1Decode,
  latin1Encode,
  readAscii,
  readU32BE,
  trimNul,
  utf8Decode,
  utf8Encode,
  writeU32BE,
  type ImageBlockUpdate,
  type ImageBlocks,
  type PngTextChunk,
} from './image-blocks'

const SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const XMP_KEYWORD = 'XML:com.adobe.xmp'
const RAW_PROFILE = /^Raw profile type (\S+)$/i
const EXIF_HEADER = asciiBytes('Exif\0\0')
const XMP_APP1_ID = asciiBytes('http://ns.adobe.com/xap/1.0/\0')

/** A chunk's length is at most 2^31 − 1 (PNG 3rd edition, 5.3). */
const MAX_CHUNK_LENGTH = 0x7fffffff
/** Chunk count past which a file is not an image; the walk stops. */
const MAX_CHUNKS = 1 << 20
/** How many text chunks are decoded; past this they are ignored. */
const MAX_TEXT_CHUNKS = 4096
/**
 * The most a compressed chunk may inflate to. zlib data can expand a
 * thousandfold, so a small hostile chunk could otherwise ask for gigabytes.
 */
const MAX_INFLATED = 32 * 1024 * 1024

interface PngChunk {
  type: string
  /** Offset of the length field. */
  start: number
  dataStart: number
  dataEnd: number
  /** One past the CRC. */
  end: number
}

interface PngLayout {
  chunks: PngChunk[]
  /** True when the walk reached IEND. */
  complete: boolean
  /** Where the chunk walk ended: after IEND, or at the damage. */
  end: number
}

/** A chunk type is four ASCII letters (5.4). */
function isChunkType(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + 4; i += 1) {
    const c = bytes[i] ?? 0
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) return false
  }
  return true
}

/** Walks the chunks up to IEND. `null` when the signature is not PNG's. */
function walkPng(bytes: Uint8Array): PngLayout | null {
  if (!bytesAt(bytes, 0, SIGNATURE)) return null
  const chunks: PngChunk[] = []
  let offset = SIGNATURE.length
  while (offset + 12 <= bytes.length && chunks.length < MAX_CHUNKS) {
    const length = readU32BE(bytes, offset)
    const end = offset + 12 + length
    if (length > MAX_CHUNK_LENGTH || end > bytes.length) break
    if (!isChunkType(bytes, offset + 4)) break
    const type = readAscii(bytes, offset + 4, 4)
    chunks.push({
      type,
      start: offset,
      dataStart: offset + 8,
      dataEnd: offset + 8 + length,
      end,
    })
    offset = end
    if (type === 'IEND') return { chunks, complete: true, end: offset }
  }
  return { chunks, complete: false, end: offset }
}

/** zlib-inflates, or `null` for a corrupt or oversized stream. */
function inflate(data: Uint8Array): Uint8Array | null {
  try {
    return new Uint8Array(inflateSync(data, { maxOutputLength: MAX_INFLATED }))
  } catch {
    return null
  }
}

/**
 * The keyword of a text chunk and where its remainder starts: 1 to 79
 * bytes, NUL-terminated (11.3.3.2).
 */
function readKeyword(
  data: Uint8Array,
): { keyword: string; rest: number } | null {
  const nul = data.subarray(0, 80).indexOf(0)
  if (nul < 1) return null
  return { keyword: latin1Decode(data.subarray(0, nul)), rest: nul + 1 }
}

/** A decoded text chunk, and whether it was stored compressed. */
interface DecodedText {
  chunk: PngTextChunk
  compressed: boolean
}

/** Decodes a `tEXt`, `zTXt` or `iTXt` chunk, or `null` if it is malformed. */
function decodeText(type: string, data: Uint8Array): DecodedText | null {
  const head = readKeyword(data)
  if (!head) return null
  const { keyword, rest } = head
  if (type === 'tEXt') {
    return {
      chunk: { keyword, type, text: latin1Decode(data.subarray(rest)) },
      compressed: false,
    }
  }
  if (type === 'zTXt') {
    // One compression method byte, which must be 0 (zlib deflate).
    if (data[rest] !== 0) return null
    const text = inflate(data.subarray(rest + 1))
    return text
      ? { chunk: { keyword, type, text: latin1Decode(text) }, compressed: true }
      : null
  }
  if (type === 'iTXt') {
    // Compression flag, compression method, language\0, translated\0, text.
    const flag = data[rest]
    const method = data[rest + 1]
    if ((flag !== 0 && flag !== 1) || method !== 0) return null
    const langEnd = data.indexOf(0, rest + 2)
    if (langEnd < 0) return null
    const translatedEnd = data.indexOf(0, langEnd + 1)
    if (translatedEnd < 0) return null
    const body = data.subarray(translatedEnd + 1)
    const text = flag === 1 ? inflate(body) : body
    if (!text) return null
    const chunk: PngTextChunk = { keyword, type, text: utf8Decode(text) }
    const language = latin1Decode(data.subarray(rest + 2, langEnd))
    const translatedKeyword = utf8Decode(
      data.subarray(langEnd + 1, translatedEnd),
    )
    if (language) chunk.language = language
    if (translatedKeyword) chunk.translatedKeyword = translatedKeyword
    return { chunk, compressed: flag === 1 }
  }
  return null
}

/**
 * Decodes an ImageMagick raw profile: `\n<name>\n<length>\n` then the bytes
 * as hex, wrapped at 72 columns (ImageMagick `coders/png.c`). `null` when
 * the header is malformed or the hex is short or not hex.
 */
function decodeRawProfile(text: string): Uint8Array | null {
  const match = /^\s*\S+\s*\n\s*(\d{1,10})\s*\n/.exec(text)
  if (!match) return null
  const length = Number(match[1])
  if (!length || length > MAX_INFLATED) return null
  const out = new Uint8Array(length)
  let nibble = -1
  let written = 0
  for (let i = match[0].length; i < text.length && written < length; i += 1) {
    const c = text.charCodeAt(i)
    let value: number
    if (c >= 0x30 && c <= 0x39) value = c - 0x30
    else if (c >= 0x61 && c <= 0x66) value = c - 0x57
    else if (c >= 0x41 && c <= 0x46) value = c - 0x37
    else if (c === 0x0a || c === 0x0d || c === 0x20 || c === 0x09) continue
    else return null
    if (nibble < 0) {
      nibble = value
    } else {
      out[written] = (nibble << 4) | value
      written += 1
      nibble = -1
    }
  }
  return written === length ? out : null
}

type LegacyKind = 'exif' | 'xmp'

/**
 * Which block a legacy raw profile holds, with its payload unwrapped. `APP1`
 * is ImageMagick's name for a JPEG APP1 payload, which is EXIF or XMP by its
 * own prefix.
 */
function legacyProfile(
  keyword: string,
  text: string,
): { kind: LegacyKind; payload: Uint8Array } | null {
  const name = RAW_PROFILE.exec(keyword)?.[1]?.toLowerCase()
  if (name !== 'exif' && name !== 'xmp' && name !== 'app1') return null
  const payload = decodeRawProfile(text)
  if (!payload) return null
  if (bytesAt(payload, 0, EXIF_HEADER)) {
    return { kind: 'exif', payload: payload.subarray(EXIF_HEADER.length) }
  }
  if (bytesAt(payload, 0, XMP_APP1_ID)) {
    return { kind: 'xmp', payload: payload.subarray(XMP_APP1_ID.length) }
  }
  if (name === 'exif') return { kind: 'exif', payload }
  if (name === 'xmp') return { kind: 'xmp', payload }
  return null
}

/** Strips an `Exif\0\0` prefix some writers put in front of the TIFF bytes. */
function bareTiff(exif: Uint8Array): Uint8Array {
  return bytesAt(exif, 0, EXIF_HEADER)
    ? exif.subarray(EXIF_HEADER.length)
    : exif
}

/**
 * Reads the metadata blocks of a PNG. Returns `null` when the signature is
 * not PNG's; a damaged file yields what came before the damage.
 */
export function readPngBlocks(bytes: Uint8Array): ImageBlocks | null {
  const layout = walkPng(bytes)
  if (!layout) return null
  const blocks: ImageBlocks = {}
  const pngText: PngTextChunk[] = []
  let legacyExif: Uint8Array | undefined
  let legacyXmp: Uint8Array | undefined
  let decoded = 0
  for (const chunk of layout.chunks) {
    const data = bytes.subarray(chunk.dataStart, chunk.dataEnd)
    if (chunk.type === 'eXIf') {
      if (!blocks.exif) blocks.exif = bareTiff(data).slice()
      continue
    }
    if (chunk.type === 'iCCP') {
      if (blocks.icc) continue
      // Profile name\0, compression method (0), zlib data.
      const head = readKeyword(data)
      if (!head || data[head.rest] !== 0) continue
      const icc = inflate(data.subarray(head.rest + 1))
      if (icc) blocks.icc = icc
      continue
    }
    if (
      chunk.type !== 'tEXt' &&
      chunk.type !== 'zTXt' &&
      chunk.type !== 'iTXt'
    ) {
      continue
    }
    if (decoded >= MAX_TEXT_CHUNKS) continue
    decoded += 1
    const text = decodeText(chunk.type, data)?.chunk
    if (!text) continue
    if (text.keyword === XMP_KEYWORD) {
      if (blocks.xmp === undefined) blocks.xmp = trimNul(text.text)
      continue
    }
    if (RAW_PROFILE.test(text.keyword)) {
      // A hex-encoded binary profile, never text a person would read.
      const legacy = legacyProfile(text.keyword, text.text)
      if (legacy?.kind === 'exif') legacyExif ??= legacy.payload
      if (legacy?.kind === 'xmp') legacyXmp ??= legacy.payload
      continue
    }
    pngText.push(text)
  }
  if (!blocks.exif && legacyExif) blocks.exif = legacyExif
  if (blocks.xmp === undefined && legacyXmp) {
    blocks.xmp = trimNul(utf8Decode(legacyXmp))
  }
  if (pngText.length) blocks.pngText = pngText
  return blocks
}

/** Builds a chunk: length, type, data, CRC-32 over type and data. */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  if (data.length > MAX_CHUNK_LENGTH)
    throw new EmbeddedWriteError(METADATA_TOO_LARGE)
  const out = new Uint8Array(12 + data.length)
  const typeBytes = asciiBytes(type)
  writeU32BE(out, 0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  writeU32BE(out, 8 + data.length, crc32(typeBytes, data))
  return out
}

/** An uncompressed or compressed `iTXt` chunk. */
function iTXtChunk(
  keyword: string,
  text: string,
  options: {
    compressed?: boolean
    language?: string
    translatedKeyword?: string
  } = {},
): Uint8Array {
  const body = utf8Encode(text)
  return buildChunk(
    'iTXt',
    concatBytes([
      latin1Encode(keyword) ?? new Uint8Array(0),
      Uint8Array.from([0, options.compressed ? 1 : 0, 0]),
      asciiBytes(options.language ?? ''),
      Uint8Array.from([0]),
      utf8Encode(options.translatedKeyword ?? ''),
      Uint8Array.from([0]),
      options.compressed ? new Uint8Array(deflateSync(body)) : body,
    ]),
  )
}

/**
 * The chunk for a text value. The type of the chunk it replaces is kept
 * where the value allows it — a `zTXt` stays compressed, an `iTXt` keeps its
 * compression and language — and Latin-1 text becomes `tEXt` otherwise.
 * Text outside Latin-1 has to be `iTXt` (11.3.3.3 vs 11.3.3.5).
 */
function textChunk(
  keyword: string,
  text: string,
  previous: DecodedText | null,
): Uint8Array {
  const latin1 = latin1Encode(text)
  const key = latin1Encode(keyword) ?? new Uint8Array(0)
  const type = previous?.chunk.type
  if (type === 'iTXt' || !latin1) {
    return iTXtChunk(keyword, text, {
      compressed: previous?.compressed ?? false,
      language: previous?.chunk.language,
      translatedKeyword: previous?.chunk.translatedKeyword,
    })
  }
  if (type === 'zTXt') {
    return buildChunk(
      'zTXt',
      concatBytes([
        key,
        Uint8Array.from([0, 0]),
        new Uint8Array(deflateSync(latin1)),
      ]),
    )
  }
  return buildChunk('tEXt', concatBytes([key, Uint8Array.from([0]), latin1]))
}

/**
 * A keyword the PNG spec accepts (11.3.3.2): 1 to 79 printable Latin-1
 * characters, no leading, trailing or consecutive spaces.
 */
function isValidKeyword(keyword: string): boolean {
  if (keyword.length < 1 || keyword.length > 79) return false
  if (/^ | $| {2}/.test(keyword)) return false
  for (let i = 0; i < keyword.length; i += 1) {
    const c = keyword.charCodeAt(i)
    if (!((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff))) return false
  }
  return true
}

type PieceKind = 'exif' | 'xmp' | 'legacyExif' | 'legacyXmp' | 'text' | 'other'

interface Piece {
  bytes: Uint8Array
  kind: PieceKind
  type: string
  /** Text chunks: the decoded chunk, for its keyword, type and language. */
  text?: DecodedText
}

/**
 * Writes an update into a PNG and returns the new file.
 *
 * - `exif` replaces the `eXIf` chunk (moving it before IDAT if an old file
 *   had it after), or inserts one immediately before the first IDAT.
 * - `xmp` replaces the XMP text chunk in place as an uncompressed `iTXt`,
 *   or inserts one before the first IDAT.
 * - `pngText` sets or removes text chunks by keyword. A set replaces the
 *   first chunk with that keyword and removes the rest; a new keyword is
 *   inserted before the first IDAT.
 * - Replacing or removing EXIF or XMP also removes the legacy raw-profile
 *   copy of it.
 *
 * Every chunk it does not rewrite, and every byte after IEND, is copied
 * verbatim. Throws `EmbeddedWriteError` for a file that is not a PNG or that
 * ends before IEND, for an IRB (PNG has no place for one), for a keyword the
 * PNG spec does not allow, and for text containing NUL.
 */
export function writePngBlocks(
  bytes: Uint8Array,
  update: ImageBlockUpdate,
): Uint8Array {
  const layout = walkPng(bytes)
  if (!layout) throw new EmbeddedWriteError('This file is not a PNG image.')
  if (!layout.complete) throw new EmbeddedWriteError(FILE_DAMAGED)
  if (update.irb?.length) {
    throw new EmbeddedWriteError(
      'A PNG has no place for Photoshop or IPTC metadata.',
    )
  }

  const pieces: Piece[] = layout.chunks.map((chunk) => {
    const piece: Piece = {
      bytes: bytes.subarray(chunk.start, chunk.end),
      kind: 'other',
      type: chunk.type,
    }
    if (chunk.type === 'eXIf') piece.kind = 'exif'
    if (
      chunk.type === 'tEXt' ||
      chunk.type === 'zTXt' ||
      chunk.type === 'iTXt'
    ) {
      const data = bytes.subarray(chunk.dataStart, chunk.dataEnd)
      const text = decodeText(chunk.type, data)
      const keyword = text?.chunk.keyword ?? readKeyword(data)?.keyword
      if (keyword === XMP_KEYWORD) {
        piece.kind = 'xmp'
      } else if (keyword && RAW_PROFILE.test(keyword)) {
        const legacy = text && legacyProfile(keyword, text.chunk.text)
        if (legacy)
          piece.kind = legacy.kind === 'exif' ? 'legacyExif' : 'legacyXmp'
      } else if (text) {
        piece.kind = 'text'
        piece.text = text
      }
    }
    return piece
  })

  const remove = (predicate: (piece: Piece) => boolean) => {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i]
      if (piece && predicate(piece)) pieces.splice(i, 1)
    }
  }
  /** Before the first IDAT — or the APNG `fcTL` that introduces it. */
  const imageStart = () => {
    const index = pieces.findIndex(
      (p) => p.type === 'IDAT' || p.type === 'fcTL',
    )
    return index >= 0 ? index : pieces.findIndex((p) => p.type === 'IEND')
  }
  const inserted: Piece[] = []

  if (update.exif !== undefined) {
    const tiff =
      update.exif && update.exif.length ? bareTiff(update.exif) : null
    const at = pieces.findIndex((p) => p.kind === 'exif')
    const inPlace = tiff && at >= 0 && at < imageStart()
    remove((p) => p.kind === 'legacyExif')
    if (inPlace) {
      const first = pieces.findIndex((p) => p.kind === 'exif')
      const piece = pieces[first]
      if (piece) piece.bytes = buildChunk('eXIf', tiff)
      remove((p) => p.kind === 'exif' && p !== piece)
    } else {
      remove((p) => p.kind === 'exif')
      if (tiff)
        inserted.push({
          bytes: buildChunk('eXIf', tiff),
          kind: 'exif',
          type: 'eXIf',
        })
    }
  }

  if (update.xmp !== undefined) {
    remove((p) => p.kind === 'legacyXmp')
    const chunk = update.xmp ? iTXtChunk(XMP_KEYWORD, update.xmp) : null
    const first = pieces.find((p) => p.kind === 'xmp')
    remove((p) => p.kind === 'xmp' && (p !== first || !chunk))
    if (chunk && first) first.bytes = chunk
    else if (chunk) inserted.push({ bytes: chunk, kind: 'xmp', type: 'iTXt' })
  }

  for (const [keyword, value] of Object.entries(update.pngText ?? {})) {
    if (value === undefined) continue
    const first = pieces.find(
      (p) => p.kind === 'text' && p.text?.chunk.keyword === keyword,
    )
    // A keyword the file already carries round-trips as it is, even one an
    // older writer spelled against the rules; a NEW keyword must follow
    // them (11.3.3.2).
    if (
      (!first && !isValidKeyword(keyword)) ||
      latin1Encode(keyword) === null ||
      keyword === XMP_KEYWORD ||
      RAW_PROFILE.test(keyword)
    ) {
      throw new EmbeddedWriteError(
        `"${keyword}" cannot be used as a PNG text keyword.`,
      )
    }
    if (value !== null && value.includes('\0')) {
      throw new EmbeddedWriteError('PNG text cannot contain a NUL character.')
    }
    remove(
      (p) =>
        p.kind === 'text' &&
        p.text?.chunk.keyword === keyword &&
        (p !== first || value === null),
    )
    if (value === null) continue
    const chunk = textChunk(keyword, value, first?.text ?? null)
    if (first) {
      first.bytes = chunk
    } else {
      inserted.push({ bytes: chunk, kind: 'text', type: 'tEXt' })
    }
  }

  const at = imageStart()
  pieces.splice(at >= 0 ? at : pieces.length, 0, ...inserted)

  return concatBytes([
    SIGNATURE,
    ...pieces.map((piece) => piece.bytes),
    bytes.subarray(layout.end),
  ])
}
