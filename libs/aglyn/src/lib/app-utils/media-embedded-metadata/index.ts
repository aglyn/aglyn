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
 * Reads the metadata a media file carries inside its own bytes, and writes
 * edits back into them without re-encoding anything (AGL-3331).
 *
 * This file is the dispatcher. It sniffs the container, hands the bytes to
 * the format module, and folds what comes back — up to three copies of a
 * photo's caption, from XMP, IPTC and EXIF — into the one list of fields a
 * media document stores. Writing is the same trip in reverse: one edit fans
 * out to every block that already holds that idea, so no stale copy is left
 * for the next reader to prefer.
 *
 * Server-only: exposed through `@aglyn/aglyn/server` and never the client
 * barrel. The client half — the catalog, the value formats, the edit rules —
 * is `../media-embedded-fields`.
 */

import {
  embeddedFieldGroup,
  embeddedFieldLabel,
  embeddedKeyWritable,
  isCanonicalEmbeddedKey,
  MEDIA_EMBEDDED_CATALOG,
  MEDIA_EMBEDDED_GROUP_ORDER,
  MEDIA_EMBEDDED_MAX_FIELDS,
  MEDIA_EMBEDDED_MAX_LIST_ITEM_LENGTH,
  MEDIA_EMBEDDED_MAX_LIST_ITEMS,
  MEDIA_EMBEDDED_MAX_VALUE_LENGTH,
  MEDIA_EMBEDDED_METADATA_VERSION,
  MEDIA_EMBEDDED_WRITABLE_FORMATS,
  otherEmbeddedKey,
  parseOtherEmbeddedKey,
  sanitizeEmbeddedPatch,
  type MediaEmbeddedCatalogEntry,
  type MediaEmbeddedField,
  type MediaEmbeddedFormat,
  type MediaEmbeddedGroup,
  type MediaEmbeddedMetadata,
  type MediaEmbeddedPatch,
  type MediaEmbeddedSource,
} from '../media-embedded-fields'
import { readExif, writeExif } from './exif'
import { readGifBlocks } from './gif'
import { readHeifBlocks } from './heif'
import { readIccDescription } from './icc'
import type { ImageBlocks, ImageBlockUpdate, PngTextChunk } from './image-blocks'
import { irbHasIptc, readIim, readIrbIptc, writeIim, writeIrbIptc } from './iptc'
import { readJpegBlocks, writeJpegBlocks } from './jpeg'
import { readMp4 } from './mp4'
import { readOoxml, writeOoxml } from './ooxml'
import { readPdf, writePdf } from './pdf'
import { readPngBlocks, writePngBlocks } from './png'
import { readSvg } from './svg'
import { readTiffFile, writeTiffFile } from './tiff'
import {
  bytesReader,
  EmbeddedWriteError,
  type EmbeddedByteReader,
  type EmbeddedCandidate,
} from './types'
import { readWebm } from './webm'
import { readWebpBlocks, writeWebpBlocks } from './webp'
import { readXmp, writeXmp } from './xmp'

export { bytesReader, EmbeddedWriteError }
export type { EmbeddedByteReader, EmbeddedCandidate }

/**
 * The most of a file the reader will pull into memory, by format.
 *
 * Every one is the upload ceiling for the family, so an asset the DAM
 * accepted is always readable; the numbers exist so a future raise of a
 * ceiling does not silently turn this into a 500 MB download. Video is read
 * by range — its metadata lives in one box, not across the file — and its
 * cap is on that box (see `mp4.ts`).
 */
export const MEDIA_EMBEDDED_READ_MAX_BYTES: Record<
  Exclude<MediaEmbeddedFormat, 'mp4' | 'webm'>,
  number
> = {
  jpeg: 15 * 1024 * 1024,
  png: 15 * 1024 * 1024,
  webp: 15 * 1024 * 1024,
  gif: 15 * 1024 * 1024,
  tiff: 15 * 1024 * 1024,
  heif: 15 * 1024 * 1024,
  svg: 15 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  ooxml: 50 * 1024 * 1024,
}

const OOXML_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, index) => bytes[at + index] === byte)

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end))

/**
 * Which reader a file gets, from its first bytes — the stored content type
 * only breaks the ties the bytes cannot (an ISOBMFF `ftyp` is a HEIC photo
 * or an MP4 film; a ZIP is a Word file or a ZIP). A type label is the
 * uploader's claim and the signature is the file's, so the signature wins
 * wherever it can speak.
 */
export function embeddedFormatFor(
  contentType: string,
  head: Uint8Array,
): MediaEmbeddedFormat | null {
  const type = contentType.toLowerCase().split(';')[0]?.trim() ?? ''
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'png'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP')
    return 'webp'
  if (ascii(head, 0, 4) === 'GIF8') return 'gif'
  if (
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
  )
    return 'tiff'
  if (ascii(head, 0, 5) === '%PDF-') return 'pdf'
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (ascii(head, 4, 8) === 'ftyp') {
    return type.startsWith('image/') ? 'heif' : 'mp4'
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) && OOXML_TYPES.has(type))
    return 'ooxml'
  if (type === 'image/svg+xml') return 'svg'
  // A QuickTime file may open on `wide`, `free` or `mdat` rather than `ftyp`.
  if (type === 'video/quicktime' || type === 'video/mp4') return 'mp4'
  return null
}

/**
 * The order sources are believed in when they disagree, per format.
 *
 * Images follow the Metadata Working Group: XMP is the modern carrier and
 * the one every editor updates, IIM and EXIF are its legacy mirrors. A PDF's
 * document-info dictionary goes first because it is what every viewer's
 * Properties dialog shows — and this module's writer keeps the two in step,
 * so after one edit through Aglyn the question stops mattering.
 */
const SOURCE_PRECEDENCE: Record<MediaEmbeddedFormat, MediaEmbeddedSource[]> = {
  jpeg: ['xmp', 'iptc', 'exif', 'comment', 'icc'],
  png: ['xmp', 'png', 'exif', 'icc'],
  webp: ['xmp', 'exif', 'icc'],
  gif: ['xmp', 'comment'],
  tiff: ['xmp', 'iptc', 'exif', 'icc'],
  heif: ['xmp', 'exif', 'icc'],
  svg: ['svg', 'xmp'],
  pdf: ['pdf', 'xmp'],
  ooxml: ['ooxml'],
  mp4: ['mp4', 'xmp'],
  webm: ['webm'],
}

const CATALOG_ORDER = new Map(
  Object.keys(MEDIA_EMBEDDED_CATALOG).map((key, index) => [key, index]),
)

const clip = (value: string) =>
  value.length > MEDIA_EMBEDDED_MAX_VALUE_LENGTH
    ? { text: value.slice(0, MEDIA_EMBEDDED_MAX_VALUE_LENGTH), clipped: true }
    : { text: value, clipped: false }

/**
 * Fold every block's candidates into the stored field list.
 *
 * One field per key, valued from the most-believed source that holds it and
 * naming every source that does. A value clipped to the stored cap is shown
 * and NOT offered for editing: saving it back would write the clipped text
 * over the whole one, which is data loss the person never asked for.
 */
export function mergeEmbeddedCandidates(
  format: MediaEmbeddedFormat,
  candidates: EmbeddedCandidate[],
): { fields: MediaEmbeddedField[]; truncated: boolean } {
  const precedence = SOURCE_PRECEDENCE[format]
  const rank = (source: MediaEmbeddedSource) => {
    const index = precedence.indexOf(source)
    return index === -1 ? precedence.length : index
  }
  const byKey = new Map<string, EmbeddedCandidate[]>()
  for (const candidate of candidates) {
    const empty = Array.isArray(candidate.value)
      ? !candidate.value.some((item) => item.trim())
      : !candidate.value.trim()
    if (!candidate.key || empty) continue
    const list = byKey.get(candidate.key) ?? []
    list.push(candidate)
    byKey.set(candidate.key, list)
  }
  let truncated = false
  const fields: MediaEmbeddedField[] = []
  for (const [key, list] of byKey) {
    list.sort((a, b) => rank(a.source) - rank(b.source))
    const winner = list[0]
    if (!winner) continue
    const canonical = isCanonicalEmbeddedKey(key)
    const entry: MediaEmbeddedCatalogEntry | undefined = canonical
      ? MEDIA_EMBEDDED_CATALOG[key]
      : undefined
    const listValued = entry ? entry.kind === 'list' : Array.isArray(winner.value)
    let clipped = false
    const field: MediaEmbeddedField = {
      key,
      label: embeddedFieldLabel(key, format, winner.label),
      group: embeddedFieldGroup(key, format),
      sources: [...new Set(list.map((candidate) => candidate.source))],
      editable: false,
    }
    if (listValued) {
      const raw = Array.isArray(winner.value) ? winner.value : [winner.value]
      const items = [...new Set(raw.map((item) => item.trim()).filter(Boolean))]
      if (items.length > MEDIA_EMBEDDED_MAX_LIST_ITEMS) clipped = true
      field.values = items
        .slice(0, MEDIA_EMBEDDED_MAX_LIST_ITEMS)
        .map((item) => {
          if (item.length <= MEDIA_EMBEDDED_MAX_LIST_ITEM_LENGTH) return item
          clipped = true
          return item.slice(0, MEDIA_EMBEDDED_MAX_LIST_ITEM_LENGTH)
        })
    } else {
      const text = Array.isArray(winner.value)
        ? winner.value.join(', ')
        : winner.value
      const result = clip(text.trim())
      clipped = result.clipped
      field.value = result.text
    }
    truncated ||= clipped
    field.editable =
      !clipped &&
      embeddedKeyWritable(key, format) &&
      list.every((candidate) => candidate.editable !== false)
    fields.push(field)
  }
  const groupRank = (group: MediaEmbeddedGroup) =>
    MEDIA_EMBEDDED_GROUP_ORDER.indexOf(group)
  fields.sort(
    (a, b) =>
      groupRank(a.group) - groupRank(b.group) ||
      (CATALOG_ORDER.get(a.key) ?? Infinity) -
        (CATALOG_ORDER.get(b.key) ?? Infinity) ||
      a.label.localeCompare(b.label),
  )
  if (fields.length > MEDIA_EMBEDDED_MAX_FIELDS) {
    truncated = true
    fields.length = MEDIA_EMBEDDED_MAX_FIELDS
  }
  return { fields, truncated }
}

/**
 * PNG's registered text keywords (PNG spec §11.3.4.2) that name a catalog
 * idea. Every other keyword surfaces as an "other" field of its own.
 */
const PNG_KEYWORDS: Record<string, string> = {
  Title: 'title',
  Author: 'creator',
  Description: 'description',
  Copyright: 'copyright',
  'Creation Time': 'createdAt',
  Software: 'software',
  Comment: 'comment',
}
const PNG_KEYWORD_FOR = Object.fromEntries(
  Object.entries(PNG_KEYWORDS).map(([keyword, key]) => [key, keyword]),
)

function pngTextCandidates(chunks: PngTextChunk[]): EmbeddedCandidate[] {
  return chunks.map((chunk): EmbeddedCandidate => {
    const key = PNG_KEYWORDS[chunk.keyword]
    if (key === 'creator') {
      return { key, value: [chunk.text], source: 'png' }
    }
    if (key === 'createdAt') {
      // The spec recommends RFC 1123; writers put anything. A string no date
      // parser understands is still shown, under its own keyword.
      const parsed = Date.parse(chunk.text)
      return Number.isFinite(parsed)
        ? {
            key,
            value: new Date(parsed).toISOString().replace('.000Z', 'Z'),
            source: 'png',
          }
        : {
            key: otherEmbeddedKey('png', chunk.keyword),
            label: chunk.keyword,
            value: chunk.text,
            source: 'png',
          }
    }
    return key
      ? { key, value: chunk.text, source: 'png' }
      : {
          key: otherEmbeddedKey('png', chunk.keyword),
          label: chunk.keyword,
          value: chunk.text,
          source: 'png',
        }
  })
}

function imageBlockCandidates(blocks: ImageBlocks): EmbeddedCandidate[] {
  const candidates: EmbeddedCandidate[] = []
  if (blocks.xmp) candidates.push(...readXmp(blocks.xmp))
  if (blocks.irb) candidates.push(...readIrbIptc(blocks.irb))
  if (blocks.exif) candidates.push(...readExif(blocks.exif))
  if (blocks.pngText) candidates.push(...pngTextCandidates(blocks.pngText))
  for (const comment of blocks.comments ?? []) {
    candidates.push({ key: 'comment', value: comment, source: 'comment' })
  }
  if (blocks.icc) {
    const description = readIccDescription(blocks.icc)
    if (description) {
      candidates.push({ key: 'colorProfile', value: description, source: 'icc' })
    }
  }
  return candidates
}

/** The PDF document-info names each catalog key is written to. */
const PDF_INFO_NAMES: Record<string, string> = {
  title: 'Title',
  description: 'Subject',
  creator: 'Author',
  keywords: 'Keywords',
  software: 'Creator',
  producer: 'Producer',
  createdAt: 'CreationDate',
  modifiedAt: 'ModDate',
}
const PDF_INFO_KEYS = Object.fromEntries(
  Object.entries(PDF_INFO_NAMES).map(([key, name]) => [name, key]),
)

function pdfInfoCandidates(
  info: Array<{ name: string; value: string; editable: boolean }>,
): EmbeddedCandidate[] {
  return info.map(({ name, value, editable }): EmbeddedCandidate => {
    const key = PDF_INFO_KEYS[name]
    if (key === 'creator') {
      return { key, value: splitList(value, /;/), source: 'pdf', editable }
    }
    if (key === 'keywords') {
      return { key, value: splitList(value, /[,;]/), source: 'pdf', editable }
    }
    return key
      ? { key, value, source: 'pdf', editable }
      : {
          key: otherEmbeddedKey('pdf', name),
          label: name,
          value,
          source: 'pdf',
          editable,
        }
  })
}

const splitList = (value: string, separator: RegExp) =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)

async function readAll(
  reader: EmbeddedByteReader,
  format: Exclude<MediaEmbeddedFormat, 'mp4' | 'webm'>,
): Promise<Uint8Array | null> {
  if (reader.size > MEDIA_EMBEDDED_READ_MAX_BYTES[format]) return null
  return reader.read(0, reader.size)
}

/** Why a format that can normally be written cannot take this file's edits. */
function readOnlyReason(
  format: MediaEmbeddedFormat,
  pdf?: { encrypted: boolean; signed: boolean },
): string | undefined {
  if (pdf?.encrypted) return 'This PDF is encrypted, so its details can only be read.'
  if (pdf?.signed) {
    return (
      'This PDF is digitally signed. Changing its details would invalidate ' +
      'the signature, so they can only be read.'
    )
  }
  if (MEDIA_EMBEDDED_WRITABLE_FORMATS.has(format)) return undefined
  return format === 'mp4' || format === 'webm'
    ? 'Details inside a video file can be read here but not changed.'
    : 'Details inside this kind of file can be read here but not changed.'
}

/**
 * Read a stored file's embedded metadata.
 *
 * Returns `null` when the format has no reader or the file is past the read
 * cap — the drawer then simply has no "In the file" section, which is the
 * honest thing to show about a CSV. Never throws on the bytes: every format
 * module is written to return what it could read from a hostile file.
 */
export async function readMediaEmbeddedMetadata(options: {
  contentType: string
  reader: EmbeddedByteReader
  contentSha256?: string
}): Promise<MediaEmbeddedMetadata | null> {
  const { contentType, reader, contentSha256 } = options
  if (!reader.size) return null
  const head = await reader.read(0, Math.min(reader.size, 64))
  const format = embeddedFormatFor(contentType, head)
  if (!format) return null

  const candidates: EmbeddedCandidate[] = []
  let pdfFlags: { encrypted: boolean; signed: boolean } | undefined
  if (format === 'mp4') {
    const read = await readMp4(reader)
    if (!read) return null
    candidates.push(...read.candidates)
    if (read.xmp) candidates.push(...readXmp(read.xmp))
  } else if (format === 'webm') {
    const read = await readWebm(reader)
    if (!read) return null
    candidates.push(...read.candidates)
  } else {
    const bytes = await readAll(reader, format)
    if (!bytes) return null
    switch (format) {
      case 'jpeg':
      case 'png':
      case 'webp':
      case 'gif':
      case 'heif': {
        const blocks = {
          jpeg: readJpegBlocks,
          png: readPngBlocks,
          webp: readWebpBlocks,
          gif: readGifBlocks,
          heif: readHeifBlocks,
        }[format](bytes)
        if (!blocks) return null
        candidates.push(...imageBlockCandidates(blocks))
        break
      }
      case 'tiff': {
        const file = readTiffFile(bytes)
        if (!file) return null
        candidates.push(...readExif(bytes))
        if (file.xmp) candidates.push(...readXmp(file.xmp))
        if (file.irb) candidates.push(...readIrbIptc(file.irb))
        else if (file.iim) candidates.push(...readIim(file.iim))
        break
      }
      case 'svg': {
        const read = readSvg(bytes)
        if (!read) return null
        candidates.push(...read.candidates)
        if (read.xmp) candidates.push(...readXmp(read.xmp))
        break
      }
      case 'pdf': {
        const read = readPdf(bytes)
        if (!read) return null
        pdfFlags = { encrypted: read.encrypted, signed: read.signed }
        // An encrypted file's strings are ciphertext without the key, so
        // nothing in its dictionary is worth showing but the facts below.
        if (!read.encrypted) {
          candidates.push(...pdfInfoCandidates(read.info))
          if (read.xmp) {
            candidates.push(...readXmp(read.xmp, { profile: 'pdf' }))
          }
        }
        if (read.pageCount) {
          candidates.push({
            key: 'pageCount',
            value: String(read.pageCount),
            source: 'pdf',
          })
        }
        if (read.version) {
          candidates.push({ key: 'pdfVersion', value: read.version, source: 'pdf' })
        }
        break
      }
      case 'ooxml': {
        const read = readOoxml(bytes)
        if (!read) return null
        candidates.push(...read.candidates)
        break
      }
    }
  }

  const reason = readOnlyReason(format, pdfFlags)
  const { fields, truncated } = mergeEmbeddedCandidates(
    format,
    reason ? candidates.map((c) => ({ ...c, editable: false })) : candidates,
  )
  return {
    version: MEDIA_EMBEDDED_METADATA_VERSION,
    format,
    fields,
    writable: !reason,
    ...(reason ? { readOnlyReason: reason } : {}),
    ...(truncated ? { truncated } : {}),
    ...(contentSha256 ? { contentSha256 } : {}),
  }
}

/**
 * The canonical keys the XMP writer maps, per profile — every other key in
 * a patch is some other block's business and is kept out of the packet.
 */
const XMP_IMAGE_KEYS = new Set([
  'title',
  'headline',
  'description',
  'keywords',
  'instructions',
  'label',
  'rating',
  'creator',
  'copyright',
  'credit',
  'source',
  'usageTerms',
  'webStatement',
  'city',
  'state',
  'country',
  'gps',
  'createdAt',
  'software',
  'make',
  'model',
  'lens',
])
const XMP_PDF_KEYS = new Set([
  'title',
  'description',
  'creator',
  'keywords',
  'software',
  'producer',
  'createdAt',
])

function pick(
  patch: MediaEmbeddedPatch,
  keep: (key: string) => boolean,
): MediaEmbeddedPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => keep(key)))
}

const hasEntries = (patch: MediaEmbeddedPatch) => Object.keys(patch).length > 0

/** A text keyword's value for a canonical PNG field, or `null` to remove. */
function pngTextValue(key: string, value: string | string[] | null) {
  if (value === null) return null
  if (key === 'createdAt') {
    const parsed = Date.parse(String(value))
    return Number.isFinite(parsed) ? new Date(parsed).toUTCString() : String(value)
  }
  return Array.isArray(value) ? value.join('; ') : value
}

/**
 * The image write: XMP always (creating a packet if the file has none), and
 * the legacy mirrors — IIM, EXIF, PNG text — only where the file already
 * carries them, which is the MWG's rule for not planting a second, older
 * copy of a value in a file that never had one.
 */
function writeImage(
  format: 'jpeg' | 'png' | 'webp' | 'tiff',
  bytes: Uint8Array,
  patch: MediaEmbeddedPatch,
  now: Date,
): Uint8Array {
  const xmpPatch = pick(
    patch,
    (key) =>
      XMP_IMAGE_KEYS.has(key) || parseOtherEmbeddedKey(key)?.namespace === 'xmp',
  )
  if (format === 'tiff') {
    const file = readTiffFile(bytes)
    if (!file) throw new EmbeddedWriteError('This TIFF file could not be read.')
    const xmp = hasEntries(xmpPatch)
      ? writeXmp(file.xmp, xmpPatch, { profile: 'image', now })
      : undefined
    return writeTiffFile(bytes, {
      exifPatch: patch,
      ...(xmp !== undefined ? { xmp } : {}),
      ...(file.iim ? { iim: writeIim(file.iim, patch) } : {}),
    })
  }

  const read = { jpeg: readJpegBlocks, png: readPngBlocks, webp: readWebpBlocks }[
    format
  ]
  const blocks = read(bytes)
  if (!blocks) {
    throw new EmbeddedWriteError('This file could not be read, so it was left as it was.')
  }
  const update: ImageBlockUpdate = {}
  if (hasEntries(xmpPatch)) {
    const xmp = writeXmp(blocks.xmp ?? null, xmpPatch, { profile: 'image', now })
    if (xmp !== null || blocks.xmp) update.xmp = xmp
  }
  if (blocks.exif) {
    update.exif = writeExif(blocks.exif, patch, {
      // A JPEG APP1 holds 65533 bytes, six of which are `Exif\0\0`.
      ...(format === 'jpeg' ? { maxLength: 65527 } : {}),
    })
  }
  if (blocks.irb && irbHasIptc(blocks.irb)) {
    update.irb = writeIrbIptc(blocks.irb, patch)
  }
  if (format === 'png') {
    const existing = new Set((blocks.pngText ?? []).map((chunk) => chunk.keyword))
    const text: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(patch)) {
      const other = parseOtherEmbeddedKey(key)
      if (other?.namespace === 'png') {
        const keyword = other.parts.join('|')
        if (!existing.has(keyword)) {
          throw new EmbeddedWriteError(`${keyword} is not in this file.`)
        }
        text[keyword] = pngTextValue(key, value)
        continue
      }
      const keyword = PNG_KEYWORD_FOR[key]
      // A comment has nowhere else to live in a PNG, so it is the one text
      // field written whether or not the file had it.
      if (keyword && (existing.has(keyword) || key === 'comment')) {
        text[keyword] = pngTextValue(key, value)
      }
    }
    if (hasEntries(text)) update.pngText = text
  }
  const write = { jpeg: writeJpegBlocks, png: writePngBlocks, webp: writeWebpBlocks }[
    format
  ]
  return write(bytes, update)
}

function writePdfFile(
  bytes: Uint8Array,
  patch: MediaEmbeddedPatch,
  now: Date,
): Uint8Array {
  const read = readPdf(bytes)
  if (!read) {
    throw new EmbeddedWriteError('This PDF could not be read, so it was left as it was.')
  }
  const info: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(patch)) {
    const other = parseOtherEmbeddedKey(key)
    const name =
      other?.namespace === 'pdf' ? other.parts.join('|') : PDF_INFO_NAMES[key]
    if (!name) continue
    if (other && !read.info.some((entry) => entry.name === name)) {
      throw new EmbeddedWriteError(`${name} is not in this PDF.`)
    }
    info[name] =
      value === null
        ? null
        : Array.isArray(value)
          ? value.join(key === 'creator' ? '; ' : ', ')
          : value
  }
  // Every PDF writer stamps the modification date; a viewer's "Modified"
  // that predates a change it can see is a small lie worth not telling.
  info['ModDate'] = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const xmpPatch = pick(patch, (key) => XMP_PDF_KEYS.has(key))
  // XMP is updated where the file has it and never planted where it does
  // not: the document-info dictionary is what a PDF 1.x reader looks at.
  const xmp = read.xmp
    ? (writeXmp(read.xmp, xmpPatch, { profile: 'pdf', now }) ?? undefined)
    : undefined
  return writePdf(bytes, { info, ...(xmp !== undefined ? { xmp } : {}) })
}

/**
 * Write an edit into a file's bytes and return the new bytes.
 *
 * The patch is validated against the catalog first (the route has already
 * done so for the person's benefit; this is for every other caller), then
 * written by the format module. Throws `EmbeddedWriteError` — a sentence for
 * the person who asked — when the file cannot take it safely; anything else
 * thrown is a fault.
 */
export function writeMediaEmbeddedMetadata(options: {
  contentType: string
  bytes: Uint8Array
  patch: MediaEmbeddedPatch
  now?: Date
}): Uint8Array {
  const { contentType, bytes } = options
  const now = options.now ?? new Date()
  const format = embeddedFormatFor(contentType, bytes.subarray(0, 64))
  if (!format || !MEDIA_EMBEDDED_WRITABLE_FORMATS.has(format)) {
    throw new EmbeddedWriteError(
      'Details inside this kind of file can be read here but not changed.',
    )
  }
  const checked = sanitizeEmbeddedPatch(format, options.patch)
  if ('error' in checked) throw new EmbeddedWriteError(checked.error)
  switch (format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'tiff':
      return writeImage(format, bytes, checked.patch, now)
    case 'pdf':
      return writePdfFile(bytes, checked.patch, now)
    case 'ooxml':
      return writeOoxml(bytes, checked.patch, { now })
    default:
      throw new EmbeddedWriteError(
        'Details inside this kind of file can be read here but not changed.',
      )
  }
}
