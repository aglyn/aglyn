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

import { siteRelativeMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import type {
  StockPhotoOrientation,
  StockPhotoPick,
  StockPhotoPickRequest,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import {
  aiLayoutStarterPhotos,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import { aiLayoutStockPhotoSource } from './ai-layout-stock-photos'

/**
 * THE STOCK PHOTO PICKER ANOTHER PLUGIN ASKS FOR (AGL-3755).
 *
 * The AI plugin's answer on `core.stock-photo-picker`: one photo for one
 * subject, chosen exactly as a language page's picture is
 * ({@link aiLayoutStockPhotoSource}) — the subject's nouns searched and
 * qualified by the business's craft, hits scored by tag overlap and held to
 * the business's world, sensitive and off-topic hits refused, nothing placed
 * twice in one act (`scope`, the job), the business's broad searches when
 * the subject finds nothing — and copied into the site's library once: a
 * photo the library already holds is reused. Where the library is down,
 * unconfigured or answers nothing acceptable, a starter photo stands in,
 * since a starter reads better than no picture at all.
 *
 * The answer is servable as it stands: a library photo's `url` is its
 * site-relative CDN path (`siteRelativeMediaSrc`), a starter's is its
 * `/_static/starter/` path. Never throws, and no AI model runs.
 */

/** A slot's shape for each orientation: a card's, a portrait's, a square's. */
const ASPECTS: Readonly<Record<StockPhotoOrientation, number>> = {
  horizontal: 3 / 2,
  vertical: 4 / 5,
  any: 1,
}

/** The longest description the picker stores with a photo. */
const ALT_MAX = 300

export interface AiStockPhotoPickDeps {
  /** The page's source; specs hand in one over recorded hits. */
  source?: typeof aiLayoutStockPhotoSource
}

function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''
}

/** The pick of a placed photo, described by its own words where it brings them, else by the slot's (AGL-3856). */
function pickOf(
  photo: AiLayoutPicturePhoto,
  origin: StockPhotoPick['origin'],
  hostId: string,
  alt: string,
): StockPhotoPick | null {
  const url = origin === 'library' ? siteRelativeMediaSrc(photo.src, { hostId }) : photo.src
  const said = photo.alt?.trim() || alt
  return url ? { src: photo.src, url, width: photo.width, height: photo.height, origin, ...(said ? { alt: said } : {}) } : null
}

/** A photo for the request's subject: from the site's library or the stock library, else a starter. */
export async function aiStockPhotoPick(
  request: StockPhotoPickRequest,
  deps: AiStockPhotoPickDeps = {},
): Promise<StockPhotoPick | null> {
  const subject = line(request.subject)
  if (!subject || !request.hostId) return null
  const alt = (line(request.alt) || subject).slice(0, ALT_MAX)
  const slot: AiLayoutPictureSlot = {
    imageId: 'pick',
    frameId: null,
    iconId: null,
    alt,
    aspect: ASPECTS[request.orientation ?? 'horizontal'],
    sectionIndex: 0,
    role: 'gallery',
    // A subject alone is a search's words, never a description: an event's
    // title is not what its cover shows (AGL-3856).
    ...(line(request.alt) ? {} : { standIn: true }),
  }
  const seed = line(request.seed) || `${request.scope ?? request.hostId}:${subject}`
  try {
    const source = (deps.source ?? aiLayoutStockPhotoSource)({
      hostId: request.hostId,
      uid: request.uid,
      seed,
      // The business holds the photo to its world; with none, the subject is the world.
      business: line(request.business) || subject,
      sectionNames: [subject],
      ...(request.scope ? { jobId: request.scope } : {}),
      ...(request.avoid?.length ? { avoid: request.avoid } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    })
    const [found] = source ? await source([slot]) : []
    const picked = found?.src ? pickOf(found, 'library', request.hostId, alt) : null
    if (picked) return picked
  } catch (error) {
    console.warn('ai stock photo pick: the stock library failed; a starter stands in', {
      error: String(error),
    })
  }
  const [starter] = aiLayoutStarterPhotos([slot], seed)
  return starter ? pickOf(starter, 'starter', request.hostId, alt) : null
}
