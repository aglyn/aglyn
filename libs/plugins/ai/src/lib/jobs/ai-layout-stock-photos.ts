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
 * What the live starts of 2026-10-10 taught (Juniper Clay Works, a ceramic
 * artist's portfolio, and Willow Wick Candles, a candle store), each photo
 * traced through the library's cached answers:
 *
 * - The site's words were read as "portfolio" and "online" — the kind of
 *   SITE, not the craft — so every search said "serving bowl portfolio" and
 *   the hero asked for "portfolio": a wallet, fashion models, and a blank
 *   paper mockup that read as an empty panel beside the brushes.
 * - A hit naming the object anywhere won: a robin tagged "food bowl" filled
 *   "Speckled serving bowl", a lilac branch tagged "bud, vase" filled "Tall
 *   bud vase", letterpress type tagged "set" filled "Nesting bowl set" (its
 *   head noun was read as "set"), and an antique tea set tagged "brown
 *   candle" filled "Candle Gift Set".
 * - The page's 20 seconds ran out after four photos (each copy took ~5s, one
 *   after another), and the slots left took the starter photos: the laptop
 *   desk with pink roses under "Candle Wick Trimmer" and a work card, and the
 *   windowsill plants under another.
 *
 * So, for each slot:
 *
 * 1. **The site's terms** ({@link aiStockSiteTerms}): the business is the
 *    first clause of its type that says more than what kind of site it is
 *    ("ceramic artist" from "a portfolio for a ceramic artist who makes
 *    stoneware bowls"), its craft one word ("ceramic"), and its DOMAIN the
 *    words a photo of its world names: the craft, the business type's own
 *    nouns ("stoneware", "soy") and, for common crafts, their kin ("pottery",
 *    "clay", "wax"). Its broad searches ask for the world itself ("handmade
 *    ceramics", "pottery").
 * 2. **Search.** A picture of a thing asks for its subject — the noun phrase
 *    of the caption, filler dropped — qualified by the craft where it does
 *    not already name the domain ("ceramic serving bowl"), then the craft and
 *    the object alone ("ceramic bowl"), then the broad searches. A hero asks
 *    for the business, then broad; an about picture for the business's
 *    people, then broad. The orientation and a minimum size come from the
 *    slot's frame.
 * 3. **Accept, or reject.** A hit tagged as a mockup, a blank or a template
 *    never fills anything. A picture of a thing takes only a hit naming its
 *    OBJECT (the head noun, past "set", "gift", "kit": "bowl" in "nesting
 *    bowl set", "candle" in "candle gift set") AND either the site's domain
 *    or the subject's own two-word phrase ("bud vase"). A broad, hero or
 *    about search takes only a hit naming the domain. The accepted are
 *    ranked: the object in the hit's first tags (what the photo is OF) over
 *    a mention in its last, the subject's other words, the domain. Among
 *    equals the job's seed picks, so two sites differ and one job repeats.
 * 4. **Never twice.** A photo is placed once per job: not twice on a page,
 *    and not on a page when another page (or another pass, in this process)
 *    of the same job already placed it. The caller hands in what the job's
 *    other pages hold (`avoid`); a pass repeated over its own page keeps its
 *    own.
 * 5. **Keep, all at once.** The choosing is done first, slot by slot; the
 *    copies then run side by side, a few at a time, so a page of eight
 *    pictures takes about as long as two. A photo the site's library already
 *    holds (by its source key) is reused; otherwise its bytes are copied
 *    into the site's own library as the member who started the job, credited
 *    to its photographer. A copy that fails tries the slot's next accepted
 *    hit.
 *
 * A slot nothing acceptable answered — the library down, refusing, or out
 * of time — is left `null` for the starter photos. A named object is never
 * given one while the library answers anything of the site's world: the
 * broad searches come first. Nothing here throws, and none of it is an AI
 * model call: photos cost no AI credits.
 */

/** Wall clock the whole page's photos may take, inside the step's own signal. */
export const AI_LAYOUT_STOCK_PHOTOS_BUDGET_MS = 30_000

/** Searches one page may send to the provider; a repeated query is answered from the page's own memory. */
export const AI_LAYOUT_STOCK_SEARCHES_PER_PAGE = 18

/** The hits a pick is made among. */
export const AI_LAYOUT_STOCK_PICK_WINDOW = 40

/** The accepted hits a slot keeps in hand, in case a copy fails. */
const AI_LAYOUT_STOCK_TRIES_PER_SLOT = 3

/** Copies made side by side. */
const AI_LAYOUT_STOCK_COPIES_AT_ONCE = 4

/** The largest photo copied: inside one direct upload. */
export const AI_LAYOUT_STOCK_MAX_BYTES = 3 * 1024 * 1024

/**
 * The unit job input naming the screen drafts the job's other pages were
 * written to, whose photos a page does not place again (AGL-3660).
 */
export const AI_STOCK_PHOTO_PAGES_INPUT = 'stockPhotoPages'

/**
 * The unit job input naming library photos (`media:` references) another
 * part of the job already shows outside its pages — a dataset's records
 * (AGL-3616) — which a page does not place again.
 */
export const AI_STOCK_PHOTO_AVOID_INPUT = 'stockPhotoAvoid'

const words = (list: string) => new Set(list.trim().split(/\s+/))

/** Words that carry no subject. */
const STOPWORDS = words(
  'a an the and or of in on at to for with from by into onto over under near our your their my his her its ' +
    'this that these those is are be being was were who whom which where while as about than then very just ' +
    'small local best new top quality premium family-owned family owned independent professional ' +
    'business company services service page photo picture image showing shows show ' +
    'someone people person one two three some many several',
)

/**
 * Words that describe a picture's look, not what it shows, dropped from a
 * subject. A word that is as often a noun ("light", "set") is not one.
 */
const FILLER = words(
  'beautiful beautifully stunning gorgeous lovely pretty elegant modern contemporary rustic cozy cosy warm cool ' +
    'soft bright natural simple minimal minimalist delicate unique special artisan artisanal handmade ' +
    'hand-made hand-thrown handthrown hand-crafted handcrafted crafted hand-built handbuilt hand-poured ' +
    'hand-painted hand-dyed hand-stitched poured finished styled perfect ' +
    'fresh clean calm serene quiet peaceful vibrant colorful colourful sunlit sunny golden glossy matte textured ' +
    'close-up closeup up view views detail details detailed shot shots overhead flat lay flatlay flat-lay ' +
    'top-down wide angle featuring featured displayed arranged sitting resting placed standing lined ' +
    'single pair collection assortment selection group few various array range large tiny big little ' +
    'tall short wide narrow everyday classic signature original favorite favourite bestselling best-selling ' +
    'small-batch batch limited edition custom bespoke ' +
    'white black grey gray beige cream ivory brown tan blue green red pink yellow orange purple speckled ' +
    'gentle airy inviting welcoming cheerful happy smiling friendly',
)

/** The nouns that name a place of business, not its craft: "studio" in "ceramics studio". */
const VENUES = words(
  'studio studios shop shops store stores boutique company co workshop gallery atelier agency brand practice ' +
    'salon house collective lab market services service firm clinic center centre parlor parlour bar ' +
    'class classes lessons school academy',
)

/** The person who does the craft, not the craft: "artist" in "ceramic artist". */
const ROLES = words(
  'artist artists maker makers artisan artisans owner owners founder founders creator creators',
)

/** Words naming what kind of SITE it is, never what it shows: "portfolio" in "a portfolio for a ceramic artist". */
const SITE_KINDS = words(
  'portfolio portfolios website websites site sites blog blogs online web webshop ecommerce e-commerce ' +
    'landing personal homepage storefront',
)

/** Verbs a business type uses to say what it does; what follows them is its domain, never its business. */
const DOING =
  /(?<![\w-])(?:makes?|making|made|sells?|selling|sold|offers?|offering|creates?|creating|specializ(?:es|ing)|specialis(?:es|ing)|provides?|providing|featuring|showcasing)(?![\w-])/g

/** Where a business type's own clause ends. */
const BUSINESS_BREAK =
  /[,;:.()]|\s[-–—]\s|\b(?:in|for|near|serving|based|located|that|which|who|with|from|since|and|&)\b/

/** A clause after one of these says where or for whom, never what: "in Austin", "for busy parents". */
const PLACE_OR_AUDIENCE =
  /^(?:in|near|serving|based|located|across|around|throughout|for)$/

/**
 * Words naming a set or a wrapper of a thing, never the thing: the OBJECT
 * of "nesting bowl set" is the bowl, of "candle gift set" the candle.
 */
const WRAPPERS = words(
  'set sets kit kits gift gifts bundle bundles pack packs box boxes trio duo pair collection sampler assortment ' +
    'series range line group lot bunch',
)

/**
 * A hit tagged with any of these is never placed: a mockup's blank panel is
 * an empty frame on the page (the Juniper Clay hero), a template or a
 * graphic is not a photo of anything.
 */
const REJECTED_TAGS = words(
  'mockup mock-up mock blank template templates clipart clip-art illustration vector logo icon ' +
    'ai-generated generated render rendering 3d',
)

/**
 * The kin of a few common crafts: the words a photo of that world is
 * tagged with, and the broad searches that find it. A craft not listed
 * still has its own words; this only widens what counts as its world.
 */
const CRAFT_KIN: ReadonlyArray<{
  match: readonly string[]
  kin: readonly string[]
  broad: readonly string[]
}> = [
  {
    match: [
      'ceramic',
      'ceramics',
      'pottery',
      'potter',
      'stoneware',
      'porcelain',
      'earthenware',
      'clay',
    ],
    kin: [
      'ceramic',
      'ceramics',
      'pottery',
      'potter',
      'stoneware',
      'porcelain',
      'earthenware',
      'clay',
      'glaze',
      'kiln',
    ],
    broad: ['handmade ceramics', 'pottery'],
  },
  {
    match: ['candle', 'candlemaker', 'candlemaking'],
    kin: [
      'candle',
      'candlelight',
      'wax',
      'soy',
      'wick',
      'scented',
      'votive',
      'candlestick',
    ],
    broad: ['handmade candles', 'scented candles'],
  },
  {
    match: [
      'jewelry',
      'jewellery',
      'jeweler',
      'jeweller',
      'silversmith',
      'goldsmith',
    ],
    kin: [
      'jewelry',
      'jewellery',
      'ring',
      'necklace',
      'earring',
      'bracelet',
      'silver',
      'gold',
      'gemstone',
    ],
    broad: ['handmade jewelry', 'jewelry'],
  },
  {
    match: ['soap', 'soapmaker', 'skincare'],
    kin: ['soap', 'skincare', 'lotion', 'bath', 'spa', 'natural', 'cosmetic'],
    broad: ['handmade soap', 'natural skincare'],
  },
  {
    match: [
      'wood',
      'woodwork',
      'woodworking',
      'woodworker',
      'carpenter',
      'carpentry',
      'furniture',
      'joinery',
    ],
    kin: [
      'wood',
      'wooden',
      'woodwork',
      'timber',
      'furniture',
      'carpentry',
      'oak',
      'walnut',
    ],
    broad: ['woodworking', 'wooden furniture'],
  },
  {
    match: ['bakery', 'baker', 'bread', 'pastry', 'cake', 'patisserie'],
    kin: [
      'bakery',
      'bread',
      'pastry',
      'cake',
      'baking',
      'baked',
      'dough',
      'croissant',
    ],
    broad: ['bakery', 'fresh bread'],
  },
  {
    match: ['coffee', 'cafe', 'café', 'roaster', 'espresso'],
    kin: [
      'coffee',
      'cafe',
      'espresso',
      'latte',
      'cappuccino',
      'barista',
      'beans',
    ],
    broad: ['coffee shop', 'coffee'],
  },
  {
    match: ['florist', 'flower', 'floral'],
    kin: ['flower', 'floral', 'bouquet', 'florist', 'bloom', 'blossom'],
    broad: ['florist', 'flower bouquet'],
  },
  {
    match: [
      'knit',
      'knitting',
      'yarn',
      'weaving',
      'weaver',
      'textile',
      'textiles',
      'quilt',
      'quilting',
      'sewing',
    ],
    kin: [
      'knit',
      'knitting',
      'yarn',
      'wool',
      'weaving',
      'textile',
      'fabric',
      'quilt',
      'sewing',
    ],
    broad: ['handmade textiles', 'yarn'],
  },
  {
    match: ['leather', 'leatherwork', 'leathercraft'],
    kin: ['leather', 'wallet', 'bag', 'belt', 'stitching'],
    broad: ['leather craft', 'leather goods'],
  },
]

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
  if (lower.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(lower))
    return lower.slice(0, -2)
  if (lower.length > 3 && lower.endsWith('s') && !/(?:ss|us|is)$/.test(lower))
    return lower.slice(0, -1)
  return lower
}

/** A text's words as stems, in order; a hyphenated word counts as its parts. */
function stemList(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zÀ-ɏ]+/)
    .filter((word) => word.length > 1)
    .map(aiStockStem)
}

/** Where a noun phrase ends: punctuation, a preposition, a conjunction. */
const CLAUSE_BREAK =
  /[,;:.()]|\s[-–—]\s|\b(?:with|on|in|at|against|beside|next|near|under|over|by|from|for|during|while|atop|inside|across|beneath|through|into|onto|amid|among|and|of|that|which|who)\b|&/

/** A business type's clauses, each with the word that opened it. */
function businessClauses(
  businessType: string,
): Array<{ opener: string; words: string[] }> {
  const text = businessType.toLowerCase().replace(DOING, ' | ')
  const clauses: Array<{ opener: string; words: string[] }> = []
  const breaker = new RegExp(`${BUSINESS_BREAK.source}|\\|`, 'g')
  let at = 0
  let opener = ''
  for (const match of text.matchAll(breaker)) {
    clauses.push({ opener, words: contentWords(text.slice(at, match.index)) })
    opener = match[0].trim()
    at = (match.index ?? 0) + match[0].length
  }
  clauses.push({ opener, words: contentWords(text.slice(at)) })
  return clauses
}

/** A clause's words that name the business: no site kind, no filler. */
const businessOf = (clause: readonly string[]) =>
  clause.filter((word) => !SITE_KINDS.has(word) && !FILLER.has(word))

/**
 * The kind of business in a few words: the first clause of the business
 * type that says more than what kind of site it is, before a place, an
 * audience or what it makes, filler dropped, its last three words (the head
 * of an English noun phrase is at its end). "ceramic artist" from "a
 * portfolio for a ceramic artist who makes stoneware bowls"; "candle shop"
 * from "a small-batch candle shop selling hand-poured soy candles online".
 */
export function aiStockBusinessWords(businessType: string): string {
  for (const { words: clause } of businessClauses(businessType)) {
    const named = businessOf(clause)
    if (named.length) return named.slice(-3).join(' ')
  }
  return ''
}

/**
 * The business's craft in one word: the last of its words that is not the
 * place it is done in nor the person doing it, singular — "ceramic" from
 * "ceramics studio" or "ceramic artist", "yoga" from "yoga studio". Empty
 * when the business is only a place ("a shop").
 */
export function aiStockCraftWords(business: string): string {
  const named = business
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        !VENUES.has(word) &&
        !ROLES.has(word) &&
        !FILLER.has(word) &&
        !SITE_KINDS.has(word),
    )
  const craft = named[named.length - 1]
  return craft ? aiStockStem(craft) : ''
}

/** What a site's photos are searched and judged by (AGL-3660). */
export interface AiStockSiteTerms {
  /** The kind of business, in a few words: "ceramic artist". */
  business: string
  /** Its craft, one singular word: "ceramic". */
  craft: string
  /**
   * The stems a photo of the site's world names: the business's own words,
   * what the things it makes are made of, and the craft's kin. Empty for a
   * site whose words name no world (a type left blank), and then no hit is
   * held to it.
   */
  domain: string[]
  /** The searches for the site's world itself, broadest last. */
  broad: string[]
}

/** The site's terms, read from its business type. */
export function aiStockSiteTerms(businessType: string): AiStockSiteTerms {
  const business = aiStockBusinessWords(businessType)
  const craft = aiStockCraftWords(business)
  const domain = new Set<string>()
  /** The things it makes, by their head nouns. */
  const made = new Set<string>()
  let named = false
  let making = false
  for (const { opener, words: clause } of businessClauses(businessType)) {
    if (opener === '|') making = true
    // Where it is, and who it is for, are not its world — once something has named it.
    if (named && PLACE_OR_AUDIENCE.test(opener)) {
      making = false
      continue
    }
    const kept = businessOf(clause).filter(
      (word) => !VENUES.has(word) && !ROLES.has(word),
    )
    if (kept.length) named = true
    // What it makes names its world by what the things are made of, never
    // the things: "stoneware" of "stoneware bowls", "soy" of "soy candles".
    // A bowl is not a ceramic world; a robin's food bowl is not pottery.
    const world = making ? kept.slice(0, -1) : kept
    for (const word of world)
      for (const stem of stemList(word)) domain.add(stem)
    if (making)
      for (const word of kept.slice(-1))
        for (const stem of stemList(word)) made.add(stem)
  }
  if (craft) domain.add(craft)
  // A business named only by what it sells ("a shop selling pottery") is of that world.
  if (!domain.size) for (const stem of made) domain.add(stem)
  const broad: string[] = []
  for (const group of CRAFT_KIN) {
    if (
      !group.match.some(
        (word) => domain.has(aiStockStem(word)) || made.has(aiStockStem(word)),
      )
    )
      continue
    for (const word of group.kin) domain.add(aiStockStem(word))
    broad.push(...group.broad)
  }
  if (!broad.length) broad.push(business, craft)
  return {
    business,
    craft,
    domain: [...domain].filter((stem) => stem.length > 1),
    broad: [...new Set(broad.map((query) => query.trim()).filter(Boolean))],
  }
}

/** A phrase's content words without its filler; all filler, and nothing is left. */
function subjectOf(list: readonly string[]): string[] {
  return list.filter((word) => !FILLER.has(word))
}

/**
 * A picture's subject in a few words (AGL-3660): the noun phrase its alt
 * text opens with — its first clause holding more than filler, cut where a
 * preposition starts the setting, filler dropped, its last three words (the
 * head noun is the last) — else its section's name.
 */
export function aiStockSubjectWords(alt: string, sectionName: string): string {
  for (const clause of alt.toLowerCase().split(CLAUSE_BREAK)) {
    const found = subjectOf(contentWords(clause ?? ''))
    if (found.length) return found.slice(-3).join(' ')
  }
  return subjectOf(contentWords(sectionName)).slice(0, 2).join(' ')
}

/**
 * The thing a subject shows, one singular word: its last word that is not
 * a set or a wrapper of it — "bowl" from "nesting bowl set", "candle" from
 * "candle gift set", "vase" from "bud vase". Its last word when every word
 * is one ("gift set").
 */
export function aiStockObjectWord(subject: string): string {
  const list = subject.split(/\s+/).filter(Boolean)
  const object =
    [...list].reverse().find((word) => !WRAPPERS.has(word)) ??
    list[list.length - 1] ??
    ''
  return object ? aiStockStem(object) : ''
}

const clip = (query: string) =>
  query.replace(/\s+/g, ' ').trim().slice(0, STOCK_PHOTO_QUERY_MAX_CHARS).trim()

/** The frame's orientation: a wide frame wants a landscape photo, a tall one a portrait. */
export function aiStockOrientation(aspect: number): StockPhotoOrientation {
  if (aspect > 1.15) return 'horizontal'
  if (aspect < 0.87) return 'vertical'
  return 'any'
}

/**
 * One search a slot tries. A `broad` one asks for the site's world and
 * takes any hit of it; any other picture of a thing takes only a hit naming
 * the thing.
 */
export interface AiStockSearch extends StockPhotoSearchRequest {
  broad?: boolean
  /** The words its hits are scored by, where they are not the slot's own subject (a product's searches, AGL-3676). */
  subject?: string
  /** A word every hit must name: a product's photo names the shop's category (AGL-3676). */
  requires?: string
}

/**
 * A product's searches (AGL-3676), most specific first: each of its subjects
 * — its name's noun phrase, then its photo's — with the shop's category
 * where the phrase does not already say it ("candle gift box"), then the
 * category alone, a plain photo of what the shop sells. Every one must find a
 * hit naming the category, so no product is ever filled with a lifestyle shot
 * of something else: the beta.237 Willow Wick start put a laptop and roses
 * under "Candle Wick Trimmer" and an antique tea set under "Candle Gift Set".
 */
export function aiStockProductSearches(
  slot: Pick<AiLayoutPictureSlot, 'aspect' | 'product'>,
  craft: string,
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size = orientation === 'vertical' ? { minHeight: 900 } : { minWidth: 900 }
  const craftStems = stemList(craft)
  const queries: Array<{ query: string; subject: string }> = []
  for (const raw of slot.product?.subjects ?? []) {
    const subject = aiStockSubjectWords(raw, '')
    if (!subject) continue
    const says = craftStems.every((stem) => stemList(subject).includes(stem))
    queries.push({ query: craft && !says ? `${craft} ${subject}` : subject, subject })
  }
  if (craft) queries.push({ query: craft, subject: craft })
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const entry of queries) {
    const query = clip(entry.query)
    if (!query || seen.has(query)) continue
    seen.add(query)
    searches.push({ query, orientation, ...size, subject: entry.subject, ...(craft ? { requires: craft } : {}) })
  }
  return searches
}

/** The searches a slot tries, in order, most specific first, each distinct. */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect'>,
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'domain' | 'broad'>,
  subject: string,
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size =
    slot.role === 'hero'
      ? { minWidth: 1600 }
      : orientation === 'vertical'
        ? { minHeight: 900 }
        : { minWidth: 900 }
  const domain = new Set(terms.domain)
  const object = aiStockObjectWord(subject)
  const subjectStems = stemList(subject)
  // The craft qualifies a subject that does not already name the site's world.
  const namesWorld = subjectStems.some((stem) => domain.has(stem))
  const qualify = (phrase: string) =>
    terms.craft && !namesWorld && !stemList(phrase).includes(terms.craft)
      ? `${terms.craft} ${phrase}`
      : phrase
  const broad = terms.broad.map((query) => ({ query, broad: true }))
  const queries: Array<{ query: string; broad?: boolean; people?: boolean }> =
    slot.role === 'hero'
      ? [{ query: terms.business, broad: true }, ...broad]
      : slot.role === 'about'
        ? [
            {
              query: `${terms.business} ${subject}`,
              broad: true,
              people: true,
            },
            { query: terms.business, broad: true, people: true },
            ...broad,
          ]
        : subject
          ? [{ query: qualify(subject) }, { query: qualify(object) }, ...broad]
          : broad
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const raw of queries) {
    const query = clip(raw.query)
    const key = `${query}|${raw.people === true}`
    if (!query || seen.has(key)) continue
    seen.add(key)
    searches.push({
      query,
      orientation,
      ...size,
      ...(raw.people ? { people: true } : {}),
      ...(raw.broad ? { broad: true } : {}),
    })
  }
  return searches
}

/** What a hit is judged by. */
export interface AiStockJudgement {
  /** The words the picture is of; empty for a picture of the site's world. */
  subject?: string
  /** The site's domain stems ({@link AiStockSiteTerms.domain}). */
  domain?: readonly string[]
  /**
   * Whether a hit must name the subject's object. A broad search, a hero
   * and an about picture need only name the domain.
   */
  strict?: boolean
  /** A word every hit must name: a product's photo names the shop's category (AGL-3676). */
  requires?: string
}

/** The words of a photo's page address at its library, its id dropped: "robin-bird-songbird-garden-winter". */
function pageSlug(pageUrl: string): string {
  try {
    const last = decodeURIComponent(new URL(pageUrl).pathname)
      .split('/')
      .filter(Boolean)
      .pop()
    return last?.replace(/-?\d+$/, '') ?? ''
  } catch {
    return ''
  }
}

/** A hit's words: the first few (what it is OF), every one, and each tag's phrase. */
function hitWords(photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>) {
  const slug = pageSlug(photo.pageUrl)
  const tags = (photo.tags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean)
  const lead = new Set(stemList([...tags.slice(0, 3), slug].join(' ')))
  const all = new Set(stemList([...tags, photo.alt ?? '', slug].join(' ')))
  const phrases = [
    ...tags.map((tag) => stemList(tag).join(' ')),
    stemList(photo.alt ?? '').join(' '),
    stemList(slug).join(' '),
  ]
  const rejected = tags.some(
    (tag) =>
      REJECTED_TAGS.has(tag) ||
      tag.split(/\s+/).some((word) => REJECTED_TAGS.has(word)),
  )
  return { lead, all, phrases, rejected }
}

/**
 * How well a hit shows what a slot needs (AGL-3660), or 0 when it must not
 * fill it: a mockup or a blank never; a picture of a thing only when the hit
 * names its object AND either the site's world or the subject's own
 * two-word phrase ("bud vase", "wick trimmer"); anything else only when it
 * names the site's world (when the site names one). Among the accepted, the
 * object among the hit's first tags counts 4 (a mention among its last, 2),
 * the subject's two-word phrase 3, each of its other words 1, and the
 * site's world 1, plus a quarter when it is among the first tags.
 */
export function aiStockRelevance(
  photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>,
  judgement: AiStockJudgement,
): number {
  const hit = hitWords(photo)
  if (hit.rejected) return 0
  const required = stemList(judgement.requires ?? '')
  if (required.some((stem) => !hit.all.has(stem))) return 0
  const subject = stemList(judgement.subject ?? '')
  const object = judgement.subject ? aiStockObjectWord(judgement.subject) : ''
  const domain = (judgement.domain ?? []).filter((stem) => stem !== object)
  // A hit naming the word it must name is of the site's world: a product's
  // category is that world even where it is the product's own object.
  const world =
    required.length > 0 || domain.some((stem) => hit.all.has(stem))
  const worldLead =
    (required.length > 0 && required.every((stem) => hit.lead.has(stem))) ||
    domain.some((stem) => hit.lead.has(stem))
  const pair = subject.length >= 2 ? subject.slice(-2).join(' ') : ''
  const phrased =
    Boolean(pair) &&
    hit.phrases.some((phrase) => ` ${phrase} `.includes(` ${pair} `))
  let score = 0
  if (judgement.strict && object) {
    if (!hit.all.has(object)) return 0
    if (domain.length && !world && !phrased) return 0
    score += hit.lead.has(object) ? 4 : 2
  } else if (domain.length) {
    if (!world) return 0
  }
  if (phrased) score += 3
  for (const word of new Set(subject))
    if (word !== object && hit.all.has(word)) score += 1
  if (world) score += worldLead ? 1.25 : 1
  return Math.max(score, 0.5)
}

/**
 * A search's acceptable hits in the order they are tried (AGL-3660): those
 * not placed yet, among the first few the library returned, those it must
 * not take dropped ({@link aiStockRelevance}), best first; the seed turns
 * the hits that score alike, so two jobs differ and one job repeats itself.
 */
export function aiStockRank(
  photos: readonly StockPhoto[],
  used: ReadonlySet<string>,
  seed: string,
  judgement: AiStockJudgement = {},
): StockPhoto[] {
  const scored = photos
    .filter((photo) => !used.has(stockPhotoSourceKey(photo)))
    .slice(0, AI_LAYOUT_STOCK_PICK_WINDOW)
    .map((photo) => ({ photo, score: aiStockRelevance(photo, judgement) }))
    .filter((entry) => entry.score > 0)
  if (!scored.length) return []
  const turn = aiLayoutSeedNumber(seed)
  const ranked: StockPhoto[] = []
  for (const score of [...new Set(scored.map((entry) => entry.score))].sort(
    (a, b) => b - a,
  )) {
    const tier = scored.filter((entry) => entry.score === score)
    const start = turn % tier.length
    for (const entry of [...tier.slice(start), ...tier.slice(0, start)])
      ranked.push(entry.photo)
  }
  return ranked
}

/** The pick among a search's hits: the first {@link aiStockRank} would try, or `null`. */
export function aiStockPick(
  photos: readonly StockPhoto[],
  used: ReadonlySet<string>,
  seed: string,
  judgement: AiStockJudgement = {},
): StockPhoto | null {
  return aiStockRank(photos, used, seed, judgement)[0] ?? null
}

/**
 * The library photos a stored page already shows: every `image` whose
 * source is the site's media reference. Starter photos are the platform's,
 * not the job's, and are not listed.
 */
export function aiStockPlacedSrcs(
  nodes: NodesMap | null | undefined,
): string[] {
  const map = (nodes ?? {}) as unknown as Record<
    string,
    { componentId?: string; props?: Record<string, unknown> }
  >
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

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

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
  /** The most searches this source sends; a page's own bound where absent. A store's products search more (AGL-3676). */
  searches?: number
  signal?: AbortSignal
}

export interface AiLayoutStockPhotoDeps {
  provider?: () => StockPhotoProvider | null
  ingest?: () => PluginMediaIngest | null
  budgetMs?: number
}

/** A slot's choice: the accepted hits it may be filled from, best first, and the query that found them. */
interface AiStockChoice {
  candidates: StockPhoto[]
  query: string
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
  const terms = aiStockSiteTerms(input.business)
  return async (slots) => {
    const timeout = AbortSignal.timeout(
      deps.budgetMs ?? AI_LAYOUT_STOCK_PHOTOS_BUDGET_MS,
    )
    const signal = input.signal
      ? AbortSignal.any([input.signal, timeout])
      : timeout
    const scope = input.seed
    const job = jobPhotos(input.jobId ? `${input.hostId}:${input.jobId}` : null)
    const avoid = new Set(input.avoid ?? [])
    /** Placed elsewhere in the job: by another page in this process, or one the caller read. */
    const elsewhere = (key: string) =>
      avoid.has(key) || (job?.has(key) === true && job.get(key) !== scope)
    /** Source keys this page has claimed for a slot, or turned down. */
    const claimed = new Set<string>()
    /** Asset srcs this page has placed. */
    const placedSrcs = new Set<string>()
    const answers = new Map<string, Promise<StockPhoto[] | null>>()
    let searches = 0
    let storing = true
    const remember = (sourceKey: string, src: string) => {
      placedSrcs.add(src)
      job?.set(sourceKey, scope)
      job?.set(src, scope)
    }
    /** A search's hits; the same words twice are answered from memory, and `null` once the page's searches are spent. */
    const search = (wanted: AiStockSearch): Promise<StockPhoto[] | null> => {
      const request: StockPhotoSearchRequest = { ...wanted }
      delete (request as AiStockSearch).broad
      delete (request as AiStockSearch).subject
      delete (request as AiStockSearch).requires
      const key = JSON.stringify([
        request.query,
        request.orientation,
        request.people === true,
      ])
      const known = answers.get(key)
      if (known) return known
      if (searches >= (input.searches ?? AI_LAYOUT_STOCK_SEARCHES_PER_PAGE))
        return Promise.resolve(null)
      searches += 1
      const asked = provider
        .search(request, { signal })
        .then((found) => found?.photos ?? [])
        .catch(() => [] as StockPhoto[])
      answers.set(key, asked)
      return asked
    }
    /** The photo placed in the site's library, a copy it holds or a new one; `null` when it cannot be placed. */
    const keep = async (
      photo: StockPhoto,
      slot: AiLayoutPictureSlot,
      query: string,
    ): Promise<AiLayoutPicturePhoto | null> => {
      const sourceKey = stockPhotoSourceKey(photo)
      try {
        const kept = await ingest.findStockPhoto({
          hostId: input.hostId,
          sourceKey,
        })
        if (kept) {
          // Held because a slot of this page or another page of the job shows it.
          if (placedSrcs.has(kept.src) || elsewhere(kept.src)) return null
          remember(sourceKey, kept.src)
          return {
            src: kept.src,
            width: kept.width ?? photo.width,
            height: kept.height ?? photo.height,
          }
        }
        // A refusal to store (the storage band, a lockdown) holds for the
        // whole page, so the rest of it reuses what it can and copies nothing.
        if (!storing || signal.aborted) return null
        const bytes = await provider.download(photo, {
          maxBytes: AI_LAYOUT_STOCK_MAX_BYTES,
          signal,
        })
        if (!bytes || signal.aborted || !storing) return null
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
            ...(photo.photographerUrl
              ? { photographerUrl: photo.photographerUrl }
              : {}),
            license: credit.license,
            licenseUrl: credit.licenseUrl,
            attributionRequired: credit.attributionRequired,
            query,
          },
        })
        if (stored.ok) {
          remember(sourceKey, stored.src)
          return {
            src: stored.src,
            width: stored.width ?? photo.width,
            height: stored.height ?? photo.height,
          }
        }
        storing = false
        const refusal = stored as Extract<
          PluginMediaIngestResult,
          { ok: false }
        >
        console.warn(
          'ai layout pictures: the media library refused a stock photo',
          {
            status: refusal.status,
            reason: refusal.reason,
          },
        )
      } catch (error) {
        console.warn('ai layout pictures: a stock photo could not be kept', {
          error: String(error),
        })
      }
      return null
    }

    // 1. Choose, slot by slot, so the page's choices never collide: each
    //    slot claims its best accepted hit before the next slot looks.
    const choices: Array<AiStockChoice | null> = []
    for (const [index, slot] of slots.entries()) {
      if (signal.aborted) {
        choices.push(null)
        continue
      }
      const subject = aiStockSubjectWords(
        slot.alt,
        input.sectionNames[slot.sectionIndex] ?? '',
      )
      let choice: AiStockChoice | null = null
      const requests = slot.product
        ? aiStockProductSearches(slot, terms.craft)
        : aiStockSearchesFor(slot, terms, subject)
      for (const request of requests) {
        if (choice || signal.aborted) break
        const found = await search(request)
        if (found === null) break
        const blocked = new Set(claimed)
        for (const hit of found) {
          const key = stockPhotoSourceKey(hit)
          if (elsewhere(key)) blocked.add(key)
        }
        const ranked = aiStockRank(
          found,
          blocked,
          `${input.seed}:${index}:${request.query}`,
          {
            subject: request.subject ?? (request.broad ? '' : subject),
            domain: terms.domain,
            strict:
              (slot.role === 'gallery' && !request.broad) || !!request.requires,
            ...(request.requires ? { requires: request.requires } : {}),
          },
        )
        if (!ranked.length) continue
        const first = ranked[0] as StockPhoto
        claimed.add(stockPhotoSourceKey(first))
        choice = {
          candidates: ranked.slice(0, AI_LAYOUT_STOCK_TRIES_PER_SLOT),
          query: request.query,
        }
      }
      choices.push(choice)
    }

    // 2. Keep, a few at a time; a copy that fails tries the slot's next
    //    accepted hit no other slot has claimed.
    const photos: Array<AiLayoutPicturePhoto | null> = slots.map(() => null)
    const fill = async (index: number) => {
      const choice = choices[index]
      const slot = slots[index]
      if (!choice || !slot) return
      for (const [rank, candidate] of choice.candidates.entries()) {
        if (signal.aborted) return
        const key = stockPhotoSourceKey(candidate)
        if (rank > 0) {
          if (claimed.has(key)) continue
          claimed.add(key)
        }
        const placed = await keep(candidate, slot, choice.query)
        if (placed) {
          photos[index] = placed
          return
        }
      }
    }
    let next = 0
    const worker = async () => {
      while (next < slots.length) {
        const index = next
        next += 1
        await fill(index)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(AI_LAYOUT_STOCK_COPIES_AT_ONCE, slots.length) },
        worker,
      ),
    )
    return photos
  }
}
