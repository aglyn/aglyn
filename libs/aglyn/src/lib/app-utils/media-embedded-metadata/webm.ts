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
 * The tags of a WebM or Matroska film (AGL-3331). Read-only, like MP4.
 *
 * Matroska is EBML (RFC 8794): every element is a variable-length ID, a
 * variable-length size and a payload. The file is an EBML header naming the
 * DocType, then one `Segment` whose top-level children include `Info`
 * (title, date, muxer) and `Tags`, and — the bulk of the file — `Cluster`s
 * of media (RFC 9559 §5.1).
 *
 * ## Reading without downloading the film
 *
 * Every read goes through the random-access reader and is sized exactly: an
 * element header is read in at most two pieces (see `headerAt`), so even the
 * header of a `Cluster` costs its own few bytes and nothing of its payload.
 * The Segment's children are walked from the start until the first
 * `Cluster`; anything that lives past the media — `Tags` usually does,
 * because a muxer writes them last — is reached through the `SeekHead`
 * index (RFC 9559 §5.1.1), whose positions count from the start of the
 * Segment's payload. A Segment of unknown size (a live recording, which is
 * what a browser's MediaRecorder writes) runs to the end of the file, and a
 * `Cluster` of unknown size simply ends the walk.
 *
 * ## What is read
 *
 * - `Info` (§5.1.2): `Title`, `DateUTC` (signed nanoseconds since
 *   2001-01-01T00:00:00Z), `WritingApp` — or `MuxingApp` when that is all
 *   there is — as the encoder.
 * - `Tags` (§5.1.8): the `SimpleTag`s of every `Tag` that targets the whole
 *   file — no track, edition, chapter or attachment UID — preferring target
 *   level 50, the film itself. A per-track tag (ffmpeg writes a `DURATION`
 *   for every track) describes a stream, not the file, and is skipped.
 *   Nested SimpleTags are not read.
 *
 * Tags outrank `Info` for the same idea: `DATE_RECORDED` says when the
 * recording began, `DateUTC` only when the file was muxed.
 */

import {
  otherEmbeddedKey,
  type MediaEmbeddedCanonicalKey,
} from '../media-embedded-fields'
import type { EmbeddedByteReader, EmbeddedCandidate } from './types'

// Element IDs, with their length-marker bits, as the specifications list them.
const ID_EBML = 0x1a45dfa3
const ID_DOCTYPE = 0x4282
const ID_SEGMENT = 0x18538067
const ID_SEEKHEAD = 0x114d9b74
const ID_SEEK = 0x4dbb
const ID_SEEKID = 0x53ab
const ID_SEEKPOSITION = 0x53ac
const ID_INFO = 0x1549a966
const ID_TITLE = 0x7ba9
const ID_DATEUTC = 0x4461
const ID_MUXINGAPP = 0x4d80
const ID_WRITINGAPP = 0x5741
const ID_TAGS = 0x1254c367
const ID_TAG = 0x7373
const ID_TARGETS = 0x63c0
const ID_TARGETTYPEVALUE = 0x68ca
const ID_TAG_UIDS = new Set([0x63c5, 0x63c9, 0x63c4, 0x63c6])
const ID_SIMPLETAG = 0x67c8
const ID_TAGNAME = 0x45a3
const ID_TAGSTRING = 0x4487
const ID_CLUSTER = 0x1f43b675

const EBML_HEADER_MAX_BYTES = 4096
const SEEKHEAD_MAX_BYTES = 1024 * 1024
const INFO_MAX_BYTES = 1024 * 1024
const TAGS_MAX_BYTES = 8 * 1024 * 1024
/** Top-level elements ahead of the first Cluster: a handful, in practice. */
const MAX_TOP_LEVEL = 256
const MAX_CHILDREN = 65536
/** Milliseconds from 1970 to 2001-01-01T00:00:00Z, Matroska's epoch. */
const EPOCH_2001_MS = 978307200000

interface ElementHeader {
  id: number
  start: number
  /** Where the payload begins. */
  body: number
  /** The payload size; null for the "unknown" size (all value bits set). */
  size: number | null
}

/** The length of a VINT from its first byte's leading zeros (RFC 8794 §4). */
function vintLength(first: number): number {
  for (let length = 1, mask = 0x80; length <= 8; length++, mask >>= 1) {
    if (first & mask) return length
  }
  return 0
}

/** An element ID: 1 to 4 bytes, marker bit kept (RFC 8794 §5). */
function readId(
  bytes: Uint8Array,
  at: number,
): { id: number; length: number } | null {
  const length = vintLength(bytes[at] ?? 0)
  if (!length || length > 4 || at + length > bytes.length) return null
  let id = 0
  for (let index = 0; index < length; index++)
    id = id * 256 + (bytes[at + index] ?? 0)
  return { id, length }
}

/**
 * An element data size: 1 to 8 bytes, marker bit dropped; every value bit
 * set means "unknown" (RFC 8794 §6.2). A size past 2^53 is refused.
 */
function readSize(
  bytes: Uint8Array,
  at: number,
): { size: number | null; length: number } | null {
  const first = bytes[at] ?? 0
  const length = vintLength(first)
  if (!length || at + length > bytes.length) return null
  let value = first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let index = 1; index < length; index++) {
    const byte = bytes[at + index] ?? 0
    value = value * 256 + byte
    if (byte !== 0xff) allOnes = false
  }
  if (allOnes) return { size: null, length }
  return Number.isSafeInteger(value) ? { size: value, length } : null
}

/** The elements inside `bytes[start, end)`, clamped to it. */
function elements(
  bytes: Uint8Array,
  start: number,
  end: number,
): ElementHeader[] {
  const out: ElementHeader[] = []
  let at = start
  while (at < end && out.length < MAX_CHILDREN) {
    const id = readId(bytes, at)
    if (!id) break
    const size = readSize(bytes, at + id.length)
    if (!size) break
    const body = at + id.length + size.length
    if (body > end) break
    // An unknown size inside a buffer can only run to the buffer's end.
    const length =
      size.size === null ? end - body : Math.min(size.size, end - body)
    out.push({ id: id.id, start: at, body, size: length })
    at = body + length
  }
  return out
}

const payload = (bytes: Uint8Array, element: ElementHeader) =>
  bytes.subarray(element.body, element.body + (element.size ?? 0))

/** A Matroska string: UTF-8, possibly zero-padded (RFC 8794 §7.4, §7.5). */
const text = (bytes: Uint8Array) =>
  new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '')

function unsigned(bytes: Uint8Array): number | null {
  if (bytes.length > 8) return null
  let value = 0
  for (const byte of bytes) value = value * 256 + byte
  return Number.isSafeInteger(value) ? value : null
}

/**
 * One element header read through the reader in at most two sized pieces:
 * five bytes — a 4-byte ID and the first byte of the size, which says how
 * long the size is — then whatever of the size is still missing. For a
 * `Cluster` (a 4-byte ID) the first read is all header; for a shorter ID it
 * may run into that element's own payload, never into a Cluster's — so no
 * read reaches into the media this module means to skip.
 */
async function headerAt(
  reader: EmbeddedByteReader,
  at: number,
): Promise<ElementHeader | null> {
  if (at < 0 || at >= reader.size) return null
  const head = await reader.read(at, Math.min(reader.size, at + 5))
  const id = readId(head, 0)
  if (!id) return null
  const sizeAt = at + id.length
  const held = head.subarray(id.length)
  const length = vintLength(held[0] ?? 0)
  if (!held.length || !length) return null
  let sizeBytes = held.subarray(0, length)
  if (held.length < length) {
    const rest = await reader.read(sizeAt + held.length, sizeAt + length)
    if (held.length + rest.length < length) return null
    sizeBytes = new Uint8Array(length)
    sizeBytes.set(held)
    sizeBytes.set(rest, held.length)
  }
  const size = readSize(sizeBytes, 0)
  if (!size) return null
  return { id: id.id, start: at, body: sizeAt + length, size: size.size }
}

type VideoKey = Extract<
  MediaEmbeddedCanonicalKey,
  | 'title'
  | 'creator'
  | 'description'
  | 'comment'
  | 'createdAt'
  | 'copyright'
  | 'keywords'
  | 'encoder'
>

/** Official tag names (Matroska Media Container Tag Specifications). */
const TAG_KEYS: Record<string, VideoKey> = {
  TITLE: 'title',
  ARTIST: 'creator',
  DESCRIPTION: 'description',
  COMMENT: 'comment',
  DATE_RECORDED: 'createdAt',
  COPYRIGHT: 'copyright',
  KEYWORDS: 'keywords',
  ENCODER: 'encoder',
}

/**
 * A tag date — `YYYY-MM-DD hh:mm:ss.mss`, any tail of it omitted — in the
 * catalog's form. The tag specification names no zone, so none is added.
 */
function normalizeTagDate(raw: string): string {
  const value = raw.trim()
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:[.,](\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    )
  if (!match) return value
  const [, date, time, fraction, zone] = match
  return `${date}T${time}${fraction ? `.${fraction.slice(0, 3)}` : ''}${zone ?? ''}`
}

class Collector {
  private readonly byKey = new Map<
    string,
    { candidate: EmbeddedCandidate; rank: number }
  >()

  add(key: string, value: string, rank: number, label?: string): void {
    const trimmed = value.trim()
    if (!trimmed) return
    let candidate: EmbeddedCandidate
    if (key === 'keywords') {
      const items = trimmed
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
      if (!items.length) return
      candidate = { key, value: items, source: 'webm', editable: false }
    } else if (key === 'creator') {
      candidate = { key, value: [trimmed], source: 'webm', editable: false }
    } else if (key === 'createdAt') {
      candidate = {
        key,
        value: normalizeTagDate(trimmed),
        source: 'webm',
        editable: false,
      }
    } else {
      candidate = { key, value: trimmed, source: 'webm', editable: false }
      if (label) candidate.label = label
    }
    const held = this.byKey.get(key)
    if (!held || rank < held.rank) this.byKey.set(key, { candidate, rank })
  }

  candidates(): EmbeddedCandidate[] {
    return [...this.byKey.values()].map(({ candidate }) => candidate)
  }
}

/** Ranks: a film-level tag, another whole-file tag, then Info. */
const RANK_TAG_FILM = 0
const RANK_TAG_OTHER = 10
const RANK_INFO = 20

function readTags(bytes: Uint8Array, out: Collector): void {
  for (const tag of elements(bytes, 0, bytes.length)) {
    if (tag.id !== ID_TAG) continue
    const parts = elements(bytes, tag.body, tag.body + (tag.size ?? 0))
    const targets = parts.find((part) => part.id === ID_TARGETS)
    let level = 50
    let wholeFile = true
    if (targets) {
      for (const target of elements(
        bytes,
        targets.body,
        targets.body + (targets.size ?? 0),
      )) {
        const value = unsigned(payload(bytes, target))
        if (target.id === ID_TARGETTYPEVALUE && value !== null) level = value
        if (ID_TAG_UIDS.has(target.id) && value !== 0) wholeFile = false
      }
    }
    if (!wholeFile) continue
    const rank = level === 50 ? RANK_TAG_FILM : RANK_TAG_OTHER
    for (const simple of parts) {
      if (simple.id !== ID_SIMPLETAG) continue
      let name = ''
      let value: string | null = null
      for (const field of elements(
        bytes,
        simple.body,
        simple.body + (simple.size ?? 0),
      )) {
        if (field.id === ID_TAGNAME) name = text(payload(bytes, field)).trim()
        else if (field.id === ID_TAGSTRING) value = text(payload(bytes, field))
      }
      if (!name || value === null) continue
      const key = TAG_KEYS[name.toUpperCase()]
      if (key) out.add(key, value, rank)
      else out.add(otherEmbeddedKey('webm', name), value, rank, name)
    }
  }
}

function readInfo(bytes: Uint8Array, out: Collector): void {
  let muxingApp = ''
  let writingApp = ''
  for (const field of elements(bytes, 0, bytes.length)) {
    const value = payload(bytes, field)
    if (field.id === ID_TITLE) out.add('title', text(value), RANK_INFO)
    else if (field.id === ID_MUXINGAPP) muxingApp = text(value).trim()
    else if (field.id === ID_WRITINGAPP) writingApp = text(value).trim()
    else if (field.id === ID_DATEUTC && value.length === 8) {
      const nanoseconds = new DataView(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).getBigInt64(0)
      const date = new Date(EPOCH_2001_MS + Number(nanoseconds / 1_000_000n))
      if (!Number.isNaN(date.getTime())) {
        out.add(
          'createdAt',
          date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          RANK_INFO,
        )
      }
    }
  }
  const encoder = writingApp || muxingApp
  if (encoder) out.add('encoder', encoder, RANK_INFO)
  if (muxingApp && writingApp && muxingApp !== writingApp) {
    out.add(
      otherEmbeddedKey('webm', 'MuxingApp'),
      muxingApp,
      RANK_INFO,
      'Muxing application',
    )
  }
}

/**
 * Read a film's tags through random access.
 *
 * Null when the bytes do not open with an EBML header whose DocType is
 * `webm` or `matroska`. Every candidate is `editable: false`.
 */
export async function readWebm(
  reader: EmbeddedByteReader,
): Promise<{ candidates: EmbeddedCandidate[] } | null> {
  const ebml = await headerAt(reader, 0)
  if (!ebml || ebml.id !== ID_EBML || ebml.size === null) return null
  if (ebml.size > EBML_HEADER_MAX_BYTES) return null
  const header = await reader.read(ebml.body, ebml.body + ebml.size)
  const docType = elements(header, 0, header.length).find(
    (element) => element.id === ID_DOCTYPE,
  )
  const kind = docType ? text(payload(header, docType)) : ''
  if (kind !== 'webm' && kind !== 'matroska') return null

  // The Segment follows the header, perhaps after a Void.
  let segment: ElementHeader | null = null
  let at = ebml.body + ebml.size
  for (let count = 0; count < 16; count++) {
    const element = await headerAt(reader, at)
    if (!element) break
    if (element.id === ID_SEGMENT) {
      segment = element
      break
    }
    if (element.size === null) break
    at = element.body + element.size
  }
  const out = new Collector()
  if (!segment) return { candidates: [] }
  const origin = segment.body
  const segmentEnd =
    segment.size === null
      ? reader.size
      : Math.min(reader.size, segment.body + segment.size)

  const visited = new Set<number>()
  const infos: Uint8Array[] = []
  const tags: Uint8Array[] = []
  const pending: Array<{ id: number; at: number }> = []

  const visit = async (element: ElementHeader) => {
    if (visited.has(element.start) || element.size === null) return
    const cap =
      element.id === ID_SEEKHEAD
        ? SEEKHEAD_MAX_BYTES
        : element.id === ID_INFO
          ? INFO_MAX_BYTES
          : element.id === ID_TAGS
            ? TAGS_MAX_BYTES
            : 0
    if (!cap || element.size > cap) return
    visited.add(element.start)
    const bytes = await reader.read(
      element.body,
      Math.min(segmentEnd, element.body + element.size),
    )
    if (element.id === ID_INFO) infos.push(bytes)
    else if (element.id === ID_TAGS) tags.push(bytes)
    else {
      for (const seek of elements(bytes, 0, bytes.length)) {
        if (seek.id !== ID_SEEK) continue
        let id: number | null = null
        let position: number | null = null
        for (const field of elements(
          bytes,
          seek.body,
          seek.body + (seek.size ?? 0),
        )) {
          const value = payload(bytes, field)
          if (field.id === ID_SEEKID) id = unsigned(value)
          else if (field.id === ID_SEEKPOSITION) position = unsigned(value)
        }
        if (
          id !== null &&
          position !== null &&
          (id === ID_INFO || id === ID_TAGS || id === ID_SEEKHEAD)
        ) {
          pending.push({ id, at: origin + position })
        }
      }
    }
  }

  // Walk the Segment's children up to the first Cluster.
  at = origin
  for (let count = 0; count < MAX_TOP_LEVEL && at < segmentEnd; count++) {
    const element = await headerAt(reader, at)
    if (!element || element.id === ID_CLUSTER || element.size === null) break
    await visit(element)
    at = element.body + element.size
  }
  // Then what the index says lives beyond it — a second SeekHead included,
  // one level deep, which is as far as the specification nests them.
  for (let round = 0; round < 2 && pending.length; round++) {
    const targets = pending.splice(0)
    for (const target of targets) {
      if (visited.has(target.at) || target.at >= segmentEnd) continue
      const element = await headerAt(reader, target.at)
      if (element && element.id === target.id) await visit(element)
    }
  }

  for (const bytes of tags) readTags(bytes, out)
  for (const bytes of infos) readInfo(bytes, out)
  return { candidates: out.candidates() }
}
