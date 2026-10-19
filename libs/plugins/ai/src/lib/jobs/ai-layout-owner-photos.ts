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

import type { PluginMediaAsset } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { pluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type {
  AiLayoutPicturePhoto,
  AiLayoutPictureSlot,
  AiLayoutPictureSource,
} from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  type AiLayoutStockPhotoDeps,
  type AiLayoutStockPhotoSourceInput,
} from './ai-layout-stock-photos'

/**
 * THE BUSINESS'S OWN PHOTOS COME FIRST (AGL-3957).
 *
 * A site built for an owner at a booth or on a doorstep has, by the time its
 * pages are drawn, the photos they sent from their phone through a site
 * photo link: their van, their shop, their work. A photo of the owner's own
 * work beats any stock photo, so a page's picture slots are filled from
 * those first, and only the slots left over are searched for in the stock
 * library, the way they were before.
 *
 * Which photo goes where is decided by shape and size, not by subject: an
 * owner's photo says nothing a search could read. The hero takes the widest
 * photo among the largest; the about picture takes the next largest; the
 * gallery takes the rest, newest first, each photo once on the page and once
 * across the job (`avoid`). A product's photo, a person's portrait and a
 * record's cover are of one named thing, which a photo of the business in
 * general is not, so those slots go to the stock search untouched.
 */

export interface AiLayoutOwnerPhotoDeps extends AiLayoutStockPhotoDeps {
  /** The stock source the leftover slots go to; the real one otherwise. Specs hand in a fake. */
  stock?: typeof aiLayoutStockPhotoSource
  /** The most owner photos read for one page. */
  limit?: number
}

const OWNER_PHOTOS_LIMIT = 60

/** A slot an owner's photo may fill: one of the business in general, not of one named thing. */
export function aiOwnerPhotoFits(slot: AiLayoutPictureSlot): boolean {
  return !slot.product && !slot.people && !slot.record
}

/** Fill order: the hero first, so the biggest photo is the first one seen; then about; then the gallery in document order. */
const ROLE_RANK = { hero: 0, about: 1, gallery: 2 } as const

function area(photo: PluginMediaAsset): number {
  return (photo.width ?? 0) * (photo.height ?? 0)
}

/**
 * Assigns the owner's photos to the slots, in the order above. Pure, so a
 * spec can hold the choice itself: `null` for a slot left to the stock
 * search, in slot order.
 */
export function aiAssignOwnerPhotos(
  slots: readonly AiLayoutPictureSlot[],
  photos: readonly PluginMediaAsset[],
  avoid: ReadonlySet<string> = new Set(),
): Array<AiLayoutPicturePhoto | null> {
  const pool = photos
    .filter((photo) => photo.src && (photo.width ?? 0) > 0 && (photo.height ?? 0) > 0 && !avoid.has(photo.src))
    .sort((a, b) => area(b) - area(a))
  const answers: Array<AiLayoutPicturePhoto | null> = slots.map(() => null)
  const used = new Set<string>()
  const order = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => aiOwnerPhotoFits(slot))
    .sort((a, b) => ROLE_RANK[a.slot.role] - ROLE_RANK[b.slot.role] || a.index - b.index)
  for (const { slot, index } of order) {
    const free = pool.filter((photo) => !used.has(photo.src))
    if (!free.length) break
    // The hero wants the widest of the three largest; a portrait phone photo
    // in a wide frame is the one mismatch a visitor sees first.
    const pick =
      slot.role === 'hero'
        ? [...free.slice(0, 3)].sort(
            (a, b) => (b.width ?? 0) / (b.height ?? 1) - (a.width ?? 0) / (a.height ?? 1),
          )[0]
        : free[0]
    if (!pick) break
    used.add(pick.src)
    answers[index] = {
      src: pick.src,
      width: pick.width as number,
      height: pick.height as number,
      ...(pick.alt ? { alt: pick.alt } : {}),
    }
  }
  return answers
}

/**
 * The source for one page: the owner's photos for the slots they fit, the
 * stock library for the rest. `null` only when neither can answer — no
 * media door and no stock library — which leaves every slot to the starters.
 */
export function aiLayoutSitePhotoSource(
  input: AiLayoutStockPhotoSourceInput,
  deps: AiLayoutOwnerPhotoDeps = {},
): AiLayoutPictureSource | null {
  const stock = (deps.stock ?? aiLayoutStockPhotoSource)(input, deps)
  const ingest = (deps.ingest ?? pluginMediaIngest)()
  const list = ingest?.listOwnerPhotos?.bind(ingest)
  if (!list || !input.hostId) return stock
  return async (slots) => {
    let photos: PluginMediaAsset[] = []
    try {
      photos = await list({ hostId: input.hostId, limit: deps.limit ?? OWNER_PHOTOS_LIMIT })
    } catch (error) {
      console.warn('ai layout pictures: the owner photos could not be read; stock photos fill the page', { error })
    }
    const answers = aiAssignOwnerPhotos(slots, photos, new Set(input.avoid ?? []))
    if (!stock) return answers
    const open = slots.filter((_slot, index) => !answers[index])
    if (!open.length) return answers
    // The stock source sees only the slots the owner's photos left, so its
    // own no-repeat rules and search budget are spent on those alone.
    const found = await stock(open)
    let next = 0
    return answers.map((answer) => answer ?? found[next++] ?? null)
  }
}
