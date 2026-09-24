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
 * The tags of an MP4, M4V or QuickTime film (AGL-3331). Read-only: a
 * change to `moov` moves every sample offset in the file, which is not an
 * edit this module will make to a customer's video.
 *
 * ## Reading without downloading the film
 *
 * Everything this reads lives in the `moov` box, which may sit before or
 * after the media data. The top level is walked one box HEADER at a time
 * through the random-access reader — eight bytes, sixteen for a 64-bit size
 * (ISO/IEC 14496-12 §4.2) — and `mdat` is skipped by its size, never read.
 * Then `moov` is read whole, up to {@link MP4_MOOV_MAX_BYTES}.
 *
 * ## Where a film keeps its tags
 *
 * - `moov/udta/meta/ilst` — iTunes-style items (`©nam`, `©ART`, `desc`, …),
 *   each holding a `data` atom whose type indicator says how to decode it
 *   (QuickTime File Format, "Well-known types"). `meta` is a full box in
 *   ISO files and a plain one in QuickTime files; both are handled.
 * - `moov/meta` with `keys` + `ilst` — the `mdta` handler Apple's cameras
 *   use (`com.apple.quicktime.title`, `.creationdate`, `.location.ISO6709`,
 *   …), where an item's type is a 1-based index into `keys`.
 * - `moov/udta` ©-atoms — QuickTime user-data text (`©nam`, `©day`, `©xyz`,
 *   …): a 16-bit length and a 16-bit language code, then the text.
 * - `moov/udta` 3GPP asset boxes (`titl`, `dscp`, `auth`, `perf`, `cprt`;
 *   3GPP TS 26.244 §8) — what AVFoundation writes for an `.mp4`.
 * - `mvhd` creation time, as the recording date of last resort.
 * - XMP, in the `uuid` box `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC` (XMP
 *   Specification Part 3 §1.2.7) at the top level or in `moov/udta`, or in
 *   a QuickTime `udta/XMP_` atom — returned for the XMP reader.
 *
 * When the same idea is written in several places, the first found in the
 * order above wins, except the XMP (merged by the dispatcher) and `mvhd`
 * (used only when no tag gave a date).
 */

import {
  otherEmbeddedKey,
  type MediaEmbeddedCanonicalKey,
} from '../media-embedded-fields'
import type { EmbeddedByteReader, EmbeddedCandidate } from './types'

/** Above this, `moov` is not read and the film reads as having no tags. */
export const MP4_MOOV_MAX_BYTES = 32 * 1024 * 1024
const XMP_MAX_BYTES = 8 * 1024 * 1024
/** A fragmented film has thousands of top-level boxes; tags come early. */
const MAX_TOP_LEVEL_BOXES = 1024
const MAX_CHILDREN = 4096
const MAX_KEYS = 4096

const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91,
  0xe3, 0xaf, 0xac,
]

/** Seconds from 1904-01-01T00:00:00Z, the ISO BMFF epoch, to 1970's. */
const EPOCH_1904 = 2082844800

interface Box {
  type: string
  start: number
  /** Where the payload begins. */
  body: number
  end: number
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** A four-character code, one Latin-1 character per byte (`©` is 0xA9). */
const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4))

/** A plausible box type: printable ASCII or `©`. */
const plausibleType = (type: string) =>
  type.length === 4 && /^[\x20-\x7e\xa9]{4}$/.test(type)

const utf8 = (bytes: Uint8Array) =>
  new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '')

/** UTF-8 when the bytes are valid UTF-8, otherwise Mac OS Roman. */
function macText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/\0+$/, '')
  } catch {
    try {
      return new TextDecoder('macintosh').decode(bytes).replace(/\0+$/, '')
    } catch {
      return new TextDecoder('latin1').decode(bytes).replace(/\0+$/, '')
    }
  }
}

/**
 * A string that may open with a UTF-16 byte-order mark (3GPP TS 26.244
 * §8.1); a stray odd byte — half a terminator — is dropped.
 */
function bomText(bytes: Uint8Array): string {
  const even = bytes.subarray(2, 2 + ((bytes.length - 2) & ~1))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(even).replace(/\0+$/, '')
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(even).replace(/\0+$/, '')
  return utf8(bytes)
}

/**
 * The boxes inside `bytes[start, end)` (ISO/IEC 14496-12 §4.2). A box that
 * claims to run past its parent is cut at the parent's end and ends the
 * walk; a size smaller than its own header ends it too.
 */
function children(bytes: Uint8Array, start: number, end: number): Box[] {
  const data = view(bytes)
  const out: Box[] = []
  let at = start
  while (at + 8 <= end && out.length < MAX_CHILDREN) {
    let size = data.getUint32(at)
    let body = at + 8
    if (size === 1) {
      if (at + 16 > end) break
      size = data.getUint32(at + 8) * 0x100000000 + data.getUint32(at + 12)
      body = at + 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < body - at) break
    const boxEnd = Math.min(end, at + size)
    out.push({ type: fourcc(bytes, at + 4), start: at, body, end: boxEnd })
    if (at + size > end) break
    at = boxEnd
  }
  return out
}

const child = (bytes: Uint8Array, box: Box, type: string) =>
  children(bytes, box.body, box.end).find((item) => item.type === type)

/**
 * Normalize a tag's date to the catalog's form. QuickTime writes the zone
 * as `-0700`, iTunes as `Z`, some tools not at all; a year alone is kept.
 */
function normalizeDate(raw: string): string {
  const value = raw.trim()
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:[.,](\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      value,
    )
  if (!match) return value
  const [, date, time, fraction, zone] = match
  let offset = zone ?? ''
  if (offset && offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '')
    offset = `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || '00'}`
  }
  return `${date}T${time}${fraction ? `.${fraction.slice(0, 3)}` : ''}${offset}`
}

/**
 * An ISO 6709 point (`+37.7749-122.4194+010.000/`) as `"lat,lon"` with six
 * places. Latitude has 2, 4 or 6 integer digits (degrees, degrees and
 * minutes, or degrees minutes seconds); longitude 3, 5 or 7 (ISO 6709
 * Annex H). Null for anything else or out of range.
 */
export function parseIso6709(raw: string): string | null {
  const match = /^([+-])(\d+)(\.\d+)?([+-])(\d+)(\.\d+)?/.exec(raw.trim())
  if (!match) return null
  const [, latSign, latInt, latFraction, lonSign, lonInt, lonFraction] = match
  const part = (
    digits: string,
    fraction: string | undefined,
    degreeDigits: number,
  ) => {
    const whole = digits.length - degreeDigits
    if (whole !== 0 && whole !== 2 && whole !== 4) return NaN
    const frac = Number(`0${fraction ?? ''}`)
    const degrees = Number(digits.slice(0, degreeDigits))
    if (whole === 0) return degrees + frac
    const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2))
    if (whole === 2) return degrees + (minutes + frac) / 60
    const seconds = Number(digits.slice(degreeDigits + 2, degreeDigits + 4))
    return degrees + minutes / 60 + (seconds + frac) / 3600
  }
  const lat = part(latInt ?? '', latFraction, 2) * (latSign === '-' ? -1 : 1)
  const lon = part(lonInt ?? '', lonFraction, 3) * (lonSign === '-' ? -1 : 1)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const fixed = (value: number) => (value === 0 ? 0 : value).toFixed(6)
  return `${fixed(lat)},${fixed(lon)}`
}

/** A big-endian integer of 1 to 8 bytes, as decimal text. */
function integerText(bytes: Uint8Array, signed: boolean): string | null {
  if (bytes.length < 1 || bytes.length > 8) return null
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  if (signed && bytes.length && (bytes[0] ?? 0) & 0x80) {
    value -= 1n << BigInt(bytes.length * 8)
  }
  return value.toString()
}

/**
 * A `data` atom's value (QuickTime File Format, "Well-known types"): text
 * and numbers only. Images, binary and the "implicit" type 0 (track and
 * disc numbers, genre ids) are not shown.
 */
function dataValue(type: number, value: Uint8Array): string | null {
  const data = view(value)
  switch (type) {
    case 1: // UTF-8
    case 4: // UTF-8 sort
      return utf8(value)
    case 2: // UTF-16 BE
    case 5: // UTF-16 BE sort
      return new TextDecoder('utf-16be').decode(value).replace(/\0+$/, '')
    case 21: // BE signed integer, 1-4 or 8 bytes
      return integerText(value, true)
    case 22: // BE unsigned integer
      return integerText(value, false)
    case 23: // BE float32
      return value.length === 4 ? String(data.getFloat32(0)) : null
    case 24: // BE float64
      return value.length === 8 ? String(data.getFloat64(0)) : null
    case 65: // 8-bit signed
    case 66: // BE 16-bit signed
    case 67: // BE 32-bit signed
    case 74: // BE 64-bit signed
      return integerText(value, true)
    case 75: // 8-bit unsigned
    case 76:
    case 77:
    case 78:
      return integerText(value, false)
    default:
      return null
  }
}

/** The first decodable `data` atom of an item: its value and whether it is text. */
function itemValue(
  bytes: Uint8Array,
  item: Box,
): { text: string; numeric: boolean } | null {
  for (const atom of children(bytes, item.body, item.end)) {
    if (atom.type !== 'data' || atom.body + 8 > atom.end) continue
    // 1 reserved byte + 3-byte type indicator, then a 4-byte locale.
    const type = view(bytes).getUint32(atom.body) & 0xffffff
    const text = dataValue(type, bytes.subarray(atom.body + 8, atom.end))
    if (text !== null) return { text, numeric: ![1, 2, 4, 5].includes(type) }
  }
  return null
}

/** `mean` and `name` are full boxes holding a UTF-8 string. */
const fullBoxText = (bytes: Uint8Array, box: Box | undefined) =>
  box && box.body + 4 <= box.end
    ? utf8(bytes.subarray(box.body + 4, box.end))
    : ''

type VideoKey = Extract<
  MediaEmbeddedCanonicalKey,
  | 'title'
  | 'creator'
  | 'description'
  | 'comment'
  | 'createdAt'
  | 'copyright'
  | 'encoder'
  | 'software'
  | 'make'
  | 'model'
  | 'keywords'
  | 'gps'
>

/**
 * iTunes item atoms and QuickTime user-data atoms. `ldes` (long
 * description) outranks `desc` when a file has both.
 */
const ATOM_KEYS: Record<string, VideoKey> = {
  '©nam': 'title',
  '©ART': 'creator',
  '©aut': 'creator',
  ldes: 'description',
  desc: 'description',
  '©des': 'description',
  '©cmt': 'comment',
  '©day': 'createdAt',
  cprt: 'copyright',
  '©cpy': 'copyright',
  '©too': 'encoder',
  '©swr': 'encoder',
  '©mak': 'make',
  '©mod': 'model',
  keyw: 'keywords',
  '©xyz': 'gps',
}

/** Apple's `mdta` keys (QuickTime File Format, "QuickTime metadata keys"). */
const MDTA_KEYS: Record<string, VideoKey> = {
  'com.apple.quicktime.title': 'title',
  'com.apple.quicktime.description': 'description',
  'com.apple.quicktime.artist': 'creator',
  'com.apple.quicktime.author': 'creator',
  'com.apple.quicktime.comment': 'comment',
  'com.apple.quicktime.creationdate': 'createdAt',
  'com.apple.quicktime.location.ISO6709': 'gps',
  'com.apple.quicktime.make': 'make',
  'com.apple.quicktime.model': 'model',
  'com.apple.quicktime.software': 'software',
  'com.apple.quicktime.keywords': 'keywords',
  'com.apple.quicktime.copyright': 'copyright',
}

/** Labels for the atoms outside the catalog that a person would recognize. */
const ATOM_LABELS: Record<string, string> = {
  '©alb': 'Album',
  aART: 'Album artist',
  '©gen': 'Genre',
  '©wrt': 'Composer',
  '©grp': 'Grouping',
  '©lyr': 'Lyrics',
  '©dir': 'Director',
  '©prd': 'Producer',
  '©PRD': 'Product',
  '©enc': 'Encoded by',
  '©inf': 'Information',
  '©req': 'Requirements',
  '©src': 'Source credits',
  '©fmt': 'Format',
  '©prf': 'Performers',
  '©st3': 'Subtitle',
  tvsh: 'TV show',
  tvnn: 'TV network',
  tven: 'TV episode',
  catg: 'Category',
  tmpo: 'Tempo',
}

/**
 * Candidates by key, the first of equal rank kept: a lower `rank` is a
 * stronger place for the same idea.
 */
class Collector {
  private readonly byKey = new Map<
    string,
    { candidate: EmbeddedCandidate; rank: number }
  >()

  add(key: string, value: string, rank: number, label?: string): void {
    const text = value.trim()
    if (!text) return
    let candidate: EmbeddedCandidate
    if (key === 'gps') {
      const point = parseIso6709(text)
      if (!point) return
      candidate = { key, value: point, source: 'mp4', editable: false }
    } else if (key === 'keywords') {
      const items = text
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (!items.length) return
      candidate = { key, value: items, source: 'mp4', editable: false }
    } else if (key === 'creator') {
      candidate = { key, value: [text], source: 'mp4', editable: false }
    } else if (key === 'createdAt') {
      candidate = {
        key,
        value: normalizeDate(text),
        source: 'mp4',
        editable: false,
      }
    } else {
      candidate = { key, value: text, source: 'mp4', editable: false }
      if (label) candidate.label = label
    }
    const held = this.byKey.get(key)
    if (!held || rank < held.rank) this.byKey.set(key, { candidate, rank })
  }

  has(key: string): boolean {
    return this.byKey.has(key)
  }

  candidates(): EmbeddedCandidate[] {
    return [...this.byKey.values()].map(({ candidate }) => candidate)
  }
}

/** Ranks: Apple keys, then iTunes items, then user-data atoms, then 3GPP. */
const RANK_MDTA = 0
const RANK_ILST = 10
const RANK_UDTA = 20
const RANK_3GPP = 30

/**
 * The two ways a tag is named: a four-character atom (iTunes items,
 * QuickTime user data) or an Apple `mdta` key. Only a labeled atom's number
 * is worth showing — `stik` or `rtng` alone means nothing to a person — and
 * an atom whose name is not printable is noise from a damaged file.
 */
const ATOMS = { keys: ATOM_KEYS, labels: ATOM_LABELS, mdta: false } as const
const MDTA = {
  keys: MDTA_KEYS,
  labels: {} as Record<string, string>,
  mdta: true,
} as const

/** An item under a known key or atom, or an "other" field. */
function addTag(
  out: Collector,
  name: string,
  value: { text: string; numeric: boolean },
  rank: number,
  naming: typeof ATOMS | typeof MDTA,
): void {
  const key = naming.keys[name]
  if (key) {
    // `ldes` outranks `desc` within one container.
    out.add(key, value.text, rank + (name === 'desc' ? 1 : 0))
    return
  }
  const label = naming.labels[name]
  if (!naming.mdta && (!plausibleType(name) || (value.numeric && !label)))
    return
  out.add(otherEmbeddedKey('mp4', name), value.text, rank, label ?? name)
}

/**
 * A `meta` box: `hdlr`, optional `keys`, `ilst`. ISO/IEC 14496-12 §8.11.1
 * makes it a full box; QuickTime's is a plain one — whichever layout puts
 * `hdlr` (or failing that, any plausible box) first is the one used.
 */
function readMeta(
  bytes: Uint8Array,
  meta: Box,
  rank: number,
  out: Collector,
): void {
  const hdlrAt = (at: number) =>
    at + 8 <= meta.end && fourcc(bytes, at + 4) === 'hdlr'
  let body = meta.body
  if (hdlrAt(meta.body + 4)) body = meta.body + 4
  else if (
    !hdlrAt(meta.body) &&
    meta.body + 4 <= meta.end &&
    view(bytes).getUint32(meta.body) === 0
  )
    body = meta.body + 4
  const boxes = children(bytes, body, meta.end)

  const hdlr = boxes.find((box) => box.type === 'hdlr')
  // hdlr: version+flags, pre_defined, then handler_type (§8.4.3).
  const handler =
    hdlr && hdlr.body + 12 <= hdlr.end ? fourcc(bytes, hdlr.body + 8) : ''

  const keys: string[] = []
  const keysBox = boxes.find((box) => box.type === 'keys')
  if (keysBox && keysBox.body + 8 <= keysBox.end) {
    const data = view(bytes)
    const count = Math.min(MAX_KEYS, data.getUint32(keysBox.body + 4))
    let at = keysBox.body + 8
    for (let index = 0; index < count && at + 8 <= keysBox.end; index++) {
      const size = data.getUint32(at)
      if (size < 8 || at + size > keysBox.end) break
      keys.push(utf8(bytes.subarray(at + 8, at + size)))
      at += size
    }
  }

  const ilst = boxes.find((box) => box.type === 'ilst')
  if (!ilst) return
  const indexed = handler === 'mdta' || keys.length > 0
  for (const item of children(bytes, ilst.body, ilst.end)) {
    if (indexed) {
      // The item's type is a 1-based index into `keys`.
      const name = keys[view(bytes).getUint32(item.start + 4) - 1]
      const value = itemValue(bytes, item)
      if (name && value) addTag(out, name, value, RANK_MDTA, MDTA)
      continue
    }
    if (item.type === '----') {
      const parts = children(bytes, item.body, item.end)
      const name = fullBoxText(
        bytes,
        parts.find((box) => box.type === 'name'),
      )
      const value = itemValue(bytes, item)
      if (name && value)
        out.add(otherEmbeddedKey('mp4', name), value.text, rank, name)
      continue
    }
    const value = itemValue(bytes, item)
    if (value) addTag(out, item.type, value, rank, ATOMS)
  }
}

/**
 * A QuickTime user-data text atom: one or more `[length][language][text]`
 * items; the first is used. A language code under 0x400 is a Macintosh
 * one, whose text is Mac OS Roman; above it, packed ISO 639-2 with UTF-8.
 * Some writers put an iTunes `data` atom here instead, which is honored.
 */
function userDataText(
  bytes: Uint8Array,
  atom: Box,
): { text: string; numeric: boolean } | null {
  if (atom.body + 8 <= atom.end && fourcc(bytes, atom.body + 4) === 'data') {
    return itemValue(bytes, atom)
  }
  if (atom.body + 4 > atom.end) return null
  const data = view(bytes)
  const length = data.getUint16(atom.body)
  const language = data.getUint16(atom.body + 2)
  const end = atom.body + 4 + length
  if (end > atom.end) return null
  const raw = bytes.subarray(atom.body + 4, end)
  return {
    text: language < 0x400 ? macText(raw) : bomText(raw),
    numeric: false,
  }
}

/**
 * 3GPP asset boxes: full box, 16-bit pad+language, then a string. The
 * performer stands in for the author when there is none — AVFoundation
 * writes an MP4's artist as `perf`.
 */
const THREE_GPP_KEYS: Record<string, { key: VideoKey; rank: number }> = {
  titl: { key: 'title', rank: 0 },
  dscp: { key: 'description', rank: 0 },
  auth: { key: 'creator', rank: 0 },
  perf: { key: 'creator', rank: 1 },
  cprt: { key: 'copyright', rank: 0 },
}

function isXmpUuid(bytes: Uint8Array, at: number): boolean {
  return XMP_UUID.every((byte, index) => bytes[at + index] === byte)
}

function readUserData(
  bytes: Uint8Array,
  udta: Box,
  out: Collector,
  xmp: { value: string | null },
): void {
  for (const atom of children(bytes, udta.body, udta.end)) {
    if (atom.type === 'meta') {
      readMeta(bytes, atom, RANK_ILST, out)
    } else if (atom.type === 'XMP_') {
      xmp.value ??= utf8(bytes.subarray(atom.body, atom.end))
    } else if (atom.type === 'uuid') {
      if (atom.body + 16 <= atom.end && isXmpUuid(bytes, atom.body)) {
        xmp.value ??= utf8(bytes.subarray(atom.body + 16, atom.end))
      }
    } else if (atom.type.startsWith('©')) {
      const value = userDataText(bytes, atom)
      if (value) addTag(out, atom.type, value, RANK_UDTA, ATOMS)
    } else {
      const asset = THREE_GPP_KEYS[atom.type]
      if (asset && atom.body + 6 <= atom.end) {
        const text = bomText(bytes.subarray(atom.body + 6, atom.end))
        out.add(asset.key, text, RANK_3GPP + asset.rank)
      }
    }
  }
}

/** `mvhd` creation time (§8.2.2): seconds since 1904 in UTC; 0 is unset. */
function movieCreated(bytes: Uint8Array, mvhd: Box): string | null {
  const data = view(bytes)
  if (mvhd.body + 4 > mvhd.end) return null
  const version = bytes[mvhd.body] ?? 0
  let seconds: number
  if (version === 1) {
    if (mvhd.body + 12 > mvhd.end) return null
    seconds =
      data.getUint32(mvhd.body + 4) * 0x100000000 +
      data.getUint32(mvhd.body + 8)
  } else {
    if (mvhd.body + 8 > mvhd.end) return null
    seconds = data.getUint32(mvhd.body + 4)
  }
  if (!seconds) return null
  const date = new Date((seconds - EPOCH_1904) * 1000)
  const year = date.getUTCFullYear()
  if (Number.isNaN(date.getTime()) || year < 1904 || year > 9999) return null
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** A top-level box header, read on its own (§4.2). Null past the end. */
async function topLevelBox(
  reader: EmbeddedByteReader,
  at: number,
): Promise<(Box & { declaredEnd: number }) | null> {
  if (at + 8 > reader.size) return null
  const head = await reader.read(at, at + 8)
  if (head.length < 8) return null
  let size = view(head).getUint32(0)
  let body = at + 8
  if (size === 1) {
    if (at + 16 > reader.size) return null
    const large = await reader.read(at + 8, at + 16)
    if (large.length < 8) return null
    size = view(large).getUint32(0) * 0x100000000 + view(large).getUint32(4)
    if (!Number.isSafeInteger(size)) return null
    body = at + 16
  } else if (size === 0) {
    size = reader.size - at
  }
  if (size < body - at) return null
  return {
    type: fourcc(head, 4),
    start: at,
    body,
    end: Math.min(reader.size, at + size),
    declaredEnd: at + size,
  }
}

/**
 * Read a film's tags through random access.
 *
 * Null when the bytes do not open like an ISO BMFF or QuickTime file, have
 * no `moov`, or have a `moov` over {@link MP4_MOOV_MAX_BYTES}. Every
 * candidate is `editable: false`.
 */
export async function readMp4(
  reader: EmbeddedByteReader,
): Promise<{ candidates: EmbeddedCandidate[]; xmp: string | null } | null> {
  let moov: (Box & { declaredEnd: number }) | null = null
  const xmp: { value: string | null } = { value: null }
  let at = 0
  for (
    let count = 0;
    count < MAX_TOP_LEVEL_BOXES && at < reader.size;
    count++
  ) {
    const box = await topLevelBox(reader, at)
    if (!box || !plausibleType(box.type)) {
      if (count === 0) return null
      break
    }
    if (box.type === 'moov') {
      moov ??= box
    } else if (box.type === 'uuid' && xmp.value === null) {
      const length = box.end - box.body - 16
      if (length > 0 && length <= XMP_MAX_BYTES) {
        const id = await reader.read(box.body, box.body + 16)
        if (isXmpUuid(id, 0)) {
          xmp.value = utf8(await reader.read(box.body + 16, box.end))
        }
      }
    } else if (box.type === 'moof' && moov) {
      // A fragmented film: what follows is media, fragment after fragment.
      break
    }
    at = box.declaredEnd
  }
  if (!moov) return null
  if (moov.declaredEnd - moov.start > MP4_MOOV_MAX_BYTES) return null

  const bytes = await reader.read(moov.start, moov.end)
  const box: Box = {
    type: 'moov',
    start: 0,
    body: moov.body - moov.start,
    end: bytes.length,
  }
  const out = new Collector()
  const boxes = children(bytes, box.body, box.end)
  const meta = boxes.find((item) => item.type === 'meta')
  if (meta) readMeta(bytes, meta, RANK_MDTA, out)
  const udta = boxes.find((item) => item.type === 'udta')
  if (udta) readUserData(bytes, udta, out, xmp)
  const mvhd = child(bytes, box, 'mvhd')
  if (mvhd && !out.has('createdAt')) {
    const created = movieCreated(bytes, mvhd)
    if (created) out.add('createdAt', created, Number.MAX_SAFE_INTEGER)
  }
  return { candidates: out.candidates(), xmp: xmp.value }
}
