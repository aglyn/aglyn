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

import { nameSearchKey, nameSearchTokens } from './name-search-tokens.mjs'

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

/**
 * `mediaFilterKeys`: what the library filters, sorts and searches a
 * document by.
 *
 * @param {{ fileName?: unknown, contentType?: unknown, alt?: unknown,
 *   width?: unknown, height?: unknown, video?: unknown }} media
 */
export function mediaFilterKeys(media) {
  const fileName = String(media?.fileName ?? '')
  return {
    kind: mediaKindOf(media?.contentType),
    nameLower: nameSearchKey(fileName),
    nameTokens: nameSearchTokens(mediaNameWords(fileName)),
    hasAlt: String(media?.alt ?? '').trim().length > 0,
    orientation: mediaOrientationOf(media ?? {}),
  }
}
