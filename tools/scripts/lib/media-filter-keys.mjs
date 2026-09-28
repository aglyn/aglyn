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

// The media library's filter and search keys (AGL-3327), for the scripts
// that write media documents: the backfill that stamps the documents written
// before the keys existed, and `putMediaDocument`, which every seed and e2e
// fixture writes through.
//
// The media-specific half of `mediaFilterKeys` in
// `libs/aglyn/src/lib/app-utils/media-metadata.ts`, restated because a tools
// script cannot import TypeScript: the family, the orientation and how a file
// name splits into words. The name keys themselves come from the one
// script-side restatement of the platform's search keys,
// `name-search-tokens.mjs`. Both sides are held to
// `media-filter-keys.fixtures.json`: the library's `media-metadata.spec.ts`
// asserts it against the TypeScript, and `media-filter-keys.test.mjs`
// (`npm run test:media-filter-keys`) against this.

import { NAME_TOKEN_LIMIT, nameSearchKey, nameSearchTokens } from './name-search-tokens.mjs'

/** `mediaKindOf`: the family the library's Type filter names. */
export function mediaKindOf(contentType) {
  const type = String(contentType ?? '').trim().toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type === 'application/pdf') return 'pdf'
  return 'document'
}

const positive = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

/**
 * `mediaOrientationOf`: landscape, portrait or square, from a picture's
 * `width`/`height` or a film's `video.width`/`video.height`; null when
 * neither pair is whole.
 *
 * @param {{ width?: unknown, height?: unknown, video?: unknown }} media
 */
export function mediaOrientationOf(media) {
  const video = media?.video && typeof media.video === 'object' ? media.video : null
  let width = positive(media?.width)
  let height = positive(media?.height)
  if (width === null || height === null) {
    width = positive(video?.width)
    height = positive(video?.height)
  }
  if (width === null || height === null) return null
  if (width === height) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

/** `mediaNameWords`: every run that is not a letter or a digit becomes a space. */
export function mediaNameWords(fileName) {
  return String(fileName ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** `MEDIA_EMBEDDED_METADATA_VERSION`: the stored record's shape. */
const EMBEDDED_VERSION = 1

/** `SEARCHABLE_EMBEDDED_KEYS`: the details a search reads, most telling first. */
const SEARCHABLE_EMBEDDED_KEYS = [
  'title',
  'keywords',
  'headline',
  'subject',
  'creator',
  'credit',
  'source',
  'city',
  'state',
  'country',
  'category',
  'label',
  'description',
]

/** `embeddedMetadataIsCurrent`: a record of today's shape, for these bytes when they are known. */
function embeddedIsCurrent(stored, contentSha256) {
  if (!stored || typeof stored !== 'object') return false
  if (stored.version !== EMBEDDED_VERSION || !Array.isArray(stored.fields)) return false
  return typeof contentSha256 !== 'string' || stored.contentSha256 === contentSha256
}

/** `mediaEmbeddedSearchText`: the searchable text of a stored record. */
export function mediaEmbeddedSearchText(stored) {
  const fields = stored?.fields
  if (!Array.isArray(fields)) return ''
  const byKey = new Map(fields.map((field) => [field?.key, field]))
  return SEARCHABLE_EMBEDDED_KEYS.flatMap((key) => {
    const field = byKey.get(key)
    if (!field) return []
    return Array.isArray(field.values)
      ? field.values.map(String)
      : typeof field.value === 'string'
        ? [field.value]
        : []
  })
    .map((text) => text.trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * `mediaNameTokens`: the name's word prefixes, then the details' (AGL-3339),
 * inside the one `NAME_TOKEN_LIMIT`.
 */
export function mediaNameTokens(fileName, embeddedMetadata, contentSha256) {
  const tokens = new Set(nameSearchTokens(mediaNameWords(fileName)))
  if (!embeddedIsCurrent(embeddedMetadata, contentSha256)) return [...tokens]
  for (const token of nameSearchTokens(mediaNameWords(mediaEmbeddedSearchText(embeddedMetadata)))) {
    if (tokens.size >= NAME_TOKEN_LIMIT) break
    tokens.add(token)
  }
  return [...tokens]
}

/**
 * `mediaFilterKeys`: what the library filters, sorts and searches a
 * document by — the search reading the file's own details too (AGL-3339),
 * from the document's `embeddedMetadata`.
 *
 * @param {{ fileName?: unknown, contentType?: unknown, alt?: unknown,
 *   width?: unknown, height?: unknown, video?: unknown,
 *   embeddedMetadata?: unknown, contentSha256?: unknown }} media
 */
export function mediaFilterKeys(media) {
  const fileName = String(media?.fileName ?? '')
  return {
    kind: mediaKindOf(media?.contentType),
    nameLower: nameSearchKey(fileName),
    nameTokens: mediaNameTokens(fileName, media?.embeddedMetadata, media?.contentSha256),
    hasAlt: String(media?.alt ?? '').trim().length > 0,
    orientation: mediaOrientationOf(media ?? {}),
  }
}
