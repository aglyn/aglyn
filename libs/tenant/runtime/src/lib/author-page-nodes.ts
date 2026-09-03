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

/**
 * The built-in author page as canvas nodes (AGL-2518).
 *
 * A designated template screen is the intended way to build this page, and
 * this is what renders when a site has not designated one — which is every
 * site on the day the feature ships, and every site that never designates one.
 * It cannot be optional: bylines link here, so the address has to answer.
 *
 * The `collection-fallback-nodes.ts` precedent (AGL-551), down to the
 * synthetic id prefix — building the body as NODES rather than as React is
 * what lets it sit inside the site's shared layout, on the same render path
 * as everything else, instead of on a second chrome-less one.
 *
 * Ids are synthetic and NEVER persisted; the `apx__` prefix keeps them out of
 * every id space an author's document uses.
 */

const ID_PREFIX = 'apx__'
const id = (suffix: string) => `${ID_PREFIX}${suffix}`

type NodesMap = Record<string, Aglyn.AglynNodeSchema>

export interface AuthorPageNodesOptions {
  /** The addressed segment, for building this page's own pager links. */
  slug: string
  /** The byline — the record's name, or the raw segment for an unknown one. */
  name: string
  /** The record, when the slug named one. */
  author?: Aglyn.ContentAuthorRecord | null
  hasEntries: boolean
  page: number
  perPage: number
  totalPages: number
}

/**
 * The author page's node tree, root first. Grafted into a layout's slot by
 * `composeNodesWithChrome`, exactly like a screen's own nodes.
 */
export function buildAuthorPageNodes(
  options: AuthorPageNodesOptions,
): NodesMap {
  const { slug, name, author, hasEntries, page, perPage, totalPages } = options
  const nodes: NodesMap = {}
  const stackChildren: string[] = []

  const push = (
    nodeId: string,
    parentId: string,
    node: Omit<Aglyn.AglynNodeSchema, '$id' | 'parentId'>,
  ) => {
    nodes[nodeId] = { $id: nodeId, parentId, ...node } as Aglyn.AglynNodeSchema
    stackChildren.push(nodeId)
    return nodeId
  }

  nodes[Aglyn.NODE_ROOT_ID] = {
    $id: Aglyn.NODE_ROOT_ID,
    componentId: 'div',
    nodes: [id('container')],
  } as Aglyn.AglynNodeSchema
  nodes[id('container')] = {
    $id: id('container'),
    parentId: Aglyn.NODE_ROOT_ID,
    componentId: 'muiContainer',
    pluginId: 'mui',
    // `md`, as a collection article takes: this page is a profile above a
    // reading list, not a dense grid.
    props: { maxWidth: 'md', sx: { paddingTop: 6, paddingBottom: 8 } },
    nodes: [id('stack')],
  } as Aglyn.AglynNodeSchema
  nodes[id('stack')] = {
    $id: id('stack'),
    parentId: id('container'),
    componentId: 'muiStack',
    pluginId: 'mui',
    props: { spacing: 5 },
    nodes: stackChildren,
  } as Aglyn.AglynNodeSchema

  /*
    The profile. Props are set from the record HERE rather than left to
    `expandContentAuthorProfile`, because this body is built with the record
    already in hand — the expansion exists for a designed template, where the
    block was placed long before any author was routed through it.

    `name` falls back to the raw segment so an unknown slug still renders a
    page with a heading on it, which is the same "empty archive, not a crash"
    the category route settled on.
  */
  push(id('profile'), id('stack'), {
    componentId: Aglyn.CONTENT_AUTHOR_PROFILE_COMPONENT_ID,
    pluginId: 'mui',
    props: {
      name: name || author?.name || '',
      ...(author?.bio ? { bio: author.bio } : {}),
      ...(author?.image ? { image: author.image } : {}),
      ...(author?.jobTitle ? { jobTitle: author.jobTitle } : {}),
      ...(author?.worksFor ? { worksFor: author.worksFor } : {}),
      ...(author?.url ? { url: author.url } : {}),
      ...(author?.links?.length ? { links: author.links } : {}),
    },
  })

  if (!hasEntries) {
    push(id('empty'), id('stack'), {
      componentId: 'muiTypography',
      pluginId: 'mui',
      props: {
        variant: 'body1',
        // Named, not "This author has published nothing" — the page is about
        // a person, and the sentence should read like one.
        children: `${name} hasn’t published anything yet.`,
        sx: { color: 'text.secondary' },
      },
    })
    return nodes
  }

  push(id('heading'), id('stack'), {
    componentId: 'muiTypography',
    pluginId: 'mui',
    props: {
      variant: 'h5',
      // `h2`: the Author Profile block above owns the page's `h1`.
      component: 'h2',
      children: `Posts by ${name}`,
    },
  })

  /*
    The entries block, over the author's OWN entries.

    `page`/`perPage` are pinned rather than inherited, because the routed
    "collection" here is synthetic (`AUTHOR_ENTRIES_SOURCE_SLUG`) and the
    window the loader already computed is the one this page is paging.

    Each card labels which section its post came from — the one thing a
    single-collection listing never has to say and a cross-collection one
    always does. `{{entry.collection}}` is empty on every other listing, so
    the same card template is correct everywhere.
  */
  push(id('entries'), id('stack'), {
    componentId: Aglyn.COLLECTION_ENTRIES_COMPONENT_ID,
    pluginId: 'mui',
    props: { spacing: 4, perPage, page },
    nodes: [id('item')],
  })
  nodes[id('item')] = {
    $id: id('item'),
    parentId: id('entries'),
    componentId: 'muiStack',
    pluginId: 'mui',
    props: { spacing: 0.5 },
    nodes: [
      id('item-collection'),
      id('item-title'),
      id('item-date'),
      id('item-excerpt'),
      id('item-link'),
    ],
  } as Aglyn.AglynNodeSchema
  const item = (
    suffix: string,
    props: Record<string, unknown>,
    componentId = 'muiTypography',
  ) => {
    nodes[id(suffix)] = {
      $id: id(suffix),
      parentId: id('item'),
      componentId,
      pluginId: 'mui',
      props,
    } as Aglyn.AglynNodeSchema
  }
  /*
    The collection and the date are two NODES, not one string joined by a
    middle dot.

    A `·` written into the template is a literal, and a token beside it is
    not: an entry that is live with no `publishedAt` — a legacy post, or one
    flipped due without a timestamp — would render `Blog · ` with the
    separator dangling off the end. The joined form is right where the values
    are computed together and the empty ones can be dropped (Entry Meta does
    exactly that); it is wrong in a template, which has no conditional and
    substitutes each token independently.

    Stacked rather than in a row for the same reason, and it puts the card on
    the collection fallback's own shape (AGL-551) — one extra line above it,
    nothing else different.
  */
  item('item-collection', {
    variant: 'overline',
    children: '{{entry.collection}}',
    sx: { color: 'text.secondary' },
  })
  item('item-title', {
    variant: 'h6',
    component: 'h3',
    children: '{{entry.title}}',
  })
  item('item-date', {
    variant: 'caption',
    children: '{{entry.date}}',
    sx: { color: 'text.secondary' },
  })
  item('item-excerpt', { variant: 'body1', children: '{{entry.excerpt}}' })
  item(
    'item-link',
    {
      href: '{{entry.url}}',
      children: 'Read more',
      size: 'small',
      sx: { alignSelf: 'flex-start' },
    },
    'muiScreenLink',
  )

  if (totalPages > 1) {
    // Through the shared pager computation, so this fallback and the
    // `{{pagination.*}}` tokens a designed template binds cannot disagree
    // about which page they are on. An edge is the empty string, which is
    // exactly the "no link here" this body already meant.
    const pager = Aglyn.contentAuthorPaginationLinks({
      ...(author ? { author } : { authorName: slug }),
      page,
      totalPages,
    })
    const pagerChildren: string[] = []
    const pagerLink = (suffix: string, href: string, label: string) => {
      nodes[id(suffix)] = {
        $id: id(suffix),
        parentId: id('pager'),
        componentId: 'muiScreenLink',
        pluginId: 'mui',
        props: { href, children: label },
      } as Aglyn.AglynNodeSchema
      pagerChildren.push(id(suffix))
    }
    if (pager.prevUrl) pagerLink('prev', pager.prevUrl, '← Newer')
    nodes[id('pageinfo')] = {
      $id: id('pageinfo'),
      parentId: id('pager'),
      componentId: 'muiTypography',
      pluginId: 'mui',
      props: {
        variant: 'body2',
        children: `Page ${pager.page} of ${pager.totalPages}`,
        sx: { color: 'text.secondary' },
      },
    } as Aglyn.AglynNodeSchema
    pagerChildren.push(id('pageinfo'))
    if (pager.nextUrl) pagerLink('next', pager.nextUrl, 'Older →')
    push(id('pager'), id('stack'), {
      componentId: 'muiStack',
      pluginId: 'mui',
      props: {
        direction: 'row',
        spacing: 3,
        sx: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
      },
      nodes: pagerChildren,
    })
  }

  return nodes
}

export default buildAuthorPageNodes
