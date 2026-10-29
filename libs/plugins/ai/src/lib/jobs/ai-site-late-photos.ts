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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { pluginMediaIngest, type PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import {
  stockPhotoProvider,
  stockPhotoSourceKey,
  type StockPhotoProvider,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { Firestore } from 'firebase-admin/firestore'
import {
  aiLayoutJobPhotoPicks,
  aiLayoutPlacePictures,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
} from '../layout-language/ai-layout-pictures'
import type { AiJob } from '../model/ai-jobs.types'
import { aiSiteWords } from '../model/ai-site-job'
import {
  aiSiteIsStarterSrc,
  aiSitePhotosLastRefusalMs,
  type AiSitePhotos,
  type AiSiteStarterList,
  type AiStockRefusedPicks,
} from '../model/ai-site-photos'
import { AI_DATASET_DRAFT_RESOURCE } from './ai-build-unit-outcome'
import { aiOriginJobId } from './ai-job-draft-ids'
import { readAiDraftNodes, updateAiDraftNodes } from './ai-job-drafts'
import { aiSiteProductPhotoSrc } from './ai-job-site-content'
import { aiSiteDatasetPlacedPhotoDetails, aiSiteDatasetRecordsFromOwn } from './ai-job-site-datasets'
import {
  AI_LAYOUT_STOCK_MAX_BYTES,
  AI_STOCK_PHOTO_OWN_REFUSALS,
  aiStockIngestRequest,
  aiStockPhotoAlt,
  aiStockPhotoWordsOf,
  aiStockPlacedPhotos,
  aiStockProperWords,
} from './ai-layout-stock-photos'

/**
 * THE LATE PHOTO PASS OF A SITE START (AGL-3988).
 *
 * Every page and every dataset of a guided start is built in a pass of its
 * own, and each copies its own stock photos as it goes. Pixabay's image hosts
 * (behind Cloudflare) answer a burst of downloads with 429 for minutes at a
 * time, whatever the client waits inside one pass. The v1.0.0-beta.271 Laurel
 * Fork Photography start (job yZUqIPmjIZ, 2026-10-19 23:05Z) had 22 cover
 * downloads refused in the beat that built its datasets, 11 on its home page
 * and 20 later. Photo 1846114, refused at 23:08, was copied at 23:10:42. The
 * "Gallery collections" covers were written before the job had copied any
 * photo, and the home page was built first, so each fell back to the office
 * team and the desk, which also became the site's share image.
 *
 * So once every page is built, and before the site is published, the site
 * step runs this pass over what the job holds in `sitePhotos`:
 *
 * 1. **The refused picks again, after the burst.** It waits until
 *    {@link AI_SITE_LATE_PHOTOS_WAIT_MS} after the last refusal, then asks
 *    each picture's own picks for again from the search that found them,
 *    which the provider's 24-hour cache answers. No model, no credits. A
 *    pick a later page copied is taken from the library; two downloads
 *    refused in a row say the burst is not over, and nothing more is
 *    downloaded.
 * 2. **Then the job's own photos, everywhere.** A picture still on a starter
 *    takes (a) its own pick where the page does not show it yet, else (b)
 *    one of the photos the job copied that the page does not show, by the
 *    matchers its pages and covers already use: a page's picture by role,
 *    shape and words, a hero a wide photo (`aiLayoutJobPhotoPicks`); and
 *    only where none is left, (c) one the page shows elsewhere, and last
 *    the photo beside it, since the other choice is a starter that shows
 *    another business. A record goes by its category, then the people its
 *    moment shows, its neighbor's photo only where nothing else is left,
 *    from the end that repeats least (`aiSiteDatasetRecordsFromOwn`). A
 *    team's records take only their own picks, never a photo of something
 *    else.
 *
 * The pages' drafts are written in place, only where a picture still holds
 * a starter; the records through the data plugin's writer, only where a
 * record still holds the starter it was written with. A job that copied no
 * photo at all keeps its starters. Nothing here throws: a picture is
 * decoration, and a site is never held back by one.
 */

/** How long after the image hosts refused a pick it is asked for again: their bursts clear within minutes. */
export const AI_SITE_LATE_PHOTOS_WAIT_MS = 60_000

/** The wall clock the refused picks may take to copy, inside the pass's signal. */
export const AI_SITE_LATE_PHOTOS_COPY_MS = 30_000

/**
 * Downloads refused in a row after which the pass downloads nothing more: the
 * burst is not over, and each refusal costs the image hosts' own backoff.
 */
export const AI_SITE_LATE_PHOTOS_REFUSALS_IN_A_ROW = 2

/** ASSUMED: the pages' drafts, the records, and the publish that follows in the same pass. */
export const AI_SITE_LATE_PHOTOS_WRITES_MS = 20_000

/** The least time the pass needs: the wait, the copies, and the writes after them. */
export const AI_SITE_LATE_PHOTOS_MINIMUM_MS =
  AI_SITE_LATE_PHOTOS_WAIT_MS + AI_SITE_LATE_PHOTOS_COPY_MS + AI_SITE_LATE_PHOTOS_WRITES_MS

export interface AiSiteLatePhotosInput {
  firestore: Firestore
  job: Pick<AiJob, '$id' | 'orgId' | 'hostId' | 'createdBy' | 'inputs' | 'plan' | 'outputs'>
  photos: AiSitePhotos
  /** The pages the start built: only their pictures are filled, and only their photos are the job's. */
  pageIds: readonly string[]
  org: Readonly<Record<string, unknown>> | null
  now: Date
  signal?: AbortSignal
}

export interface AiSiteLatePhotosResult {
  /** What is left for another pass, where this one ran out of time; `null` once it is done. */
  photos: AiSitePhotos | null
  /** Pictures whose refused picks were asked for again, and of them copied. */
  retried: number
  copied: number
  /** Pictures given one of the job's own photos. */
  filled: number
  /** Pictures still on a starter. */
  left: number
}

export interface AiSiteLatePhotosDeps {
  provider?: () => StockPhotoProvider | null
  ingest?: () => PluginMediaIngest | null
  readNodes?: typeof readAiDraftNodes
  updateNodes?: typeof updateAiDraftNodes
  writerFor?: typeof pluginResourceDraftWriter
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Waits `ms`, or less when `signal` aborts first; resolves either way. */
function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** One image of a stored page, in document order. */
interface PageImage {
  imageId: string
  src: string
  width: number
  height: number
  alt: string
}

/**
 * A stored page's pictures in document order, as its picture slots were:
 * every `image` showing a photo, never one bound to a record's field.
 */
export function aiSitePageImages(nodes: NodesMap, rootId = CANVAS_ROOT_ELEMENT_ID): PageImage[] {
  const map = nodes as unknown as Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>
  const images: PageImage[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = map[id]
    if (!node) return
    if (node.componentId === 'image') {
      const src = node.props?.['src']
      if (typeof src === 'string' && src.trim() && !src.includes('{{')) {
        images.push({
          imageId: id,
          src,
          width: Number(node.props?.['intrinsicWidth']) || 0,
          height: Number(node.props?.['intrinsicHeight']) || 0,
          alt: typeof node.props?.['alt'] === 'string' ? (node.props['alt'] as string) : '',
        })
      }
    }
    for (const child of node.nodes ?? []) visit(child)
  }
  visit(rootId)
  return images
}

/** A starter slot as the matchers read it: its words, role and shape, and nothing it is not. */
function slotOf(
  imageId: string,
  entry: { words: string; role: AiLayoutPictureSlot['role']; aspect: number } | null,
): AiLayoutPictureSlot {
  return {
    imageId,
    frameId: null,
    iconId: null,
    alt: entry?.words ?? '',
    aspect: entry && entry.aspect > 0 ? entry.aspect : 1,
    sectionIndex: entry?.role === 'hero' ? 0 : 1,
    role: entry?.role ?? 'gallery',
  }
}

/**
 * The page with each starter its plan names given its photo, re-read on the
 * stored page: an image that no longer holds a starter is left as it is.
 */
export function aiSitePageWithPhotos(
  nodes: NodesMap,
  plan: ReadonlyArray<{ slot: AiLayoutPictureSlot; photo: AiLayoutPicturePhoto }>,
): NodesMap | null {
  const map = nodes as unknown as Record<string, { props?: Record<string, unknown> }>
  const live = plan.filter(({ slot }) => aiSiteIsStarterSrc(map[slot.imageId]?.props?.['src']))
  if (!live.length) return null
  return aiLayoutPlacePictures(
    nodes,
    live.map(({ slot }) => slot),
    // A photo that brings no words of its own takes the slot's, never the starter's (AGL-3831).
    live.map(({ slot, photo }) => (photo.alt?.trim() || !slot.alt ? photo : { ...photo, alt: slot.alt })),
  )
}

/** Runs the late photo pass (see the module note). Never throws. */
export async function aiSiteLatePhotos(
  input: AiSiteLatePhotosInput,
  deps: AiSiteLatePhotosDeps = {},
): Promise<AiSiteLatePhotosResult> {
  const { job, signal } = input
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? sleepFor
  const readNodes = deps.readNodes ?? readAiDraftNodes
  const updateNodes = deps.updateNodes ?? updateAiDraftNodes
  const writerFor = deps.writerFor ?? pluginResourceDraftWriter
  const hostId = job.hostId ?? ''
  const built = new Set(input.pageIds)
  const pages = input.photos.pages.filter((page) => built.has(page.screen) && page.slots.length)
  const lists = input.photos.lists
  const counts = { retried: 0, copied: 0, filled: 0, left: 0 }
  const done = (): AiSiteLatePhotosResult => ({ photos: null, ...counts })
  if (!hostId || (!pages.length && !lists.length)) return done()
  const provider = (deps.provider ?? stockPhotoProvider)()
  const ingest = (deps.ingest ?? pluginMediaIngest)()
  try {
    // ── 1. The refused picks, asked for again once the burst is over ──
    const retried = new Map<string, AiLayoutPicturePhoto>()
    const asked: Array<{ key: string; picks: AiStockRefusedPicks; slot: AiLayoutPictureSlot }> = [
      // The pages first, each one's hero first: what a visitor sees first.
      ...pages.flatMap((page) =>
        [...page.slots]
          .sort((a, b) => Number(b.role === 'hero') - Number(a.role === 'hero'))
          .flatMap((slot) => (slot.refused ? [{ key: `${page.screen}:${slot.image}`, picks: slot.refused, slot: slotOf(slot.image, slot) }] : [])),
      ),
      ...lists.flatMap((list) =>
        list.records.flatMap((record, index) =>
          record.refused && aiSiteIsStarterSrc(record.value)
            ? [
                {
                  key: `${list.dataset}:${index}`,
                  picks: record.refused,
                  slot: {
                    ...slotOf(`record${index}`, { words: record.name, role: list.people ? 'about' : 'gallery', aspect: list.people ? 4 / 5 : 4 / 3 }),
                    // A record's name is a search's words, never what its photo shows (AGL-3856).
                    standIn: true,
                  },
                },
              ]
            : [],
        ),
      ),
    ]
    if (asked.length && provider && ingest) {
      const last = aiSitePhotosLastRefusalMs({ pages, lists })
      const wait = last === null ? 0 : Math.min(AI_SITE_LATE_PHOTOS_WAIT_MS, Math.max(0, last + AI_SITE_LATE_PHOTOS_WAIT_MS - now()))
      if (wait > 0) await sleep(wait, signal)
      // The pass's own time ran out while it waited: the next pass picks it up.
      if (signal?.aborted) return { photos: input.photos, ...counts }
      const timeout = AbortSignal.timeout(AI_SITE_LATE_PHOTOS_COPY_MS)
      const copying = signal ? AbortSignal.any([signal, timeout]) : timeout
      const words = aiStockPhotoWordsOf(job)
      const proper = aiStockProperWords(aiSiteWords(job.inputs).about)
      /**
       * Whether a pick not in the site's library yet is still downloaded:
       * not once the library refused to store one, nor once two downloads
       * in a row were refused, which says the burst is not over. The picks
       * a later page copied are still looked up in the library.
       */
      let downloading = true
      let refusedInARow = 0
      for (const entry of asked) {
        if (copying.aborted) break
        counts.retried += 1
        const found = await provider.search(entry.picks.request, { signal: copying }).catch(() => null)
        for (const sourceKey of entry.picks.keys) {
          if (copying.aborted) break
          const photo = found?.photos.find((hit) => stockPhotoSourceKey(hit) === sourceKey)
          if (!photo) continue
          const alt = aiStockPhotoAlt(photo, entry.slot, { ...(words.language ? { language: words.language } : {}), proper }) ?? entry.slot.alt
          const kept = await ingest.findStockPhoto({ hostId, sourceKey }).catch(() => null)
          if (kept) {
            retried.set(entry.key, { src: kept.src, width: kept.width ?? photo.width, height: kept.height ?? photo.height, alt })
            break
          }
          if (!downloading) continue
          const bytes = await provider.download(photo, { maxBytes: AI_LAYOUT_STOCK_MAX_BYTES, signal: copying }).catch(() => null)
          if (copying.aborted) break
          if (!bytes) {
            refusedInARow += 1
            if (refusedInARow >= AI_SITE_LATE_PHOTOS_REFUSALS_IN_A_ROW) downloading = false
            continue
          }
          refusedInARow = 0
          const stored = await ingest
            .ingest(aiStockIngestRequest(provider, { hostId, uid: job.createdBy, photo, bytes, alt, query: entry.picks.request.query }))
            .catch(() => null)
          if (stored?.ok) {
            retried.set(entry.key, { src: stored.src, width: stored.width ?? photo.width, height: stored.height ?? photo.height, alt })
            counts.copied += 1
            break
          }
          // A refusal of this photo's own bytes tries the next pick; any other holds for the pass (AGL-3923).
          if (!stored || !AI_STOCK_PHOTO_OWN_REFUSALS.has(stored.status)) downloading = false
        }
      }
    }

    // The pass's own time ran out while it copied: the next pass finds what it copied in the library.
    if (signal?.aborted) return { photos: input.photos, ...counts }

    // ── 2. The job's own photos, for every picture still on a starter ──
    const read = new Map<string, NodesMap | null>()
    for (const id of built) {
      const stored = await readNodes(input.firestore, { kind: 'screen', hostId, id }).catch(() => null)
      read.set(id, stored?.nodes ?? null)
    }
    const seen = new Set<string>()
    const pool = [
      ...[...read.values()].flatMap((nodes) => aiStockPlacedPhotos(nodes)),
      ...lists.flatMap((list) => list.records.flatMap((record) => (record.photo ? [record.photo] : []))),
      ...aiSiteDatasetPlacedPhotoDetails(job.outputs ?? []),
      ...retried.values(),
    ].filter((photo) => photo.src.startsWith('media:') && !seen.has(photo.src) && Boolean(seen.add(photo.src)))
    const origin = aiOriginJobId(job)

    for (const page of pages) {
      const nodes = read.get(page.screen)
      if (!nodes) continue
      const images = aiSitePageImages(nodes)
      const entries = new Map(page.slots.map((slot) => [slot.image, slot]))
      const slots = images.map((image) => slotOf(image.imageId, entries.get(image.imageId) ?? null))
      const placed: Array<AiLayoutPicturePhoto | null> = images.map((image) =>
        aiSiteIsStarterSrc(image.src) ? null : { src: image.src, width: image.width, height: image.height, alt: image.alt },
      )
      const need = images.map((image) => entries.has(image.imageId) && aiSiteIsStarterSrc(image.src))
      const photos: Array<AiLayoutPicturePhoto | null> = images.map(() => null)
      // (a) A picture's own pick first, where the page does not show it yet;
      // else it is one of the job's photos like any other.
      images.forEach((image, index) => {
        const own = need[index] ? retried.get(`${page.screen}:${image.imageId}`) : undefined
        if (!own || placed.some((photo) => photo?.src === own.src)) return
        photos[index] = own
        placed[index] = own
        need[index] = false
      })
      // (b) Then the job's photos, by the matcher the page's own pass used: one
      // the page does not show first; (c) a repeat only where nothing else is
      // left, since the other choice is a starter that shows another business.
      if (pool.length) {
        aiLayoutJobPhotoPicks(slots, need, pool, placed, `${origin}:${page.screen}:late`, { repeats: 'last' }).forEach((pick, index) => {
          if (pick && need[index]) photos[index] = pick
        })
      }
      const starters = images.filter((image) => entries.has(image.imageId) && aiSiteIsStarterSrc(image.src)).length
      const plan = images.flatMap((image, index) => {
        const photo = photos[index]
        return photo ? [{ slot: slots[index] as AiLayoutPictureSlot, photo }] : []
      })
      const update = plan.length
        ? await updateNodes(input.firestore, {
            kind: 'screen',
            hostId,
            id: page.screen,
            now: input.now,
            update: (current) => aiSitePageWithPhotos(current, plan),
          })
        : null
      const filled = update?.ok ? plan.length : 0
      counts.filled += filled
      counts.left += Math.max(0, starters - filled)
    }

    for (const list of lists) {
      const filled = aiSiteListPhotos(list, retried, pool, `${origin}:${list.dataset}:late`)
      const records = filled.flatMap((photo, index) => {
        const record = list.records[index]
        const value = photo ? aiSiteProductPhotoSrc(photo.src, hostId) : null
        if (!record || !photo || !value || !aiSiteIsStarterSrc(record.value)) return []
        return [
          {
            order: index,
            // The starter's words go with it: a photo that brings none leaves the description empty (AGL-3856).
            values: { [list.imageField]: value, ...(list.altField ? { [list.altField]: photo.alt?.trim() ?? '' } : {}) },
            where: { [list.imageField]: record.value },
          },
        ]
      })
      const starters = list.records.filter((record) => aiSiteIsStarterSrc(record.value)).length
      if (!records.length) {
        counts.left += starters
        continue
      }
      const keeper = writerFor(AI_DATASET_DRAFT_RESOURCE)
      if (!keeper?.writer.reviseRecords) {
        console.warn('ai site late photos: the dataset writer cannot change records here', { jobId: job.$id, dataset: list.dataset })
        counts.left += starters
        continue
      }
      const revised = await keeper.writer.reviseRecords({
        orgId: job.orgId,
        hostId,
        uid: job.createdBy,
        org: input.org,
        now: input.now,
        id: list.dataset,
        records,
      })
      const changed = revised.ok ? revised.changed : 0
      if (revised.ok === false) {
        console.warn('ai site late photos: the dataset writer refused the covers', { jobId: job.$id, dataset: list.dataset, status: revised.status })
      }
      counts.filled += changed
      counts.left += Math.max(0, starters - changed)
    }
    console.info('ai site late photos', { jobId: job.$id, hostId, ...counts })
    return done()
  } catch (error) {
    // The site is built either way; its pictures keep what they hold.
    if (signal?.aborted) return { photos: input.photos, ...counts }
    console.error('ai site late photos failed; the site keeps its pictures as they are', { jobId: job.$id, error: String(error) })
    return done()
  }
}

/**
 * A list's records' photos once the late pass is done (AGL-3988): each
 * record's own refused pick where it was copied, then, for a list of things,
 * one of the photos it or the job shows (`aiSiteDatasetRecordsFromOwn`). A
 * team's records take only their own picks: no photo of the job's is of
 * one of the business's people. Pure.
 */
export function aiSiteListPhotos(
  list: AiSiteStarterList,
  retried: ReadonlyMap<string, AiLayoutPicturePhoto>,
  pool: readonly AiLayoutPicturePhoto[],
  seed: string,
): Array<AiLayoutPicturePhoto | null> {
  const current = list.records.map((record, index): AiLayoutPicturePhoto | null =>
    aiSiteIsStarterSrc(record.value) ? (retried.get(`${list.dataset}:${index}`) ?? null) : (record.photo ?? null),
  )
  if (list.people) return current
  return aiSiteDatasetRecordsFromOwn(
    list.records.map((record) => ({ name: record.name, category: record.category ?? null, ...(record.itsOwn ? { itsOwn: true } : {}) })),
    current,
    seed,
    pool,
    // A starter is the other choice: a record every photo sits beside takes one anyway.
    { besideLast: true },
  )
}
