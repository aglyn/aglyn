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
 *  - `cover`: a full-bleed photo with the words over it on a scrim;
 *  - `split`: the words beside a tall photo, inside the page's measure;
 *  - `editorial`: display type across the page, the lede and the buttons in
 *    a row under it, and a wide photo below.
 */
export type AiLayoutHeroVariant = 'cover' | 'split' | 'editorial'

/**
 * How a group of cards is drawn where no component draws it:
 *  - `cards`: the theme's cards (the compiler's first design);
 *  - `ruled`: open columns, each under a thin rule, no card around it;
 *  - `pictures`: a picture over each item's title and caption, in an uneven
 *    grid (work, products);
 *  - `articles`: a picture over each title and summary, in even columns (writing);
 *  - `menu`: two columns of lines under rules (dishes, prices left out).
 */
export type AiLayoutGroupVariant = 'cards' | 'ruled' | 'pictures' | 'articles' | 'menu'

/** How a numbered group is drawn: a row of numbers, or a ruled list beside its heading. */
export type AiLayoutStepsVariant = 'numbers' | 'timeline'

/** The site-level choices a page is drawn with. */
export interface AiLayoutDesignChoices {
  hero: AiLayoutHeroVariant
  /** The group style of a section that names no subject the kind draws its own way. */
  group: 'cards' | 'ruled'
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
}

type Family = 'gallery' | 'editorial' | 'hospitality' | 'calm' | 'retail' | 'standard'

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

/** The heroes each kind opens with, best suited first. */
const HEROES: Readonly<Record<string, readonly AiLayoutHeroVariant[]>> = {
  photography: ['cover', 'editorial'],
  portfolio: ['editorial', 'split'],
  studio: ['editorial', 'cover'],
  blog: ['editorial', 'cover', 'split'],
  restaurant: ['cover', 'split'],
  events: ['cover', 'split'],
  fitness: ['cover', 'split'],
  music: ['cover', 'editorial'],
  nonprofit: ['cover', 'split'],
  realestate: ['cover', 'split'],
  trades: ['cover', 'split'],
  yoga: ['split', 'cover'],
  wellness: ['split', 'cover'],
  beauty: ['split', 'cover', 'editorial'],
  store: ['split', 'editorial'],
}
const DEFAULT_HEROES: readonly AiLayoutHeroVariant[] = ['split', 'cover', 'editorial']

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

/**
 * A site's choices, the same for every page of it. The first option of each
 * list is the kind's best, so it is favored; the seed still turns it, so two
 * sites of one kind are drawn apart.
 */
export function aiLayoutDesignChoices(design: AiLayoutDesign): AiLayoutDesignChoices {
  const next = random(design.seed ^ 0x2f6b9d1)
  const family = aiLayoutFamily(design.kind)
  const heroes = HEROES[design.kind] ?? DEFAULT_HEROES
  const hero = next() < 0.55 ? (heroes[0] as AiLayoutHeroVariant) : pick(next, heroes)
  const group = family === 'calm' ? pick(next, ['cards', 'cards', 'ruled'] as const) : pick(next, ['ruled', 'cards', 'ruled'] as const)
  return {
    hero,
    // A store's reasons to buy — the making, the shipping, the care — read
    // as open ruled columns beside its product photos, never as a SaaS
    // page's feature cards (AGL-3676).
    group: family === 'retail' ? 'ruled' : group,
    steps: pick(next, ['timeline', 'numbers', 'timeline'] as const),
    features: true,
    featureLeft: next() < 0.5,
    coverClose: heroes.includes('cover') && next() < 0.7,
    splitHeads: family === 'editorial' || family === 'standard' ? next() < 0.6 : next() < 0.35,
    pictures: design.kind === 'photography' ? pick(next, ['even', 'mosaic'] as const) : pick(next, ['mosaic', 'mosaic', 'even'] as const),
    // Drawn last, so every choice above stays what it was for a seed.
    writing: pick(next, ['grid', 'ruled'] as const),
  }
}

const WORK = /\b(work|works|project|projects|portfolio|gallery|galleries|case|cases|studies|selected|commission|commissions|illustration|illustrations|photo|photos|series|book|books|editorial|brand|collection|collections|wedding|weddings|portrait|portraits|session|sessions|shoot|shoots)\b/i
const WRITING = /\b(article|articles|post|posts|writing|writings|latest|featured|journey|journeys|recipe|recipes|story|stories|essay|essays|guide|guides|issue|issues|episode|episodes)\b/i
const DISHES = /\b(menu|menus|dish|dishes|breakfast|brunch|lunch|dinner|pastry|pastries|coffee|drink|drinks|cocktail|cocktails|wine|wines|highlight|highlights|favorite|favorites|favourites|special|specials|plate|plates|bake|bakes|bread|cake|cakes)\b/i
const PRODUCTS = /\b(bestseller|bestsellers|best sellers|collection|collections|product|products|shop|range|candle|candles|gift|gifts|set|sets|new arrivals|arrivals)\b/i

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
  if (family === 'retail' && PRODUCTS.test(words)) return 'pictures'
  return choices.group
}
