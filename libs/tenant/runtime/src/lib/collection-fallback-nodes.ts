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
  if (entry.coverImage && /^https?:\/\//i.test(entry.coverImage)) {
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
            backgroundImage: `url("${encodeURI(entry.coverImage)}")`,
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

/** Prev/next + "Page X of Y" nav linking to /{slug}/page/{n} (AGL-620). */
function paginationNodes(
  collection: FallbackCollection,
  pagination: FallbackListPagination,
): { childId: string; nodes: NodesMap } {
  const { page, totalPages } = pagination
  // Page 1 lives at the bare /{slug}; deeper pages at /{slug}/page/{n}.
  const href = (n: number) =>
    n <= 1 ? `/${collection.slug}` : `/${collection.slug}/page/${n}`
  const children: string[] = []
  const nodes: NodesMap = {}
  if (page > 1) {
    nodes[id('prev')] = {
      $id: id('prev'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('pager'),
      props: { href: href(page - 1), children: '← Newer' },
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
  if (page < totalPages) {
    nodes[id('next')] = {
      $id: id('next'),
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      parentId: id('pager'),
      props: { href: href(page + 1), children: 'Older →' },
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
): NodesMap {
  const [titleId, title] = typography('title', {
    variant: 'h3',
    component: 'h1',
    children: collection.displayName,
  })
  if (!hasEntries) {
    const [emptyId, empty] = typography('empty', {
      variant: 'body1',
      children: 'Nothing published yet.',
      sx: { color: 'text.secondary' },
    })
    return {
      ...shell([titleId, emptyId]),
      [titleId]: title,
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
      ? paginationNodes(collection, pagination)
      : null
  return {
    ...shell(
      pager ? [titleId, id('entries'), pager.childId] : [titleId, id('entries')],
    ),
    [titleId]: title,
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
}): NodesMap {
  return content.entry
    ? buildCollectionEntryFallbackNodes(content.collection, content.entry)
    : buildCollectionListFallbackNodes(
        content.collection,
        content.entries.length > 0,
        content.pagination ?? undefined,
      )
}

export default buildCollectionFallbackNodes
