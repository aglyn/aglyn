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
 * EXIF, and the TIFF structure that carries it (AGL-3331).
 *
 * A JPEG's APP1 `Exif\0\0` segment, a WebP `EXIF` chunk, a PNG `eXIf` chunk
 * and a TIFF file all hold the same thing: a TIFF header followed by image
 * file directories (IFDs), TIFF 6.0 §2, which EXIF 2.32 §4.5 adopts as is.
 * Every function here takes the bytes from the byte-order mark (`II*\0` or
 * `MM\0*`) on; containers strip their own framing first.
 *
 * ## Reading
 *
 * {@link readExif} maps IFD0, the Exif IFD (pointer 0x8769) and the GPS IFD
 * (pointer 0x8825) onto the canonical keys of `media-embedded-fields.ts`.
 * Strings are ASCII by the spec and UTF-8 in real files, so they decode as
 * UTF-8 and fall back to Latin-1. Every offset and count is checked against
 * the block, the walk refuses cycles, and a damaged block yields whatever it
 * could read rather than an exception. BigTIFF (version 43) reads too.
 *
 * ## Writing without moving anything
 *
 * A TIFF block is full of absolute offsets this module cannot see: a
 * MakerNote's private IFD points into itself by offset from the TIFF header,
 * a thumbnail is found through IFD1, a TIFF file's pixels through
 * StripOffsets. So the writer NEVER MOVES A BYTE IT DID NOT CREATE:
 *
 * - A value that fits its old slot (four bytes inside the entry, or the old
 *   out-of-line length) is overwritten in place and NUL-filled.
 * - A larger value is appended at the end of the block and its entry
 *   repointed. An entry is a fixed 12 bytes, so nothing else shifts.
 * - Adding or removing an entry relocates THAT IFD: a fresh copy, entries
 *   sorted by tag (TIFF 6.0 §2 "the entries must be sorted in ascending
 *   order by the Tag"), next-IFD pointer preserved, goes at the end, and
 *   whatever pointed at the old one (the header for IFD0, 0x8769, 0x8825)
 *   is repointed.
 * - Bytes nothing references any more (a replaced value's old slot, a
 *   relocated IFD's old table, a scrubbed GPS IFD) are zeroed, so a removed
 *   value is gone from the file rather than merely unreferenced.
 *
 * Before overwriting or zeroing an old slot the writer checks that no other
 * structure it knows of (another entry's value, an IFD table, strips, tiles,
 * the thumbnail) claims any of those bytes; a shared slot is left alone and
 * the new value appended instead.
 */

import {
  EmbeddedWriteError,
  type EmbeddedCandidate,
  type EmbeddedPatch,
} from './types'

/**
 * Field types: TIFF 6.0 §2 "Types", TIFF Technical Note 1 (IFD) and the
 * BigTIFF extension (LONG8, SLONG8, IFD8).
 */
export const TIFF_TYPE = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  SBYTE: 6,
  UNDEFINED: 7,
  SSHORT: 8,
  SLONG: 9,
  SRATIONAL: 10,
  FLOAT: 11,
  DOUBLE: 12,
  IFD: 13,
  LONG8: 16,
  SLONG8: 17,
  IFD8: 18,
} as const

const T = TIFF_TYPE

/** Bytes per value, by field type. An unknown type has no known extent. */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  [T.BYTE]: 1,
  [T.ASCII]: 1,
  [T.SHORT]: 2,
  [T.LONG]: 4,
  [T.RATIONAL]: 8,
  [T.SBYTE]: 1,
  [T.UNDEFINED]: 1,
  [T.SSHORT]: 2,
  [T.SLONG]: 4,
  [T.SRATIONAL]: 8,
  [T.FLOAT]: 4,
  [T.DOUBLE]: 8,
  [T.IFD]: 4,
  [T.LONG8]: 8,
  [T.SLONG8]: 8,
  [T.IFD8]: 8,
}

/** Tag numbers: TIFF 6.0 Appendix A and EXIF 2.32 §4.6. */
const TAG = {
  imageDescription: 0x010e,
  make: 0x010f,
  model: 0x0110,
  stripOffsets: 0x0111,
  orientation: 0x0112,
  stripByteCounts: 0x0117,
  software: 0x0131,
  dateTime: 0x0132,
  artist: 0x013b,
  tileOffsets: 0x0144,
  tileByteCounts: 0x0145,
  subIfds: 0x014a,
  jpegInterchangeFormat: 0x0201,
  jpegInterchangeFormatLength: 0x0202,
  copyright: 0x8298,
  exposureTime: 0x829a,
  fNumber: 0x829d,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  iso: 0x8827,
  dateTimeOriginal: 0x9003,
  offsetTime: 0x9010,
  offsetTimeOriginal: 0x9011,
  flash: 0x9209,
  focalLength: 0x920a,
  makerNote: 0x927c,
  userComment: 0x9286,
  xpTitle: 0x9c9b,
  xpComment: 0x9c9c,
  xpAuthor: 0x9c9d,
  xpKeywords: 0x9c9e,
  interopIfd: 0xa005,
  lensModel: 0xa434,
} as const

/** GPS IFD tags, EXIF 2.32 §4.6.6. */
const GPS = {
  latitudeRef: 0x0001,
  latitude: 0x0002,
  longitudeRef: 0x0003,
  longitude: 0x0004,
  altitudeRef: 0x0005,
  altitude: 0x0006,
} as const

/**
 * Tags that locate other structures by offset. Rewriting one would orphan
 * or corrupt what it points at, so {@link writeTiffTags} refuses them.
 */
const STRUCTURAL_TAGS: ReadonlySet<number> = new Set([
  TAG.stripOffsets,
  TAG.stripByteCounts,
  TAG.tileOffsets,
  TAG.tileByteCounts,
  TAG.subIfds,
  TAG.jpegInterchangeFormat,
  TAG.jpegInterchangeFormatLength,
  TAG.exifIfd,
  TAG.gpsIfd,
  TAG.interopIfd,
  TAG.makerNote,
])

/** Offset/length tag pairs whose data the writer must never touch. */
const DATA_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [TAG.stripOffsets, TAG.stripByteCounts],
  [TAG.tileOffsets, TAG.tileByteCounts],
  [TAG.jpegInterchangeFormat, TAG.jpegInterchangeFormatLength],
]

/** Bounds on the walk, far above anything a camera or editor writes. */
const MAX_IFDS = 64
const MAX_DATA_RANGES = 65536

/** EXIF 2.32 §4.6.5 Orientation, worded as ExifTool prints it. */
const ORIENTATION: Readonly<Record<number, string>> = {
  1: 'Horizontal (normal)',
  2: 'Mirror horizontal',
  3: 'Rotate 180',
  4: 'Mirror vertical',
  5: 'Mirror horizontal and rotate 270 CW',
  6: 'Rotate 90 CW',
  7: 'Mirror horizontal and rotate 90 CW',
  8: 'Rotate 270 CW',
}

/** The IFDs a caller can address. */
export type TiffDirectory = 'ifd0' | 'exif' | 'gps'

/**
 * One tag to set or remove. `value` is the raw value bytes IN THE BLOCK'S
 * BYTE ORDER (the same bytes {@link readTiffTagBytes} returns), and `count`
 * defaults to `value.length` divided by the type's size. `null` removes the
 * entry.
 */
export interface TiffTagWrite {
  ifd: TiffDirectory
  tag: number
  type: number
  count?: number
  value: Uint8Array | null
}

/** Everything one pass of {@link editTiff} can do. */
export interface TiffEdit {
  /** Canonical-key edits, applied to tags that already exist. */
  patch?: EmbeddedPatch
  /** Raw tag writes, applied after the patch (a later write wins). */
  writes?: readonly TiffTagWrite[]
  /** Whether `writes` may add tags that are not there yet. */
  allowAdd?: boolean
  /** The largest block the container can hold. */
  maxLength?: number
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

function get16(b: Uint8Array, at: number, little: boolean): number {
  const x = b[at] ?? 0
  const y = b[at + 1] ?? 0
  return little ? x | (y << 8) : (x << 8) | y
}

function get32(b: Uint8Array, at: number, little: boolean): number {
  const lo = get16(b, little ? at : at + 2, little)
  const hi = get16(b, little ? at + 2 : at, little)
  return hi * 0x10000 + lo
}

/**
 * A 64-bit value as a double. Past 2^53 it loses precision, which never
 * matters: anything that large fails every bounds check anyway.
 */
function get64(b: Uint8Array, at: number, little: boolean): number {
  const lo = get32(b, little ? at : at + 4, little)
  const hi = get32(b, little ? at + 4 : at, little)
  return hi * 0x100000000 + lo
}

function put16(b: Uint8Array, at: number, value: number, little: boolean) {
  b[little ? at : at + 1] = value & 0xff
  b[little ? at + 1 : at] = (value >>> 8) & 0xff
}

function put32(b: Uint8Array, at: number, value: number, little: boolean) {
  put16(b, little ? at : at + 2, value & 0xffff, little)
  put16(b, little ? at + 2 : at, Math.floor(value / 0x10000) & 0xffff, little)
}

function encode32(value: number, little: boolean): Uint8Array {
  const out = new Uint8Array(4)
  put32(out, 0, value, little)
  return out
}

function concat(...parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const utf16le = new TextDecoder('utf-16le')
const encoder = new TextEncoder()

/**
 * Windows-1252's 0x80–0x9F, the only range where it differs from ISO
 * 8859-1. "Latin-1" text in the wild is Windows-1252, and the WHATWG
 * Encoding standard decodes the `latin1` label the same way.
 */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030,
  0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e,
  0x178,
]

function decodeLatin1(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    out += String.fromCharCode(
      byte >= 0x80 && byte < 0xa0 ? (CP1252_HIGH[byte - 0x80] ?? byte) : byte,
    )
  }
  return out
}

/** Whether the bytes are well-formed UTF-8. */
export function isUtf8(bytes: Uint8Array): boolean {
  try {
    utf8Strict.decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Text in a field whose declared charset nobody honors: UTF-8 when the
 * bytes are valid UTF-8 (pure ASCII is), Latin-1 otherwise. Shared with the
 * IPTC reader, which has the same problem.
 */
export function decodeLegacyText(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes)
  } catch {
    return decodeLatin1(bytes)
  }
}

/** Text up to the first NUL, decoded, with surrounding whitespace removed. */
function cleanText(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0)
  return decodeLegacyText(nul >= 0 ? bytes.subarray(0, nul) : bytes).trim()
}

function decodeUcs2(bytes: Uint8Array, little: boolean): string {
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2))
  if (little) return utf16le.decode(even)
  const swapped = new Uint8Array(even.length)
  for (let i = 0; i + 1 < even.length; i += 2) {
    swapped[i] = even[i + 1] ?? 0
    swapped[i + 1] = even[i] ?? 0
  }
  return utf16le.decode(swapped)
}

function cleanUcs2(bytes: Uint8Array, little: boolean): string {
  const text = decodeUcs2(bytes, little)
  const nul = text.indexOf('\0')
  return (nul >= 0 ? text.slice(0, nul) : text).trim()
}

function encodeUcs2(text: string, little: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++)
    put16(out, i * 2, text.charCodeAt(i), little)
  return out
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) > 0x7f) return false
  return true
}

/** An ASCII-typed value: UTF-8, as real files hold it, NUL-terminated. */
function asciiValue(text: string): Uint8Array {
  return concat(encoder.encode(text), [0])
}

/** A Windows XP tag: UCS-2 little-endian whatever the block's order. */
function xpValue(text: string): Uint8Array {
  return concat(encodeUcs2(text, true), [0, 0])
}

function splitList(text: string | null): string[] | null {
  if (!text) return null
  const items = [...new Set(text.split(';').map((item) => item.trim()))]
  const kept = items.filter(Boolean)
  return kept.length ? kept : null
}

/** A number with at most `places` decimals and no trailing zeros. */
function trimNumber(value: number, places: number): string {
  const fixed = value.toFixed(places)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

interface TiffHeader {
  little: boolean
  /** BigTIFF: 8-byte offsets and counts, 20-byte entries. Read-only. */
  big: boolean
  ifd0: number
}

interface TiffEntry {
  tag: number
  type: number
  count: number
  /** Absolute offset of the entry itself. */
  at: number
  /** Absolute offset of the value; inside the entry when `inline`. */
  valueAt: number
  /** `count` times the type's size, or -1 for a type with no known size. */
  size: number
  inline: boolean
  /** Whether the whole value lies inside the block. */
  ok: boolean
}

interface TiffIfd {
  at: number
  entries: TiffEntry[]
  /** The raw next-IFD offset; 0 when there is none. */
  next: number
  /** Bytes of the count, entries and next pointer that lie in the block. */
  length: number
}

interface TiffTree {
  header: TiffHeader
  ifd0: TiffIfd | null
  exif: TiffIfd | null
  gps: TiffIfd | null
  /** Every IFD reached, for the writer's map of who owns which bytes. */
  all: TiffIfd[]
}

function readHeader(b: Uint8Array): TiffHeader | null {
  if (b.length < 8) return null
  const little = b[0] === 0x49 && b[1] === 0x49
  if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return null
  const version = get16(b, 2, little)
  if (version === 42) return { little, big: false, ifd0: get32(b, 4, little) }
  // BigTIFF: the offset size (always 8) and a reserved zero follow.
  if (version !== 43 || b.length < 16) return null
  if (get16(b, 4, little) !== 8 || get16(b, 6, little) !== 0) return null
  return { little, big: true, ifd0: get64(b, 8, little) }
}

/** Whether the bytes start with a TIFF header this module can read. */
export function isTiff(bytes: Uint8Array): boolean {
  return readHeader(bytes) !== null
}

function parseIfd(b: Uint8Array, h: TiffHeader, at: number): TiffIfd | null {
  const countSize = h.big ? 8 : 2
  const entrySize = h.big ? 20 : 12
  const pointerSize = h.big ? 8 : 4
  const headerSize = h.big ? 16 : 8
  if (!Number.isSafeInteger(at) || at < headerSize) return null
  if (at + countSize > b.length) return null
  const n = h.big ? get64(b, at, h.little) : get16(b, at, h.little)
  const entriesEnd = at + countSize + n * entrySize
  if (n > 0xffff || entriesEnd > b.length) return null
  const next =
    entriesEnd + pointerSize <= b.length
      ? h.big
        ? get64(b, entriesEnd, h.little)
        : get32(b, entriesEnd, h.little)
      : 0
  const entries: TiffEntry[] = []
  for (let i = 0; i < n; i++) {
    const e = at + countSize + i * entrySize
    const type = get16(b, e + 2, h.little)
    const count = h.big ? get64(b, e + 4, h.little) : get32(b, e + 4, h.little)
    const field = e + (h.big ? 12 : 8)
    const unit = TYPE_SIZE[type]
    const size = unit === undefined ? -1 : count * unit
    const inline = size >= 0 && size <= pointerSize
    const valueAt = inline
      ? field
      : h.big
        ? get64(b, field, h.little)
        : get32(b, field, h.little)
    entries.push({
      tag: get16(b, e, h.little),
      type,
      count,
      at: e,
      valueAt,
      size,
      inline,
      ok: size >= 0 && valueAt + size <= b.length,
    })
  }
  return {
    at,
    entries,
    next,
    length: Math.min(entriesEnd + pointerSize, b.length) - at,
  }
}

/** The index-th value of an integer-typed entry, or null. */
function uintAt(
  b: Uint8Array,
  h: TiffHeader,
  e: TiffEntry | undefined,
  index: number,
): number | null {
  if (!e?.ok || index < 0 || index >= e.count) return null
  const at = e.valueAt + index * (TYPE_SIZE[e.type] ?? 0)
  switch (e.type) {
    case T.BYTE:
    case T.UNDEFINED:
      return b[at] ?? null
    case T.SBYTE:
      return ((b[at] ?? 0) << 24) >> 24
    case T.SHORT:
      return get16(b, at, h.little)
    case T.SSHORT:
      return (get16(b, at, h.little) << 16) >> 16
    case T.LONG:
    case T.IFD:
      return get32(b, at, h.little)
    case T.SLONG:
      return get32(b, at, h.little) | 0
    case T.LONG8:
    case T.IFD8:
      return get64(b, at, h.little)
    default:
      return null
  }
}

/** The index-th value of a rational (or integer) entry, or null. */
function rationalAt(
  b: Uint8Array,
  h: TiffHeader,
  e: TiffEntry | undefined,
  index: number,
): number | null {
  if (!e?.ok || index < 0 || index >= e.count) return null
  if (e.type !== T.RATIONAL && e.type !== T.SRATIONAL) {
    return uintAt(b, h, e, index)
  }
  const at = e.valueAt + index * 8
  let num = get32(b, at, h.little)
  let den = get32(b, at + 4, h.little)
  if (e.type === T.SRATIONAL) {
    num |= 0
    den |= 0
  }
  return den === 0 ? null : num / den
}

/**
 * Walk IFD0, the Exif and GPS IFDs, and, only so the writer knows which
 * bytes they own, the Interop IFD, IFD0's chain (IFD1 holds the thumbnail)
 * and any SubIFDs. Each IFD is visited once, so a cycle ends the walk.
 */
function walk(b: Uint8Array): TiffTree | null {
  const header = readHeader(b)
  if (!header) return null
  const seen = new Set<number>()
  const all: TiffIfd[] = []
  const visit = (at: number | null): TiffIfd | null => {
    if (!at || seen.has(at) || seen.size >= MAX_IFDS) return null
    seen.add(at)
    const ifd = parseIfd(b, header, at)
    if (ifd) all.push(ifd)
    return ifd
  }
  const pointer = (ifd: TiffIfd | null, tag: number, index = 0) =>
    uintAt(
      b,
      header,
      ifd?.entries.find((e) => e.tag === tag),
      index,
    )

  const ifd0 = visit(header.ifd0)
  const exif = visit(pointer(ifd0, TAG.exifIfd))
  const gps = visit(pointer(ifd0, TAG.gpsIfd))
  visit(pointer(exif, TAG.interopIfd))
  const chain: TiffIfd[] = []
  for (let ifd = ifd0; ifd && chain.length < MAX_IFDS; ifd = visit(ifd.next)) {
    chain.push(ifd)
  }
  for (const ifd of chain) {
    const subs = ifd.entries.find((e) => e.tag === TAG.subIfds)
    for (let i = 0; subs && i < Math.min(subs.count, MAX_IFDS); i++) {
      visit(pointer(ifd, TAG.subIfds, i))
    }
  }
  return { header, ifd0, exif, gps, all }
}

function entryOf(ifd: TiffIfd | null, tag: number): TiffEntry | undefined {
  return ifd?.entries.find((e) => e.tag === tag)
}

function valueBytes(
  b: Uint8Array,
  e: TiffEntry | undefined,
): Uint8Array | null {
  return e?.ok ? b.subarray(e.valueAt, e.valueAt + e.size) : null
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * EXIF 2.32 §4.6.5: "YYYY:MM:DD HH:MM:SS", blank-filled when unknown. A
 * date whose time is blank reads as a date alone, which is what the writer
 * produces for a date-only edit.
 */
function exifDateToIso(raw: string, offset: string | null): string | null {
  const m =
    /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
      raw.trim(),
    )
  if (!m) return null
  const [, year, month, day, hour, minute, second] = m
  if (!year || !month || !day || year === '0000') return null
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return null
  let iso = `${year}-${month}-${day}`
  if (hour === undefined || minute === undefined) return iso
  if (+hour > 23 || +minute > 59 || +(second ?? 0) > 60) return iso
  iso += `T${hour}:${minute}:${second ?? '00'}`
  const zone = offset?.trim()
  const z = zone ? /^([+-])(\d{2}):?(\d{2})$/.exec(zone) : null
  if (zone === 'Z') iso += 'Z'
  else if (z) iso += `${z[1]}${z[2]}:${z[3]}`
  return iso
}

/** ExifTool's rule: a quarter second and shorter reads as a fraction. */
function formatExposure(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 0.25001) return `1/${Math.round(1 / seconds)} s`
  return `${trimNumber(seconds, 1)} s`
}

/** EXIF 2.32 §4.6.5 Flash: bit 0 fired, 1–2 return, 3–4 mode, 5, 6. */
function describeFlash(value: number | null): string | null {
  if (value === null) return null
  const fired = (value & 1) === 1
  if (!fired && value & 0x20) return 'No flash function'
  const parts = [fired ? 'Fired' : 'Did not fire']
  const mode = (value >> 3) & 3
  if (mode === 1) parts.push('compulsory flash mode')
  else if (mode === 2) parts.push('flash suppressed')
  else if (mode === 3) parts.push('auto mode')
  const strobe = (value >> 1) & 3
  if (strobe === 2) parts.push('return not detected')
  else if (strobe === 3) parts.push('return detected')
  if (value & 0x40) parts.push('red-eye reduction')
  return parts.join(', ')
}

/**
 * UserComment's 8-byte character code, EXIF 2.32 §4.6.5 Table 9. JIS and
 * the undefined code are not decoded, and so are not written either.
 */
function userCommentCode(bytes: Uint8Array): 'ASCII' | 'UNICODE' | null {
  const code = decodeLatin1(bytes.subarray(0, 8)).replace(/\0+$/, '')
  return bytes.length >= 8 && (code === 'ASCII' || code === 'UNICODE')
    ? code
    : null
}

/**
 * The byte order of a UNICODE UserComment. The spec does not say; most
 * writers use the block's own order, Microsoft's use little-endian whatever
 * the block says, and a few add a BOM. Mostly-Latin text settles it: the
 * zero bytes of the high halves all sit on one side.
 */
function unicodeOrder(
  body: Uint8Array,
  blockLittle: boolean,
): { little: boolean; bom: boolean } {
  if (body[0] === 0xff && body[1] === 0xfe) return { little: true, bom: true }
  if (body[0] === 0xfe && body[1] === 0xff) return { little: false, bom: true }
  let highFirst = 0
  let highSecond = 0
  for (let i = 0; i + 1 < body.length && i < 4096; i += 2) {
    if (body[i] === 0 && body[i + 1] !== 0) highFirst++
    if (body[i + 1] === 0 && body[i] !== 0) highSecond++
  }
  if (highSecond > highFirst) return { little: true, bom: false }
  if (highFirst > highSecond) return { little: false, bom: false }
  return { little: blockLittle, bom: false }
}

function decodeUserComment(bytes: Uint8Array | null, little: boolean) {
  if (!bytes) return null
  const code = userCommentCode(bytes)
  const body = bytes.subarray(8)
  if (code === 'ASCII') return cleanText(body)
  if (code !== 'UNICODE') return null
  const order = unicodeOrder(body, little)
  return cleanUcs2(order.bom ? body.subarray(2) : body, order.little)
}

function gpsCoordinate(
  b: Uint8Array,
  h: TiffHeader,
  value: TiffEntry | undefined,
  ref: string | null,
): number | null {
  const degrees = rationalAt(b, h, value, 0)
  if (degrees === null || !value) return null
  const minutes = value.count > 1 ? (rationalAt(b, h, value, 1) ?? 0) : 0
  const seconds = value.count > 2 ? (rationalAt(b, h, value, 2) ?? 0) : 0
  const decimal =
    Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600
  if (!Number.isFinite(decimal)) return null
  const hemisphere = ref?.trim().charAt(0).toUpperCase()
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal
}

function readInto(
  b: Uint8Array,
  tree: TiffTree,
  out: Map<string, string | string[]>,
) {
  const { header: h, ifd0, exif, gps } = tree
  /** The first spelling found wins: standard tags are read before XP tags. */
  const set = (key: string, value: string | string[] | null) => {
    if (value === null || out.has(key)) return
    if (Array.isArray(value) ? value.length : value) out.set(key, value)
  }
  const text = (ifd: TiffIfd | null, tag: number) => {
    const bytes = valueBytes(b, entryOf(ifd, tag))
    return bytes ? cleanText(bytes) : null
  }
  const xp = (tag: number) => {
    const bytes = valueBytes(b, entryOf(ifd0, tag))
    return bytes ? cleanUcs2(bytes, true) : null
  }
  const numeric = (ifd: TiffIfd | null, tag: number) =>
    rationalAt(b, h, entryOf(ifd, tag), 0)

  set('title', xp(TAG.xpTitle))
  set('description', text(ifd0, TAG.imageDescription))
  set('keywords', splitList(xp(TAG.xpKeywords)))
  set(
    'comment',
    decodeUserComment(valueBytes(b, entryOf(exif, TAG.userComment)), h.little),
  )
  set('comment', xp(TAG.xpComment))
  set('creator', splitList(text(ifd0, TAG.artist)))
  set('creator', splitList(xp(TAG.xpAuthor)))
  // EXIF 2.32 §4.6.5 Copyright: "photographer\0editor\0"; the first part.
  set('copyright', text(ifd0, TAG.copyright))

  if (gps) {
    const lat = gpsCoordinate(
      b,
      h,
      entryOf(gps, GPS.latitude),
      text(gps, GPS.latitudeRef),
    )
    const lon = gpsCoordinate(
      b,
      h,
      entryOf(gps, GPS.longitude),
      text(gps, GPS.longitudeRef),
    )
    if (lat !== null && lon !== null && lat <= 90 && lat >= -90) {
      if (lon <= 180 && lon >= -180) {
        set('gps', `${lat.toFixed(6)},${lon.toFixed(6)}`)
      }
    }
    const altitude = numeric(gps, GPS.altitude)
    if (altitude !== null && Number.isFinite(altitude)) {
      const below = uintAt(b, h, entryOf(gps, GPS.altitudeRef), 0) === 1
      const metres = below ? -Math.abs(altitude) : altitude
      set('gpsAltitude', `${trimNumber(metres, 1)} m`)
    }
  }

  const original = text(exif, TAG.dateTimeOriginal)
  if (original) {
    set(
      'createdAt',
      exifDateToIso(original, text(exif, TAG.offsetTimeOriginal)),
    )
  }
  set('make', text(ifd0, TAG.make))
  set('model', text(ifd0, TAG.model))
  set('lens', text(exif, TAG.lensModel))
  set('exposure', formatExposure(numeric(exif, TAG.exposureTime)))
  const aperture = numeric(exif, TAG.fNumber)
  if (aperture !== null && Number.isFinite(aperture) && aperture > 0) {
    set('aperture', `f/${trimNumber(aperture, 1)}`)
  }
  const iso = uintAt(b, h, entryOf(exif, TAG.iso), 0)
  if (iso) set('iso', String(iso))
  const focal = numeric(exif, TAG.focalLength)
  if (focal !== null && Number.isFinite(focal) && focal > 0) {
    set('focalLength', `${trimNumber(focal, 1)} mm`)
  }
  set('flash', describeFlash(uintAt(b, h, entryOf(exif, TAG.flash), 0)))

  const modified = text(ifd0, TAG.dateTime)
  if (modified) {
    set('modifiedAt', exifDateToIso(modified, text(exif, TAG.offsetTime)))
  }
  set('software', text(ifd0, TAG.software))
  const orientation = uintAt(b, h, entryOf(ifd0, TAG.orientation), 0)
  set(
    'orientation',
    orientation === null ? null : (ORIENTATION[orientation] ?? null),
  )
}

/**
 * Read the EXIF of a TIFF-structured block. Never throws: a damaged block
 * yields what could be read, a block that is not TIFF yields nothing.
 */
export function readExif(tiff: Uint8Array): EmbeddedCandidate[] {
  const values = new Map<string, string | string[]>()
  let big = false
  try {
    const tree = walk(tiff)
    if (tree) {
      big = tree.header.big
      readInto(tiff, tree, values)
    }
  } catch {
    // Every read is bounded; this only keeps a bug from failing an upload.
  }
  return [...values].map(([key, value]) => ({
    key,
    value,
    source: 'exif' as const,
    // A BigTIFF is read-only here, so none of its values can be written.
    ...(big ? { editable: false } : {}),
  }))
}

/**
 * The raw value of one tag, as stored: `bytes` is a view into `tiff`, in
 * the block's byte order. Null when the block, the IFD or the tag is
 * missing, or when the value runs past the end of the block.
 */
export function readTiffTagBytes(
  tiff: Uint8Array,
  ifd: TiffDirectory,
  tag: number,
): { type: number; count: number; bytes: Uint8Array } | null {
  try {
    const tree = walk(tiff)
    const entry = entryOf(tree?.[ifd] ?? null, tag)
    const bytes = valueBytes(tiff, entry)
    return entry && bytes
      ? { type: entry.type, count: entry.count, bytes }
      : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A strict ISO 8601 date, as `sanitizeEmbeddedPatch` admits it. */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

const IFD0_TEXT: ReadonlyArray<readonly [string, number]> = [
  ['description', TAG.imageDescription],
  ['make', TAG.make],
  ['model', TAG.model],
  ['software', TAG.software],
]

/** A patch value as one line; `undefined` when the key is not patched. */
function patchText(
  value: string | string[] | null | undefined,
  separator: string,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const text = Array.isArray(value)
    ? value
        .map((item) => item.trim())
        .filter(Boolean)
        .join(separator)
    : value.trim()
  return text || null
}

function userCommentValue(
  current: Uint8Array | null,
  text: string | null,
  blockLittle: boolean,
): Uint8Array | null | undefined {
  const code = current ? userCommentCode(current) : null
  if (!current || !code) return undefined
  if (text === null) return null
  if (code === 'ASCII' && isAscii(text)) {
    return concat(encoder.encode('ASCII\0\0\0'), encoder.encode(text))
  }
  // Non-ASCII text in an ASCII comment switches it to UNICODE, as ExifTool
  // does, in the block's order; an existing UNICODE one keeps its order.
  const order =
    code === 'UNICODE'
      ? unicodeOrder(current.subarray(8), blockLittle)
      : { little: blockLittle, bom: false }
  const bom = order.bom ? (order.little ? [0xff, 0xfe] : [0xfe, 0xff]) : []
  return concat(
    encoder.encode('UNICODE\0'),
    bom,
    encodeUcs2(text, order.little),
  )
}

/**
 * EXIF 2.32 §4.6.5 Copyright holds `photographer\0editor\0`. An edit
 * replaces the photographer's part and keeps the editor's; with only an
 * editor's part left the photographer's is one space, as the spec says.
 */
function copyrightValue(
  current: Uint8Array | null,
  text: string | null,
): Uint8Array | null {
  const raw = current ?? new Uint8Array()
  const nul = raw.indexOf(0)
  let editor = nul >= 0 ? raw.subarray(nul + 1) : new Uint8Array()
  const end = editor.indexOf(0)
  if (end >= 0) editor = editor.subarray(0, end)
  if (!decodeLegacyText(editor).trim()) {
    return text === null ? null : asciiValue(text)
  }
  return concat(encoder.encode(text ?? ' '), [0], editor, [0])
}

/**
 * Turn a canonical patch into writes of tags that ALREADY EXIST. A value
 * the file does not hold yet goes to XMP (the Metadata Working Group's
 * rule), which is the XMP writer's job, not this one's.
 */
function planPatch(
  b: Uint8Array,
  tree: TiffTree,
  patch: EmbeddedPatch,
): { writes: TiffTagWrite[]; scrubGps: boolean } {
  const little = tree.header.little
  const writes: TiffTagWrite[] = []
  const patched = (key: string) =>
    Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
  const entry = (ifd: TiffDirectory, tag: number) => entryOf(tree[ifd], tag)
  const put = (
    ifd: TiffDirectory,
    tag: number,
    type: number,
    value: Uint8Array | null | undefined,
  ) => {
    if (value !== undefined && entry(ifd, tag)) {
      writes.push({ ifd, tag, type, value })
    }
  }
  const ascii = (ifd: TiffDirectory, tag: number, text: string | null) =>
    put(ifd, tag, T.ASCII, text === null ? null : asciiValue(text))
  const xp = (tag: number, text: string | null) => {
    const type = entry('ifd0', tag)?.type === T.UNDEFINED ? T.UNDEFINED : T.BYTE
    put('ifd0', tag, type, text === null ? null : xpValue(text))
  }
  const text = (key: string, separator = ', ') =>
    patchText(patch[key], separator) ?? null

  for (const [key, tag] of IFD0_TEXT) {
    if (patched(key)) ascii('ifd0', tag, text(key))
  }
  if (patched('lens')) ascii('exif', TAG.lensModel, text('lens'))
  if (patched('creator')) {
    ascii('ifd0', TAG.artist, text('creator', '; '))
    xp(TAG.xpAuthor, text('creator', '; '))
  }
  if (patched('title')) xp(TAG.xpTitle, text('title'))
  if (patched('keywords')) xp(TAG.xpKeywords, text('keywords', ';'))
  if (patched('comment')) {
    xp(TAG.xpComment, text('comment'))
    const current = valueBytes(b, entry('exif', TAG.userComment))
    put(
      'exif',
      TAG.userComment,
      T.UNDEFINED,
      userCommentValue(current, text('comment'), little),
    )
  }
  if (patched('copyright')) {
    const current = valueBytes(b, entry('ifd0', TAG.copyright))
    put(
      'ifd0',
      TAG.copyright,
      T.ASCII,
      copyrightValue(current, text('copyright')),
    )
  }
  if (patched('createdAt')) {
    const raw = patch['createdAt']
    const iso = typeof raw === 'string' ? ISO_DATE.exec(raw.trim()) : null
    if (raw === null || iso) {
      const [, year, month, day, hour, minute, second, zone] = iso ?? []
      // A date without a time keeps the time blank-filled, the spec's way
      // of saying "unknown", rather than inventing midnight.
      const value = iso
        ? hour
          ? `${year}:${month}:${day} ${hour}:${minute}:${second ?? '00'}`
          : `${year}:${month}:${day}   :  :  `
        : null
      ascii('exif', TAG.dateTimeOriginal, value)
      if (entry('exif', TAG.dateTimeOriginal)) {
        // The offset belongs to the old time; a new time without a zone
        // leaves it blank-filled ("unknown") rather than wrong.
        const offset =
          zone && hour ? (zone === 'Z' ? '+00:00' : zone) : '   :  '
        ascii('exif', TAG.offsetTimeOriginal, value === null ? null : offset)
      }
    }
  }
  return {
    writes,
    scrubGps:
      Object.prototype.hasOwnProperty.call(patch, 'gps') &&
      patch['gps'] === null,
  }
}

/** A tag in the model of one IFD being edited. */
interface Slot {
  tag: number
  type: number
  count: number
  /** The 4-byte value-or-offset field, in the block's byte order. */
  field: Uint8Array
  /** The entry the slot was read from; null for an added tag. */
  from: TiffEntry | null
  dirty: boolean
}

interface Dir {
  ifd: TiffIfd
  slots: Slot[]
  /** An entry was added or removed, so the table moves to the end. */
  moved: boolean
}

/** A span of the block and the structure that owns it. */
interface Claim {
  start: number
  end: number
  owner: object
}

const HEADER_OWNER = { owner: 'header' }
const DATA_OWNER = { owner: 'data' }

const POINTER_TAG: Record<'exif' | 'gps', number> = {
  exif: TAG.exifIfd,
  gps: TAG.gpsIfd,
}

class TiffEditor {
  private readonly source: Uint8Array
  private readonly work: Uint8Array
  private readonly little: boolean
  private readonly claims: Claim[]
  private readonly tail: Array<{ at: number; bytes: Uint8Array }> = []
  private end: number
  private changed = false
  private readonly ifd0: Dir
  private readonly subs: Partial<Record<'exif' | 'gps', Dir>> = {}
  private readonly gpsIfd: TiffIfd | null

  constructor(source: Uint8Array, tree: TiffTree, ifd0: TiffIfd) {
    this.source = source
    this.work = source.slice()
    this.end = source.length
    this.little = tree.header.little
    this.claims = claimMap(source, tree)
    this.gpsIfd = tree.gps
    this.ifd0 = this.dir(ifd0)
    if (tree.exif) this.subs.exif = this.dir(tree.exif)
    if (tree.gps) this.subs.gps = this.dir(tree.gps)
  }

  private dir(ifd: TiffIfd): Dir {
    return {
      ifd,
      moved: false,
      slots: ifd.entries.map((e) => ({
        tag: e.tag,
        type: e.type,
        count: e.count,
        field: this.source.slice(e.at + 8, e.at + 12),
        from: e,
        dirty: false,
      })),
    }
  }

  private directory(kind: TiffDirectory): Dir | undefined {
    return kind === 'ifd0' ? this.ifd0 : this.subs[kind]
  }

  /** Whether no structure outside `owners` claims any byte of the span. */
  private exclusive(start: number, end: number, owners: ReadonlySet<object>) {
    for (const claim of this.claims) {
      if (claim.start < end && start < claim.end && !owners.has(claim.owner)) {
        return false
      }
    }
    return true
  }

  /** The out-of-line bytes of an entry that lie inside the block. */
  private range(e: TiffEntry | null): [number, number] | null {
    if (!e || e.inline || e.size <= 0 || e.valueAt >= this.source.length) {
      return null
    }
    return [e.valueAt, Math.min(e.valueAt + e.size, this.source.length)]
  }

  private zero(start: number, end: number) {
    const from = Math.max(0, start)
    const to = Math.min(end, this.work.length)
    if (to > from) {
      this.work.fill(0, from, to)
      this.changed = true
    }
  }

  /** Zero an entry's old out-of-line value, unless something shares it. */
  private release(e: TiffEntry | null) {
    const range = this.range(e)
    if (e && range && this.exclusive(range[0], range[1], new Set([e]))) {
      this.zero(range[0], range[1])
    }
  }

  /** Append at the next even offset (TIFF 6.0 §2: offsets are word-aligned). */
  private append(bytes: Uint8Array): number {
    if (this.end % 2) this.end += 1
    const at = this.end
    this.tail.push({ at, bytes })
    this.end += bytes.length
    this.changed = true
    return at
  }

  /** Put a value where it may go and return the entry's 4-byte field. */
  private place(from: TiffEntry | null, bytes: Uint8Array): Uint8Array {
    if (bytes.length <= 4) {
      this.release(from)
      const field = new Uint8Array(4)
      field.set(bytes)
      return field
    }
    const range = this.range(from)
    if (
      from?.ok &&
      range &&
      bytes.length <= from.size &&
      this.exclusive(range[0], range[1], new Set([from]))
    ) {
      this.work.set(bytes, from.valueAt)
      this.work.fill(0, from.valueAt + bytes.length, from.valueAt + from.size)
      this.changed = true
      return encode32(from.valueAt, this.little)
    }
    this.release(from)
    return encode32(this.append(bytes), this.little)
  }

  private move(dir: Dir) {
    if (dir.moved) return
    if (
      !this.exclusive(
        dir.ifd.at,
        dir.ifd.at + dir.ifd.length,
        new Set([dir.ifd]),
      )
    ) {
      throw new EmbeddedWriteError(
        'This file’s EXIF directories overlap other data, so they cannot be edited safely.',
      )
    }
    dir.moved = true
    this.changed = true
  }

  set(write: TiffTagWrite, allowAdd: boolean) {
    const dir = this.directory(write.ifd)
    const slot = dir?.slots.find((s) => s.tag === write.tag)
    if (write.value === null) {
      if (!dir || !slot) return
      this.move(dir)
      dir.slots = dir.slots.filter((s) => s !== slot)
      this.release(slot.from)
      return
    }
    const count =
      write.count ?? write.value.length / (TYPE_SIZE[write.type] ?? 1)
    if (!slot) {
      if (!allowAdd) return
      if (!dir) {
        throw new EmbeddedWriteError(
          `This file has no ${write.ifd === 'gps' ? 'GPS' : 'Exif'} directory to add a tag to.`,
        )
      }
      if (dir.slots.length >= 0xffff) {
        throw new EmbeddedWriteError('This file’s EXIF directory is full.')
      }
      this.move(dir)
      const field = this.place(null, write.value)
      dir.slots.push({
        tag: write.tag,
        type: write.type,
        count,
        field,
        from: null,
        dirty: true,
      })
      return
    }
    const current = valueBytes(this.source, slot.from ?? undefined)
    if (
      slot.type === write.type &&
      slot.count === count &&
      current &&
      sameBytes(current, write.value)
    ) {
      return
    }
    slot.field = this.place(slot.from, write.value)
    slot.type = write.type
    slot.count = count
    slot.dirty = true
    this.changed = true
  }

  /**
   * Remove the GPS IFD entirely: zero its table and every out-of-line value
   * it holds, then drop IFD0's pointer to it. Unreferencing it would leave
   * the coordinates in the file for anyone with a hex editor.
   */
  scrubGps() {
    const pointer = this.ifd0.slots.find((s) => s.tag === TAG.gpsIfd)
    if (!pointer) return
    const gps = this.gpsIfd
    if (!gps) {
      // A pointer to nothing (0, or past the end) holds no location, and is
      // simply dropped. One into the block that did not read as an IFD, or
      // reached an IFD already walked, may hide coordinates: refuse.
      const from = pointer.from
      const target =
        from?.inline && from.size === 4
          ? get32(this.source, from.valueAt, this.little)
          : -1
      if (target !== 0 && target < this.source.length) {
        throw new EmbeddedWriteError(
          'This file’s location data is damaged, so it cannot be removed safely.',
        )
      }
      this.move(this.ifd0)
      this.ifd0.slots = this.ifd0.slots.filter((s) => s !== pointer)
      return
    }
    const owners = new Set<object>([gps, ...gps.entries])
    const spans: Array<[number, number]> = [[gps.at, gps.at + gps.length]]
    for (const e of gps.entries) {
      const range = this.range(e)
      if (range) spans.push(range)
    }
    for (const [start, end] of spans) {
      if (!this.exclusive(start, end, owners)) {
        throw new EmbeddedWriteError(
          'This file’s location data shares its bytes with other data, so it cannot be removed safely.',
        )
      }
    }
    this.move(this.ifd0)
    for (const [start, end] of spans) this.zero(start, end)
    this.ifd0.slots = this.ifd0.slots.filter((s) => s !== pointer)
    delete this.subs.gps
  }

  private entryBytes(slot: Slot): Uint8Array {
    const out = new Uint8Array(12)
    put16(out, 0, slot.tag, this.little)
    put16(out, 2, slot.type, this.little)
    put32(out, 4, slot.count, this.little)
    out.set(slot.field, 8)
    return out
  }

  /** Write a fresh copy of the IFD at the end and zero the old table. */
  private relocate(dir: Dir): number {
    const slots = [...dir.slots].sort((a, b) => a.tag - b.tag)
    const table = new Uint8Array(2 + slots.length * 12 + 4)
    put16(table, 0, slots.length, this.little)
    slots.forEach((slot, i) => table.set(this.entryBytes(slot), 2 + i * 12))
    put32(table, 2 + slots.length * 12, dir.ifd.next, this.little)
    const at = this.append(table)
    this.zero(dir.ifd.at, dir.ifd.at + dir.ifd.length)
    return at
  }

  finish(maxLength: number | undefined): Uint8Array {
    for (const kind of ['exif', 'gps'] as const) {
      const dir = this.subs[kind]
      if (!dir?.moved) continue
      const at = this.relocate(dir)
      const pointer = this.ifd0.slots.find((s) => s.tag === POINTER_TAG[kind])
      if (pointer) {
        pointer.field = encode32(at, this.little)
        pointer.dirty = true
      }
    }
    if (this.ifd0.moved)
      put32(this.work, 4, this.relocate(this.ifd0), this.little)
    for (const dir of [this.ifd0, this.subs.exif, this.subs.gps]) {
      if (!dir || dir.moved) continue
      for (const slot of dir.slots) {
        if (slot.dirty && slot.from)
          this.work.set(this.entryBytes(slot), slot.from.at)
      }
    }
    if (!this.changed) return this.source
    if (maxLength !== undefined && this.end > maxLength) {
      throw new EmbeddedWriteError(
        `This edit would make the file’s EXIF block larger than the ${maxLength} bytes it can hold.`,
      )
    }
    if (this.end > 0xffffffff) {
      throw new EmbeddedWriteError(
        'This edit would make the file larger than 4 GB.',
      )
    }
    const out = new Uint8Array(this.end)
    out.set(this.work)
    for (const { at, bytes } of this.tail) out.set(bytes, at)
    return out
  }
}

/** Every span of the block some known structure owns. */
function claimMap(b: Uint8Array, tree: TiffTree): Claim[] {
  const claims: Claim[] = [{ start: 0, end: 8, owner: HEADER_OWNER }]
  const h = tree.header
  for (const ifd of tree.all) {
    claims.push({ start: ifd.at, end: ifd.at + ifd.length, owner: ifd })
    for (const e of ifd.entries) {
      if (!e.inline && e.size > 0 && e.valueAt < b.length) {
        claims.push({
          start: e.valueAt,
          end: Math.min(e.valueAt + e.size, b.length),
          owner: e,
        })
      }
    }
    for (const [offsetTag, lengthTag] of DATA_PAIRS) {
      const offsets = entryOf(ifd, offsetTag)
      const lengths = entryOf(ifd, lengthTag)
      if (!offsets || !lengths) continue
      const n = Math.min(offsets.count, lengths.count)
      let low = Infinity
      let high = 0
      for (let i = 0; i < n; i++) {
        const start = uintAt(b, h, offsets, i)
        const size = uintAt(b, h, lengths, i)
        if (start === null || size === null) break
        if (i < MAX_DATA_RANGES) {
          claims.push({ start, end: start + size, owner: DATA_OWNER })
        } else {
          low = Math.min(low, start)
          high = Math.max(high, start + size)
        }
      }
      // Past the cap the rest is claimed as one envelope: conservative,
      // since a claimed span is only ever left alone.
      if (high > low) claims.push({ start: low, end: high, owner: DATA_OWNER })
    }
  }
  return claims
}

function validateWrite(write: TiffTagWrite) {
  if (!['ifd0', 'exif', 'gps'].includes(write.ifd)) {
    throw new EmbeddedWriteError(`There is no ${String(write.ifd)} directory.`)
  }
  if (!Number.isInteger(write.tag) || write.tag < 0 || write.tag > 0xffff) {
    throw new EmbeddedWriteError(`Tag ${write.tag} is not a TIFF tag number.`)
  }
  if (write.ifd !== 'gps' && STRUCTURAL_TAGS.has(write.tag)) {
    throw new EmbeddedWriteError(
      `Tag 0x${write.tag.toString(16)} locates other data in the file and cannot be edited.`,
    )
  }
  if (write.value === null) return
  const unit = TYPE_SIZE[write.type]
  if (unit === undefined || write.type > T.IFD) {
    throw new EmbeddedWriteError(
      `TIFF field type ${write.type} cannot be written.`,
    )
  }
  const count = write.count ?? write.value.length / unit
  if (
    !write.value.length ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 0xffffffff ||
    count * unit !== write.value.length
  ) {
    throw new EmbeddedWriteError(
      `The value for tag 0x${write.tag.toString(16)} does not match its type and count.`,
    )
  }
}

/**
 * The one writer behind {@link writeExif}, {@link writeTiffTags} and the
 * TIFF file writer: a canonical patch and raw tag writes, in a single pass
 * so an IFD is relocated at most once. Returns `tiff` itself when nothing
 * needed to change. Throws {@link EmbeddedWriteError} when the block cannot
 * take the edit safely; it never returns a corrupt block.
 */
export function editTiff(tiff: Uint8Array, edit: TiffEdit): Uint8Array {
  const header = readHeader(tiff)
  if (!header) {
    throw new EmbeddedWriteError(
      'The EXIF data in this file cannot be read, so it cannot be edited.',
    )
  }
  if (header.big) {
    throw new EmbeddedWriteError(
      'Metadata in a BigTIFF file can be read here but not edited.',
    )
  }
  const tree = walk(tiff)
  if (!tree?.ifd0) {
    throw new EmbeddedWriteError(
      'The EXIF data in this file is damaged, so it cannot be edited.',
    )
  }
  const plan = edit.patch
    ? planPatch(tiff, tree, edit.patch)
    : { writes: [], scrubGps: false }
  // One write per tag, the last one given.
  const latest = new Map<string, TiffTagWrite>()
  for (const write of [...plan.writes, ...(edit.writes ?? [])]) {
    validateWrite(write)
    const key = `${write.ifd}:${write.tag}`
    latest.delete(key)
    latest.set(key, write)
  }
  const editor = new TiffEditor(tiff, tree, tree.ifd0)
  if (plan.scrubGps) editor.scrubGps()
  for (const write of latest.values()) editor.set(write, edit.allowAdd ?? false)
  return editor.finish(edit.maxLength)
}

/**
 * Write a canonical patch into the EXIF tags that ALREADY EXIST — see the
 * module doc for which keys map where — and ignore every key this block
 * does not hold. `null` removes the tag; `gps: null` scrubs the GPS IFD.
 * `maxLength` is the block's ceiling: 65527 inside a JPEG APP1.
 */
export function writeExif(
  tiff: Uint8Array,
  patch: EmbeddedPatch,
  options?: { maxLength?: number },
): Uint8Array {
  return editTiff(tiff, { patch, maxLength: options?.maxLength })
}

/**
 * Set or remove raw tags. A tag that is absent is added only with
 * `allowAdd`, and is otherwise skipped; a removal of an absent tag is a
 * no-op. Tags that locate other data (strips, tiles, the thumbnail, the
 * Exif/GPS/Interop pointers, SubIFDs, the MakerNote) are refused.
 */
export function writeTiffTags(
  tiff: Uint8Array,
  writes: TiffTagWrite[],
  options?: { allowAdd?: boolean; maxLength?: number },
): Uint8Array {
  return editTiff(tiff, {
    writes,
    allowAdd: options?.allowAdd,
    maxLength: options?.maxLength,
  })
}
