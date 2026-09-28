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
 * The raw metadata BLOCKS of an image container (AGL-3331), and the byte
 * helpers the container modules share.
 *
 * Each image format hides the same few payloads in its own wrapper — EXIF is
 * a JPEG APP1 segment, a PNG `eXIf` chunk, a WebP `EXIF` chunk and a HEIF
 * item — and the container modules (`jpeg.ts`, `png.ts`, `webp.ts`, `gif.ts`,
 * `heif.ts`) do nothing but find those payloads and, for the writable
 * formats, put new ones back. They never interpret EXIF, IPTC or XMP; the
 * block readers do, over the {@link ImageBlocks} handed to them. Keeping the
 * split is what lets one EXIF parser serve four containers.
 */

/** One PNG text chunk (PNG 3rd edition, 11.3.3). */
export interface PngTextChunk {
  /** 1 to 79 Latin-1 characters. */
  keyword: string
  text: string
  type: 'tEXt' | 'zTXt' | 'iTXt'
  /** `iTXt` only: the RFC 3066 language tag, when there is one. */
  language?: string
  /** `iTXt` only: the keyword translated into `language`. */
  translatedKeyword?: string
}

/**
 * The metadata payloads found in one image, unwrapped from their container.
 * A key is absent when the file does not carry that block.
 */
export interface ImageBlocks {
  /**
   * TIFF-structured EXIF, starting at the byte-order mark (`II*\0` or
   * `MM\0*`): the JPEG `Exif\0\0` prefix and HEIF's 4-byte header offset are
   * already stripped.
   */
  exif?: Uint8Array
  /** The standard (main) XMP packet, decoded as UTF-8. */
  xmp?: string
  /**
   * Photoshop Image Resource Blocks — the JPEG APP13 payload after
   * `Photoshop 3.0\0`, with several consecutive APP13 segments concatenated
   * in file order the way Photoshop splits a large one.
   */
  irb?: Uint8Array
  /** JPEG COM segments and GIF comment extensions, in file order. */
  comments?: string[]
  /** Every PNG text chunk except the XMP one, in file order. */
  pngText?: PngTextChunk[]
  /**
   * The ICC profile: JPEG APP2 `ICC_PROFILE` chunks reassembled by sequence
   * number, a PNG `iCCP` inflated, a WebP `ICCP`, a GIF `ICCRGBG1`
   * application extension, or a HEIF `colr` box of type `prof`/`rICC`.
   */
  icc?: Uint8Array
}

/**
 * An edit to an image's blocks. For every key, `undefined` keeps the block
 * as it is and `null` removes it.
 *
 * A writer throws `EmbeddedWriteError` when asked to SET a block its
 * container has no place for (IRB in a PNG, a text chunk in a JPEG); asking
 * to remove one is a no-op, since the file already does not carry it.
 */
export interface ImageBlockUpdate {
  exif?: Uint8Array | null
  xmp?: string | null
  irb?: Uint8Array | null
  /** PNG only: set or remove a text chunk by keyword. */
  pngText?: Record<string, string | null>
}

// ---------------------------------------------------------------------------
// Byte helpers shared by the container modules. Every read is bounds-safe: a
// byte past the end reads as 0, so a caller that checked its range once can
// read without a second check, and one that did not gets zeros, not a throw.
// ---------------------------------------------------------------------------

/** Reads an unsigned 16-bit big-endian integer. */
export function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

/** Reads an unsigned 16-bit little-endian integer. */
export function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

/** Reads an unsigned 24-bit little-endian integer. */
export function readU24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  )
}

/** Reads an unsigned 32-bit big-endian integer. */
export function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0))
  )
}

/** Reads an unsigned 32-bit little-endian integer. */
export function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset + 3] ?? 0) * 0x1000000 +
    (((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 1] ?? 0) << 8) |
      (bytes[offset] ?? 0))
  )
}

/** Writes an unsigned 16-bit big-endian integer. */
export function writeU16BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

/** Writes an unsigned 32-bit big-endian integer. */
export function writeU32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

/** Writes an unsigned 32-bit little-endian integer. */
export function writeU32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

/** Whether `bytes` holds exactly `magic` at `offset`. */
export function bytesAt(
  bytes: Uint8Array,
  offset: number,
  magic: Uint8Array,
): boolean {
  if (offset < 0 || offset + magic.length > bytes.length) return false
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[offset + i] !== magic[i]) return false
  }
  return true
}

/** The first index of `needle` in `bytes` at or after `from`, or -1. */
export function indexOfBytes(
  bytes: Uint8Array,
  needle: Uint8Array,
  from = 0,
  to = bytes.length,
): number {
  const first = needle[0]
  if (first === undefined) return -1
  const last = Math.min(to, bytes.length) - needle.length
  for (let i = Math.max(0, from); i <= last; i += 1) {
    if (bytes[i] === first && bytesAt(bytes, i, needle)) return i
  }
  return -1
}

/** The ASCII (Latin-1) bytes of a string of code points below 256. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/** Reads `length` bytes at `offset` as a four-character code or tag. */
export function readAscii(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  let out = ''
  const end = Math.min(bytes.length, offset + length)
  for (let i = Math.max(0, offset); i < end; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0)
  }
  return out
}

/** Decodes ISO 8859-1, where every byte is the code point of its value. */
export function latin1Decode(bytes: Uint8Array): string {
  let out = ''
  // Chunked so a long text chunk never builds a huge argument list.
  for (let i = 0; i < bytes.length; i += 0x2000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
  }
  return out
}

/**
 * Encodes a string as ISO 8859-1, or `null` when any character is outside
 * it (the signal for PNG to use `iTXt` instead of `tEXt`).
 */
export function latin1Encode(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code > 0xff) return null
    out[i] = code
  }
  return out
}

const utf8Lenient = new TextDecoder('utf-8')
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const utf8Encoder = new TextEncoder()

/** Decodes UTF-8, replacing malformed sequences rather than throwing. */
export function utf8Decode(bytes: Uint8Array): string {
  return utf8Lenient.decode(bytes)
}

/** Encodes a string as UTF-8. */
export function utf8Encode(text: string): Uint8Array {
  return utf8Encoder.encode(text)
}

/**
 * Decodes free text of unknown encoding — a JPEG COM segment, a GIF comment
 * — as UTF-8 when it is valid UTF-8 and as Latin-1 otherwise. Neither format
 * names an encoding; UTF-8 is what current tools write and Latin-1 is what
 * older ones did, and a Latin-1 accent is almost never valid UTF-8.
 */
export function decodeFreeText(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes)
  } catch {
    return latin1Decode(bytes)
  }
}

/** Decodes big-endian UTF-16 code units (ICC `mluc`/`desc` text). */
export function utf16beDecode(bytes: Uint8Array): string {
  let out = ''
  const units: number[] = []
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push(readU16BE(bytes, i))
    if (units.length === 0x2000) {
      out += String.fromCharCode(...units)
      units.length = 0
    }
  }
  return out + String.fromCharCode(...units)
}

/** Removes trailing NUL characters, which several writers terminate with. */
export function trimNul(text: string): string {
  let end = text.length
  while (end > 0 && text.charCodeAt(end - 1) === 0) end -= 1
  return text.slice(0, end)
}

/** Concatenates byte arrays into one new array. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

let crcTable: Uint32Array | null = null

/**
 * CRC-32 (ISO 3309 / ITU-T V.42, polynomial 0xEDB88320), the checksum every
 * PNG chunk ends with (PNG 3rd edition, 5.5). Computed here rather than
 * through `zlib.crc32`, which older Node releases do not have.
 */
export function crc32(...parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      crc = (crcTable[(crc ^ (part[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * The sentence every writer throws when a block will not fit its container
 * — a JPEG segment tops out at 64 KB.
 */
export const METADATA_TOO_LARGE =
  "This file's embedded metadata is too large to edit here."

/** The sentence a writer throws when the file's own structure is broken. */
export const FILE_DAMAGED =
  "This file's structure is damaged, so its embedded metadata cannot be edited safely."
