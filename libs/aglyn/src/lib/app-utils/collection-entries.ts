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
 * One published content-collection entry as the compose pipeline sees it
 * (AGL-551). Mirrors the tenant's `CollectionEntrySummary` without the
 * Firestore dependency so the expansion stays pure.
 */
export interface CollectionEntryRecord {
  $id?: string
  title?: string
  slug?: string
  excerpt?: string
  /** Per-entry byline (AGL-686); falls back to the site as author. */
  authorName?: string
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
  return {
    'entry.title': entry.title ?? '',
    'entry.excerpt': entry.excerpt ?? '',
    'entry.body': entry.body ?? '',
    'entry.coverImage': entry.coverImage ?? '',
    'entry.slug': entry.slug ?? '',
    'entry.url': `/${collectionSlug}/${entry.slug ?? ''}`,
    'entry.date': entry.publishedAt?.seconds
      ? new Date(entry.publishedAt.seconds * 1000).toLocaleDateString()
      : '',
    // Entry model v2 (AGL-582): taxonomy + SEO tokens. The SEO pair falls
    // back to title/excerpt so templates can bind them unconditionally.
    // Category resolves by stable ID against the collection's taxonomy,
    // falling back to the legacy free-typed string.
    'entry.category': resolveEntryCategoryName(entry, categories) ?? '',
    'entry.tags': (entry.tags ?? []).join(', '),
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

    const windowed = perPage
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
    next[containerId] = { ...container, nodes: childIds }
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

/** One related post as stamped onto a Related posts block (AGL-582). */
export interface CollectionRelatedItem {
  title: string
  url: string
  date?: string
  excerpt?: string
  /** Per-entry byline (AGL-686); falls back to the site as author. */
  authorName?: string
  category?: string
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
        ...(entry.publishedAt?.seconds
          ? {
              date: new Date(
                entry.publishedAt.seconds * 1000,
              ).toLocaleDateString(),
            }
          : {}),
        ...(entry.excerpt ? { excerpt: entry.excerpt } : {}),
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
