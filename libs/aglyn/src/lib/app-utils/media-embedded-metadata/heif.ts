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
 * HEIF metadata blocks — HEIC, HEIF and AVIF — read-only (AGL-3331).
 *
 * These are ISO base media files (ISO/IEC 14496-12): a run of boxes, each a
 * 32-bit size (1 = a 64-bit size follows, 0 = to the end), a four-character
 * type, and a payload. A still image's metadata is not in a box of its own
 * but in ITEMS (ISO/IEC 23008-12, 6 and Annex A):
 *
 * - `meta` (a full box) holds the item catalogue.
 * - `iinf` lists the items; each `infe` (versions 2 and 3) names an item's
 *   type. EXIF is item type `Exif`; XMP is item type `mime` with content
 *   type `application/rdf+xml`.
 * - `iloc` (versions 0–2) says where each item's bytes are: a base offset
 *   and extents, with field widths the box itself declares. Only
 *   construction method 0 (offsets into this file) is followed.
 * - An `Exif` item starts with a 4-byte `exif_tiff_header_offset` (Annex
 *   A.2.1), the number of bytes — usually the six of `Exif\0\0` — between
 *   that field and the TIFF header.
 * - `iref` `cdsc` references say which item a metadata item describes; the
 *   EXIF and XMP of the primary item (`pitm`) are preferred over those of a
 *   thumbnail or an auxiliary image.
 * - The ICC profile is a `colr` property of type `prof` or `rICC` in
 *   `iprp`/`ipco`.
 *
 * HEIF is not writable here: its item offsets are absolute, so resizing an
 * item would move every extent after it.
 */

import { inflateRawSync, inflateSync } from 'zlib'
import {
  asciiBytes,
  bytesAt,
  concatBytes,
  readAscii,
  readU16BE,
  readU32BE,
  trimNul,
  utf8Decode,
  type ImageBlocks,
} from './image-blocks'

/** `ftyp` brands that mark an image in the HEIF family. */
const HEIF_BRANDS = new Set([
  'mif1',
  'mif2',
  'msf1',
  'miaf',
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'avif',
  'avis',
  'avio',
])

const EXIF_HEADER = asciiBytes('Exif\0\0')
const TIFF_II = asciiBytes('II*\0')
const TIFF_MM = asciiBytes('MM\0*')

/** Box and item counts past which the walk stops. */
const MAX_BOXES = 65536
const MAX_ITEMS = 65536
/** The most a deflate-encoded XMP item may inflate to. */
const MAX_INFLATED = 32 * 1024 * 1024

interface Box {
  type: string
  start: number
  /** First payload byte, after the size, type and any large size. */
  payload: number
  end: number
}

/** 2^53 bounds a safe integer; a 64-bit field above it is not an offset. */
function readU64BE(bytes: Uint8Array, offset: number): number {
  const high = readU32BE(bytes, offset)
  if (high > 0x1fffff) return Number.NaN
  return high * 0x100000000 + readU32BE(bytes, offset + 4)
}

/** Reads the boxes laid end to end in `[start, end)`, stopping at damage. */
function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = []
  const limit = Math.min(end, bytes.length)
  let offset = start
  while (offset + 8 <= limit && boxes.length < MAX_BOXES) {
    let size = readU32BE(bytes, offset)
    let header = 8
    if (size === 1) {
      if (offset + 16 > limit) break
      size = readU64BE(bytes, offset + 8)
      header = 16
    } else if (size === 0) {
      size = limit - offset
    }
    if (!(size >= header) || offset + size > limit) break
    boxes.push({
      type: readAscii(bytes, offset + 4, 4),
      start: offset,
      payload: offset + header,
      end: offset + size,
    })
    offset += size
  }
  return boxes
}

/** An unsigned big-endian integer of 0, 4 or 8 bytes, or NaN otherwise. */
function readSized(bytes: Uint8Array, offset: number, size: number): number {
  if (size === 0) return 0
  if (size === 4) return readU32BE(bytes, offset)
  if (size === 8) return readU64BE(bytes, offset)
  return Number.NaN
}

/** A NUL-terminated string inside `[offset, end)`, and where it ends. */
function readCString(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { text: string; next: number } {
  const nul = bytes.subarray(0, end).indexOf(0, offset)
  const stop = nul < 0 ? end : nul
  return { text: utf8Decode(bytes.subarray(offset, stop)), next: stop + 1 }
}

interface ItemInfo {
  id: number
  type: string
  contentType?: string
  contentEncoding?: string
}

/** The `infe` entries of an `iinf` box (ISO/IEC 14496-12, 8.11.6). */
function readItemInfos(bytes: Uint8Array, iinf: Box): ItemInfo[] {
  const version = bytes[iinf.payload] ?? 0
  const entries = iinf.payload + 4 + (version === 0 ? 2 : 4)
  const items: ItemInfo[] = []
  for (const infe of readBoxes(bytes, entries, iinf.end)) {
    if (infe.type !== 'infe' || items.length >= MAX_ITEMS) continue
    const infeVersion = bytes[infe.payload] ?? 0
    // Versions 0 and 1 predate item types; HEIF requires 2 or 3.
    if (infeVersion !== 2 && infeVersion !== 3) continue
    let at = infe.payload + 4
    const id = infeVersion === 2 ? readU16BE(bytes, at) : readU32BE(bytes, at)
    at += infeVersion === 2 ? 2 : 4
    at += 2 // item_protection_index
    if (at + 4 > infe.end) continue
    const type = readAscii(bytes, at, 4)
    at += 4
    const item: ItemInfo = { id, type }
    const name = readCString(bytes, at, infe.end)
    if (type === 'mime' && name.next < infe.end) {
      const contentType = readCString(bytes, name.next, infe.end)
      item.contentType = contentType.text
      if (contentType.next < infe.end) {
        item.contentEncoding = readCString(
          bytes,
          contentType.next,
          infe.end,
        ).text
      }
    }
    items.push(item)
  }
  return items
}

interface ItemLocation {
  constructionMethod: number
  dataReferenceIndex: number
  extents: { offset: number; length: number }[]
}

/**
 * The locations of the wanted items from an `iloc` box (ISO/IEC 14496-12,
 * 8.11.3), or an empty map when the box is malformed.
 */
function readItemLocations(
  bytes: Uint8Array,
  iloc: Box,
  wanted: Set<number>,
): Map<number, ItemLocation> {
  const out = new Map<number, ItemLocation>()
  const version = bytes[iloc.payload] ?? 0
  if (version > 2) return out
  let at = iloc.payload + 4
  const sizes = bytes[at] ?? 0
  const sizes2 = bytes[at + 1] ?? 0
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 0x0f
  const baseOffsetSize = sizes2 >> 4
  const indexSize = version === 1 || version === 2 ? sizes2 & 0x0f : 0
  at += 2
  const itemCount = version < 2 ? readU16BE(bytes, at) : readU32BE(bytes, at)
  at += version < 2 ? 2 : 4
  for (let i = 0; i < itemCount && i < MAX_ITEMS; i += 1) {
    if (at >= iloc.end) break
    const id = version < 2 ? readU16BE(bytes, at) : readU32BE(bytes, at)
    at += version < 2 ? 2 : 4
    let constructionMethod = 0
    if (version === 1 || version === 2) {
      constructionMethod = readU16BE(bytes, at) & 0x0f
      at += 2
    }
    const dataReferenceIndex = readU16BE(bytes, at)
    at += 2
    const baseOffset = readSized(bytes, at, baseOffsetSize)
    at += baseOffsetSize
    const extentCount = readU16BE(bytes, at)
    at += 2
    const extents: { offset: number; length: number }[] = []
    for (let e = 0; e < extentCount; e += 1) {
      at += indexSize
      const offset = readSized(bytes, at, offsetSize)
      at += offsetSize
      const length = readSized(bytes, at, lengthSize)
      at += lengthSize
      if (
        at > iloc.end ||
        Number.isNaN(offset) ||
        Number.isNaN(length) ||
        Number.isNaN(baseOffset)
      ) {
        return out
      }
      extents.push({ offset: baseOffset + offset, length })
    }
    if (wanted.has(id) && !out.has(id)) {
      out.set(id, { constructionMethod, dataReferenceIndex, extents })
    }
  }
  return out
}

/** The item's bytes, or `null` when it is stored anywhere but this file. */
function itemBytes(
  bytes: Uint8Array,
  location: ItemLocation | undefined,
): Uint8Array | null {
  if (
    !location ||
    location.constructionMethod !== 0 ||
    location.dataReferenceIndex !== 0
  ) {
    return null
  }
  if (!location.extents.length) return null
  const parts: Uint8Array[] = []
  for (const { offset, length } of location.extents) {
    // A zero length means "to the end of the file" (8.11.3.3).
    const end = length === 0 ? bytes.length : offset + length
    if (offset < 0 || offset > bytes.length || end > bytes.length) return null
    parts.push(bytes.subarray(offset, end))
  }
  return concatBytes(parts)
}

/**
 * The TIFF bytes of an `Exif` item: past the 4-byte offset field and the
 * offset it gives. Writers have been seen to leave `Exif\0\0` in front of
 * the header while declaring an offset of 0, or to declare 6 with no prefix
 * written, so those two readings are tried too — but only where a TIFF
 * header actually begins, never a guess.
 */
function exifFromItem(payload: Uint8Array): Uint8Array | undefined {
  const isTiff = (at: number) =>
    bytesAt(payload, at, TIFF_II) || bytesAt(payload, at, TIFF_MM)
  const declared = 4 + readU32BE(payload, 0)
  for (const at of [declared, 4]) {
    if (isTiff(at)) return payload.slice(at)
    if (bytesAt(payload, at, EXIF_HEADER) && isTiff(at + EXIF_HEADER.length)) {
      return payload.slice(at + EXIF_HEADER.length)
    }
  }
  return undefined
}

/** The text of an XMP item, decoding a `deflate` content encoding. */
function xmpFromItem(
  payload: Uint8Array,
  encoding: string | undefined,
): string | undefined {
  let data: Uint8Array = payload
  if (encoding === 'deflate') {
    try {
      data = new Uint8Array(
        inflateSync(payload, { maxOutputLength: MAX_INFLATED }),
      )
    } catch {
      try {
        data = new Uint8Array(
          inflateRawSync(payload, { maxOutputLength: MAX_INFLATED }),
        )
      } catch {
        return undefined
      }
    }
  } else if (encoding) {
    return undefined
  }
  return trimNul(utf8Decode(data))
}

/** The item ids each `cdsc` reference says an item describes. */
function describedBy(
  bytes: Uint8Array,
  iref: Box | undefined,
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  if (!iref) return out
  const wide = (bytes[iref.payload] ?? 0) === 1
  const idSize = wide ? 4 : 2
  const readId = (at: number) =>
    wide ? readU32BE(bytes, at) : readU16BE(bytes, at)
  for (const reference of readBoxes(bytes, iref.payload + 4, iref.end)) {
    if (reference.type !== 'cdsc') continue
    const from = readId(reference.payload)
    const count = readU16BE(bytes, reference.payload + idSize)
    const to: number[] = []
    for (let i = 0; i < count; i += 1) {
      const at = reference.payload + idSize + 2 + i * idSize
      if (at + idSize > reference.end) break
      to.push(readId(at))
    }
    out.set(from, to)
  }
  return out
}

/**
 * Reads the metadata blocks of a HEIC, HEIF or AVIF image. Returns `null`
 * when the bytes are not in the HEIF family (no `ftyp` with a HEIF brand);
 * a malformed file yields what could be read.
 */
export function readHeifBlocks(bytes: Uint8Array): ImageBlocks | null {
  const top = readBoxes(bytes, 0, bytes.length)
  const ftyp = top[0]
  if (!ftyp || ftyp.type !== 'ftyp') return null
  // The major brand, a minor version (skipped), then compatible brands.
  let heif = HEIF_BRANDS.has(readAscii(bytes, ftyp.payload, 4))
  for (let at = ftyp.payload + 8; at + 4 <= ftyp.end && !heif; at += 4) {
    heif = HEIF_BRANDS.has(readAscii(bytes, at, 4))
  }
  if (!heif) return null

  const blocks: ImageBlocks = {}
  const meta = top.find((box) => box.type === 'meta')
  if (!meta) return blocks
  const children = readBoxes(bytes, meta.payload + 4, meta.end)
  const child = (type: string) => children.find((box) => box.type === type)

  const iprp = child('iprp')
  const ipco =
    iprp &&
    readBoxes(bytes, iprp.payload, iprp.end).find((box) => box.type === 'ipco')
  for (const property of ipco ? readBoxes(bytes, ipco.payload, ipco.end) : []) {
    if (property.type !== 'colr' || property.payload + 4 > property.end)
      continue
    const colourType = readAscii(bytes, property.payload, 4)
    if (colourType === 'prof' || colourType === 'rICC') {
      blocks.icc = bytes.slice(property.payload + 4, property.end)
      break
    }
  }

  const iinf = child('iinf')
  const iloc = child('iloc')
  if (!iinf || !iloc) return blocks
  const infos = readItemInfos(bytes, iinf)
  const exifItems = infos.filter((item) => item.type === 'Exif')
  const xmpItems = infos.filter(
    (item) =>
      item.type === 'mime' &&
      item.contentType?.trim().toLowerCase() === 'application/rdf+xml',
  )
  if (!exifItems.length && !xmpItems.length) return blocks

  const pitm = child('pitm')
  const primary = pitm
    ? (bytes[pitm.payload] ?? 0) === 0
      ? readU16BE(bytes, pitm.payload + 4)
      : readU32BE(bytes, pitm.payload + 4)
    : undefined
  const references = describedBy(bytes, child('iref'))
  // The primary image's own metadata first, then the rest in file order.
  const describesPrimary = (item: ItemInfo) =>
    primary !== undefined && (references.get(item.id) ?? []).includes(primary)
  const rank = (items: ItemInfo[]) => [
    ...items.filter(describesPrimary),
    ...items.filter((item) => !describesPrimary(item)),
  ]

  const locations = readItemLocations(
    bytes,
    iloc,
    new Set([...exifItems, ...xmpItems].map((item) => item.id)),
  )
  for (const item of rank(exifItems)) {
    const payload = itemBytes(bytes, locations.get(item.id))
    const exif = payload && exifFromItem(payload)
    if (exif) {
      blocks.exif = exif
      break
    }
  }
  for (const item of rank(xmpItems)) {
    const payload = itemBytes(bytes, locations.get(item.id))
    const xmp = payload && xmpFromItem(payload, item.contentEncoding)
    if (xmp) {
      blocks.xmp = xmp
      break
    }
  }
  return blocks
}
