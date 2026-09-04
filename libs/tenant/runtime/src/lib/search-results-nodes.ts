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
 * The site-search results page as canvas nodes (AGL-2513).
 *
 * ## Why nodes and not the React component it replaces
 *
 * `/search` rendered a bare MUI `Container` — no header, no nav, no footer —
 * because a React body has nowhere to sit inside a designed layout: the
 * layout's slot is filled at COMPOSE time, with nodes. Every other built-in
 * page that wanted the site's chrome hit the same wall and answered it the
 * same way; `collection-fallback-nodes.ts` (AGL-551) is the precedent this
 * file follows, down to the synthetic id prefix.
 *
 * Building the body as nodes puts search on the one render path everything
 * else uses — the site's theme, its shared layout, its nav and footer, its
 * plugin runtimes — instead of a second, chrome-less one that had to be kept
 * in step by hand.
 *
 * Ids are synthetic and NEVER persisted; the `srx__` prefix keeps them out of
 * every id space an author's document uses.
 */

const ID_PREFIX = 'srx__'
const id = (suffix: string) => `${ID_PREFIX}${suffix}`

type NodesMap = Record<string, Aglyn.AglynNodeSchema>

export interface SearchResultsNode {
  title: string
  url: string
  snippet: string
  collection?: { slug: string; title: string }
  date?: string
}

export interface SearchFacetNode {
  key: string
  label: string
  count: number
}

export interface SearchResultsNodesOptions {
  query: string
  results: readonly SearchResultsNode[]
  facets: readonly SearchFacetNode[]
  /** The `?in=` facet in force; `all` (or absent) is the unfiltered view. */
  activeFacet: string
  /** `all` — passed in so the tenant's route table stays the one source. */
  allFacetKey: string
}

const facetHref = (query: string, key: string, allKey: string) =>
  key === allKey
    ? `/search?q=${encodeURIComponent(query)}`
    : `/search?q=${encodeURIComponent(query)}&in=${encodeURIComponent(key)}`

/**
 * The results page's node tree, root first. Grafted into a layout's slot by
 * `composeNodesWithChrome`, exactly like a screen's own nodes.
 */
export function buildSearchResultsNodes(
  options: SearchResultsNodesOptions,
): NodesMap {
  const { query, results, facets, activeFacet, allFacetKey } = options
  const nodes: NodesMap = {}
  const stackChildren: string[] = []

  const push = (
    nodeId: string,
    parentId: string,
    node: Omit<Aglyn.AglynNodeSchema, '$id' | 'parentId'>,
  ) => {
    nodes[nodeId] = { $id: nodeId, parentId, ...node } as Aglyn.AglynNodeSchema
    return nodeId
  }

  nodes[Aglyn.NODE_ROOT_ID] = {
    $id: Aglyn.NODE_ROOT_ID,
    componentId: 'div',
    nodes: [id('container')],
  } as Aglyn.AglynNodeSchema
  push(id('container'), Aglyn.NODE_ROOT_ID, {
    componentId: 'muiContainer',
    pluginId: 'mui',
    // `lg`, not the `md` a collection article takes: a result list is a list,
    // not a prose measure, and the count tabs wrap early at `md`.
    props: { maxWidth: 'lg', sx: { paddingTop: 6, paddingBottom: 8 } },
    nodes: [id('stack')],
  })
  push(id('stack'), id('container'), {
    componentId: 'muiStack',
    pluginId: 'mui',
    props: { spacing: 4 },
    nodes: stackChildren,
  })

  // Heading block: the eyebrow and the question the reader asked.
  push(id('head'), id('stack'), {
    componentId: 'muiStack',
    pluginId: 'mui',
    props: { spacing: 1 },
    nodes: [id('eyebrow'), id('title')],
  })
  stackChildren.push(id('head'))
  push(id('eyebrow'), id('head'), {
    componentId: 'muiTypography',
    pluginId: 'mui',
    props: {
      variant: 'overline',
      children: 'SEARCH',
      sx: { color: 'text.secondary', letterSpacing: '0.12em' },
    },
  })
  push(id('title'), id('head'), {
    componentId: 'muiTypography',
    pluginId: 'mui',
    props: {
      variant: 'h3',
      component: 'h1',
      children: query ? `Results for “${query}”` : 'Search',
    },
  })

  // The field stays on the page, prefilled. A results page that cannot be
  // refined without going back is a dead end — and `?in=` is deliberately not
  // carried into it: a new query is a new question, and silently keeping the
  // old collection filter is how a reader ends up staring at "no results" for
  // a term the site does match.
  // The width lives on a wrapper, not on the box itself: `searchBox` spreads
  // its remaining props onto a plain `<form>`, so an `sx` handed to it would
  // reach the DOM as an unknown attribute rather than as a style.
  push(id('form'), id('stack'), {
    componentId: 'muiBox',
    pluginId: 'mui',
    props: { sx: { maxWidth: 560 } },
    nodes: [id('form-box')],
  })
  stackChildren.push(id('form'))
  push(id('form-box'), id('form'), {
    componentId: 'searchBox',
    pluginId: 'mui',
    props: { placeholder: 'Search this site…', defaultValue: query },
  })

  // Count tabs. `searchResultFacets` returns nothing when every match came
  // from one place — a lone "All · 6" tab reads as a filter over a list it
  // cannot change.
  if (facets.length) {
    const facetIds = facets.map((facet) => id(`facet-${facet.key}`))
    push(id('facets'), id('stack'), {
      componentId: 'muiStack',
      pluginId: 'mui',
      props: {
        direction: 'row',
        spacing: 1,
        component: 'nav',
        'aria-label': 'Filter results by section',
        sx: { flexWrap: 'wrap', rowGap: 1 },
      },
      nodes: facetIds,
    })
    stackChildren.push(id('facets'))
    for (const facet of facets) {
      const active = facet.key === activeFacet
      push(id(`facet-${facet.key}`), id('facets'), {
        componentId: 'muiScreenLink',
        pluginId: 'mui',
        props: {
          element: 'a',
          href: facetHref(query, facet.key, allFacetKey),
          size: 'small',
          variant: active ? 'contained' : 'outlined',
          // `muiScreenLink` is a MUI Button, and a Button uppercases its
          // label. A count tab is a label, not a call to action.
          sx: { textTransform: 'none' },
          // The active tab is the one the list is showing, so it is state, not
          // navigation to somewhere else.
          'aria-current': active ? 'page' : undefined,
          children: `${facet.label} · ${facet.count}`,
        },
      })
    }
  }

  if (!results.length) {
    push(id('empty'), id('stack'), {
      componentId: 'muiTypography',
      pluginId: 'mui',
      props: {
        variant: 'body1',
        sx: { color: 'text.secondary' },
        children: query
          ? `Nothing matched “${query}”. Try a different word, or fewer of them.`
          : 'Type something above to search this site.',
      },
    })
    stackChildren.push(id('empty'))
    return nodes
  }

  const resultIds: string[] = []
  push(id('results'), id('stack'), {
    componentId: 'muiStack',
    pluginId: 'mui',
    props: { spacing: 3, component: 'ul', sx: { listStyle: 'none', p: 0, m: 0 } },
    nodes: resultIds,
  })
  stackChildren.push(id('results'))

  results.forEach((result, index) => {
    const itemId = id(`item-${index}`)
    const children = [id(`item-${index}-link`)]
    resultIds.push(itemId)
    push(itemId, id('results'), {
      componentId: 'muiStack',
      pluginId: 'mui',
      props: { spacing: 0.5, component: 'li' },
      nodes: children,
    })
    push(id(`item-${index}-link`), itemId, {
      componentId: 'muiScreenLink',
      pluginId: 'mui',
      props: {
        element: 'a',
        href: result.url,
        variant: 'text',
        sx: {
          p: 0,
          justifyContent: 'flex-start',
          textAlign: 'left',
          // Same Button inheritance as the tabs above, and it matters more
          // here: a result's title is the author's own words, and the
          // uppercase default reprints every one of them shouting.
          textTransform: 'none',
          fontSize: '1.0625rem',
          fontWeight: 600,
        },
        children: result.title,
      },
    })
    // The meta line is one string rather than a row of nodes: it is read as a
    // sentence ("Blog · 12 August 2026"), and a wrapping row of separate
    // elements breaks it in the middle on a phone.
    const meta = [result.collection?.title, result.date]
      .filter(Boolean)
      .join(' · ')
    if (meta) {
      const metaId = id(`item-${index}-meta`)
      children.push(metaId)
      push(metaId, itemId, {
        componentId: 'muiTypography',
        pluginId: 'mui',
        props: {
          variant: 'caption',
          sx: { color: 'text.secondary' },
          children: meta,
        },
      })
    }
    if (result.snippet) {
      const snippetId = id(`item-${index}-snippet`)
      children.push(snippetId)
      push(snippetId, itemId, {
        componentId: 'muiTypography',
        pluginId: 'mui',
        props: {
          variant: 'body2',
          sx: { color: 'text.secondary' },
          children: result.snippet,
        },
      })
    }
  })

  return nodes
}

export default buildSearchResultsNodes
