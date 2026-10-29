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

import type { StockPhotoSearchRequest } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPicturePhoto, AiLayoutPictureRole } from '../layout-language/ai-layout-pictures'

/**
 * THE PICTURES A SITE START LEFT ON A STARTER PHOTO (AGL-3988).
 *
 * A guided start's pages and its datasets' records are each built in a pass
 * of their own, minutes apart. A picture the stock library could not fill in
 * its pass took a starter photo there: its picks' downloads refused by the
 * library's image hosts in a burst, or no photo of the job's own to take
 * yet. The v1.0.0-beta.271 Laurel Fork Photography start (2026-10-19 23:05Z)
 * filed all twelve "Gallery collections" covers and its home hero under an
 * office team and a desk: pixabay.com's Cloudflare answered 429 to 22
 * downloads while the covers were built, before the job had copied any
 * photo, and to 11 more on the home page, the first page built.
 *
 * Each such picture is written down here, with the picks the hosts refused,
 * on the job, by the machine, in the write that records its pass. The site
 * step's late photo pass (`jobs/ai-site-late-photos.ts`) reads it once every
 * page is built and before the site is published: it asks the refused picks
 * for again, a minute after the refusal, and gives every picture still on a
 * starter one of the photos the job copied. Pure.
 */

/** Where a starter photo is served from: the platform's own files, on every site's origin. */
export const AI_SITE_STARTER_PREFIX = '/_static/starter/'

/** Whether an address is a starter photo's. */
export function aiSiteIsStarterSrc(src: unknown): boolean {
  return typeof src === 'string' && src.startsWith(AI_SITE_STARTER_PREFIX)
}

/** The picks a slot kept in hand whose downloads the library's image hosts refused, to ask for again. */
export interface AiStockRefusedPicks {
  /** The search they came from, as it was sent: asked again, the provider's cache answers it. */
  request: StockPhotoSearchRequest
  /** The picks' source keys (`pixabay:5401602`), best first. */
  keys: string[]
  /** When the last of them was refused, ISO. */
  at: string
}

/** A picture of one of the start's pages that holds a starter photo. */
export interface AiSiteStarterSlot {
  /** The `image` node. */
  image: string
  /** What the picture was to show, in the slot's own words: a starter's alt text is the starter's. */
  words: string
  role: AiLayoutPictureRole
  /** The frame's shape, width over height. */
  aspect: number
  refused?: AiStockRefusedPicks
}

/** A page of the start with the pictures it left on a starter. */
export interface AiSiteStarterPage {
  /** The page's draft. */
  screen: string
  slots: AiSiteStarterSlot[]
}

/** A record of a pictured list, as its photo was written. */
export interface AiSiteListRecord {
  /** The record's name: its first field's value. */
  name: string
  /** What the list files it under, where it files its records (AGL-3856). */
  category?: string
  /** The value its photo field holds: a starter's path, or the library photo's CDN path. */
  value: string
  /** The library photo it shows, with its size and words; absent on a starter. */
  photo?: AiLayoutPicturePhoto
  refused?: AiStockRefusedPicks
  /** A record of a thing of its own (AGL-4092): its own photo or its starter, never another record's or the job's. */
  itsOwn?: true
}

/** A pictured list of the start, one of whose records holds a starter photo. */
export interface AiSiteStarterList {
  /** The dataset. */
  dataset: string
  /** Its photo field, by id. */
  imageField: string
  /** The field its records keep what their photo shows in, by id (AGL-3856). */
  altField?: string
  /** A list of the business's people: a record of it never takes a photo of anything but a person. */
  people?: boolean
  /** Every record, in order, so a record's neighbors are known. */
  records: AiSiteListRecord[]
}

/** What a site job holds on its pictures that took a starter, until its late photo pass. */
export interface AiSitePhotos {
  pages: AiSiteStarterPage[]
  lists: AiSiteStarterList[]
  /**
   * The late photo passes that ran out of time and handed this back (AGL-3988).
   * The site step publishes on the last pass its bound gives them, whatever
   * the pictures hold then, so a burst that never clears never holds a site
   * back.
   */
  latePasses?: number
}

/** The most of each a job keeps: a site's pages, each one's pictures, and its lists' records. */
const PAGES_MAX = 12
const SLOTS_MAX = 16
const LISTS_MAX = 8
const RECORDS_MAX = 24
const KEYS_MAX = 3

/** An entry with its refused picks bounded, and none where it has none. */
function withPicks<T extends { refused?: AiStockRefusedPicks }>(entry: T): T {
  const copy = { ...entry }
  delete copy.refused
  const keys = entry.refused?.keys.slice(0, KEYS_MAX) ?? []
  return entry.refused && keys.length ? { ...copy, refused: { ...entry.refused, keys } } : copy
}

/** A page's starters as a job keeps them: bounded, and none without a picture. */
function pageOf(page: AiSiteStarterPage): AiSiteStarterPage | null {
  const slots = page.slots.slice(0, SLOTS_MAX).map(withPicks)
  return page.screen && slots.length ? { screen: page.screen, slots } : null
}

/** Whether a list still holds a starter on any record. */
function listHoldsStarters(list: AiSiteStarterList): boolean {
  return list.records.some((record) => aiSiteIsStarterSrc(record.value))
}

/**
 * The job's photos state once a unit reported its own (AGL-3988): a page's
 * or a list's entry replaces the one it had, by its draft or its dataset;
 * every other entry stays. `null` where neither holds anything.
 */
export function aiSiteMergePhotos(
  previous: AiSitePhotos | null | undefined,
  next: Partial<AiSitePhotos> | null | undefined,
): AiSitePhotos | null {
  const pages = new Map((previous?.pages ?? []).map((page) => [page.screen, page]))
  for (const page of next?.pages ?? []) {
    const kept = pageOf(page)
    if (kept) pages.set(kept.screen, kept)
    else pages.delete(page.screen)
  }
  const lists = new Map((previous?.lists ?? []).map((list) => [list.dataset, list]))
  for (const list of next?.lists ?? []) {
    if (list.dataset && list.imageField && listHoldsStarters(list)) {
      lists.set(list.dataset, { ...list, records: list.records.slice(0, RECORDS_MAX).map(withPicks) })
    } else lists.delete(list.dataset)
  }
  const merged: AiSitePhotos = { pages: [...pages.values()].slice(0, PAGES_MAX), lists: [...lists.values()].slice(0, LISTS_MAX) }
  const latePasses = next?.latePasses ?? previous?.latePasses
  if (latePasses) merged.latePasses = latePasses
  return merged.pages.length || merged.lists.length ? merged : null
}

/**
 * Whether a site job owes its late photo pass: a page picture or a list
 * record it left on a starter. With `pageIds`, only a picture of one of
 * those pages counts: a page that was not built is never published.
 */
export function aiSitePhotosOwed(photos: AiSitePhotos | null | undefined, pageIds?: readonly string[]): boolean {
  const built = pageIds ? new Set(pageIds) : null
  return Boolean(
    photos?.pages.some((page) => page.slots.length && (!built || built.has(page.screen))) || photos?.lists.some(listHoldsStarters),
  )
}

/** When the newest refusal the state holds was made, in ms; `null` where none was. */
export function aiSitePhotosLastRefusalMs(photos: AiSitePhotos | null | undefined): number | null {
  const times = [
    ...(photos?.pages ?? []).flatMap((page) => page.slots.map((slot) => slot.refused?.at)),
    ...(photos?.lists ?? []).flatMap((list) => list.records.map((record) => record.refused?.at)),
  ]
    .map((at) => (at ? Date.parse(at) : NaN))
    .filter((ms) => Number.isFinite(ms))
  return times.length ? Math.max(...times) : null
}
