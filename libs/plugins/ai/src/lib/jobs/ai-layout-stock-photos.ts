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
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
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
 * 1. **Search.** Plain words. The hero asks for the kind of business (the
 *    head of the site's business type, "yoga studio" from "a family-owned
 *    yoga studio in Austin"). Any other picture asks for its SUBJECT: the
 *    noun phrase that opens the alt text the model wrote, its filler
 *    adjectives dropped ("serving bowl" from "A beautiful hand-thrown serving
 *    bowl on a linen cloth"), qualified by the site's craft where the phrase
 *    does not already say it ("serving bowl ceramic" for a ceramics studio).
 *    An about picture asks for people. The orientation and a minimum size
 *    come from the slot's frame. The provider caches every search for a day
 *    and keeps its own rate limit; one page never asks the same words twice.
 * 2. **Rank.** A picture of a thing must show the thing: every hit is scored
 *    by how many of the subject's words its tags, its description and its
 *    page's address name (singular and plural alike, the head noun counting
 *    double), and a hit naming none of them never fills a picture of a
 *    thing. The live Juniper Clay start put crackers under "Serving bowl"
 *    and plants under "Espresso cup". Among the best-scored hits the job's
 *    seed picks, so two sites built from the same words rarely open with the
 *    same photo while one job always picks the same.
 * 3. **Never twice.** A photo is placed once per job: not twice on a page,
 *    and not on a page when another page (or another pass, in this process)
 *    of the same job already placed it — the maker's portrait in About is
 *    never a vase in Selected work. The caller hands in what the job's other
 *    pages hold (`avoid`); a pass repeated over its own page keeps its own.
 * 4. **Fall back.** A picture of a thing nothing relevant answered asks once
 *    more for the place itself ("ceramics studio interior"), a neutral photo
 *    any caption sits under, before it is left to a starter photo.
 * 5. **Keep.** A photo the site's library already holds (by its source key)
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

/** Searches one page may send to the provider; a repeated query is answered from the page's own memory. */
export const AI_LAYOUT_STOCK_SEARCHES_PER_PAGE = 12

/** The hits a pick is made among. */
export const AI_LAYOUT_STOCK_PICK_WINDOW = 8

/** The ranked hits one search may try to place before the slot moves to its next search. */
const AI_LAYOUT_STOCK_TRIES_PER_SEARCH = 3

/** The largest photo copied: inside one direct upload. */
export const AI_LAYOUT_STOCK_MAX_BYTES = 3 * 1024 * 1024

/**
 * The unit job input naming the screen drafts the job's other pages were
 * written to, whose photos a page does not place again (AGL-3660).
 */
export const AI_STOCK_PHOTO_PAGES_INPUT = 'stockPhotoPages'

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

/**
 * Words that describe a picture's look, not what it shows, dropped from a
 * subject. A word that is as often a noun ("light", "set") is not one.
 */
const FILLER = new Set(
  (
    'beautiful beautifully stunning gorgeous lovely pretty elegant modern contemporary rustic cozy cosy warm cool ' +
    'soft bright natural simple minimal minimalist delicate unique special artisan artisanal handmade ' +
    'hand-made hand-thrown handthrown hand-crafted handcrafted crafted hand-built handbuilt finished styled perfect ' +
    'fresh clean calm serene quiet peaceful vibrant colorful colourful sunlit sunny golden glossy matte textured ' +
    'close-up closeup up view views detail details detailed shot shots overhead flat lay flatlay flat-lay ' +
    'top-down wide angle featuring featured displayed arranged sitting resting placed standing lined ' +
    'single pair collection assortment selection group few various array range large tiny big little ' +
    'white black grey gray beige cream ivory brown tan blue green red pink yellow orange purple speckled ' +
    'gentle airy inviting welcoming cheerful happy smiling friendly'
  ).split(' '),
)

/** The nouns that name a place of business, not its craft: "studio" in "ceramics studio". */
const VENUES = new Set(
  (
    'studio studios shop shops store stores boutique company co workshop gallery atelier agency brand practice ' +
    'salon house collective lab market services service firm clinic center centre parlor parlour bar ' +
    'class classes lessons school academy'
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
 * A word's singular, for matching only: "bowls" and "bowl", "vases" and
 * "vase", "berries" and "berry", "dishes" and "dish" meet. Both sides of a
 * comparison are reduced the same way, so an odd stem still matches itself.
 */
export function aiStockStem(word: string): string {
  const lower = word.toLowerCase()
  if (lower.length > 4 && lower.endsWith('ies')) return `${lower.slice(0, -3)}y`
  if (lower.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(lower)) return lower.slice(0, -2)
  if (lower.length > 3 && lower.endsWith('s') && !/(?:ss|us|is)$/.test(lower)) return lower.slice(0, -1)
  return lower
}

/** A text's words as stems; a hyphenated word counts as its parts. */
function stems(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().split(/[^a-zÀ-ɏ]+/)) {
    if (word.length > 1) out.add(aiStockStem(word))
  }
  return out
}

/** Where a noun phrase ends: punctuation, a preposition, a conjunction. */
const CLAUSE_BREAK =
  /[,;:.()]|\s[-–—]\s|\b(?:with|on|in|at|against|beside|next|near|under|over|by|from|for|during|while|atop|inside|across|beneath|through|into|onto|amid|among|and|of|that|which|who)\b|&/

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

/**
 * The business's craft in one word: the last of its words that is not the
 * place it is done in, singular — "ceramic" from "small-batch ceramics
 * studio", "yoga" from "yoga studio". Empty when the business is only a
 * place ("a shop").
 */
export function aiStockCraftWords(business: string): string {
  const words = business.split(/\s+/).filter((word) => word && !VENUES.has(word) && !FILLER.has(word))
  const craft = words[words.length - 1]
  return craft ? aiStockStem(craft) : ''
}

/** A phrase's content words without its filler; all filler, and nothing is left. */
function subjectOf(words: readonly string[]): string[] {
  return words.filter((word) => !FILLER.has(word))
}

/**
 * A picture's subject in a few words (AGL-3660): the noun phrase its alt
 * text opens with — its first clause holding more than filler, cut where a
 * preposition starts the setting, filler dropped, its last three words (the
 * head noun is the last) — else its section's name.
 */
export function aiStockSubjectWords(alt: string, sectionName: string): string {
  for (const clause of alt.toLowerCase().split(CLAUSE_BREAK)) {
    const words = subjectOf(contentWords(clause ?? ''))
    if (words.length) return words.slice(-3).join(' ')
  }
  return subjectOf(contentWords(sectionName)).slice(0, 2).join(' ')
}

const clip = (query: string) => query.replace(/\s+/g, ' ').trim().slice(0, STOCK_PHOTO_QUERY_MAX_CHARS).trim()

/** The frame's orientation: a wide frame wants a landscape photo, a tall one a portrait. */
export function aiStockOrientation(aspect: number): StockPhotoOrientation {
  if (aspect > 1.15) return 'horizontal'
  if (aspect < 0.87) return 'vertical'
  return 'any'
}

/**
 * One search a slot tries. A gallery picture's searches must find a hit
 * naming its subject; a `neutral` one asks for the place itself, which any
 * caption sits under.
 */
export interface AiStockSearch extends StockPhotoSearchRequest {
  neutral?: boolean
}

/** The searches a slot tries, in order, most specific first, each distinct. */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect'>,
  words: { business: string; subject: string; craft?: string },
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size =
    slot.role === 'hero'
      ? { minWidth: 1600 }
      : orientation === 'vertical'
        ? { minHeight: 900 }
        : { minWidth: 900 }
  const craft = words.craft ?? aiStockCraftWords(words.business)
  const subjectStems = stems(words.subject)
  // The craft qualifies a subject that does not already say it.
  const qualified =
    craft && [...stems(craft)].some((stem) => !subjectStems.has(stem)) ? `${words.subject} ${craft}` : words.subject
  const place = words.business.split(/\s+/).some((word) => VENUES.has(word))
    ? `${words.business} interior`
    : words.business
  const queries: Array<{ query: string; neutral?: boolean }> =
    slot.role === 'hero'
      ? [{ query: words.business }, { query: `${words.business} ${words.subject}` }]
      : slot.role === 'about'
        ? [{ query: `${words.business} ${words.subject}` }, { query: words.business }]
        : words.subject
          ? [{ query: qualified }, { query: words.subject }, { query: place, neutral: true }]
          : [{ query: place, neutral: true }]
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const raw of queries) {
    const query = clip(raw.query)
    if (!query || seen.has(query)) continue
    seen.add(query)
    searches.push({
      query,
      orientation,
      ...size,
      ...(slot.role === 'about' ? { people: true } : {}),
      ...(raw.neutral ? { neutral: true } : {}),
    })
  }
  return searches
}

/**
 * How well a hit names a subject (AGL-3660): each subject word its tags, its
 * description or its page's address names counts once, the head noun (the
 * subject's last word) twice, and a craft word a quarter, as a tiebreak.
 * Zero when it names none of the subject.
 */
export function aiStockRelevance(
  photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>,
  terms: { subject: string; craft?: string },
): number {
  const subject = terms.subject.split(/\s+/).filter(Boolean).map(aiStockStem)
  if (!subject.length) return 0
  let slug: string
  try {
    slug = new URL(photo.pageUrl).pathname
  } catch {
    slug = ''
  }
  const named = stems([...(photo.tags ?? []), photo.alt ?? '', slug].join(' '))
  const head = subject[subject.length - 1] as string
  let score = 0
  for (const word of new Set(subject)) {
    if (named.has(word)) score += word === head ? 2 : 1
  }
  if (score === 0) return 0
  for (const word of new Set((terms.craft ?? '').split(/\s+/).filter(Boolean).map(aiStockStem))) {
    if (named.has(word)) score += 0.25
  }
  return score
}

export interface AiStockRankOptions {
  /** The words a hit is scored by; none, and every hit scores alike. */
  subject?: string
  craft?: string
  /** A hit naming none of the subject is no candidate at all. */
  strict?: boolean
}

/**
 * A search's hits in the order they are tried (AGL-3660): those not placed
 * yet, among the first few, best-scored first; the seed turns the hits that
 * score alike, so two jobs differ and one job repeats itself.
 */
export function aiStockRank(
  photos: readonly StockPhoto[],
  used: ReadonlySet<string>,
  seed: string,
  options: AiStockRankOptions = {},
): StockPhoto[] {
  const subject = options.subject ?? ''
  const scored = photos
    .filter((photo) => !used.has(stockPhotoSourceKey(photo)))
    .slice(0, AI_LAYOUT_STOCK_PICK_WINDOW)
    .map((photo) => ({
      photo,
      score: subject ? aiStockRelevance(photo, { subject, ...(options.craft ? { craft: options.craft } : {}) }) : 0,
    }))
    .filter((entry) => !options.strict || !subject || entry.score > 0)
  if (!scored.length) return []
  const turn = aiLayoutSeedNumber(seed)
  const ranked: StockPhoto[] = []
  for (const score of [...new Set(scored.map((entry) => entry.score))].sort((a, b) => b - a)) {
    const tier = scored.filter((entry) => entry.score === score)
    const start = turn % tier.length
    for (const entry of [...tier.slice(start), ...tier.slice(0, start)]) ranked.push(entry.photo)
  }
  return ranked
}

/** The pick among a search's hits: the first {@link aiStockRank} would try, or `null`. */
export function aiStockPick(
  photos: readonly StockPhoto[],
  used: ReadonlySet<string>,
  seed: string,
  options: AiStockRankOptions = {},
): StockPhoto | null {
  return aiStockRank(photos, used, seed, options)[0] ?? null
}

/**
 * The library photos a stored page already shows: every `image` whose
 * source is the site's media reference. Starter photos are the platform's,
 * not the job's, and are not listed.
 */
export function aiStockPlacedSrcs(nodes: NodesMap | null | undefined): string[] {
  const map = (nodes ?? {}) as unknown as Record<string, { componentId?: string; props?: Record<string, unknown> }>
  const out: string[] = []
  for (const node of Object.values(map)) {
    const src = node?.componentId === 'image' ? node.props?.['src'] : null
    if (typeof src === 'string' && src.startsWith('media:')) out.push(src)
  }
  return out
}

/**
 * What this process has placed for each job, by source key and asset src,
 * with the scope (the page's seed) that placed it (AGL-3660). It spans the
 * passes of one job that run here, so a page, the products or a post built
 * later does not place what an earlier one did, while a pass repeated over
 * its own page keeps its own photos. Bounded; the oldest job goes first.
 */
const JOB_PHOTOS = new Map<string, Map<string, string>>()
const JOB_PHOTOS_MAX = 200

function jobPhotos(key: string | null): Map<string, string> | null {
  if (!key) return null
  let placed = JOB_PHOTOS.get(key)
  if (!placed) {
    placed = new Map()
    JOB_PHOTOS.set(key, placed)
    while (JOB_PHOTOS.size > JOB_PHOTOS_MAX) {
      const oldest = JOB_PHOTOS.keys().next().value
      if (oldest === undefined) break
      JOB_PHOTOS.delete(oldest)
    }
  }
  return placed
}

/** Forgets every job's placed photos; for specs. */
export function aiStockForgetJobPhotos(): void {
  JOB_PHOTOS.clear()
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export interface AiLayoutStockPhotoSourceInput {
  hostId: string
  /** The member the photos are stored as: the job's creator. */
  uid: string
  /** The job's seed, as the starter photos turn by; also the scope a photo is placed under. */
  seed: string
  /** The site's business type, else the job's brief. */
  business: string
  /** The page's section names, by plan index. */
  sectionNames: readonly string[]
  /**
   * The job the member started (`aiOriginJobId`), so a photo is placed once
   * across its pages. Absent, only the page itself is kept free of repeats.
   */
  jobId?: string
  /** Asset srcs or source keys the job's other pages already show. */
  avoid?: readonly string[]
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
  const craft = aiStockCraftWords(business)
  return async (slots) => {
    const timeout = AbortSignal.timeout(deps.budgetMs ?? AI_LAYOUT_STOCK_PHOTOS_BUDGET_MS)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    const scope = input.seed
    const job = jobPhotos(input.jobId ? `${input.hostId}:${input.jobId}` : null)
    const avoid = new Set(input.avoid ?? [])
    /** Placed elsewhere in the job: by another page in this process, or one the caller read. */
    const elsewhere = (key: string) => avoid.has(key) || (job?.has(key) === true && job.get(key) !== scope)
    /** Source keys this page has placed or turned down. */
    const used = new Set<string>()
    /** Asset srcs this page has placed. */
    const placedSrcs = new Set<string>()
    const answers = new Map<string, StockPhoto[]>()
    let searches = 0
    let storing = true
    const remember = (sourceKey: string, src: string) => {
      placedSrcs.add(src)
      job?.set(sourceKey, scope)
      job?.set(src, scope)
    }
    /** A search's hits; the same words twice are answered from memory, and `null` once the page's searches are spent. */
    const search = async (wanted: AiStockSearch): Promise<StockPhoto[] | null> => {
      const request: StockPhotoSearchRequest = { ...wanted }
      delete (request as AiStockSearch).neutral
      const key = JSON.stringify([request.query, request.orientation, request.people === true])
      const known = answers.get(key)
      if (known) return known
      if (searches >= AI_LAYOUT_STOCK_SEARCHES_PER_PAGE) return null
      searches += 1
      let found: StockPhoto[]
      try {
        found = (await provider.search(request, { signal }))?.photos ?? []
      } catch {
        found = []
      }
      answers.set(key, found)
      return found
    }
    /** The photo placed in the site's library, a copy it holds or a new one; `null` when it cannot be placed. */
    const keep = async (
      photo: StockPhoto,
      slot: AiLayoutPictureSlot,
      query: string,
    ): Promise<AiLayoutPicturePhoto | null> => {
      const sourceKey = stockPhotoSourceKey(photo)
      used.add(sourceKey)
      try {
        const kept = await ingest.findStockPhoto({ hostId: input.hostId, sourceKey })
        if (kept) {
          // Held because a slot of this page or another page of the job shows it.
          if (placedSrcs.has(kept.src) || elsewhere(kept.src)) return null
          remember(sourceKey, kept.src)
          return { src: kept.src, width: kept.width ?? photo.width, height: kept.height ?? photo.height }
        }
        // A refusal to store (the storage band, a lockdown) holds for the
        // whole page, so the rest of it reuses what it can and copies nothing.
        if (!storing) return null
        const bytes = await provider.download(photo, { maxBytes: AI_LAYOUT_STOCK_MAX_BYTES, signal })
        if (!bytes || signal.aborted) return null
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
            query,
          },
        })
        if (stored.ok) {
          remember(sourceKey, stored.src)
          return { src: stored.src, width: stored.width ?? photo.width, height: stored.height ?? photo.height }
        }
        storing = false
        const refusal = stored as Extract<PluginMediaIngestResult, { ok: false }>
        console.warn('ai layout pictures: the media library refused a stock photo', {
          status: refusal.status,
          reason: refusal.reason,
        })
      } catch (error) {
        console.warn('ai layout pictures: a stock photo could not be kept', { error: String(error) })
      }
      return null
    }
    const photos: Array<AiLayoutPicturePhoto | null> = []
    for (const [index, slot] of slots.entries()) {
      if (signal.aborted) {
        photos.push(null)
        continue
      }
      const subject = aiStockSubjectWords(slot.alt, input.sectionNames[slot.sectionIndex] ?? '')
      let placed: AiLayoutPicturePhoto | null = null
      for (const request of aiStockSearchesFor(slot, { business, subject, craft })) {
        if (placed || signal.aborted) break
        const found = await search(request)
        if (found === null) break
        // A gallery picture names a thing, and only a hit naming it fills it;
        // a hero, an about picture and the neutral search rank, unfiltered.
        const blocked = new Set(used)
        for (const hit of found) {
          const key = stockPhotoSourceKey(hit)
          if (elsewhere(key)) blocked.add(key)
        }
        const ranked = aiStockRank(found, blocked, `${input.seed}:${index}:${request.query}`, {
          subject: request.neutral ? craft || business : subject,
          craft,
          strict: slot.role === 'gallery' && !request.neutral,
        })
        for (const photo of ranked.slice(0, AI_LAYOUT_STOCK_TRIES_PER_SEARCH)) {
          if (signal.aborted) break
          placed = await keep(photo, slot, request.query)
          if (placed) break
        }
      }
      photos.push(placed)
    }
    return photos
  }
}
