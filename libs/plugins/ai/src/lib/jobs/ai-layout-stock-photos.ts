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
import { aiStorefrontSays } from '../layout-language/ai-layout-storefront'

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
 *    What the beta.239 Ember & Oak start added: "hand-poured", "handmade"
 *    and "by hand" never make "hands" a subject, and a story of the craft
 *    asks for the maker at work ("candle making"); a hit carrying a topic
 *    the brief never named (a cross, a grave, a flag, a gun, wine, a child,
 *    a mannequin) never fills anything; a product, and a collection tile,
 *    take only a hit naming its head noun among the first tags, held to the
 *    shop's category; and an object whose word is not enough ("melt") is
 *    named and searched by its kin ("wax melt", "melt warmer"), never by the
 *    category alone. And from the Kiln & Clover portfolio: nudity never fills
 *    anything, for any business; a hit naming a rival craft (glass, for a
 *    potter) counts only when it names the craft's own words too.
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
    'hand-painted hand-dyed hand-stitched poured finished styled perfect wheel-thrown wheelthrown thrown ' +
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
 * Topics a business's photos never carry unless its own words name them
 * (AGL-3660, the beta.239 Ember & Oak start, whose "Gifts for melt fans" tile
 * showed devotional candles with crosses and names). A hit tagged with any
 * word of a topic is rejected unless the site's business type or brief says
 * one of the topic's words or its `allow` words. The last topic is not
 * sensitive but is never the thing: the same start's story band showed bronze
 * mannequin hands tagged "wax".
 */
const SENSITIVE_TOPICS: ReadonlyArray<{
  words: readonly string[]
  allow?: readonly string[]
  /** Rejected whatever the brief says. */
  always?: boolean
}> = [
  {
    // Religion.
    words: [
      'cross',
      'crosses',
      'crucifix',
      'church',
      'chapel',
      'cathedral',
      'jesus',
      'christ',
      'christian',
      'christianity',
      'god',
      'bible',
      'rosary',
      'prayer',
      'pray',
      'praying',
      'worship',
      'worships',
      'religion',
      'religious',
      'faith',
      'islam',
      'islamic',
      'muslim',
      'mosque',
      'quran',
      'temple',
      'buddha',
      'buddhism',
      'buddhist',
      'hindu',
      'hinduism',
      'synagogue',
      'jewish',
      'judaism',
      'ecclesiastical',
      'saint',
      'altar',
      'sacrificial',
      'nativity',
      'priest',
      'nun',
      'monk',
    ],
    allow: ['ministry', 'parish', 'congregation', 'wedding'],
  },
  {
    // Death and mourning.
    words: [
      'funeral',
      'memorial',
      'grave',
      'gravestone',
      'cemetery',
      'tomb',
      'death',
      'dead',
      'grief',
      'mourning',
      'condolence',
      'coffin',
      'skull',
    ],
    allow: ['hospice', 'mortuary', 'cremation', 'obituary', 'halloween'],
  },
  {
    // Politics.
    words: [
      'political',
      'politics',
      'protest',
      'protester',
      'demonstration',
      'rally',
      'flag',
      'election',
      'vote',
      'voting',
      'parliament',
      'government',
    ],
    allow: ['advocacy', 'campaign', 'candidate', 'council', 'nonprofit'],
  },
  {
    // Weapons and war.
    words: [
      'gun',
      'rifle',
      'pistol',
      'weapon',
      'firearm',
      'ammunition',
      'bullet',
      'sword',
      'war',
      'military',
      'army',
      'soldier',
    ],
    allow: ['hunting', 'archery', 'martial', 'fencing', 'veteran'],
  },
  {
    // Alcohol, for a business that does not serve it.
    words: [
      'alcohol',
      'wine',
      'beer',
      'whiskey',
      'whisky',
      'vodka',
      'cocktail',
      'liquor',
      'rum',
      'gin',
      'champagne',
      'drunk',
    ],
    allow: [
      'winery',
      'vineyard',
      'brewery',
      'distillery',
      'pub',
      'tavern',
      'taproom',
      'bartender',
      'sommelier',
      'spirits',
    ],
  },
  {
    // Tobacco and drugs.
    words: ['cigarette', 'smoking', 'tobacco', 'cannabis', 'marijuana', 'drug', 'drugs'],
    allow: ['dispensary', 'vape', 'cigar'],
  },
  {
    // Children, for a business that is not about them.
    words: ['child', 'children', 'kid', 'kids', 'baby', 'babies', 'toddler', 'infant'],
    allow: [
      'nursery',
      'daycare',
      'preschool',
      'kindergarten',
      'school',
      'tutor',
      'tutoring',
      'parent',
      'parents',
      'parenting',
      'family',
      'families',
      'pediatric',
      'paediatric',
      'newborn',
      'maternity',
    ],
  },
  {
    // Nudity, for every business: no word of a brief lets it in (Kiln &
    // Clover, 2026-10-10: a nude torso sculpture filled "About the artist").
    // Never bare "body": a skincare shop's body lotion is its product.
    words: [
      'nude',
      'nudes',
      'nudity',
      'naked',
      'torso',
      'breast',
      'breasts',
      'erotic',
      'sensual',
      'lingerie',
      'bikini',
    ],
    allow: [],
    always: true,
  },
  {
    // Figures, never the maker: mannequin hands are not a candlemaker's.
    words: [
      'mannequin',
      'mannequins',
      'dummy',
      'statue',
      'sculpture',
      'figurine',
      'doll',
      'dolls',
      'waxwork',
    ],
    allow: ['sculptor', 'museum', 'fashion', 'boutique', 'clothing', 'apparel', 'toy', 'toys'],
  },
]

/** Each topic's words and the words that allow it, as stems. */
const SENSITIVE_STEMS = SENSITIVE_TOPICS.map((topic) => ({
  words: new Set(topic.words.map(aiStockStem)),
  allow: new Set(
    topic.always
      ? []
      : [...topic.words, ...(topic.allow ?? [])].map(aiStockStem),
  ),
}))

/**
 * Hands are never a picture's subject (AGL-3660): "hand-poured", "handmade"
 * and "by hand" say how a thing was made, and a search for "hands" found
 * bronze mannequin hands for the beta.239 Ember & Oak story band. Each of
 * these is dropped from a picture's words; a hand only stays where it names
 * a thing sold for hands ("hand cream").
 */
const HAND_IDIOMS: readonly RegExp[] = [
  /\b(?:made\s+|poured\s+|crafted\s+|finished\s+|done\s+)?by\s+(?:our\s+|my\s+|their\s+)?(?:own\s+)?hands?\b/g,
  /\bwith\s+(?:our|my|their)\s+(?:own\s+)?(?:two\s+)?hands\b/g,
  /\bhand[- ]?(?:poured|made|crafted|thrown|built|painted|dyed|stitched|sewn|knit|knitted|carved|tied|lettered|blown|bound|rolled|dipped|picked|forged|woven|cut|finished|mixed|cast|formed|shaped|pressed|printed|wrapped|selected|blended|turned|glazed)\b/g,
  /\bhands?\b(?!\s+(?:creams?|soaps?|lotions?|wash|towels?|saniti[sz]ers?|salves?|balms?|tools?|saws?|planes?|drills?|mixers?|puppets?|bags?|warmers?))/g,
]

/** A text without its hands. */
function withoutHands(text: string): string {
  return HAND_IDIOMS.reduce(
    (out, idiom) => out.replace(idiom, ' '),
    text.toLowerCase(),
  )
}

/** Whether a text says how a thing was made by hand: a maker at work. */
function saysMadeByHand(text: string): boolean {
  const lower = text.toLowerCase()
  return HAND_IDIOMS.some((idiom) => {
    idiom.lastIndex = 0
    const found = idiom.test(lower)
    idiom.lastIndex = 0
    return found
  })
}

/**
 * The kin of a few objects whose own word is not enough (AGL-3660): a "melt"
 * is any melting thing (the beta.239 "Wax melts" tile showed resin fluid
 * art), so a wax melt names one of these phrases. `within` is the world they
 * are of; `qualifier` the word a search adds; `queries` the searches for the
 * object itself, which stand in for the shop's category alone: a candle is
 * not a wax melt.
 */
const OBJECT_KIN: ReadonlyArray<{
  objects: readonly string[]
  within: readonly string[]
  qualifier: string
  kin: readonly string[]
  queries: readonly string[]
}> = [
  {
    objects: ['melt', 'tart', 'cube'],
    within: ['wax', 'candle', 'soy'],
    qualifier: 'wax',
    kin: [
      'wax melt',
      'wax melts',
      'wax cube',
      'wax cubes',
      'wax tart',
      'wax tarts',
      'melt warmer',
      'wax warmer',
      'tart warmer',
      'oil burner',
      'oil warmer',
      'aroma burner',
      'scent warmer',
      'fragrance warmer',
    ],
    queries: ['wax melts', 'wax melt warmer', 'scented wax cubes'],
  },
]

/** An object's kin where the site or the subject is of its world, else `null`. */
function objectKin(
  object: string,
  world: readonly string[],
): (typeof OBJECT_KIN)[number] | null {
  return (
    OBJECT_KIN.find(
      (entry) =>
        entry.objects.some((word) => aiStockStem(word) === object) &&
        entry.within.some((word) => world.includes(aiStockStem(word))),
    ) ?? null
  )
}

/**
 * The kin of a few common crafts: the words a photo of that world is
 * tagged with, and the broad searches that find it. A craft not listed
 * still has its own words; this only widens what counts as its world.
 */
const CRAFT_KIN: ReadonlyArray<{
  match: readonly string[]
  kin: readonly string[]
  broad: readonly string[]
  /** The maker at work: what a story of the craft shows, never "hands" (AGL-3660). */
  making: readonly string[]
  /**
   * Crafts a photo of this one is mistaken for, and the words only this
   * craft's photos say: a hit naming a rival counts as of this world only
   * when it names one of them too (Kiln & Clover, 2026-10-10: red and yellow
   * glass art filled a ceramic artist's Work hero, glass being fired and
   * "vase" too).
   */
  rivals?: { words: readonly string[]; core: readonly string[] }
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
    rivals: {
      words: ['glass', 'glassware', 'glasswork', 'glassblowing', 'blown', 'stained', 'murano', 'crystal'],
      core: ['ceramic', 'ceramics', 'pottery', 'potter', 'stoneware', 'porcelain', 'earthenware', 'clay', 'terracotta'],
    },
    making: ['pottery wheel', 'potter at work'],
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
    making: ['candle making', 'pouring wax'],
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
    making: ['jewelry making', 'jeweler at work'],
  },
  {
    match: ['soap', 'soapmaker', 'skincare'],
    kin: ['soap', 'skincare', 'lotion', 'bath', 'spa', 'natural', 'cosmetic'],
    broad: ['handmade soap', 'natural skincare'],
    making: ['soap making'],
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
    making: ['woodworking workshop', 'carpenter at work'],
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
    making: ['baker kneading dough', 'baking bread'],
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
    making: ['barista making coffee'],
  },
  {
    match: ['florist', 'flower', 'floral'],
    kin: ['flower', 'floral', 'bouquet', 'florist', 'bloom', 'blossom'],
    broad: ['florist', 'flower bouquet'],
    making: ['florist arranging flowers'],
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
    making: ['knitting', 'weaving loom'],
  },
  {
    match: ['leather', 'leatherwork', 'leathercraft'],
    kin: ['leather', 'wallet', 'bag', 'belt', 'stitching'],
    broad: ['leather craft', 'leather goods'],
    making: ['leather crafting'],
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
  /** The searches for its maker at work, for a story of the craft (AGL-3660); empty for a craft not listed. */
  making: string[]
  /** Every stem of the business type or brief: what lets a sensitive topic in ({@link SENSITIVE_TOPICS}). */
  named: string[]
  /** Rival crafts' words, each with the words that must then be named too ({@link CRAFT_KIN}). */
  rivals: Array<{ words: string[]; core: string[] }>
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
    // A set or a gift is never a world: "gift" of "gift sets" is not one.
    const world = (making ? kept.slice(0, -1) : kept).filter(
      (word) => !WRAPPERS.has(word),
    )
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
  const makingSearches: string[] = []
  const rivals: Array<{ words: string[]; core: string[] }> = []
  for (const group of CRAFT_KIN) {
    if (
      !group.match.some(
        (word) => domain.has(aiStockStem(word)) || made.has(aiStockStem(word)),
      )
    )
      continue
    for (const word of group.kin) domain.add(aiStockStem(word))
    broad.push(...group.broad)
    makingSearches.push(...group.making)
    if (group.rivals)
      rivals.push({
        words: group.rivals.words.map(aiStockStem),
        core: group.rivals.core.map(aiStockStem),
      })
  }
  if (!broad.length) broad.push(business, craft)
  return {
    business,
    craft,
    domain: [...domain].filter((stem) => stem.length > 1),
    broad: [...new Set(broad.map((query) => query.trim()).filter(Boolean))],
    making: [...new Set(makingSearches)],
    named: [...new Set(stemList(businessType))],
    rivals,
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
  // "Hand-poured", "by hand" and "hands" say how it was made, never what it shows.
  for (const clause of withoutHands(alt).split(CLAUSE_BREAK)) {
    const found = subjectOf(contentWords(clause ?? ''))
    if (found.length) return found.slice(-3).join(' ')
  }
  return subjectOf(contentWords(withoutHands(sectionName))).slice(0, 2).join(' ')
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
  /** The thing every hit must name, where it is not the subject's own: a product's head noun (AGL-3660). */
  object?: string
  /** Phrases that name the object where its own word is not enough: "wax melt" ({@link OBJECT_KIN}). */
  kin?: readonly string[]
  /** Whether the object must be among the hit's first tags, what the photo is OF (AGL-3660). */
  lead?: boolean
}

/** A slot's part of a page, where it asks for more than its role: a collection tile or a story of the craft (AGL-3660). */
export type AiStockSlotPart = 'collection' | 'story'

/**
 * A slot's part (AGL-3660): a tile of a collections band is product-like,
 * held to the shop's category and its own object; a picture of a story of
 * the craft, or of a thing made by hand, shows the maker at work.
 */
export function aiStockSlotPart(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt'>,
  sectionName: string,
): AiStockSlotPart | undefined {
  if (slot.role === 'hero') return undefined
  if (slot.role === 'gallery' && aiStorefrontSays('collections', sectionName))
    return 'collection'
  if (
    aiStorefrontSays('story', sectionName) ||
    saysMadeByHand(slot.alt) ||
    saysMadeByHand(sectionName)
  )
    return 'story'
  return undefined
}

/** An object's kin phrases as stems, or none. */
const kinStems = (entry: (typeof OBJECT_KIN)[number] | null): string[] =>
  entry ? [...new Set(entry.kin.map((phrase) => stemList(phrase).join(' ')))] : []

/**
 * A product's searches (AGL-3676), most specific first: each of its subjects
 * — its name's noun phrase, then its photo's — with the shop's category
 * where the phrase does not already say it ("candle gift box"), then the
 * category alone, a plain photo of what the shop sells. Every one must find a
 * hit naming the category, so no product is ever filled with a lifestyle shot
 * of something else: the beta.237 Willow Wick start put a laptop and roses
 * under "Candle Wick Trimmer" and an antique tea set under "Candle Gift Set".
 *
 * And every one must find a hit naming the product's own head noun among its
 * first tags (AGL-3660): the beta.239 Ember & Oak start put a bed with a book,
 * a mug and a camera (its candle a last tag) under "Hand-Poured Soy Candle".
 * An object whose own word is not enough ({@link OBJECT_KIN}) is searched by
 * its kin instead of the category alone, and named by them: a single taper
 * candle filled "Wax Melt Gift Set".
 */
export function aiStockProductSearches(
  slot: Pick<AiLayoutPictureSlot, 'aspect' | 'product'>,
  craft: string,
  domain: readonly string[] = [],
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size = orientation === 'vertical' ? { minHeight: 900 } : { minWidth: 900 }
  const craftStems = stemList(craft)
  const subjects = (slot.product?.subjects ?? [])
    .map((raw) => aiStockSubjectWords(raw, ''))
    .filter(Boolean)
  // The product's head noun is its name's: "candle" of "Hand-Poured Soy Candle".
  const object = aiStockObjectWord(subjects[0] ?? '')
  const kin = object
    ? objectKin(object, [...craftStems, ...domain, ...stemList(subjects.join(' '))])
    : null
  const kinPhrases = kinStems(kin)
  const queries: Array<{ query: string; subject: string; object: string }> = []
  for (const subject of subjects) {
    const stems = stemList(subject)
    const query = kin
      ? stems.includes(aiStockStem(kin.qualifier))
        ? subject
        : `${kin.qualifier} ${subject}`
      : craft && !craftStems.every((stem) => stems.includes(stem))
        ? `${craft} ${subject}`
        : subject
    queries.push({ query, subject, object })
  }
  // The category alone stands in only for a thing that is no more than of it.
  // Its hits are still scored by the product's own words: a soy candle over a taper.
  const own = subjects[0] ?? ''
  if (kin) for (const query of kin.queries) queries.push({ query, subject: own || query, object })
  else if (craft) queries.push({ query: craft, subject: own || craft, object: craft })
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const entry of queries) {
    const query = clip(entry.query)
    if (!query || seen.has(query)) continue
    seen.add(query)
    searches.push({
      query,
      orientation,
      ...size,
      subject: entry.subject,
      lead: true,
      ...(entry.object ? { object: entry.object } : {}),
      ...(kinPhrases.length ? { kin: kinPhrases } : {}),
      ...(craft ? { requires: craft } : {}),
    })
  }
  return searches
}

/** The searches a slot tries, in order, most specific first, each distinct. */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect'>,
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'domain' | 'broad'> &
    Partial<Pick<AiStockSiteTerms, 'making'>>,
  subject: string,
  part?: AiStockSlotPart,
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
  const kin = object ? objectKin(object, [...terms.domain, ...subjectStems]) : null
  const kinPhrases = kinStems(kin)
  // The craft qualifies a subject that does not already name the site's world.
  const namesWorld = subjectStems.some((stem) => domain.has(stem))
  const qualify = (phrase: string) =>
    terms.craft && !namesWorld && !stemList(phrase).includes(terms.craft)
      ? `${terms.craft} ${phrase}`
      : phrase
  type Query = {
    query: string
    broad?: boolean
    people?: boolean
    held?: boolean
    category?: boolean
  }
  // A collection tile is product-like: held to the shop's category and its
  // own object among the first tags, and searched by its object's kin, never
  // the category's world alone (AGL-3660).
  const collection = part === 'collection' && Boolean(terms.craft)
  const broad: Query[] = kin && collection
    ? []
    : terms.broad.map((query) => ({ query, broad: true, category: collection }))
  // The maker at work, held to the craft: never "hands" (AGL-3660).
  const making: Query[] = (terms.making ?? []).map((query) => ({
    query,
    broad: true,
    category: true,
  }))
  const thing: Query[] = subject
    ? [
        { query: qualify(subject), held: true },
        ...(kin
          ? kin.queries.map((query) => ({ query, held: true }))
          : [{ query: qualify(object), held: true }]),
      ]
    : []
  const queries: Query[] =
    slot.role === 'hero'
      ? [{ query: terms.business, broad: true }, ...broad]
      : slot.role === 'about'
        ? [
            ...(part === 'story' ? making : []),
            {
              query: `${terms.business} ${subject}`,
              broad: true,
              people: true,
            },
            { query: terms.business, broad: true, people: true },
            ...(part === 'story' ? [] : making),
            ...broad,
          ]
        : [...(part === 'story' ? making : []), ...thing, ...broad]
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const raw of queries) {
    const query = clip(raw.query)
    const key = `${query}|${raw.people === true}`
    if (!query || seen.has(key)) continue
    seen.add(key)
    const held = raw.held === true && (collection || kinPhrases.length > 0)
    searches.push({
      query,
      orientation,
      ...size,
      ...(raw.people ? { people: true } : {}),
      ...(raw.broad ? { broad: true } : {}),
      ...(held && kinPhrases.length ? { kin: kinPhrases } : {}),
      ...(held && collection ? { lead: true } : {}),
      ...(terms.craft && (raw.category || (raw.held && collection))
        ? { requires: terms.craft }
        : {}),
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
  /** The thing a hit must name, where it is not the subject's own (AGL-3660). */
  object?: string
  /** Phrases naming the object where its word is not enough; one of them is then required, and stands for the category. */
  kin?: readonly string[]
  /** Whether the object must be among the hit's first tags (AGL-3660). */
  lead?: boolean
  /** The stems of the site's business type or brief, which let a sensitive topic in ({@link AiStockSiteTerms.named}). */
  named?: readonly string[]
  /** Rival crafts: a hit naming one is rejected unless it names the site's core words ({@link AiStockSiteTerms.rivals}). */
  rivals?: ReadonlyArray<{ words: readonly string[]; core: readonly string[] }>
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
  const leadPhrases = [
    ...tags.slice(0, 3).map((tag) => stemList(tag).join(' ')),
    stemList(slug).join(' '),
  ]
  const rejected = tags.some(
    (tag) =>
      REJECTED_TAGS.has(tag) ||
      tag.split(/\s+/).some((word) => REJECTED_TAGS.has(word)),
  )
  // Whole words only, a hyphenated one kept whole: "cross-stitch" is not a cross.
  const words = new Set(
    [...tags, (photo.alt ?? '').toLowerCase()]
      .join(' ')
      .split(/[^a-zÀ-ɏ-]+/)
      .filter((word) => word.length > 1)
      .map(aiStockStem),
  )
  return { lead, all, phrases, leadPhrases, rejected, words }
}

/** Whether a phrase is among a hit's phrases, word for word. */
const among = (phrases: readonly string[], phrase: string) =>
  phrases.some((found) => ` ${found} `.includes(` ${phrase} `))

/**
 * Whether a hit carries a topic its site never named ({@link SENSITIVE_TOPICS}):
 * a cross, a grave, a flag, a gun, a glass of wine, a child, a mannequin.
 */
export function aiStockSensitive(
  photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>,
  named: readonly string[] = [],
): boolean {
  const { words: found } = hitWords(photo)
  const site = new Set(named)
  return SENSITIVE_STEMS.some(
    (topic) =>
      [...topic.words].some((word) => found.has(word)) &&
      ![...topic.allow].some((word) => site.has(word)),
  )
}

/**
 * How well a hit shows what a slot needs (AGL-3660), or 0 when it must not
 * fill it: a mockup or a blank never; a topic the site never named never
 * ({@link aiStockSensitive}); a picture of a thing only when the hit
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
  if (aiStockSensitive(photo, judgement.named)) return 0
  // Glass art is not pottery: a rival craft's photo names this craft's own words.
  for (const rival of judgement.rivals ?? [])
    if (
      rival.words.some((word) => hit.all.has(word)) &&
      !rival.core.some((word) => hit.all.has(word))
    )
      return 0
  const kin = judgement.kin ?? []
  const kinNamed = kin.some((phrase) => among(hit.phrases, phrase))
  const kinLead = kin.some((phrase) => among(hit.leadPhrases, phrase))
  const required = stemList(judgement.requires ?? '')
  // An object's kin stands for the category: a wax melt is the candle shop's.
  if (!kinNamed && required.some((stem) => !hit.all.has(stem))) return 0
  const subject = stemList(judgement.subject ?? '')
  const object =
    judgement.object ??
    (judgement.subject ? aiStockObjectWord(judgement.subject) : '')
  const domain = (judgement.domain ?? []).filter((stem) => stem !== object)
  // A hit naming the word it must name is of the site's world: a product's
  // category is that world even where it is the product's own object.
  const world =
    required.length > 0 || kinNamed || domain.some((stem) => hit.all.has(stem))
  const worldLead =
    (required.length > 0 && required.every((stem) => hit.lead.has(stem))) ||
    kinLead ||
    domain.some((stem) => hit.lead.has(stem))
  const pair = subject.length >= 2 ? subject.slice(-2).join(' ') : ''
  const phrased = Boolean(pair) && among(hit.phrases, pair)
  let score = 0
  if (judgement.strict && object) {
    // An object with kin is named only by them: "melt" alone is resin art.
    const named = kin.length ? kinNamed : hit.all.has(object)
    if (!named) return 0
    const leading = kin.length ? kinLead : hit.lead.has(object)
    // A lifestyle scene whose object is a last tag is not a photo OF it.
    if (judgement.lead && !leading) return 0
    if (domain.length && !world && !phrased) return 0
    score += leading ? 4 : 2
    if (kinNamed) score += 3
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
      delete (request as AiStockSearch).object
      delete (request as AiStockSearch).kin
      delete (request as AiStockSearch).lead
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
      const sectionName = input.sectionNames[slot.sectionIndex] ?? ''
      const subject = aiStockSubjectWords(slot.alt, sectionName)
      let choice: AiStockChoice | null = null
      const requests = slot.product
        ? aiStockProductSearches(slot, terms.craft, terms.domain)
        : aiStockSearchesFor(
            slot,
            terms,
            subject,
            aiStockSlotPart(slot, sectionName),
          )
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
            named: terms.named,
            rivals: terms.rivals,
            ...(request.requires ? { requires: request.requires } : {}),
            ...(request.object ? { object: request.object } : {}),
            ...(request.kin ? { kin: request.kin } : {}),
            ...(request.lead ? { lead: true } : {}),
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
