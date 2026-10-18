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
import { aiSiteKind, aiSiteKindOfInputs } from '../model/ai-site-kinds'
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
 * 8. **What the photo is OF** (the beta.259 starts, AGL-3856: a typewriter
 *    printing "terms of service" as a family law firm's hero, a yoga pose on
 *    a beach and a heart-shaped potato as a strength gym's events, a horse's
 *    head of a "western film" as a photographer's "Film" card). A listed
 *    craft may name what its photos are never OF among their first tags
 *    (`shunLead`: a document for a law practice, yoga for a strength gym) and
 *    its rival worlds (a movie's for a photographer's film); a comma after a
 *    place goes on naming the place ("Columbus, Ohio"), never the world; an
 *    event's or a lesson's word ("basics", "class", "session") is never its
 *    object; a word the table does not list beside a craft it does
 *    ("wedding" of "a wedding and portrait photographer") is not the craft;
 *    and a hero whose second tag names the world too leads one whose first
 *    alone does.
 * 9. **A world from the name** (the beta.261 Synchronicity Gym start,
 *    AGL-3856: its business type "a local service business" named no world,
 *    so its hero searched nothing and was left a black scrim, and its
 *    closing band's "Ready to train" took a subway train). A business type
 *    that names no world takes the craft its name, else its audience, names
 *    where this module lists it ("gym" of "Synchronicity Gym"); and a
 *    training word's other senses (a railway's train, an elevator's lift, a
 *    newspaper's press, a boat's row) never fill a gym's picture.
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
 * The media library's refusals that are about ONE photo's own bytes, as the
 * console's `ingestMedia` returns them (AGL-3923): 415 for a type or contents
 * it does not accept, 413 for a photo too large to store, 451 for a file
 * held in quarantine. The slot then tries its next hit, and the page goes on
 * storing. Every other refusal (403 from the storage band, the site's scope
 * or a lockdown; 500) holds for the whole page.
 */
export const AI_STOCK_PHOTO_OWN_REFUSALS: ReadonlySet<number> = new Set([413, 415, 451])

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
  /(?<![\w-])(?:makes?|making|made|sells?|selling|sold|offers?|offering|creates?|creating|specializ(?:es|ing)|specialis(?:es|ing)|provides?|providing|featuring|showcasing|shoots?|shooting)(?![\w-])/g

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
    'series range line group lot bunch ' +
    // What an event or a lesson is, never what it shows (AGL-3856): "Intro to
    // barbell basics" is of a barbell, "Small-group strength class" of strength.
    'class classes session sessions lesson lessons course courses workshop workshops seminar seminars ' +
    'meetup meetups program programs programme programmes basics intro introduction fundamentals',
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
  /**
   * Words that, among a hit's FIRST tags, say the photo is of something other
   * than the craft's world, however its later tags name it (AGL-3856): the
   * beta.259 Hartwell Reyes Family Law hero was a typewriter printing "terms
   * of service", tagged "law, general terms and conditions, attorney". Turned
   * down unless the slot or the brief names them.
   */
  shunLead?: readonly string[]
  /**
   * Whether its pictures are of people at a moment and a place, searched by
   * them ({@link aiStockScene}): a photographer's "Mountain Wedding Day" is a
   * couple in the mountains, never a close-up of roses (AGL-3856).
   */
  scenes?: boolean
  /**
   * The maker and their tools, which a record of the work is never OF unless
   * it names them (AGL-3856): a photographer's "Mountain Elopements" is never
   * a press photographer, nor a camera.
   */
  maker?: readonly string[]
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
  {
    // A law practice is its people and its office: never a document, a
    // statute or a statue of justice (the beta.259 Hartwell Reyes hero).
    match: ['law', 'legal', 'lawyer', 'attorney', 'solicitor', 'barrister', 'paralegal', 'notary'],
    kin: ['law', 'legal', 'lawyer', 'attorney', 'counsel', 'office', 'client', 'consultation', 'meeting', 'advice', 'mediation'],
    broad: ['lawyer office', 'lawyer client meeting'],
    making: ['lawyer meeting client', 'lawyer office'],
    // Policing is not a family firm's; a statue of justice is a symbol, not its people.
    shun: ['police', 'policeman', 'cop', 'handcuffs', 'prisoner', 'arrest', 'crime', 'criminal', 'justitia', 'themis', 'goddess'],
    shunLead: [
      'term',
      'condition',
      'paragraph',
      'codex',
      'regulation',
      'statute',
      'document',
      'contract',
      'typewriter',
      'constitution',
      'certificate',
    ],
  },
  {
    // A strength gym's photos are of lifting and training; a yoga pose on a
    // beach is tagged "strength" too (the beta.259 Ironline Strength Studio
    // events).
    match: ['gym', 'fitness', 'strength', 'barbell', 'crossfit', 'weightlifting', 'powerlifting', 'bodybuilding', 'kettlebell'],
    kin: [
      'gym',
      'fitness',
      'workout',
      'training',
      'exercise',
      'barbell',
      'dumbbell',
      'weight',
      'weightlifting',
      'deadlift',
      'squat',
      'kettlebell',
      'athlete',
      'strength',
      'muscle',
    ],
    broad: ['gym', 'weight training'],
    making: ['coach training athlete', 'barbell training'],
    shunLead: [
      'yoga', 'pilates', 'meditation', 'ballet', 'ballerina', 'dance', 'dancer', 'karate', 'kickboxing', 'boxing', 'boxer', 'beach', 'circus',
      // Another sport's ball, never "medicine ball": a basketball court covered a deadlift night (AGL-3864),
      // a cricket ball on a wooden court another (AGL-3856).
      'basketball', 'football', 'soccer', 'baseball', 'volleyball', 'tennis', 'golf', 'rugby', 'hockey',
      'cricket', 'squash', 'badminton', 'shuttlecock', 'bowling', 'billiards', 'snooker', 'pool', 'lacrosse', 'softball',
      'handball', 'pingpong', 'pong',
    ],
    // A training word's other senses (AGL-3856): "train" is a railway's, "lift"
    // an elevator's or a ski lift's, "press" a newspaper's, "row" a boat's. The
    // beta.261 Synchronicity Gym's closing band, "Ready to train", took a
    // subway train at a station.
    shun: [
      'railway', 'railroad', 'rail', 'locomotive', 'subway', 'metro', 'tram', 'tramway', 'commuter', 'freight',
      'transport', 'transportation', 'traffic', 'vehicle', 'bus', 'truck', 'airplane', 'aircraft',
      'elevator', 'escalator', 'chairlift', 'forklift', 'crane',
      'newspaper', 'journalism', 'journalist', 'printing',
      'boat', 'ship', 'canoe', 'kayak', 'sailboat',
    ],
  },
  {
    // A photographer's own photos are of a camera or a shoot; "film" is a
    // movie's word too, and "western film" a horse (the beta.259 Juniper and
    // Rye Photography "Film" card).
    match: ['photographer', 'photography', 'photo', 'photograph'],
    scenes: true,
    maker: ['photographer', 'photographers', 'camera', 'cameras', 'lens', 'lenses', 'tripod', 'dslr', 'slr', 'journalist', 'paparazzi'],
    kin: ['photographer', 'photography', 'photo', 'photograph', 'photoshoot', 'camera', 'lens'],
    broad: ['photographer camera', 'photography'],
    making: ['photographer at work', 'photographer camera'],
    rivals: {
      words: ['movie', 'cinema', 'cinematography', 'filmmaking', 'filming', 'videography', 'video', 'actor', 'projector', 'hollywood', 'western'],
      core: ['camera', 'photograph', 'photography', 'photographer', 'photo', 'photoshoot', 'analog'],
    },
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
  /** Whether a picture naming people at a moment is searched by its scene ({@link aiStockScene}, AGL-3856). */
  scenes?: boolean
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
  /** Words no photo of the site's craft is OF, among its first tags, unless the slot or the brief names them ({@link CRAFT_KIN}). */
  shunLead: string[]
  /** Whether the site is for adults alone, so no photo of a child is placed on it ({@link aiStockAdultsOnly}, AGL-3856). */
  adults?: boolean
  /** Where the site's own words set its pictures ({@link aiStockSetting}): a record's moment is set there where its words say nowhere (AGL-3856). */
  setting?: string
  /** The craft's maker and tools as stems, which a record of its work never leads with ({@link CRAFT_KIN}, AGL-3856). */
  maker?: string[]
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
  let place = false
  for (const { opener, words: clause } of businessClauses(businessType)) {
    if (opener === '|') making = true
    // Where it is, and who it is for, are not its world — once something has named it.
    if (named && PLACE_OR_AUDIENCE.test(opener)) {
      making = false
      place = true
      continue
    }
    // A comma goes on naming the place (AGL-3856): "Ohio" of "in Columbus,
    // Ohio" and "North Carolina" of "in Asheville, North Carolina" are not
    // the business's world.
    if (place && opener === ',') continue
    place = false
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
  } else if (groups[0] && !groups.some((group) => group.match.some((word) => aiStockStem(word) === craft))) {
    // A word the table does not list, beside a craft it does, says what kind
    // of that craft it is (AGL-3856): "wedding" of "a wedding and portrait
    // photographer" is a photographer's subject, never a craft to search by.
    craft =
      groups[0].match.map(aiStockStem).find((stem) => domain.has(stem) || made.has(stem)) ?? craft
  }
  if (craft) domain.add(craft)
  const broad: string[] = []
  const makingSearches: string[] = []
  const rivals: Array<{ words: string[]; core: string[] }> = []
  const core = new Set<string>(craft ? [craft] : [])
  const shun = new Set<string>()
  const shunLead = new Set<string>()
  for (const group of groups) {
    for (const word of group.shun ?? []) shun.add(aiStockStem(word))
    for (const word of group.shunLead ?? []) shunLead.add(aiStockStem(word))
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
    ...(groups.some((group) => group.scenes) ? { scenes: true } : {}),
    ...(groups.some((group) => group.maker?.length)
      ? { maker: [...new Set(groups.flatMap((group) => group.maker ?? []).map(aiStockStem))] }
      : {}),
    named: [...new Set(stemList(businessType))],
    rivals,
    core: [...core],
    shun: [...shun],
    shunLead: [...shunLead],
  }
}

/**
 * Words that say a picture is one of a set, never what it shows (AGL-3923):
 * the beta.266 Mexicano portfolio's gallery was "Project one" to "Project
 * four", and searched "project" (students at a whiteboard), "project four"
 * (lavender) and "four" (a running track's lane numbers).
 */
const PLACEHOLDER_SUBJECTS = words(
  'project projects piece pieces item items example examples sample samples entry entries untitled work works ' +
    'selected recent latest ' +
    'four five six seven eight nine ten first second third fourth fifth sixth seventh eighth ninth tenth',
)

/** A phrase's content words without its filler; all filler, and nothing is left. */
function subjectOf(list: readonly string[]): string[] {
  return list.filter((word) => !FILLER.has(word) && !PLACEHOLDER_SUBJECTS.has(word))
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
  /** Whether its hits must name its object, whatever the slot's role: a scene's people (AGL-3856). */
  strict?: boolean
  /** Words its hits never carry, whatever the brief names: a bride in a family session ({@link aiStockScene}). */
  refuse?: readonly string[]
  /** Stems of which every hit names one, whatever else it names: a scene's people, never roses alone ({@link aiStockScene}). */
  needs?: readonly string[]
  /** Stems its own words name, which let a topic in as the brief's do: a family session's children ({@link aiStockScene}). */
  allow?: readonly string[]
  /** Stems no hit's first tags carry: a photographer or a camera on a portfolio's record, a toy frog ({@link aiStockRecordScene}, AGL-3856). */
  refuseLead?: readonly string[]
  /** Whether its hits are held to no world of the site's: a portfolio's record is of its subject, never of the craft (AGL-3856). */
  worldless?: boolean
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

/**
 * The people a picture of a moment shows (AGL-3856): what its words name, the
 * search that asks for them, the words a photo of them leads with, those of
 * which it must name one anywhere, and what it never carries unless the
 * words name it. A family session is never a bride.
 */
const PEOPLE_SCENES: ReadonlyArray<{
  words: readonly string[]
  query: (named: ReadonlySet<string>) => string
  subject: string
  lead: readonly string[]
  people: readonly string[]
  shun: readonly string[]
}> = [
  {
    words: ['family', 'families', 'kid', 'kids', 'child', 'children', 'newborn', 'baby', 'parent', 'parents', 'mother', 'father'],
    query: () => 'family',
    subject: 'family',
    lead: ['family', 'families', 'child', 'children', 'kid', 'kids', 'mother', 'father', 'parents', 'mom', 'dad', 'daughter', 'son', 'baby', 'toddler'],
    people: ['family', 'child', 'children', 'kid', 'kids', 'mother', 'father', 'parent', 'parents', 'daughter', 'son', 'baby', 'toddler', 'mom', 'dad'],
    shun: ['bride', 'groom', 'bridal', 'wedding', 'newlywed', 'newlyweds', 'marriage'],
  },
  {
    words: [
      'wedding', 'weddings', 'elopement', 'elopements', 'elope', 'eloping', 'bride', 'brides', 'bridal', 'groom', 'engagement',
      'engaged', 'couple', 'couples', 'newlywed', 'newlyweds', 'honeymoon', 'ceremony', 'ceremonies', 'reception', 'receptions', 'vows',
    ],
    query: (named) => (['wedding', 'weddings', 'bride', 'bridal', 'groom'].some((word) => named.has(word)) ? 'wedding couple' : 'couple'),
    subject: 'couple',
    lead: ['couple', 'couples', 'bride', 'groom', 'wedding', 'newlyweds', 'lovers', 'elopement', 'bride and groom'],
    people: ['couple', 'bride', 'groom', 'newlywed', 'newlyweds', 'lovers', 'husband', 'wife', 'man', 'woman'],
    shun: [],
  },
]

/**
 * A portrait session (AGL-3856), read for a record's cover alone: "Milestone
 * Portraits" is a person's portrait, never a cat's. A page's "portrait of the
 * photographer" keeps its own words.
 */
const PORTRAIT_SCENE: (typeof PEOPLE_SCENES)[number] = {
  words: ['portrait', 'portraits', 'headshot', 'headshots'],
  query: () => 'portrait',
  subject: 'portrait',
  lead: ['portrait', 'woman', 'man', 'couple', 'person', 'people'],
  people: ['woman', 'women', 'man', 'men', 'couple', 'person', 'people', 'bride', 'groom', 'mother', 'father', 'family'],
  shun: [],
}

/**
 * Words a photo of a child is tagged with (AGL-3856), as stems. Pixabay tags
 * a schoolgirl "girl", "schoolgirl" or "school girl" far more often than
 * "child", so a site for adults that names a school let children in: the
 * beta.264 Brightpath Adult Learning Center's "Meet your teachers" showed a
 * teen graduate, a schoolgirl and kids.
 */
const CHILD_STEMS = [
  ...new Set(
    (
      'child children childhood kid kids baby babies toddler toddlers infant infants newborn boy boys girl girls ' +
      'schoolgirl schoolgirls schoolboy schoolboys schoolchild schoolchildren schoolkid schoolkids pupil pupils ' +
      'teen teens teenager teenagers teenage preteen youth kindergarten preschool'
    )
      .split(' ')
      .map(aiStockStem),
  ),
]

/** Words of which a photo of one of the business's people names one: an adult, at work or in their role. */
const ADULT_PEOPLE_STEMS = [
  ...new Set(
    (
      'man men woman women adult adults businessman businesswoman businessmen professional ' +
      'professionals staff worker workers employee employees team colleague colleagues coworker coworkers ' +
      'teacher teachers instructor instructors tutor tutors lecturer professor educator faculty coach coaches ' +
      'trainer trainers chef chefs cook baker barista doctor doctors dentist nurse nurses hygienist therapist ' +
      'physician stylist hairdresser barber artist musician photographer entrepreneur founder owner manager ' +
      'leader speaker volunteer volunteers mechanic electrician plumber carpenter craftsman technician'
    )
      .split(' ')
      .map(aiStockStem),
  ),
]

/**
 * The roles a list of the business's people names (AGL-3856): the words that
 * name each, the words a photo of someone in it is tagged with, and the word
 * a search for them leads with, where the libraries know one. A teacher is
 * shown teaching, a coach coaching, never a student or a whistle. A team or
 * a staff is anyone at work: its words are preferred, never required.
 *
 * A role whose photos are often of someone merely tagged with it carries the
 * words of it being done, one of which the photo's first tags must name
 * (`scene`), and the words of something else being done, which none of them
 * may (`refuse`): the beta.265 Northgate Adult Learning Center's "Meet your
 * teachers" placed a woman painting at an easel ("artist, teacher of
 * drawing"), a model in a traditional dress ("woman, model, show, teacher")
 * and an elderly man's portrait ("teacher, professor, man, senior").
 */
const PEOPLE_ROLES: ReadonlyArray<{
  words: readonly string[]
  kin: readonly string[]
  query?: string
  loose?: boolean
  scene?: readonly string[]
  refuse?: readonly string[]
}> = [
  {
    words: ['instructor', 'teacher', 'tutor', 'educator', 'faculty', 'professor', 'lecturer', 'mentor'],
    kin: ['teacher', 'instructor', 'tutor', 'educator', 'professor', 'lecturer', 'teaching', 'lecture', 'faculty'],
    query: 'teacher',
    scene: [
      'teaching', 'teach', 'classroom', 'class', 'lecture', 'lesson', 'lessons', 'tutor', 'tutoring', 'blackboard', 'chalkboard',
      'whiteboard', 'board', 'seminar', 'student', 'students', 'learner', 'learners', 'presentation',
    ],
    refuse: [
      'model', 'modeling', 'fashion', 'pose', 'posing', 'beauty', 'glamour', 'cosplay', 'artist', 'artists', 'painter',
      'painting', 'paint', 'easel', 'canvas', 'draw', 'draws', 'drawing', 'calligraphy',
    ],
  },
  { words: ['coach', 'trainer'], kin: ['coach', 'coaching', 'trainer', 'instructor'], query: 'coach' },
  { words: ['chef', 'cook', 'baker'], kin: ['chef', 'cook', 'cooking', 'baker', 'baking'], query: 'chef' },
  { words: ['stylist', 'barber', 'hairdresser', 'colorist'], kin: ['stylist', 'barber', 'hairdresser', 'hairstylist', 'haircut'], query: 'hairdresser' },
  {
    words: ['doctor', 'dentist', 'hygienist', 'nurse', 'therapist', 'practitioner', 'physician'],
    kin: ['doctor', 'dentist', 'hygienist', 'nurse', 'therapist', 'physician', 'medical'],
  },
  {
    words: ['staff', 'team', 'crew', 'member', 'manager', 'founder', 'owner', 'partner', 'associate', 'employee'],
    kin: ['staff', 'team', 'worker', 'employee', 'colleague', 'coworker', 'professional', 'businessman', 'businesswoman', 'owner', 'manager'],
    loose: true,
  },
]

/** A role {@link aiStockPeopleRole} reads: its kin's stems, its search word, and whether a photo must name it. */
export interface AiStockPeopleRole {
  kin: string[]
  query: string
  required: boolean
  /** Stems of the role being done, one of which a photo's first tags name ({@link AI_STOCK_ROLE_TAGS_READ}). */
  scene?: string[]
  /** Stems of something else being done, which none of a photo's first tags name. */
  refuse?: string[]
}

/** How many of a photo's first tags show a role being done: "teacher, presentation, education, man, students" (AGL-3856). */
export const AI_STOCK_ROLE_TAGS_READ = 6

/**
 * The role a person's words say, else the first of the other texts that names
 * one (their list's name): "Online learning coach" of the "Instructors" list
 * is a coach. `null` where none names a listed role.
 */
export function aiStockPeopleRole(...texts: readonly string[]): AiStockPeopleRole | null {
  for (const text of texts) {
    const named = new Set(stemList(text))
    const role = PEOPLE_ROLES.find((entry) => entry.words.some((word) => named.has(aiStockStem(word))))
    if (role)
      return {
        kin: [...new Set(role.kin.map(aiStockStem))],
        query: role.query ?? '',
        required: !role.loose,
        ...(role.scene ? { scene: [...new Set(role.scene.map(aiStockStem))] } : {}),
        ...(role.refuse ? { refuse: [...new Set(role.refuse.map(aiStockStem))] } : {}),
      }
  }
  return null
}

/** A role's refusals, less what the person's own words name: a "Drawing instructor" may be drawing. */
export function aiStockRoleRefusals(role: Pick<AiStockPeopleRole, 'refuse'>, words: string): string[] {
  const named = new Set(stemList(words))
  return (role.refuse ?? []).filter((stem) => !named.has(stem))
}

/** A site's audience in its own words, when it is adults: "Adults finishing a high school diploma". */
const ADULT_AUDIENCE = /\b(?:adults?|grown[- ]?ups?|seniors?|retirees?|older (?:adults|people)|professionals|employees|workforce|job ?seekers)\b/i
/** Words that say a site is for children too, whatever else it says. */
const YOUNG_AUDIENCE =
  /\b(?:kids?|child(?:ren)?|teens?|teenagers?|youth|young people|famil(?:y|ies)|boys?|girls?|bab(?:y|ies)|toddlers?|k-12|elementary|middle school|preschool|kindergarten|pupils?)\b/i

/**
 * Whether a site is for adults alone (AGL-3856), as its audience, its name
 * or its business type says: "Adults finishing a high school diploma",
 * "Brightpath Adult Learning Center". Then no photo of a child is placed
 * anywhere on it, whatever else its words name ("school").
 */
export function aiStockAdultsOnly(texts: ReadonlyArray<string | undefined>): boolean {
  const said = texts.filter(Boolean).join(' . ')
  return ADULT_AUDIENCE.test(said) && !YOUNG_AUDIENCE.test(said)
}

/** Where a picture of a moment is set, by the words that name it, and the word a search and a photo say it with. */
const SCENE_SETTINGS: ReadonlyArray<{ words: readonly string[]; said: string }> = [
  { words: ['mountain', 'mountains', 'ridgetop', 'ridge', 'summit', 'peak', 'alpine', 'overlook', 'parkway'], said: 'mountains' },
  { words: ['fall', 'autumn', 'foliage'], said: 'autumn' },
  { words: ['winter', 'snow', 'snowy'], said: 'winter' },
  { words: ['beach', 'coast', 'seaside', 'shore', 'ocean'], said: 'beach' },
  { words: ['forest', 'woods', 'woodland'], said: 'forest' },
  { words: ['spring', 'blossom', 'blossoms'], said: 'spring' },
  { words: ['city', 'urban', 'downtown'], said: 'city' },
]

/** What a picture of a moment shows ({@link aiStockScene}). */
export interface AiStockScene {
  /** The searches that ask for it, the people and their setting first. */
  queries: string[]
  /** The words its photo is scored by: the people, and the setting. */
  subject: string
  /** The thing a photo of it leads with, and its kin. */
  object: string
  lead: string[]
  /** Words of which a photo of it names one. */
  people: string[]
  shun: string[]
  /** The stems of its words, which let in what they name: a family's children. */
  named: string[]
}

/**
 * The scene a picture's words name (AGL-3856): the people at a moment, and
 * where — "Ridgetop Elopement" a couple in the mountains, "Mountain Wedding
 * Day" a wedding couple in the mountains, "Family Session in the Fall" a
 * family in autumn — read from every word, never only the first clause.
 * `null` where it names no people.
 */
export function aiStockScene(text: string): AiStockScene | null {
  const named = sceneWords(text)
  const scene = PEOPLE_SCENES.find((entry) => entry.words.some((word) => named.has(word)))
  if (!scene) return null
  const setting = aiStockSetting(text)
  const query = scene.query(named)
  return {
    queries: [...new Set([setting ? `${query} ${setting}` : '', query].filter(Boolean))],
    subject: [scene.subject, setting].filter(Boolean).join(' '),
    object: scene.subject,
    lead: scene.lead.map((phrase) => stemList(phrase).join(' ')),
    people: scene.people.map(aiStockStem),
    shun: scene.shun.filter((word) => !named.has(word)).map(aiStockStem),
    named: [...new Set(stemList(text))],
  }
}

/** A text's lowercase words, letters only. */
const sceneWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-zÀ-ɏ]+/)
      .filter(Boolean),
  )

/** Where a text's words set a picture ({@link SCENE_SETTINGS}): "mountains" of "Couples planning mountain weddings"; empty for none. */
export function aiStockSetting(text: string): string {
  const named = sceneWords(text)
  return SCENE_SETTINGS.find((entry) => entry.words.some((word) => named.has(word)))?.said ?? ''
}

/**
 * The moment a portfolio's record shows (AGL-3856): read from the record's
 * own name first, then from what it is filed under, then as a portrait, and
 * set where its name, its category or else the site's own words say. A
 * photographer's "Getting Ready" filed under "Weddings and elopements" is a
 * wedding couple in the mountains; "Milestone Portraits" filed under "Family
 * portraits" a family. Its searches end on the people alone ("couple"), so a
 * moment no photo shows in its setting still shows its people. `null` where
 * neither names people at a moment nor a portrait.
 */
export function aiStockRecordScene(name: string, category = '', siteSetting = ''): AiStockScene | null {
  const texts = [name, category].filter((text) => text.trim())
  const source =
    texts.find((text) => PEOPLE_SCENES.some((entry) => entry.words.some((word) => sceneWords(text).has(word)))) ??
    texts.find((text) => PORTRAIT_SCENE.words.some((word) => sceneWords(text).has(word)))
  if (!source) return null
  const named = sceneWords(source)
  const scene = PEOPLE_SCENES.find((entry) => entry.words.some((word) => named.has(word))) ?? PORTRAIT_SCENE
  const setting = texts.map(aiStockSetting).find(Boolean) ?? siteSetting
  const query = scene.query(named)
  const all = sceneWords(texts.join(' '))
  return {
    queries: [...new Set([setting ? `${query} ${setting}` : '', query, scene.subject].filter(Boolean))],
    subject: [scene.subject, setting].filter(Boolean).join(' '),
    object: scene.subject,
    // A record's cover leads with its people: a wedding's table decor is not "Overlook Ceremonies".
    lead: scene.lead.filter((phrase) => !RECORD_SCENE_UNPEOPLED.has(phrase)).map((phrase) => stemList(phrase).join(' ')),
    people: scene.people.map(aiStockStem),
    shun: scene.shun.filter((word) => !all.has(word)).map(aiStockStem),
    named: [...new Set(stemList(texts.join(' ')))],
  }
}

/**
 * A scene's lead words a record's cover never leads with alone
 * ({@link aiStockRecordScene}): the moment with no one in it (a wedding's table
 * decor for "Overlook Ceremonies"), or children with no family (a ski class
 * for "Milestone Portraits").
 */
const RECORD_SCENE_UNPEOPLED = words('wedding elopement child children kid kids baby toddler')

/**
 * What a portfolio's record is never OF, among its first tags, unless its own
 * words name it (AGL-3856): an animal, a toy or a figurine. The beta.265
 * Laurel Ridge "Gallery collections" covers were a toy frog with a camera, a
 * toy duck and a cat's portrait.
 */
const RECORD_ODD_LEADS = words(
  'animal animals cat cats kitten dog dogs puppy pet pets bird birds frog frogs duck ducks horse horses cow rabbit bunny ' +
    'toy toys figurine figurines lego doll dolls teddy puppet miniature',
)

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

/**
 * The searches a slot tries, in order, most specific first, each distinct.
 * A portrait of one of the business's people ({@link AiLayoutPictureSlot.people})
 * asks first for the role its words or its list's name (`sectionName`) say,
 * in the site's world: "teacher classroom" for a "Math instructor" (AGL-3856).
 */
export function aiStockSearchesFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'aspect' | 'people' | 'record' | 'product'>,
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'domain' | 'broad'> &
    Partial<Pick<AiStockSiteTerms, 'making' | 'core' | 'scenes' | 'setting' | 'maker'>>,
  subject: string,
  part?: AiStockSlotPart,
  sectionName = '',
): AiStockSearch[] {
  const orientation = aiStockOrientation(slot.aspect)
  const size =
    slot.role === 'hero'
      ? { minWidth: 1600 }
      : orientation === 'vertical'
        ? { minHeight: 900 }
        : { minWidth: 900 }
  const domain = new Set(terms.domain)
  // A portfolio's record of a craft whose work is people at a moment shows the
  // moment, never the maker: the beta.265 Laurel Ridge "Gallery collections"
  // searched "photographer mountain elopements" and placed a press
  // photographer, a toy frog with a camera and a cat (AGL-3856).
  const work = aiStockShowsTheWork(slot, terms)
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
  const collection = part === 'collection' && Boolean(terms.craft) && !work
  const broad: Query[] = (kin && collection) || work
    ? []
    : terms.broad.map((query) => ({ query, broad: true, category: collection }))
  // The maker at work, held to the craft: never "hands" (AGL-3660).
  const making: Query[] = (work ? [] : (terms.making ?? [])).map((query) => ({
    query,
    broad: true,
    category: true,
  }))
  // A portrait in its role, in the site's world, where the libraries know a word for it.
  const roleWord = slot.people ? (aiStockPeopleRole(slot.alt, sectionName)?.query ?? '') : ''
  const role = roleWord ? (stemList(terms.business).includes(roleWord) ? terms.business : `${roleWord} ${terms.business}`.trim()) : ''
  // A scene's people are read from every word of the picture's, never its first clause alone.
  const scene = work
    ? aiStockRecordScene(slot.alt, slot.record?.category ?? '', terms.setting ?? '')
    : terms.scenes && slot.role !== 'hero' && part !== 'collection'
      ? aiStockScene(slot.alt)
      : null
  // The work's own subject is never qualified by the craft: "getting ready", never "photographer getting ready".
  const own = work ? (phrase: string) => phrase : qualify
  const thing: Query[] = subject
    ? [
        { query: own(subject), held: true },
        ...(kin
          ? kin.queries.map((query) => ({ query, held: true }))
          : [{ query: own(object), held: true }]),
      ]
    : []
  // Never the maker, the camera, an animal or a toy, unless the record names it.
  const recordNamed = work ? new Set(stemList(`${slot.alt} ${slot.record?.category ?? ''}`)) : null
  const refuseLead = recordNamed
    ? [...new Set([...(terms.maker ?? []), ...[...RECORD_ODD_LEADS].map(aiStockStem)])].filter((stem) => !recordNamed.has(stem))
    : []
  const queries: Query[] =
    slot.role === 'hero'
      ? [{ query: terms.business, broad: true }, ...broad]
      : slot.role === 'about'
        ? [
            ...(role ? [{ query: role, broad: true, people: true }] : []),
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
        : [...(part === 'story' ? making : []), ...(scene ? [] : thing), ...broad]
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  // A picture of people at a moment asks for them, and where, before anything
  // else, and takes only a photo leading with them (AGL-3856): never the
  // roses of a "Mountain Wedding Day", nor a bride for a family session.
  for (const query of scene?.queries ?? []) {
    seen.add(`${query}|false`)
    searches.push({
      query,
      orientation,
      ...size,
      strict: true,
      subject: (scene as AiStockScene).subject,
      object: (scene as AiStockScene).object,
      kin: (scene as AiStockScene).lead,
      lead: true,
      needs: (scene as AiStockScene).people,
      allow: (scene as AiStockScene).named,
      ...((scene as AiStockScene).shun.length ? { refuse: (scene as AiStockScene).shun } : {}),
      ...(refuseLead.length ? { refuseLead } : {}),
      ...(work ? { worldless: true } : {}),
    })
  }
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
      ...(refuseLead.length ? { refuseLead } : {}),
      ...(work ? { worldless: true } : {}),
    })
  }
  return searches
}

/**
 * Whether a slot is a portfolio's record of a craft whose work is people at a
 * moment (AGL-3856): a photographer's "Mountain Elopements" shows an
 * elopement, never the photographer. Searched by the moment its words and its
 * category name, held to no world of the craft, and never led by the craft's
 * own words, an animal or a toy unless the record names them.
 */
export function aiStockShowsTheWork(
  slot: Pick<AiLayoutPictureSlot, 'record' | 'role' | 'people' | 'product'>,
  terms: Partial<Pick<AiStockSiteTerms, 'scenes'>>,
): boolean {
  return Boolean(slot.record) && Boolean(terms.scenes) && slot.role !== 'hero' && !slot.people && !slot.product
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
  /** Words a hit's first tags never carry unless the subject or the brief names them ({@link AiStockSiteTerms.shunLead}). */
  shunLead?: readonly string[]
  /** Words a hit never carries, whatever the brief names ({@link AiStockSearch.refuse}). */
  refuse?: readonly string[]
  /** Stems of which a hit names one ({@link AiStockSearch.needs}). */
  needs?: readonly string[]
  /** Stems no hit's first tags carry: a child, for a portrait of one of the business's people (AGL-3856). */
  refuseLead?: readonly string[]
  /** Stems naming the role a portrait shows, which a hit is preferred for naming, most of all first (AGL-3856). */
  roles?: readonly string[]
  /** Stems of the role being done, one of which a hit's first tags must name ({@link AiStockPeopleRole.scene}). */
  roleScene?: readonly string[]
  /** Stems of something else being done, which none of a hit's first tags may name ({@link AiStockPeopleRole.refuse}). */
  roleRefuse?: readonly string[]
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
  // A family session is never a bride, however the photographer's brief names weddings.
  if ((judgement.refuse ?? []).some((word) => hit.all.has(word))) return 0
  // A teacher's portrait is never OF a child, whatever else it names.
  if ((judgement.refuseLead ?? []).some((word) => hit.lead.has(word))) return 0
  // A teacher is shown teaching: a classroom, a lecture or students among the
  // first tags, and never a model, a pose or a painting (AGL-3856).
  if (judgement.roleScene?.length || judgement.roleRefuse?.length) {
    const first = new Set(stemList((photo.tags ?? []).slice(0, AI_STOCK_ROLE_TAGS_READ).join(' ')))
    if (judgement.roleScene?.length && !judgement.roleScene.some((stem) => first.has(stem))) return 0
    const read = new Set(stemList((photo.tags ?? []).slice(0, ALT_TAGS_READ).join(' ')))
    if ((judgement.roleRefuse ?? []).some((stem) => read.has(stem))) return 0
  }
  // A wedding day shows its people: a close-up of roses tagged "wedding" never fills it.
  const needs = judgement.needs ?? []
  if (needs.length && !needs.some((word) => hit.all.has(word))) return 0
  // What the photo is OF: a typewriter's terms of service are not a law firm's.
  if ((judgement.shunLead ?? []).some((word) => hit.lead.has(word) && !owned.has(word)))
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
  // A portrait in its role: a teacher at the board over a woman in a classroom.
  const roles = judgement.roles ?? []
  if (roles.some((word) => hit.lead.has(word))) score += 4
  else if (roles.some((word) => hit.all.has(word))) score += 2
  // A hero is most of all what its first tags say: "law office, lawyer,
  // attorney" over "lawyers, personal injury, accident" (AGL-3856): a second
  // of them naming its world says it is of that world, not of something else.
  if (judgement.first && worldStems.size) {
    const said = hit.leadPhrases.slice(0, -1).filter((phrase) => phrase.split(' ').some((stem) => worldStems.has(stem)))
    if (said.length >= 2) score += 0.25
  }
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

/**
 * Whether two hits are of one shoot (AGL-3856): one contributor's photos a few
 * uploads apart, as Pixabay numbers them — the beta.265 Granite Peak Barbell
 * coaches were four of one model, 728223 to 728229 — else one page address.
 */
export function aiStockSameShoot(
  a: Pick<StockPhoto, 'id' | 'photographer' | 'pageUrl'>,
  b: Pick<StockPhoto, 'id' | 'photographer' | 'pageUrl'>,
): boolean {
  const near = Number(a.id) && Number(b.id) ? Math.abs(Number(a.id) - Number(b.id)) < 100 : false
  if (a.photographer && a.photographer === b.photographer && near) return true
  const slug = pageSlug(a.pageUrl)
  return Boolean(slug) && slug === pageSlug(b.pageUrl)
}

/**
 * A search's ranked hits with those of a shoot no slot shows yet first among
 * the best (AGL-3856): a team's three cards are three people where the
 * library has them, never one model three times while another fits as well.
 * Every other order is kept.
 */
export function aiStockFreshShootsFirst(
  ranked: readonly StockPhoto[],
  shown: readonly StockPhoto[],
  judgement: AiStockJudgement,
): StockPhoto[] {
  if (!shown.length || ranked.length < 2) return [...ranked]
  const best = aiStockRelevance(ranked[0] as StockPhoto, judgement)
  const top = ranked.filter((photo) => aiStockRelevance(photo, judgement) === best)
  const fresh = top.filter((photo) => !shown.some((other) => aiStockSameShoot(photo, other)))
  if (!fresh.length || fresh[0] === ranked[0]) return [...ranked]
  return [...fresh, ...ranked.filter((photo) => !fresh.includes(photo))]
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

/** What a job's photos map holds for a photo the media library refused for its own bytes: no page's scope (AGL-3923). */
const REFUSED_BY_THE_LIBRARY = '\u0000refused'
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
 * Words a tag uses for how a photo looks or feels, never a thing it shows
 * (AGL-3856): "extravagant" of "wedding dress, bride, extravagant", "moody"
 * of "forest, human, photographer", a season or a people's name.
 */
const DESCRIBING = words(
  'love romance romantic luxury luxurious fancy extravagant happiness happy beauty emotion emotions mood lifestyle ' +
    'concept aesthetic wallpaper background retro vintage antique old young cute sexy fun funny sad positive negative healthy fit ' +
    'strong powerful homemade tasty yummy sweet sweetness nice dark bw monochrome macro sporty active married bridal ' +
    'female male adult good bad poc bipoc moody sunny rainy foggy misty snowy cloudy stormy dreamy shiny trendy messy ' +
    'casual blonde blond brunette muscular athletic clever intelligent concentrated curious lonely sleepy heavy ' +
    'nature outdoors outdoor indoors indoor scenery scenic autumn fall winter spring summer ' +
    'physical teenage traveling ' +
    // Adjectives a tag gives alone, never a thing: "students, multicultural" (AGL-3856).
    'multicultural multiethnic multiracial diverse international cultural traditional modern classic classical ' +
    'domestic wild tropical rural urban ' +
    // How the photo was made, never what it shows: "cutout, perspective", "men, silhouettes".
    'silhouette silhouettes cutout perspective bokeh closeup ' +
    // A holiday names when, never a thing: "tet market" is a market.
    'tet christmas easter halloween diwali ramadan hanukkah thanksgiving ' +
    'indian asian african american european caucasian vietnamese japanese chinese korean thai latino latina hispanic ' +
    'japan vietnam viet nam thailand india china korea germany france italy spain england britain uk usa america ' +
    'canada mexico brazil australia africa europe asia',
)

/**
 * Words a tag uses for what a person or a thing is like, said before it
 * rather than as a thing of its own (AGL-3856): "a confident lawyer", "an
 * elderly couple", "an analog camera", never "a lawyer, law and a confident".
 */
const QUALITIES = words(
  'confident professional successful serious smart busy creative proud skilled experienced determined focused ' +
    'senior junior expert friendly cheerful smiling elderly analog analogue digital mirrorless',
)

/** What a tag names that takes no article: "chalk" of "board, chalk". */
const MASS_NOUNS = words(
  'food coffee tea bread wood water wax soap clay money fabric yarn wool furniture jewelry jewellery ' +
    'pottery glass paper music art hair makeup chalk paint ink dust stone marble concrete steel metal ' +
    'skincare equipment decor fashion wildlife weather traffic wine beer chocolate rice sugar flour milk ' +
    'cheese honey oil ice fire light sunlight dough sourdough pastry dessert people foliage greenery faculty staff ' +
    'clothing bedding frosting icing flooring',
)

/** Nouns plural without an "-s": said without an article, "women in a classroom". */
const PLURAL_NOUNS = words('men women people children feet teeth mice geese sheep fish')

/**
 * What a tag names that no photo shows as a thing of its own (AGL-3856): an
 * idea ("law" of "lawyer, law", "feedback" of "board, chalk, feedback"), a
 * doing ("read", "lift", "fitness", "a workout"), a word for the photo itself
 * ("photo", "spot"). Left out, never said with an article: "A bookwork and a
 * read", "A kettlebell and fitness", "A board and training" said nothing.
 */
const ABSTRACT_NOUNS = words(
  'law justice advocacy business feedback review news return communication communicate discussion dialog conversation ' +
    'success career work job satisfaction quality concept idea strategy marketing education technology health support ' +
    'confirmation opinion rating evaluation planning project presentation optimization information internet finance ' +
    'management leadership teamwork motivation growth strength service services help advice consulting consultation ' +
    'marriage photography architecture travel transport transportation industry company corporate social e-business ' +
    'fitness workout workouts exercise exercises crossfit sport sports skill skills knowledge exam exams lecture ' +
    'session lesson course hobby leisure power energy wellness talent formation participation ' +
    'press show day days night year years time holiday month months week weeks morning evening afternoon ' +
    'kiss hug embrace ' +
    'photo photos picture pictures image images shot shots shoot shoots spot spots ' +
    'read write learn study lift move remove focus relax think sit smile laugh eat swim teach enjoy celebrate explore ' +
    'hike can',
)

/** Words ending as an idea does that are things: "a station", "a city", "a ship". */
const CONCRETE_ABSTRACT_ENDINGS = words(
  'station mansion lotion potion ornament instrument apartment monument pavement basement garment compartment ' +
    'equipment cement city university facility ship warship spaceship airship',
)

/** Whether a word is an idea or a doing by how it ends: "participation", "unity", "empowerment". */
const saysAnIdea = (word: string) =>
  /(?:tion|sion|ment|ness|ity|ship|ism)s?$/.test(word) && !CONCRETE_ABSTRACT_ENDINGS.has(aiStockStem(word))

/**
 * Makers' names a tag gives, never what a photo shows to someone who cannot
 * see it (AGL-3856): "A photo-camera and a sony".
 */
const BRANDS = words(
  'sony canon cannon nikon fujifilm fuji leica olympus panasonic kodak polaroid hasselblad pentax gopro dji ' +
    'apple iphone ipad macbook imac samsung huawei android google microsoft windows dell lenovo nintendo playstation ' +
    'xbox nike adidas puma reebok peloton bmw mercedes audi porsche ferrari lamborghini tesla ford toyota honda ' +
    'volkswagen vw jeep chevrolet coca-cola pepsi starbucks mcdonalds ikea lego barbie disney altman ' +
    'petri zenit praktica yashica minolta mamiya rolleiflex voigtlander contax ricoh konica lomo lomography holga zeiss',
)

/** Stopwords a description still says, as the people a photo shows: "a family", "a person". */
const SAID_PEOPLE = words('people person family')

/** Words ending in "-ing" that are things, and take an article: "a wedding", "a ring". */
const COUNTED_ING = words(
  'wedding ring earring building painting drawing ceiling string swing king sibling wing dumpling pudding sapling',
)

/** "-ing" words that are things, and take no article: "clothing". */
const UNCOUNTED_ING = words('clothing bedding frosting icing flooring stuffing seasoning filling')

/** People a photo shows; the generic ones give way to a role ("man" to "businessman"). */
const PEOPLE_NOUNS = words(
  'man men woman women person people human humans boy boys girl girls guy guys lady ladies child children kid kids ' +
    'baby family couple bride groom schoolgirl schoolboy teen teenager student students graduate athlete athletes ' +
    'businessman businesswoman businessmen lawyer attorney doctor dentist nurse chef cook baker barista ' +
    'trainer coach teacher teachers instructor lecturer professor tutor worker workers entrepreneur model ' +
    'photographer potter artist florist mother father parent parents grandmother grandfather grandparents ' +
    'faculty staff team participants volunteer volunteers musician dancer leader manager owner founder ' +
    'journalist journalists reporter reporters master masters lovers newlywed newlyweds husband wife fiance fiancee spouse',
)
/** People said by no role: a model is whoever posed (AGL-3856), "a woman" of "woman, model, show, teacher". */
const GENERIC_PEOPLE = words('man men woman women person people human humans guy guys lady ladies adult boy boys girl girls model models')

/**
 * A body's parts, never a thing a photo is described by (AGL-3856): "A girl
 * with a hand" said nothing, and "A body in a gym" is a gym.
 */
const BODY_PARTS = words(
  'hand hands finger fingers arm arms leg legs foot feet body bodies face faces eye eyes skin head heads lip lips mouth nose ' +
    'ear ears neck shoulder shoulders knee knees',
)

/**
 * Words for a kind of thing, said only where nothing names the thing itself
 * (AGL-3856): "A domestic cat and an animal" is a cat.
 */
const KINDS_OF_THING = words('animal animals pet pets creature creatures mammal mammals object objects thing things item items')

/** How many of a photo's first tags a person leads its description from, where it names a thing too: "A camera" of "petri, camera, film, photography, photographer" (AGL-3856). */
const ALT_PERSON_TAGS_READ = 4
/** How many of a photo's first tags a role is said from, over a man or a woman before it: "A man" of "bed, book, man, …, student" (AGL-3856). */
const ALT_ROLE_TAGS_READ = 6

/** What a person in a photo wears, said "in": "a bride in a wedding dress". */
const CLOTHING = words('dress gown suit uniform costume coat jacket robe apron')

/**
 * Places a photo is set in, each with how a phrase says it is there: "a
 * train at a station", "a lawyer in court", "a couple at a wedding".
 */
const PLACES: Readonly<Record<string, string>> = {
  station: 'at',
  market: 'at',
  desk: 'at',
  table: 'at',
  counter: 'at',
  school: 'at',
  college: 'at',
  university: 'at',
  wedding: 'at',
  sunset: 'at',
  sunrise: 'at',
  dusk: 'at',
  dawn: 'at',
  beach: 'on',
  bed: 'on',
  sofa: 'on',
  couch: 'on',
  bench: 'on',
  trail: 'on',
  path: 'on',
  bridge: 'on',
  street: 'on',
  court: 'in',
  courtroom: 'in',
  office: 'in',
  kitchen: 'in',
  gym: 'in',
  studio: 'in',
  classroom: 'in',
  class: 'in',
  hall: 'in',
  room: 'in',
  garden: 'in',
  park: 'in',
  shop: 'in',
  store: 'in',
  bakery: 'in',
  cafe: 'in',
  restaurant: 'in',
  workshop: 'in',
  library: 'in',
  salon: 'in',
  clinic: 'in',
  forest: 'in',
  city: 'in',
  church: 'in',
  field: 'in',
  meadow: 'in',
  valley: 'in',
  mountain: 'in',
  hill: 'on',
  cliff: 'on',
  river: 'by',
  lake: 'by',
  waterfall: 'at',
}

/** Places that are things too, a photo's subject where nothing else is: "a desk in a classroom". */
const OBJECT_PLACES = words('desk table counter bridge bed sofa couch bench')

/** Places said without an article: "in court", "at sunset". */
const BARE_PLACES = words('court sunset sunrise dusk dawn')

/** Places said in words of their own: a mountain tag is "in the mountains". */
const PLACES_SAID: Readonly<Record<string, string>> = { mountain: 'the mountains' }

/** How many of a photo's first tags its description reads: the things and people it is OF. */
const ALT_TAGS_READ = 8
/** How far a photo's tags are read for where it is set, said last: "in a gym" of a kettlebell's seventh tag. */
const ALT_PLACE_TAGS_READ = 10

/** A tag's words, a word for the photo itself taken off a compound: "photo-camera" is a camera. */
function tagWords(tag: string): string[] {
  return tag
    .toLowerCase()
    .replace(/[^a-zÀ-ɏ\s'-]/g, ' ')
    .replace(/\b(?:photo|picture|image)-(?=[a-z])/g, '')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * A tag as a phrase of an English description (AGL-3856): "a wedding dress",
 * "an attorney", "books", "chalk", "Columbus"; `null` for a tag that names no
 * thing ("extravagant", "feedback", "training", "sony") or is too long to be
 * one.
 */
function describedTag(tag: string, proper: ReadonlySet<string>): string | null {
  const describing = (word: string) =>
    FILLER.has(word) ||
    DESCRIBING.has(word) ||
    QUALITIES.has(word) ||
    /(?:ous|ful)$/.test(word) ||
    (word.length > 4 && /[^e]ed$/.test(word))
  const all = tagWords(tag)
  // "Beautiful flowers" shows flowers; "roasted" shows nothing; "photo model"
  // is a model and "traveling couples" are couples: a word before the last
  // that is a doing says what they do, never what they are.
  const list = all.filter(
    (word, index) =>
      !describing(word) &&
      !(all.length > 1 && /^(?:photo|picture|image)$/.test(word)) &&
      !(index < all.length - 1 && index > 0 && word.endsWith('ing') && !COUNTED_ING.has(word)),
  )
  if (!list.length || all.length > 3) return null
  // A phrase of no thing ("up close") or a doing ("take pictures", "to lift", "work out") is not what it shows.
  if (list.every((word) => STOPWORDS.has(word) && !SAID_PEOPLE.has(word))) return null
  if (/^(?:to|take|taking|make|making|get|do|go|lie|in|on|at|for|with|by|of)$/.test(list[0] as string)) return null
  if (/^(?:out|up|off|down|away|on|in)$/.test(list[list.length - 1] as string)) return null
  if (list.some((word) => BRANDS.has(word))) return null
  if (list.every((word) => proper.has(word)))
    return list.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
  const last = list[list.length - 1] as string
  // An idea or a doing, never a thing: "law", "feedback", "customer satisfaction", "participation", "weightlifting".
  if (ABSTRACT_NOUNS.has(last) || ABSTRACT_NOUNS.has(aiStockStem(last)) || saysAnIdea(last)) return null
  const doing = last.endsWith('ing') && !COUNTED_ING.has(aiStockStem(last)) && !UNCOUNTED_ING.has(last)
  if (doing) return null
  const phrase = list.join(' ')
  const plural =
    PLURAL_NOUNS.has(last) || (aiStockStem(last) !== last && !/^(?:lens|canvas|atlas|gas|bus)$/.test(last))
  if (plural || MASS_NOUNS.has(last) || (STOPWORDS.has(list[0] as string) && !SAID_PEOPLE.has(list[0] as string)))
    return phrase
  return `${articleFor(phrase)} ${phrase}`
}

/** "a" or "an" before a phrase. */
const articleFor = (phrase: string) => (/^(?:[aeio]|u(?!ni|s[eu]))/.test(phrase) ? 'an' : 'a')

/** One thing a photo's tags name, as {@link aiStockTagsAlt} says it. */
interface AiStockAltPart {
  said: string
  stems: string[]
  /** Its last word: what it is. */
  head: string
  kind: 'person' | 'place' | 'thing'
  /** The position of the tag that first named it. */
  index: number
}

/** Whether two words name one thing, one inside the other: "law" and "lawyer", "cam" and "camera". */
function nearSynonyms(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && short !== long && (long.startsWith(short) || long.endsWith(short))
}

/**
 * A photo described from its own tags (AGL-3856): a short English phrase of
 * concrete things, never the library's comma-separated list: "A train at a
 * station", "A confident lawyer in court", "A portrait of a businessman", "A
 * photographer with a camera on a beach", "A kettlebell in a gym", "An analog
 * camera". It says one person at most (a role over a man or a woman, an adult
 * over a girl), what they hold or wear, or one or two things, and where:
 *
 * - an idea or a doing ("law", "feedback", "training", "a read",
 *   "participation"), a maker's name ("sony"), a word for the photo itself
 *   ("photo", "spot") and a look ("moody", "analog" alone, a season) are left
 *   out; a quality ("elderly", "analog") is said before the one thing it
 *   qualifies;
 * - of two words for one thing the first tag's stays ("book" over
 *   "bookwork", "camera" over "photo-camera"), unless the later phrase holds
 *   it whole ("wedding dress" over "wedding");
 * - a second thing comes only from the first two tags and where no place is
 *   said, what a person holds only from the first three, where it is set
 *   from the first ten;
 * - no word is said twice: never "an elderly couple and an elderly".
 *
 * `null` where no tag names a thing.
 */
export function aiStockTagsAlt(tags: readonly string[], proper: ReadonlySet<string> = new Set()): string | null {
  const parts: AiStockAltPart[] = []
  let quality = ''
  let portrait = false
  for (const [index, tag] of tags.slice(0, ALT_PLACE_TAGS_READ).entries()) {
    const lower = tag.toLowerCase().trim()
    const reading = index < ALT_TAGS_READ
    if (reading && (lower === 'portrait' || lower === 'portraits')) {
      portrait = true
      continue
    }
    if (QUALITIES.has(lower)) {
      if (reading) quality ||= lower
      continue
    }
    const said = describedTag(tag, proper)
    if (!said) continue
    const bare = said.replace(/^an?\s+/, '')
    const stems = stemList(bare)
    const head = bare.split(/\s+/).pop()?.toLowerCase() ?? ''
    if (!head) continue
    const headStem = aiStockStem(head)
    const kind: AiStockAltPart['kind'] =
      PEOPLE_NOUNS.has(head) || PEOPLE_NOUNS.has(headStem) ? 'person' : PLACES[headStem] ? 'place' : 'thing'
    // Past the first tags only where it is set is read.
    if (!reading && kind !== 'place') continue
    // A hand or a body is never what a photo is described by.
    if (kind === 'thing' && (BODY_PARTS.has(head) || BODY_PARTS.has(headStem))) continue
    if (parts.some((part) => stems.every((stem) => part.stems.includes(stem)))) continue
    const part = { said, stems, head: headStem, kind, index }
    // A longer phrase of the same thing takes its place: "elderly couple" for "couple".
    const holds = parts.findIndex((held) => held.head === headStem && held.stems.every((stem) => stems.includes(stem)))
    if (holds >= 0) {
      parts.splice(holds, 1, { ...part, index: (parts[holds] as AiStockAltPart).index })
      continue
    }
    // Two words for one thing ("book" and "bookwork", "cam" and "camera"): the
    // first tag's stays; a person's are told apart by their role below.
    if (kind !== 'person' && parts.some((held) => held.kind !== 'person' && nearSynonyms(held.head, headStem))) continue
    parts.push(part)
  }
  // One person: a role among the first tags over a man, a woman, a girl
  // ("businessman" over "man"), else the first; a role tagged later is not
  // what the photo shows ("bed, book, man, …, student" is a man), nor is one
  // a model posed as ("woman, model, show, teacher" is a woman).
  const people = parts.filter((part) => part.kind === 'person')
  const posed = people.some((part) => part.head === 'model')
  let places = parts.filter((part) => part.kind === 'place')
  let things = parts.filter((part) => part.kind === 'thing')
  // A kind of thing only where nothing names the thing: "a cat", never "a cat and an animal".
  if (things.some((part) => !KINDS_OF_THING.has(part.head))) things = things.filter((part) => !KINDS_OF_THING.has(part.head))
  // A person tagged after the things a photo is of is not who it shows:
  // "petri, camera, film, photography, photographer" is a camera, and "men,
  // silhouettes, camera, nature, photographer" men with a camera.
  const leads = (part: AiStockAltPart) => portrait || part.index < ALT_PERSON_TAGS_READ || !things.length
  const role = posed
    ? undefined
    : people.find((part) => !GENERIC_PEOPLE.has(part.head) && part.index < ALT_ROLE_TAGS_READ && leads(part))
  const person = role ?? people.find(leads)
  // Nothing but places: a desk is the thing in a classroom; "a school in a classroom" says one place.
  if (!person && !things.length && places.length > 1) {
    const object = places.find((part) => OBJECT_PLACES.has(part.head))
    if (object) {
      things = [object]
      places = places.filter((part) => part !== object)
    } else places = places.slice(0, 1)
  }
  const place = places[0]
  if (!person && !things.length && !place) return null
  /** Every word said so far, so none is said twice. */
  const said = new Set<string>()
  const fresh = (part: AiStockAltPart) => {
    const list = stemList(part.said.replace(/^an?\s+/, ''))
    if (list.some((stem) => said.has(stem))) return false
    for (const stem of list) said.add(stem)
    return true
  }
  /** A quality before a single counted word: "a confident lawyer", "an analog camera". */
  const qualified = (part: AiStockAltPart) =>
    quality && /^an? \S+$/.test(part.said) && !said.has(aiStockStem(quality))
      ? `${articleFor(quality)} ${quality} ${part.said.replace(/^an?\s+/, '')}`
      : part.said
  let phrase = ''
  if (person && fresh(person)) {
    phrase = portrait ? `a portrait of ${person.said}` : qualified(person)
    const held = things.find((part) => part.index <= 2)
    if (!portrait && held && fresh(held)) phrase += ` ${CLOTHING.has(held.head) ? 'in' : 'with'} ${held.said}`
  } else if (things[0] && fresh(things[0])) {
    phrase = qualified(things[0])
    const second = things[1]
    if (second && second.index <= 1 && !place && fresh(second)) phrase += ` and ${second.said}`
  }
  if (place && fresh(place)) {
    const preposition = PLACES[place.head] ?? 'in'
    const where =
      PLACES_SAID[place.head] ?? (BARE_PLACES.has(place.head) && /^an? \S+$/.test(place.said) ? place.head : place.said)
    phrase = phrase ? `${phrase} ${preposition} ${where}` : where
  }
  if (!phrase) return null
  const out = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
  return out.length > AI_STOCK_ALT_MAX ? out.slice(0, AI_STOCK_ALT_MAX).replace(/[\s,]+\S*$/, '') : out
}

/** The thing a description names: its subject's object, a trailing "speaking calmly" or "dusted" dropped. */
function describedObject(text: string, sectionName: string): string {
  const list = aiStockSubjectWords(text, sectionName).split(/\s+/).filter(Boolean)
  while (list.length > 1 && /(?:ing|ed|ly)$/.test(list[list.length - 1] as string)) list.pop()
  return aiStockObjectWord(list.join(' '))
}

/**
 * THE WORDS A PLACED STOCK PHOTO IS DESCRIBED BY (AGL-3805, AGL-3856).
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
 * an English site whose words name the thing the photo is OF — their
 * subject's object (`aiStockSubjectWords`, a trailing "speaking calmly"
 * dropped) among the hit's first two tags. Any word of the subject among its
 * first three was not enough: the beta.259 Hartwell Reyes Family Law hero kept
 * "Two attorneys speaking calmly with a client in a bright Columbus office"
 * for a typewriter whose third tag was "attorney" (AGL-3856). A stand-in's
 * words ({@link AiLayoutPictureSlot.standIn}) are a search's, never a
 * description, and are never kept. Otherwise the photo is described by the
 * library's own words: its description where it writes one (a Pexels hit's
 * `alt`), else its first tags as an English phrase ({@link aiStockTagsAlt}),
 * never the library's tag list, and where no tag names a thing, the slot's
 * own subject: its words, else its section's name. The libraries write in English, and no model
 * translates them, so a site in another language takes the platform's own
 * words for an illustrative photo in its language (`aiLayoutLabel`), true of
 * any photo, as does a hit whose words name no thing.
 */
export function aiStockPhotoAlt(
  photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>,
  slot: Pick<AiLayoutPictureSlot, 'alt' | 'product' | 'standIn'>,
  input: { language?: string; sectionName?: string; proper?: ReadonlySet<string> } = {},
): string | null {
  if (aiLayoutSpeaksOtherThanEnglish(input.language)) return aiLayoutLabel('illustrativePhoto', input.language)
  if (!slot.standIn) {
    const first = new Set(stemList((photo.tags ?? []).slice(0, 2).join(' ')))
    const objects = [slot.alt, ...(slot.product?.subjects ?? [])].map((text) => describedObject(text, input.sectionName ?? ''))
    if (objects.some((object) => object && first.has(object))) return null
  }
  const own = (photo.alt ?? '').replace(/\s+/g, ' ').trim()
  if (own) return own.length > AI_STOCK_ALT_MAX ? `${own.slice(0, AI_STOCK_ALT_MAX).replace(/\s+\S*$/, '')}…` : own
  // No tag names a thing: the slot's own subject, as its words or its section's name say it, never a tag list.
  const subject = [slot.alt, input.sectionName ?? '']
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .find((text) => /[A-Za-zÀ-ɏ]/.test(text))
  const fallback = subject ? `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`.slice(0, AI_STOCK_ALT_MAX) : ''
  return aiStockTagsAlt(photo.tags ?? [], input.proper) ?? (fallback || aiLayoutLabel('illustrativePhoto', input.language))
}

/** The names a business type writes with a capital, lowercased: "columbus", "ohio" (AGL-3856). */
export function aiStockProperWords(businessType: string): Set<string> {
  const found = new Set<string>()
  for (const [index, word] of businessType.split(/[^A-Za-zÀ-ɏ'-]+/).filter(Boolean).entries())
    if (index > 0 && /^[A-ZÀ-Þ]/.test(word)) found.add(word.toLowerCase())
  return found
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
  /**
   * The business's name, as the person typed it (AGL-3856): what an English
   * site is searched by when its business type names no world ("a local
   * service business") and its name names a craft this module lists
   * ("Synchronicity Gym"). Never its world otherwise.
   */
  name?: string
  /** Who the site is for, as the person typed it: searched as the name is, after it (AGL-3856). */
  audience?: string
  /**
   * The id of the kind of site the person picked ("education"): what a site
   * is searched by when nothing else names its world (AGL-3856).
   */
  kind?: string
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
 * A job's language and English photo words (AGL-3760), the English name of
 * its kind of site (AGL-3771), and the business's name and audience as the
 * person typed them (AGL-3856), as a stock photo source takes them.
 */
export function aiStockPhotoWordsOf(job: {
  plan?: Pick<AiBuildPlan, 'language' | 'photoWords'> | null
  inputs?: Readonly<Record<string, unknown>> | null
}): Pick<AiLayoutStockPhotoSourceInput, 'language' | 'photoWords' | 'kindWords' | 'name' | 'audience' | 'kind'> {
  const plan = job.plan
  const kind = job.inputs ? aiSiteKindOfInputs(job.inputs) : null
  // "Restaurant & café" searches as "restaurant cafe".
  const kindWords = kind ? kind.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : ''
  const said = (key: string) => {
    const value = job.inputs?.[key]
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  }
  const name = said('businessName')
  const audience = said('audience')
  return {
    ...(plan?.language ? { language: plan.language } : {}),
    ...(plan?.photoWords ? { photoWords: plan.photoWords } : {}),
    ...(kindWords ? { kindWords } : {}),
    ...(kind ? { kind: kind.id } : {}),
    ...(name ? { name } : {}),
    ...(audience ? { audience } : {}),
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
 * post — so no slot searches by words another slot is held against. A site for
 * adults alone ({@link aiStockAdultsOnly}) is told so, whatever its world.
 */
export function aiStockSourceTerms(
  input: Pick<AiLayoutStockPhotoSourceInput, 'business' | 'language' | 'photoWords' | 'kindWords' | 'name' | 'audience' | 'kind'>,
): AiStockSiteTerms {
  const terms = sourceWorldTerms(input)
  // Where the site's own words set it: a photographer "in the Blue Ridge" for "mountain weddings" (AGL-3856).
  const setting = aiStockSetting([input.business, input.audience ?? ''].join(' . '))
  return {
    ...terms,
    ...(aiStockAdultsOnly([input.audience, input.name, input.business]) ? { adults: true } : {}),
    ...(setting ? { setting } : {}),
  }
}

/** What a source's photos are searched by: its world, as {@link aiStockSourceTerms} reads it. */
function sourceWorldTerms(
  input: Pick<AiLayoutStockPhotoSourceInput, 'business' | 'language' | 'photoWords' | 'kindWords' | 'name' | 'audience' | 'kind'>,
): AiStockSiteTerms {
  const english = aiStockSourceSubject(input)
  const terms = aiStockSiteTerms(english || input.business)
  if (english || (terms.domain.length && !aiStockIsAbbreviation(input.business))) return terms
  // A business type that names no world ("a local service business"), or
  // one the libraries do not know ("LMS"), is searched by the craft its
  // name, else its audience, names (AGL-3856): the beta.261 Synchronicity Gym
  // hero searched nothing at all and was left a black scrim, and its closing
  // band, held to no world, took a subway train for "Ready to train". Then by
  // the kind of site its name says ("Adult Hybrid Learning Center"), and
  // last by the kind of site the person picked: the beta.262 Adult Hybrid
  // Learning Center searched "lms" and shipped no photo at all.
  const craft = aiStockListedCraft(input.name ?? '') || aiStockListedCraft(input.audience ?? '')
  const kind = craft ? '' : aiStockNamedKind(input.name ?? '') || aiStockNamedKind(input.audience ?? '') || (input.kind ?? '')
  const found = craft ? aiStockSiteTerms(craft) : aiStockKindTerms(kind)
  if (!found) return terms
  return { ...found, named: [...new Set([...terms.named, ...found.named])] }
}

/**
 * Whether a business type is only an abbreviation the libraries do not know
 * (AGL-3856): "LMS", "CRM", "B2B". Its letters are no world to search.
 */
export function aiStockIsAbbreviation(businessType: string): boolean {
  const list = businessType.trim().split(/\s+/).filter(Boolean)
  return list.length > 0 && list.length <= 2 && list.every((word) => /^[A-Z0-9&/.-]{2,6}s?$/.test(word) && /[A-Z]/.test(word))
}

/**
 * What a picture of each kind of site the guided start offers shows, where
 * nothing else says (AGL-3856): the words it is searched by, the words a
 * photo of it is tagged with, and its broad searches. A kind whose subject
 * is a craft {@link CRAFT_KIN} lists takes that craft's own.
 */
const KIND_SUBJECTS: Readonly<
  Record<string, { subject: string; kin?: readonly string[]; broad?: readonly string[]; shunLead?: readonly string[] }>
> = {
  business: {
    subject: 'small business',
    kin: ['business', 'office', 'team', 'meeting', 'workplace', 'coworkers', 'entrepreneur', 'shop', 'service', 'customer'],
    broad: ['small business owner', 'team meeting office'],
  },
  trades: {
    subject: 'contractor',
    kin: ['contractor', 'construction', 'repair', 'renovation', 'tools', 'worker', 'handyman', 'plumber', 'electrician', 'house', 'roof'],
    broad: ['home repair contractor', 'construction worker tools'],
  },
  professional: {
    subject: 'consultant',
    kin: ['consultant', 'consulting', 'office', 'meeting', 'client', 'advisor', 'finance', 'accountant', 'lawyer', 'desk', 'business'],
    broad: ['consultant client meeting', 'professional office'],
  },
  wellness: {
    subject: 'wellness',
    kin: ['wellness', 'health', 'therapy', 'therapist', 'massage', 'spa', 'relaxation', 'clinic', 'healthcare'],
    broad: ['wellness therapy', 'massage therapy'],
  },
  restaurant: {
    subject: 'restaurant',
    kin: ['restaurant', 'dining', 'food', 'dish', 'chef', 'meal', 'cafe', 'cuisine', 'dinner', 'lunch'],
    broad: ['restaurant dining', 'restaurant food'],
  },
  store: {
    subject: 'boutique',
    kin: ['boutique', 'shop', 'store', 'shopping', 'retail', 'products', 'display', 'shelf'],
    broad: ['boutique shop', 'retail store display'],
  },
  portfolio: {
    subject: 'artist',
    kin: ['art', 'artist', 'design', 'creative', 'studio', 'workspace', 'painting', 'drawing'],
    broad: ['artist studio', 'creative workspace'],
    // "Artist" names a bee and a tattooist as often as a painter (AGL-3923):
    // the beta.266 Mexicano hero's first pick was "artist bee, giant artist bee".
    shunLead: ['bee', 'insect', 'insects', 'tattoo', 'makeup', 'cosmetics'],
  },
  studio: {
    subject: 'design studio',
    kin: ['design', 'designer', 'studio', 'creative', 'agency', 'team', 'workspace', 'office'],
    broad: ['design studio team', 'creative agency office'],
  },
  photography: { subject: 'photographer' },
  blog: {
    subject: 'writer',
    kin: ['writer', 'writing', 'notebook', 'laptop', 'desk', 'journal', 'reading', 'book'],
    broad: ['writer desk laptop', 'writing notebook'],
  },
  events: {
    subject: 'event',
    kin: ['event', 'celebration', 'party', 'wedding', 'venue', 'reception', 'gathering', 'decoration', 'banquet'],
    broad: ['event celebration', 'event venue decoration'],
  },
  fitness: { subject: 'gym' },
  yoga: {
    subject: 'yoga',
    kin: ['yoga', 'meditation', 'mindfulness', 'pose', 'mat', 'relaxation', 'stretching'],
    broad: ['yoga class', 'meditation'],
  },
  beauty: {
    subject: 'salon',
    kin: ['salon', 'beauty', 'hair', 'hairdresser', 'makeup', 'nails', 'manicure', 'stylist', 'spa', 'cosmetics'],
    broad: ['beauty salon', 'hair salon'],
  },
  realestate: {
    subject: 'real estate',
    kin: ['house', 'home', 'estate', 'property', 'interior', 'apartment', 'realtor', 'architecture', 'living'],
    broad: ['house exterior', 'home interior'],
  },
  education: {
    subject: 'classroom',
    kin: ['classroom', 'student', 'students', 'education', 'learning', 'e-learning', 'teacher', 'teaching', 'class', 'lecture', 'study', 'studying', 'course', 'school', 'seminar', 'training', 'book', 'books', 'laptop'],
    broad: ['adult students classroom', 'online learning', 'adult education'],
  },
  nonprofit: {
    subject: 'volunteers',
    kin: ['volunteer', 'volunteers', 'charity', 'helping', 'donation', 'nonprofit', 'team', 'people'],
    broad: ['charity volunteers', 'volunteers helping'],
  },
  music: {
    subject: 'musician',
    kin: ['music', 'musician', 'band', 'concert', 'guitar', 'stage', 'singer', 'instrument', 'piano', 'drums'],
    broad: ['live music band', 'musician guitar'],
  },
  personal: {
    subject: 'workspace',
    kin: ['workspace', 'desk', 'laptop', 'office', 'professional', 'notebook', 'coffee'],
    broad: ['workspace desk laptop', 'professional workspace'],
  },
  landing: {
    subject: 'startup team',
    kin: ['startup', 'team', 'technology', 'laptop', 'office', 'workspace', 'business', 'meeting'],
    broad: ['startup team office', 'modern workspace'],
  },
  'coming-soon': {
    subject: 'workspace',
    kin: ['workspace', 'desk', 'laptop', 'office', 'notebook', 'coffee'],
    broad: ['modern workspace', 'workspace desk laptop'],
  },
}

/** Words a business's name or audience uses for a kind of site (AGL-3856): "Learning Center" is a school's. */
const NAMED_KINDS: ReadonlyArray<{ words: readonly string[]; kind: string }> = [
  {
    kind: 'education',
    words: ['learning', 'academy', 'school', 'tutoring', 'tutor', 'tutors', 'college', 'institute', 'university', 'courses', 'classes', 'lessons', 'education', 'students', 'learners'],
  },
  { kind: 'beauty', words: ['salon', 'barber', 'barbershop', 'nails', 'spa', 'lashes', 'brows'] },
  { kind: 'realestate', words: ['realty', 'realtor', 'realtors', 'properties', 'homes', 'estate'] },
  { kind: 'restaurant', words: ['restaurant', 'bistro', 'kitchen', 'grill', 'diner', 'eatery', 'cafe', 'café', 'tavern', 'pizzeria'] },
  { kind: 'trades', words: ['plumbing', 'roofing', 'hvac', 'electric', 'electrical', 'landscaping', 'construction', 'contracting', 'remodeling', 'painting', 'handyman'] },
  { kind: 'nonprofit', words: ['foundation', 'charity', 'church', 'ministry', 'nonprofit', 'volunteers'] },
  { kind: 'yoga', words: ['yoga', 'meditation', 'mindfulness'] },
  { kind: 'music', words: ['band', 'music', 'orchestra', 'choir', 'records'] },
  { kind: 'wellness', words: ['wellness', 'therapy', 'massage', 'clinic', 'chiropractic', 'counseling'] },
]

/** The kind of site a business's name or audience names ({@link NAMED_KINDS}), or empty. */
export function aiStockNamedKind(text: string): string {
  const named = new Set(text.toLowerCase().split(/[^a-zÀ-ɏ]+/).filter(Boolean))
  return NAMED_KINDS.find((entry) => entry.words.some((word) => named.has(word)))?.kind ?? ''
}

/** What a kind of site's pictures are searched and judged by ({@link KIND_SUBJECTS}); `null` for a kind not listed. */
export function aiStockKindTerms(kind: string): AiStockSiteTerms | null {
  const entry = KIND_SUBJECTS[kind]
  if (!entry) return null
  const base = aiStockSiteTerms(entry.subject)
  if (!entry.kin?.length) return base
  const kin = entry.kin.map(aiStockStem)
  return {
    ...base,
    domain: [...new Set([...base.domain, ...kin])],
    broad: [...(entry.broad ?? base.broad)],
    // A hero names one of the kind's own words, never only the subject's.
    core: [...new Set([...base.core, ...kin])],
    ...(entry.shunLead?.length ? { shunLead: [...new Set([...base.shunLead, ...entry.shunLead.map(aiStockStem)])] } : {}),
  }
}

/**
 * The kind of site each starter is the shape of (`AiSiteKind.starter`): what
 * a picture is searched by, widened past the kind the person picked, where
 * nothing narrower found one (AGL-3923).
 */
const STARTER_KINDS: Readonly<Record<string, string>> = {
  business: 'business',
  'physical-shop': 'store',
  portfolio: 'portfolio',
  landing: 'landing',
}

/** A kind's common photos ({@link KIND_GENERIC}): the words searched, and the words one of which a hit must name. */
interface AiStockGenericSet {
  kin: readonly string[]
  broad: readonly string[]
}

const OFFICE: AiStockGenericSet = {
  kin: ['office', 'workspace', 'desk', 'laptop', 'computer', 'meeting', 'business', 'work', 'workplace', 'team', 'notebook', 'coffee', 'teamwork', 'conference'],
  broad: ['office workspace', 'business meeting', 'workspace desk laptop'],
}

const WORKSPACE: AiStockGenericSet = {
  kin: ['workspace', 'desk', 'laptop', 'notebook', 'coffee', 'office', 'book', 'books', 'workplace'],
  broad: ['workspace desk laptop', 'notebook coffee desk'],
}

/**
 * The last searches a picture tries, for each kind of site the guided start
 * offers (AGL-3923): plain, common photos of where that kind's work happens,
 * which every library holds many of, held to their own words. Never a face
 * as the lead, never a child, never a product nor a rival business: a
 * restaurant's are its tables and plates, never an office. A kind with no set
 * keeps a slot nothing fits without a photo (AGL-3831).
 */
const KIND_GENERIC: Readonly<Record<string, AiStockGenericSet>> = {
  business: OFFICE,
  trades: {
    kin: ['tools', 'tool', 'toolbox', 'workbench', 'workshop', 'construction', 'repair', 'renovation', 'drill', 'hammer', 'wrench', 'roof', 'house', 'carpentry'],
    broad: ['tools workbench', 'home renovation', 'construction tools'],
  },
  professional: {
    kin: ['office', 'desk', 'documents', 'document', 'meeting', 'conference', 'laptop', 'workplace', 'business', 'notebook', 'paperwork', 'consulting'],
    broad: ['office desk documents', 'business meeting', 'conference room'],
  },
  wellness: {
    kin: ['spa', 'massage', 'wellness', 'relaxation', 'relax', 'towel', 'towels', 'candle', 'stones', 'therapy', 'treatment', 'aromatherapy'],
    broad: ['spa stones towel', 'massage room', 'wellness spa'],
  },
  restaurant: {
    kin: ['restaurant', 'table', 'dining', 'food', 'plate', 'dish', 'meal', 'kitchen', 'cafe', 'dinner', 'lunch', 'cuisine'],
    broad: ['restaurant interior', 'restaurant table food', 'food plate'],
  },
  store: {
    kin: ['shop', 'store', 'retail', 'shelf', 'shelves', 'display', 'interior', 'boutique', 'storefront', 'counter'],
    broad: ['shop interior', 'retail store'],
  },
  portfolio: {
    kin: ['studio', 'workspace', 'desk', 'art', 'design', 'creative', 'sketch', 'drawing', 'paint', 'painting', 'brush', 'brushes', 'canvas', 'pencil', 'pencils', 'paper'],
    broad: ['art supplies', 'creative workspace', 'art studio'],
  },
  studio: {
    kin: ['design', 'studio', 'workspace', 'desk', 'laptop', 'sketch', 'creative', 'office', 'drawing', 'pencil'],
    broad: ['design studio workspace', 'creative workspace', 'workspace desk laptop'],
  },
  photography: {
    kin: ['camera', 'cameras', 'photography', 'lens', 'photographer', 'studio', 'film', 'tripod'],
    broad: ['camera lens', 'photography studio', 'vintage camera'],
  },
  blog: {
    kin: ['notebook', 'desk', 'writing', 'laptop', 'coffee', 'journal', 'book', 'books', 'workspace', 'pen', 'typewriter'],
    broad: ['writing desk notebook', 'laptop coffee desk'],
  },
  events: {
    kin: ['event', 'venue', 'wedding', 'reception', 'party', 'celebration', 'table', 'decoration', 'banquet', 'hall', 'flowers'],
    broad: ['event venue decoration', 'banquet table', 'party decoration'],
  },
  fitness: {
    kin: ['gym', 'fitness', 'weights', 'dumbbell', 'dumbbells', 'barbell', 'kettlebell', 'workout', 'exercise', 'training'],
    broad: ['gym equipment', 'dumbbells gym', 'fitness gym'],
  },
  yoga: {
    kin: ['yoga', 'mat', 'meditation', 'studio', 'relaxation', 'candle', 'zen', 'mindfulness'],
    broad: ['yoga mat', 'yoga studio', 'meditation candle'],
  },
  beauty: {
    kin: ['salon', 'beauty', 'hair', 'makeup', 'cosmetics', 'nails', 'manicure', 'spa', 'mirror', 'brush', 'brushes'],
    broad: ['beauty salon interior', 'makeup brushes cosmetics', 'hair salon chair'],
  },
  realestate: {
    kin: ['house', 'home', 'interior', 'living', 'room', 'property', 'architecture', 'apartment', 'kitchen', 'estate'],
    broad: ['house exterior', 'home interior living room', 'modern kitchen interior'],
  },
  education: {
    kin: ['classroom', 'books', 'book', 'library', 'school', 'desk', 'education', 'learning', 'study', 'studying', 'notebook', 'chalkboard', 'blackboard', 'lecture'],
    broad: ['library books', 'classroom', 'study desk books'],
  },
  nonprofit: {
    kin: ['volunteer', 'volunteers', 'volunteering', 'charity', 'donation', 'donations', 'community', 'helping', 'help', 'hands'],
    broad: ['volunteers charity', 'donation box', 'community volunteering'],
  },
  music: {
    kin: ['music', 'guitar', 'piano', 'instrument', 'instruments', 'concert', 'stage', 'microphone', 'drums', 'studio', 'vinyl'],
    broad: ['guitar instrument', 'concert stage lights', 'music studio microphone'],
  },
  personal: WORKSPACE,
  landing: {
    kin: ['office', 'workspace', 'desk', 'laptop', 'computer', 'meeting', 'business', 'work', 'workplace', 'team', 'technology', 'startup'],
    broad: ['modern office', 'workspace desk laptop', 'business meeting'],
  },
  'coming-soon': WORKSPACE,
}

/** The kind of site whose common photos each starter falls back to. */
const STARTER_GENERIC_KIND: Readonly<Record<string, string>> = {
  business: 'business',
  'physical-shop': 'store',
  portfolio: 'portfolio',
  landing: 'landing',
}

/** Stems no common photo leads with: a face, a portrait (AGL-3923). */
const FACE_STEMS = ['face', 'portrait', 'selfie', 'headshot'].map(aiStockStem)

/** The starter a kind of site follows ({@link STARTER_KINDS}); a kind not listed follows the business starter. */
function starterOfKind(kind: string): string {
  const starter = aiSiteKind(kind)?.starter ?? 'business'
  return STARTER_KINDS[starter] ? starter : 'business'
}

/** A kind of site's common photos as a world to search and judge by ({@link KIND_GENERIC}); `null` for a kind with no set. */
export function aiStockKindGenericTerms(kind: string): AiStockSiteTerms | null {
  const set = KIND_GENERIC[kind]
  if (!set) return null
  const kin = [...new Set(set.kin.map(aiStockStem))]
  return {
    business: '',
    craft: '',
    domain: kin,
    broad: [...set.broad],
    making: [],
    named: [],
    rivals: [],
    core: kin,
    shun: [],
    shunLead: [],
  }
}

/**
 * Whether a site's world is only its own words (AGL-3923): no craft this
 * module lists and no kind of site named it, so its broad searches are its
 * business and its craft read back ("freelencing"), which a library may not
 * know at all.
 */
export function aiStockWorldIsUnlisted(terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'broad'>): boolean {
  const own = [...new Set([terms.business, terms.craft].map((word) => word.trim()).filter(Boolean))]
  return terms.broad.length > 0 && terms.broad.length === own.length && terms.broad.every((query, index) => query === own[index])
}

/**
 * Whether a site's world agrees with the kind of site the person picked
 * (AGL-3923): it was read from the kind, or names one of the kind's own
 * words. A gym whose owner picked Business & services does not, and is never
 * given an office.
 */
function worldOfKind(terms: Pick<AiStockSiteTerms, 'craft' | 'broad' | 'domain'>, kind: string): boolean {
  const own = aiStockKindTerms(kind)
  if (!own) return false
  if (own.craft === terms.craft && own.broad.join('|') === terms.broad.join('|')) return true
  const words = new Set([...own.domain, ...(aiStockKindGenericTerms(kind)?.domain ?? [])])
  return terms.domain.some((stem) => words.has(stem))
}

/**
 * What a picture is searched by once nothing narrower found it a photo
 * (AGL-3923), widest last.
 *
 * - A site whose world is its own words alone ({@link aiStockWorldIsUnlisted})
 *   widens to the kind of site the person picked, the kind its starter is the
 *   shape of, and last the kind's own common photos ({@link KIND_GENERIC}),
 *   else its starter's.
 * - Any other site widens only to its kind's own common photos, and only
 *   where its world agrees with that kind ({@link worldOfKind}): a portfolio
 *   read from its kind takes art supplies before no photo at all, and a
 *   barbecue caterer whose kind says nothing of food never takes an office
 *   (AGL-3831). A kind with no set keeps a slot nothing fits without a photo.
 *
 * A rung that would search what an earlier one did is left out.
 *
 * The beta.265 Kasvora Marketing Solutions start (job BK3r4I8bF1) typed its
 * business as "Freelencing site offer services": its world was the one word
 * "freelencing", which no library tags, so its cover hero searched it, found
 * nothing, and shipped a flat dark band with no photo.
 */
export function aiStockWiderTerms(
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'broad' | 'domain'>,
  kind: string,
): Array<{ rung: 'kind' | 'starter' | 'generic'; terms: AiStockSiteTerms }> {
  const rungs: Array<{ rung: 'kind' | 'starter' | 'generic'; terms: AiStockSiteTerms }> = []
  const seen = new Set<string>([JSON.stringify([terms.craft, [...terms.broad]])])
  const add = (rung: 'kind' | 'starter' | 'generic', found: AiStockSiteTerms | null) => {
    if (!found || !found.broad.length) return
    const key = JSON.stringify([found.craft, found.broad])
    if (seen.has(key)) return
    seen.add(key)
    rungs.push({ rung, terms: found })
  }
  if (!aiStockWorldIsUnlisted(terms)) {
    if (kind && worldOfKind(terms, kind)) add('generic', aiStockKindGenericTerms(kind))
    return rungs
  }
  const starter = starterOfKind(kind)
  if (kind) add('kind', aiStockKindTerms(kind))
  add('starter', aiStockKindTerms(STARTER_KINDS[starter] ?? 'business'))
  add('generic', aiStockKindGenericTerms(kind) ?? aiStockKindGenericTerms(STARTER_GENERIC_KIND[starter] ?? 'business'))
  return rungs
}

/**
 * The first word of a text that names a craft {@link CRAFT_KIN} lists, as
 * its table writes it: "gym" of "Synchronicity Gym", "law" of "Hartwell
 * Reyes Family Law". Empty where it names none, so a name that is only a
 * name ("Hillside") never becomes a world.
 */
export function aiStockListedCraft(text: string): string {
  for (const stem of stemList(text))
    for (const group of CRAFT_KIN) {
      const word = group.match.find((match) => aiStockStem(match) === stem)
      if (word) return word
    }
  return ''
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
  // Where a picture's own world finds nothing, the wider worlds it tries (AGL-3923).
  const wider = aiStockWiderTerms(terms, input.kind ?? '')
  const unlisted = aiStockWorldIsUnlisted(terms)
  const proper = aiStockProperWords(input.business)
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
    /** The photos this page's slots have claimed, first choices, by slot order. */
    const shown: StockPhoto[] = []
    /** Asset srcs this page has placed. */
    const placedSrcs = new Set<string>()
    const answers = new Map<string, Promise<StockPhoto[] | null>>()
    /** The wider world a widened search is judged by (AGL-3923); a search not listed is judged by the site's. */
    const worldOf = new WeakMap<AiStockSearch, AiStockSiteTerms>()
    let searches = 0
    let storing = true
    /** Slots a photo was chosen for and could not be copied into the library (AGL-3923). */
    const uncopied = new Set<AiLayoutPictureSlot>()
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
      delete (request as AiStockSearch).strict
      delete (request as AiStockSearch).refuse
      delete (request as AiStockSearch).needs
      delete (request as AiStockSearch).allow
      delete (request as AiStockSearch).refuseLead
      delete (request as AiStockSearch).worldless
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
        proper,
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
        if (!bytes || signal.aborted || !storing) {
          // A copy the library would not hand over is otherwise silent (AGL-3923).
          if (!bytes && !signal.aborted) {
            uncopied.add(slot)
            console.warn('ai layout pictures: a stock photo could not be downloaded', { provider: photo.provider, id: photo.id })
          }
          return null
        }
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
        const refusal = stored as Extract<
          PluginMediaIngestResult,
          { ok: false }
        >
        // One photo's own bytes refused (AGL-3923): the beta.267 Brightvale
        // start's first pick, Pixabay 10157445, came labeled image/png and was
        // not PNG, and that one 415 stopped every copy on all four of its
        // pages, which then showed the starters' pottery bench and coffee
        // shop. Such a refusal is this photo's: the slot tries its next hit.
        const ofThisPhoto = AI_STOCK_PHOTO_OWN_REFUSALS.has(refusal.status)
        if (ofThisPhoto) {
          uncopied.add(slot)
          // Never tried again by this page's other slots, nor by the job's other pages.
          claimed.add(sourceKey)
          job?.set(sourceKey, REFUSED_BY_THE_LIBRARY)
        } else storing = false
        console.warn(
          'ai layout pictures: the media library refused a stock photo',
          {
            status: refusal.status,
            reason: refusal.reason,
            provider: photo.provider,
            id: photo.id,
            holds: ofThisPhoto ? 'this photo' : 'the page',
          },
        )
      } catch (error) {
        uncopied.add(slot)
        console.warn('ai layout pictures: a stock photo could not be kept', {
          error: String(error),
        })
      }
      return null
    }

    /**
     * How a search's hits are judged for a slot. On a site for adults alone no
     * hit names a child; a portrait of one of the business's people names an
     * adult, never leads with a child, and is preferred in its role (AGL-3856).
     */
    const judgementFor = (
      slot: AiLayoutPictureSlot,
      request: AiStockSearch,
      subject: string,
    ): AiStockJudgement => {
      const refuse = [...(request.refuse ?? []), ...(terms.adults ? CHILD_STEMS : [])]
      const role = slot.people ? aiStockPeopleRole(slot.alt, input.sectionNames[slot.sectionIndex] ?? '') : null
      return {
        ...judgementOf(slot, request, subject, worldOf.get(request) ?? terms),
        ...(refuse.length ? { refuse: [...new Set(refuse)] } : {}),
        // An occupation is shown in it (a teacher, a coach); a team is any adult at work.
        ...(slot.people
          ? {
              needs: request.needs?.length ? request.needs : role?.required ? role.kin : ADULT_PEOPLE_STEMS,
              refuseLead: [...new Set([...CHILD_STEMS, ...(request.refuseLead ?? [])])],
              ...(role ? { roles: role.kin } : {}),
              // A teacher is shown teaching, never posing or painting (AGL-3856).
              ...(role?.scene?.length ? { roleScene: role.scene } : {}),
              ...(role?.refuse?.length ? { roleRefuse: aiStockRoleRefusals(role, slot.alt) } : {}),
            }
          : {}),
      }
    }
    /**
     * A search's own judgement, as its words set it, held to the world it was
     * asked for: the site's own, or a wider one where the site's found nothing
     * (AGL-3923). What lets a sensitive topic in is always the site's own words.
     */
    const judgementOf = (
      slot: AiLayoutPictureSlot,
      request: AiStockSearch,
      subject: string,
      world: AiStockSiteTerms,
    ): AiStockJudgement => ({
      subject: request.subject ?? (request.broad ? '' : subject),
      domain: world.domain,
      strict:
        (slot.role === 'gallery' && !request.broad) || !!request.requires || !!request.strict,
      named: request.allow?.length ? [...new Set([...terms.named, ...request.allow])] : terms.named,
      rivals: world.rivals,
      ...(world.shun.length || request.shun?.length
        ? { shun: [...new Set([...world.shun, ...(request.shun ?? [])])] }
        : {}),
      ...(world.shunLead.length ? { shunLead: world.shunLead } : {}),
      ...(request.product ? { product: true } : {}),
      ...(request.leadAny?.length ? { leadAny: request.leadAny } : {}),
      ...(request.requires ? { requires: request.requires } : {}),
      ...(request.category ? { category: request.category } : {}),
      ...(request.object ? { object: request.object } : {}),
      ...(request.kin ? { kin: request.kin } : {}),
      ...(request.lead ? { lead: true } : {}),
      ...(request.leadWorld ? { leadWorld: true } : {}),
      ...(request.first ? { first: true } : {}),
      ...(request.refuse?.length ? { refuse: request.refuse } : {}),
      ...(request.needs?.length ? { needs: request.needs } : {}),
      ...(request.refuseLead?.length ? { refuseLead: request.refuseLead } : {}),
      // A portfolio's record is of its own subject, never of the craft's world (AGL-3856).
      ...(request.worldless ? { domain: [], rivals: [] } : {}),
    })
    /**
     * The craft's own photos, the last thing a slot of a craft's site is
     * filled from (AGL-3660): its broad searches, any hit naming the craft
     * itself. Never a desk, a laptop or a living room for a soap shop.
     */
    const craftSearches = (slot: AiLayoutPictureSlot, world: AiStockSiteTerms = terms): AiStockSearch[] => {
      // A portfolio's record of the work is never filled by the craft's own photos (AGL-3856).
      if (!world.core.length || aiStockShowsTheWork(slot, world)) return []
      const orientation = aiStockOrientation(slot.aspect)
      const size =
        slot.role === 'hero'
          ? { minWidth: 1600 }
          : orientation === 'vertical'
            ? { minHeight: 900 }
            : { minWidth: 900 }
      return world.broad.map((query) => ({
        query: clip(query),
        orientation,
        ...size,
        broad: true,
        category: world.core,
        ...(slot.role === 'hero' ? { first: true } : {}),
        ...(slot.product ? { product: true, tier: 'weak' as const } : {}),
      }))
    }

    /**
     * A slot's searches once its own world found it nothing (AGL-3923), in
     * order: the kind of site's world, the starter's, the slot's own words
     * alone held to no world, and last the starter's common photos. Each is
     * judged by the world it was asked for. A product, a portrait of the
     * business's people and a record's cover keep their own fallbacks.
     */
    const widerSearches = (slot: AiLayoutPictureSlot, subject: string, sectionName: string): AiStockSearch[] => {
      if (!wider.length || slot.product || slot.people || slot.record) return []
      const part = aiStockSlotPart(slot, sectionName)
      const asked: AiStockSearch[] = []
      const ask = (world: AiStockSiteTerms, requests: readonly AiStockSearch[]) => {
        for (const request of requests) {
          worldOf.set(request, world)
          asked.push(request)
        }
      }
      for (const { rung, terms: world } of wider) {
        if (rung === 'generic') continue
        ask(world, [...aiStockSearchesFor(slot, world, subject, part, sectionName), ...craftSearches(slot, world)])
      }
      const orientation = aiStockOrientation(slot.aspect)
      const size = slot.role === 'hero' ? { minWidth: 1600 } : orientation === 'vertical' ? { minHeight: 900 } : { minWidth: 900 }
      // The slot's own words, only where the site's world is its own words
      // alone, held to the kind's common world (AGL-3923), never to no world:
      // the beta.267 Brightvale closing band's "ready talk marketing" was
      // answered with a tin-can telephone, and its pets-and-owners answers
      // name no office either.
      const common = wider.find((rung) => rung.rung === 'generic')?.terms
      if (subject && unlisted && common) {
        const object = aiStockObjectWord(subject)
        const own = [...new Set([subject, object].map(clip).filter(Boolean))]
        ask(
          common,
          own.map((query) => ({ query, orientation, ...size, subject, strict: true })),
        )
      }
      // The kind's common photos: OF its world among their first tags, never
      // led by a face, never of a child (AGL-3923).
      for (const { rung, terms: world } of wider)
        if (rung === 'generic')
          ask(
            world,
            world.broad.map((query) => ({
              query: clip(query),
              orientation,
              ...size,
              broad: true,
              category: world.core,
              ...(slot.role === 'hero' ? { first: true } : { leadWorld: true }),
              refuse: CHILD_STEMS,
              refuseLead: FACE_STEMS,
            })),
          )
      return asked
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
              sectionName,
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
        // A photo the library refused for its own bytes is never a repeat either (AGL-3923).
        for (const hit of found) {
          const key = stockPhotoSourceKey(hit)
          if (job?.get(key) === REFUSED_BY_THE_LIBRARY) blocked.add(key)
        }
        const judgement = judgementFor(slot, request, subject)
        const ranked = aiStockRank(found, blocked, `${input.seed}:${index}:${request.query}`, judgement)
        // A team's portraits are of different people where the hits allow (AGL-3856).
        return slot.people && !repeat ? aiStockFreshShootsFirst(ranked, shown, judgement) : ranked
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
          if (!repeat) {
            claimed.add(stockPhotoSourceKey(ranked[0] as StockPhoto))
            shown.push(ranked[0] as StockPhoto)
          }
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
      // 3. Nothing of its own world at all: the wider worlds (AGL-3923), new
      //    and then, for a hero, one the job already shows.
      const widened = widerSearches(slot, subject, sectionName)
      const phases: Array<[readonly AiStockSearch[], boolean]> = [
        [sure, false],
        ...(repeats ? [[sure, true] as [readonly AiStockSearch[], boolean]] : []),
        ...(unsure.length
          ? [
              [unsure, false] as [readonly AiStockSearch[], boolean],
              [unsure, true] as [readonly AiStockSearch[], boolean],
            ]
          : []),
        ...(widened.length ? [[widened, false] as [readonly AiStockSearch[], boolean]] : []),
        ...(widened.length && repeats ? [[widened, true] as [readonly AiStockSearch[], boolean]] : []),
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
    // A slot whose fitting photo could not be copied was failed by the
    // library, as one that never answered is, and takes a starter rather
    // than lose its picture (AGL-3923).
    return answered && storing
      ? photos.map((photo, index) => photo ?? (uncopied.has(slots[index] as AiLayoutPictureSlot) ? null : AI_LAYOUT_NO_PHOTO))
      : photos
  }
}
