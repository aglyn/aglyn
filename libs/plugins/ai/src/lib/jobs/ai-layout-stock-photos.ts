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
  AI_LAYOUT_NO_PHOTO,
  aiLayoutSeedNumber,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSlot,
  type AiLayoutPictureSource,
} from '../layout-language/ai-layout-pictures'
import { aiStorefrontSays } from '../layout-language/ai-layout-storefront'
import { aiLayoutLabel, aiLayoutSpeaksOtherThanEnglish } from '../layout-language/ai-layout-labels'
import type { AiBuildPlan } from '../model/ai-build-plan'
import { aiSiteKindOfInputs } from '../model/ai-site-kinds'
import { aiStockBusinessNoun } from './ai-stock-business-nouns'

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
 * 6. **Fall back to the craft, never off it** (the beta.241 Saltmarsh Soap
 *    Co start, a store "for handmade cold-process soap": its craft read as
 *    nothing, its hero searched "shop" and took a florist's bouquet, and four
 *    of five products took the starters' laptop desk and living room). A
 *    business that is only a place takes its craft from what it is for
 *    ("soap shop"); a hero names the craft itself ({@link AiStockSiteTerms.core});
 *    a product, after its own searches, tries its head noun anywhere among
 *    the tags, its gift wrapper with the craft and the craft's broad
 *    searches, and then — a product or a hero only — reuses an on-topic photo
 *    the job already shows rather than take a starter. Every slot of a
 *    craft's site tries the craft's broad searches last.
 * 7. **A product takes the surest photo, even a borrowed one** (the beta.242
 *    Tidewater Soap Works start: a sauna for "Bath Gift Set", colognes for
 *    "Natural Body Lotion", a bathroom shelf for "Soap Bar Trio" and a soap
 *    dispenser for its starter size, while the collection tiles beside them
 *    were good). A product's searches are ranked by how sure they are: its
 *    own photo (the head noun or its kin among the first tags), then a photo
 *    OF its category, new or one the job already shows, then a weak hit of
 *    its own. No product shows a room or a scene, a fragrance bottle, or what
 *    its kin shuns (a pump for a bar) unless it names it; "bath" in a bath
 *    gift set is what the set is for; a size is never the product.
 *
 * A slot the library could not fill because it never answered — down, or
 * out of time before its first answer — or because the site's library
 * refused to store, is left `null` for the starter photos. A slot the
 * library answered and nothing acceptable came back for is answered
 * {@link AI_LAYOUT_NO_PHOTO} and keeps its no-photo treatment: the beta.257
 * Copper Kettle Catering hero, held to "caterer" while catering photos are
 * tagged "catering", took the starters' pottery workbench (AGL-3831). A
 * named object is never given one while the library answers anything of the
 * site's world: the broad searches come first. Nothing here throws, and none
 * of it is an AI model call: photos cost no AI credits.
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
    'hand-painted hand-dyed hand-stitched poured finished styled perfect wheel-thrown wheelthrown thrown ' +
    'fresh clean calm serene quiet peaceful vibrant colorful colourful sunlit sunny golden glossy matte textured ' +
    'close-up closeup up view views detail details detailed shot shots overhead flat lay flatlay flat-lay ' +
    'top-down wide angle featuring featured displayed arranged sitting resting placed standing lined ' +
    'single pair collection assortment selection group few various array range large tiny big little ' +
    'tall short wide narrow everyday classic signature original favorite favourite bestselling best-selling ' +
    'small-batch batch limited edition custom bespoke ' +
    // How a soap is made, never what it shows: "cold" and "process" named a supermarket fridge (Saltmarsh, 2026-10-10).
    'cold-process cold-processed hot-process hot-processed melt-and-pour ' +
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
 * Rooms and scenes, never a product (AGL-3660): the beta.242 Tidewater Soap
 * Works start put a wooden sauna under "Bath Gift Set" and a bathroom shelf of
 * baskets under "Soap Bar Trio". A product's hit whose first tags name one of
 * these is turned down unless the product or the brief names it too.
 */
const PRODUCT_SCENES = new Set(
  [
    'sauna',
    'bathroom',
    'bathtub',
    'shower',
    'toilet',
    'sink',
    'washbasin',
    'faucet',
    'tap',
    'shelf',
    'shelves',
    'interior',
    'bedroom',
    'kitchen',
    'room',
    'livingroom',
    'hotel',
    'lobby',
  ].map(aiStockStem),
)

/**
 * A fragrance's bottle, never a lotion, a cream or a soap (AGL-3660): the same
 * start's "Natural Body Lotion" showed blue cologne bottles tagged "perfume,
 * bottle, lotion". Turned down among a product's first tags unless the
 * product or the brief is a fragrance.
 */
const FRAGRANCE_BOTTLES = new Set(
  ['perfume', 'perfumes', 'perfumery', 'cologne', 'colognes', 'parfum', 'eau', 'atomizer', 'fragrance'].map(
    aiStockStem,
  ),
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
    // "cbd" and "cannabinoid": a hemp cream tube was the next "body lotion" answer (Tidewater, 2026-10-11).
    words: ['cigarette', 'smoking', 'tobacco', 'cannabis', 'marijuana', 'drug', 'drugs', 'cbd', 'cannabinoid', 'thc'],
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
  /** The word a product's search adds where its subject lacks it; none where the subject is enough. */
  qualifier?: string
  /** Whether the qualifier follows the subject: "bath gift set soap". */
  after?: boolean
  kin: readonly string[]
  queries: readonly string[]
  /** Words a photo of the object never carries unless the product names them: a pump for a bar of soap. */
  shun?: readonly string[]
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
  {
    // A "bar" is a pub's before it is a soap's (the Saltmarsh "cold-process
    // soap bar" search answered a pint of beer second): a soap bar is named
    // by soap, and searched by it.
    objects: ['bar'],
    within: ['soap', 'soapmaker', 'skincare'],
    qualifier: 'soap',
    kin: [
      'soap bar',
      'soap bars',
      'bar of soap',
      'bars of soap',
      'soap',
      'soaps',
      'handmade soap',
      'soap block',
      'soap cubes',
    ],
    queries: ['soap bars', 'handmade soap bar'],
    // A bar is never a pump or a liquid soap (the beta.242 Tidewater start).
    shun: ['pump', 'pumps', 'liquid', 'dispenser', 'dispensers'],
  },
  {
    // "Bath" in "bath gift set", "bath bomb" or "bath salts" is what the
    // products are for, never the room: the beta.242 Tidewater Soap Works
    // start (2026-10-11) put a wooden sauna under "Bath Gift Set", its tags
    // "sauna, steam, bath". A bath set is named by soap and bath products,
    // and searched with soap.
    objects: ['bath'],
    within: ['soap', 'soapmaker', 'skincare', 'spa', 'cosmetic'],
    qualifier: 'soap',
    after: true,
    kin: [
      'soap',
      'soaps',
      'soap bar',
      'soap bars',
      'handmade soap',
      'bath bomb',
      'bath bombs',
      'bath salt',
      'bath salts',
      'bath product',
      'bath products',
      'bath set',
      'toiletries',
    ],
    queries: ['soap gift set', 'bath products', 'bath bombs'],
    shun: ['pump', 'pumps', 'liquid', 'dispenser', 'dispensers'],
  },
  {
    // A lotion is any cream for the skin; a perfume bottle tagged "lotion"
    // is not one (the same start's "Natural Body Lotion" showed colognes).
    objects: ['lotion', 'moisturizer', 'moisturiser'],
    within: ['soap', 'soapmaker', 'skincare', 'lotion', 'cosmetic', 'beauty', 'spa'],
    kin: [
      'lotion',
      'lotions',
      'body lotion',
      'hand lotion',
      'cream',
      'creams',
      'hand cream',
      'body cream',
      'skin cream',
      'face cream',
      'cream jar',
      'body butter',
      'moisturizer',
      'moisturiser',
    ],
    queries: ['body lotion', 'hand cream', 'cream jar', 'moisturizer'],
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
  /**
   * Words no photo of this craft carries unless the slot or the brief names
   * them (AGL-3660): the beta.242 Tidewater start put a black soap dispenser
   * under "Bath Gift Set Starter Size", let in as a rival because its tags
   * also said "cosmetics".
   */
  shun?: readonly string[]
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
    // Never "natural": a florist's bouquet tagged "natural" was the
    // Saltmarsh Soap Co hero (2026-10-10).
    kin: ['soap', 'skincare', 'lotion', 'cream', 'bath', 'spa', 'cosmetic'],
    broad: ['handmade soap', 'natural skincare'],
    // "Soap making" is answered with soap bubbles; a bar is what a soapmaker makes.
    making: ['soap making', 'handmade soap'],
    // Soap bubbles, a dispenser and detergent are soap, never a soapmaker's:
    // the same start's story band showed bubbles in flight.
    rivals: {
      words: ['bubble', 'bubbles', 'soapy', 'dispenser', 'detergent', 'dishwashing', 'laundry'],
      core: [
        'bar',
        'bars',
        'handmade',
        'homemade',
        'loaf',
        'lye',
        'glycerin',
        'skincare',
        'lotion',
        'cosmetic',
        'spa',
        'artisan',
      ],
    },
    shun: ['dispenser', 'dispensers'],
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
    // A caterer is named "caterer" and its photos "catering", "buffet",
    // "food": the beta.257 Copper Kettle Catering hero, held to "caterer"
    // alone, accepted none of forty hits (AGL-3831).
    match: ['caterer', 'catering', 'cater'],
    kin: [
      'catering',
      'caterer',
      'cater',
      'buffet',
      'banquet',
      'platter',
      'food',
      'meal',
      'cuisine',
    ],
    broad: ['caterer', 'catering buffet'],
    making: ['chef cooking', 'catering chef'],
    // An airline's meal cart is catering too, never a caterer's: the same
    // start's search answered a plane at Düsseldorf tagged "catering" first.
    rivals: {
      words: ['airport', 'airplane', 'plane', 'aircraft', 'aviation', 'airline', 'airfield'],
      core: [],
    },
  },
  {
    match: ['barbecue', 'barbeque', 'bbq', 'smokehouse', 'pitmaster'],
    kin: [
      'barbecue',
      'barbeque',
      'bbq',
      'grill',
      'grilled',
      'brisket',
      'smoked',
      'smoker',
      'ribs',
      'meat',
    ],
    broad: ['barbecue', 'bbq meat'],
    making: ['pitmaster', 'grilling meat'],
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
  /**
   * The stems a photo of the craft ITSELF names, one of which a hero and a
   * product's fallbacks must name (AGL-3660): the craft and, for a listed
   * craft, its own names ("soap", "soapmaker", "skincare"). Empty where the
   * site names no craft.
   */
  core: string[]
  /** Words no photo of the site's craft carries unless the slot or the brief names them ({@link CRAFT_KIN}). */
  shun: string[]
}

/** The site's terms, read from its business type. */
export function aiStockSiteTerms(businessType: string): AiStockSiteTerms {
  let business = aiStockBusinessWords(businessType)
  let craft = aiStockCraftWords(business)
  const domain = new Set<string>()
  /** The things it makes, by their head nouns. */
  const made = new Set<string>()
  /** The last word of the first clause that names the world: "soap" of "for handmade cold-process soap". */
  let firstWorld = ''
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
    const last = world[world.length - 1]
    if (!firstWorld && last) firstWorld = aiStockStem(last)
    if (making)
      for (const word of kept.slice(-1))
        for (const stem of stemList(word)) made.add(stem)
  }
  // A business named only by what it sells ("a shop selling pottery") is of that world.
  if (!domain.size) for (const stem of made) domain.add(stem)
  const groups = CRAFT_KIN.filter((group) =>
    group.match.some(
      (word) =>
        domain.has(aiStockStem(word)) ||
        made.has(aiStockStem(word)) ||
        aiStockStem(word) === craft,
    ),
  )
  // A business that is only a place ("an online shop for handmade
  // cold-process soap") takes its craft from what it is for: the Saltmarsh
  // Soap Co start (2026-10-10) read its craft as nothing, so its hero searched
  // "shop" (a florist's bouquet) and no product was held to soap.
  if (!craft) {
    const listed = groups[0]?.match
      .map(aiStockStem)
      .find((stem) => domain.has(stem) || made.has(stem))
    craft = listed || firstWorld || [...made][0] || ''
    if (craft && !stemList(business).includes(craft))
      business = `${craft} ${business}`.trim()
  }
  if (craft) domain.add(craft)
  const broad: string[] = []
  const makingSearches: string[] = []
  const rivals: Array<{ words: string[]; core: string[] }> = []
  const core = new Set<string>(craft ? [craft] : [])
  const shun = new Set<string>()
  for (const group of groups) {
    for (const word of group.shun ?? []) shun.add(aiStockStem(word))
    for (const word of group.match) core.add(aiStockStem(word))
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
    core: [...core],
    shun: [...shun],
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
  /**
   * Words of which a hit must name ONE, `requires` among them (AGL-3660): a
   * shop's category or the slot's own word of its world, so a soap shop's
   * body lotion is held to "lotion", never to "soap".
   */
  category?: readonly string[]
  /** The thing every hit must name, where it is not the subject's own: a product's head noun (AGL-3660). */
  object?: string
  /** Phrases that name the object where its own word is not enough: "wax melt" ({@link OBJECT_KIN}). */
  kin?: readonly string[]
  /** Whether the object must be among the hit's first tags, what the photo is OF (AGL-3660). */
  lead?: boolean
  /** Whether the hit's first tags must name the site's world, where the object need not lead (AGL-3660). */
  leadWorld?: boolean
  /**
   * Whether the hit's FIRST tag must name the site's world (AGL-3760): what
   * the photo is of, most of all. A hero is the site's opening picture; the
   * copper-fern-candle-co start (beta.246) took a latte with a candle behind
   * it, its tags "coffee, mobile wallpaper 4k, latte art, …, candle".
   */
  first?: boolean
  /** Phrases (as stems) of which one must be among the hit's first tags: a borrowed photo is OF the product's category (AGL-3660). */
  leadAny?: readonly string[]
  /** Whether it fills a product: no room, no scene, no fragrance bottle ({@link PRODUCT_SCENES}, AGL-3660). */
  product?: boolean
  /** Words its hits never carry unless the slot or the brief names them ({@link AiStockSiteTerms.shun}). */
  shun?: readonly string[]
  /**
   * How sure a product's search is (AGL-3660). Absent: its own photo, the
   * head noun among the first tags. `borrow`: a photo OF its category, which
   * may repeat one the job already shows. `weak`: the head noun anywhere, or
   * the category anywhere — taken only once nothing surer is left.
   */
  tier?: 'borrow' | 'weak'
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

/** What a product falls back to once its own searches find nothing ({@link aiStockProductSearches}). */
export interface AiStockProductFallback {
  /** The site's broad searches ({@link AiStockSiteTerms.broad}): "handmade soap". */
  broad?: readonly string[]
  /** The words a photo of the craft itself names ({@link AiStockSiteTerms.core}). */
  core?: readonly string[]
}

/**
 * A size never names a product (AGL-3660): the Tidewater start searched
 * "soap set starter size" for "Bath Gift Set Starter Size", its head noun
 * read as "size", and took a soap dispenser.
 */
const PRODUCT_SIZES =
  /\b(?:(?:starter|travel|trial|sample|mini|full|half|family|value|jumbo|large|small|regular|standard|big)[- ])?sized?s?\b/gi

/** The wrapper words a gift is named by, searched with the craft: "soap gift box". */
const GIFT_WRAPPERS = words('gift gifts box boxes basket baskets hamper hampers')

/**
 * A product's searches (AGL-3676), most specific first: each of its subjects
 * — its name's noun phrase, then its photo's — with the shop's category
 * where the phrase does not already name the shop's world ("candle gift
 * box"), then the category alone, a plain photo of what the shop sells. Every
 * one must find a hit naming the category — or the product's own word of the
 * shop's world, "lotion" in a soap shop — so no product is ever filled with a
 * lifestyle shot of something else: the beta.237 Willow Wick start put a
 * laptop and roses under "Candle Wick Trimmer" and an antique tea set under
 * "Candle Gift Set".
 *
 * And each must find a hit naming the product's own head noun among its
 * first tags (AGL-3660): the beta.239 Ember & Oak start put a bed with a book,
 * a mug and a camera (its candle a last tag) under "Hand-Poured Soy Candle".
 * An object whose own word is not enough ({@link OBJECT_KIN}) is searched by
 * its kin instead of the category alone, and named by them: a single taper
 * candle filled "Wax Melt Gift Set".
 *
 * Then, before a product is ever given a photo of something else, it falls
 * back to its own craft (AGL-3660). The Saltmarsh Soap Co start (2026-10-10)
 * found no hit naming "bar" or "box" among the first tags, and four of its
 * five products took the starter photos — a laptop and roses, a living room
 * of plants. And the beta.242 Tidewater Soap Works start (2026-10-11) showed
 * that the head noun anywhere is not enough: its own weak hits put a sauna
 * under "Bath Gift Set", colognes under "Natural Body Lotion", a bathroom
 * shelf under "Soap Bar Trio" and a soap dispenser under its starter size,
 * while the collection tiles beside them, searched for the category, were
 * good. So the searches are ranked by how sure they are ({@link AiStockSearch.tier}):
 *
 * 1. Its own: the head noun (or its kin) among the first tags, as above.
 * 2. `borrow`: a photo OF its category — the category alone, then the craft's
 *    broad searches ("handmade soap", "natural skincare"), one of the
 *    product's kin or the craft's own names among the first tags. A product
 *    may repeat one the job already shows, a collection tile's photo or
 *    another product's ({@link aiLayoutStockPhotoSource}): a borrowed
 *    on-topic photo beats a weak specific one.
 * 3. `weak`: the same searches again, the head noun named anywhere among the
 *    tags (no extra search: the page remembers its answers), a gift's own
 *    wrapper with the craft ("soap gift box"), and the craft's broad searches,
 *    any hit naming the craft itself ({@link AiStockSiteTerms.core}).
 *
 * Every one of them turns down a room or a scene, a fragrance bottle, and
 * what the product's kin shuns (a pump for a bar of soap), unless the
 * product names it. A size never names the product: "Bath Gift Set Starter
 * Size" is a bath gift set.
 */
export function aiStockProductSearches(
  slot: Pick<AiLayoutPictureSlot, 'aspect' | 'product'>,
  craft: string,
  domain: readonly string[] = [],
  fallback: AiStockProductFallback = {},
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size = orientation === 'vertical' ? { minHeight: 900 } : { minWidth: 900 }
  const craftStems = stemList(craft)
  const world = new Set([...domain, ...craftStems])
  const subjects = (slot.product?.subjects ?? [])
    .map((raw) => aiStockSubjectWords(raw.replace(PRODUCT_SIZES, ' '), ''))
    .filter(Boolean)
  // The product's head noun is its name's: "candle" of "Hand-Poured Soy Candle".
  const own = subjects[0] ?? ''
  const object = aiStockObjectWord(own)
  const kin = object
    ? objectKin(object, [...craftStems, ...domain, ...stemList(subjects.join(' '))])
    : null
  const kinPhrases = kinStems(kin)
  // A product of the shop's world beside its category is held to either:
  // a soap shop's body lotion names "lotion", never "soap".
  const ownWorld = stemList(own).filter(
    (stem) => world.has(stem) && !WRAPPERS.has(stem) && !craftStems.includes(stem),
  )
  const category = craft && ownWorld.length ? [...craftStems, ...ownWorld] : []
  const core = [...new Set([...craftStems, ...(fallback.core ?? [])])]
  const shun = (kin?.shun ?? []).map(aiStockStem)
  type Query = {
    query: string
    subject: string
    object: string
    lead: boolean
    broad?: boolean
    tier?: 'borrow' | 'weak'
  }
  const queries: Query[] = []
  for (const subject of subjects) {
    const stems = stemList(subject)
    const qualifier = kin?.qualifier ?? ''
    const query = kin
      ? !qualifier || stems.includes(aiStockStem(qualifier))
        ? subject
        : kin.after
          ? `${subject} ${qualifier}`
          : `${qualifier} ${subject}`
      : craft && !stems.some((stem) => world.has(stem))
        ? `${craft} ${subject}`
        : subject
    queries.push({ query, subject, object, lead: true })
  }
  // The category alone stands in only for a thing that is no more than of
  // it; a thing that is its own word of the shop's world is searched by that
  // word ("lotion"). Its hits are still scored by the product's own words: a
  // soy candle over a taper.
  if (kin)
    for (const query of kin.queries)
      queries.push({ query, subject: own || query, object, lead: true })
  else if (object && ownWorld.includes(object))
    queries.push({ query: object, subject: own, object, lead: true })
  else if (craft)
    queries.push({ query: craft, subject: own || craft, object: craft, lead: true, tier: 'borrow' })
  const held = [...queries]
  // 2. A photo OF its category, which may be one the job already shows.
  for (const query of fallback.broad ?? [])
    queries.push({ query, subject: own, object: '', lead: true, broad: true, tier: 'borrow' })
  // 3. The head noun anywhere among the tags, by the same searches.
  for (const entry of held) queries.push({ ...entry, lead: false, tier: 'weak' })
  // A gift is its craft's: "bath gift box" asks for a "soap gift box".
  const wrapped = own
    .split(/\s+/)
    .filter((word) => WRAPPERS.has(word) && aiStockStem(word) !== object)
  const gift = wrapped.find((word) => GIFT_WRAPPERS.has(word))
  if (craft && gift && !kin)
    queries.push({
      query: `${craft} ${wrapped.join(' ')}`,
      subject: own,
      object: aiStockStem(gift),
      lead: false,
      tier: 'weak',
    })
  // The craft's own broad searches, any hit naming the craft.
  for (const query of fallback.broad ?? [])
    queries.push({ query, subject: own, object: '', lead: false, broad: true, tier: 'weak' })
  // What a borrowed photo is OF: the product's kin, its own word of the shop's world, else the craft.
  const borrowed = kinPhrases.length ? kinPhrases : ownWorld.length ? ownWorld : core
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  for (const entry of queries) {
    const query = clip(entry.query)
    const key = `${query}|${entry.lead}|${entry.object}|${entry.broad === true}|${entry.tier ?? ''}`
    if (!query || seen.has(key)) continue
    seen.add(key)
    const common = {
      query,
      orientation,
      ...size,
      subject: entry.subject,
      product: true,
      ...(entry.tier ? { tier: entry.tier } : {}),
      ...(shun.length ? { shun } : {}),
    }
    if (entry.broad) {
      const heldTo = [...new Set([...core, ...ownWorld])]
      searches.push({
        ...common,
        broad: true,
        ...(entry.lead
          ? {
              leadAny: borrowed,
              ...(kinPhrases.length ? { kin: kinPhrases } : {}),
              ...(heldTo.length ? { category: heldTo } : {}),
            }
          : core.length
            ? { category: core }
            : {}),
      })
      continue
    }
    searches.push({
      ...common,
      // Named anywhere, the hit's first tags are still of the shop's world:
      // a bed with a book, its candle a last tag, is not a candle's photo.
      ...(entry.lead ? { lead: true } : { leadWorld: true }),
      ...(entry.object ? { object: entry.object } : {}),
      ...(kinPhrases.length && entry.object === object ? { kin: kinPhrases } : {}),
      ...(craft ? { requires: craft } : {}),
      ...(category.length ? { category } : {}),
    })
  }
  return searches
}

/** The searches a slot tries, in order, most specific first, each distinct. */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect'>,
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'domain' | 'broad'> &
    Partial<Pick<AiStockSiteTerms, 'making' | 'core'>>,
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
  // A tile of the shop's world beside its category is held to either: a soap
  // shop's "Body care" tile names "body", never "soap" (AGL-3660).
  const ownWorld = subjectStems.filter(
    (stem) => domain.has(stem) && !WRAPPERS.has(stem) && stem !== terms.craft,
  )
  // A hero of a craft names the craft itself: the Saltmarsh Soap Co hero
  // (2026-10-10) was a florist's bouquet tagged "natural" (AGL-3660).
  const core = terms.core ?? []
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
        ? {
            requires: terms.craft,
            ...(ownWorld.length ? { category: [terms.craft, ...ownWorld] } : {}),
          }
        : {}),
      ...(slot.role === 'hero' && core.length ? { category: core } : {}),
      // A hero is OF the site's world: its first tag names it (AGL-3760).
      ...(slot.role === 'hero' ? { first: true } : {}),
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
  /** Words of which a hit must name one, `requires` among them ({@link AiStockSearch.category}). */
  category?: readonly string[]
  /** The thing a hit must name, where it is not the subject's own (AGL-3660). */
  object?: string
  /** Phrases naming the object where its word is not enough; one of them is then required, and stands for the category. */
  kin?: readonly string[]
  /** Whether the object must be among the hit's first tags (AGL-3660). */
  lead?: boolean
  /** Whether the hit's first tags must name the site's world ({@link AiStockSearch.leadWorld}). */
  leadWorld?: boolean
  /** Whether the hit's first tag must name the site's world ({@link AiStockSearch.first}). */
  first?: boolean
  /** The stems of the site's business type or brief, which let a sensitive topic in ({@link AiStockSiteTerms.named}). */
  named?: readonly string[]
  /** Rival crafts: a hit naming one is rejected unless it names the site's core words ({@link AiStockSiteTerms.rivals}). */
  rivals?: ReadonlyArray<{ words: readonly string[]; core: readonly string[] }>
  /** Phrases of which one must be among the hit's first tags ({@link AiStockSearch.leadAny}). */
  leadAny?: readonly string[]
  /** Whether it judges for a product: no room, no scene, no fragrance bottle (AGL-3660). */
  product?: boolean
  /** Words a hit never carries unless the subject or the brief names them ({@link AiStockSiteTerms.shun}). */
  shun?: readonly string[]
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
  /** The first tag: what the photo is most of all. */
  const firstPhrase = stemList(tags[0] ?? '').join(' ')
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
  return { lead, all, phrases, leadPhrases, firstPhrase, rejected, words }
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
  const subject = stemList(judgement.subject ?? '')
  // What the slot or the brief names lets a shunned word, a room or a fragrance in.
  const owned = new Set([...subject, ...(judgement.named ?? [])])
  // A dispenser is not a soapmaker's, nor a pump a bar's (AGL-3660).
  if ((judgement.shun ?? []).some((word) => hit.all.has(word) && !owned.has(word)))
    return 0
  if (judgement.product) {
    // A sauna, a bathroom shelf: a room is never the product.
    for (const word of hit.lead)
      if (PRODUCT_SCENES.has(word) && !owned.has(word)) return 0
    // Colognes are not a lotion: a fragrance's bottle only for a fragrance.
    if (
      ![...FRAGRANCE_BOTTLES].some((word) => owned.has(word)) &&
      [...hit.lead].some((word) => FRAGRANCE_BOTTLES.has(word))
    )
      return 0
  }
  // A borrowed photo is OF the product's category.
  const leadAny = judgement.leadAny ?? []
  if (leadAny.length && !leadAny.some((phrase) => among(hit.leadPhrases, phrase)))
    return 0
  const kin = judgement.kin ?? []
  const kinNamed = kin.some((phrase) => among(hit.phrases, phrase))
  const kinLead = kin.some((phrase) => among(hit.leadPhrases, phrase))
  const required = stemList(judgement.requires ?? '')
  const category = (judgement.category ?? []).flatMap(stemList)
  const anyOf = category.length ? [...new Set([...required, ...category])] : []
  const demanded = required.length > 0 || anyOf.length > 0
  const meets = anyOf.length
    ? anyOf.some((stem) => hit.all.has(stem))
    : required.every((stem) => hit.all.has(stem))
  // An object's kin stands for the category: a wax melt is the candle shop's.
  if (demanded && !kinNamed && !meets) return 0
  const object =
    judgement.object ??
    (judgement.subject ? aiStockObjectWord(judgement.subject) : '')
  const domain = (judgement.domain ?? []).filter((stem) => stem !== object)
  // A hit naming the word it must name is of the site's world: a product's
  // category is that world even where it is the product's own object.
  const world =
    demanded || kinNamed || domain.some((stem) => hit.all.has(stem))
  const worldLead =
    (anyOf.length
      ? anyOf.some((stem) => hit.lead.has(stem))
      : required.length > 0 && required.every((stem) => hit.lead.has(stem))) ||
    kinLead ||
    domain.some((stem) => hit.lead.has(stem))
  if (judgement.leadWorld && !worldLead) return 0
  // The first tag alone, never the page's address: Pixabay's slug repeats a
  // late tag ("coffee-latte-art-candle-…"). A site whose words name no world
  // holds its hero to none.
  const worldStems = new Set([...anyOf, ...required, ...domain])
  if (judgement.first && (worldStems.size || kin.length)) {
    const firstWorld =
      hit.firstPhrase.split(' ').some((stem) => worldStems.has(stem)) ||
      kin.some((phrase) => among([hit.firstPhrase], phrase))
    if (!firstWorld) return 0
  }
  // What the photo is most of all: its first tag names the object, its kin or what it must be OF.
  const firstNamed = (phrases: readonly string[]) =>
    phrases.some((phrase) => Boolean(phrase) && among([hit.firstPhrase], phrase))
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
    if (firstNamed(kin.length ? kin : [object])) score += 1
  } else if (domain.length) {
    if (!world) return 0
  }
  if (leadAny.length && firstNamed(leadAny)) score += 1
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

/** The longest description of a photo written from the library's own words. */
const AI_STOCK_ALT_MAX = 160

/**
 * THE WORDS A PLACED STOCK PHOTO IS DESCRIBED BY (AGL-3805).
 *
 * A slot's alt text is the model's, written for the picture the page asked
 * for before any photo was found, and a slot is filled by whatever the
 * library answers for its search: a hero searched by the business, a gallery
 * picture by its subject, a site in another language by English words alone.
 * Kept as written, it described a photo the page does not show: the beta.253
 * Panadería La Concha Dorada start (job eg4maZMGtN) captioned a round cake
 * dusted "HOME MADE" on a cloth "Conchas recién horneadas sobre una charola en
 * el mostrador de la panadería", and none of its nine photos showed what its
 * words said: a birthday cake with candles was "the family kneading pan
 * dulce", a plate of macarons the shop's display case.
 *
 * So the photo placed answers for its own words. `null` keeps the slot's: on
 * an English site whose words name what the photo is OF — a word of their
 * subject (`aiStockSubjectWords`: the noun phrase they open with, before any
 * setting) among the hit's first tags or its page's address, so "conchas on
 * a tray at the bakery counter" is never kept for a loaf tagged "bakery".
 * Otherwise the photo is described by the
 * library's own words: its description where it writes one (a Pexels hit's
 * `alt`), else its first tags, the things it shows. The libraries write in
 * English, and no model translates them, so a site in another language takes
 * the platform's own words for an illustrative photo in its language
 * (`aiLayoutLabel`), true of any photo, as does a hit with no words at all.
 */
export function aiStockPhotoAlt(
  photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>,
  slot: Pick<AiLayoutPictureSlot, 'alt' | 'product'>,
  input: { language?: string; sectionName?: string } = {},
): string | null {
  if (aiLayoutSpeaksOtherThanEnglish(input.language)) return aiLayoutLabel('illustrativePhoto', input.language)
  const { lead } = hitWords(photo)
  const named = [slot.alt, ...(slot.product?.subjects ?? [])].flatMap((words) =>
    stemList(aiStockSubjectWords(words, input.sectionName ?? '')),
  )
  if (named.some((word) => lead.has(word))) return null
  const own = (photo.alt ?? '').replace(/\s+/g, ' ').trim()
  if (own) return own.length > AI_STOCK_ALT_MAX ? `${own.slice(0, AI_STOCK_ALT_MAX).replace(/\s+\S*$/, '')}…` : own
  const tags = [...new Set((photo.tags ?? []).map((tag) => tag.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))].slice(0, 3)
  if (!tags.length) return aiLayoutLabel('illustrativePhoto', input.language)
  const said = tags.join(', ')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`
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
  /** The site's language, from its plan (AGL-3750); absent, English. */
  language?: string
  /**
   * The plan's photo words, in English (AGL-3760): what a site in another
   * language is searched by, in place of its business type and its alt texts,
   * unless its business type names a business listed in English
   * (`aiStockBusinessNoun`, AGL-3779), which leads.
   */
  photoWords?: string
  /**
   * The English name of the kind of site the person picked (AGL-3771): what a
   * site in another language is searched by when its business type names no
   * business listed in English (`aiStockBusinessNoun`, AGL-3779) and its plan
   * gave no photo words, rather than its business type in its own language.
   */
  kindWords?: string
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
  /** A photo another slot of the job already shows, reused rather than an off-topic one (AGL-3660). */
  repeat?: boolean
}

/**
 * A job's language and English photo words (AGL-3760), and the English name
 * of its kind of site (AGL-3771), as a stock photo source takes them.
 */
export function aiStockPhotoWordsOf(job: {
  plan?: Pick<AiBuildPlan, 'language' | 'photoWords'> | null
  inputs?: Readonly<Record<string, unknown>> | null
}): Pick<AiLayoutStockPhotoSourceInput, 'language' | 'photoWords' | 'kindWords'> {
  const plan = job.plan
  const kind = job.inputs ? aiSiteKindOfInputs(job.inputs) : null
  // "Restaurant & café" searches as "restaurant cafe".
  const kindWords = kind ? kind.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : ''
  return {
    ...(plan?.language ? { language: plan.language } : {}),
    ...(plan?.photoWords ? { photoWords: plan.photoWords } : {}),
    ...(kindWords ? { kindWords } : {}),
  }
}

/**
 * The subject a plan's photo words lead with (AGL-3769): its first word that
 * is not filler, with the place or person words that follow it — "bakery" of
 * "bakery pan dulce conchas", "candle shop" of "candle shop soy candles",
 * "ceramic artist" of "ceramic artist stoneware bowls". The words are subject
 * first, never an English noun phrase with its head last, and what follows
 * the subject may be the brief's own names in English letters: Panaderia La
 * Espiga Dorada's "pan dulce conchas" read as the business, made "concha" its
 * craft, and placed purple ceanothus flowers, tagged "ceanothus concha", as
 * its hero. Empty when every word is filler.
 */
export function aiStockPhotoWordsSubject(photoWords: string): string {
  const list = contentWords(photoWords)
  const start = list.findIndex((word) => !FILLER.has(word) && !SITE_KINDS.has(word))
  if (start < 0) return ''
  let end = start + 1
  while (end < list.length && (VENUES.has(list[end]) || ROLES.has(list[end]))) end += 1
  return list.slice(start, end).join(' ')
}

/**
 * What a source's photos are searched and judged by (AGL-3760, AGL-3769): a
 * site in another language by an English subject ({@link aiStockSourceSubject}:
 * its business named in English, else its plan's photo words' subject, else
 * its kind of site), every other site by its business type. One reading for
 * every slot of every source — hero, background, gallery, card, product,
 * post — so no slot searches by words another slot is held against.
 */
export function aiStockSourceTerms(
  input: Pick<AiLayoutStockPhotoSourceInput, 'business' | 'language' | 'photoWords' | 'kindWords'>,
): AiStockSiteTerms {
  return aiStockSiteTerms(aiStockSourceSubject(input) || input.business)
}

/**
 * What a site in another language is searched by ({@link aiStockSourceTerms}),
 * in this order (AGL-3779):
 *
 * 1. The English name of the business its type names, where the curated table
 *    knows it ({@link aiStockBusinessNoun}): "florist" for "Una floristería en
 *    Sevilla". It leads whatever the plan's photo words say, because the words
 *    are the model's and the table is not: a live plan for that florist gave
 *    "wedding bouquets event flowers", whose subject, "wedding", would have
 *    searched every slot, its hero included, by weddings.
 * 2. Its photo words' subject (AGL-3760, AGL-3769), for a business the table
 *    does not list.
 * 3. The English name of its kind of site (AGL-3771), where the plan gave
 *    none. Panaderia El Trigal's pages searched "con pan dulce" and placed the
 *    Río Dulce; searched by its kind, a bakery's hero took a coffee mug
 *    ("restaurant cafe"), which is why it comes last.
 *
 * The photo words' other words were never searched by (AGL-3769), so a site
 * the table names is searched by its name alone. Empty for every other site.
 */
function aiStockSourceSubject(
  input: Pick<AiLayoutStockPhotoSourceInput, 'business' | 'language' | 'photoWords' | 'kindWords'>,
): string {
  if (!aiLayoutSpeaksOtherThanEnglish(input.language)) return ''
  return (
    aiStockBusinessNoun(input.business) ||
    aiStockPhotoWordsSubject(input.photoWords ?? '') ||
    (input.kindWords ?? '').trim()
  )
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
  // The libraries are tagged in English (AGL-3760). A Spanish bakery's type,
  // "Una panadería familiar de San Antonio con pan dulce…", read as the
  // business "con pan dulce", and its hero searched that and placed the Río
  // Dulce at dusk; a site in another language is searched by its plan's
  // English photo words' subject ({@link aiStockSourceTerms}), and its slots'
  // alt texts, in its own language, name no subject a search could use.
  const english = aiStockSourceSubject(input)
  const terms = aiStockSourceTerms(input)
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
    /** Whether the library answered any search of this page: a slot left empty then found nothing fitting. */
    let answered = false
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
      delete (request as AiStockSearch).leadWorld
      delete (request as AiStockSearch).first
      delete (request as AiStockSearch).category
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
        .then((found) => {
          if (found) answered = true
          return found?.photos ?? []
        })
        .catch(() => [] as StockPhoto[])
      answers.set(key, asked)
      return asked
    }
    /** The photo's own words where the slot's do not describe it ({@link aiStockPhotoAlt}). */
    const altFor = (photo: StockPhoto, slot: AiLayoutPictureSlot) =>
      aiStockPhotoAlt(photo, slot, {
        ...(input.language ? { language: input.language } : {}),
        sectionName: input.sectionNames[slot.sectionIndex] ?? '',
      })
    /** The photo placed in the site's library, a copy it holds or a new one; `null` when it cannot be placed. */
    const keep = async (
      photo: StockPhoto,
      slot: AiLayoutPictureSlot,
      query: string,
      repeat = false,
    ): Promise<AiLayoutPicturePhoto | null> => {
      const sourceKey = stockPhotoSourceKey(photo)
      const alt = altFor(photo, slot)
      const described = alt === null ? {} : { alt }
      try {
        const kept = await ingest.findStockPhoto({
          hostId: input.hostId,
          sourceKey,
        })
        if (kept) {
          // Held because a slot of this page or another page of the job shows it.
          if (!repeat && (placedSrcs.has(kept.src) || elsewhere(kept.src)))
            return null
          remember(sourceKey, kept.src)
          return {
            src: kept.src,
            width: kept.width ?? photo.width,
            height: kept.height ?? photo.height,
            ...described,
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
          alt: alt ?? slot.alt,
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
            ...described,
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

    /** How a search's hits are judged for a slot. */
    const judgementFor = (
      slot: AiLayoutPictureSlot,
      request: AiStockSearch,
      subject: string,
    ): AiStockJudgement => ({
      subject: request.subject ?? (request.broad ? '' : subject),
      domain: terms.domain,
      strict:
        (slot.role === 'gallery' && !request.broad) || !!request.requires,
      named: terms.named,
      rivals: terms.rivals,
      ...(terms.shun.length || request.shun?.length
        ? { shun: [...new Set([...terms.shun, ...(request.shun ?? [])])] }
        : {}),
      ...(request.product ? { product: true } : {}),
      ...(request.leadAny?.length ? { leadAny: request.leadAny } : {}),
      ...(request.requires ? { requires: request.requires } : {}),
      ...(request.category ? { category: request.category } : {}),
      ...(request.object ? { object: request.object } : {}),
      ...(request.kin ? { kin: request.kin } : {}),
      ...(request.lead ? { lead: true } : {}),
      ...(request.leadWorld ? { leadWorld: true } : {}),
      ...(request.first ? { first: true } : {}),
    })
    /**
     * The craft's own photos, the last thing a slot of a craft's site is
     * filled from (AGL-3660): its broad searches, any hit naming the craft
     * itself. Never a desk, a laptop or a living room for a soap shop.
     */
    const craftSearches = (slot: AiLayoutPictureSlot): AiStockSearch[] => {
      if (!terms.core.length) return []
      const orientation = aiStockOrientation(slot.aspect)
      const size =
        slot.role === 'hero'
          ? { minWidth: 1600 }
          : orientation === 'vertical'
            ? { minHeight: 900 }
            : { minWidth: 900 }
      return terms.broad.map((query) => ({
        query: clip(query),
        orientation,
        ...size,
        broad: true,
        category: terms.core,
        ...(slot.role === 'hero' ? { first: true } : {}),
        ...(slot.product ? { product: true, tier: 'weak' as const } : {}),
      }))
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
      const subject = english ? '' : aiStockSubjectWords(slot.alt, sectionName)
      let choice: AiStockChoice | null = null
      const requests = [
        ...(slot.product
          ? aiStockProductSearches(slot, terms.craft, terms.domain, {
              broad: terms.broad,
              core: terms.core,
            })
          : aiStockSearchesFor(
              slot,
              terms,
              subject,
              aiStockSlotPart(slot, sectionName),
            )),
        ...craftSearches(slot),
      ]
      /** The slot's accepted hits for a search; `null` once the page's searches are spent. */
      const accepted = async (
        request: AiStockSearch,
        repeat: boolean,
      ): Promise<StockPhoto[] | null> => {
        const found = await search(request)
        if (found === null) return null
        const blocked = new Set<string>()
        if (!repeat) {
          for (const key of claimed) blocked.add(key)
          for (const hit of found) {
            const key = stockPhotoSourceKey(hit)
            if (elsewhere(key)) blocked.add(key)
          }
        }
        return aiStockRank(
          found,
          blocked,
          `${input.seed}:${index}:${request.query}`,
          judgementFor(slot, request, subject),
        )
      }
      /** The first of these searches with a hit to take: a new one, or one the job already shows. */
      const choose = async (
        tried: readonly AiStockSearch[],
        repeat: boolean,
      ): Promise<AiStockChoice | null> => {
        for (const request of tried) {
          if (signal.aborted) return null
          // Spent searches answer nothing; those already asked still answer from memory.
          const ranked = await accepted(request, repeat)
          if (!ranked?.length) continue
          if (!repeat) claimed.add(stockPhotoSourceKey(ranked[0] as StockPhoto))
          return {
            candidates: ranked.slice(0, AI_LAYOUT_STOCK_TRIES_PER_SLOT),
            query: request.query,
            ...(repeat ? { repeat: true } : {}),
          }
        }
        return null
      }
      // 2. Nothing new of its own: a product or a hero reuses an on-topic
      //    photo another slot of the job already shows (a product may repeat
      //    a collection tile's photo, or another product's) before the
      //    starters' desk or living room fills it (AGL-3660). Any other
      //    picture keeps "never twice". A product goes by how sure each
      //    search is: its own and its category's photos, new and then
      //    repeated, before a weak hit of its own (the Tidewater sauna).
      const repeats = Boolean(slot.product) || slot.role === 'hero'
      const sure = slot.product
        ? requests.filter((request) => request.tier !== 'weak')
        : requests
      const unsure = slot.product
        ? requests.filter((request) => request.tier === 'weak')
        : []
      const phases: Array<[readonly AiStockSearch[], boolean]> = [
        [sure, false],
        ...(repeats ? [[sure, true] as [readonly AiStockSearch[], boolean]] : []),
        ...(unsure.length
          ? [
              [unsure, false] as [readonly AiStockSearch[], boolean],
              [unsure, true] as [readonly AiStockSearch[], boolean],
            ]
          : []),
      ]
      for (const [tried, repeat] of phases) {
        if (choice || signal.aborted) break
        choice = await choose(tried, repeat)
      }
      choices.push(choice)
    }

    // 3. Keep, a few at a time; a copy that fails tries the slot's next
    //    accepted hit no other slot has claimed. A repeat waits for the
    //    slot it repeats, so the library never holds a photo twice.
    const photos: Array<AiLayoutPicturePhoto | null> = slots.map(() => null)
    /** What this pass placed, by source key. */
    const placedByKey = new Map<string, AiLayoutPicturePhoto>()
    const fill = async (index: number) => {
      const choice = choices[index]
      const slot = slots[index]
      if (!choice || !slot) return
      for (const [rank, candidate] of choice.candidates.entries()) {
        if (signal.aborted) return
        const key = stockPhotoSourceKey(candidate)
        if (choice.repeat) {
          // Placed for another slot, it is described for this one.
          const shown = placedByKey.get(key)
          const alt = shown ? altFor(candidate, slot) : null
          const placed = shown
            ? { src: shown.src, width: shown.width, height: shown.height, ...(alt === null ? {} : { alt }) }
            : await keep(candidate, slot, choice.query, true)
          if (placed) {
            photos[index] = placed
            return
          }
          continue
        }
        if (rank > 0) {
          if (claimed.has(key)) continue
          claimed.add(key)
        }
        const placed = await keep(candidate, slot, choice.query)
        if (placed) {
          placedByKey.set(key, placed)
          photos[index] = placed
          return
        }
      }
    }
    const firsts = slots
      .map((_slot, index) => index)
      .filter((index) => !choices[index]?.repeat)
    let next = 0
    const worker = async () => {
      while (next < firsts.length) {
        const index = firsts[next] as number
        next += 1
        await fill(index)
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(AI_LAYOUT_STOCK_COPIES_AT_ONCE, firsts.length) },
        worker,
      ),
    )
    for (const [index, choice] of choices.entries())
      if (choice?.repeat) await fill(index)
    // The library answered and nothing in it fits: no photo rather than a
    // starter that shows another business (AGL-3831). A library that never
    // answered, or a site that refused to store, leaves the starters.
    return answered && storing
      ? photos.map((photo) => photo ?? AI_LAYOUT_NO_PHOTO)
      : photos
  }
}
