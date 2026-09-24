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
 * The metadata a file carries INSIDE its own bytes (AGL-3331): EXIF, IPTC
 * and XMP on a photo, the document info of a PDF, the core and custom
 * properties of an Office file, the tags of a video container.
 *
 * ## Why this module is client-safe and the parsers are not
 *
 * The parsers and writers live in `media-embedded-metadata/` and are exposed
 * only through `@aglyn/aglyn/server` — they need `node:zlib` and
 * `node:crypto`, and nothing in a browser ever holds the bytes they read.
 * What the console needs is the SHAPE of what they produced (it is stored on
 * the media document) and the rules for presenting and editing it, which is
 * everything here. Keeping the two apart keeps a PDF parser out of the
 * console bundle.
 *
 * ## Canonical keys
 *
 * A photo's caption can be written in three places at once — XMP
 * `dc:description`, IPTC 2:120 and EXIF `ImageDescription` — and a PDF's in
 * two. The reader folds every spelling of one idea into one canonical key
 * ({@link MEDIA_EMBEDDED_CATALOG}), so the drawer shows ONE "Description"
 * rather than three rows that may or may not agree, and the writer fans an
 * edit back out to every place that already holds it (the Metadata Working
 * Group's rule: never leave a stale copy for the next reader to prefer).
 *
 * Anything a file carries that is not in the catalog — an XMP property from
 * a DAM we have never heard of, a PDF custom property, a PNG text chunk —
 * still surfaces, under a namespaced "other" key ({@link otherEmbeddedKey})
 * that round-trips to the writer unchanged.
 */

/** Where a value was read from. Several sources can back one field. */
export type MediaEmbeddedSource =
  | 'xmp'
  | 'iptc'
  | 'exif'
  | 'icc'
  | 'png'
  | 'comment'
  | 'pdf'
  | 'ooxml'
  | 'mp4'
  | 'webm'
  | 'svg'

/** How the drawer groups fields, in display order. */
export type MediaEmbeddedGroup =
  | 'description'
  | 'rights'
  | 'location'
  | 'capture'
  | 'document'
  | 'technical'
  | 'other'

export const MEDIA_EMBEDDED_GROUP_ORDER: readonly MediaEmbeddedGroup[] = [
  'description',
  'rights',
  'location',
  'capture',
  'document',
  'technical',
  'other',
]

export const MEDIA_EMBEDDED_GROUP_LABELS: Record<MediaEmbeddedGroup, string> = {
  description: 'Description',
  rights: 'Rights',
  location: 'Location',
  capture: 'Camera',
  document: 'Document',
  technical: 'Technical',
  other: 'Other embedded fields',
}

/**
 * The container a file was read as. `null`-free: a file whose format has no
 * reader is simply not given an `embeddedMetadata` record at all.
 */
export type MediaEmbeddedFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'tiff'
  | 'heif'
  | 'svg'
  | 'pdf'
  | 'ooxml'
  | 'mp4'
  | 'webm'

/**
 * The formats whose bytes can take an edit without being re-encoded.
 *
 * Every writer here rewrites METADATA containers only — JPEG APP segments,
 * PNG ancillary chunks, WebP RIFF chunks, a TIFF's IFD, a PDF incremental
 * update, an Office package's property parts — and copies the image data,
 * page content and every other part through byte for byte. A format that
 * cannot promise that (a video's `moov` would move its sample offsets; an
 * SVG is sanitized on every ingress and is its own markup) is read-only.
 */
export const MEDIA_EMBEDDED_WRITABLE_FORMATS: ReadonlySet<MediaEmbeddedFormat> =
  new Set(['jpeg', 'png', 'webp', 'tiff', 'pdf', 'ooxml'])

/** How a value is typed, which decides the editor and the validation. */
export type MediaEmbeddedValueKind =
  | 'text'
  | 'longText'
  | 'list'
  | 'date'
  | 'rating'
  | 'gps'

export interface MediaEmbeddedCatalogEntry {
  label: string
  group: MediaEmbeddedGroup
  kind: MediaEmbeddedValueKind
  /**
   * The formats an edit of this key can be written into. Absent means the
   * key is read-only everywhere — a measured fact such as an exposure time
   * or a page count, which describes the bytes rather than annotating them.
   */
  writable?: readonly MediaEmbeddedFormat[]
  /**
   * `gps` only: the one edit offered is removal. Moving a photo's recorded
   * location is not a thing anybody needs from a DAM; taking it OFF a photo
   * before it goes on a public page is.
   */
  removeOnly?: boolean
  /** Format-specific label, where a format names the idea differently. */
  labels?: Partial<Record<MediaEmbeddedFormat, string>>
  /** Format-specific group — a PDF's creation date is not a camera fact. */
  groups?: Partial<Record<MediaEmbeddedFormat, MediaEmbeddedGroup>>
}

const IMAGE_WRITABLE: readonly MediaEmbeddedFormat[] = [
  'jpeg',
  'png',
  'webp',
  'tiff',
]
const IMAGE_AND_PDF: readonly MediaEmbeddedFormat[] = [...IMAGE_WRITABLE, 'pdf']
const IMAGE_PDF_OOXML: readonly MediaEmbeddedFormat[] = [
  ...IMAGE_AND_PDF,
  'ooxml',
]

/**
 * Every canonical key, in display order within its group.
 *
 * ## Value formats every reader and writer agrees on
 *
 * - `date`: ISO 8601 — `2021-05-03T10:11:12`, with `Z` or `±HH:MM` only when
 *   the source recorded a zone (EXIF 2.3's `OffsetTimeOriginal`, a PDF
 *   date's `+05'00'`). Never invented: a local camera time stays local.
 * - `list`: an array of strings (creators, keywords).
 * - `gps`: `"<lat>,<lon>"` in signed decimal degrees, six places.
 * - `rating`: `"0"`–`"5"`, XMP's scale; `"-1"` is XMP's "rejected".
 * - technical values are display strings already (`1/250`, `f/2.8`,
 *   `35 mm`) because nothing edits them.
 */
export const MEDIA_EMBEDDED_CATALOG = {
  title: {
    label: 'Title',
    group: 'description',
    kind: 'text',
    writable: IMAGE_PDF_OOXML,
  },
  headline: {
    label: 'Headline',
    group: 'description',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  description: {
    label: 'Description',
    group: 'description',
    kind: 'longText',
    writable: IMAGE_PDF_OOXML,
    labels: { pdf: 'Subject', ooxml: 'Comments' },
  },
  subject: {
    label: 'Subject',
    group: 'description',
    kind: 'text',
    writable: ['ooxml'],
  },
  keywords: {
    label: 'Keywords',
    group: 'description',
    kind: 'list',
    writable: IMAGE_PDF_OOXML,
  },
  category: {
    label: 'Category',
    group: 'description',
    kind: 'text',
    writable: ['ooxml'],
  },
  comment: {
    label: 'Comment',
    group: 'description',
    kind: 'longText',
    writable: ['png'],
  },
  instructions: {
    label: 'Instructions',
    group: 'description',
    kind: 'longText',
    writable: IMAGE_WRITABLE,
  },
  label: {
    label: 'Label',
    group: 'description',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  rating: {
    label: 'Rating',
    group: 'description',
    kind: 'rating',
    writable: IMAGE_WRITABLE,
  },
  creator: {
    label: 'Creator',
    group: 'rights',
    kind: 'list',
    writable: IMAGE_PDF_OOXML,
    labels: { pdf: 'Author', ooxml: 'Author' },
  },
  copyright: {
    label: 'Copyright',
    group: 'rights',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  credit: {
    label: 'Credit line',
    group: 'rights',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  source: {
    label: 'Source',
    group: 'rights',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  usageTerms: {
    label: 'Usage terms',
    group: 'rights',
    kind: 'longText',
    writable: IMAGE_WRITABLE,
  },
  webStatement: {
    label: 'Copyright info URL',
    group: 'rights',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  city: {
    label: 'City',
    group: 'location',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  state: {
    label: 'State / province',
    group: 'location',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  country: {
    label: 'Country',
    group: 'location',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  gps: {
    label: 'GPS position',
    group: 'location',
    kind: 'gps',
    writable: IMAGE_WRITABLE,
    removeOnly: true,
  },
  gpsAltitude: { label: 'Altitude', group: 'location', kind: 'text' },
  createdAt: {
    label: 'Date taken',
    group: 'capture',
    kind: 'date',
    writable: IMAGE_AND_PDF,
    labels: {
      pdf: 'Created',
      ooxml: 'Created',
      svg: 'Created',
      mp4: 'Recorded',
      webm: 'Recorded',
    },
    groups: { pdf: 'document', ooxml: 'document', svg: 'document' },
  },
  make: {
    label: 'Camera make',
    group: 'capture',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  model: {
    label: 'Camera model',
    group: 'capture',
    kind: 'text',
    writable: IMAGE_WRITABLE,
  },
  lens: { label: 'Lens', group: 'capture', kind: 'text', writable: IMAGE_WRITABLE },
  exposure: { label: 'Exposure', group: 'capture', kind: 'text' },
  aperture: { label: 'Aperture', group: 'capture', kind: 'text' },
  iso: { label: 'ISO', group: 'capture', kind: 'text' },
  focalLength: { label: 'Focal length', group: 'capture', kind: 'text' },
  flash: { label: 'Flash', group: 'capture', kind: 'text' },
  modifiedAt: {
    label: 'Modified',
    group: 'document',
    kind: 'date',
  },
  software: {
    label: 'Software',
    group: 'document',
    kind: 'text',
    writable: IMAGE_AND_PDF,
    labels: { pdf: 'Created with', ooxml: 'Application' },
  },
  producer: {
    label: 'PDF producer',
    group: 'document',
    kind: 'text',
    writable: ['pdf'],
  },
  lastModifiedBy: { label: 'Last modified by', group: 'document', kind: 'text' },
  company: { label: 'Company', group: 'document', kind: 'text' },
  pageCount: {
    label: 'Pages',
    group: 'document',
    kind: 'text',
    labels: { ooxml: 'Pages / slides' },
  },
  pdfVersion: { label: 'PDF version', group: 'document', kind: 'text' },
  orientation: { label: 'Orientation', group: 'technical', kind: 'text' },
  colorProfile: { label: 'Color profile', group: 'technical', kind: 'text' },
  encoder: { label: 'Encoder', group: 'technical', kind: 'text' },
} as const satisfies Record<string, MediaEmbeddedCatalogEntry>

export type MediaEmbeddedCanonicalKey = keyof typeof MEDIA_EMBEDDED_CATALOG

/**
 * The namespaces an "other" key can come from. The key round-trips from
 * reader to writer verbatim, so its only job is to be unambiguous:
 *
 * - `xmp|<namespace URI>|<local name>` — a simple XMP property outside the
 *   catalog. Keyed by URI, not prefix, because two files may bind the same
 *   namespace to different prefixes and must still produce one key.
 * - `png|<keyword>` — a PNG `tEXt`/`zTXt`/`iTXt` chunk.
 * - `pdf|<Name>` — a PDF document-info entry (Acrobat's "Custom" tab).
 * - `ooxml|<name>` — an Office custom document property.
 * - `mp4|<atom or freeform name>`, `webm|<TAG>` — video tags, read-only.
 */
export type MediaEmbeddedOtherNamespace =
  | 'xmp'
  | 'png'
  | 'pdf'
  | 'ooxml'
  | 'mp4'
  | 'webm'

export function otherEmbeddedKey(
  namespace: MediaEmbeddedOtherNamespace,
  ...parts: string[]
): string {
  return [namespace, ...parts].join('|')
}

export function parseOtherEmbeddedKey(
  key: string,
): { namespace: MediaEmbeddedOtherNamespace; parts: string[] } | null {
  const [namespace = '', ...parts] = key.split('|')
  if (!parts.length) return null
  if (!['xmp', 'png', 'pdf', 'ooxml', 'mp4', 'webm'].includes(namespace))
    return null
  return { namespace: namespace as MediaEmbeddedOtherNamespace, parts }
}

/** The "other" namespaces a writer accepts edits for, by format. */
const OTHER_WRITABLE: Partial<
  Record<MediaEmbeddedOtherNamespace, readonly MediaEmbeddedFormat[]>
> = {
  xmp: IMAGE_WRITABLE,
  png: ['png'],
  pdf: ['pdf'],
  ooxml: ['ooxml'],
}

/** One field as stored on the media document and shown in the drawer. */
export interface MediaEmbeddedField {
  /** A {@link MediaEmbeddedCanonicalKey} or an {@link otherEmbeddedKey}. */
  key: string
  label: string
  group: MediaEmbeddedGroup
  /** Single-valued fields. Absent when `values` is set. */
  value?: string
  /** List-valued fields (creators, keywords). */
  values?: string[]
  /** Every block the value was found in, strongest first. */
  sources: MediaEmbeddedSource[]
  /** Whether the drawer may offer an edit for it on this file. */
  editable: boolean
}

/**
 * `embeddedMetadata` on a media document (AGL-3331). Server-written only —
 * the Firestore rules lock it like every other fact read from the bytes.
 */
export interface MediaEmbeddedMetadata {
  /** Bumped when the reader's output changes shape, so a sweep can re-read. */
  version: number
  format: MediaEmbeddedFormat
  fields: MediaEmbeddedField[]
  /** Whether an edit can be written back into this file at all. */
  writable: boolean
  /** Why not, in a sentence for the drawer, when `writable` is false. */
  readOnlyReason?: string
  /** True when fields were dropped to stay inside the stored caps. */
  truncated?: boolean
  /**
   * The `contentSha256` of the bytes this was read from. A record whose
   * digest no longer matches the document's is stale — the file was
   * replaced by a path that did not re-read it — and is re-read on open.
   */
  contentSha256?: string
}

/** The reader's output version. See {@link MediaEmbeddedMetadata.version}. */
export const MEDIA_EMBEDDED_METADATA_VERSION = 1

/** Stored caps: one media document must never approach Firestore's 1 MiB. */
export const MEDIA_EMBEDDED_MAX_FIELDS = 150
export const MEDIA_EMBEDDED_MAX_VALUE_LENGTH = 2000
export const MEDIA_EMBEDDED_MAX_LIST_ITEMS = 100
/** A single keyword or creator; IPTC's own limit for keywords is 64 bytes. */
export const MEDIA_EMBEDDED_MAX_LIST_ITEM_LENGTH = 256

/**
 * An edit to a file's embedded metadata: key → new value, or `null` to
 * remove it from the file. A list-valued key takes an array.
 */
export type MediaEmbeddedPatch = Record<string, string | string[] | null>

export function isCanonicalEmbeddedKey(
  key: string,
): key is MediaEmbeddedCanonicalKey {
  return Object.prototype.hasOwnProperty.call(MEDIA_EMBEDDED_CATALOG, key)
}

/** The label a key carries on a given format. */
export function embeddedFieldLabel(
  key: string,
  format: MediaEmbeddedFormat,
  fallback?: string,
): string {
  if (isCanonicalEmbeddedKey(key)) {
    const entry: MediaEmbeddedCatalogEntry = MEDIA_EMBEDDED_CATALOG[key]
    return entry.labels?.[format] ?? entry.label
  }
  return fallback ?? parseOtherEmbeddedKey(key)?.parts.at(-1) ?? key
}

/** The group a key is shown under on a given format. */
export function embeddedFieldGroup(
  key: string,
  format: MediaEmbeddedFormat,
): MediaEmbeddedGroup {
  if (!isCanonicalEmbeddedKey(key)) return 'other'
  const entry: MediaEmbeddedCatalogEntry = MEDIA_EMBEDDED_CATALOG[key]
  return entry.groups?.[format] ?? entry.group
}

/** How a key's value is edited. Other keys are free text. */
export function embeddedFieldKind(key: string): MediaEmbeddedValueKind {
  return isCanonicalEmbeddedKey(key)
    ? (MEDIA_EMBEDDED_CATALOG[key] as MediaEmbeddedCatalogEntry).kind
    : 'text'
}

/**
 * Whether an edit of `key` can be written into a file of `format`.
 *
 * The one place the answer lives: the reader stamps `editable` with it, the
 * drawer offers the "add a field" choices from it, and the write route
 * refuses anything it says no to — so the three cannot disagree about which
 * fields a JPEG can take.
 */
export function embeddedKeyWritable(
  key: string,
  format: MediaEmbeddedFormat,
): boolean {
  if (!MEDIA_EMBEDDED_WRITABLE_FORMATS.has(format)) return false
  if (isCanonicalEmbeddedKey(key)) {
    const entry: MediaEmbeddedCatalogEntry = MEDIA_EMBEDDED_CATALOG[key]
    return Boolean(entry.writable?.includes(format))
  }
  const other = parseOtherEmbeddedKey(key)
  return Boolean(other && OTHER_WRITABLE[other.namespace]?.includes(format))
}

/**
 * The canonical keys a file of this format can take, whether or not it
 * holds them yet — what the drawer offers under "Add a field".
 */
export function embeddedWritableKeys(
  format: MediaEmbeddedFormat,
): MediaEmbeddedCanonicalKey[] {
  return (Object.keys(MEDIA_EMBEDDED_CATALOG) as MediaEmbeddedCanonicalKey[])
    .filter((key) => embeddedKeyWritable(key, format))
}

/** A strict ISO 8601 date or date-time, the only date a writer accepts. */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/

/**
 * Validate an edit before it reaches a writer, or say why it cannot.
 *
 * Runs in the drawer (to explain) and in the write route (to refuse), so
 * the messages are written for the person who typed the value.
 */
export function sanitizeEmbeddedPatch(
  format: MediaEmbeddedFormat,
  patch: unknown,
): { patch: MediaEmbeddedPatch } | { error: string } {
  if (!MEDIA_EMBEDDED_WRITABLE_FORMATS.has(format)) {
    return { error: 'This kind of file cannot take metadata edits.' }
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'Nothing to change.' }
  }
  const out: MediaEmbeddedPatch = {}
  for (const [rawKey, raw] of Object.entries(patch as Record<string, unknown>)) {
    const key = rawKey.trim()
    if (!embeddedKeyWritable(key, format)) {
      return {
        error: `${embeddedFieldLabel(key, format)} cannot be written into this file.`,
      }
    }
    const label = embeddedFieldLabel(key, format)
    if (raw === null) {
      out[key] = null
      continue
    }
    const entry: MediaEmbeddedCatalogEntry | undefined = isCanonicalEmbeddedKey(
      key,
    )
      ? MEDIA_EMBEDDED_CATALOG[key]
      : undefined
    if (entry?.removeOnly) {
      return { error: `${label} can only be removed.` }
    }
    const kind = embeddedFieldKind(key)
    if (kind === 'list') {
      const items = (Array.isArray(raw) ? raw : String(raw).split(/[,;\n]/))
        .map((item) => String(item).trim())
        .filter(Boolean)
      if (items.length > MEDIA_EMBEDDED_MAX_LIST_ITEMS) {
        return { error: `${label} holds at most ${MEDIA_EMBEDDED_MAX_LIST_ITEMS} entries.` }
      }
      if (items.some((item) => item.length > MEDIA_EMBEDDED_MAX_LIST_ITEM_LENGTH)) {
        return { error: `An entry in ${label} is too long.` }
      }
      out[key] = items.length ? [...new Set(items)] : null
      continue
    }
    if (typeof raw !== 'string') {
      return { error: `${label} must be text.` }
    }
    const value = raw.trim()
    if (!value) {
      out[key] = null
      continue
    }
    if (value.length > MEDIA_EMBEDDED_MAX_VALUE_LENGTH) {
      return { error: `${label} is too long.` }
    }
    if (kind === 'date' && !ISO_DATE.test(value)) {
      return { error: `${label} must be a date.` }
    }
    if (kind === 'rating' && !/^(?:-1|[0-5])$/.test(value)) {
      return { error: `${label} must be between 0 and 5.` }
    }
    out[key] = value
  }
  if (!Object.keys(out).length) return { error: 'Nothing to change.' }
  return { patch: out }
}

/** The value of a field as one line of text. */
export function embeddedFieldText(field: MediaEmbeddedField): string {
  return field.values ? field.values.join(', ') : (field.value ?? '')
}

/**
 * The stored content types a reader exists for — the drawer asks the
 * server to read a file only when this says there is something to find, so
 * a CSV never costs a round trip to learn it has no caption.
 */
const READABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

export function embeddedMetadataReadable(contentType: unknown): boolean {
  return READABLE_TYPES.has(
    String(contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '',
  )
}

/**
 * A field's value as the drawer shows it — the stored value is the
 * machine form every writer agrees on, and this is the only place it is
 * dressed for a person.
 */
export function embeddedFieldDisplay(
  field: Pick<MediaEmbeddedField, 'key' | 'value' | 'values'>,
  locale?: string,
): string {
  if (field.values) return field.values.join(', ')
  const value = field.value ?? ''
  switch (embeddedFieldKind(field.key)) {
    case 'date': {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
      // A date-only value parsed by `Date` is UTC midnight, which renders as
      // the previous day west of Greenwich; noon keeps it on its own date.
      const parsed = new Date(dateOnly ? `${value}T12:00:00` : value)
      if (Number.isNaN(parsed.getTime())) return value
      return parsed.toLocaleString(locale, {
        dateStyle: 'medium',
        ...(dateOnly ? {} : { timeStyle: 'short' }),
      })
    }
    case 'gps': {
      const [lat, lon] = value.split(',').map(Number)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return value
      const part = (n: number, positive: string, negative: string) =>
        `${Math.abs(n).toFixed(5)}° ${n < 0 ? negative : positive}`
      return `${part(lat as number, 'N', 'S')}, ${part(lon as number, 'E', 'W')}`
    }
    case 'rating': {
      const stars = Number(value)
      if (stars === -1) return 'Rejected'
      if (!Number.isInteger(stars) || stars < 0 || stars > 5) return value
      return '★'.repeat(stars) + '☆'.repeat(5 - stars)
    }
    default:
      return value
  }
}
