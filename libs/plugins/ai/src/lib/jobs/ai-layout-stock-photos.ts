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
 * 10. **The trade, never a word of it** (the 2026-10-25 booth kit, AGL-4065:
 *    six trades whose photos were race cars, cyclists, horses, a Honda
 *    scooter, a canoe for "Parts for the ranch", hotel buffets for a taco
 *    trailer and an office for a landscaper). A business named by two
 *    things ("Motorcycle and dirt bike repair shop") is both; the craft
 *    named first leads, never one named only in what a customer may ask
 *    ("takes catering requests"); a hero's first tag and a broad search's
 *    hit name the business's own world ({@link AiStockSiteTerms.lead}),
 *    never any word of its type ("race" of "race car"); a two-word world
 *    ("dirt bike") is named whole; a maker's name never shows; a sentence to
 *    the reader, a job or an order is never a subject, and a part or gear is
 *    searched only with its world; a record's cover is searched in its world
 *    first; and a listed world widens only where the library knew nothing of
 *    it, never an outdoor or a trade world to an office.
 * 11. **The thing, the place and the trade** (the 2026-10-28 live check,
 *    AGL-4092: a bare foot tagged "body part" for a parts shop's "Engine and
 *    air", a transmission chain for its "Brake Pad Set", a cat tagged "hungry"
 *    for a taco trailer's "Come hungry", a European alley for "Around town", a
 *    taco bowl salad for "Race day", and a man posing with a street bike tagged
 *    "susuki" in a motocross team's band of pictures). A picture of a thing is
 *    held to the business's own world, never any word of its type; a feeling,
 *    a time or a way of being somewhere is never a thing, and "around town" is
 *    the business's customers out there; a broad search's photo is OF the
 *    world among its first tags, never a "taco bowl"; an animal, a toy or a
 *    bare body part never leads a photo naming nothing of the world; a trade's
 *    things are held to the world it serves, never to "part"; a product takes
 *    a shoot no other product shows; a motocross business's world is
 *    off-road; and a maker is named one letter off ("susuki") and by its
 *    gear's and tires' names. Still by the tags: a mark only the pixels show
 *    is placed.
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

/**
 * The unit job input holding the photos another part of the job placed
 * outside its pages — a dataset's records — with their size and words
 * (AGL-3988): what a picture the library failed takes before any starter.
 */
export const AI_STOCK_PHOTO_JOB_PHOTOS_INPUT = 'stockPhotoJobPhotos'

/**
 * The unit job input a guided start's page is built under (AGL-3988): its
 * site step runs a late photo pass once every page is built, so a picture
 * the library failed that none of the job's photos fits yet keeps a neutral
 * starter for that pass to fill, rather than lose its frame, and the page
 * reports it. A page built by any other job keeps #1831's rule.
 */
export const AI_STOCK_PHOTO_LATE_PASS_INPUT = 'stockPhotoLatePass'

/** The job photos a unit input holds ({@link AI_STOCK_PHOTO_JOB_PHOTOS_INPUT}): library photos with a size; anything else is dropped. */
export function aiStockJobPhotosOf(value: unknown): AiLayoutPicturePhoto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const photo = entry as Partial<AiLayoutPicturePhoto> | null
    const src = typeof photo?.src === 'string' ? photo.src : ''
    const width = Number(photo?.width)
    const height = Number(photo?.height)
    if (!src.startsWith('media:') || !(width > 0) || !(height > 0)) return []
    const alt = typeof photo?.alt === 'string' ? photo.alt.trim() : ''
    return [{ src, width, height, ...(alt ? { alt } : {}) }]
  })
}

const words = (list: string) => new Set(list.trim().split(/\s+/))

/** Words that carry no subject. */
const STOPWORDS = words(
  'a an the and or of in on at to for with from by into onto over under near our your their my his her its ' +
    'this that these those is are be being was were who whom which where while as about than then very just ' +
    'small local best new top quality premium family-owned family owned independent professional ' +
    'business company services service page photo picture image showing shows show ' +
    'someone people person one two three some many several ' +
    // A sentence to the reader, never what a picture shows (AGL-4065): "Tell us
    // the bike and we will say if it will fit" searched "tell us bike".
    'we us you they them i me if tell say describe send ask need want get let know see find will would could',
)

/**
 * Words of a sentence to the reader that a business type may use as a name
 * ("IT support", "Fit club", "call center"): never a picture's subject
 * (AGL-4065), always a business's own word.
 */
const SENTENCE_WORDS = words('it fit can call')

/**
 * Nouns that never stand alone as what a picture shows (AGL-4065): a job, a
 * request, an order. "Describe your job" searched "handyman describe job" and
 * placed a job application form; "OEM ATV Parts Order" searched "atv parts
 * order" and placed trees tagged "order".
 */
const GENERIC_OBJECTS = words(
  'job jobs request requests order orders service services detail details thing things stuff action cta',
)

/**
 * Things a world has many of, which a photo shows only in that world
 * (AGL-4065): a part, gear, a machine. Searched only with the site's own
 * world ("dirt bike parts"), never alone: "parts" answered a canoe on a
 * river, tagged "part", for a dirt bike shop's "Parts for the ranch".
 */
const WORLD_OBJECTS = words('part parts gear gears machine machines equipment spare spares accessory accessories')

/**
 * Words of a picture's caption that are never the thing it shows (AGL-4092):
 * a feeling, a time, a way of being somewhere. "Come hungry" read its object
 * as "hungry" and took a cat tagged "hungry"; "Around town" read "town" and
 * took a European alley. A caption left with no thing is a picture of the
 * site's own world. A personal record is a feat, never a thing: "Deadlift PR
 * night" is of the deadlift.
 */
const NON_THINGS = words(
  'come hungry happy ready welcome day days night nights time times today tonight weekend weekends season seasons ' +
    'around town hours hour way moment moments memories pr pb',
)

/**
 * Where a business is, said as a place to go (AGL-4092): "Around town", "At
 * events". Never a street of houses: a picture of it shows the business's
 * customers out where it is, or its stand.
 */
const PLACE_PHRASES = /\b(?:around town|in town|downtown|on the road|out and about|at (?:the )?events|neighbou?rhoods?)\b/i

/** What a picture of a business out where it is shows, as stems: its people, a line, a street stand (AGL-4092). */
const PLACE_NEEDS = [
  'people', 'crowd', 'customer', 'customers', 'queue', 'line', 'street food', 'food truck', 'market', 'festival',
]

/** A street that is someone else's, never where a business is found (AGL-4092): a European alley for "Around town". */
const FOREIGN_STREET = [
  'alley', 'cobblestone', 'village', 'old town', 'historic', 'castle', 'cathedral', 'europe', 'landscape', 'architecture',
]

/**
 * The verbs a business type's clause opens with when it says what a customer
 * may ask of it (AGL-4065): "takes quote requests", "books repair
 * appointments". The verb is never the business's world.
 */
const TRANSACTION_VERBS = words('take takes taking book books booking accept accepts accepting welcome welcomes')

/**
 * What a business does with a customer, never what its photos show
 * (AGL-4065), as stems: dropped from its world. "Special orders" named
 * Berm & Bolt's world, so a delivery man's "order" and trees tagged "order"
 * filled its products.
 */
const TRANSACTION_STEMS: ReadonlySet<string> = new Set(
  // "Takes" and "books" are verbs only where they open a clause (TRANSACTION_VERBS): a bookshop's books are its world.
  'booking appointment order request quote estimate free inquiry pickup special around town'.split(' '),
)

/**
 * Words of a business's own clause that name its world only beside another
 * (AGL-4065): "race" and "team" of "amateur motocross race team" are a race
 * car's and an office's as often. Never its own world alone.
 */
const LEAD_GENERIC = words(
  'amateur pro race racing team club crew group repair repairs service home house food truck trailer mobile ' +
    'street event events custom family families',
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
 * Makers whose names a photo's tags or its page address give, which no
 * site's pictures carry unless its own words name the maker (AGL-4065): the
 * Rut Runners Racing heroes were race cars in a pit lane under their makers'
 * logos, and Holeshot Moto Repair's a Honda scooter and an Indian cruiser. A
 * name that is also a common word ("apple", "puma", "triumph", "indian") is
 * named only in the phrase that makes it the maker's. Read from the tags and
 * the address, so a logo no tag names still shows: the live check is where
 * that is seen.
 */
/** The one-word makers of riding gear and tires (AGL-4092), also never said in a photo's description ({@link BRANDS}). */
const GEAR_MAKER_WORDS = [
  'alpinestars', 'oneal', 'leatt', 'arai', 'shoei', 'agv', 'oakley', 'renthal', 'fmf', 'acerbis', 'dunlop', 'michelin',
  'pirelli', 'bridgestone', 'metzeler', 'maxxis', 'kenda',
]

const MAKERS = [
  'porsche', 'ferrari', 'lamborghini', 'bmw', 'mercedes', 'audi', 'volkswagen', 'vw', 'toyota', 'honda', 'yamaha',
  'kawasaki', 'suzuki', 'ktm', 'ducati', 'harley', 'harley-davidson', 'husqvarna', 'gasgas', 'tesla', 'ford',
  'chevrolet', 'chevy', 'dodge', 'jeep', 'nissan', 'subaru', 'mazda', 'indian motorcycle', 'triumph motorcycle',
  'gran turismo', 'playstation', 'xbox', 'nintendo', 'nike', 'adidas', 'reebok', 'red bull', 'monster energy',
  'coca cola', 'cocacola', 'pepsi', 'iphone', 'ipad', 'macbook', 'imac', 'samsung', 'starbucks', 'mcdonalds',
  'mcdonald',
  // A rider's gear and a bike's tires carry their makers' marks as often as
  // the bike does (AGL-4092). A maker whose name is a common word ("fox",
  // "shift", "thor", "fly", "bell") is named only in its phrase.
  ...GEAR_MAKER_WORDS,
  'fox racing', 'shift mx', 'shift racing', 'thor mx', 'fly racing', 'troy lee', 'bell helmets', 'pro taper',
]

/** The makers as stems and stem phrases, as a hit's words are read. */
const MAKER_STEMS: ReadonlySet<string> = new Set(MAKERS.map((maker) => stemList(maker).join(' ')))

/**
 * The one-word makers long enough that a tag one letter off still names them
 * (AGL-4092): Pixabay's "susuki" is a Suzuki. Never a common word one letter
 * off a maker: "barley" is not a Harley, nor "rental" a Renthal.
 */
const FUZZY_MAKERS: readonly string[] = [...MAKER_STEMS].filter((maker) => !maker.includes(' ') && maker.length >= 6)

/** Words one letter off a maker that are words of their own (AGL-4092). */
const MAKER_LOOKALIKES = words('barley parley harlem rental samsun ducat phone suzuka')

/** Whether two words are one edit apart: a letter changed, added, dropped, or two side by side swapped. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const differ = [...a].flatMap((letter, index) => (letter === b[index] ? [] : [index]))
    if (differ.length === 1) return true
    const [first, second] = differ as [number, number]
    return differ.length === 2 && second === first + 1 && a[first] === b[second] && a[second] === b[first]
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  let index = 0
  while (index < short.length && short[index] === long[index]) index += 1
  return short.slice(index) === long.slice(index + 1)
}

/** The maker a word names one letter off, else `null` ({@link FUZZY_MAKERS}). */
function fuzzyMaker(word: string): string | null {
  if (word.length < 5 || MAKER_LOOKALIKES.has(word) || MAKER_STEMS.has(word)) return null
  return FUZZY_MAKERS.find((maker) => oneEditApart(word, maker)) ?? null
}

/**
 * A phrase's words and each pair of them in turn, as stems (AGL-4065): "dirt
 * bike" names the motocross world where "bike" alone names a bicycle's too.
 */
function withPairs(list: readonly string[]): string[] {
  const out = [...list]
  for (let index = 0; index + 1 < list.length; index += 1) out.push(`${list[index]} ${list[index + 1]}`)
  return out
}

/** A text's stems and stem pairs, every tag or phrase read on its own. */
function termsOf(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap((text) => withPairs(stemList(text))))
}

/** A word or phrase as stems: "dirt bikes" is "dirt bike". */
const stemPhrase = (phrase: string) => stemList(phrase).join(' ')

/**
 * A tag that says what a photo suits, never what it shows (AGL-4065):
 * "samsung wallpaper", "iphone wallpaper", "lock screen". A latte tagged so
 * shows no phone.
 */
const SUITS = /\b(?:wallpapers?|backgrounds?|screens?|screensavers?|lockscreen|4k|hd)\b/i

/** The words a photo names a maker by: its tags, those of what it suits left out, its description and its page address. */
function aiStockMakerTerms(photo: Pick<StockPhoto, 'tags' | 'alt' | 'pageUrl'>): Set<string> {
  const tags = (photo.tags ?? []).filter((tag) => !SUITS.test(tag))
  // "O'Neal" is one name, never "neal" (AGL-4092).
  return termsOf([...tags, photo.alt ?? '', pageSlug(photo.pageUrl)].map((text) => text.replace(/['’]/g, '')))
}

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
 * The worlds a drink is sold in (2026-10-29, AGL-4092): where "water" on a
 * menu is a bottle of it, never a lake, and a "drink" a soda.
 */
const FOOD_WORLDS = [
  'taco', 'taqueria', 'burrito', 'mexican food', 'street food', 'food truck', 'food', 'restaurant', 'cafe', 'caterer',
  'catering', 'menu', 'meal', 'cuisine', 'bakery', 'deli', 'pizza', 'burger', 'barbecue', 'bbq', 'diner',
]

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
  {
    // A rider's gear is what they wear (AGL-4065): "Riding Gear Item" took a
    // gear wheel of a transmission, tagged "gear, mechanics, bikes".
    objects: ['gear'],
    within: ['motocross', 'motorcycle', 'motorbike', 'dirtbike', 'dirt bike', 'enduro', 'atv'],
    kin: [
      'riding gear',
      'motocross gear',
      'protective gear',
      'helmet',
      'helmets',
      'motocross helmet',
      'motorcycle helmet',
      'jersey',
      'boots',
      'goggles',
      'gloves',
    ],
    queries: ['motocross gear', 'motocross helmet'],
  },
  {
    // A dirt bike's tire is knobby; a car's on a highway is not one (AGL-4065).
    objects: ['tire'],
    within: ['motocross', 'motorcycle', 'motorbike', 'dirtbike', 'dirt bike', 'enduro', 'atv'],
    kin: ['tire', 'tires', 'knobby tire', 'motocross tire', 'dirt bike tire', 'motorcycle tire', 'bike tire', 'wheel'],
    queries: ['dirt bike tire', 'motocross tire'],
  },
  {
    // A brake pad is a brake's (AGL-4092): "Brake Pad Set" found nothing by its
    // pad, then searched "part" alone and took a transmission chain.
    objects: ['brake', 'pad', 'rotor', 'caliper'],
    within: ['motocross', 'motorcycle', 'motorbike', 'dirtbike', 'dirt bike', 'enduro', 'atv'],
    kin: ['brake', 'brakes', 'brake pad', 'brake pads', 'brake disc', 'brake caliper', 'disc brake', 'brake rotor'],
    queries: ['motorcycle brake disc', 'dirt bike brake'],
  },
  {
    // An engine's air is its filter's (AGL-4092): "Engine and air" tiled a
    // collection with a bare foot tagged "body part".
    objects: ['engine', 'filter', 'air', 'carburetor'],
    within: ['motocross', 'motorcycle', 'motorbike', 'dirtbike', 'dirt bike', 'enduro', 'atv'],
    kin: ['engine', 'air filter', 'motorcycle engine', 'dirt bike engine', 'carburetor'],
    queries: ['dirt bike engine', 'motorcycle engine'],
  },
  {
    // A taco trailer is a food truck, never a tank truck at a rest stop (AGL-4092).
    objects: ['trailer', 'truck'],
    within: ['taco', 'taqueria', 'burrito', 'mexican food', 'street food', 'food truck'],
    kin: ['food truck', 'food trailer', 'taco truck', 'taco trailer', 'street food truck'],
    queries: ['taco truck', 'food truck'],
  },
  {
    // A taco trailer's chips are tortilla chips, never crisps or a cookie's (AGL-4092).
    objects: ['chip'],
    within: ['taco', 'taqueria', 'burrito', 'mexican food', 'street food', 'food truck'],
    kin: ['tortilla chip', 'tortilla chips', 'chips and salsa', 'chips salsa', 'nachos', 'nacho'],
    queries: ['tortilla chips salsa', 'nachos'],
  },
  {
    // A fountain drink is a soda, never a well's fountain (AGL-4092).
    objects: ['drink', 'soda', 'cola'],
    within: FOOD_WORLDS,
    // Never "fountain drink" itself: a well's page address says it word for word.
    kin: ['soda', 'soft drink', 'iced tea', 'agua fresca', 'lemonade', 'soda cup', 'soda can', 'soda bottle', 'cola'],
    queries: ['soda cup', 'agua fresca'],
  },
  {
    // Bottled water is a bottle of water (2026-10-29, AGL-4092): Pit Row
    // Tacos' "Bottled Water" searched "taco water", then its broad "tacos",
    // and took tomatoes beside a bowl of salsa.
    objects: ['water'],
    within: FOOD_WORLDS,
    kin: ['bottled water', 'water bottle', 'bottle of water', 'mineral water', 'drinking water', 'sparkling water'],
    queries: ['bottled water', 'water bottle'],
  },
  {
    // An agua fresca is a glass of fruit water, never a taco (2026-10-29, AGL-4092).
    objects: ['fresca', 'horchata', 'lemonade', 'limeade'],
    within: FOOD_WORLDS,
    kin: ['agua fresca', 'horchata', 'lemonade', 'limeade', 'fruit water', 'fruit drink', 'infused water', 'fruit juice'],
    queries: ['agua fresca', 'lemonade'],
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
        entry.within.some((word) => world.includes(stemPhrase(word))),
    ) ?? null
  )
}

/**
 * Whether a record's or a product's thing is a photo of itself alone
 * (2026-10-29, AGL-4092): its object has kin ({@link OBJECT_KIN}), and
 * neither its words nor its kin name the craft itself ({@link AiStockSiteTerms.core}).
 * Pit Row Tacos' "Bottled Water" is bottled water: no photo of the taco
 * trailer's world is one, and its broad "tacos" took tomatoes beside a bowl
 * of salsa. A soap shop's "Lavender Soap Bar" names its soap, and a soap's
 * photo still shows it. Such a thing is searched by its own words and kin
 * alone, never by the craft's photos, and takes none of another record's.
 * Pure.
 */
export function aiStockThingOfItsOwn(subject: string, terms: Pick<AiStockSiteTerms, 'domain' | 'core'>): boolean {
  const object = aiStockObjectWord(subject)
  if (!object) return false
  const kin = objectKin(object, [...terms.domain, ...stemList(subject)])
  if (!kin) return false
  const core = new Set(terms.core)
  const namesCore = (phrase: string) => withPairs(stemList(phrase)).some((term) => core.has(term))
  return !namesCore(subject) && !kin.kin.some(namesCore)
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
  /**
   * The worlds a trade of this kind serves, one of which the business type
   * must name for the trade to be listed, and then the trade is its craft
   * (AGL-4065): "parts" is a dirt bike shop's craft, its world the motocross
   * group's.
   */
  of?: readonly string[]
  /**
   * Words a photo of the world names beside its own, which say the world
   * only together with them (AGL-4065): a rider, a helmet, a track. Its
   * world's words for a picture of a thing, never what a hero or a broad
   * search is held to.
   */
  near?: readonly string[]
  /**
   * The names of the group's wider world, which lead a business's own world
   * only where its own words say them (AGL-4092): "motorcycle" is a street
   * bike's as often as a dirt bike's. A motocross team's own world is its
   * off-road names; a hit naming only "motorcycle" among its first tags
   * shows it no more than a man posing with a street bike does. Their
   * photos' own subjects (`shunLead`) are then never the business's.
   *
   * `road` and `ground` read every tag of such a business's pictures
   * (2026-10-29, AGL-4092): a photo naming a road, a trip or a rider's suit
   * is a street bike's unless it also names the ground an off-road bike
   * rides ({@link AiStockSiteTerms.road}). Rut Runners Racing's sponsors band
   * took a man in a motorcycle suit on a street bike, tagged "motocross"
   * third and "trip", "to travel", "vacations" later; its riders band a
   * model posing with a street bike in a garage, tagged "road" seventeenth.
   */
  wider?: { words: readonly string[]; shunLead: readonly string[]; road?: readonly string[]; ground?: readonly string[] }
  /**
   * What a picture of the business out where it is asks for (AGL-4092):
   * "Around town" is a taco trailer's customers in line, never a street of
   * houses. A world not listing them asks for its own customers.
   */
  out?: readonly string[]
  /**
   * A team of the craft's world, where the business's own words say it is
   * one (2026-10-29, AGL-4092): its pictures of the craft at work are its
   * riders and their racing, never the repair shop's `making`. Rut Runners
   * Racing's riders band searched "motorcycle workshop" and took a model
   * posing with a street bike in a garage. `broad` is added to the group's.
   */
  team?: { words: readonly string[]; making: readonly string[]; broad?: readonly string[] }
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
  // The six trades of the 2026-10-25 booth kit (AGL-4065), none of which the
  // table listed: a landscaper and a handyman widened to an office, three
  // motocross businesses took race cars, cyclists, horses and scooters, and a
  // taco trailer that also takes catering requests was read as a caterer.
  {
    // A landscaper's photos are lawns, beds and gardens at work; a zen garden
    // of raked sand is not one (Bluebonnet's irrigation section).
    match: [
      'landscaping', 'landscaper', 'landscapers', 'lawn', 'lawns', 'xeriscape', 'xeriscaping', 'sod', 'irrigation',
      'hardscape', 'hardscaping', 'gardening', 'gardener', 'gardeners',
    ],
    kin: [
      'landscaping', 'landscape', 'landscaper', 'lawn', 'grass', 'garden', 'yard', 'mower', 'mowing', 'lawn mower', 'turf',
      'hedge', 'shrub', 'mulch', 'sprinkler', 'planting', 'flowerbed', 'flower bed', 'backyard', 'gardening', 'gardener',
      'xeriscape', 'sod', 'irrigation',
    ],
    broad: ['lawn care', 'landscaping garden', 'garden landscaping'],
    making: ['landscaper mowing lawn', 'gardener planting'],
    shunLead: ['zen', 'sand', 'office', 'business', 'desk', 'laptop', 'meeting', 'golf', 'stadium'],
  },
  {
    // A handyman's photos are tools and repairs; never an architect's house
    // with a family before it, nor a job application (Two Oaks).
    match: ['handyman', 'handymen', 'repairman', 'drywall', 'remodel', 'remodeling', 'remodeler', 'renovation', 'renovations', 'home repair'],
    kin: [
      'handyman', 'tools', 'tool', 'tool belt', 'toolbox', 'drill', 'hammer', 'screwdriver', 'wrench', 'ladder', 'workshop',
      'repair', 'home repair', 'carpenter', 'carpentry', 'renovation', 'remodel', 'deck', 'fence', 'door', 'wall', 'plaster',
      'drywall', 'construction',
    ],
    broad: ['handyman tools', 'home repair', 'carpenter workshop'],
    making: ['handyman at work', 'handyman drilling'],
    shunLead: ['architecture', 'family', 'office', 'application', 'job', 'business', 'meeting', 'desk', 'laptop'],
  },
  {
    // Motocross and the motorcycle world: a dirt bike, never a bicycle, a
    // race car, a horse or a scooter (Rut Runners, Holeshot, Berm & Bolt).
    match: [
      'motocross', 'motorcycle', 'motorcycles', 'motorbike', 'motorbikes', 'dirtbike', 'dirtbikes', 'dirt bike', 'enduro',
      'supercross', 'moto', 'mx', 'atv', 'quad bike', 'powersports',
    ],
    kin: [
      'motocross', 'dirt bike', 'dirtbike', 'enduro', 'supercross', 'motorbike', 'motorcycle', 'mx', 'atv', 'quad bike',
      'motocross track', 'motocross rider', 'dirt track',
    ],
    near: ['rider', 'riders', 'helmet', 'jump', 'track', 'mud', 'dust', 'berm', 'racing', 'race', 'racer'],
    broad: ['motocross', 'dirt bike', 'motocross race', 'motocross rider'],
    making: ['motorcycle mechanic', 'motorcycle workshop'],
    rivals: {
      words: [
        'bicycle', 'bicycles', 'cycling', 'cyclist', 'cyclists', 'cycle racing', 'bike race', 'road bike', 'mountain bike',
        'mtb', 'downhill', 'car', 'cars', 'race car', 'formula', 'kart', 'karting', 'horse', 'horses', 'equestrian', 'scooter',
        'moped', 'vespa', 'cruiser', 'chopper',
      ],
      core: ['motocross', 'motorcycle', 'motorbike', 'dirt bike', 'dirtbike', 'supercross', 'atv', 'quad bike'],
    },
    shunLead: ['car', 'scooter', 'moped', 'cruiser', 'chopper', 'vespa', 'bicycle', 'cyclist', 'horse', 'highway', 'asphalt', 'traffic'],
    // A motocross team's "Gate drop" took a man posing with a street bike, tagged "man, model, motorcycle" (AGL-4092).
    wider: {
      words: ['motorcycle', 'motorcycles', 'motorbike', 'motorbikes', 'moto'],
      shunLead: ['model', 'urban', 'street', 'road bike', 'road racing', 'sportbike', 'superbike', 'studio', 'posing'],
      // Never "garage" or "workshop": a parts shop's mechanic works in one.
      road: [
        'road', 'roads', 'street', 'streets', 'highway', 'asphalt', 'traffic', 'city', 'urban', 'travel', 'trip', 'road trip',
        'vacation', 'touring', 'tourer', 'motorcycle suit', 'leathers', 'sportbike', 'sport bike', 'sports bike', 'superbike',
        'super bike', 'cafe racer', 'model', 'posing', 'studio',
      ],
      ground: [
        'dirt', 'mud', 'muddy', 'dust', 'dusty', 'sand', 'sandy', 'dune', 'dunes', 'desert', 'gravel', 'trail', 'terrain',
        'off-road', 'offroad', 'track', 'dirt track', 'grass track', 'motocross track', 'jump', 'berm', 'dirt bike', 'dirtbike',
        'enduro', 'supercross',
      ],
    },
    // A team's riders in their gear and their racing (AGL-4092): the library
    // answers "motocross paddock" with horses and "motocross pits" with
    // avocados, so neither is asked.
    team: {
      words: ['team', 'teams', 'club', 'clubs', 'squad'],
      making: ['motocross rider gear', 'dirt bike racing'],
      broad: ['motocross track'],
    },
  },
  {
    // A parts shop of the motocross world: its parts, tires and riding gear,
    // never a canoe, a delivery or an industrial lathe (Berm & Bolt).
    match: ['parts', 'part', 'aftermarket', 'oem', 'spare parts'],
    of: ['motocross', 'motorcycle', 'motorbike', 'dirtbike', 'dirt bike', 'enduro', 'supercross', 'moto', 'atv', 'quad bike', 'powersports'],
    kin: ['parts', 'part', 'spare part', 'motorcycle parts', 'tire', 'tires', 'wheel', 'chain', 'sprocket', 'brake', 'exhaust', 'riding gear', 'helmet'],
    broad: ['dirt bike parts', 'motorcycle parts', 'motocross gear'],
    making: ['motorcycle mechanic', 'motorcycle workshop'],
    shunLead: ['canoe', 'river', 'delivery', 'food', 'trees', 'office', 'industry', 'industrial', 'factory'],
  },
  {
    // A taco trailer's photos are tacos and the truck, never a hotel's buffet,
    // a chef in whites or raw potatoes (Pit Row Tacos).
    match: ['taco', 'tacos', 'taqueria', 'taco truck', 'taco trailer', 'burrito', 'burritos'],
    kin: [
      'taco', 'tacos', 'tortilla', 'tortillas', 'salsa', 'mexican', 'mexican food', 'food truck', 'taco truck',
      'griddle', 'burrito', 'quesadilla', 'nachos', 'guacamole', 'carnitas', 'pastor', 'asada',
    ],
    // Street food is anyone's (2026-10-29, AGL-4092): a man with a cart in
    // the rain and a woman with a bagel cart in Antalya, tagged "street food",
    // filled Pit Row Tacos' gallery. It names the trailer's world only beside
    // its own food or its truck.
    near: ['street food'],
    // Its truck is a taco truck: an ice cream van or a hot dog stand tagged
    // "food truck" is another trailer's (2026-10-29, AGL-4092).
    rivals: {
      words: [
        'ice cream', 'gelato', 'dessert', 'hot dog', 'hotdog', 'pizza', 'burger', 'burgers', 'crepe', 'crepes', 'donut',
        'doughnut', 'kebab', 'sushi', 'popcorn', 'cotton candy', 'waffle', 'pretzel', 'bagel', 'simit', 'fruit stand',
      ],
      core: ['taco', 'tacos', 'taqueria', 'tortilla', 'tortillas', 'burrito', 'quesadilla', 'nachos', 'salsa', 'mexican'],
    },
    broad: ['tacos', 'street tacos', 'taco truck'],
    making: ['taco truck cooking', 'tacos on the griddle'],
    out: ['food truck crowd', 'street food customers', 'taco stand customers'],
    shunLead: ['buffet', 'hotel', 'fine dining', 'chef', 'indian', 'potato', 'banquet', 'cafeteria', 'wedding'],
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

/** One clause of a business type ({@link businessClauses}). */
interface AiStockClause {
  /** The word that opened it: a break's, "|" after a verb of making, "" for the first. */
  opener: string
  words: string[]
  /**
   * Where the business's own clause was a noun phrase joined to the one before
   * it by "and" (AGL-4065): the second, which holds the head ("dirt bike
   * repair shop" of "Motorcycle and dirt bike repair shop").
   */
  joined?: string[]
  /** Whether it says what a customer may ask of the business: "takes quote requests" (AGL-4065). */
  asked?: boolean
}

/** A clause's words that name the business: no site kind, no filler. */
const businessOf = (clause: readonly string[]) =>
  clause.filter((word) => !SITE_KINDS.has(word) && !FILLER.has(word))

/**
 * A business type's clauses, each with the word that opened it. Where the
 * business's own clause is a word or two joined by "and" to a noun phrase
 * that ends in a place of business ("Motorcycle and dirt bike repair shop",
 * "Dirt bike and ATV parts shop"), the two are one clause (AGL-4065): the
 * Holeshot start read its business as "motorcycle" and lost the dirt bikes,
 * Berm & Bolt's as "dirt bike" and its craft as "bike". "And" before a verb
 * or a place still ends the clause. A clause that opens with what a customer
 * may ask ("takes", "books") loses that verb.
 */
function businessClauses(businessType: string): AiStockClause[] {
  const text = businessType.toLowerCase().replace(DOING, ' | ')
  const clauses: AiStockClause[] = []
  const breaker = new RegExp(`${BUSINESS_BREAK.source}|\\|`, 'g')
  let at = 0
  let opener = ''
  const push = (raw: string) => {
    const found = contentWords(raw)
    // Never the type's first words: "Books and coffee" sells books.
    const asked = opener !== '' && found.length > 1 && TRANSACTION_VERBS.has(found[0] ?? '')
    clauses.push({ opener, words: asked ? found.slice(1) : found, ...(asked ? { asked: true } : {}) })
  }
  for (const match of text.matchAll(breaker)) {
    push(text.slice(at, match.index))
    opener = match[0].trim()
    at = (match.index ?? 0) + match[0].length
  }
  push(text.slice(at))
  const own = clauses.findIndex((clause) => businessOf(clause.words).length > 0)
  const first = clauses[own]
  const next = clauses[own + 1]
  if (first && next && (next.opener === 'and' || next.opener === '&')) {
    const left = businessOf(first.words)
    const right = businessOf(next.words)
    const head = right[right.length - 1] ?? ''
    if (
      left.length <= 2 &&
      left.every((word) => !VENUES.has(word) && !ROLES.has(word)) &&
      right.length >= 2 &&
      VENUES.has(head)
    )
      clauses.splice(own, 2, { opener: first.opener, words: [...first.words, ...next.words], joined: next.words })
  }
  return clauses
}

/**
 * The kind of business in a few words: the first clause of the business
 * type that says more than what kind of site it is, before a place, an
 * audience or what it makes, filler dropped, its last three words (the head
 * of an English noun phrase is at its end). "ceramic artist" from "a
 * portfolio for a ceramic artist who makes stoneware bowls"; "candle shop"
 * from "a small-batch candle shop selling hand-poured soy candles online".
 * A business named by two things joined by "and" is its second noun phrase
 * whole: "dirt bike repair shop" of "Motorcycle and dirt bike repair shop"
 * (AGL-4065).
 */
export function aiStockBusinessWords(businessType: string): string {
  for (const { words: clause, joined } of businessClauses(businessType)) {
    const named = businessOf(clause)
    if (joined) return businessOf(joined).slice(-4).join(' ')
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
  /**
   * The business's own world (AGL-4065): the listed crafts its own clause
   * names, their names and kin, and its own words where no craft covers
   * them, as stems and stem pairs ("dirt bike"). What a hero's first tag and a
   * broad search's hit name. Its whole domain where no craft is listed.
   */
  lead?: string[]
  /**
   * The world a trade serves, as its type names it, where the craft is the
   * trade ("dirt bike" for a parts shop's craft "part", AGL-4065): what its
   * pictures are qualified by in place of the craft.
   */
  leadWord?: string
  /**
   * What a trade's pictures of a thing must name, where the craft is the
   * trade (AGL-4092): the names of the world it serves ("dirt bike",
   * "motocross"), never its craft. A parts shop's "part" named a bare foot
   * tagged "body part" and a transmission tagged "mechanical part".
   */
  held?: string[]
  /** What a picture of the business out where it is asks for ({@link CRAFT_KIN}, AGL-4092). */
  out?: string[]
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
  /**
   * A street bike's words, as stems, which no picture of an off-road
   * business carries anywhere among its tags unless it names the `ground`
   * too, or the slot or the brief names them (2026-10-29, AGL-4092): a man in
   * a motorcycle suit on a road trip, tagged "motocross", is a street bike.
   */
  road?: string[]
  /** The ground an off-road bike rides, as stems: dirt, sand, a track ({@link road}). */
  ground?: string[]
  /** Whether the site is for adults alone, so no photo of a child is placed on it ({@link aiStockAdultsOnly}, AGL-3856). */
  adults?: boolean
  /** Where the site's own words set its pictures ({@link aiStockSetting}): a record's moment is set there where its words say nowhere (AGL-3856). */
  setting?: string
  /** The craft's maker and tools as stems, which a record of its work never leads with ({@link CRAFT_KIN}, AGL-3856). */
  maker?: string[]
  /**
   * What a craft whose pictures are people at a moment shows wherever a page
   * would show its maker ({@link aiStockWorkScenes}, AGL-3942): the scenes
   * its site's own words name, set where the site is.
   */
  work?: AiStockScene[]
}

/** A word or phrase of a group's list, as stems: what a business type and a hit are read for. */
const groupTerm = (word: string) => stemPhrase(word)

/**
 * The site's terms, read from its business type.
 *
 * Two worlds are read (AGL-4065). Its DOMAIN is everything its words name
 * of its world, what a picture of a thing is held to. Its LEAD is the
 * business's own world: the listed crafts its own clause names (and the
 * craft's), their names and kin, and the clause's own words where no craft
 * covers them, never a word that names a world only beside another ("race",
 * "team") nor what a customer is asked to do. A hero's first tag and a broad
 * search's hit name the lead: the Rut Runners heroes, held to every word of
 * "Amateur motocross race team: rider profiles, race schedule…", took race
 * cars because "race car" named "race". Of the crafts its words list, the one
 * named first leads (a taco trailer that "takes catering requests" is a taco
 * trailer), and a craft named only in what a customer may ask for gives the
 * site no searches of its own.
 */
export function aiStockSiteTerms(businessType: string): AiStockSiteTerms {
  let business = aiStockBusinessWords(businessType)
  let craft = aiStockCraftWords(business)
  const domain = new Set<string>()
  /** The things it makes, by their head nouns. */
  const made = new Set<string>()
  /** Stems and stem pairs of every clause that names its world, and of those that only say what it is asked for. */
  const said = new Set<string>()
  const asked = new Set<string>()
  /** The business's own clause, as stems and stem pairs: what its lead is read from. */
  let own: string[] = []
  /** Every word of the business's own clause, those naming a world only beside another kept: "team" of "motocross race team". */
  let ownAll: string[] = []
  let ownSeen = false
  /** The last word of the first clause that names the world: "soap" of "for handmade cold-process soap". */
  let firstWorld = ''
  let named = false
  let making = false
  let place = false
  for (const { opener, words: clause, asked: isAsked } of businessClauses(businessType)) {
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
    if (!ownSeen && businessOf(clause).length) {
      ownSeen = true
      own = kept.filter((word) => !LEAD_GENERIC.has(word))
      ownAll = kept
    }
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
    for (const term of termsOf([kept.join(' ')])) (isAsked ? asked : said).add(term)
    const last = world[world.length - 1]
    if (!firstWorld && last) firstWorld = aiStockStem(last)
    if (making)
      for (const word of kept.slice(-1))
        for (const stem of stemList(word)) made.add(stem)
  }
  // A business named only by what it sells ("a shop selling pottery") is of that world.
  if (!domain.size) for (const stem of made) domain.add(stem)
  const typeStems = stemList(businessType)
  const typeTerms = withPairs(typeStems)
  /** Where a word or a two-word name first stands in the business type; the end where it stands nowhere. */
  const positionOf = (term: string) => {
    const [head, tail] = term.split(' ') as [string, string | undefined]
    const index = typeStems.findIndex((stem, at) => stem === head && (tail === undefined || typeStems[at + 1] === tail))
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER
  }
  /** Where a group's list first meets the business type, its words in order. */
  const at = (list: readonly string[]) => Math.min(...list.map((word) => positionOf(groupTerm(word))))
  const names = (word: string) => {
    const term = groupTerm(word)
    return term.includes(' ') ? said.has(term) || asked.has(term) : domain.has(term) || made.has(term) || term === craft
  }
  const found = CRAFT_KIN.map((group, index) => ({ group, index }))
    .filter(({ group }) => group.match.some(names) && (!group.of || group.of.some(names)))
    .sort(
      (a, b) =>
        Number(Boolean(b.group.of)) - Number(Boolean(a.group.of)) || at(a.group.match) - at(b.group.match) || a.index - b.index,
    )
  const groups = found.map(({ group }) => group)
  // A craft named only in what the business is asked for ("takes catering
  // requests") lends its kin and its refusals, never its searches (AGL-4065).
  const major = groups.filter((group) => group.match.some((word) => said.has(groupTerm(word)) || made.has(groupTerm(word))))
  // A business that is only a place ("an online shop for handmade
  // cold-process soap") takes its craft from what it is for: the Saltmarsh
  // Soap Co start (2026-10-10) read its craft as nothing, so its hero searched
  // "shop" (a florist's bouquet) and no product was held to soap.
  if (!craft) {
    const listed = major[0]?.match
      .map(groupTerm)
      .find((stem) => !stem.includes(' ') && (domain.has(stem) || made.has(stem)))
    craft = listed || firstWorld || [...made][0] || ''
    if (craft && !stemList(business).includes(craft))
      business = `${craft} ${business}`.trim()
  } else if (major[0] && !major.some((group) => group.match.some((word) => groupTerm(word) === craft))) {
    // A word the table does not list, beside a craft it does, says what kind
    // of that craft it is (AGL-3856): "wedding" of "a wedding and portrait
    // photographer" is a photographer's subject, never a craft to search by.
    craft =
      major[0].match.map(groupTerm).find((stem) => !stem.includes(' ') && (domain.has(stem) || made.has(stem))) ?? craft
  }
  if (craft) domain.add(craft)
  const craftGroup = major.find((group) => group.match.some((word) => groupTerm(word) === craft))
  const broad: string[] = []
  const makingSearches: string[] = []
  const rivals: Array<{ words: string[]; core: string[] }> = []
  const core = new Set<string>(craft ? [craft] : [])
  const shun = new Set<string>()
  const shunLead = new Set<string>()
  for (const group of groups) {
    for (const word of group.shun ?? []) shun.add(groupTerm(word))
    for (const word of group.shunLead ?? []) shunLead.add(groupTerm(word))
    for (const word of [...group.kin, ...(group.near ?? [])]) domain.add(groupTerm(word))
    if (group.rivals)
      rivals.push({
        words: group.rivals.words.map(groupTerm),
        core: group.rivals.core.map(groupTerm),
      })
  }
  // A team of the craft's world is shown racing, never at the repair shop's bench (AGL-4092).
  const ownStems = new Set(ownAll.flatMap((word) => stemList(word)))
  for (const group of major) {
    for (const word of group.match) core.add(groupTerm(word))
    const team = group.team && group.team.words.some((word) => ownStems.has(aiStockStem(word))) ? group.team : null
    broad.push(...group.broad, ...(team?.broad ?? []))
    makingSearches.push(...(team ? team.making : group.making))
  }
  // A two-word name of a listed world names it whole: "dirt bike", never
  // "bike" (a bicycle's) where the type says it nowhere else (AGL-4065).
  for (const group of groups)
    for (const word of group.match) {
      const term = groupTerm(word)
      if (!term.includes(' ') || !typeTerms.includes(term)) continue
      domain.add(term)
      const [head, tail] = term.split(' ') as [string, string]
      const alone = (stem: string) =>
        typeStems.some((found, index) => found === stem && !(found === head ? typeStems[index + 1] === tail : typeStems[index - 1] === head))
      for (const stem of [head, tail]) if (!alone(stem)) domain.delete(stem)
    }
  // What a customer is asked to do is never a world (AGL-4065).
  for (const stem of TRANSACTION_STEMS) domain.delete(stem)
  // The business's own world: the crafts its own clause names, and the craft's.
  const ownTerms = new Set(termsOf([own.join(' ')]))
  const leading = major.filter((group) => group === craftGroup || group.match.some((word) => ownTerms.has(groupTerm(word))))
  const lead = new Set<string>()
  for (const group of leading) for (const word of [...group.match, ...group.kin]) lead.add(groupTerm(word))
  if (leading.length)
    for (const word of own)
      for (const stem of stemList(word))
        if (![...lead].some((term) => term === stem || (term.includes(' ') && term.split(' ').includes(stem) && ownTerms.has(term))))
          lead.add(stem)
  // A wider world's names lead only where the business's own words say them
  // (AGL-4092): a motocross team's world is off-road, never "motorcycle" alone,
  // and a street bike's words are never its pictures' without the ground.
  const road = new Set<string>()
  const ground = new Set<string>()
  for (const group of leading) {
    if (!group.wider) continue
    const wider = group.wider.words.map(groupTerm)
    if (wider.some((term) => ownTerms.has(term))) continue
    for (const term of wider) lead.delete(term)
    for (const word of group.wider.shunLead) shunLead.add(groupTerm(word))
    for (const word of group.wider.road ?? []) road.add(groupTerm(word))
    for (const word of group.wider.ground ?? []) ground.add(groupTerm(word))
  }
  // A trade's world, named by the world it serves: "dirt bike" for a dirt bike parts shop.
  const served = craftGroup?.of
    ? groups
        .filter((group) => group !== craftGroup)
        .flatMap((group) => group.match)
        .filter((word) => typeTerms.includes(groupTerm(word)))
        .sort((a, b) => positionOf(groupTerm(a)) - positionOf(groupTerm(b)))[0]
    : undefined
  if (!broad.length) broad.push(business, craft)
  // A part or gear names no world on its own: a dirt bike shop's part, never a canoe's (AGL-4065).
  const ofAWorld = (term: string) => term.length > 1 && !term.split(' ').every((word) => WORLD_OBJECTS.has(word))
  // A trade's things are held to the world it serves, never to its own word (AGL-4092).
  const tradeNames = new Set((craftGroup?.of ? craftGroup.match : []).map(groupTerm))
  const held = craftGroup?.of ? [...core].filter((term) => ofAWorld(term) && !tradeNames.has(term)) : []
  const out = [...new Set(leading.flatMap((group) => group.out ?? []))]
  return {
    business,
    craft,
    domain: [...domain].filter((stem) => stem.length > 1),
    lead: leading.length ? [...lead].filter(ofAWorld) : [...domain].filter((stem) => stem.length > 1),
    ...(served ? { leadWord: served } : {}),
    ...(held.length ? { held } : {}),
    ...(out.length ? { out } : {}),
    broad: [...new Set(broad.map((query) => query.trim()).filter(Boolean))],
    making: [...new Set(makingSearches)],
    ...(groups.some((group) => group.scenes) ? { scenes: true } : {}),
    ...(groups.some((group) => group.maker?.length)
      ? { maker: [...new Set(groups.flatMap((group) => group.maker ?? []).map(aiStockStem))] }
      : {}),
    named: [...new Set(typeTerms)],
    rivals,
    core: [...core].filter((term) => !craftGroup?.of || ofAWorld(term)),
    shun: [...shun],
    shunLead: [...shunLead],
    ...(road.size ? { road: [...road], ground: [...ground] } : {}),
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
    'four five six seven eight nine ten first second third fourth fifth sixth seventh eighth ninth tenth ' +
    // When a thing is, never the thing (AGL-4065): "Upcoming race 1 (details to be added)" searched "upcoming race".
    'upcoming past next previous future',
)

/** A phrase's content words without its filler; all filler, and nothing is left. */
function subjectOf(list: readonly string[]): string[] {
  return list.filter(
    (word) => !FILLER.has(word) && !PLACEHOLDER_SUBJECTS.has(word) && !GENERIC_OBJECTS.has(word) && !SENTENCE_WORDS.has(word),
  )
}

/**
 * A picture's subject in a few words (AGL-3660): the noun phrase its alt
 * text opens with — its first clause holding more than filler, cut where a
 * preposition starts the setting, filler dropped, its last three words (the
 * head noun is the last) — else its section's name. A word or two joined by
 * "and" to a longer noun phrase only modify its head: the subject of "Potato
 * and egg breakfast taco" is "egg breakfast taco", never "potato" (AGL-4065).
 */
export function aiStockSubjectWords(alt: string, sectionName: string): string {
  // "Hand-poured", "by hand" and "hands" say how it was made, never what it shows.
  const text = withoutHands(alt)
  const breaker = new RegExp(CLAUSE_BREAK.source, 'g')
  const clauses: Array<{ words: string[]; then: string }> = []
  let at = 0
  for (const match of text.matchAll(breaker)) {
    clauses.push({ words: subjectOf(contentWords(text.slice(at, match.index))), then: match[0].trim() })
    at = (match.index ?? 0) + match[0].length
  }
  clauses.push({ words: subjectOf(contentWords(text.slice(at))), then: '' })
  for (const [index, { words: found, then }] of clauses.entries()) {
    if (!found.length) continue
    // Never where the second is one thing in a wrapper: "Soap and Lotion Gift Set" is a gift of both.
    const next = clauses[index + 1]?.words ?? []
    const things = next.filter((word) => !WRAPPERS.has(word))
    if ((then === 'and' || then === '&') && found.length <= 2 && things.length >= 2) return next.slice(-3).join(' ')
    return found.slice(-3).join(' ')
  }
  return subjectOf(contentWords(withoutHands(sectionName))).slice(0, 2).join(' ')
}

/**
 * The thing a subject shows, one singular word: its last word that is not
 * a set or a wrapper of it — "bowl" from "nesting bowl set", "candle" from
 * "candle gift set", "vase" from "bud vase". Its last word when every word
 * is one ("gift set"). A feeling, a time or a way of being somewhere is
 * never one ({@link NON_THINGS}, AGL-4092): "Come hungry" and "Around town"
 * show no thing, and "Race day" is of the race.
 */
export function aiStockObjectWord(subject: string): string {
  const list = subject.split(/\s+/).filter((word) => word && !NON_THINGS.has(word))
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
   * Whether one of the hit's first tags must be OF the business's own world
   * ({@link AiStockSiteTerms.lead}, AGL-4092): naming it, and ending in a word
   * of it. "Taco bowl" is a bowl and "body part" a part: a taco trailer's
   * "Race day" took a chicken salad tagged "taco bowl".
   */
  leadOwn?: boolean
  /**
   * Stems of things a picture is never OF unless its words or the brief name
   * them, refused among a hit's first tags where those name nothing of the
   * business's own world ({@link aiStockOddLeads}, AGL-4092): a cat, a bare foot.
   */
  oddLeads?: readonly string[]
  /**
   * The world a trade serves, one of whose names every hit names, its kin or
   * not ({@link AiStockSiteTerms.held}, AGL-4092): a dirt bike shop's "Brake
   * Pad Set" is never a railway wagon's brake wheel tagged "brake".
   */
  served?: readonly string[]
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
  /** Stems of the places its hits are not set in, which none of their first tags name: a Blue Ridge couple's beach ({@link aiStockSettingAway}, AGL-3942). */
  away?: readonly string[]
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

/**
 * Words a photo by the sea is tagged with: never one set in the mountains, a
 * forest or a city (AGL-3942). Never "palm" or "wave", a hand's as often.
 */
const SEASIDE = [
  'beach', 'beaches', 'sea', 'seaside', 'seashore', 'ocean', 'coast', 'coastal', 'shore', 'shoreline', 'surf', 'waves',
  'caribbean', 'tropical', 'island', 'lagoon', 'bay', 'pier',
]
/** Words a photo of a desert is tagged with. */
const DESERT = ['desert', 'dune', 'dunes', 'cactus', 'sahara']
/** Words a photo of a city is tagged with. */
const CITYSCAPE = ['city', 'urban', 'downtown', 'street', 'skyline', 'skyscraper', 'skyscrapers', 'subway', 'metro']

/**
 * Where a picture of a moment is set, by the words that name it, the word a
 * search and a photo say it with, whether it is a place a photo can show on
 * its own (a landscape, not a season), and the words of the places it is
 * not, which none of a photo's first tags may name (AGL-3942): the beta.267
 * Copper Hollow Film & Portrait galleries, a Blue Ridge photographer's,
 * showed two couples on a beach, tagged "beach, couple, nature, mountain"
 * and "romantic wedding couple, the beach".
 */
const SCENE_SETTINGS: ReadonlyArray<{ words: readonly string[]; said: string; landscape?: boolean; away?: readonly string[] }> = [
  {
    words: ['mountain', 'mountains', 'ridgetop', 'ridge', 'summit', 'peak', 'alpine', 'overlook', 'parkway'],
    said: 'mountains',
    landscape: true,
    away: [...SEASIDE, ...DESERT, ...CITYSCAPE],
  },
  { words: ['fall', 'autumn', 'foliage'], said: 'autumn', away: ['winter', 'snow', 'snowy', 'spring', 'blossom'] },
  { words: ['winter', 'snow', 'snowy'], said: 'winter', away: [...SEASIDE, 'summer', 'tropical'] },
  { words: ['beach', 'coast', 'seaside', 'shore', 'ocean'], said: 'beach', landscape: true, away: ['snow', 'snowy', 'ski', 'skiing', ...CITYSCAPE] },
  { words: ['forest', 'woods', 'woodland'], said: 'forest', landscape: true, away: [...SEASIDE, ...DESERT, ...CITYSCAPE] },
  { words: ['spring', 'blossom', 'blossoms'], said: 'spring', away: ['winter', 'snow', 'snowy', 'autumn', 'fall'] },
  { words: ['city', 'urban', 'downtown'], said: 'city', landscape: true, away: [...SEASIDE, ...DESERT] },
]

/** The stems of the places a setting is not ({@link SCENE_SETTINGS}); none for no setting. */
export function aiStockSettingAway(setting: string): string[] {
  const entry = SCENE_SETTINGS.find((candidate) => candidate.said === setting)
  return entry?.away ? [...new Set(entry.away.map(aiStockStem))] : []
}

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
  /** Stems of the places it is not set in, which none of a photo's first tags name ({@link aiStockSettingAway}, AGL-3942). */
  away: string[]
}

/**
 * The scene a picture's words name (AGL-3856): the people at a moment, and
 * where — "Ridgetop Elopement" a couple in the mountains, "Mountain Wedding
 * Day" a wedding couple in the mountains, "Family Session in the Fall" a
 * family in autumn — read from every word, never only the first clause.
 * `null` where it names no people.
 */
export function aiStockScene(text: string, siteSetting = ''): AiStockScene | null {
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
    // Searched where its own words set it; never shown anywhere the site is not.
    away: aiStockSettingAway(setting || siteSetting),
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
    away: aiStockSettingAway(setting),
  }
}

/**
 * The work a craft whose pictures are people at a moment shows (AGL-3942):
 * the scenes its site's own words name, in the order they name them, each
 * set where the site is — a wedding photographer "for couples planning
 * mountain weddings, and families" shows a wedding couple in the mountains
 * and a family in the mountains. A family session still never shows a
 * bride, whatever else the site names. Empty where its words name no people.
 */
export function aiStockWorkScenes(text: string, setting = ''): AiStockScene[] {
  const list = text
    .toLowerCase()
    .split(/[^a-zÀ-ɏ]+/)
    .filter(Boolean)
  const found = PEOPLE_SCENES.map((scene) => ({ scene, at: list.findIndex((word) => scene.words.includes(word)) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
  return found.map(({ scene }) => {
    const named = new Set(list.filter((word) => scene.words.includes(word)))
    const query = scene.query(named)
    return {
      queries: [...new Set([setting ? `${query} ${setting}` : '', query].filter(Boolean))],
      subject: [scene.subject, setting].filter(Boolean).join(' '),
      object: scene.subject,
      lead: scene.lead.filter((phrase) => !RECORD_SCENE_UNPEOPLED.has(phrase)).map((phrase) => stemList(phrase).join(' ')),
      people: scene.people.map(aiStockStem),
      shun: scene.shun.map(aiStockStem),
      named: [...new Set([...named].map(aiStockStem))],
      away: aiStockSettingAway(setting),
    }
  })
}

/** Whether a setting is a place a photo shows on its own, a landscape searched by its name: "mountains", never "autumn". */
export function aiStockSettingIsLandscape(setting: string): boolean {
  return SCENE_SETTINGS.some((entry) => entry.said === setting && entry.landscape === true)
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
  /** The world a trade serves, which its products name in place of the craft ({@link AiStockSiteTerms.held}, AGL-4092). */
  held?: readonly string[]
  /** The word a trade's product is searched with in place of its craft ({@link AiStockSiteTerms.leadWord}, AGL-4092). */
  leadWord?: string
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

/** A product's subjects, its name's first, its sizes left out ({@link aiStockProductSearches}). */
function aiStockProductSubjects(slot: Pick<AiLayoutPictureSlot, 'product'>): string[] {
  return (slot.product?.subjects ?? []).map((raw) => aiStockSubjectWords(raw.replace(PRODUCT_SIZES, ' '), '')).filter(Boolean)
}

/** A product's own subject: its name's noun phrase ({@link aiStockProductSearches}). */
const aiStockProductSubject = (slot: Pick<AiLayoutPictureSlot, 'product'>) => aiStockProductSubjects(slot)[0] ?? ''

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
  const subjects = aiStockProductSubjects(slot)
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
  // A trade's product is held to the world it serves, never to its craft
  // (AGL-4092): a parts shop's "part" named a transmission's "mechanical part".
  const served = [...new Set((fallback.held ?? []).map(stemPhrase).filter(Boolean))]
  const trade = served.length > 0
  const category = trade
    ? served
    : craft && ownWorld.length
      ? [...craftStems, ...ownWorld]
      : []
  const core = trade ? served : [...new Set([...craftStems, ...(fallback.core ?? [])])]
  // A trade's product is named by the world it serves: "dirt bike skid plate", never "part skid plate".
  const prefix = trade ? (fallback.leadWord ?? '') : craft
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
      : prefix && !stems.some((stem) => world.has(stem))
        ? `${prefix} ${subject}`
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
  // A trade's craft alone is never searched (AGL-4092): "part" answered a transmission chain for "Brake Pad Set".
  else if (craft && !trade)
    queries.push({ query: craft, subject: own || craft, object: craft, lead: true, tier: 'borrow' })
  const held = [...queries]
  // A thing of its own is a photo of itself, never of the shop's category (AGL-4092): "Bottled Water" is no taco.
  const itsOwn = Boolean(own) && aiStockThingOfItsOwn(own, { domain: [...world], core: [...core, ...craftStems, ...(fallback.core ?? [])] })
  const broadOf = itsOwn ? [] : (fallback.broad ?? [])
  // 2. A photo OF its category, which may be one the job already shows.
  for (const query of broadOf)
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
  for (const query of broadOf)
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
      ...(trade ? { served } : {}),
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
            ? { category: core, ...(trade ? { leadOwn: true } : {}) }
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
      ...(trade ? { strict: true } : craft ? { requires: craft } : {}),
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
    Partial<Pick<AiStockSiteTerms, 'making' | 'core' | 'scenes' | 'setting' | 'maker' | 'work' | 'leadWord' | 'held' | 'out'>>,
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
  // Every other picture of such a craft's site shows its work where a page
  // would show the maker (AGL-3942): the beta.267 Copper Hollow Film &
  // Portrait about page searched "photographer at work" and "photographer
  // camera", and every picture on it was a stock photographer.
  const itsWork = !work && aiStockShowsItsWork(slot, terms)
  /** Whether a query names the craft by its own name, the profession's noun: "wedding photographer". */
  const namesCraft = (query: string) => stemList(query).some((stem) => (terms.core ?? []).includes(stem))
  /** Whether a query names the maker, their tools or the craft: "photographer at work", "photographer camera". */
  const namesMaker = (query: string) => namesCraft(query) || stemList(query).some((stem) => (terms.maker ?? []).includes(stem))
  /** A rung of the maker's own photos, left out on a site that shows its work. */
  const shown = (query: string) => !itsWork || !namesMaker(query)
  /** A search of the slot's own words, left out on such a site only where they name the profession. */
  const said = (query: string) => !itsWork || !namesCraft(query)
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
  // The world a trade serves qualifies its pictures where the craft is the trade: "dirt bike", never "part" (AGL-4065).
  const leadWord = terms.leadWord ?? terms.craft
  const leadStems = stemList(leadWord)
  const qualify = (phrase: string) =>
    leadWord && !namesWorld && !leadStems.every((stem) => stemList(phrase).includes(stem))
      ? `${leadWord} ${phrase}`
      : phrase
  // A part, gear, a machine, or one word of a two-word world ("bike" of "dirt
  // bike"), is never searched alone (AGL-4065): searched with the world, and
  // its photo is OF the thing and names the world. "Parts for the ranch"
  // searched "parts" and took a canoe tagged "part".
  const ofTheWorld =
    Boolean(leadWord) &&
    subjectStems.length > 0 &&
    subjectStems.every((stem) => WORLD_OBJECTS.has(stem) || leadStems.includes(stem)) &&
    (subjectStems.some((stem) => WORLD_OBJECTS.has(stem)) || (leadStems.length > 1 && subjectStems.length < leadStems.length))
  /** The words a photo of the world names, the world's things left out: a dirt bike's, never "part". */
  const worldNames = core.filter((stem) => !stem.split(' ').some((word) => WORLD_OBJECTS.has(word)))
  type Query = {
    query: string
    broad?: boolean
    people?: boolean
    held?: boolean
    category?: boolean
    /** Where the site's work is searched ({@link AiStockSiteTerms.work}). */
    work?: boolean
    /** Whether the thing must be among its photo's first tags: a record's cover, a thing of the world (AGL-4065). */
    leads?: boolean
    /** Whether its photo names the world's own words ({@link AiStockSiteTerms.core}) as well as the thing (AGL-4065). */
    ofWorld?: boolean
    /** Whether one of its photo's first tags is OF the business's own world ({@link AiStockSearch.leadOwn}, AGL-4092). */
    own?: boolean
    /** Whether it asks for the business out where it is: its customers, never a street ({@link PLACE_PHRASES}, AGL-4092). */
    out?: boolean
  }
  // A collection tile is product-like: held to the shop's category and its
  // own object among the first tags, and searched by its object's kin, never
  // the category's world alone (AGL-3660).
  const collection = part === 'collection' && Boolean(terms.craft) && !work
  // A record of a thing of its own is a photo of that thing, never of the
  // site's world (AGL-4092): a taco trailer's "Bottled Water" took tomatoes
  // from its broad "tacos".
  const itsOwn = Boolean(slot.record) && !work && Boolean(subject) && aiStockThingOfItsOwn(subject, { domain: terms.domain, core })
  // A picture's broad searches find a photo OF the business's own world,
  // never one naming it in a word of a tag (AGL-4092); a hero's first tag
  // already names it.
  const broad: Query[] = (kin && collection) || work || itsOwn
    ? []
    : terms.broad
        .filter(shown)
        .map((query) => ({ query, broad: true, category: collection, ...(slot.role === 'hero' ? {} : { own: true }) }))
  // A trade's things are held to the world it serves, never to its craft (AGL-4092).
  const heldTo = terms.held?.length ? terms.held : null
  // A caption that names no thing (AGL-4092): "Come hungry" is a picture of
  // the site's own world, and "Around town" of its customers out where it is.
  const thingless = Boolean(subject) && !object && !work
  const out = thingless && slot.role !== 'hero' && PLACE_PHRASES.test(slot.alt)
  // The maker at work, held to the craft: never "hands" (AGL-3660), and a
  // photo OF the business's own world, never a taco bowl salad for a taco
  // trailer's crew at work (AGL-4092).
  const makers: Query[] = (work ? [] : (terms.making ?? [])).filter(shown).map((query) => ({
    query,
    broad: true,
    category: true,
    own: true,
  }))
  // A portrait in its role, in the site's world, where the libraries know a word for it.
  const roleWord = slot.people ? (aiStockPeopleRole(slot.alt, sectionName)?.query ?? '') : ''
  const role = roleWord ? (stemList(terms.business).includes(roleWord) ? terms.business : `${roleWord} ${terms.business}`.trim()) : ''
  // A scene's people are read from every word of the picture's, never its first clause alone.
  const scene = work
    ? aiStockRecordScene(slot.alt, slot.record?.category ?? '', terms.setting ?? '')
    : terms.scenes && slot.role !== 'hero' && part !== 'collection'
      ? aiStockScene(slot.alt, terms.setting ?? '')
      : null
  // The site's own scenes, turned per slot so a page's pictures show each of them.
  const sceneList: AiStockScene[] = []
  if (itsWork) {
    const own = terms.work ?? []
    const turn = own.length ? aiLayoutSeedNumber(`${sectionName}|${slot.alt}`) % own.length : 0
    sceneList.push(...own.slice(turn), ...own.slice(0, turn))
  }
  // The work's own subject is never qualified by the craft: "getting ready", never "photographer getting ready".
  const own = work ? (phrase: string) => phrase : qualify
  // A record's cover is OF what it names, searched in the site's world first
  // (AGL-4065): "handyman drywall" before "drywall", which took an architect's
  // house with a family before its studs.
  const record = Boolean(slot.record) && !work && !ofTheWorld && Boolean(leadWord)
  const thing: Query[] = (
    !subject
      ? []
      : thingless
        ? out
          ? (terms.out?.length ? terms.out : [`${leadWord} customers`.trim()]).map((query) => ({ query, out: true }))
          : [{ query: `${leadWord} ${subject}`.trim(), own: true }]
      : itsOwn
        ? [
            // Its own words and its kin, never qualified by the site's world: "bottled water", never "taco bottled water".
            { query: subject, held: true, leads: true },
            ...(kin ? kin.queries.map((query) => ({ query, held: true, leads: true })) : []),
          ]
      : ofTheWorld
        ? [
            {
              query: `${leadWord} ${subjectStems.some((stem) => !leadStems.includes(stem)) ? subject.split(/\s+/).filter((word) => !leadStems.includes(aiStockStem(word))).join(' ') : ''}`.trim(),
              held: true,
              leads: true,
              ofWorld: true,
            },
            ...(kin ? kin.queries.map((query) => ({ query, held: true, leads: true, ofWorld: true })) : []),
          ]
        : [
            ...(record && !leadStems.every((stem) => subjectStems.includes(stem)) ? [{ query: `${leadWord} ${subject}`, held: true, leads: true }] : []),
            { query: own(subject), held: true, ...(record ? { leads: true } : {}) },
            ...(kin
              ? kin.queries.map((query) => ({ query, held: true, ...(record ? { leads: true } : {}) }))
              : [{ query: own(object), held: true, ...(record ? { leads: true } : {}) }]),
          ]
  ).filter((query) => said(query.query))
  // Never the maker, the camera, an animal or a toy, unless the record names it.
  const recordNamed = work ? new Set(stemList(`${slot.alt} ${slot.record?.category ?? ''}`)) : null
  const refuseLead = recordNamed
    ? [...new Set([...(terms.maker ?? []), ...[...RECORD_ODD_LEADS].map(aiStockStem)])].filter((stem) => !recordNamed.has(stem))
    : []
  // Where the maker's rungs were, a site that shows its work searches its work.
  const shows: Query = { query: '', work: true }
  const making = itsWork ? [shows] : makers
  const queries: Query[] =
    slot.role === 'hero'
      ? [{ query: terms.business, broad: true }, ...broad, ...(itsWork ? [shows] : [])]
      : slot.role === 'about'
        ? [
            ...(role ? [{ query: role, broad: true, people: true }] : []),
            ...(part === 'story' ? making : []),
            ...[
              {
                query: `${terms.business} ${subject}`,
                broad: true,
                people: true,
              },
              { query: terms.business, broad: true, people: true },
            ].filter((query) => said(query.query)),
            ...(part === 'story' ? [] : making),
            ...broad,
          ]
        : [...(part === 'story' ? making : []), ...(scene ? [] : thing), ...(itsWork ? [shows] : []), ...broad]
  const seen = new Set<string>()
  const searches: AiStockSearch[] = []
  // A picture of people at a moment asks for them, and where, before anything
  // else, and takes only a photo leading with them (AGL-3856): never the
  // roses of a "Mountain Wedding Day", nor a bride for a family session. A
  // picture of the work never leads with the maker or a camera (AGL-3942).
  const workLead = itsWork ? (terms.maker ?? []) : []
  // The site's work is held to its own scene, never to the craft's world.
  const sceneSearch = (one: AiStockScene, query: string, ofWork: boolean): AiStockSearch => {
    const refused = [...new Set([...refuseLead, ...workLead.filter((stem) => !one.named.includes(stem))])]
    return {
      query,
      orientation,
      ...size,
      strict: true,
      subject: one.subject,
      object: one.object,
      kin: one.lead,
      lead: true,
      needs: one.people,
      allow: one.named,
      ...(one.shun.length ? { refuse: one.shun } : {}),
      ...(refused.length ? { refuseLead: refused } : {}),
      ...(one.away.length ? { away: one.away } : {}),
      ...(work || ofWork ? { worldless: true } : {}),
    }
  }
  for (const query of scene?.queries ?? []) {
    seen.add(`${query}|false`)
    searches.push(sceneSearch(scene as AiStockScene, query, false))
  }
  /** The site's own scenes, then the place itself where it is a landscape: "mountains". */
  const workSearches = (): AiStockSearch[] => {
    const found: AiStockSearch[] = []
    for (const one of sceneList)
      for (const query of one.queries) {
        if (seen.has(`${query}|false`)) continue
        seen.add(`${query}|false`)
        found.push(sceneSearch(one, query, true))
      }
    const place = terms.setting && aiStockSettingIsLandscape(terms.setting) ? terms.setting : ''
    if (!place || seen.has(`${place}|false`)) return found
    seen.add(`${place}|false`)
    const away = aiStockSettingAway(place)
    const stems = SCENE_SETTINGS.find((entry) => entry.said === place)?.words.map(aiStockStem) ?? []
    found.push({
      query: place,
      orientation,
      ...size,
      strict: true,
      subject: place,
      object: aiStockStem(place),
      kin: [...new Set(stems)],
      lead: true,
      ...(workLead.length ? { refuseLead: [...workLead] } : {}),
      ...(away.length ? { away } : {}),
      worldless: true,
    })
    return found
  }
  for (const raw of queries) {
    if (raw.work) {
      searches.push(...workSearches())
      continue
    }
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
      ...((held && collection) || raw.leads ? { lead: true } : {}),
      ...(terms.craft && !raw.ofWorld && (raw.category || (raw.held && collection))
        ? heldTo
          ? { category: heldTo, served: heldTo }
          : {
              requires: terms.craft,
              ...(ownWorld.length ? { category: [terms.craft, ...ownWorld] } : {}),
            }
        : {}),
      ...(raw.ofWorld && worldNames.length ? { category: worldNames } : {}),
      ...(slot.role === 'hero' && core.length ? { category: core } : {}),
      // A hero is OF the site's world: its first tag names it (AGL-3760).
      ...(slot.role === 'hero' ? { first: true } : {}),
      ...(raw.own ? { leadOwn: true } : {}),
      // Its customers out where it is, never someone else's street (AGL-4092).
      ...(raw.out
        ? { broad: true, needs: PLACE_NEEDS.map(stemPhrase), refuseLead: [...new Set([...refuseLead, ...FOREIGN_STREET.map(stemPhrase)])] }
        : refuseLead.length
          ? { refuseLead }
          : {}),
      ...(work ? { worldless: true } : {}),
    })
  }
  return searches
}

/**
 * Whether a picture of a craft's site whose pictures are people at a moment
 * shows that work wherever a page would show the maker (AGL-3942): an about
 * picture, a story of the craft, an intro's cover. Not a record (which shows
 * its own moment, {@link aiStockShowsTheWork}), a portrait of the business's
 * people, nor a product; and only where the site's words name the work.
 */
export function aiStockShowsItsWork(
  slot: Pick<AiLayoutPictureSlot, 'record' | 'people' | 'product'>,
  terms: Partial<Pick<AiStockSiteTerms, 'scenes' | 'work'>>,
): boolean {
  return Boolean(terms.scenes) && (terms.work?.length ?? 0) > 0 && !slot.record && !slot.people && !slot.product
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
   * The business's own world ({@link AiStockSiteTerms.lead}, AGL-4065): what a
   * hero's first tag and a hit of a search that is not of a thing name. The
   * domain where absent.
   */
  world?: readonly string[]
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
  /** Whether one of the hit's first tags must be OF the business's own world ({@link AiStockSearch.leadOwn}, AGL-4092). */
  leadOwn?: boolean
  /** Stems no hit's first tags lead with while they name nothing of the business's own world ({@link AiStockSearch.oddLeads}, AGL-4092). */
  oddLeads?: readonly string[]
  /** The world a trade serves, which every hit names ({@link AiStockSearch.served}, AGL-4092). */
  served?: readonly string[]
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
  /** Stems of the places the picture is not set in, which none of a hit's first tags may name ({@link AiStockSearch.away}). */
  away?: readonly string[]
  /** A street bike's words, which a hit never carries without `ground` unless the slot or the brief names them ({@link AiStockSiteTerms.road}). */
  road?: readonly string[]
  /** The ground an off-road bike rides ({@link AiStockSiteTerms.ground}). */
  ground?: readonly string[]
  /**
   * Stems of where the site's own words say it is (AGL-4092): its business
   * type's, its audience's and its name's, which a street photo may name
   * ({@link aiStockForeignStreet}). Its business type's alone where absent.
   */
  here?: readonly string[]
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
  // Each tag's words and pairs of them, read tag by tag (AGL-4065): "race car"
  // and "dirt bike" are phrases a world names; the page address is read whole.
  const lead = termsOf([...tags.slice(0, 3), slug])
  const all = termsOf([...tags, photo.alt ?? '', slug])
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
 * Whether one of a hit's first three tags is OF a world (AGL-4092): it names
 * the world, and its last word, or its last two, is a word of the world or of
 * its domain. "Street tacos" and "dirt bike tire" are; "taco bowl" is a bowl,
 * "body part" a part. Read from the tags alone: the page address repeats them
 * run together, and a run of words has no head.
 */
function leadsWithWorld(tags: readonly string[], world: ReadonlySet<string>, domain: ReadonlySet<string>): boolean {
  return tags.slice(0, 3).some((tag) => {
    const stems = stemList(tag)
    if (!withPairs(stems).some((term) => world.has(term))) return false
    return [stems[stems.length - 1] ?? '', stems.slice(-2).join(' ')].some(
      (term) => Boolean(term) && (world.has(term) || domain.has(term)),
    )
  })
}

/**
 * What a picture of a business's world is never OF unless its words name it
 * (AGL-4092): an animal or a toy (as a portfolio's record never is,
 * {@link RECORD_ODD_LEADS}), or a bare body part. Each group is let in whole
 * by any of its words in `said` — the slot's words, its section's, the
 * brief's — so a dog groomer's pictures show dogs and cats alike. As stems;
 * the body's left out where `body` is false (a portrait's face).
 */
export function aiStockOddLeads(said: readonly string[], options: { body?: boolean } = {}): string[] {
  const named = new Set(said.flatMap((text) => stemList(text)))
  const groups = [
    'animal animals cat cats kitten kittens dog dogs puppy puppies pet pets bird birds frog frogs duck ducks horse horses ' +
      'cow cows rabbit rabbits bunny',
    'toy toys figurine figurines lego doll dolls teddy puppet miniature',
    ...(options.body === false ? [] : [`${[...BODY_PARTS].join(' ')} toe toes barefoot`]),
  ].map((group) => [...new Set(stemList(group))])
  return groups.filter((group) => !group.some((stem) => named.has(stem))).flat()
}

/**
 * Cities, states and countries a library's street photos are tagged with
 * (2026-10-29, AGL-4092), as stem phrases. Only where a tag says the photo is
 * of a street or a town ({@link STREET_HEADS}) does one say where it is set:
 * tacos tagged "mexico" are a dish, a cart tagged "antalya, turkey, street"
 * is a street in Turkey. A word that is as often something else ("chile",
 * "jordan", "nice") is not one.
 */
const NAMED_PLACES: readonly string[] = [
  // Countries and regions.
  'afghanistan', 'africa', 'albania', 'algeria', 'argentina', 'armenia', 'asia', 'australia', 'austria', 'bali',
  'bangladesh', 'belgium', 'bolivia', 'bosnia', 'brazil', 'bulgaria', 'cambodia', 'canada', 'china', 'colombia',
  'croatia', 'cuba', 'cyprus', 'czech', 'czechia', 'denmark', 'dominican republic', 'ecuador', 'egypt', 'england',
  'estonia', 'ethiopia', 'europe', 'finland', 'france', 'germany', 'ghana', 'greece', 'guatemala', 'holland', 'hungary',
  'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy', 'jamaica', 'japan', 'kenya', 'korea',
  'laos', 'latvia', 'lebanon', 'lithuania', 'malaysia', 'malta', 'mexico', 'mongolia', 'montenegro', 'morocco',
  'myanmar', 'nepal', 'netherlands', 'new zealand', 'nigeria', 'norway', 'pakistan', 'panama', 'peru', 'philippines',
  'poland', 'portugal', 'romania', 'russia', 'scotland', 'serbia', 'singapore', 'slovakia', 'slovenia', 'spain',
  'sri lanka', 'sweden', 'switzerland', 'syria', 'taiwan', 'tanzania', 'thailand', 'tunisia', 'turkey', 'ukraine',
  'united kingdom', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam', 'wales',
  // Cities.
  'amsterdam', 'antalya', 'athens', 'bangkok', 'barcelona', 'beijing', 'berlin', 'bogota', 'bruges', 'brussels',
  'budapest', 'buenos aires', 'cairo', 'cancun', 'cologne', 'copenhagen', 'cusco', 'delhi', 'dubai', 'dublin',
  'edinburgh', 'florence', 'frankfurt', 'hamburg', 'hanoi', 'havana', 'ho chi minh', 'hong kong', 'istanbul', 'jaipur',
  'jakarta', 'jerusalem', 'kathmandu', 'kolkata', 'krakow', 'kuala lumpur', 'kyoto', 'lisbon', 'london', 'lyon',
  'madrid', 'manila', 'marrakech', 'marrakesh', 'milan', 'montreal', 'moscow', 'mumbai', 'munich', 'naples', 'oaxaca',
  'osaka', 'oslo', 'paris', 'porto', 'prague', 'quito', 'rio de janeiro', 'rome', 'saigon', 'salzburg', 'seoul',
  'seville', 'shanghai', 'stockholm', 'sydney', 'taipei', 'tokyo', 'toronto', 'vancouver', 'venice', 'vienna', 'warsaw',
  'zurich',
  // The United States' most photographed cities, and the states their photos name.
  'atlanta', 'boston', 'brooklyn', 'chicago', 'denver', 'detroit', 'honolulu', 'las vegas', 'los angeles', 'manhattan',
  'miami', 'new orleans', 'new york', 'nyc', 'philadelphia', 'san francisco', 'seattle', 'california', 'florida',
  'hawaii', 'illinois', 'nevada',
].map(stemPhrase)

/**
 * A tag's last word that says the photo is of a street, a town or a city
 * (AGL-4092): "street", "city street", "old town", "skyscraper". Never
 * "road": a motocross track's "off-road" and "dirt road" are not streets.
 */
const STREET_HEADS: ReadonlySet<string> = new Set(
  [
    'street', 'alley', 'alleyway', 'avenue', 'sidewalk', 'city', 'downtown', 'urban', 'skyline', 'skyscraper',
    'cityscape', 'building', 'architecture', 'town', 'village', 'market', 'bazaar', 'traffic',
  ].map(aiStockStem),
)

/**
 * Whether a hit is a street, a town or a city its tags place somewhere the
 * site's own words never name (2026-10-29, AGL-4092): Pit Row Tacos, a taco
 * trailer near Buda, Texas, showed a food truck under the Chicago
 * skyscrapers ("food truck, chicago, skyscraper, … city, urban, downtown")
 * and a woman with a bagel cart in Antalya ("food cart, woman, street, …,
 * antalya, turkey"), whatever its captions said. `here` is the site's own
 * stems: its business type's and its audience's. Pure.
 */
export function aiStockForeignStreet(photo: Pick<StockPhoto, 'tags'>, here: readonly string[]): boolean {
  const tags = (photo.tags ?? []).map((tag) => stemList(tag)).filter((stems) => stems.length)
  if (!tags.some((stems) => STREET_HEADS.has(stems[stems.length - 1] as string))) return false
  const own = new Set(here)
  return NAMED_PLACES.some(
    (place) =>
      tags.some((stems) => ` ${stems.join(' ')} `.includes(` ${place} `)) && !place.split(' ').every((stem) => own.has(stem)),
  )
}

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
  // A maker's name, in its tags or its page address, unless the site names the maker (AGL-4065),
  // or a word one letter off it: "susuki" is a Suzuki (AGL-4092).
  const makers = aiStockMakerTerms(photo)
  if ([...MAKER_STEMS].some((maker) => makers.has(maker) && !site.has(maker))) return true
  for (const term of makers) {
    const maker = term.includes(' ') ? null : fuzzyMaker(term)
    if (maker && !site.has(maker) && !site.has(term)) return true
  }
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
  // Another city's or country's street is never the business's (AGL-4092).
  if (aiStockForeignStreet(photo, [...(judgement.named ?? []), ...(judgement.here ?? [])])) return 0
  // Glass art is not pottery: a rival craft's photo names this craft's own words.
  for (const rival of judgement.rivals ?? [])
    if (
      rival.words.some((word) => hit.all.has(word)) &&
      !rival.core.some((word) => hit.all.has(word))
    )
      return 0
  // A trade's thing is of the world it serves, whatever else names it (AGL-4092).
  if (judgement.served?.length && !judgement.served.some((term) => hit.all.has(stemPhrase(term)))) return 0
  const subject = stemList(judgement.subject ?? '')
  // What the slot or the brief names lets a shunned word, a room or a fragrance in.
  const owned = new Set([...subject, ...(judgement.named ?? [])])
  // A dispenser is not a soapmaker's, nor a pump a bar's (AGL-3660).
  if ((judgement.shun ?? []).some((word) => hit.all.has(word) && !owned.has(word)))
    return 0
  // A street bike is never an off-road business's picture without the ground it rides (AGL-4092):
  // a man in a motorcycle suit on a road trip, tagged "motocross", and a model in a garage tagged "road".
  if (
    (judgement.road ?? []).some((word) => hit.all.has(word) && !owned.has(word)) &&
    !(judgement.ground ?? []).some((word) => hit.all.has(word))
  )
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
  // A Blue Ridge couple is never on a beach, however its later tags name a mountain (AGL-3942).
  if (judgement.away?.length) {
    const read = new Set(stemList((photo.tags ?? []).slice(0, ALT_TAGS_READ).join(' ')))
    if (judgement.away.some((stem) => read.has(stem))) return 0
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
  // A two-word name stays whole: "dirt bike", never "bike" (AGL-4065).
  const category = (judgement.category ?? []).map(stemPhrase).filter(Boolean)
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
  // The business's own world, which a picture that is not of a thing names (AGL-4065).
  const own = judgement.world?.length ? judgement.world.filter((stem) => stem !== object) : domain
  // A hit naming the word it must name is of the site's world: a product's
  // category is that world even where it is the product's own object.
  const world =
    demanded || kinNamed || domain.some((stem) => hit.all.has(stem))
  const ownWorld = demanded || kinNamed || own.some((stem) => hit.all.has(stem))
  const worldLead =
    (anyOf.length
      ? anyOf.some((stem) => hit.lead.has(stem))
      : required.length > 0 && required.every((stem) => hit.lead.has(stem))) ||
    kinLead ||
    domain.some((stem) => hit.lead.has(stem))
  if (judgement.leadWorld && !worldLead) return 0
  // One of its first tags is OF the business's own world (AGL-4092): "tacos",
  // "street tacos", "dirt bike" lead with it; "taco bowl", "body part" and a
  // man posing with a "motorcycle" for a motocross team do not.
  if (judgement.leadOwn && own.length && !kinLead && !leadsWithWorld(photo.tags ?? [], new Set(own), new Set(domain)))
    return 0
  // A cat, a toy or a bare foot leads it, and nothing of the business's own world does (AGL-4092).
  if (judgement.oddLeads?.length && own.length) {
    const first = termsOf((photo.tags ?? []).slice(0, 3))
    if (judgement.oddLeads.some((stem) => first.has(stem)) && !own.some((stem) => first.has(stem))) return 0
  }
  // The first tag alone, never the page's address: Pixabay's slug repeats a
  // late tag ("coffee-latte-art-candle-…"). A site whose words name no world
  // holds its hero to none.
  // The business's own world, never every word of its type (AGL-4065): "race
  // car" named "race" of "Amateur motocross race team: … race schedule".
  const worldStems = new Set([...anyOf, ...required, ...own])
  if (judgement.first && (worldStems.size || kin.length)) {
    const firstWorld =
      withPairs(hit.firstPhrase.split(' ').filter(Boolean)).some((stem) => worldStems.has(stem)) ||
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
    // The business's own world, never any word of its type (AGL-4092): a cat
    // tagged "hungry" named "breakfast", and a European alley "street", of
    // "Taco food trailer: street and breakfast tacos".
    if (own.length && !ownWorld && !phrased) return 0
    score += leading ? 4 : 2
    if (kinNamed) score += 3
    if (firstNamed(kin.length ? kin : [object])) score += 1
    // A product's photo is OF it: named by its first or second tag, over one naming it fourth (AGL-4092).
    if (judgement.product) {
      const firstTwo = (photo.tags ?? []).slice(0, 2).map((tag) => stemList(tag).join(' '))
      if ((kin.length ? kin : [object]).some((phrase) => among(firstTwo, phrase))) score += 2
    }
  } else if (own.length) {
    if (!ownWorld) return 0
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
    const said = hit.leadPhrases.slice(0, -1).filter((phrase) => withPairs(phrase.split(' ')).some((stem) => worldStems.has(stem)))
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
 * Every other order is kept. A product's are of a shoot no slot shows yet
 * first among ALL its accepted hits (`whole`, AGL-4092): Berm & Bolt's two
 * tires were one contributor's shoot, 32 uploads apart.
 */
export function aiStockFreshShootsFirst(
  ranked: readonly StockPhoto[],
  shown: readonly StockPhoto[],
  judgement: AiStockJudgement,
  options: { whole?: boolean } = {},
): StockPhoto[] {
  if (!shown.length || ranked.length < 2) return [...ranked]
  const best = aiStockRelevance(ranked[0] as StockPhoto, judgement)
  const top = options.whole ? ranked : ranked.filter((photo) => aiStockRelevance(photo, judgement) === best)
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
 * The library photos a stored page shows, each as a slot takes it (AGL-3988):
 * its source, its size and what it shows. A photo the job placed on another
 * page is what a slot the library failed takes before any starter
 * (`aiLayoutJobPhotoPicks`). Each photo once; one without a size is left out.
 */
export function aiStockPlacedPhotos(nodes: NodesMap | null | undefined): AiLayoutPicturePhoto[] {
  const map = (nodes ?? {}) as unknown as Record<string, { componentId?: string; props?: Record<string, unknown> }>
  const out = new Map<string, AiLayoutPicturePhoto>()
  for (const node of Object.values(map)) {
    if (node?.componentId !== 'image') continue
    const src = node.props?.['src']
    const width = Number(node.props?.['intrinsicWidth'])
    const height = Number(node.props?.['intrinsicHeight'])
    if (typeof src !== 'string' || !src.startsWith('media:') || out.has(src)) continue
    if (!(width > 0) || !(height > 0)) continue
    const alt = typeof node.props?.['alt'] === 'string' ? (node.props['alt'] as string).trim() : ''
    out.set(src, { src, width, height, ...(alt ? { alt } : {}) })
  }
  return [...out.values()]
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
    // How a photo is laid out, never a thing it shows: "car wallpapers" is a car (AGL-3942).
    'wallpaper wallpapers background backgrounds backdrop backdrops texture textures ' +
    // Words a tag gives that are no noun at all: "family, together" is a family (AGL-3942).
    'together alone apart away abroad ahead nearby outside inside upstairs downstairs ' +
    // Adjectives a tag gives alone, never a thing: "students, multicultural" (AGL-3856).
    'multicultural multiethnic multiracial diverse international cultural traditional modern classic classical ' +
    'domestic wild tropical rural urban ' +
    // How the photo was made, never what it shows: "cutout, perspective", "men, silhouettes".
    'silhouette silhouettes cutout perspective bokeh closeup ' +
    // A holiday names when, never a thing: "tet market" is a market.
    'tet christmas easter halloween diwali ramadan hanukkah thanksgiving ' +
    'indian asian african american european caucasian vietnamese japanese chinese korean thai latino latina hispanic ' +
    'japan vietnam viet nam thailand india china korea germany france italy spain england britain uk usa america ' +
    'canada mexico brazil australia africa europe asia ' +
    // How a scene feels or looks, never a thing in it (AGL-3988): "mountain,
    // snow, winter, cold, couple, color, landscape" is a couple in the snow.
    'cold warm hot chilly freezing frozen icy color colors colour colours landscape landscapes ' +
    'panorama panoramic vista scene scenes',
)

/**
 * The sky and the light over a scene, never a thing in it (AGL-3988): "A
 * couple with a sky at sunset" and "A child with clouds by a lake" were a
 * couple at sunset and a child by a lake.
 */
const SCENERY = words('sky skies cloud clouds sun sunshine sunlight daylight light shadow shadows horizon')

/**
 * The weather a scene is in, said as where (AGL-3988): "A couple with a fog
 * at a wedding" was a couple in the fog, "A snow in the mountains" a couple
 * in the snow.
 */
const WEATHER: Readonly<Record<string, string>> = {
  fog: 'in the fog',
  mist: 'in the mist',
  haze: 'in the haze',
  rain: 'in the rain',
  snow: 'in the snow',
  snowfall: 'in the snow',
  snowflakes: 'in the snow',
  wind: 'in the wind',
}

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
    'skincare equipment decor wildlife weather traffic wine beer chocolate rice sugar flour milk ' +
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
    'press show day days night year years time holiday month months week weeks morning evening afternoon season seasons ' +
    'kiss hug embrace ' +
    // A feeling, never a thing anyone holds (AGL-3988): "A father with a care".
    'care worry trust hope joy peace fear faith grief pride comfort safety bliss delight passion desire feeling feelings ' +
    'moment moments memory memories fashion style ' +
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
    // The vehicle makers a moto site's photos are tagged with (AGL-4065), and its gear's and tires' (AGL-4092).
    'yamaha kawasaki suzuki ktm ducati harley harley-davidson husqvarna gasgas nissan subaru mazda chevy dodge reebok ' +
    `${GEAR_MAKER_WORDS.join(' ')} ` +
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
    'journalist journalists reporter reporters master masters lovers newlywed newlyweds husband wife fiance fiancee spouse ' +
    // Whoever else is about (AGL-3988): "A family with tourists" was a family.
    'tourist tourists traveler travelers traveller travellers hiker hikers visitor visitors friend friends crowd ' +
    // A family's people, said as a parent with a child (AGL-3988).
    'dad dads mom moms mum mums son sons daughter daughters toddler toddlers',
)
/** People said by no role: a model is whoever posed (AGL-3856), "a woman" of "woman, model, show, teacher". */
const GENERIC_PEOPLE = words(
  'man men woman women person people human humans guy guys lady ladies adult boy boys girl girls model models ' +
    'tourist tourists traveler travelers traveller travellers hiker hikers visitor visitors friend friends crowd',
)

/** A parent a photo shows, said with the child beside them: "A father with a girl" (AGL-3988). */
const PARENTS = words('father mother dad mom mum parent parents grandfather grandmother grandparent grandparents')

/** A child a photo shows beside a parent (AGL-3988). */
const CHILDREN = words('child children kid kids baby babies toddler toddlers girl girls boy boys son sons daughter daughters')

/** How a family's word is said: "a dad" is a father (AGL-3988). */
const SAID_AS: Readonly<Record<string, string>> = { dad: 'father', dads: 'fathers', mom: 'mother', moms: 'mothers', mum: 'mother', mums: 'mothers' }

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
  lakeside: 'by',
  lakeshore: 'by',
  sea: 'by',
  ocean: 'by',
  seaside: 'by',
  coast: 'on',
  shore: 'on',
  sundown: 'at',
  waterfall: 'at',
}

/** Places that are things too, a photo's subject where nothing else is: "a desk in a classroom". */
const OBJECT_PLACES = words('desk table counter bridge bed sofa couch bench')

/** Places said without an article: "in court", "at sunset". */
const BARE_PLACES = words('court sunset sunrise sundown dusk dawn')

/** Places said in words of their own: a mountain tag is "in the mountains". */
const PLACES_SAID: Readonly<Record<string, string>> = {
  mountain: 'the mountains',
  lakeside: 'the lake',
  lakeshore: 'the lake',
  sea: 'the sea',
  ocean: 'the ocean',
  seaside: 'the sea',
  coast: 'the coast',
  shore: 'the shore',
}

/** Places that say when, said after where: "a couple in the mountains at sunset" (AGL-3988). */
const TIME_PLACES = words('sunset sunrise sundown dusk dawn')

/** Places out of doors, said after a thing to sit on: "a couple on a bench by the lake" (AGL-3988). */
const OUTDOORS = words(
  'forest field meadow valley mountain hill cliff river lake lakeside lakeshore waterfall beach park garden trail sea ocean seaside coast shore',
)

/** Words inside a tag that say one thing is where another is: "couple on bench" (AGL-3988). */
const TAG_PREPOSITIONS = words('on in at by with under near beside')

/**
 * A tag that is a phrase of its own, read as its parts (AGL-3988): "couple
 * on bench" is a couple, and a bench they are on. The beta.270 Sugar Hollow
 * About page read it whole, as a place, and said "A lakeside on a couple on
 * bench".
 */
function tagParts(tag: string): string[] {
  const list = tag.toLowerCase().trim().split(/\s+/)
  const at = list.findIndex((word, index) => index > 0 && index < list.length - 1 && TAG_PREPOSITIONS.has(word))
  return at > 0 ? [list.slice(0, at).join(' '), list.slice(at + 1).join(' ')] : [tag]
}

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
  // Two people named side by side are both shown: "bride groom" is a bride and groom (AGL-3942).
  if (list.length === 2 && list.every((word) => PEOPLE_NOUNS.has(word)) && list[0] !== list[1])
    return `${articleFor(list[0] as string)} ${list[0]} and ${list[1]}`
  const last = list[list.length - 1] as string
  // An idea or a doing, never a thing: "law", "feedback", "customer satisfaction", "participation", "weightlifting".
  if (ABSTRACT_NOUNS.has(last) || ABSTRACT_NOUNS.has(aiStockStem(last)) || saysAnIdea(last)) return null
  const doing = last.endsWith('ing') && !COUNTED_ING.has(aiStockStem(last)) && !UNCOUNTED_ING.has(last)
  if (doing) return null
  const phrase = list.join(' ')
  const plural =
    PLURAL_NOUNS.has(last) || (aiStockStem(last) !== last && !/^(?:lens|canvas|atlas|gas|bus)$/.test(last))
  if (plural || MASS_NOUNS.has(last) || (STOPWORDS.has(list[0] as string) && !SAID_PEOPLE.has(list[0] as string)))
    return spelled(phrase)
  return `${articleFor(phrase)} ${spelled(phrase)}`
}

/** Letters said one by one, written in capitals: "an SLR camera", "a DSLR" (AGL-3942). */
const INITIALISMS = words('slr dslr tv dj diy bbq suv atv uv vr')

/** A phrase as a description writes it, its initialisms in capitals. */
const spelled = (phrase: string) =>
  phrase
    .split(' ')
    .map((word) => (INITIALISMS.has(word) ? word.toUpperCase() : word))
    .join(' ')

/** "a" or "an" before a phrase, an initialism by how its first letter is said: "an SLR", "a DSLR". */
const articleFor = (phrase: string) => {
  const first = phrase.split(' ')[0] ?? ''
  if (INITIALISMS.has(first)) return /^[aefhilmnorsx]/.test(first) ? 'an' : 'a'
  return /^(?:[aeio]|u(?!ni|s[eu]))/.test(phrase) ? 'an' : 'a'
}

/** Words a description never ends on: an article, a preposition, a conjunction. */
const DANGLING_END = /(?:\s+(?:a|an|the|and|or|with|in|on|at|by|of|for|to|from|into|onto))+$/i

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
 * - no word is said twice: never "an elderly couple and an elderly";
 * - the sky, the clouds and the light are no thing anyone holds, and the
 *   weather is said as where it is: "a couple in the fog at a wedding",
 *   "a couple in the snow in the mountains", never "a couple with a sky at
 *   sunset" or "a snow in the mountains"; a feeling ("care", "worry") is no
 *   thing either; whoever else is about ("tourists") is never said beside a
 *   family; a parent beside a child is said with them ("a father with a
 *   girl"); a tag that is a phrase of its own ("couple on bench") is read as
 *   its parts; a time of day comes after where ("in the mountains at
 *   sunset"), and a bench out of doors says where it stands ("on a bench by
 *   the lake") (AGL-3988).
 *
 * `null` where no tag names a thing.
 */
export function aiStockTagsAlt(tags: readonly string[], proper: ReadonlySet<string> = new Set()): string | null {
  const parts: AiStockAltPart[] = []
  let quality = ''
  let portrait = false
  /** The weather it is in, said as where ({@link WEATHER}). */
  let weather = ''
  const read = tags.slice(0, ALT_PLACE_TAGS_READ).flatMap((tag, index) => tagParts(tag).map((part) => ({ tag: part, index })))
  for (const { tag, index } of read) {
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
    // The sky is never a thing a photo is described by; the weather is where it is.
    if (SCENERY.has(lower)) continue
    if (WEATHER[lower]) {
      if (reading) weather ||= WEATHER[lower] as string
      continue
    }
    const family = SAID_AS[lower]
    const said = family ? `${articleFor(family)} ${family}`.replace(/^an? (?=\S+s$)/, '') : describedTag(tag, proper)
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
  // A parent beside a child is said with them (AGL-3988): "A father with a
  // girl", never "a child with clouds" of "child, clouds, dad, dock, father".
  const parent = people.find((part) => PARENTS.has(part.head) && part.index < ALT_ROLE_TAGS_READ)
  const child = people.find((part) => CHILDREN.has(part.head) && part.index < ALT_ROLE_TAGS_READ)
  const family = parent && child && (!role || role === parent || role === child) ? parent : undefined
  const person = family ?? role ?? people.find(leads)
  // Nothing but places: a desk is the thing in a classroom; "a school in a classroom" says one place.
  if (!person && !things.length && places.length > 1) {
    const object = places.find((part) => OBJECT_PLACES.has(part.head))
    if (object) {
      things = [object]
      places = places.filter((part) => part !== object)
    } else places = places.slice(0, 1)
  }
  const place = places[0]
  if (!person && !things.length && !place && !weather) return null
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
    const held = family && child && child !== person ? child : things.find((part) => part.index <= 2)
    if (!portrait && held && fresh(held)) phrase += ` ${CLOTHING.has(held.head) ? 'in' : 'with'} ${held.said}`
  } else if (things[0] && fresh(things[0])) {
    phrase = qualified(things[0])
    const second = things[1]
    if (second && second.index <= 1 && !place && fresh(second)) phrase += ` and ${second.said}`
  }
  /** A place as it is said alone: "a classroom", "the mountains", "sunset". */
  const placeOf = (part: AiStockAltPart) =>
    PLACES_SAID[part.head] ?? (BARE_PLACES.has(part.head) && /^an? \S+$/.test(part.said) ? part.head : part.said)
  /** A place as it is said after what is there: "in the mountains", "at sunset", "on a bench". */
  const whereOf = (part: AiStockAltPart) => `${PLACES[part.head] ?? 'in'} ${placeOf(part)}`
  // The weather is said before where (AGL-3988): "a couple in the fog at a
  // wedding"; alone, it is what the photo shows: "snow in the mountains".
  if (weather && phrase) phrase += ` ${weather}`
  else if (weather) phrase = weather.replace(/^in the /, '')
  if (place && fresh(place)) {
    // A second place where the first is a time of day or a bench out of
    // doors: "a couple in the mountains at sunset", "a couple on a bench by
    // the lake"; never a bed in a room.
    const second = places.find(
      (part) =>
        part !== place &&
        !OBJECT_PLACES.has(part.head) &&
        !TIME_PLACES.has(part.head) &&
        (TIME_PLACES.has(place.head) || (place.head === 'bench' && OUTDOORS.has(part.head))),
    )
    const after = second && fresh(second) ? second : null
    const [first, last] = after && TIME_PLACES.has(place.head) ? [after, place] : [place, after]
    const tail = last ? ` ${whereOf(last)}` : ''
    phrase = phrase ? `${phrase} ${whereOf(first)}${tail}` : `${placeOf(first)}${tail}`
  }
  // Never a dangling article or preposition, whatever a tag left behind.
  phrase = phrase.replace(DANGLING_END, '').trim()
  if (!phrase || /^(?:a|an|the)$/i.test(phrase)) return null
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
  /** The clock a refusal is dated by (AGL-3988); specs hand in a fixed one. */
  now?: () => number
}

/** A slot's choice: the accepted hits it may be filled from, best first, and the query that found them. */
interface AiStockChoice {
  candidates: StockPhoto[]
  query: string
  /** The search that answered them, as it was sent (AGL-3988): what the late photo pass asks again. */
  request: StockPhotoSearchRequest
  /** A photo another slot of the job already shows, reused rather than an off-topic one (AGL-3660). */
  repeat?: boolean
}

/** The words of a search that only this module reads, never sent to a library. */
const SEARCH_JUDGMENT_KEYS = [
  'broad',
  'subject',
  'requires',
  'object',
  'kin',
  'lead',
  'leadWorld',
  'leadOwn',
  'oddLeads',
  'served',
  'first',
  'category',
  'strict',
  'refuse',
  'needs',
  'allow',
  'refuseLead',
  'worldless',
  'away',
] as const

/** A search as it is sent to the library: its words and size, none of how its hits are judged. */
export function aiStockSearchRequest(wanted: AiStockSearch): StockPhotoSearchRequest {
  const request: Record<string, unknown> = { ...wanted }
  for (const key of SEARCH_JUDGMENT_KEYS) delete request[key]
  return request as unknown as StockPhotoSearchRequest
}

/**
 * A search as a job keeps it to ask again (AGL-3988): only what a library's
 * request is made of, so asked again it is the same request, which the
 * provider's 24-hour cache answers.
 */
export function aiStockKeptRequest(request: StockPhotoSearchRequest): StockPhotoSearchRequest {
  return {
    query: request.query,
    ...(request.orientation ? { orientation: request.orientation } : {}),
    ...(request.minWidth ? { minWidth: request.minWidth } : {}),
    ...(request.minHeight ? { minHeight: request.minHeight } : {}),
    ...(request.people ? { people: true } : {}),
  }
}

/**
 * The library's own record of a photo copied into a site (AGL-3923, AGL-3988):
 * what the media library stores beside the bytes as `stockPhoto`, with the
 * credit its license asks for. One shape for every copy a job makes, a
 * page's and the late photo pass's.
 */
export function aiStockIngestRequest(
  provider: Pick<StockPhotoProvider, 'credit'>,
  input: { hostId: string; uid: string; photo: StockPhoto; bytes: { bytes: Uint8Array; contentType: string }; alt: string; query: string },
): Parameters<PluginMediaIngest['ingest']>[0] {
  const { photo, bytes } = input
  const credit = provider.credit(photo)
  return {
    hostId: input.hostId,
    uid: input.uid,
    fileName: `${photo.provider}-${photo.id}.${EXTENSIONS[bytes.contentType] ?? 'jpg'}`,
    contentType: bytes.contentType,
    bytes: bytes.bytes,
    alt: input.alt,
    description: credit.text,
    stockPhoto: {
      key: stockPhotoSourceKey(photo),
      provider: photo.provider,
      providerLabel: credit.providerLabel,
      id: photo.id,
      pageUrl: photo.pageUrl,
      photographer: photo.photographer,
      ...(photo.photographerUrl ? { photographerUrl: photo.photographerUrl } : {}),
      license: credit.license,
      licenseUrl: credit.licenseUrl,
      attributionRequired: credit.attributionRequired,
      query: input.query,
    },
  }
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
  // A craft whose pictures are people at a moment shows the moments its site names (AGL-3942).
  const work = terms.scenes ? aiStockWorkScenes([input.business, input.audience ?? ''].join(' . '), setting) : []
  return {
    ...terms,
    ...(aiStockAdultsOnly([input.audience, input.name, input.business]) ? { adults: true } : {}),
    ...(setting ? { setting } : {}),
    ...(work.length ? { work } : {}),
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
  const domain = [...new Set([...base.domain, ...kin])]
  return {
    ...base,
    domain,
    // The kind's own world is all of it: its subject and its kin (AGL-4065).
    lead: domain,
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
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'broad' | 'domain'> & Partial<Pick<AiStockSiteTerms, 'lead'>>,
  kind: string,
): Array<{ rung: 'kind' | 'starter' | 'generic'; terms: AiStockSiteTerms }> {
  const rungs: Array<{ rung: 'kind' | 'starter' | 'generic'; terms: AiStockSiteTerms }> = []
  const seen = new Set<string>([JSON.stringify([terms.craft, [...terms.broad]])])
  // An outdoor or a trade world never widens to an office's photos (AGL-4065).
  const outdoor = aiStockWorldIsOutdoorOrTrade(terms)
  const add = (rung: 'kind' | 'starter' | 'generic', of: string, found: AiStockSiteTerms | null) => {
    if (!found || !found.broad.length) return
    if (outdoor && OFFICE_KINDS.has(of)) return
    const key = JSON.stringify([found.craft, found.broad])
    if (seen.has(key)) return
    seen.add(key)
    rungs.push({ rung, terms: found })
  }
  if (!aiStockWorldIsUnlisted(terms)) {
    if (kind && worldOfKind(terms, kind)) add('generic', kind, aiStockKindGenericTerms(kind))
    return rungs
  }
  const starter = starterOfKind(kind)
  const starterKind = STARTER_KINDS[starter] ?? 'business'
  if (kind) add('kind', kind, aiStockKindTerms(kind))
  add('starter', starterKind, aiStockKindTerms(starterKind))
  const generic = KIND_GENERIC[kind] ? kind : (STARTER_GENERIC_KIND[starter] ?? 'business')
  add('generic', generic, aiStockKindGenericTerms(generic))
  return rungs
}

/**
 * The kinds of site whose photos are an office, a desk or a workspace
 * (AGL-4065): what a landscaper, a roofer or a taco trailer never widens to.
 */
const OFFICE_KINDS: ReadonlySet<string> = new Set(['business', 'landing', 'professional', 'personal', 'coming-soon', 'studio'])

/**
 * Words of a world whose work is done outdoors, on a vehicle, with tools or
 * over food (AGL-4065), as stems: such a world's pictures are never an
 * office's. The Bluebonnet Yard & Landscape start, a world the module did not
 * list, picked as Business & services, opened every page on an office.
 */
const OUTDOOR_AND_TRADE_STEMS: ReadonlySet<string> = new Set(
  (
    'landscaping landscaper landscape lawn garden gardening yard roof roofing roofer fence fencing deck patio construction ' +
    'contractor farm ranch moto motorcycle motocross bike dirt atv truck trailer tow towing auto car mechanic food ' +
    'restaurant kitchen taco plumbing plumber electrician electrical hvac painting painter handyman carpentry carpenter ' +
    'tree pool pest cleaning junk excavation concrete masonry welding'
  )
    .split(' ')
    .map(aiStockStem),
)

/** Whether a site's own world is outdoors, on a vehicle, with tools or over food ({@link OUTDOOR_AND_TRADE_STEMS}). */
export function aiStockWorldIsOutdoorOrTrade(
  terms: Pick<AiStockSiteTerms, 'business' | 'craft' | 'domain'> & Partial<Pick<AiStockSiteTerms, 'lead'>>,
): boolean {
  const own = [...(terms.lead ?? terms.domain), ...stemList(`${terms.business} ${terms.craft}`)]
  return own.some((term) => term.split(' ').some((stem) => OUTDOOR_AND_TRADE_STEMS.has(stem)))
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
 * Which of a list's records are each of a thing of its own (2026-10-29,
 * AGL-4092, {@link aiStockThingOfItsOwn}), by position: a taco trailer's
 * "Bottled Water" is a bottle of water, and the list's other photos are
 * tacos, so it never takes one of theirs. None on a site in another
 * language, whose record names no English thing. Pure.
 */
export function aiStockRecordsOfTheirOwn(
  input: Pick<AiLayoutStockPhotoSourceInput, 'business' | 'language' | 'photoWords' | 'kindWords' | 'name' | 'audience' | 'kind'>,
  names: readonly string[],
): boolean[] {
  if (aiLayoutSpeaksOtherThanEnglish(input.language)) return names.map(() => false)
  const terms = aiStockSourceTerms(input)
  return names.map((name) => aiStockThingOfItsOwn(aiStockSubjectWords(name, ''), terms))
}

/**
 * How a search's hits are judged for a slot (AGL-3660), as the source judges
 * them: by the search's own words, held to the world it was asked for — the
 * site's own (`site`), or a wider one where the site's found nothing
 * (`world`, AGL-3923). What lets a sensitive topic, an animal or a body part
 * in is always the site's own words. On a site for adults alone no hit names
 * a child; a portrait of one of the business's people names an adult, never
 * leads with a child, and is preferred in its role (AGL-3856). Any other
 * picture never leads with an animal, a toy or a bare body part its words
 * and the brief do not name, unless its first tags name the business's own
 * world too (AGL-4092): Pit Row Tacos' "Come hungry" took a cat. Pure.
 */
export function aiStockJudgementFor(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'alt' | 'people' | 'product'>,
  request: AiStockSearch,
  subject: string,
  site: AiStockSiteTerms,
  sectionName = '',
  world: AiStockSiteTerms = site,
): AiStockJudgement {
  const refuse = [...(request.refuse ?? []), ...(site.adults ? CHILD_STEMS : [])]
  const role = slot.people ? aiStockPeopleRole(slot.alt, sectionName) : null
  // A portrait's face is its own, and a craft whose pictures are people at a moment shows their hands and rings (AGL-4092).
  const oddLeads = slot.people
    ? []
    : aiStockOddLeads([slot.alt, ...(slot.product?.subjects ?? []), sectionName, ...site.named], {
        body: slot.role !== 'about' && !site.scenes,
      })
  return {
    subject: request.subject ?? (request.broad ? '' : subject),
    domain: world.domain,
    ...(world.lead?.length ? { world: world.lead } : {}),
    strict: (slot.role === 'gallery' && !request.broad) || !!request.requires || !!request.strict,
    named: request.allow?.length ? [...new Set([...site.named, ...request.allow])] : site.named,
    rivals: world.rivals,
    ...(world.shun.length || request.shun?.length ? { shun: [...new Set([...world.shun, ...(request.shun ?? [])])] } : {}),
    ...(world.shunLead.length ? { shunLead: world.shunLead } : {}),
    ...(request.product ? { product: true } : {}),
    ...(request.leadAny?.length ? { leadAny: request.leadAny } : {}),
    ...(request.requires ? { requires: request.requires } : {}),
    ...(request.category ? { category: request.category } : {}),
    ...(request.object ? { object: request.object } : {}),
    ...(request.kin ? { kin: request.kin } : {}),
    ...(request.lead ? { lead: true } : {}),
    ...(request.leadWorld ? { leadWorld: true } : {}),
    ...(request.leadOwn ? { leadOwn: true } : {}),
    ...(request.served?.length ? { served: request.served } : {}),
    ...(request.first ? { first: true } : {}),
    ...(refuse.length ? { refuse: [...new Set(refuse)] } : {}),
    ...(request.needs?.length ? { needs: request.needs } : {}),
    ...(request.refuseLead?.length ? { refuseLead: request.refuseLead } : {}),
    ...(request.away?.length ? { away: request.away } : {}),
    ...(oddLeads.length ? { oddLeads } : {}),
    // An off-road business's pictures are never a street bike's; its products are parts that fit either (AGL-4092).
    ...(site.road?.length && !request.product ? { road: site.road, ground: site.ground ?? [] } : {}),
    // A portfolio's record is of its own subject, never of the craft's world (AGL-3856).
    ...(request.worldless ? { domain: [], rivals: [] } : {}),
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
 * The craft's own photos, the last thing a slot of a craft's site is filled
 * from (AGL-3660): its broad searches, any hit naming the craft itself. Never
 * a desk, a laptop or a living room for a soap shop. A picture that is not a
 * hero nor a product takes only a photo OF the business's own world among its
 * first tags (AGL-4092): a taco trailer's "Race day" took a chicken salad
 * tagged "taco bowl". Pure.
 */
export function aiStockCraftSearches(
  slot: Pick<AiLayoutPictureSlot, 'role' | 'aspect' | 'record' | 'people' | 'product'>,
  world: AiStockSiteTerms,
  subject = '',
): AiStockSearch[] {
  // A portfolio's record of the work is never filled by the craft's own
  // photos (AGL-3856), nor is any picture of a site that shows its work (AGL-3942).
  if (!world.core.length || aiStockShowsTheWork(slot, world) || aiStockShowsItsWork(slot, world)) return []
  // Nor is a record or a product of a thing of its own (AGL-4092): "Bottled Water" is no taco.
  if ((slot.record || slot.product) && subject && aiStockThingOfItsOwn(subject, world)) return []
  const orientation = aiStockOrientation(slot.aspect)
  const size = slot.role === 'hero' ? { minWidth: 1600 } : orientation === 'vertical' ? { minHeight: 900 } : { minWidth: 900 }
  return world.broad.map((query) => ({
    query: clip(query),
    orientation,
    ...size,
    broad: true,
    category: world.core,
    // A trade's product, too: a transmission tagged "motorcycle" last is not a dirt bike shop's photo.
    ...(slot.role === 'hero' ? { first: true } : slot.product && !world.held?.length ? {} : { leadOwn: true }),
    ...(slot.product ? { product: true, tier: 'weak' as const } : {}),
  }))
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
  // Where the site's own words say it is: a street there may be its own (AGL-4092).
  const here = [...new Set(stemList([input.business, input.audience ?? '', input.name ?? ''].join(' ')))]
  const now = deps.now ?? Date.now
  return async (slots, report) => {
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
    /** Each slot's picks the image hosts would not hand over, and when (AGL-3988). */
    const refusedPicks = new Map<AiLayoutPictureSlot, { keys: string[]; at: number }>()
    /** Whether the library answered any search of this page: a slot left empty then found nothing fitting. */
    let answered = false
    const remember = (sourceKey: string, src: string) => {
      placedSrcs.add(src)
      job?.set(sourceKey, scope)
      job?.set(src, scope)
    }
    /** A search's hits; the same words twice are answered from memory, and `null` once the page's searches are spent. */
    const search = (wanted: AiStockSearch): Promise<StockPhoto[] | null> => {
      const request = aiStockSearchRequest(wanted)
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
            // Asked for again by the late photo pass, once the burst is over (AGL-3988).
            const held = refusedPicks.get(slot) ?? { keys: [], at: 0 }
            if (!held.keys.includes(sourceKey)) held.keys.push(sourceKey)
            held.at = now()
            refusedPicks.set(slot, held)
            console.warn('ai layout pictures: a stock photo could not be downloaded', { provider: photo.provider, id: photo.id })
          }
          return null
        }
        const stored = await ingest.ingest(
          aiStockIngestRequest(provider, { hostId: input.hostId, uid: input.uid, photo, bytes, alt: alt ?? slot.alt, query }),
        )
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
    ): AiStockJudgement => ({
      ...aiStockJudgementFor(slot, request, subject, terms, input.sectionNames[slot.sectionIndex] ?? '', worldOf.get(request) ?? terms),
      here,
    })
    const craftSearches = (slot: AiLayoutPictureSlot, world: AiStockSiteTerms = terms, subject = ''): AiStockSearch[] =>
      aiStockCraftSearches(slot, world, subject)

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
        // A wider world is the site's only as a kind of site: its photos are held to it as before (AGL-4092).
        ask(
          world,
          [...aiStockSearchesFor(slot, world, subject, part, sectionName), ...craftSearches(slot, world)].map(
            ({ leadOwn: _own, ...request }) => request,
          ),
        )
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
              ...(terms.held ? { held: terms.held } : {}),
              ...(terms.leadWord ? { leadWord: terms.leadWord } : {}),
            })
          : aiStockSearchesFor(
              slot,
              terms,
              subject,
              aiStockSlotPart(slot, sectionName),
              sectionName,
            )),
        ...craftSearches(slot, terms, slot.product ? aiStockProductSubject(slot) : subject),
      ]
      /** Whether the library answered any of the slot's own searches with a photo at all (AGL-4065). */
      let knew = false
      /** The slot's accepted hits for a search; `null` once the page's searches are spent. */
      const accepted = async (
        request: AiStockSearch,
        repeat: boolean,
      ): Promise<StockPhoto[] | null> => {
        const found = await search(request)
        if (found === null) return null
        if (found.length && !worldOf.has(request)) knew = true
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
        // A team's portraits are of different people where the hits allow (AGL-3856),
        // and a shop's products of different shoots (AGL-4092).
        if (repeat || !(slot.people || slot.product)) return ranked
        return aiStockFreshShootsFirst(ranked, shown, judgement, slot.product ? { whole: true } : {})
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
            request: aiStockKeptRequest(aiStockSearchRequest(request)),
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
      //    and then, for a hero, one the job already shows. A listed world
      //    widens only where the library knew nothing of it (AGL-4065): one
      //    it answered with photos it turned down keeps its slot without a
      //    photo, never an office. A world of its own words alone still widens.
      const widened = widerSearches(slot, subject, sectionName)
      const phases: Array<[readonly AiStockSearch[], boolean, boolean]> = [
        [sure, false, false],
        ...(repeats ? [[sure, true, false] as [readonly AiStockSearch[], boolean, boolean]] : []),
        ...(unsure.length
          ? [
              [unsure, false, false] as [readonly AiStockSearch[], boolean, boolean],
              [unsure, true, false] as [readonly AiStockSearch[], boolean, boolean],
            ]
          : []),
        ...(widened.length ? [[widened, false, true] as [readonly AiStockSearch[], boolean, boolean]] : []),
        ...(widened.length && repeats ? [[widened, true, true] as [readonly AiStockSearch[], boolean, boolean]] : []),
      ]
      for (const [tried, repeat, wide] of phases) {
        if (choice || signal.aborted) break
        if (wide && knew && !unlisted) break
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
    // A slot left without a photo because its picks were refused: what they
    // were, for the late photo pass to ask for again (AGL-3988).
    for (const [index, slot] of slots.entries()) {
      const held = refusedPicks.get(slot)
      const choice = choices[index]
      if (photos[index] || !held?.keys.length || !choice) continue
      report?.refused.set(slot, { request: choice.request, keys: held.keys, at: new Date(held.at).toISOString() })
    }
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
