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
 * A minimal ZIP reader and entry-replacing rewriter (AGL-3331) — enough to
 * read an Office package's property parts and write them back without
 * touching any other part of the package.
 *
 * Section numbers cite PKWARE's APPNOTE.TXT, version 6.3.10.
 *
 * ## What the rewriter promises
 *
 * Only the entries it is handed new content for change. Every other entry
 * is copied through byte for byte — local header, data and data descriptor,
 * in the original order, together with any bytes that sat between it and
 * the next entry — so a Word file's `document.xml` and every embedded image
 * leave exactly as they arrived. A replaced entry gets a fresh local header
 * (deflate, real CRC-32 and sizes, no data descriptor). The central
 * directory is rebuilt from the original records, changing only what the
 * move forced: every entry's local-header offset, and the method, flags,
 * CRC and sizes of a replaced one. The archive comment survives.
 *
 * ## What it refuses
 *
 * A ZIP64 archive, an encrypted or ZIP64 target entry, a target named twice,
 * and a layout whose entries overlap — each an {@link EmbeddedWriteError},
 * never a guess that could produce a corrupt file.
 */

import { deflateRawSync, inflateRawSync } from 'zlib'

import { EmbeddedWriteError } from './types'

/** 4.3.7 local file header, 4.3.12 central directory header, 4.3.16 EOCD. */
const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
/** 4.3.15 ZIP64 end of central directory locator, 4.3.14 its record. */
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_ZIP64_EOCD = 0x06064b50

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22
const ZIP64_LOCATOR_SIZE = 20
const ZIP64_EOCD_MIN_SIZE = 56
/** The EOCD comment length is a 16-bit field (4.3.16). */
const MAX_COMMENT_LENGTH = 0xffff

/** 4.4.4 general purpose bit flags. */
const FLAG_ENCRYPTED = 0x0001
const FLAG_UTF8 = 0x0800

/** 4.4.5 compression methods. */
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

/** 4.5.2 extra field header id of the ZIP64 extended information. */
const EXTRA_ZIP64 = 0x0001

const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

/** The default cap on one entry's inflated size. */
export const ZIP_ENTRY_READ_MAX_BYTES = 16 * 1024 * 1024

export interface ZipEntry {
  /**
   * The entry name. Decoded as UTF-8 whether or not bit 11 is set (4.4.4):
   * the alternative is IBM 437, and every writer this module meets — Office,
   * LibreOffice, Google's exporters — writes ASCII part names either way.
   */
  name: string
  flags: number
  method: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  /**
   * Where the entry's stored bytes begin, from the lengths in its LOCAL
   * header (which may differ from the central record's, 4.3.7 vs 4.3.12);
   * `-1` when the local header is missing or runs off the archive.
   */
  dataOffset: number
  /** Bit 0 of the flags: traditional or strong encryption (4.4.4). */
  encrypted: boolean
  /** The central record carries a ZIP64 extended-information field (4.5.3). */
  zip64: boolean
  /** This entry's central-directory record, verbatim (a view into the archive). */
  centralRecord: Uint8Array
}

export interface ZipArchive {
  bytes: Uint8Array
  /** In central-directory order. */
  entries: ZipEntry[]
  centralDirectoryOffset: number
  centralDirectorySize: number
  endOfCentralDirectoryOffset: number
  /** The archive comment, verbatim. */
  comment: Uint8Array
  /** The archive's own end records are ZIP64 (4.3.14, 4.3.15). */
  zip64: boolean
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * CRC-32 as ZIP uses it (4.4.7): the reflected IEEE 802.3 polynomial
 * `0xEDB88320`, initial value and final XOR `0xFFFFFFFF`. Pass a previous
 * result as `seed` to continue a running checksum.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ U32_MAX) >>> 0
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ U32_MAX) >>> 0
}

const utf8 = new TextDecoder('utf-8')
const utf8Encoder = new TextEncoder()

/** A 64-bit little-endian integer, or null past `Number.MAX_SAFE_INTEGER`. */
function readU64(view: DataView, at: number): number | null {
  const low = view.getUint32(at, true)
  const high = view.getUint32(at + 4, true)
  const value = high * 0x100000000 + low
  return Number.isSafeInteger(value) ? value : null
}

/**
 * Find the end-of-central-directory record (4.3.16).
 *
 * It is the last 22 bytes of the archive plus a comment of up to 64 KB, so
 * only that tail is searched, backwards. A record whose comment length ends
 * exactly at the end of the file wins; failing that, the last one whose
 * comment fits, which tolerates junk appended after the archive.
 */
function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const last = bytes.length - EOCD_SIZE
  const floor = Math.max(0, last - MAX_COMMENT_LENGTH)
  let loose = -1
  for (let at = last; at >= floor; at--) {
    if (view.getUint32(at, true) !== SIG_EOCD) continue
    const end = at + EOCD_SIZE + view.getUint16(at + 20, true)
    if (end === bytes.length) return at
    if (end < bytes.length && loose < 0) loose = at
  }
  return loose
}

/**
 * Where a central record's ZIP64 extended-information values sit (4.5.3).
 * Each value is present only when its 32-bit field is saturated, in the
 * fixed order uncompressed size, compressed size, local header offset.
 * Returns offsets within `view`, or null for a malformed field that was
 * needed.
 */
function zip64Fields(
  view: DataView,
  extraStart: number,
  extraEnd: number,
  saturated: { uncompressed: boolean; compressed: boolean; offset: boolean },
): {
  present: boolean
  uncompressed?: number
  compressed?: number
  offset?: number
} | null {
  // A sloppy extra field is harmless while nothing needs to be read from it.
  const needed =
    saturated.uncompressed || saturated.compressed || saturated.offset
  const malformed = needed ? null : { present: false }
  let at = extraStart
  // Each extra block is a 2-byte id, a 2-byte length and its data (4.5.1).
  for (let guard = 0; at + 4 <= extraEnd && guard < 1024; guard++) {
    const id = view.getUint16(at, true)
    const length = view.getUint16(at + 2, true)
    const dataStart = at + 4
    const dataEnd = dataStart + length
    if (dataEnd > extraEnd) return malformed
    if (id === EXTRA_ZIP64) {
      const out: {
        present: boolean
        uncompressed?: number
        compressed?: number
        offset?: number
      } = { present: true }
      let cursor = dataStart
      for (const field of ['uncompressed', 'compressed', 'offset'] as const) {
        if (!saturated[field]) continue
        if (cursor + 8 > dataEnd) return null
        out[field] = cursor
        cursor += 8
      }
      return out
    }
    at = dataEnd
  }
  return { present: false }
}

/**
 * Parse an archive's central directory.
 *
 * Returns null for anything that is not a single-disk ZIP whose central
 * directory reads cleanly from end to end: a partial entry list is worse
 * than none here, because a rewrite built from it would silently drop
 * whatever was not listed.
 */
export function readZip(bytes: Uint8Array): ZipArchive | null {
  if (bytes.length < EOCD_SIZE) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(bytes, view)
  if (eocd < 0) return null

  let disk = view.getUint16(eocd + 4, true)
  let centralDisk = view.getUint16(eocd + 6, true)
  let entriesOnDisk = view.getUint16(eocd + 8, true)
  let totalEntries = view.getUint16(eocd + 10, true)
  let centralSize = view.getUint32(eocd + 12, true)
  let centralOffset = view.getUint32(eocd + 16, true)
  const commentLength = view.getUint16(eocd + 20, true)
  const comment = bytes.subarray(
    eocd + EOCD_SIZE,
    eocd + EOCD_SIZE + commentLength,
  )
  let centralLimit = eocd
  let zip64 = false

  const locator = eocd - ZIP64_LOCATOR_SIZE
  if (locator >= 0 && view.getUint32(locator, true) === SIG_ZIP64_LOCATOR) {
    const record = readU64(view, locator + 8)
    if (record === null || record + ZIP64_EOCD_MIN_SIZE > locator) return null
    if (view.getUint32(record, true) !== SIG_ZIP64_EOCD) return null
    const onDisk = readU64(view, record + 24)
    const total = readU64(view, record + 32)
    const size = readU64(view, record + 40)
    const offset = readU64(view, record + 48)
    if (onDisk === null || total === null || size === null || offset === null)
      return null
    disk = view.getUint32(record + 16, true)
    centralDisk = view.getUint32(record + 20, true)
    entriesOnDisk = onDisk
    totalEntries = total
    centralSize = size
    centralOffset = offset
    centralLimit = record
    zip64 = true
  }

  // Spanned and split archives (8.0) are not something an upload can be.
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries)
    return null
  const centralEnd = centralOffset + centralSize
  if (centralEnd > centralLimit) return null
  // Every record is at least 46 bytes, which bounds the loop below.
  if (totalEntries * CENTRAL_HEADER_SIZE > centralSize) return null

  const entries: ZipEntry[] = []
  let at = centralOffset
  for (let index = 0; index < totalEntries; index++) {
    if (at + CENTRAL_HEADER_SIZE > centralEnd) return null
    if (view.getUint32(at, true) !== SIG_CENTRAL) return null
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const crc = view.getUint32(at + 16, true)
    let compressedSize = view.getUint32(at + 20, true)
    let uncompressedSize = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    let localHeaderOffset = view.getUint32(at + 42, true)
    const nameStart = at + CENTRAL_HEADER_SIZE
    const extraStart = nameStart + nameLength
    const extraEnd = extraStart + extraLength
    const recordEnd = extraEnd + commentLen
    if (recordEnd > centralEnd) return null

    const zip = zip64Fields(view, extraStart, extraEnd, {
      uncompressed: uncompressedSize === U32_MAX,
      compressed: compressedSize === U32_MAX,
      offset: localHeaderOffset === U32_MAX,
    })
    if (!zip) return null
    if (zip.uncompressed !== undefined) {
      const value = readU64(view, zip.uncompressed)
      if (value === null) return null
      uncompressedSize = value
    }
    if (zip.compressed !== undefined) {
      const value = readU64(view, zip.compressed)
      if (value === null) return null
      compressedSize = value
    }
    if (zip.offset !== undefined) {
      const value = readU64(view, zip.offset)
      if (value === null) return null
      localHeaderOffset = value
    }

    entries.push({
      name: utf8.decode(bytes.subarray(nameStart, extraStart)),
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset: localDataOffset(
        bytes,
        view,
        localHeaderOffset,
        compressedSize,
      ),
      encrypted: (flags & FLAG_ENCRYPTED) !== 0,
      zip64: zip.present,
      centralRecord: bytes.subarray(at, recordEnd),
    })
    at = recordEnd
  }

  return {
    bytes,
    entries,
    centralDirectoryOffset: centralOffset,
    centralDirectorySize: centralSize,
    endOfCentralDirectoryOffset: eocd,
    comment,
    zip64,
  }
}

/** Start of an entry's data from its local header (4.3.7), or -1. */
function localDataOffset(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  compressedSize: number,
): number {
  if (offset + LOCAL_HEADER_SIZE > bytes.length) return -1
  if (view.getUint32(offset, true) !== SIG_LOCAL) return -1
  const start =
    offset +
    LOCAL_HEADER_SIZE +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true)
  return start + compressedSize <= bytes.length ? start : -1
}

/** The first entry of that exact name. */
export function findZipEntry(
  archive: ZipArchive,
  name: string,
): ZipEntry | undefined {
  return archive.entries.find((entry) => entry.name === name)
}

/**
 * An entry's content, inflated and CRC-checked.
 *
 * Null for an encrypted entry, a method other than stored or deflate, a
 * declared size over `maxBytes`, output that disagrees with the declared
 * size, or a CRC mismatch. `maxOutputLength` stops a deflate bomb at the
 * declared size, whatever the stream would expand to.
 */
export function readZipEntry(
  archive: ZipArchive,
  entry: ZipEntry,
  maxBytes = ZIP_ENTRY_READ_MAX_BYTES,
): Uint8Array | null {
  if (entry.encrypted || entry.dataOffset < 0) return null
  if (entry.uncompressedSize > maxBytes) return null
  const data = archive.bytes.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  )
  let content: Uint8Array
  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) return null
    content = data
  } else if (entry.method === METHOD_DEFLATE) {
    try {
      const out = inflateRawSync(data, {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      })
      content = new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
    } catch {
      return null
    }
    if (content.length !== entry.uncompressedSize) return null
  } else {
    return null
  }
  return crc32(content) === entry.crc32 ? content : null
}

/** MS-DOS date and time (4.4.6), from the UTC fields; floors at 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  if (date.getUTCFullYear() < 1980 || Number.isNaN(date.getTime())) {
    return { time: 0, date: (1 << 5) | 1 }
  }
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      (Math.min(127, date.getUTCFullYear() - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  }
}

interface WrittenEntry {
  offset: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  flags: number
}

/** A fresh local header plus deflated data (4.3.7) — never a descriptor. */
function freshLocalRecord(
  nameBytes: Uint8Array,
  content: Uint8Array,
  flags: number,
  time: number,
  date: number,
): { record: Uint8Array; crc: number; compressedSize: number } {
  const deflated = deflateRawSync(content)
  const crc = crc32(content)
  const record = new Uint8Array(
    LOCAL_HEADER_SIZE + nameBytes.length + deflated.length,
  )
  const view = new DataView(record.buffer)
  view.setUint32(0, SIG_LOCAL, true)
  view.setUint16(4, 20, true) // version needed: 2.0, for deflate (4.4.3.2)
  view.setUint16(6, flags, true)
  view.setUint16(8, METHOD_DEFLATE, true)
  view.setUint16(10, time, true)
  view.setUint16(12, date, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, deflated.length, true)
  view.setUint32(22, content.length, true)
  view.setUint16(26, nameBytes.length, true)
  view.setUint16(28, 0, true)
  record.set(nameBytes, LOCAL_HEADER_SIZE)
  record.set(deflated, LOCAL_HEADER_SIZE + nameBytes.length)
  return { record, crc, compressedSize: deflated.length }
}

/**
 * Replace (or add) entries, copying everything else through verbatim.
 *
 * `changes` maps an entry name to its new, uncompressed content. A name the
 * archive already holds is replaced where it stands; a name it does not is
 * appended as a new entry after the last one, dated `options.now` (or
 * 1980-01-01, which is what Office stamps every part with).
 */
export function rewriteZip(
  archive: ZipArchive,
  changes: ReadonlyMap<string, Uint8Array>,
  options: { now?: Date } = {},
): Uint8Array {
  const { bytes, entries } = archive
  if (archive.zip64) {
    throw new EmbeddedWriteError(
      'This file is too large a ZIP archive (ZIP64) to be edited in place.',
    )
  }
  for (const name of changes.keys()) {
    const matches = entries.filter((entry) => entry.name === name)
    if (matches.length > 1) {
      throw new EmbeddedWriteError(
        `This file holds "${name}" more than once, so it cannot be edited safely.`,
      )
    }
    const target = matches[0]
    if (target?.encrypted) {
      throw new EmbeddedWriteError(
        'This file is encrypted, so its details can only be read.',
      )
    }
    if (target?.zip64) {
      throw new EmbeddedWriteError(
        'This file stores its details in a ZIP64 entry, which cannot be edited in place.',
      )
    }
  }

  // Each entry owns the bytes from its local header to the next entry's —
  // or to the central directory — so a data descriptor, and any padding a
  // writer left, travels with it. That only works if entries do not
  // overlap, which a crafted archive may not honor.
  const ordered = [...entries].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  )
  const spanEnd = new Map<ZipEntry, number>()
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]
    if (!entry) continue
    const next =
      ordered[index + 1]?.localHeaderOffset ?? archive.centralDirectoryOffset
    if (
      entry.dataOffset < 0 ||
      entry.dataOffset + entry.compressedSize > next ||
      entry.localHeaderOffset >= next
    ) {
      throw new EmbeddedWriteError(
        'The parts of this file overlap or are damaged, so it cannot be edited safely.',
      )
    }
    spanEnd.set(entry, next)
  }

  const chunks: Uint8Array[] = []
  let position = 0
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk)
    position += chunk.length
  }
  const firstOffset =
    ordered[0]?.localHeaderOffset ?? archive.centralDirectoryOffset
  // Anything ahead of the first entry — a self-extractor stub — stays put,
  // and so do the offsets that count from the start of the file.
  push(bytes.subarray(0, firstOffset))

  const written = new Map<ZipEntry, WrittenEntry>()
  const moved = new Map<ZipEntry, number>()
  for (const entry of ordered) {
    const content = changes.get(entry.name)
    const end = spanEnd.get(entry) ?? entry.localHeaderOffset
    if (!content) {
      moved.set(entry, position)
      push(bytes.subarray(entry.localHeaderOffset, end))
      continue
    }
    const record = entry.centralRecord
    const recordView = new DataView(
      record.buffer,
      record.byteOffset,
      record.byteLength,
    )
    const nameBytes = record.subarray(
      CENTRAL_HEADER_SIZE,
      CENTRAL_HEADER_SIZE + recordView.getUint16(28, true),
    )
    // Bit 11 (UTF-8 names) is kept; the descriptor bit 3, the deflate
    // option bits 1-2 and anything else describing the OLD data are not.
    const flags = entry.flags & FLAG_UTF8
    const fresh = freshLocalRecord(
      nameBytes,
      content,
      flags,
      recordView.getUint16(12, true),
      recordView.getUint16(14, true),
    )
    written.set(entry, {
      offset: position,
      crc: fresh.crc,
      compressedSize: fresh.compressedSize,
      uncompressedSize: content.length,
      flags,
    })
    push(fresh.record)
  }

  const known = new Set(entries.map((entry) => entry.name))
  const stamp = dosDateTime(options.now ?? new Date(Date.UTC(1980, 0, 1)))
  const added: Array<{ nameBytes: Uint8Array; written: WrittenEntry }> = []
  for (const [name, content] of changes) {
    if (known.has(name)) continue
    const nameBytes = utf8Encoder.encode(name)
    if (nameBytes.length > U16_MAX) {
      throw new EmbeddedWriteError('A part name in this file is too long.')
    }
    // eslint-disable-next-line no-control-regex
    const flags = /^[\x00-\x7f]*$/.test(name) ? 0 : FLAG_UTF8
    const fresh = freshLocalRecord(
      nameBytes,
      content,
      flags,
      stamp.time,
      stamp.date,
    )
    added.push({
      nameBytes,
      written: {
        offset: position,
        crc: fresh.crc,
        compressedSize: fresh.compressedSize,
        uncompressedSize: content.length,
        flags,
      },
    })
    push(fresh.record)
  }

  const centralOffset = position
  for (const entry of entries) {
    const record = entry.centralRecord.slice()
    const recordView = new DataView(record.buffer)
    const replaced = written.get(entry)
    const offset = replaced?.offset ?? moved.get(entry)
    if (offset === undefined || offset > U32_MAX - 1) {
      throw new EmbeddedWriteError(
        'This file is too large to be edited in place.',
      )
    }
    if (recordView.getUint32(42, true) === U32_MAX) {
      // The offset lives in the ZIP64 extra field instead (4.5.3).
      const extraStart = CENTRAL_HEADER_SIZE + recordView.getUint16(28, true)
      const zip = zip64Fields(
        recordView,
        extraStart,
        extraStart + recordView.getUint16(30, true),
        {
          uncompressed: recordView.getUint32(24, true) === U32_MAX,
          compressed: recordView.getUint32(20, true) === U32_MAX,
          offset: true,
        },
      )
      if (!zip || zip.offset === undefined) {
        throw new EmbeddedWriteError(
          'This file is damaged and cannot be edited safely.',
        )
      }
      recordView.setUint32(zip.offset, offset, true)
      recordView.setUint32(zip.offset + 4, 0, true)
    } else {
      recordView.setUint32(42, offset, true)
    }
    if (replaced) {
      recordView.setUint16(6, Math.max(20, recordView.getUint16(6, true)), true)
      recordView.setUint16(8, replaced.flags, true)
      recordView.setUint16(10, METHOD_DEFLATE, true)
      recordView.setUint32(16, replaced.crc, true)
      recordView.setUint32(20, replaced.compressedSize, true)
      recordView.setUint32(24, replaced.uncompressedSize, true)
    }
    push(record)
  }
  for (const { nameBytes, written: entry } of added) {
    const record = new Uint8Array(CENTRAL_HEADER_SIZE + nameBytes.length)
    const recordView = new DataView(record.buffer)
    recordView.setUint32(0, SIG_CENTRAL, true)
    recordView.setUint16(4, 20, true) // made by: MS-DOS, 2.0 (4.4.2)
    recordView.setUint16(6, 20, true)
    recordView.setUint16(8, entry.flags, true)
    recordView.setUint16(10, METHOD_DEFLATE, true)
    recordView.setUint16(12, stamp.time, true)
    recordView.setUint16(14, stamp.date, true)
    recordView.setUint32(16, entry.crc, true)
    recordView.setUint32(20, entry.compressedSize, true)
    recordView.setUint32(24, entry.uncompressedSize, true)
    recordView.setUint16(28, nameBytes.length, true)
    recordView.setUint32(42, entry.offset, true)
    record.set(nameBytes, CENTRAL_HEADER_SIZE)
    push(record)
  }
  const centralSize = position - centralOffset
  const count = entries.length + added.length
  if (count > U16_MAX || position > U32_MAX - 1) {
    throw new EmbeddedWriteError(
      'This file is too large to be edited in place.',
    )
  }

  // Whatever sat between the directory and its end record (nothing, in a
  // non-ZIP64 archive written by anyone sane) is carried through as found.
  push(
    bytes.subarray(
      archive.centralDirectoryOffset + archive.centralDirectorySize,
      archive.endOfCentralDirectoryOffset,
    ),
  )

  const eocd = new Uint8Array(EOCD_SIZE + archive.comment.length)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, SIG_EOCD, true)
  eocdView.setUint16(8, count, true)
  eocdView.setUint16(10, count, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, centralOffset, true)
  eocdView.setUint16(20, archive.comment.length, true)
  eocd.set(archive.comment, EOCD_SIZE)
  push(eocd)

  const out = new Uint8Array(position)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  // The rewritten archive must read back, entry for entry, or it is not
  // returned at all.
  const check = readZip(out)
  if (!check || check.entries.length !== count) {
    throw new EmbeddedWriteError(
      'The edited file did not verify, so it was not saved.',
    )
  }
  return out
}
