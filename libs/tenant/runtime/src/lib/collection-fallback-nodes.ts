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

import * as Aglyn from '@aglyn/aglyn/server'

/** Namespaces the synthetic fallback node ids (never persisted). */
const FALLBACK_ID_PREFIX = 'cfb__'

const id = (suffix: string) => `${FALLBACK_ID_PREFIX}${suffix}`

type NodesMap = Record<string, Aglyn.AglynNodeSchema>

interface FallbackCollection {
  slug: string
  displayName: string
  /** Category taxonomy (AGL-582) for `categoryId` → name resolution. */
  categories?: Aglyn.CollectionCategory[]
}

interface FallbackEntry {
  title?: string
  slug?: string
  excerpt?: string
  /** Per-entry byline (AGL-686); falls back to the site as author. */
  authorName?: string
  body?: string
  coverImage?: string
  /** Stable taxonomy reference (AGL-582); wins over `category`. */
  categoryId?: string
  /** Legacy free-typed category (AGL-582); read-only fallback. */
  category?: string
  tags?: string[]
  publishedAt?: { seconds: number } | null
}

const formatDate = (value?: { seconds: number } | null) =>
  value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString() : ''

/**
 * What may be interpolated into the cover block's CSS `url("…")` (AGL-1407).
 *
 * The gate this replaces was `/^https?:\/\//i`, which answered the safety
 * question correctly and the coverage question wrongly: it admitted only the
 * OLDEST of the stored generations. A `media:` reference failed it and the
 * cover block was never emitted — a SILENT drop, no error, no placeholder,
 * just a page missing its picture — and so did the AGL-175 relative CDN path
 * that the first pass at media references wrote. Resolving before testing is
 * what closes that, and the test then has to accept a site-relative path,
 * which is what {@link Aglyn.resolveMediaSrc} returns for a reference.
 *
 * Still a scheme allowlist rather than "anything non-empty": this value lands
 * inside a stylesheet rather than in an `<img src>`, so `data:` and friends
 * have no business here even though {@link cssUrlValue} already makes
 * quote-breaking impossible. A bare relative `cover.png` stays rejected
 * exactly as before — there is no page for it to resolve against at compose
 * time.
 *
 * `http:` was dropped for AGL-1725. AGL-1701 found two paths accepting it;
 * markdown-lite is AGL-1713 and this was the second, separate one. It is the
 * only scheme change here, and it is not a host restriction: an author
 * hotlinking their own https cover keeps working, because on a published
 * site the author IS the site owner and the audience is their own visitors.
 * `http:` alone has no defensible use — the request is mixed passive content
 * that current browsers already block or auto-upgrade, so the author gains
 * nothing from it, while the plaintext fetch discloses which article a
 * visitor is reading to every observer on the network path.
 *
 * The consequence of the drop is the SILENT DROP this whole comment is about,
 * for `http:` covers only: no cover node is emitted. That is the correct
 * trade here and the browser was very likely refusing the image anyway, but
 * it is the reason the change is one scheme and not a host list.
 */
const RENDERABLE_COVER_URL = /^(?:https:\/\/|\/)/i

/**
 * A URL made safe to sit inside `url("…")`, WITHOUT re-encoding it.
 *
 * This replaces `encodeURI`, which was the wrong tool and quietly broke the
 * commonest stored form: `encodeURI` escapes `%`, so every raw firebasestorage
 * download URL — whose object path is `orgs%2F…%2Fmedia%2F…` — came out
 * double-encoded as `%252F` and 404'd. The block rendered, the image did not,
 * which is why it survived: the page looks composed and the picture is just
 * missing.
 *
 * Only the characters that could END the CSS string are escaped, and they are
 * escaped percent-wise rather than with a backslash so the result is still a
 * valid URL if anything downstream reads it as one. `encodeURI` was never
 * needed for anything else here — a stored URL is already URL-encoded.
 */
const cssUrlValue = (url: string) =>
  url.replace(/["\\\n\r]/g, (char) => encodeURIComponent(char))

/** Root → centered container → content stack; children slot underneath. */
function shell(childIds: string[]): NodesMap {
  return {
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: [id('container')],
    },
    [id('container')]: {
      $id: id('container'),
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: Aglyn.NODE_ROOT_ID,
      // `md` is the PROSE case of the Container standard (AGL-1298, Zach
      // 2026-08-18), not an arbitrary narrow default: a collection entry is
      // an article body, and `xl` — the section default — runs a paragraph
      // past 180 characters a line. Stock breakpoint, no bespoke number.
      props: { maxWidth: 'md', sx: { py: 6 } },
      nodes: [id('stack')],
    },
    [id('stack')]: {
      $id: id('stack'),
      componentId: 'muiStack',
      pluginId: 'mui',
      parentId: id('container'),
      props: { spacing: 2 },
      nodes: childIds,
    },
  }
}

const typography = (
  suffix: string,
  props: Record<string, unknown>,
): AglynNodeEntry => [
  id(suffix),
  {
    $id: id(suffix),
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: id('stack'),
    props,
  },
]

type AglynNodeEntry = [string, Aglyn.AglynNodeSchema]

/**
 * Built-in entry article as canvas nodes (AGL-551): when a collection has
 * no entry-template screen, `/{collection}/{entry}` renders these through
 * the normal compose pipeline — site theme, shared layout chrome, and the
 * markdown-rendering Entry body block — instead of the old unthemed HTML.
 */
export function buildCollectionEntryFallbackNodes(
  collection: FallbackCollection,
  entry: FallbackEntry,
  /**
   * The site being composed, so an org-scoped reference is host-qualified the
   * way every other render surface qualifies one (AGL-1043/AGL-1407). Optional
   * because a bare org reference still resolves without it; passing it is what
   * lets an asset restricted to this site resolve at all.
   */
  hostId?: string,
): NodesMap {
  const entries: AglynNodeEntry[] = [
    typography('title', {
      variant: 'h3',
      component: 'h1',
      children: entry.title ?? '',
    }),
  ]
  const date = formatDate(entry.publishedAt)
  const tags = (entry.tags ?? []).filter(Boolean)
  // Category name resolves against the collection's taxonomy (AGL-582):
  // `categoryId` lookup first, legacy free-typed string fallback.
  const categoryName =
    Aglyn.resolveEntryCategoryName(entry, collection.categories) ?? ''
  if (date || categoryName || tags.length) {
    // Entry meta block (AGL-582): "date · category" line + tag chips.
    entries.push([
      id('meta'),
      {
        $id: id('meta'),
        componentId: Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
        pluginId: 'mui',
        parentId: id('stack'),
        props: {
          date,
          category: categoryName,
          tags: tags.join(', '),
        },
      },
    ])
  }
  // The cover, through the ONE shared resolver (AGL-1407). A `media:`
  // reference becomes the site-relative CDN path; a raw storage URL, an
  // AGL-175 CDN path and an author's own hotlinked URL all pass through
  // untouched, which is the documented precedence in `media-ref.ts`.
  const coverImage = Aglyn.resolveMediaSrc(entry.coverImage, { hostId })
  if (coverImage && RENDERABLE_COVER_URL.test(coverImage)) {
    // Rendered as a background image on a plain stack, NOT through the
    // first-party `image` component — that component crashes tenant SSR
    // (AGL-579); the background-image approach is proven safe.
    entries.push([
      id('cover'),
      {
        $id: id('cover'),
        componentId: 'muiStack',
        pluginId: 'mui',
        parentId: id('stack'),
        props: {
          role: 'img',
          'aria-label': entry.title ?? '',
          sx: {
            backgroundImage: `url("${cssUrlValue(coverImage)}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            borderRadius: 1,
            minHeight: 320,
          },
        },
      },
    ])
  }
  entries.push([
    id('body'),
    {
      $id: id('body'),
      componentId: Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID,
      pluginId: 'mui',
      parentId: id('stack'),
      props: { markdown: entry.body ?? '' },
    },
  ])
  // Related posts after the body, share bar at the end (AGL-582); the
  // compose pipeline stamps the related entries server-side.
  entries.push([
    id('related'),
    {
      $id: id('related'),
      componentId: Aglyn.COLLECTION_RELATED_COMPONENT_ID,
      pluginId: 'mui',
      parentId: id('stack'),
      props: { heading: 'Related articles', limit: 3, sx: { pt: 2 } },
    },
  ])
  entries.push([
    id('share'),
    {
      $id: id('share'),
      componentId: Aglyn.COLLECTION_SHARE_COMPONENT_ID,
      pluginId: 'mui',
      parentId: id('stack'),
      props: {},
    },
  ])
  entries.push([
    id('back'),
    {
      $id: id('back'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('stack'),
      props: {
        href: `/${collection.slug}`,
        children: `← ${collection.displayName}`,
        sx: { alignSelf: 'flex-start' },
      },
    },
  ])
  return {
    ...shell(entries.map(([entryId]) => entryId)),
    ...Object.fromEntries(entries),
  }
}

/** Pagination state for the built-in list (AGL-620). */
export interface FallbackListPagination {
  page: number
  perPage: number
  totalPages: number
}

/** The routed category for a filtered listing (AGL-1321). */
export interface FallbackListCategory {
  slug: string
  name: string
}

/** Prev/next + "Page X of Y" nav linking to /{slug}/page/{n} (AGL-620). */
function paginationNodes(
  collection: FallbackCollection,
  pagination: FallbackListPagination,
  category?: FallbackListCategory,
): { childId: string; nodes: NodesMap } {
  // Page 1 lives at the bare listing; deeper pages at .../page/{n}. Built
  // through the shared pager computation so this fallback and the
  // `{{pagination.*}}` tokens an authored template binds (AGL-1386) can never
  // disagree — and so the pager stays inside the category it is paging
  // (AGL-1321): a "next" that dropped the filter would silently return the
  // reader to the unfiltered list. An edge is the empty string, which is
  // exactly the "no link here" this fallback already meant.
  const { page, totalPages, prevUrl, nextUrl } = Aglyn.collectionPaginationLinks(
    {
      collectionSlug: collection.slug,
      ...(category ? { categorySlug: category.slug } : {}),
      page: pagination.page,
      totalPages: pagination.totalPages,
    },
  )
  const children: string[] = []
  const nodes: NodesMap = {}
  if (prevUrl) {
    nodes[id('prev')] = {
      $id: id('prev'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('pager'),
      props: { href: prevUrl, children: '← Newer' },
    }
    children.push(id('prev'))
  }
  nodes[id('pageinfo')] = {
    $id: id('pageinfo'),
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: id('pager'),
    props: {
      variant: 'body2',
      children: `Page ${page} of ${totalPages}`,
      sx: { color: 'text.secondary' },
    },
  }
  children.push(id('pageinfo'))
  if (nextUrl) {
    nodes[id('next')] = {
      $id: id('next'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('pager'),
      props: { href: nextUrl, children: 'Older →' },
    }
    children.push(id('next'))
  }
  nodes[id('pager')] = {
    $id: id('pager'),
    componentId: 'muiStack',
    pluginId: 'mui',
    parentId: id('stack'),
    props: {
      direction: 'row',
      spacing: 3,
      sx: { alignItems: 'center', justifyContent: 'center', pt: 2 },
    },
    nodes: children,
  }
  return { childId: id('pager'), nodes }
}

/**
 * Built-in entry list as canvas nodes (AGL-551): a heading plus a
 * Collection entries block whose template (title, date, excerpt, Read
 * more) the compose pipeline expands over the published entries — the same
 * block designers drop onto their own list-template screens. With
 * `pagination` (AGL-620) the block renders one page and prev/next nav links
 * to `/{slug}/page/{n}`.
 */
export function buildCollectionListFallbackNodes(
  collection: FallbackCollection,
  hasEntries: boolean,
  pagination?: FallbackListPagination,
  category?: FallbackListCategory,
): NodesMap {
  const [titleId, title] = typography('title', {
    variant: 'h3',
    component: 'h1',
    // A filtered listing says which slice it is (AGL-1321) — a page of
    // Guides whose only heading reads "Blog" tells the reader nothing about
    // why the other posts vanished.
    children: category
      ? `${collection.displayName} · ${category.name}`
      : collection.displayName,
  })
  // Category pills (AGL-1321): stamped by `expandCollectionCategories` during
  // compose, from the same taxonomy this node's collection carries. Present
  // in the EMPTY case too — a filtered listing with no entries whose pills
  // vanished would be a dead end with no way back to "All".
  const pills = collection.categories?.length
    ? {
        $id: id('pills'),
        componentId: Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID,
        pluginId: 'mui',
        parentId: id('stack'),
        props: { allLabel: 'All', sx: { pb: 1 } },
      }
    : null
  const lead = pills ? [titleId, id('pills')] : [titleId]
  if (!hasEntries) {
    const [emptyId, empty] = typography('empty', {
      variant: 'body1',
      children: category
        ? `Nothing published in ${category.name} yet.`
        : 'Nothing published yet.',
      sx: { color: 'text.secondary' },
    })
    return {
      ...shell([...lead, emptyId]),
      [titleId]: title,
      ...(pills ? { [id('pills')]: pills } : {}),
      [emptyId]: empty,
    }
  }
  const item = (suffix: string, props: Record<string, unknown>) => ({
    $id: id(suffix),
    componentId: 'muiTypography' as const,
    pluginId: 'mui',
    parentId: id('item'),
    props,
  })
  const pager =
    pagination && pagination.totalPages > 1
      ? paginationNodes(collection, pagination, category)
      : null
  return {
    ...shell(
      pager
        ? [...lead, id('entries'), pager.childId]
        : [...lead, id('entries')],
    ),
    [titleId]: title,
    ...(pills ? { [id('pills')]: pills } : {}),
    [id('entries')]: {
      $id: id('entries'),
      componentId: Aglyn.COLLECTION_ENTRIES_COMPONENT_ID,
      pluginId: 'mui',
      parentId: id('stack'),
      props: {
        spacing: 4,
        ...(pagination
          ? { perPage: pagination.perPage, page: pagination.page }
          : {}),
      },
      nodes: [id('item')],
    },
    ...(pager ? pager.nodes : {}),
    [id('item')]: {
      $id: id('item'),
      componentId: 'muiStack',
      pluginId: 'mui',
      parentId: id('entries'),
      props: { spacing: 0.5 },
      nodes: [
        id('item-title'),
        id('item-date'),
        id('item-excerpt'),
        id('item-link'),
      ],
    },
    [id('item-title')]: item('item-title', {
      variant: 'h5',
      component: 'h2',
      children: '{{entry.title}}',
    }),
    [id('item-date')]: item('item-date', {
      variant: 'caption',
      children: '{{entry.date}}',
      sx: { color: 'text.secondary' },
    }),
    [id('item-excerpt')]: item('item-excerpt', {
      variant: 'body1',
      children: '{{entry.excerpt}}',
    }),
    [id('item-link')]: {
      $id: id('item-link'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('item'),
      props: {
        href: '{{entry.url}}',
        children: 'Read more',
        size: 'small',
        sx: { alignSelf: 'flex-start' },
      },
    },
  }
}

/** Entry vs list fallback selection for the routed content (AGL-551). */
export function buildCollectionFallbackNodes(content: {
  collection: FallbackCollection
  entries: FallbackEntry[]
  entry: FallbackEntry | null
  pagination?: FallbackListPagination | null
  category?: FallbackListCategory | null
  /** The composing site, for host-qualifying a media reference (AGL-1407). */
  hostId?: string
}): NodesMap {
  return content.entry
    ? buildCollectionEntryFallbackNodes(
        content.collection,
        content.entry,
        content.hostId,
      )
    : buildCollectionListFallbackNodes(
        content.collection,
        content.entries.length > 0,
        content.pagination ?? undefined,
        content.category ?? undefined,
      )
}

export default buildCollectionFallbackNodes
