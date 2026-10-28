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

/**
 * THE DESIGNER LAYER of the layout compiler (AGL-3660): how a page the model
 * described in the layout language is ARRANGED, decided by code from the
 * site's kind and its job's seed — never asked of the model, so a recorded
 * answer compiles into the new design with no new call.
 *
 * Why. A page compiled one way for every site read like a SaaS landing page:
 * a centered text hero, three outlined cards, a numbered row, a solid form
 * band. The designer templates people compare a site to (Squarespace's Loam,
 * Clove, Auburn, Rivoli, Matsuya; Wix's portfolio and restaurant sets) are
 * built from a handful of moves instead — a full-bleed photo hero with the
 * type over it, image and text side by side, work shown as pictures in an
 * uneven grid, writing as a list under thin rules, a closing band over a
 * photo — and they pick those moves for the KIND of site.
 *
 * So a site's design is a set of VARIANTS — the hero's arrangement, how its
 * groups are drawn, whether its text sections take a picture beside them,
 * how its closing section reads — each chosen among the ones that suit the
 * kind, by the seed. The choices are the site's: every page of one site is
 * drawn with the same hero and the same group style, so the site reads as
 * one design, and two sites of one kind come out differently.
 *
 * This is NOT a template library. A variant is a way of drawing whatever the
 * model wrote; the sections, their order, their bands, their words and how
 * many items each shows are still the model's, page by page.
 *
 * Pure: no tree, no theme, no network.
 */

/** What the compiler is told about the site a page belongs to. */
export interface AiLayoutDesign {
  /** The site's kind (`AI_SITE_KINDS`); an unknown one draws as a business site. */
  kind: string
  /** The job's design seed: the same for every page of one site. */
  seed: number
  /** Whether this page is the site's home, which opens tallest. */
  home: boolean
}

/**
 * How the first section of a page is drawn:
 *  - `cover`: a full-bleed photo with the words over it on a scrim, set at
 *    the start of the page;
 *  - `poster`: a full-bleed photo, taller, the words centered over it in
 *    display type (AGL-3985);
 *  - `split`: the words beside a tall photo, inside the page's measure;
 *  - `bleed`: the band in two halves, a photo filling one edge to edge and
 *    the words in the other (AGL-3985);
 *  - `editorial`: display type across the page, the lede and the buttons in
 *    a row under it, and a wide photo below;
 *  - `column`: a masthead — the words centered in a narrow column, a wide
 *    photo under them (AGL-3985);
 *  - `collage`: the words beside two photos, a tall one and a smaller one
 *    laid over its corner (AGL-3985);
 *  - `panel`: a full-bleed photo, undimmed, with the words on a card of the
 *    page's surface over its lower corner (AGL-3985);
 *  - `portrait`: a round photo over the words, all centered: a person's own
 *    page (AGL-3985).
 */
export type AiLayoutHeroVariant = 'cover' | 'poster' | 'split' | 'bleed' | 'editorial' | 'column' | 'collage' | 'panel' | 'portrait'

/** Every hero arrangement, as {@link AiLayoutHeroVariant} lists them. */
export const AI_LAYOUT_HERO_VARIANTS: readonly AiLayoutHeroVariant[] = ['cover', 'poster', 'split', 'bleed', 'editorial', 'column', 'collage', 'panel', 'portrait']

/** The heroes whose words take half the page or less, so their title is the page's title size, never display. */
export const AI_LAYOUT_HALF_HEROES: ReadonlySet<AiLayoutHeroVariant> = new Set(['split', 'bleed', 'collage', 'panel'])

/** The heroes that lay their words over a photo, which pins the section to the site's dark scheme. */
export const AI_LAYOUT_OVER_PHOTO_HEROES: ReadonlySet<AiLayoutHeroVariant> = new Set(['cover', 'poster'])

/**
 * How a group of cards is drawn where no component draws it:
 *  - `cards`: the theme's cards (the compiler's first design);
 *  - `ruled`: open columns, each under a thin rule, no card around it;
 *  - `pictures`: a picture over each item's title and caption, in an uneven
 *    grid (work, products);
 *  - `articles`: a picture over each title and summary, in even columns (writing);
 *  - `menu`: two columns of lines under rules (dishes, prices left out);
 *  - `icons`: open columns, each led by an icon in a soft disc over its title
 *    and words — a storefront's reasons to buy (shipping, small batch,
 *    returns), never a block of text (AGL-3676).
 */
export type AiLayoutGroupVariant = 'cards' | 'ruled' | 'pictures' | 'articles' | 'menu' | 'icons'

/** How a numbered group is drawn: a row of numbers, or a ruled list beside its heading. */
export type AiLayoutStepsVariant = 'numbers' | 'timeline'

/** The site-level choices a page is drawn with. */
export interface AiLayoutDesignChoices {
  hero: AiLayoutHeroVariant
  /** The group style of a section that names no subject the kind draws its own way. */
  group: 'cards' | 'ruled' | 'icons'
  steps: AiLayoutStepsVariant
  /** Whether a section of words takes a photo beside it. */
  features: boolean
  /** Whether the photo of the first such section sits on the left. */
  featureLeft: boolean
  /** Whether a closing section of words is drawn over a photo. */
  coverClose: boolean
  /** Whether a section's heading sits beside its items rather than over them. */
  splitHeads: boolean
  /** How work is laid out where the kind shows it as pictures. */
  pictures: 'mosaic' | 'even'
  /**
   * How a blog's own posts are listed where a page shows them (AGL-3676):
   * `grid`, a cover over each post's date, title and excerpt in columns; or
   * `ruled`, a list under thin rules, the date in its own column and a small
   * cover beside each title — the two ways an editorial site lists writing.
   */
  writing: 'grid' | 'ruled'
  /**
   * How the titles of a designed group read (AGL-4065): `sentence`, each set
   * in the theme's heading style for an item; or `caps`, each set as the
   * theme's label (its overline: spaced capitals where the site's eyebrows
   * are capitals) over its words, as a designer's ruled columns and icon
   * rows title their items. Only a variant the theme defines is chosen: the
   * case of a section's own heading is the look's font pairing, never the
   * compiler's.
   */
  headingCase: 'sentence' | 'caps'
  /**
   * How the plain and soft bands run down a page (AGL-4065): `alternate`, the
   * bands as the model wrote them except that two neighbors of one never
   * meet — the second takes the other — so sections read apart; or `plain`,
   * one ground for the whole page, every soft band drawn plain and the
   * sections set apart by their spacing. Brand and dark bands are the
   * model's either way.
   */
  bandRhythm: 'alternate' | 'plain'
}

type Family = 'gallery' | 'editorial' | 'hospitality' | 'calm' | 'retail' | 'standard'
type GroupStyle = AiLayoutDesignChoices['group']

const FAMILIES: Readonly<Record<string, Family>> = {
  portfolio: 'gallery',
  photography: 'gallery',
  studio: 'gallery',
  blog: 'editorial',
  restaurant: 'hospitality',
  events: 'hospitality',
  yoga: 'calm',
  wellness: 'calm',
  beauty: 'calm',
  store: 'retail',
}

/**
 * A kind's LAYOUT SIGNATURE (AGL-3985): the arrangements its pages are drawn
 * in, so a café, a law firm and a band never read as one page in three
 * colors. Before it, six kinds shared one list of heroes and every kind drew
 * its groups, its photo-led sections and its headings beside their items at
 * the same odds; the guided start's 21 style previews, which the real
 * compiler draws, read as one page — a header bar, a split or banded hero,
 * one section.
 *
 *  - `heroes`: the two first sections the kind opens with, each drawn at even
 *    odds (AGL-3899). The first is the one its style card shows. No two kinds
 *    share the same two.
 *  - `groups`: the group styles a section of items takes where its subject
 *    picks none.
 *  - `steps`: how its numbered groups read.
 *  - `features`: the chance a section of words takes a photo beside it — a
 *    café's or a salon's pages are photo-led, a law firm's or a writer's let
 *    the type carry them.
 *  - `coverClose`: the chance a closing call to action is drawn over a photo.
 *  - `splitHeads`: the chance a heading sits beside its items: an
 *    editorial, considered page.
 *  - `pictures`: how its work is laid out where it shows it as pictures.
 */
export interface AiLayoutKindSignature {
  heroes: readonly [AiLayoutHeroVariant, AiLayoutHeroVariant]
  groups: readonly GroupStyle[]
  steps: readonly AiLayoutStepsVariant[]
  features: number
  coverClose: number
  splitHeads: number
  pictures: readonly AiLayoutDesignChoices['pictures'][]
}

const BOTH_STEPS: readonly AiLayoutStepsVariant[] = ['timeline', 'numbers']
const MOSTLY_MOSAIC: readonly AiLayoutDesignChoices['pictures'][] = ['mosaic', 'mosaic', 'even']

/** Each kind's signature, by its `AI_SITE_KINDS` id. */
export const AI_LAYOUT_KIND_SIGNATURES: Readonly<Record<string, AiLayoutKindSignature>> = {
  // Clear and confident: a contained split, or the words on a card over the place.
  business: { heroes: ['split', 'panel'], groups: ['cards', 'icons'], steps: BOTH_STEPS, features: 0.6, coverClose: 0.3, splitHeads: 0.5, pictures: MOSTLY_MOSAIC },
  // Direct: a full-bleed job photo with the promise at the start, services as
  // tight cards, ruled columns or icon rows, and a job's steps numbered or
  // ruled (AGL-4065: two trades sites of 2026-10-25 shared one layout).
  trades: { heroes: ['cover', 'split'], groups: ['cards', 'ruled', 'icons'], steps: BOTH_STEPS, features: 0.5, coverClose: 0.7, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
  // Measured: the words on a card over the office, practice areas ruled, headings beside them.
  professional: { heroes: ['panel', 'editorial'], groups: ['ruled'], steps: ['timeline'], features: 0.5, coverClose: 0.2, splitHeads: 0.8, pictures: MOSTLY_MOSAIC },
  // Reassuring: half the band a calm room, or a quiet centered masthead.
  wellness: { heroes: ['bleed', 'column'], groups: ['icons', 'cards'], steps: BOTH_STEPS, features: 0.7, coverClose: 0.2, splitHeads: 0.3, pictures: MOSTLY_MOSAIC },
  // Photo-led: the room full-bleed with the name centered over it, the menu as lines.
  restaurant: { heroes: ['poster', 'bleed'], groups: ['ruled', 'cards'], steps: BOTH_STEPS, features: 0.8, coverClose: 0.7, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
  // A storefront: the products themselves, two of them, beside the words.
  store: { heroes: ['collage', 'split'], groups: ['icons'], steps: BOTH_STEPS, features: 1, coverClose: 0.2, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // The work first: display type then a wide picture, or the words beside two pieces.
  portfolio: { heroes: ['editorial', 'collage'], groups: ['ruled'], steps: ['timeline'], features: 0.5, coverClose: 0.2, splitHeads: 0.5, pictures: ['mosaic'] },
  // Oversized statements over a wide picture, or full-bleed and dark.
  studio: { heroes: ['editorial', 'cover'], groups: ['ruled', 'cards'], steps: ['timeline'], features: 0.4, coverClose: 0.5, splitHeads: 0.6, pictures: ['mosaic', 'even'] },
  // Pictures first, few words.
  photography: { heroes: ['editorial', 'poster'], groups: ['ruled'], steps: ['timeline'], features: 0.6, coverClose: 0.6, splitHeads: 0.35, pictures: ['even', 'mosaic'] },
  // Reading-first: a centered masthead over the lead picture.
  blog: { heroes: ['column', 'editorial'], groups: ['ruled'], steps: ['timeline'], features: 0.4, coverClose: 0.1, splitHeads: 0.7, pictures: MOSTLY_MOSAIC },
  // Celebratory: two pictures of the day beside its name, or the name over one.
  events: { heroes: ['collage', 'poster'], groups: ['cards', 'icons'], steps: ['timeline'], features: 0.7, coverClose: 0.6, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // High energy: half the band a photo, half a loud headline; or full-bleed.
  // Its groups as cards or ruled columns, its steps numbered or ruled (AGL-4065).
  fitness: { heroes: ['bleed', 'cover'], groups: ['cards', 'ruled'], steps: BOTH_STEPS, features: 0.5, coverClose: 0.7, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
  // Calm and spacious: a centered masthead, or a soft split.
  yoga: { heroes: ['column', 'split'], groups: ['icons', 'cards'], steps: BOTH_STEPS, features: 0.6, coverClose: 0.2, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
  // Image-led: two pictures of the work and the place, or half the band one.
  beauty: { heroes: ['collage', 'bleed'], groups: ['ruled', 'cards'], steps: BOTH_STEPS, features: 0.8, coverClose: 0.3, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // Polished: the home full-bleed with the words on a card, or under a scrim.
  realestate: { heroes: ['panel', 'cover'], groups: ['cards', 'ruled'], steps: BOTH_STEPS, features: 0.8, coverClose: 0.5, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // Encouraging: a contained split, or the teacher's portrait over the words.
  education: { heroes: ['split', 'portrait'], groups: ['icons', 'cards'], steps: ['numbers'], features: 0.6, coverClose: 0.2, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // Mission-led: the people full-bleed with the cause over them, or two pictures beside it.
  nonprofit: { heroes: ['cover', 'collage'], groups: ['icons', 'cards'], steps: ['numbers'], features: 0.6, coverClose: 0.7, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // Loud: the name huge over a full-bleed photo, at the start or centered.
  music: { heroes: ['cover', 'poster'], groups: ['ruled'], steps: ['timeline'], features: 0.5, coverClose: 0.8, splitHeads: 0.35, pictures: MOSTLY_MOSAIC },
  // A person: their portrait over who they are, or a quiet masthead.
  personal: { heroes: ['portrait', 'column'], groups: ['ruled'], steps: ['timeline'], features: 0.4, coverClose: 0.1, splitHeads: 0.6, pictures: MOSTLY_MOSAIC },
  // One action: the promise centered over the picture of the thing, or over a photo.
  landing: { heroes: ['column', 'poster'], groups: ['icons', 'cards'], steps: ['numbers'], features: 0.5, coverClose: 0.3, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
  // Short and striking: one big line over a photo, or on a card over it.
  'coming-soon': { heroes: ['poster', 'panel'], groups: ['icons', 'ruled'], steps: BOTH_STEPS, features: 0.3, coverClose: 0.2, splitHeads: 0.2, pictures: MOSTLY_MOSAIC },
}

/** The signature of a kind; an unknown kind draws as a business site. */
export function aiLayoutKindSignature(kind: string): AiLayoutKindSignature {
  return AI_LAYOUT_KIND_SIGNATURES[kind] ?? (AI_LAYOUT_KIND_SIGNATURES['business'] as AiLayoutKindSignature)
}

/** A small deterministic generator over a seed (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length) % list.length] as T

/** The family a kind's pages are drawn in. */
export function aiLayoutFamily(kind: string): Family {
  return FAMILIES[kind] ?? 'standard'
}

/** The kinds whose item titles are set as labels three sites in ten (AGL-4065); every other kind's one in ten. */
const LABEL_TITLE_KINDS: ReadonlySet<string> = new Set(['trades', 'fitness'])

/** The families whose pages keep one ground as often as they alternate: a gallery's, a publication's (AGL-4065). */
const ONE_GROUND_FAMILIES: ReadonlySet<Family> = new Set(['gallery', 'editorial'])

/**
 * A site's choices, the same for every page of it, each drawn at even odds
 * among the options its kind's signature lists (AGL-3899, AGL-3985), so two
 * sites of one kind are drawn apart and two kinds never read as one page.
 * Favoring each list's first option made the newest production sites one
 * design: the kind's first hero won 55% before the pick, a business site
 * opened split, groups were ruled two times in three and every text section
 * took a photo.
 */
export function aiLayoutDesignChoices(design: AiLayoutDesign): AiLayoutDesignChoices {
  const next = random(design.seed ^ 0x2f6b9d1)
  const family = aiLayoutFamily(design.kind)
  const signature = aiLayoutKindSignature(design.kind)
  const hero = pick(next, signature.heroes)
  const group = pick(next, signature.groups)
  return {
    hero,
    // A store's reasons to buy — the making, the shipping, the care — read
    // as open columns each led by an icon, the way a storefront theme draws
    // them: never a SaaS page's feature cards, and never the plain columns
    // of a title and a sentence the beta.237 Willow Wick home showed four
    // bands of (AGL-3676).
    group: family === 'retail' ? 'icons' : group,
    steps: pick(next, signature.steps),
    // Whether a section of words takes a photo beside it: some sites are
    // photo-led, some let their type carry the page. A storefront never
    // shows a band of text alone (AGL-3676), so its story always takes one.
    features: next() < signature.features || family === 'retail',
    featureLeft: next() < 0.5,
    coverClose: next() < signature.coverClose,
    splitHeads: next() < signature.splitHeads,
    pictures: pick(next, signature.pictures),
    // Drawn last, so every choice above stays what it was for a seed.
    writing: pick(next, ['grid', 'ruled'] as const),
    // Drawn after it (AGL-4065), so a seed's earlier choices stay too.
    headingCase: next() < (LABEL_TITLE_KINDS.has(design.kind) ? 0.3 : 0.1) ? 'caps' : 'sentence',
    bandRhythm: next() < (ONE_GROUND_FAMILIES.has(family) ? 0.5 : 0.35) ? 'plain' : 'alternate',
  }
}


const WORK = /\b(work|works|project|projects|portfolio|gallery|galleries|case|cases|studies|selected|commission|commissions|illustration|illustrations|photo|photos|series|book|books|editorial|brand|collection|collections|wedding|weddings|portrait|portraits|session|sessions|shoot|shoots)\b/i
const WRITING = /\b(article|articles|post|posts|writing|writings|latest|featured|journey|journeys|recipe|recipes|story|stories|essay|essays|guide|guides|issue|issues|episode|episodes)\b/i
const DISHES = /\b(menu|menus|dish|dishes|breakfast|brunch|lunch|dinner|pastry|pastries|coffee|drink|drinks|cocktail|cocktails|wine|wines|highlight|highlights|favorite|favorites|favourites|special|specials|plate|plates|bake|bakes|bread|cake|cakes)\b/i
// A store's own products are listed by its Product grid (AGL-3676), never drawn
// from words: what a store shows as pictures is how its range is grouped — its
// collections, gift sets, occasions and scents. "Candle care and burn notes" is no band of pictures.
/** Words a section uses for itself when it is a showing of pictures, on any kind of site (AGL-3923). */
const GALLERY = /\b(gallery|galleries|portfolio|portfolios|lookbook|lookbooks)\b/i
const CATEGORIES = /\b(collection|collections|range|ranges|categor(?:y|ies)|gift|gifts|gift sets?|sets|occasion|occasions|scent|scents|edit|edits)\b/i

/**
 * How a section's group of cards is drawn, from what the section is about:
 * work in a gallery kind and products in a store are pictures, writing in a
 * blog is articles, dishes in a restaurant a menu; anything else takes the
 * site's own group style.
 */
export function aiLayoutGroupVariant(
  design: AiLayoutDesign,
  choices: AiLayoutDesignChoices,
  words: string,
): AiLayoutGroupVariant {
  const family = aiLayoutFamily(design.kind)
  if (family === 'gallery' && (WORK.test(words) || design.kind === 'photography')) return 'pictures'
  if (family === 'editorial' && WRITING.test(words)) return 'articles'
  if (family === 'hospitality' && DISHES.test(words)) return 'menu'
  if (family === 'retail' && CATEGORIES.test(words)) return 'pictures'
  // A section that calls itself a gallery or a portfolio shows pictures on any
  // kind of site (AGL-3923): the beta.265 Kasvora Marketing Solutions home drew
  // its "Selected work gallery" as four cards of icons.
  if (GALLERY.test(words)) return 'pictures'
  return choices.group
}
