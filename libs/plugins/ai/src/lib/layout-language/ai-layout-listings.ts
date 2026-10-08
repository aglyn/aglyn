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
 *    "Price coming soon"), each card linking its product's page.
 *  - `posts` — the content plugin's Collection Entries (`collectionEntries`)
 *    over the blog's collection, its card a cover, the date and byline, the
 *    title and the excerpt, linking each post.
 *
 * The elements are named by their persisted ids, as the form binding names
 * `form`: a plugin never imports another's internals, and
 * `ai-layout-listings.spec.ts` holds the ids and props named here to the
 * source of the plugins that declare them.
 *
 * Model only: shapes and the inputs reader; the compiler draws them.
 */

export type AiLayoutListingKind = 'products' | 'posts'

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
  placements: AiLayoutListingPlacement[]
}

/** The unit input a site's listings travel in, to its layout and its pages. */
export const AI_LAYOUT_LISTINGS_INPUT = 'siteListings'

/** The id a listing of a kind is placed by. */
export function aiLayoutListingId(kind: AiLayoutListingKind): string {
  return `listing:${kind}`
}

/** The persisted element a listing is drawn with, by kind (held to its plugin's source by a spec). */
export const AI_LAYOUT_LISTING_ELEMENTS: Readonly<Record<AiLayoutListingKind, string>> = {
  products: 'product-grid',
  posts: 'collectionEntries',
}

/** The header's cart button: the commerce plugin's Cart in its `button` variant. */
export const AI_LAYOUT_CART_ELEMENT = 'cart'

/** The most records a featured band shows; a page of its own shows them all. */
export const AI_LAYOUT_FEATURED_RECORDS = { products: 4, posts: 3 } as const

const PLACEMENT_ROLES: readonly AiLayoutListingRole[] = ['featured', 'index']
const KINDS: readonly AiLayoutListingKind[] = ['products', 'posts']

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A site's listings as its unit inputs carry them; nothing that does not read is kept. */
export function aiLayoutListingsOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiLayoutListing[] {
  const raw = inputs?.[AI_LAYOUT_LISTINGS_INPUT]
  if (!Array.isArray(raw)) return []
  const listings: AiLayoutListing[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const kind = record['kind'] as AiLayoutListingKind
    if (!KINDS.includes(kind) || listings.some((listing) => listing.kind === kind)) continue
    const href = text(record['href'])
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
      id: aiLayoutListingId(kind),
      kind,
      name: text(record['name']) || (kind === 'products' ? 'the shop' : 'the blog'),
      records: (Array.isArray(record['records']) ? record['records'] : []).map(text).filter(Boolean).slice(0, 12),
      ...(/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(href) ? { href } : {}),
      ...(kind === 'posts' ? { collectionSlug } : {}),
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
  sections: ReadonlyArray<{ name: string; items: number }>
}

const PRODUCT_PAGE = /\b(shop|store|products?|catalog(?:ue)?|collections?|range|browse)\b/i
const PRODUCT_SECTION =
  /\b(shop|store|products?|catalog(?:ue)?|collections?|range|bestsellers?|best[- ]sellers?|new arrivals|arrivals|featured|favou?rites|signature)\b/i
const POST_SECTION = /\b(blog|posts?|articles?|writing|journal|stories|essays?|latest|recent|news)\b/i

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
 *  - POSTS. The home features the latest in its first section after the hero
 *    whose name says writing ("Featured writing", "Latest posts") or that is
 *    planned with items ("Featured journeys cards"); and any other page
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
  if (kind === 'products') {
    for (const screen of screens) {
      if (isHome(screen.slug)) {
        const named = afterHero(screen, (name) => PRODUCT_SECTION.test(name))
        place(screen, named !== -1 ? named : afterHero(screen, (_name, items) => items > 0), 'featured')
        continue
      }
      if (!PRODUCT_PAGE.test(`${firstSegment(screen.slug)} ${screen.title}`)) continue
      const most = Math.max(0, ...screen.sections.map((section) => section.items))
      const byItems = most > 0 ? screen.sections.findIndex((section) => section.items === most) : -1
      const index = byItems !== -1 ? byItems : screen.sections.length > 1 ? 1 : 0
      place(screen, index, 'index')
    }
    return placements
  }
  for (const screen of screens) {
    if (isHome(screen.slug)) {
      // On a blog's home the first band after the hero that names the
      // writing or shows items is its writing, whatever the plan named it
      // ("Featured journeys cards").
      place(screen, afterHero(screen, (name, items) => POST_SECTION.test(name) || items > 0), 'featured')
      continue
    }
    if (!POST_SECTION.test(screen.title)) continue
    place(screen, afterHero(screen, (name) => POST_SECTION.test(name)), 'featured')
  }
  return placements
}
