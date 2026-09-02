/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * The search results page as canvas nodes (AGL-2513) — what a reader can do
 * on it, expressed as a tree the layout can wrap.
 *
 * The assertions are about behavior a reader would notice losing: the query
 * still in the field, the tabs still linking, the empty state still saying
 * which word found nothing. Structure is asserted only where something else
 * depends on it — a slot needs a single root, and the layout graft needs the
 * standard root id.
 */

import * as Aglyn from '@aglyn/aglyn/server'
import { buildSearchResultsNodes } from './search-results-nodes'

const build = (overrides: Partial<Parameters<typeof buildSearchResultsNodes>[0]> = {}) =>
  buildSearchResultsNodes({
    query: 'widgets',
    results: [
      {
        title: 'Blue widgets',
        url: '/blog/blue-widgets',
        snippet: 'Everything about blue widgets.',
        collection: { slug: 'blog', title: 'Blog' },
        date: '12 August 2026',
      },
      { title: 'Widgets', url: '/widgets', snippet: '' },
    ],
    facets: [
      { key: 'all', label: 'All', count: 2 },
      { key: 'blog', label: 'Blog', count: 1 },
    ],
    activeFacet: 'all',
    allFacetKey: 'all',
    ...overrides,
  })

const nodeList = (nodes: Record<string, any>) => Object.values(nodes)
const byComponent = (nodes: Record<string, any>, componentId: string) =>
  nodeList(nodes).filter((node) => node.componentId === componentId)

describe('buildSearchResultsNodes (AGL-2513)', () => {
  it('roots the tree where the layout graft expects it', () => {
    const nodes = build()

    expect(nodes[Aglyn.NODE_ROOT_ID]).toBeDefined()
    expect(nodes[Aglyn.NODE_ROOT_ID].nodes).toHaveLength(1)
  })

  it('keeps the query in the field, so a search can be refined in place', () => {
    const [box] = byComponent(build(), 'searchBox')

    expect(box.props.defaultValue).toBe('widgets')
  })

  it('titles the page with the question the reader asked', () => {
    const heading = byComponent(build(), 'muiTypography').find(
      (node) => node.props.component === 'h1',
    )

    expect(heading.props.children).toBe('Results for “widgets”')
  })

  it('links each count tab with the query and its own facet', () => {
    const links = byComponent(build(), 'muiScreenLink')
    const blog = links.find((node) => node.props.children === 'Blog · 1')
    const all = links.find((node) => node.props.children === 'All · 2')

    expect(blog.props.href).toBe('/search?q=widgets&in=blog')
    // `all` drops the parameter rather than sending `in=all`: the unfiltered
    // view is the page's own address.
    expect(all.props.href).toBe('/search?q=widgets')
  })

  it('marks the active tab as the page rather than a place to go', () => {
    const links = byComponent(build({ activeFacet: 'blog' }), 'muiScreenLink')
    const blog = links.find((node) => node.props.children === 'Blog · 1')
    const all = links.find((node) => node.props.children === 'All · 2')

    expect(blog.props['aria-current']).toBe('page')
    expect(all.props['aria-current']).toBeUndefined()
  })

  it('escapes a query that would otherwise break its own links', () => {
    const links = byComponent(
      build({ query: 'a&b=c d', facets: [{ key: 'blog', label: 'Blog', count: 1 }] }),
      'muiScreenLink',
    )

    expect(links[0].props.href).toBe('/search?q=a%26b%3Dc%20d&in=blog')
  })

  it('drops the tabs when every match came from one place', () => {
    // A lone "All · 6" tab reads as a filter over a list it cannot change.
    const nodes = build({ facets: [] })

    expect(
      nodeList(nodes).some((node) => node.props?.['aria-label']?.includes('Filter')),
    ).toBe(false)
  })

  it('names the word that found nothing', () => {
    const nodes = build({ results: [], facets: [] })

    const empty = byComponent(nodes, 'muiTypography').find((node) =>
      String(node.props.children).includes('Nothing matched'),
    )
    expect(empty.props.children).toContain('widgets')
    expect(byComponent(nodes, 'muiScreenLink')).toHaveLength(0)
  })

  it('invites a first search when there is no query at all', () => {
    const nodes = build({ query: '', results: [], facets: [] })

    const heading = byComponent(nodes, 'muiTypography').find(
      (node) => node.props.component === 'h1',
    )
    expect(heading.props.children).toBe('Search')
    expect(
      byComponent(nodes, 'muiTypography').some((node) =>
        String(node.props.children).includes('Type something above'),
      ),
    ).toBe(true)
  })

  it('gives every result a link, and a meta line only when there is one', () => {
    const nodes = build()
    const links = byComponent(nodes, 'muiScreenLink').filter((node) =>
      String(node.props.href).startsWith('/blog/') ||
      node.props.href === '/widgets',
    )

    expect(links.map((node) => node.props.children)).toEqual([
      'Blue widgets',
      'Widgets',
    ])
    const metas = byComponent(nodes, 'muiTypography').filter(
      (node) => node.props.variant === 'caption',
    )
    // The second result carries neither collection nor date, so it gets no
    // empty line under it.
    expect(metas).toHaveLength(1)
    expect(metas[0].props.children).toBe('Blog · 12 August 2026')
  })

  it('gives every node a parent inside the tree', () => {
    // The graft walks parents; an orphan is how a node ends up rendering
    // nowhere while the tree still looks complete.
    const nodes = build()
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (nodeId === Aglyn.NODE_ROOT_ID) continue
      expect(nodes[(node as any).parentId]).toBeDefined()
    }
  })
})
