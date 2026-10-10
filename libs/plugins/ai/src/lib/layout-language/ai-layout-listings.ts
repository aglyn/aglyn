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

import { aiStorefrontSays } from './ai-layout-storefront'

/**
 * A SITE'S OWN RECORDS, PLACED BY THE PLATFORM (AGL-3676).
 *
 * A guided start writes a store's first products and a blog's first posts,
 * then built the pages around them in the layout language — and the pages
 * showed neither. "Featured candles" and "The candle range" on the live
 * Ember & Wick start (2026-10-08) were cards the model wrote, a name and a
 * line each: no photo, no price, no link, nothing a shopper could open; the
 * Clay Notes blog's "Featured writing" was three cards that linked to no
 * post. The real records were on the site, one click away from nowhere.
 *
 * A LISTING is one kind of record a site keeps — its catalog, its blog —
 * placed by code in the sections whose plan says they show it, through the
 * element the plugin that keeps the records renders them with, bound to the
 * records themselves rather than to words about them. It is the form binding
 * one step on (a section whose plan `uses` a form places that form by its
 * id, whatever the answer remembered): the model writes the section's
 * heading and words, the platform places the records.
 *
 *  - `products` — the commerce plugin's Product grid (`product-grid`), over
 *    the site's whole active catalog: a photo, the name, the price (or
 *    "Price coming soon" where the owner cleared it), each card linking its
 *    product's page.
 *  - `posts` — the content plugin's Collection Entries (`collectionEntries`)
 *    over the blog's collection, its card a cover, the date and byline, the
 *    title and the excerpt, linking each post.
 *  - `tracks` — the music plugin's Music player (`musicPlayer`, AGL-3716) on a
 *    music site, placed EMPTY: its "add your tracks" state, for the owner to
 *    fill from their own media library. No job ever sources a recording, so
 *    a tracks listing has no records and the player no source.
 *  - `reviews` — a selling store's own customer reviews, through the commerce
 *    plugin's Product reviews in its store-wide scope (`product-reviews`,
 *    AGL-3676): approved reviews across the catalog with their star ratings.
 *    A store that opens has none, and the element then shows nothing at all
 *    on the published page, so no review is ever written for a shopper who
 *    did not leave one (the FTC's fake-review rule; rule 14's "never invent
 *    a customer").
 *  - `signup` — a selling store's newsletter sign-up, through the commerce
 *    plugin's Newsletter signup (`newsletter-signup`, AGL-3676): a consented
 *    email field into the store's contacts, where a section says newsletter.
 *  - `records` — one of the site's datasets (AGL-3616): a menu, a team, its
 *    services, built by the site start and kept by the data plugin. Drawn as
 *    a Box that repeats over the dataset (`repeatDataset`, the platform's own
 *    repeat), its card binding the record's fields as `{{item.<field>}}`, in
 *    the sections whose plan names the dataset in its `uses`. A site may list
 *    several, one listing a dataset.
 *
 * The elements are named by their persisted ids, as the form binding names
 * `form`: a plugin never imports another's internals, and
 * `ai-layout-listings.spec.ts` holds the ids and props named here to the
 * source of the plugins that declare them.
 *
 * Model only: shapes and the inputs reader; the compiler draws them.
 */

export type AiLayoutListingKind = 'products' | 'posts' | 'tracks' | 'reviews' | 'signup' | 'records'

/** How a section shows a listing: a few of its records on a page about something else, or all of them on its own page. */
export type AiLayoutListingRole = 'featured' | 'index'

/** One section of one page that places a listing. */
export interface AiLayoutListingPlacement {
  /** The page, by its plan id. */
  screenId: string
  /** The section, by plan index. */
  section: number
  role: AiLayoutListingRole
}

/** One field of a dataset a `records` listing shows, as its card binds it. */
export interface AiLayoutListingField {
  /** The field's id, which `{{item.<id>}}` reads. */
  id: string
  name: string
  /** The data plugin's stored type: `text`, `float`, `int32`, `bool`, `sorted`. */
  type: string
}

/** A kind of record the site keeps, and where its pages place it. */
export interface AiLayoutListing {
  /** `listing:products`, `listing:posts`: what a section's placement names. */
  id: string
  kind: AiLayoutListingKind
  /** What a visitor would call the whole list: "the shop", "the blog". */
  name: string
  /** The records it shows today, by name, so a page's words can name them. */
  records: string[]
  /** Where the whole list lives, as a path on the site: the blog's `/blog`. */
  href?: string
  /** The content collection a posts listing repeats, by its slug. */
  collectionSlug?: string
  /** The dataset a records listing repeats over, by id (AGL-3616). */
  datasetId?: string
  /** The dataset's fields, in its order, which the card binds. */
  fields?: AiLayoutListingField[]
  /**
   * Where a visitor goes from a store with nothing listed yet (AGL-3676): the
   * site's contact page, by its path. The empty state names it as its one
   * action, so a shop that opens empty still answers a visitor.
   */
  emptyAction?: { label: string; href: string }
  /**
   * `false` for a store that lists its catalog but cannot sell yet (its first
   * products were skipped or failed, AGL-3676): the header carries no cart.
   */
  cart?: boolean
  placements: AiLayoutListingPlacement[]
}

/** The unit input a site's listings travel in, to its layout and its pages. */
export const AI_LAYOUT_LISTINGS_INPUT = 'siteListings'

/** The id a listing of a kind is placed by; a records listing is one dataset's. */
export function aiLayoutListingId(kind: AiLayoutListingKind, datasetId?: string): string {
  return kind === 'records' && datasetId ? `listing:records:${datasetId}` : `listing:${kind}`
}

/** The persisted element a listing is drawn with, by kind (held to its plugin's source by a spec). */
export const AI_LAYOUT_LISTING_ELEMENTS: Readonly<Record<AiLayoutListingKind, string>> = {
  products: 'product-grid',
  posts: 'collectionEntries',
  tracks: 'musicPlayer',
  reviews: 'product-reviews',
  signup: 'newsletter-signup',
  // The platform's own Box, repeating its card over the dataset.
  records: 'muiBox',
}

/** The header's cart button: the commerce plugin's Cart in its `button` variant. */
export const AI_LAYOUT_CART_ELEMENT = 'cart'

/** The most records a featured band shows; a page of its own shows them all. */
export const AI_LAYOUT_FEATURED_RECORDS = { products: 4, posts: 3, tracks: 0, reviews: 3, signup: 0, records: 3 } as const

const PLACEMENT_ROLES: readonly AiLayoutListingRole[] = ['featured', 'index']
const KINDS: readonly AiLayoutListingKind[] = ['products', 'posts', 'tracks', 'reviews', 'signup', 'records']

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** What a visitor calls each kind's whole list, where a unit's input names none. */
const LISTING_NAMES: Readonly<Record<AiLayoutListingKind, string>> = {
  products: 'the shop',
  posts: 'the blog',
  tracks: 'the music',
  reviews: 'the store',
  signup: 'the newsletter',
  records: 'the list',
}

/** A path on the site, as a listing's links are kept. */
const SITE_PATH = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/

/** A dataset id and a field id, as the data plugin mints them. */
const DATASET_ID = /^[A-Za-z0-9_-]{1,128}$/
const FIELD_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** A records listing's fields as its input carries them; nothing that does not read is kept. */
function listingFieldsOf(raw: unknown): AiLayoutListingField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((value) => {
      const field = (value ?? {}) as Record<string, unknown>
      const id = text(field['id'])
      return FIELD_ID.test(id) ? [{ id, name: text(field['name']).slice(0, 60) || id, type: text(field['type']) || 'text' }] : []
    })
    .slice(0, 16)
}

/** A site's listings as its unit inputs carry them; nothing that does not read is kept. */
export function aiLayoutListingsOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiLayoutListing[] {
  const raw = inputs?.[AI_LAYOUT_LISTINGS_INPUT]
  if (!Array.isArray(raw)) return []
  const listings: AiLayoutListing[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const kind = record['kind'] as AiLayoutListingKind
    // A records listing is one dataset's (AGL-3616): a site may list several.
    const datasetId = kind === 'records' ? text(record['datasetId']) : ''
    const fields = kind === 'records' ? listingFieldsOf(record['fields']) : []
    // Its fields may be left for the page to read off the site's inventory.
    if (kind === 'records' && !DATASET_ID.test(datasetId)) continue
    if (
      !KINDS.includes(kind) ||
      listings.some((listing) => listing.kind === kind && (kind !== 'records' || listing.datasetId === datasetId))
    ) {
      continue
    }
    const href = text(record['href'])
    const action = (record['emptyAction'] ?? {}) as Record<string, unknown>
    const actionLabel = text(action['label']).slice(0, 40)
    const actionHref = text(action['href'])
    const collectionSlug = text(record['collectionSlug'])
    // A posts listing with no collection to repeat shows nothing.
    if (kind === 'posts' && !/^[a-z0-9-]{1,100}$/.test(collectionSlug)) continue
    const placements = (Array.isArray(record['placements']) ? record['placements'] : []).flatMap((value) => {
      const placement = (value ?? {}) as Record<string, unknown>
      const screenId = text(placement['screenId'])
      const section = placement['section']
      const role = placement['role'] as AiLayoutListingRole
      return screenId && typeof section === 'number' && Number.isInteger(section) && section >= 0 && PLACEMENT_ROLES.includes(role)
        ? [{ screenId, section, role }]
        : []
    })
    listings.push({
      id: aiLayoutListingId(kind, datasetId),
      kind,
      name: text(record['name']) || LISTING_NAMES[kind],
      // A tracks listing names no records: no job sources a recording (AGL-3716);
      // nor do a store's reviews and its sign-up, which shoppers fill (AGL-3676).
      records:
        kind !== 'products' && kind !== 'posts' && kind !== 'records'
          ? []
          : (Array.isArray(record['records']) ? record['records'] : []).map(text).filter(Boolean).slice(0, 12),
      ...(SITE_PATH.test(href) ? { href } : {}),
      ...(kind === 'posts' ? { collectionSlug } : {}),
      ...(kind === 'records' ? { datasetId, fields } : {}),
      ...(kind === 'products' && record['cart'] === false ? { cart: false } : {}),
      ...(kind === 'products' && actionLabel && SITE_PATH.test(actionHref) ? { emptyAction: { label: actionLabel, href: actionHref } } : {}),
      placements,
    })
  }
  return listings
}

/** The listing a section of a page places, and how; `null` for a section that places none. */
export function aiLayoutListingAt(
  listings: readonly AiLayoutListing[],
  screenId: string | null | undefined,
  section: number,
): { listing: AiLayoutListing; role: AiLayoutListingRole } | null {
  if (!screenId) return null
  for (const listing of listings) {
    const placement = listing.placements.find((entry) => entry.screenId === screenId && entry.section === section)
    if (placement) return { listing, role: placement.role }
  }
  return null
}

// ── Where a site's pages place them ────────────────────────────────────

/** The plan of a page, as a placement is chosen from it. */
export interface AiLayoutListingScreen {
  id?: string | null
  title: string
  slug: string
  sections: ReadonlyArray<{ name: string; items: number; uses?: readonly string[] }>
}

const PRODUCT_PAGE = /\b(shop|store|products?|catalog(?:ue)?|collections?|range|browse)\b/i
const PRODUCT_SECTION =
  /\b(shop|store|products?|catalog(?:ue)?|collections?|range|bestsellers?|best[- ]sellers?|new arrivals|arrivals|featured|favou?rites|signature)\b/i
const POST_SECTION = /\b(blog|posts?|articles?|writing|journal|stories|essays?|latest|recent|news|featured)\b/i
/** A music site's page or section about its recordings (AGL-3716). */
const MUSIC_PAGE = /\b(music|listen|tracks?|songs?|releases?|discography|albums?|eps?|singles?|sounds?)\b/i

/**
 * The section of a shop's own page the whole catalog fills (AGL-3676): the
 * first after its opening whose name says products ("Product grid", "The
 * range"), else the section planned with the most items, else its second.
 * The live Hearth & Wick start (2026-10-09) planned "Product range image
 * cards" — six cards naming kinds of candle, with no product, price or cart.
 */
export function aiLayoutShopGridSection(sections: ReadonlyArray<{ name: string; items: number }>): number {
  const named = sections.findIndex((section, index) => index > 0 && PRODUCT_SECTION.test(section.name) && !SHOP_FRAMING.test(section.name))
  if (named !== -1) return named
  const most = Math.max(0, ...sections.map((section) => section.items))
  const byItems = most > 0 ? sections.findIndex((section) => section.items === most) : -1
  return byItems !== -1 ? byItems : sections.length > 1 ? 1 : 0
}

/**
 * The section of a store's home its bestsellers fill (AGL-3676): the first
 * after the hero whose name says them ("Bestsellers", "Featured candles", "New
 * arrivals"), never one about the store's collections, its reviews or its
 * sign-up; else the first after the hero naming products at all; else the
 * first after the hero planned with items that is none of those. The
 * beta.237 Willow Wick home would otherwise have listed products in its
 * "Shop by collection" tiles.
 */
function aiLayoutFeaturedSection(screen: AiLayoutListingScreen): number {
  // A section about the collections that does not also name the bestsellers.
  const other = (name: string) =>
    (aiStorefrontSays('collections', name) && !aiStorefrontSays('featured', name)) ||
    aiStorefrontSays('reviews', name) ||
    aiStorefrontSays('signup', name)
  const first = (test: (name: string, items: number) => boolean) =>
    screen.sections.findIndex((section, index) => index > 0 && test(section.name, section.items))
  for (const test of [
    (name: string) => aiStorefrontSays('featured', name) && !other(name),
    (name: string) => PRODUCT_SECTION.test(name) && !other(name),
    (name: string, items: number) => items > 0 && !other(name),
    (name: string) => PRODUCT_SECTION.test(name),
  ]) {
    const found = first(test)
    if (found !== -1) return found
  }
  return -1
}

/** A section of a shop page that only opens or closes it: "Shop intro heading", "Gift help call to action". */
const SHOP_FRAMING = /\b(hero|intro(?:duction)?|heading|banner|cta|call to action|contact)\b/i

/** Whether a planned page is the store's own Shop page: its address or its name says it sells. */
export function aiLayoutIsShopPage(screen: { slug: string; title: string }): boolean {
  return !isHome(screen.slug) && PRODUCT_PAGE.test(`${firstSegment(screen.slug)} ${screen.title}`)
}

const firstSegment = (slug: string) => slug.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()
const isHome = (slug: string) => firstSegment(slug) === ''

/**
 * The sections of a site's pages that show a listing, chosen by code from the
 * plan (AGL-3676), never asked of the model:
 *
 *  - PRODUCTS. The shop's own page — the page whose address or name says it
 *    sells (`/shop`, "Shop", "Products") — shows the whole catalog in the
 *    section the plan gave the most items, else its second; and the home
 *    page features a few in its first section after the hero whose name
 *    says products ("Featured candles", "Bestsellers"), else in the first
 *    section after the hero planned with items.
 *  - POSTS. The home features the latest in its first section of items after
 *    the hero whose name says writing ("Featured writing", "Latest posts"),
 *    else its first section of items after the hero; and any other page
 *    whose name says it is about the writing does the same. The blog's own
 *    index is the platform's.
 *
 * A section placed once is placed for one listing.
 */
export function aiLayoutListingPlacements(
  kind: AiLayoutListingKind,
  screens: readonly AiLayoutListingScreen[],
): AiLayoutListingPlacement[] {
  const placements: AiLayoutListingPlacement[] = []
  const place = (screen: AiLayoutListingScreen, section: number, role: AiLayoutListingRole) => {
    if (typeof screen.id === 'string' && screen.id && section >= 0) placements.push({ screenId: screen.id, section, role })
  }
  const afterHero = (screen: AiLayoutListingScreen, test: (name: string, items: number) => boolean) =>
    screen.sections.findIndex((section, index) => index > 0 && test(section.name, section.items))
  if (kind === 'tracks') {
    // A music site's player (AGL-3716): on its Music page, in the section that
    // says it is about the recordings, else the one after the opening; on the
    // home, only in a section named for them. A site with neither gets it on
    // its home, after the opening.
    for (const screen of screens) {
      if (isHome(screen.slug)) {
        place(screen, afterHero(screen, (name) => MUSIC_PAGE.test(name)), 'featured')
        continue
      }
      if (!MUSIC_PAGE.test(`${firstSegment(screen.slug)} ${screen.title}`)) continue
      const named = afterHero(screen, (name) => MUSIC_PAGE.test(name))
      place(screen, named !== -1 ? named : screen.sections.length > 1 ? 1 : 0, 'index')
    }
    if (!placements.length) {
      const home = screens.find((screen) => isHome(screen.slug))
      if (home) place(home, home.sections.length > 1 ? 1 : 0, 'featured')
    }
    return placements
  }
  if (kind === 'reviews' || kind === 'signup') {
    // A store's own reviews, on its home, in the section named for them; its
    // newsletter sign-up in any page's section named for it that places no
    // form of the plan's (AGL-3676). Neither is ever a page's opening.
    for (const screen of screens) {
      if (kind === 'reviews' && !isHome(screen.slug)) continue
      place(
        screen,
        afterHero(
          screen,
          (name) => aiStorefrontSays(kind, name),
        ),
        kind === 'reviews' ? 'featured' : 'index',
      )
    }
    return kind === 'signup'
      ? placements.filter((placement) => {
          const screen = screens.find((entry) => entry.id === placement.screenId)
          return !(screen?.sections[placement.section]?.uses ?? []).some((use) => /form/i.test(use))
        })
      : placements
  }
  if (kind === 'products') {
    for (const screen of screens) {
      if (isHome(screen.slug)) {
        place(screen, aiLayoutFeaturedSection(screen), 'featured')
        continue
      }
      if (!aiLayoutIsShopPage(screen)) continue
      place(screen, aiLayoutShopGridSection(screen.sections), 'index')
    }
    return placements
  }
  for (const screen of screens) {
    if (isHome(screen.slug)) {
      // On a blog's home the band that names the writing ("Featured posts
      // cards", "Featured journeys") lists it; failing one, the first band of
      // items after the hero. A live Clay Notes plan (2026-10-09) opened its
      // home with "What you will find" before "Featured posts cards".
      const named = afterHero(screen, (name, items) => items > 0 && POST_SECTION.test(name))
      place(screen, named !== -1 ? named : afterHero(screen, (_name, items) => items > 0), 'featured')
      continue
    }
    if (!POST_SECTION.test(screen.title)) continue
    place(screen, afterHero(screen, (name) => POST_SECTION.test(name)), 'featured')
  }
  return placements
}

/**
 * The sections that list one of the site's datasets (AGL-3616): every section
 * whose plan names it in its `uses` — `new:<its name>` as the plan wrote it,
 * or its id once built. The home page features a few of its records; any
 * other page lists them all. Chosen from the plan, never asked of the model.
 */
export function aiLayoutRecordsPlacements(
  dataset: { id: string; name: string },
  screens: readonly AiLayoutListingScreen[],
): AiLayoutListingPlacement[] {
  const named = `new:${dataset.name}`.trim().toLowerCase()
  const placements: AiLayoutListingPlacement[] = []
  for (const screen of screens) {
    if (typeof screen.id !== 'string' || !screen.id) continue
    screen.sections.forEach((section, index) => {
      const lists = (section.uses ?? []).some((ref) => ref === dataset.id || ref.trim().toLowerCase() === named)
      if (lists) placements.push({ screenId: screen.id as string, section: index, role: isHome(screen.slug) ? 'featured' : 'index' })
    })
  }
  return placements
}
