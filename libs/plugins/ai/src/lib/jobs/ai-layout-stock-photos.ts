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

import {
  pluginMediaIngest,
  type PluginMediaIngest,
  type PluginMediaIngestResult,
} from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import {
  STOCK_PHOTO_QUERY_MAX_CHARS,
  stockPhotoProvider,
  stockPhotoSourceKey,
  type StockPhoto,
  type StockPhotoOrientation,
  type StockPhotoProvider,
  type StockPhotoSearchRequest,
} from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import {
  aiLayoutSeedNumber,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
  type AiLayoutPictureSource,
} from '../layout-language/ai-layout-pictures'

/**
 * STOCK PHOTOS FOR A LANGUAGE PAGE'S PICTURE SLOTS (AGL-3660).
 *
 * The source `aiResolveLayoutPictures` asks before it falls back to the
 * starter photos. It names no library: it asks core for the deployment's
 * stock photo provider (`core.stock-photos`) and for the media library's
 * server door (`core.media-ingest`), and builds no source at all when either
 * is missing, so a deployment without a key behaves exactly as before.
 *
 * For each slot, in document order:
 *
 * 1. **Search.** Plain words: the kind of business (the head of the site's
 *    business type, "yoga studio" from "a family-owned yoga studio in
 *    Austin") for the hero; the picture's own subject (the content words of
 *    the alt text the model wrote, else its section's name) with the business
 *    for the rest, and an about picture asks for people. The orientation and
 *    a minimum size come from the slot's frame. The provider caches every
 *    search for a day and keeps its own rate limit.
 * 2. **Pick.** Among the first hits not already on the page, by the job's
 *    seed and the slot, so two sites built from the same words rarely open
 *    with the same photo while one job always picks the same.
 * 3. **Keep.** A photo the site's library already holds (by its source key)
 *    is reused; otherwise its bytes are downloaded from the library and
 *    stored in the site's own media library as the member who started the
 *    job, credited to its photographer. The page names the site's asset,
 *    never the library's address.
 *
 * A slot that finds nothing, any error, a refusal from the library (its
 * storage band, say) or the time running out leaves the slot to a starter
 * photo. Nothing here throws, and none of it is an AI model call: photos cost
 * no AI credits.
 */

/** Wall clock the whole page's photos may take, inside the step's own signal. */
export const AI_LAYOUT_STOCK_PHOTOS_BUDGET_MS = 20_000

/** Searches one page may ask, cached ones included. */
export const AI_LAYOUT_STOCK_SEARCHES_PER_PAGE = 8

/** The hits a pick is made among. */
export const AI_LAYOUT_STOCK_PICK_WINDOW = 8

/** The largest photo copied: inside one direct upload. */
export const AI_LAYOUT_STOCK_MAX_BYTES = 3 * 1024 * 1024

/** Words that carry no subject. */
const STOPWORDS = new Set(
  (
    'a an the and or of in on at to for with from by into onto over under near our your their my his her its ' +
    'this that these those is are be being was were who whom which where while as about than then very just ' +
    'small local best new top quality premium family-owned family owned independent professional ' +
    'business company shop services service site website page photo picture image showing shows show ' +
    'someone people person one two three some many several'
  ).split(' '),
)

/** Lowercase words, letters only, without stopwords. */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+|\S+@\S+|\+?\d[\d\s().-]{5,}\d/g, ' ')
    .replace(/[^a-zÀ-ɏ\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
}

/**
 * The kind of business in a few words: the first clause of the business
 * type, before a place or an audience, its last three content words (the
 * head of an English noun phrase is at its end).
 */
export function aiStockBusinessWords(businessType: string): string {
  const clause = businessType
    .toLowerCase()
    .split(/[,;:.()]|\s[-–—]\s|\b(?:in|for|near|serving|based|located|that|which|who|with|from|since|and|&)\b/)[0]
  const words = contentWords(clause ?? '')
  return words.slice(-3).join(' ')
}

/** A picture's subject in a few words: its alt text's first content words, else its section's name. */
export function aiStockSubjectWords(alt: string, sectionName: string): string {
  const words = contentWords(alt)
  if (words.length) return words.slice(0, 3).join(' ')
  return contentWords(sectionName).slice(0, 2).join(' ')
}

const clip = (query: string) => query.replace(/\s+/g, ' ').trim().slice(0, STOCK_PHOTO_QUERY_MAX_CHARS).trim()

/** The frame's orientation: a wide frame wants a landscape photo, a tall one a portrait. */
export function aiStockOrientation(aspect: number): StockPhotoOrientation {
  if (aspect > 1.15) return 'horizontal'
  if (aspect < 0.87) return 'vertical'
  return 'any'
}

/** The searches a slot tries, in order, most specific first, each distinct. */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect'>,
  words: { business: string; subject: string },
): StockPhotoSearchRequest[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size =
    slot.role === 'hero'
      ? { minWidth: 1600 }
      : orientation === 'vertical'
        ? { minHeight: 900 }
        : { minWidth: 900 }
  const queries =
    slot.role === 'hero'
      ? [words.business, `${words.business} ${words.subject}`]
      : slot.role === 'about'
        ? [`${words.business} ${words.subject}`, words.business]
        : [`${words.business} ${words.subject}`, words.subject, words.business]
  const seen = new Set<string>()
  const searches: StockPhotoSearchRequest[] = []
  for (const raw of queries) {
    const query = clip(raw)
    if (!query || seen.has(query)) continue
    seen.add(query)
    searches.push({
      query,
      orientation,
      ...size,
      ...(slot.role === 'about' ? { people: true } : {}),
    })
  }
  return searches
}

/** The pick among a search's hits: not on the page yet, among the first few, by the seed. */
export function aiStockPick(
  photos: readonly StockPhoto[],
  used: ReadonlySet<string>,
  seed: string,
): StockPhoto | null {
  const fresh = photos.filter((photo) => !used.has(stockPhotoSourceKey(photo))).slice(0, AI_LAYOUT_STOCK_PICK_WINDOW)
  if (!fresh.length) return null
  return fresh[aiLayoutSeedNumber(seed) % fresh.length] ?? null
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export interface AiLayoutStockPhotoSourceInput {
  hostId: string
  /** The member the photos are stored as: the job's creator. */
  uid: string
  /** The job's seed, as the starter photos turn by. */
  seed: string
  /** The site's business type, else the job's brief. */
  business: string
  /** The page's section names, by plan index. */
  sectionNames: readonly string[]
  signal?: AbortSignal
}

export interface AiLayoutStockPhotoDeps {
  provider?: () => StockPhotoProvider | null
  ingest?: () => PluginMediaIngest | null
  budgetMs?: number
}

/**
 * The source for one page, or `null` when this deployment has no stock
 * photo library or no media door, which leaves every slot to the starters.
 */
export function aiLayoutStockPhotoSource(
  input: AiLayoutStockPhotoSourceInput,
  deps: AiLayoutStockPhotoDeps = {},
): AiLayoutPictureSource | null {
  const provider = (deps.provider ?? stockPhotoProvider)()
  const ingest = (deps.ingest ?? pluginMediaIngest)()
  if (!provider || !ingest || !input.hostId || !input.uid) return null
  const business = aiStockBusinessWords(input.business)
  return async (slots) => {
    const timeout = AbortSignal.timeout(deps.budgetMs ?? AI_LAYOUT_STOCK_PHOTOS_BUDGET_MS)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    const used = new Set<string>()
    let searches = 0
    let storing = true
    const photos: Array<AiLayoutPicturePhoto | null> = []
    for (const [index, slot] of slots.entries()) {
      if (signal.aborted) {
        photos.push(null)
        continue
      }
      const subject = aiStockSubjectWords(slot.alt, input.sectionNames[slot.sectionIndex] ?? '')
      let placed: AiLayoutPicturePhoto | null = null
      for (const request of aiStockSearchesFor(slot, { business, subject })) {
        if (placed || signal.aborted || searches >= AI_LAYOUT_STOCK_SEARCHES_PER_PAGE) break
        searches += 1
        let found: StockPhoto[]
        try {
          found = (await provider.search(request, { signal }))?.photos ?? []
        } catch {
          found = []
        }
        const photo = aiStockPick(found, used, `${input.seed}:${index}:${request.query}`)
        if (!photo) continue
        const sourceKey = stockPhotoSourceKey(photo)
        used.add(sourceKey)
        try {
          const kept = await ingest.findStockPhoto({ hostId: input.hostId, sourceKey })
          if (kept) {
            placed = { src: kept.src, width: kept.width ?? photo.width, height: kept.height ?? photo.height }
            break
          }
          // A refusal to store (the storage band, a lockdown) holds for the
          // whole page, so the rest of it reuses what it can and copies nothing.
          if (!storing) continue
          const bytes = await provider.download(photo, { maxBytes: AI_LAYOUT_STOCK_MAX_BYTES, signal })
          if (!bytes || signal.aborted) continue
          const credit = provider.credit(photo)
          const stored = await ingest.ingest({
            hostId: input.hostId,
            uid: input.uid,
            fileName: `${photo.provider}-${photo.id}.${EXTENSIONS[bytes.contentType] ?? 'jpg'}`,
            contentType: bytes.contentType,
            bytes: bytes.bytes,
            alt: slot.alt,
            description: credit.text,
            stockPhoto: {
              key: sourceKey,
              provider: photo.provider,
              providerLabel: credit.providerLabel,
              id: photo.id,
              pageUrl: photo.pageUrl,
              photographer: photo.photographer,
              ...(photo.photographerUrl ? { photographerUrl: photo.photographerUrl } : {}),
              license: credit.license,
              licenseUrl: credit.licenseUrl,
              attributionRequired: credit.attributionRequired,
              query: request.query,
            },
          })
          if (stored.ok) {
            placed = { src: stored.src, width: stored.width ?? photo.width, height: stored.height ?? photo.height }
          } else {
            storing = false
            const refusal = stored as Extract<PluginMediaIngestResult, { ok: false }>
            console.warn('ai layout pictures: the media library refused a stock photo', {
              status: refusal.status,
              reason: refusal.reason,
            })
          }
        } catch (error) {
          console.warn('ai layout pictures: a stock photo could not be kept', { error: String(error) })
        }
      }
      photos.push(placed)
    }
    return photos
  }
}
