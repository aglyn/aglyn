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

import type { AglynNodeSchema, NodeId } from '../foundation'
import { resolveNamedTokens } from './resolve-named-tokens'

/**
 * Persisted component id of the "Collection entries" repeater block
 * (plugins-mui). Like `layoutSlot`, the id lives here so the tenant compose
 * pipeline can find the block without importing the component bundle.
 */
export const COLLECTION_ENTRIES_COMPONENT_ID = 'collectionEntries'

/** Persisted component id of the markdown "Entry body" block (plugins-mui). */
export const COLLECTION_ENTRY_BODY_COMPONENT_ID = 'collectionEntryBody'

/**
 * Persisted component id of the "Related posts" block (plugins-mui,
 * AGL-582). The compose pipeline stamps the related entries onto the node,
 * so the id lives here like the entries/body blocks.
 */
export const COLLECTION_RELATED_COMPONENT_ID = 'collectionRelated'

/** Persisted component id of the share-bar block (plugins-mui, AGL-582). */
export const COLLECTION_SHARE_COMPONENT_ID = 'collectionShare'

/** Persisted component id of the entry-meta block (plugins-mui, AGL-582). */
export const COLLECTION_ENTRY_META_COMPONENT_ID = 'collectionEntryMeta'

/**
 * Persisted component id of the "Category Pills" block (plugins-mui,
 * AGL-1321). Like the entries repeater, the id lives here so the tenant
 * compose pipeline can stamp the block's links without importing the bundle.
 */
export const COLLECTION_CATEGORIES_COMPONENT_ID = 'collectionCategories'

/**
 * Persisted component id of the standalone "Collection Search" block
 * (plugins-mui, AGL-1516).
 *
 * The Collection Entries block grew its own search box first, and it renders
 * INSIDE that block — first child of the block's own stack. Figma 494:1220
 * puts the field in the listing's toolbar row instead, beside the RSS button
 * with the category pills opposite it, and no amount of authoring can lift a
 * block's own child out of it. The pills cannot move the other way either:
 * every child of an entries block is cloned once per entry.
 *
 * So the field became a block an author can put where the frame draws it.
 * Suggestion-panel only, by construction rather than by omission — a
 * standalone box has no clones to hide, so `filter` is a thing it genuinely
 * cannot do, and the one behaviour it does have is the toolbar behaviour the
 * frame asks for.
 */
export const COLLECTION_SEARCH_COMPONENT_ID = 'collectionSearch'

/**
 * Reserved list sub-paths (AGL-620 `page`, AGL-1321 `category`). Both are
 * only reserved as the HEAD of a longer path, so an entry legitimately
 * slugged `page` or `category` keeps serving at `/{collection}/{entry}`.
 */
export const COLLECTION_PAGE_ROUTE_SEGMENT = 'page'
export const COLLECTION_CATEGORY_ROUTE_SEGMENT = 'category'

/** Namespaces cloned template ids per container/entry (cf. `rep__`). */
export const COLLECTION_ENTRIES_NODE_ID_PREFIX = 'centry__'

/** Hard bound on entries a single block renders, before `entriesLimit`. */
export const COLLECTION_ENTRIES_MAX = 100

/**
 * Hard bound on the entries one READ of a collection returns (AGL-1516) — the
 * `.limit()` the tenant's live-entries query carries.
 *
 * Named here, beside the render bound it has always silently matched, because
 * a search index has to know the difference. The render bound is a choice
 * about a block; this one is a choice about the DATA, and a set that reaches
 * it is a set nobody has seen all of. Two 100s that happened to agree meant
 * `entries.length === 100` could be read either as "this collection has 100
 * entries" or "this read stopped at 100", and the honest empty state turns on
 * exactly that distinction.
 */
export const COLLECTION_SOURCE_MAX = 100

/**
 * Whether a collection source is a COMPLETE read or a bounded one
 * (AGL-1516) — true when the read came back holding its own limit, which is
 * the only signal a limited query without a count leaves behind.
 *
 * Deliberately errs toward "bounded": a collection of exactly
 * {@link COLLECTION_SOURCE_MAX} entries answers true and gets described one
 * notch more cautiously than it needed. Overstating what a search covered is
 * the failure that renders as a confident "nothing matched".
 */
export function collectionSourceReachedBound(
  entries: readonly unknown[] | undefined,
): boolean {
  return (entries?.length ?? 0) >= COLLECTION_SOURCE_MAX
}

/**
 * Whether the read behind a collection source was a bounded one (AGL-1516),
 * asking the READER first and only then falling back to counting.
 *
 * The count is a proxy, and it under-reports in two ways that both landed
 * after `collectionSourceReachedBound` was written:
 *
 * 1. The query takes `status in ['published', 'scheduled']` and the loader
 *    then drops what is not live yet — a future `publishAt`, or since AGL-471
 *    a due schedule the plan does not carry. A read that came back holding
 *    its full 100 docs can therefore hand over 96 entries, and 96 does not
 *    look like a ceiling. A blog with a scheduling queue is exactly the site
 *    that hits this.
 * 2. A category route filters `entries` before compose ever sees them, so the
 *    "raw set" the entries block is careful to measure is already narrowed.
 *
 * Both make the flag read FALSE on a read that really did stop at its bound,
 * and false is the direction that produces the confident "nothing matched"
 * this signal exists to prevent. So `reachedBound` is threaded down from the
 * query that owns the fact, and the count survives only as the fallback for a
 * source that predates it — a payload cached before this shipped, or a caller
 * that assembles a source by hand.
 */
export function collectionSourceIsBounded(
  source: Pick<CollectionEntriesSource, 'entries' | 'reachedBound'> | undefined,
): boolean {
  if (source?.reachedBound) return true
  return collectionSourceReachedBound(source?.entries)
}

/** Default entries per page for a paginated collection list (AGL-620). */
export const COLLECTION_LIST_PAGE_SIZE = 10

/**
 * Total pages for `total` entries at `perPage` per page — at least 1 so an
 * empty collection still has a page 1 (AGL-620).
 */
export function collectionTotalPages(total: number, perPage: number): number {
  if (perPage <= 0) return 1
  return Math.max(1, Math.ceil(total / perPage))
}

/** Default/most related posts a Related posts block renders (AGL-582). */
export const COLLECTION_RELATED_DEFAULT_LIMIT = 3
export const COLLECTION_RELATED_MAX = 12

/** Most categories a collection's taxonomy holds (AGL-582). */
export const COLLECTION_CATEGORIES_MAX = 50

/**
 * One taxonomy category on a COLLECTION doc (AGL-582): `id` is the stable
 * slug-like key entries reference (`categoryId`), generated once from the
 * initial name and never changed; `name` is the display label and freely
 * renameable. Stored as an array to preserve author-defined ordering.
 */
export interface CollectionCategory {
  id: string
  name: string
}

/**
 * How many LIVE entries one content collection may hold (AGL-2266).
 *
 * `hosts/{hostId}/collections/{cid}/entries/{eid}` had a DEDICATED rules block
 * re-granting `create` to any editor, client-direct — deliberately, because the
 * name-based exclusions on the host catch-all must not reach entries — so it
 * was the one quota-governed shape under a host with no quota at all. A free
 * org could mint unbounded Firestore documents from the browser.
 *
 * This is a flat PLATFORM cap, not a plan dimension. AGL-1387 declined
 * `collectionsPerHost` and this does not re-open it: nothing here is priced,
 * no `OrgEntitlements` key is added, and every plan gets the same number. It is
 * the `WEBHOOK_MAX_PER_HOST` (AGL-1360) / `NON_PAGE_SCREEN_MAX_PER_HOST`
 * (AGL-1399) shape, which both issues invented for exactly this: uncapped
 * infrastructure behind a $0 subscription.
 *
 * ## Per COLLECTION, paired with {@link COLLECTIONS_MAX_PER_HOST}
 *
 * A per-HOST entry cap would need a count across every collection the host
 * holds, which is a collection-group read the entry documents carry no `hostId`
 * to scope. Per collection is one `count()` on the collection the create is
 * addressed to — the same read every other cap on `/api/hosts/resources`
 * already pays — and the host is bounded by the PRODUCT of the two numbers,
 * which is why the sibling cap had to land in the same change. One of the two
 * alone bounds nothing: unbounded collections each holding 10,000 entries is
 * the same unbounded store, spelled differently.
 *
 * ## Why 10,000
 *
 * A blog publishing daily reaches it after twenty-seven years; the largest
 * content collection in production holds double digits. The failure mode of a
 * flat cap set too low is blocking real authoring with an error the price list
 * cannot explain, so it is sized to the heaviest plausible library rather than
 * to today's data. It also bounds the cost of the console's own listing, which
 * reads entries with `limit(200)` and would otherwise page through a store with
 * no ceiling.
 */
export const ENTRIES_MAX_PER_COLLECTION = 10000

/**
 * How many LIVE content collections one host may hold (AGL-2266).
 *
 * The other half of the entry bound above, and the reason it means anything.
 * Collection creation was already server-owned — the rules deny client `create`
 * and `/api/hosts/collections` claims the slug transactionally (AGL-978) — so
 * the collection had a WRITER with authority and simply no number to enforce.
 *
 * Again a platform cap and not `collectionsPerHost`: AGL-1387 decided
 * collections are not a thing customers are charged for, and that decision is
 * untouched. 100 is far past any real site's taxonomy — production's busiest
 * host has a handful — and short enough that the entries ceiling above
 * multiplies out to a bounded store rather than an unbounded one.
 */
export const COLLECTIONS_MAX_PER_HOST = 100

/**
 * One published content-collection entry as the compose pipeline sees it
 * (AGL-551). Mirrors the tenant's `CollectionEntrySummary` without the
 * Firestore dependency so the expansion stays pure.
 */
export interface CollectionEntryRecord {
  $id?: string
  title?: string
  slug?: string
  excerpt?: string
  /**
   * Per-entry byline (AGL-686); falls back to the site as author.
   *
   * Since AGL-2486 this is either the legacy free-typed string or the NAME of
   * the author record `authorId` points at, denormalized by the tenant runtime
   * so the byline block, the `{{entry.author}}` token and the RSS feed all
   * keep reading one field.
   */
  authorName?: string
  /**
   * Reference into `hosts/{hostId}/authors` (AGL-2486) — the custom author
   * this entry publishes under. Absent on every entry written before it, and
   * on any entry whose editor chose a one-off byline instead of a record.
   */
  authorId?: string
  body?: string
  coverImage?: string
  /** Search-result title override (AGL-582); falls back to `title`. */
  seoTitle?: string
  /** Meta description override (AGL-582); falls back to `excerpt`. */
  seoDescription?: string
  /**
   * Stable reference into the collection's `categories` taxonomy
   * (AGL-582): the ID survives renames, so display names resolve at
   * render via {@link resolveEntryCategoryName}.
   */
  categoryId?: string
  /**
   * Legacy free-typed bucket (AGL-582), e.g. "Engineering". Still READ
   * as a fallback everywhere; the editor writes `categoryId` going
   * forward.
   */
  category?: string
  /** Free-form labels (AGL-582), e.g. ["nextjs", "seo"]. */
  tags?: string[]
  publishedAt?: { seconds: number } | null
}

/** A collection's published entries, keyed for expansion by its slug. */
export interface CollectionEntriesSource {
  slug: string
  entries: CollectionEntryRecord[]
  /** The collection's category taxonomy (AGL-582), for name resolution. */
  categories?: CollectionCategory[]
  /**
   * Whether the READ that produced `entries` came back holding its own
   * `.limit()` (AGL-1516) — a fact recorded where the query ran, because by
   * the time `entries` gets here it has been through a liveness filter and
   * possibly a route's category filter, and its length no longer answers the
   * question. See {@link collectionSourceIsBounded}.
   */
  reachedBound?: boolean
  /**
   * The page the ROUTE asked for (AGL-1321), set only for the collection the
   * URL resolved. Fills in a block that declares `perPage` but no `page` —
   * which is every block a designer can author, since design time cannot
   * know which page a visitor is on. A block that names its own `page` still
   * wins: that is a deliberately pinned window, not a paginated list.
   */
  page?: number
}

/**
 * Display name of an entry's category (AGL-582): the `categoryId` lookup
 * into the collection's taxonomy wins; the legacy free-typed
 * `entry.category` string is the fallback so existing data keeps
 * rendering. An ID referencing a deleted category resolves to nothing —
 * by design the entry simply shows no category.
 */
export function resolveEntryCategoryName(
  entry: Pick<CollectionEntryRecord, 'categoryId' | 'category'>,
  // `readonly` because this only reads (AGL-1321): the route helpers hold
  // the taxonomy as readonly and would otherwise have to copy it to ask.
  categories?: readonly CollectionCategory[],
): string | undefined {
  const categoryId = (entry.categoryId ?? '').trim()
  if (categoryId) {
    const match = (categories ?? []).find(
      (category) => category.id === categoryId,
    )
    if (match?.name) return match.name
  }
  const legacy = (entry.category ?? '').trim()
  return legacy || undefined
}

/* ── Published-date formats (AGL-1459) ──────────────────────────────────── */

/**
 * How an entry's published date reads (AGL-1459).
 *
 * Named shapes rather than a format string, for the same reason the styles
 * panel offers a unit picker rather than a CSS box: an editor choosing a
 * byline is not choosing a grammar, and a free-typed pattern is a field where
 * every typo renders as itself on a published page.
 */
export type CollectionEntryDateFormat =
  | 'default'
  | 'monthYear'
  | 'mediumDate'
  | 'longDate'
  | 'iso'

/**
 * "However the site already renders it" — a REAL value, never absence
 * (AGL-1459).
 *
 * `''` is the shape AGL-1451/AGL-1453 closed repo-wide: an emptied field
 * cannot survive a save, so an author who tried a format and wanted the
 * original back would have no option to pick. So the do-nothing choice is a
 * word, exactly like {@link COLLECTION_ALL_PILL_NONE}.
 */
export const COLLECTION_ENTRY_DATE_FORMAT_DEFAULT: CollectionEntryDateFormat =
  'default'

/**
 * The offered formats, with the labels an author reads (AGL-1459). Lives here
 * rather than in the block's schema so the list and the formatter cannot
 * drift into offering a shape nothing knows how to produce.
 *
 * Example dates in the labels are written the way the default runtime renders
 * them, which is what makes the choice legible without opening a preview.
 */
export const COLLECTION_ENTRY_DATE_FORMAT_OPTIONS: readonly {
  value: CollectionEntryDateFormat
  label: string
}[] = [
  { value: 'default', label: 'Site default — 8/9/2026' },
  { value: 'monthYear', label: 'Month and year — Aug 2026' },
  { value: 'mediumDate', label: 'Short date — Aug 9, 2026' },
  { value: 'longDate', label: 'Long date — August 9, 2026' },
  { value: 'iso', label: 'ISO — 2026-08-09' },
]

/** Any stored value read back as a format this module knows (AGL-1459). */
export function normalizeCollectionEntryDateFormat(
  value: unknown,
): CollectionEntryDateFormat {
  const wanted = String(value ?? '').trim()
  const match = COLLECTION_ENTRY_DATE_FORMAT_OPTIONS.find(
    (option) => option.value === wanted,
  )
  return match?.value ?? COLLECTION_ENTRY_DATE_FORMAT_DEFAULT
}

/**
 * One entry's published date, in the shape the author asked for (AGL-1459).
 *
 * **The formatting lives HERE, beside the timestamp, and deliberately not in
 * the block.** By the time a date reaches the component it is already a
 * formatted string, and re-parsing one is ambiguous by construction: the same
 * `8/9/2026` reads as 9 August under an `en-US` runtime and 8 September under
 * `en-GB`. A byline that silently moves an article by three weeks is far worse
 * than one that is the wrong shape.
 *
 * `default` returns exactly `toLocaleDateString()` — the string this function
 * replaced, character for character — because the block is live on published
 * entries and opening a dropdown must not restyle them.
 *
 * ## Why the runtime gets no say (AGL-1926)
 *
 * Every branch pins BOTH the locale and the time zone, and the answer is a
 * pure function of the timestamp. It used to pass `locale` straight through
 * (normally `undefined`) with no `timeZone` at all, so the output was a
 * function of the RUNTIME: `en-US` + UTC on a Vercel server, the visitor's
 * own locale and zone in their browser. That is fine while only the server
 * ever calls it — the string is stamped into node props at compose time and
 * both sides then agree on it — but it makes the function a hydration
 * mismatch waiting for its first client-side caller, and `catch-all-client`
 * was exactly that caller. A post published at 02:30 UTC is dated the 10th by
 * the server and the 9th by every visitor west of Greenwich; React reports
 * the difference as a text mismatch (the live React #418 on tenant-web,
 * AGL-1926) and then reconciles against a DOM it no longer describes, which
 * is where the `removeChild`/`insertBefore` pair comes from.
 *
 * The pinned values are the ones production already emits, so no published
 * page changes: Vercel runs UTC with an `en-US` ICU default, which is why
 * every entry date served from aglyn.com today reads `8/9/2026`. Pinning
 * makes that byte-for-byte guaranteed instead of a property of the host.
 *
 * `locale` still exists for a caller that must render in a different one; it
 * now defaults to the value the server was picking implicitly rather than to
 * "whatever this runtime happens to be".
 */
export const COLLECTION_ENTRY_DATE_LOCALE = 'en-US'

/**
 * The zone the calendar day is read in. Entry timestamps are absolute
 * instants; the day they are ATTRIBUTED to has to be one both sides agree on,
 * and UTC is the only zone a server and an unknown visitor share.
 */
export const COLLECTION_ENTRY_DATE_TIME_ZONE = 'UTC'

export function formatCollectionEntryDate(
  publishedAt: { seconds: number } | null | undefined,
  format?: CollectionEntryDateFormat,
  locale: string = COLLECTION_ENTRY_DATE_LOCALE,
): string {
  const seconds = publishedAt?.seconds
  if (!seconds) return ''
  const date = new Date(seconds * 1000)
  const timeZone = COLLECTION_ENTRY_DATE_TIME_ZONE
  switch (normalizeCollectionEntryDateFormat(format)) {
    case 'monthYear':
      return date.toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
        timeZone,
      })
    case 'mediumDate':
      return date.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone,
      })
    case 'longDate':
      return date.toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone,
      })
    case 'iso':
      // The calendar day in the pinned zone, not `toISOString()`'s slice by
      // luck and not the RUNTIME's local day: `getFullYear`/`getMonth`/
      // `getDate` read the host's zone, so this branch moved an entry by a
      // day depending on who rendered it. The UTC accessors are the same
      // reading the three `toLocaleDateString` branches above now take.
      return (
        `${date.getUTCFullYear()}-` +
        `${String(date.getUTCMonth() + 1).padStart(2, '0')}-` +
        `${String(date.getUTCDate()).padStart(2, '0')}`
      )
    default:
      return date.toLocaleDateString(locale, { timeZone })
  }
}

/**
 * The values an Entry Meta block shows, in the exact spellings the
 * `{{entry.date}}` / `{{entry.author}}` / `{{entry.category}}` /
 * `{{entry.tags}}` tokens produce (AGL-1385, author added AGL-1459).
 *
 * Extracted so the token map and {@link expandCollectionEntryMeta} cannot
 * drift: the same entry has to read the same way whether the author bound the
 * tokens by hand or let the server fill the block in.
 */
export function collectionEntryMetaValues(
  entry: CollectionEntryRecord,
  categories?: readonly CollectionCategory[],
  dateFormat?: CollectionEntryDateFormat,
): { date: string; author: string; category: string; tags: string } {
  return {
    date: formatCollectionEntryDate(entry.publishedAt, dateFormat),
    // The per-entry byline the editor already collects (AGL-686). It was
    // reachable in the entry's JSON-LD and nowhere on the page, which is what
    // made the frame's byline unauthorable (AGL-1459).
    author: (entry.authorName ?? '').trim(),
    // Entry model v2 (AGL-582): category resolves by stable ID against the
    // collection's taxonomy, falling back to the legacy free-typed string.
    category: resolveEntryCategoryName(entry, categories) ?? '',
    tags: (entry.tags ?? []).join(', '),
  }
}

/**
 * The `{{entry.*}}` token map for one entry (AGL-105/551): substituted
 * globally on entry-template screens and per-clone inside the Collection
 * entries block. `entry.url` resolves to the entry's auto-route so links
 * (`Read more`, titles) work without hardcoding the collection slug.
 */
export function collectionEntryTokens(
  entry: CollectionEntryRecord,
  collectionSlug: string,
  categories?: CollectionCategory[],
): Record<string, string> {
  const meta = collectionEntryMetaValues(entry, categories)
  return {
    'entry.title': entry.title ?? '',
    'entry.excerpt': entry.excerpt ?? '',
    'entry.body': entry.body ?? '',
    'entry.coverImage': entry.coverImage ?? '',
    'entry.slug': entry.slug ?? '',
    'entry.url': `/${collectionSlug}/${entry.slug ?? ''}`,
    'entry.date': meta.date,
    // The byline (AGL-1459). Bindable by hand for the same reason every other
    // field is: a template that wants it somewhere Entry Meta does not reach.
    'entry.author': meta.author,
    // Entry model v2 (AGL-582): taxonomy + SEO tokens. The SEO pair falls
    // back to title/excerpt so templates can bind them unconditionally.
    'entry.category': meta.category,
    'entry.tags': meta.tags,
    'entry.seoTitle': entry.seoTitle || entry.title || '',
    'entry.seoDescription': entry.seoDescription || entry.excerpt || '',
  }
}

/**
 * Category/tag membership check (AGL-582), shared by the Collection entries
 * filter props and the query-less list surfaces. Matching is trimmed and
 * case-insensitive — editors type these by hand. A category filter matches
 * either the entry's stable `categoryId` or its RESOLVED display name (id
 * lookup first, legacy string fallback), so filters written against either
 * spelling keep working across the taxonomy migration.
 */
export function entryMatchesFilter(
  entry: CollectionEntryRecord,
  filter: { category?: string; tag?: string },
  categories?: CollectionCategory[],
): boolean {
  const normalize = (value: string) => value.trim().toLowerCase()
  if (filter.category) {
    const wanted = normalize(filter.category)
    const matchesId =
      Boolean((entry.categoryId ?? '').trim()) &&
      normalize(entry.categoryId ?? '') === wanted
    const matchesName =
      normalize(resolveEntryCategoryName(entry, categories) ?? '') === wanted
    if (!matchesId && !matchesName) return false
  }
  if (filter.tag) {
    const wanted = normalize(filter.tag)
    if (!(entry.tags ?? []).some((tag) => normalize(tag) === wanted)) {
      return false
    }
  }
  return true
}

/* ── Category routes (AGL-1321) ─────────────────────────────────────────── */

/**
 * URL form of a category id or display name (AGL-1321): lowercase, runs of
 * non-alphanumerics collapsed to a single `-`, no leading/trailing dash.
 *
 * Deliberately lossy and idempotent, so the same category addresses the same
 * URL whether the author typed the taxonomy id, the display name, or the URL
 * segment itself. `Open source` → `open-source` → `open-source`.
 */
export function collectionCategorySlug(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The taxonomy category a URL segment addresses (AGL-1321), matched on the
 * stable `id` OR the slugified display name — an author linking
 * `/blog/category/open-source` should not have to know which of the two the
 * data happens to store, and an `id` that survives a rename is exactly why
 * the taxonomy has one. `undefined` = the segment names no known category;
 * the caller renders an empty listing rather than crashing.
 */
export function resolveCollectionCategoryBySlug(
  categories: readonly CollectionCategory[] | undefined,
  slug: string | undefined,
): CollectionCategory | undefined {
  const wanted = collectionCategorySlug(slug)
  if (!wanted) return undefined
  return (categories ?? []).find(
    (category) =>
      collectionCategorySlug(category.id) === wanted ||
      collectionCategorySlug(category.name) === wanted,
  )
}

/**
 * The canonical URL of a collection listing (AGL-1321). ONE builder, because
 * the pills, the pager, the `<link rel="canonical">`, the JSON-LD and the
 * sitemap must all agree on the shape or the filter quietly becomes a
 * duplicate-content generator.
 *
 * The unfiltered page-1 listing is the bare `/{collection}` — there is no
 * `/{collection}/category/all` and no `?category=all`, so "All" cannot become
 * a second address for the page that already exists.
 */
export function collectionListUrl(options: {
  collectionSlug: string
  categorySlug?: string | null
  page?: number | null
}): string {
  const scoped = options.categorySlug
    ? `/${options.collectionSlug}/${COLLECTION_CATEGORY_ROUTE_SEGMENT}/` +
      collectionCategorySlug(options.categorySlug)
    : `/${options.collectionSlug}`
  const page = Number(options.page)
  return Number.isFinite(page) && page > 1
    ? `${scoped}/${COLLECTION_PAGE_ROUTE_SEGMENT}/${Math.floor(page)}`
    : scoped
}

/** Where a listing's pager can go from here (AGL-1386). */
export interface CollectionPaginationLinks {
  /** 1-based current page; 1 when the listing is unpaginated. */
  page: number
  /** Total pages in the CURRENT (possibly category-filtered) set. */
  totalPages: number
  /** The previous page's URL, or `''` on the first page. */
  prevUrl: string
  /** The next page's URL, or `''` on the last page. */
  nextUrl: string
}

/**
 * Everything a pager needs for one listing (AGL-1386): which page it is on,
 * how many there are, and where prev/next go — through
 * {@link collectionListUrl}, so both links stay inside the category they are
 * paging rather than dumping the reader back onto the unfiltered list.
 *
 * **The edges resolve to the empty string, never to a URL.** No previous page
 * means `prevUrl` is `''`; no next page means `nextUrl` is `''`. That is what
 * lets an authored template bind these unconditionally: one static list screen
 * serves the bare listing, every `/page/{n}`, and every
 * `/category/{slug}` — and there is no runtime conditional to hide a link
 * with. A link whose href resolves to `''` renders as an inert placeholder of
 * the same element (AGL-1268/1357), which is the correct pager on page 1 of 1.
 *
 * ONE computation, because it has two consumers that must agree: the built-in
 * fallback pager's nodes and the `{{pagination.*}}` tokens an authored
 * template binds. A second derivation is how a fallback and a template start
 * disagreeing about which page they are on.
 */
export function collectionPaginationLinks(options: {
  collectionSlug: string
  categorySlug?: string | null
  /** 1-based current page; anything unusable reads as page 1. */
  page?: number | null
  /** Total pages; anything unusable reads as a single page. */
  totalPages?: number | null
}): CollectionPaginationLinks {
  const positive = (value: number | null | undefined): number => {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }
  const page = positive(options.page)
  const totalPages = positive(options.totalPages)
  const href = (n: number) =>
    collectionListUrl({
      collectionSlug: options.collectionSlug,
      ...(options.categorySlug ? { categorySlug: options.categorySlug } : {}),
      page: n,
    })
  return {
    page,
    totalPages,
    prevUrl: page > 1 ? href(page - 1) : '',
    nextUrl: page < totalPages ? href(page + 1) : '',
  }
}

/** A content-collection path resolved to what it addresses (AGL-1321). */
export interface CollectionRoute {
  collectionSlug: string
  /** Set only for `/{collection}/{entry}`. */
  entrySlug?: string
  /** Set only for `/{collection}/category/{slug}[/page/{n}]`. */
  categorySlug?: string
  /** 1-based list page; always 1 for entry routes. */
  page: number
}

const POSITIVE_INTEGER = /^[1-9]\d*$/

/**
 * Parses a non-screen path against the content-collection route shapes
 * (AGL-81/620/1321), or `null` when it is none of them and the caller should
 * fall through to the 404 chain:
 *
 * ```
 * /{collection}                                list, page 1, all categories
 * /{collection}/{entry}                        one entry
 * /{collection}/page/{n}                       list page n
 * /{collection}/category/{slug}                filtered list, page 1
 * /{collection}/category/{slug}/page/{n}       filtered list, page n
 * ```
 *
 * Pure, and shared by the tenant loader and its tests, because the route
 * table IS the ISR cache key here: the tenant catch-all caches by PATH, so a
 * listing variant that lives in the path gets its own cache entry for free,
 * while one that lived in a query string would share `/blog`'s entry and
 * serve one category's HTML for another.
 */
export function parseCollectionRoute(
  segments: readonly string[],
): CollectionRoute | null {
  const [collectionSlug, ...rest] = segments
  if (!collectionSlug) return null
  if (!rest.length) return { collectionSlug, page: 1 }
  if (rest.length === 1) return { collectionSlug, entrySlug: rest[0], page: 1 }
  if (rest.length === 2 && rest[0] === COLLECTION_PAGE_ROUTE_SEGMENT) {
    return POSITIVE_INTEGER.test(rest[1])
      ? { collectionSlug, page: Number(rest[1]) }
      : null
  }
  if (rest.length === 2 && rest[0] === COLLECTION_CATEGORY_ROUTE_SEGMENT) {
    const categorySlug = collectionCategorySlug(rest[1])
    return categorySlug ? { collectionSlug, categorySlug, page: 1 } : null
  }
  if (
    rest.length === 4 &&
    rest[0] === COLLECTION_CATEGORY_ROUTE_SEGMENT &&
    rest[2] === COLLECTION_PAGE_ROUTE_SEGMENT &&
    POSITIVE_INTEGER.test(rest[3])
  ) {
    const categorySlug = collectionCategorySlug(rest[1])
    return categorySlug
      ? { collectionSlug, categorySlug, page: Number(rest[3]) }
      : null
  }
  return null
}

/**
 * Does this entry belong to the category a URL segment addresses (AGL-1321)?
 *
 * Every spelling the route could plausibly mean is slugified into one set and
 * checked against both of the entry's own spellings — the stable `categoryId`
 * and the RESOLVED display name. So `/blog/category/open-source` answers for
 * a taxonomy whose id is `opensource`, for one whose id is opaque but whose
 * name is "Open source", and for a legacy free-typed entry that predates the
 * taxonomy entirely. `entryMatchesFilter` cannot stand in: it compares raw
 * trimmed strings, so it would miss every multi-word category name.
 */
export function entryMatchesCategoryRoute(
  entry: CollectionEntryRecord,
  route: { slug: string; category?: CollectionCategory },
  categories?: readonly CollectionCategory[],
): boolean {
  const wanted = new Set(
    [route.slug, route.category?.id, route.category?.name]
      .map((value) => collectionCategorySlug(value))
      .filter(Boolean),
  )
  if (!wanted.size) return false
  const entryId = collectionCategorySlug(entry.categoryId)
  if (entryId && wanted.has(entryId)) return true
  const entryName = collectionCategorySlug(
    resolveEntryCategoryName(entry, categories),
  )
  return Boolean(entryName) && wanted.has(entryName)
}

/** One category pill as stamped onto a Category Pills block (AGL-1321). */
export interface CollectionCategoryLink {
  label: string
  href: string
  /** The pill for the listing currently being rendered. */
  active: boolean
}

/** Label the unfiltered pill carries when the author never named one. */
export const COLLECTION_ALL_PILL_DEFAULT = 'All'

/**
 * The value that persists "no All pill" (AGL-1336).
 *
 * The attribute documented "clear it to omit that pill" and could not do it:
 * the attributes form strips an emptied text field's KEY (ddf maps an
 * emptied field to its `clearedValue`, final-form's default parse turns
 * `''` into `undefined`, and `updateNodeProps` replaces the props object),
 * so the absent key took {@link COLLECTION_ALL_PILL_DEFAULT} and the pill
 * came straight back. `''` is therefore not a value this field can hold —
 * the same AGL-1191 trap that made the App Bar's "Default" unpersistable.
 *
 * So the field carries this as its `clearedValue`: clearing the box writes
 * the word `none`, which survives the round trip and is honoured here.
 * Deliberately a readable word rather than a magic character — an author who
 * reopens the panel sees `none` in the All-label box and can read what it
 * did. Removing the prop entirely (the ✕ affordance) still means "unset",
 * and restores the default.
 */
export const COLLECTION_ALL_PILL_NONE = 'none'

/**
 * What the unfiltered pill should be labelled, or `''` to omit it — the ONE
 * place the {@link COLLECTION_ALL_PILL_NONE} sentinel is interpreted
 * (AGL-1336). Matched case-insensitively on the trimmed value, because the
 * sentinel is typed by a human only when they are re-entering it by hand.
 *
 * `undefined` is UNSET and takes the default. `null` is CLEARED and omits —
 * it reaches here only from a hand-edited or imported document, but the two
 * are different questions and must not collapse into one answer.
 */
export function resolveCollectionAllLabel(value?: string | null): string {
  if (value === undefined) return COLLECTION_ALL_PILL_DEFAULT
  if (value === null) return ''
  const text = `${value}`.trim()
  if (!text) return ''
  return text.toLowerCase() === COLLECTION_ALL_PILL_NONE ? '' : text
}

/**
 * The pill row for a collection (AGL-1321): "All" pointing at the canonical
 * unfiltered listing, then one pill per taxonomy category.
 *
 * Each pill addresses its category by the STABLE id where there is one, so a
 * rename moves the label without breaking the link. Active state is decided
 * through the same resolver the route used, not by string equality, because
 * the URL may legitimately have named the category by either spelling.
 */
export function buildCollectionCategoryLinks(options: {
  collectionSlug: string
  categories?: readonly CollectionCategory[]
  activeCategorySlug?: string
  /**
   * Label for the unfiltered pill. Absent takes the default; `''` or the
   * {@link COLLECTION_ALL_PILL_NONE} sentinel omits the pill.
   */
  allLabel?: string | null
}): CollectionCategoryLink[] {
  const { collectionSlug } = options
  const active = collectionCategorySlug(options.activeCategorySlug)
  const links: CollectionCategoryLink[] = []
  for (const category of options.categories ?? []) {
    const idSlug = collectionCategorySlug(category.id)
    const nameSlug = collectionCategorySlug(category.name)
    const slug = idSlug || nameSlug
    if (!slug) continue
    links.push({
      label: category.name,
      href: collectionListUrl({ collectionSlug, categorySlug: slug }),
      active: Boolean(active) && (idSlug === active || nameSlug === active),
    })
  }
  // A lone "All" pill is not a filter, it is decoration — a collection with
  // no taxonomy gets no row at all.
  if (!links.length) return []
  const allLabel = resolveCollectionAllLabel(options.allLabel)
  return allLabel
    ? [
        {
          label: allLabel,
          href: collectionListUrl({ collectionSlug }),
          active: !active,
        },
        ...links,
      ]
    : links
}

/**
 * The matchable text a search box holds for a set of entries (AGL-1516),
 * built ONCE for both blocks that carry one — the entries block's in-place
 * filter and the standalone toolbar box (AGL-1516, Figma 494:1220).
 *
 * Shared rather than copied for the same reason
 * {@link COLLECTION_SEARCH_FUSE_OPTIONS} is: the two boxes can sit on the
 * same page, over the same collection, and a reader who sees a suggestion in
 * one and a miss in the other has been told the site is broken. Two builders
 * is how the row's date, chip and link drift apart.
 *
 * The row's link, date and category are resolved HERE, where the entry still
 * exists — a component only holds rendered markup by the time it runs, and
 * the suggestion panel draws its rows from this index rather than from the
 * clones. Through the same three resolvers Related posts uses (AGL-1926 for
 * the date especially): a suggestion for a post is the same post as the card
 * below it and must not be able to disagree with it about its date.
 */
export function buildCollectionSearchIndex(
  entries: readonly CollectionEntryRecord[],
  collectionSlug: string,
  categories?: readonly CollectionCategory[],
): CollectionEntrySearchItem[] {
  return entries.map((entry): CollectionEntrySearchItem => {
    const categoryName = resolveEntryCategoryName(entry, categories)
    return {
      title: entry.title ?? '',
      excerpt: entry.excerpt ?? '',
      // Absent keys rather than empty strings, so the row asks one question
      // per field instead of two — the shape Related posts settled on
      // (AGL-1457).
      ...(entry.slug ? { url: `/${collectionSlug}/${entry.slug}` } : {}),
      ...(entry.publishedAt?.seconds
        ? { date: formatCollectionEntryDate(entry.publishedAt) }
        : {}),
      ...(categoryName ? { category: categoryName } : {}),
    }
  })
}

/**
 * Collection entries blocks (AGL-551): a `collectionEntries` container
 * treats its children as the item template and renders them once per
 * published entry, with `{{entry.*}}` tokens in cloned string props replaced
 * per entry — the content-collection sibling of {@link expandRepeatables}.
 *
 * - The block's collection resolves from its `collectionSlug` prop, falling
 *   back to `defaultSlug` (the routed collection on list-template screens).
 * - Clone ids are namespaced `centry__{containerId}__{index}__…` so repeats
 *   never collide; run AFTER grafting and BEFORE binding resolution.
 * - Rows are bounded by `props.entriesLimit` and
 *   {@link COLLECTION_ENTRIES_MAX}.
 * - `props.firstPageOnly` renders zero rows past page 1 of the ROUTED
 *   listing (AGL-1871), so a lead card does not repeat down the pagination.
 * - An UNKNOWN collection leaves the node untouched (fail-open: a renamed
 *   collection must never take a screen down). A known collection with no
 *   matching entries renders zero rows — never the unsubstituted template.
 * - Inputs are never mutated; template nodes stay in the map unreferenced.
 */
export function expandCollectionEntries<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  sourcesBySlug: Record<string, CollectionEntriesSource | undefined>,
  defaultSlug?: string,
): Record<NodeId, N> {
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === COLLECTION_ENTRIES_COMPONENT_ID,
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const slug =
      String((container.props as any)?.collectionSlug ?? '').trim() ||
      defaultSlug
    const source = slug ? sourcesBySlug[slug] : undefined
    // An UNKNOWN collection leaves the node untouched — fail-open, so a
    // renamed collection never takes a published screen down.
    //
    // A KNOWN collection with nothing to show is a different question, and
    // used to get the same answer (AGL-1321). Leaving the template in place
    // renders it once, with its `{{entry.title}}` / `{{entry.url}}` tokens
    // never substituted, so the page shipped a ghost row of literal braces.
    // That was rare while the only way to empty a list was to publish an
    // empty collection; a category filter makes it reachable from any pill
    // whose category has no posts yet. Zero entries now means zero rows.
    if (!source) continue
    const limitRaw = Number((container.props as any)?.entriesLimit)
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, COLLECTION_ENTRIES_MAX)
        : COLLECTION_ENTRIES_MAX

    // Pagination (AGL-620): when `perPage` is set the block renders one page
    // window `[(page-1)*perPage, page*perPage)`; without it, the legacy
    // `entriesLimit` slice from the top applies unchanged.
    const perPageRaw = Number((container.props as any)?.perPage)
    const perPage =
      Number.isFinite(perPageRaw) && perPageRaw > 0
        ? Math.min(Math.floor(perPageRaw), COLLECTION_ENTRIES_MAX)
        : undefined
    // The block's own `page` wins; otherwise the ROUTE's page applies, so
    // `/blog/page/2` and `/blog/category/guides/page/2` render page 2 of a
    // template listing instead of silently re-serving page 1 at a second URL
    // (AGL-1321). Only ever the routed collection: `source.page` is set
    // nowhere else.
    const pageRaw = Number((container.props as any)?.page)
    const routedPage = Number(source.page)
    const page =
      Number.isFinite(pageRaw) && pageRaw >= 1
        ? Math.floor(pageRaw)
        : Number.isFinite(routedPage) && routedPage >= 1
          ? Math.floor(routedPage)
          : 1
    // "Only on page 1" (AGL-1871): a LEAD block takes the top of the set and
    // has no page window of its own, so on `/blog/page/2` it repeats exactly
    // what page 1 led with — same cover, same title, same excerpt — above a
    // page of different posts, under an eyebrow that reads "Latest". True on
    // page 1, false everywhere after it.
    //
    // Opt-in and default off. The alternative reading — "a block with no
    // `perPage` on a paginated route is a lead block" — is wrong: a "popular
    // posts" rail is the same shape and belongs on every page of the listing.
    // Only the author knows which one they built, so the author says so.
    //
    // Gated on the ROUTE's page, never on the block's own pinned `page`. A
    // block that names its own page is a deliberately fixed window ("the
    // entries page 3 would show, here"), which says nothing about which page
    // of the listing the reader is on; and off a routed listing entirely
    // (a blog rail on the homepage) `source.page` is unset, so the switch
    // correctly hides nothing.
    const firstPageOnly = Boolean((container.props as any)?.firstPageOnly)
    const suppressedBeyondFirstPage =
      firstPageOnly && Number.isFinite(routedPage) && routedPage > 1

    const templateIds = Array.isArray(container.nodes)
      ? (container.nodes as NodeId[])
      : []
    if (!templateIds.length) continue

    // Category/tag filter props (AGL-582): the block-level answer to
    // /blog?tag=x — query params never reach the ISR-cached loader, so
    // filtered lists are designed as filtered BLOCKS instead.
    const filterCategory = String(
      (container.props as any)?.filterCategory ?? '',
    ).trim()
    const filterTag = String(
      (container.props as any)?.filterTag ?? '',
    ).trim()
    const filtered =
      filterCategory || filterTag
        ? source.entries.filter((entry) =>
            entryMatchesFilter(
              entry,
              {
                category: filterCategory || undefined,
                tag: filterTag || undefined,
              },
              source.categories,
            ),
          )
        : source.entries
    // Whether the READ behind `source.entries` reached its own bound
    // (AGL-1516). Taken off the raw set, never off `filtered`: a block-level
    // category filter legitimately narrows a complete read, and a narrowed
    // set is not a bounded one. The source's own `reachedBound` wins over
    // counting it, because the count cannot see a read that came back full
    // and was then thinned by the liveness gate.
    const sourceCapped = collectionSourceIsBounded(source)

    const windowed = suppressedBeyondFirstPage
      ? []
      : perPage
        ? filtered.slice((page - 1) * perPage, (page - 1) * perPage + perPage)
        : filtered.slice(0, limit)

    const childIds: NodeId[] = []
    windowed.forEach((entry, index) => {
      const prefix = `${COLLECTION_ENTRIES_NODE_ID_PREFIX}${containerId}__${index}__`
      const prefixId = (id: NodeId) => `${prefix}${id}`
      const cloned: Record<NodeId, N> = {}
      const cloneSubtree = (id: NodeId, parentId: NodeId) => {
        const node = nodes[id]
        if (!node) return
        const clonedChildren = Array.isArray(node.nodes)
          ? (node.nodes as NodeId[])
          : undefined
        cloned[prefixId(id)] = {
          ...node,
          $id: prefixId(id),
          parentId,
          ...(clonedChildren && {
            nodes: clonedChildren.map((childId) => prefixId(childId)),
          }),
        }
        clonedChildren?.forEach((childId) =>
          cloneSubtree(childId, prefixId(id)),
        )
      }
      for (const templateId of templateIds) {
        cloneSubtree(templateId, containerId)
        childIds.push(prefixId(templateId))
      }
      Object.assign(
        next,
        resolveNamedTokens(
          cloned,
          collectionEntryTokens(entry, source.slug, source.categories),
        ),
      )
    })
    // Search (AGL-1516): the block's search box filters CLIENT-SIDE over the
    // entries this expansion just rendered — the ISR-cached page is the whole
    // data set, so no query ever goes back to Firestore. The component only
    // holds cloned markup by render time, so the matchable text is stamped
    // here, where the entries still exist, index-aligned with the clone
    // groups. Stamped ONLY when the author enabled it: an untouched block's
    // node — and its serialized payload — stays byte-identical.
    const searchEnabled = Boolean((container.props as any)?.search)
    next[containerId] = searchEnabled
      ? {
          ...container,
          props: {
            ...(container.props as any),
            searchIndex: buildCollectionSearchIndex(
              windowed,
              source.slug,
              source.categories,
            ),
            // How many entries the window above was drawn FROM (AGL-1516).
            //
            // The component has to tell the reader whether a miss means "not
            // here" or "not anywhere", and it cannot work that out for
            // itself: it sees `perPage`, but `perPage` is only one of three
            // ways this block gets truncated. `entriesLimit` slices too, and
            // so does COLLECTION_ENTRIES_MAX at 100. A block set to "latest 6
            // posts" indexes 6 of 40 and, keyed off `perPage` alone, told the
            // reader flatly that their post does not exist.
            //
            // Stamped as the COUNT rather than as a `truncated` verdict, so
            // the component decides the wording and this stays a fact. It is
            // the post-filter total — a category-filtered block searches its
            // category, and "the rest of the collection" means the rest of
            // what this block would otherwise show.
            searchTotal: filtered.length,
            // And whether `searchTotal` is itself a ceiling (AGL-1516).
            //
            // `source.entries` is a READ, and that read is bounded — the
            // tenant fetches a collection's live entries with a hard
            // `.limit(100)` and no `orderBy`. On a collection past that bound
            // `filtered.length` reports the bound, not the collection, so
            // `searchIndex.length === searchTotal` — the test the component
            // reads as "this block holds the whole set" — is satisfied by a
            // block that holds 100 of 400 posts. The completeness claim is
            // the one thing a truncated read must never be allowed to make:
            // "no matches" over a quarter of a collection is a confident lie
            // about the other three quarters.
            //
            // A fact, like the count beside it: "the read that produced this
            // index reached its bound". A collection of exactly 100 sets it
            // too, and is described one notch more cautiously than it needed
            // to be — which is the safe direction, and the only one available
            // without a second count query.
            ...(sourceCapped ? { searchCapped: true } : {}),
          },
          nodes: childIds,
        }
      : { ...container, nodes: childIds }
  }
  return next
}

/**
 * Category Pills blocks (AGL-1321): stamps each `collectionCategories` node
 * with its collection's pill row as a serializable `items` prop the component
 * renders as real anchors — the same server-stamped shape Related posts uses,
 * and for the same reason: the block owns its markup, so there is no template
 * to clone.
 *
 * `activeCategorySlug` marks a pill only on the ROUTED collection. A pills
 * block pointing at some other collection is not what this URL filters, so
 * marking one of its pills current would be a lie in the HTML.
 *
 * A collection with no taxonomy leaves its block untouched, so the component's
 * besigner affordance / empty site render applies. Inputs are never mutated.
 */
export function expandCollectionCategories<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  sourcesBySlug: Record<string, CollectionEntriesSource | undefined>,
  defaultSlug?: string,
  activeCategorySlug?: string,
): Record<NodeId, N> {
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === COLLECTION_CATEGORIES_COMPONENT_ID,
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const slug =
      String((container.props as any)?.collectionSlug ?? '').trim() ||
      defaultSlug
    const source = slug ? sourcesBySlug[slug] : undefined
    if (!source) continue
    const allLabel = (container.props as any)?.allLabel
    const items = buildCollectionCategoryLinks({
      collectionSlug: source.slug,
      categories: source.categories,
      ...(slug === defaultSlug ? { activeCategorySlug } : {}),
      // Absent means "never set" and takes the default; `null` is a cleared
      // value and is forwarded AS null, because `String(null)` would have
      // labelled the pill "null" (AGL-1336).
      ...(allLabel === undefined
        ? {}
        : { allLabel: allLabel === null ? null : String(allLabel) }),
    })
    if (!items.length) continue
    next[containerId] = {
      ...container,
      props: { ...(container.props as any), items },
    }
  }
  return next
}

/**
 * Collection Search blocks (AGL-1516): stamps each `collectionSearch` node
 * with its collection's search index, the size of the set that index was
 * drawn from, and whether that set was a bounded read — the same
 * server-stamped shape Category Pills and Related posts use, and for the same
 * reason: the block owns its markup, so there is no template to clone.
 *
 * Indexes the WHOLE source rather than a page window. The entries block's box
 * searches the entries that block rendered because it filters them in place;
 * a toolbar box filters nothing and suggests, so scoping it to one page of a
 * listing would be an arbitrary cut nobody asked for. What it can honestly
 * cover is the set the page's listing is drawn from — which on a category
 * route is that category, because `source.entries` arrives filtered.
 *
 * Clones are SKIPPED by their `centry__` prefix: a search box inside an entry
 * template would otherwise be stamped once per card. Nodes are never mutated,
 * and a collection with no entries leaves its block untouched, so the
 * component's besigner affordance and its empty site render both stand.
 */
export function expandCollectionSearch<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  sourcesBySlug: Record<string, CollectionEntriesSource | undefined>,
  defaultSlug?: string,
): Record<NodeId, N> {
  const containers = Object.entries(nodes).filter(
    ([id, node]) =>
      node?.componentId === COLLECTION_SEARCH_COMPONENT_ID &&
      !id.startsWith(COLLECTION_ENTRIES_NODE_ID_PREFIX),
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const slug =
      String((container.props as any)?.collectionSlug ?? '').trim() ||
      defaultSlug
    const source = slug ? sourcesBySlug[slug] : undefined
    // An unknown collection leaves the node untouched — fail-open, exactly as
    // the entries and pills blocks do, so a rename never takes a screen down.
    if (!source) continue
    // A collection with nothing published gets no box. A search field over an
    // empty index can only ever answer "no matches", which reads as a fact
    // about the reader's query rather than about the empty collection it
    // really describes.
    if (!source.entries.length) continue
    next[containerId] = {
      ...container,
      props: {
        ...(container.props as any),
        searchIndex: buildCollectionSearchIndex(
          source.entries,
          source.slug,
          source.categories,
        ),
        searchTotal: source.entries.length,
        ...(collectionSourceIsBounded(source) ? { searchCapped: true } : {}),
      },
    }
  }
  return next
}

/**
 * Entry Meta blocks (AGL-1385): stamps each `collectionEntryMeta` node with
 * the routed entry's date, category and tags — the same server-stamped shape
 * Category Pills and Related posts already use.
 *
 * MEASURED on the live marketing blog, which is what this fixes. The block was
 * on `blogEntryTmpl` carrying props `{showDate: true, showCategory: true,
 * showTags: true}` and NOTHING else, and rendered as an empty `<div>` at height
 * 0 — while the very same entry's `<pubDate>` and `Guides` category appeared in
 * its feed item, its JSON-LD, and a heading two nodes above it. So the data was
 * never missing; the block simply had nothing bound to it.
 *
 * The design is what made that reachable. Every other collection block sources
 * itself; this one required the author to type `{{entry.date}}` into a text
 * field. Only the PRESET seeds those tokens — drag the bare component out of
 * the palette and you get three switches labelled "Show date / Show category /
 * Show tags", all defaulting to on, gating values that can never exist. That is
 * an affordance promising something the component cannot deliver, so this is a
 * defect in the block and not in anyone's content, and it hits every collection
 * that uses it, not just blog.
 *
 * Deliberately narrow:
 *
 *  - An AUTHORED value always wins. Only an absent or blank prop is filled, so
 *    a hand-typed byline, a pinned string, or a `{{entry.*}}` token still
 *    awaiting substitution is never overwritten. (Blank counts as unset
 *    because a cleared text field cannot persist `''` anyway — AGL-1336. The
 *    way to hide a value is the switch that exists for it.)
 *  - Nodes cloned per entry by {@link expandCollectionEntries} are SKIPPED by
 *    their `centry__` id prefix. Their tokens resolve per clone; stamping the
 *    routed entry into them would date every card in a listing the same.
 *  - Without a routed entry — a list route, a plain screen — nothing is
 *    stamped, so the besigner affordance and the empty site render stand.
 *
 * `dateFormat` (AGL-1459) is answered here, where the timestamp still exists,
 * and is the ONE exception to "an authored value always wins" — narrowly, and
 * only for the literal `{{entry.date}}` binding. That binding is what the
 * block's own preset seeds, so a format that filled blanks only would do
 * nothing on the exact surface it was built for. The token is not a hand-typed
 * override; it NAMES the value being reformatted. A literal string an author
 * typed still wins, unchanged.
 *
 * Inputs are never mutated.
 */
export function expandCollectionEntryMeta<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  entry: CollectionEntryRecord | null | undefined,
  categories?: readonly CollectionCategory[],
): Record<NodeId, N> {
  if (!entry) return nodes
  const containers = Object.entries(nodes).filter(
    ([id, node]) =>
      node?.componentId === COLLECTION_ENTRY_META_COMPONENT_ID &&
      !id.startsWith(COLLECTION_ENTRIES_NODE_ID_PREFIX),
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const props = (container.props ?? {}) as Record<string, unknown>
    // Per node: the format is a prop, so two blocks on one template can read
    // their dates differently.
    const dateFormat = normalizeCollectionEntryDateFormat(props['dateFormat'])
    const values = collectionEntryMetaValues(entry, categories, dateFormat)
    const filled: Record<string, string> = {}
    for (const key of ['date', 'author', 'category', 'tags'] as const) {
      const authored = String(props[key] ?? '').trim()
      if (authored && !reformattableEntryDate(key, authored, dateFormat)) {
        continue
      }
      if (!values[key]) continue
      filled[key] = values[key]
    }
    if (!Object.keys(filled).length) continue
    next[containerId] = { ...container, props: { ...props, ...filled } as any }
  }
  return next
}

/** The one binding a chosen date format may replace (AGL-1459). */
const ENTRY_DATE_BINDING = '{{entry.date}}'

/**
 * Is this authored value the `{{entry.date}}` binding under a chosen format
 * (AGL-1459)? Anything else — a literal string, another token, the default
 * format — answers no, and the authored value stands.
 */
function reformattableEntryDate(
  key: string,
  authored: string,
  dateFormat: CollectionEntryDateFormat,
): boolean {
  return (
    key === 'date' &&
    authored === ENTRY_DATE_BINDING &&
    dateFormat !== COLLECTION_ENTRY_DATE_FORMAT_DEFAULT
  )
}

/**
 * The ONE matcher configuration behind every entry search in the product
 * (AGL-1516/AGL-1525) — the block's toolbar box, its suggestion panel, and
 * the site-wide results page the panel links to.
 *
 * Shared rather than copied because the two halves are joined by a link the
 * reader clicks: the panel's "View all results" hands its query to /search,
 * and if the results page matched more strictly it would answer a visible
 * suggestion with "no results". A typo the panel forgave — "platfrom" — is
 * exactly the query most likely to make that trip.
 *
 * The shape is the icon picker's (use-mdi-icons-fuzzy), tuned once for prose
 * and MEASURED before shipping: the title names the post and the excerpt
 * merely describes it, so they are weighted 0.7/0.3; the default location
 * scoring buries a legitimate mid-sentence hit in a sentence-long excerpt,
 * and the default 0.6 threshold matches "media" against every post on letter
 * soup, so location is ignored and the threshold tightened to 0.3.
 *
 * A plain object, not a Fuse instance: `libs/aglyn` is dependency-light by
 * design, and each consumer already imports Fuse from the vendor bundle.
 */
export const COLLECTION_SEARCH_FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'excerpt', weight: 0.3 },
  ],
  includeScore: true,
  shouldSort: true,
  ignoreLocation: true,
  threshold: 0.3,
}

/**
 * One entry of a Collection Entries search index (AGL-1516): the fields the
 * block's client-side search box matches against, index-aligned with the
 * entry clones the block rendered. Stamped by {@link expandCollectionEntries}
 * only when the block's `search` prop is on; never set by hand.
 */
export interface CollectionEntrySearchItem {
  title: string
  excerpt: string
  /**
   * Entry permalink (AGL-1525). The `filter` mode never needs it — it hides
   * and shows clones that already carry their own links — but a suggestion
   * row IS the link, and the panel is drawn from the index, not from the
   * clones. Optional because a page cached before this shipped has an index
   * without it; the panel degrades to plain text rather than to a dead link.
   */
  url?: string
  /** Published date, through {@link formatCollectionEntryDate} (AGL-1525). */
  date?: string
  /** Category display name for the suggestion row's chip (AGL-1525). */
  category?: string
}

/** One related post as stamped onto a Related posts block (AGL-582). */
export interface CollectionRelatedItem {
  title: string
  url: string
  date?: string
  excerpt?: string
  /** Per-entry byline (AGL-686); falls back to the site as author. */
  authorName?: string
  category?: string
  /**
   * The entry's cover, as STORED (AGL-1457) — a `media:` reference, a legacy
   * URL, or a hotlink. Left unresolved on purpose: the block resolves it at
   * render through `resolveMediaSrc`, exactly as the Image element does, so
   * one reference keeps working across sites and CDN route changes.
   */
  coverImage?: string
  /**
   * The author's description of that cover (AGL-2418). Travels WITH
   * `coverImage`, and absent means "fall back to the title" rather than
   * "silent" — on this block the cover is the link's own content.
   */
  coverImageAlt?: string
}

/**
 * Related-post selection (AGL-582): other entries of the same collection
 * that share the current entry's category or at least one tag, newest
 * first. Pure so the compose stage and tests share one implementation. An
 * entry with no category and no tags relates to nothing — the caller
 * renders nothing rather than guessing.
 *
 * Two entries share a category when their stable `categoryId`s are equal
 * (survives renames AND deletions) or their RESOLVED display names match
 * case-insensitively — so a legacy free-typed entry still relates to a
 * migrated `categoryId` entry whose taxonomy name spells the same.
 */
export function selectRelatedEntries(
  entries: CollectionEntryRecord[],
  current: CollectionEntryRecord,
  limit = COLLECTION_RELATED_DEFAULT_LIMIT,
  categories?: CollectionCategory[],
): CollectionEntryRecord[] {
  const categoryId = (current.categoryId ?? '').trim()
  const categoryName = (
    resolveEntryCategoryName(current, categories) ?? ''
  ).toLowerCase()
  const tags = (current.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  if (!categoryId && !categoryName && !tags.length) return []
  const bounded = Math.min(
    Math.max(limit, 0) || COLLECTION_RELATED_DEFAULT_LIMIT,
    COLLECTION_RELATED_MAX,
  )
  return entries
    .filter((entry) => {
      if (
        (entry.$id && entry.$id === current.$id) ||
        (entry.slug && entry.slug === current.slug)
      ) {
        return false
      }
      if (categoryId && (entry.categoryId ?? '').trim() === categoryId) {
        return true
      }
      if (
        categoryName &&
        (resolveEntryCategoryName(entry, categories) ?? '')
          .trim()
          .toLowerCase() === categoryName
      ) {
        return true
      }
      return tags.some((tag) => entryMatchesFilter(entry, { tag }))
    })
    .sort(
      (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
    )
    .slice(0, bounded)
}

/**
 * Related posts blocks (AGL-582): stamps each `collectionRelated` node with
 * the current entry's related posts as a serializable `entries` prop the
 * component renders directly (no template cloning — the block owns its
 * markup). Runs only on entry renders; without an entry context the nodes
 * stay untouched, so the component's besigner placeholder / empty site
 * render applies. Inputs are never mutated.
 */
export function expandCollectionRelated<
  N extends AglynNodeSchema = AglynNodeSchema,
>(
  nodes: Record<NodeId, N>,
  source: CollectionEntriesSource | undefined,
  currentEntry: CollectionEntryRecord | null | undefined,
): Record<NodeId, N> {
  if (!source || !currentEntry) return nodes
  const containers = Object.entries(nodes).filter(
    ([, node]) => node?.componentId === COLLECTION_RELATED_COMPONENT_ID,
  )
  if (!containers.length) return nodes

  const next: Record<NodeId, N> = { ...nodes }
  for (const [containerId, container] of containers) {
    const limitRaw = Number((container.props as any)?.limit)
    const related = selectRelatedEntries(
      source.entries ?? [],
      currentEntry,
      Number.isFinite(limitRaw) && limitRaw > 0
        ? limitRaw
        : COLLECTION_RELATED_DEFAULT_LIMIT,
      source.categories,
    )
    const items: CollectionRelatedItem[] = related.map((entry) => {
      const categoryName = resolveEntryCategoryName(entry, source.categories)
      return {
        title: entry.title ?? '',
        url: `/${source.slug}/${entry.slug ?? ''}`,
        // Through the one formatter (AGL-1926), not a second inline
        // `toLocaleDateString()`. It produced the same bytes only because
        // this runs on the server, where the implicit locale and zone happen
        // to be the ones `formatCollectionEntryDate` now pins; a related-post
        // card is the same published date as the byline above it and must not
        // be able to disagree with it.
        ...(entry.publishedAt?.seconds
          ? { date: formatCollectionEntryDate(entry.publishedAt) }
          : {}),
        ...(entry.excerpt ? { excerpt: entry.excerpt } : {}),
        // AGL-1457: the block owns its markup, so there is no template to
        // bind `{{entry.coverImage}}` on — the cover can only reach it as a
        // stamped field. Absent covers omit the key rather than stamping an
        // empty string, so the render asks one question, not two.
        ...(entry.coverImage ? { coverImage: entry.coverImage } : {}),
        // Only alongside a cover, and only when authored (AGL-2418) — a
        // description with no picture is dead weight on every stamped node.
        ...(entry.coverImage && (entry as any).coverImageAlt
          ? { coverImageAlt: (entry as any).coverImageAlt }
          : {}),
        ...(categoryName ? { category: categoryName } : {}),
      }
    })
    next[containerId] = {
      ...container,
      props: { ...(container.props as any), entries: items },
    }
  }
  return next
}

export default expandCollectionEntries
