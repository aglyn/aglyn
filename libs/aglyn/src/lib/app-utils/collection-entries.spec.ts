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

import {
  collectionEntryTokens,
  entryMatchesFilter,
  expandCollectionEntries,
  expandCollectionRelated,
  selectRelatedEntries,
} from './collection-entries'

const baseNodes = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['list'] },
    list: {
      $id: 'list',
      componentId: 'collectionEntries',
      parentId: 'root',
      props: {},
      nodes: ['item'],
    },
    item: {
      $id: 'item',
      componentId: 'muiStack',
      parentId: 'list',
      props: {},
      nodes: ['title', 'link'],
    },
    title: {
      $id: 'title',
      componentId: 'muiTypography',
      parentId: 'item',
      props: { children: '{{entry.title}} — {{entry.date}}' },
    },
    link: {
      $id: 'link',
      componentId: 'muiScreenLink',
      parentId: 'item',
      props: { children: 'Read more', href: '{{entry.url}}' },
    },
  }) as any

const blog = {
  slug: 'blog',
  entries: [
    {
      $id: 'e1',
      title: 'Hello world',
      slug: 'hello-world',
      excerpt: 'First post',
      publishedAt: { seconds: 1_700_000_000 },
    },
    { $id: 'e2', title: 'Second', slug: 'second', excerpt: '' },
  ],
}

describe('collectionEntryTokens (AGL-551)', () => {
  it('exposes title/excerpt/body/slug/url/date tokens', () => {
    const tokens = collectionEntryTokens(
      {
        title: 'Hello',
        slug: 'hello',
        excerpt: 'Hi',
        body: '# Body',
        publishedAt: { seconds: 1_700_000_000 },
      },
      'blog',
    )
    expect(tokens['entry.title']).toBe('Hello')
    expect(tokens['entry.excerpt']).toBe('Hi')
    expect(tokens['entry.body']).toBe('# Body')
    expect(tokens['entry.slug']).toBe('hello')
    expect(tokens['entry.url']).toBe('/blog/hello')
    expect(tokens['entry.date']).toBe(
      new Date(1_700_000_000 * 1000).toLocaleDateString(),
    )
  })

  it('empties missing fields instead of leaving tokens literal', () => {
    const tokens = collectionEntryTokens({}, 'blog')
    expect(tokens['entry.title']).toBe('')
    expect(tokens['entry.date']).toBe('')
    expect(tokens['entry.url']).toBe('/blog/')
    expect(tokens['entry.category']).toBe('')
    expect(tokens['entry.tags']).toBe('')
    expect(tokens['entry.seoTitle']).toBe('')
    expect(tokens['entry.seoDescription']).toBe('')
  })

  it('exposes category/tags and SEO tokens with fallbacks (AGL-582)', () => {
    const tokens = collectionEntryTokens(
      {
        title: 'Hello',
        excerpt: 'Hi',
        category: 'Engineering',
        tags: ['nextjs', 'seo'],
      },
      'blog',
    )
    expect(tokens['entry.category']).toBe('Engineering')
    expect(tokens['entry.tags']).toBe('nextjs, seo')
    // No explicit SEO fields → the pair falls back to title/excerpt.
    expect(tokens['entry.seoTitle']).toBe('Hello')
    expect(tokens['entry.seoDescription']).toBe('Hi')
    const explicit = collectionEntryTokens(
      { title: 'Hello', seoTitle: 'SEO', seoDescription: 'Meta' },
      'blog',
    )
    expect(explicit['entry.seoTitle']).toBe('SEO')
    expect(explicit['entry.seoDescription']).toBe('Meta')
  })
})

describe('entryMatchesFilter (AGL-582)', () => {
  const entry = { category: 'Engineering', tags: ['NextJS', 'seo'] }

  it('matches category and tags case-insensitively', () => {
    expect(entryMatchesFilter(entry, { category: 'engineering' })).toBe(true)
    expect(entryMatchesFilter(entry, { tag: 'nextjs' })).toBe(true)
    expect(entryMatchesFilter(entry, { category: 'Design' })).toBe(false)
    expect(entryMatchesFilter(entry, { tag: 'design' })).toBe(false)
  })

  it('requires every provided filter to match', () => {
    expect(
      entryMatchesFilter(entry, { category: 'Engineering', tag: 'seo' }),
    ).toBe(true)
    expect(
      entryMatchesFilter(entry, { category: 'Engineering', tag: 'x' }),
    ).toBe(false)
    expect(entryMatchesFilter(entry, {})).toBe(true)
  })
})

describe('expandCollectionEntries (AGL-551)', () => {
  it('clones the template once per entry with per-entry tokens', () => {
    const nodes = expandCollectionEntries(baseNodes(), { blog }, 'blog')
    const childIds = nodes['list'].nodes as string[]
    expect(childIds).toHaveLength(2)
    expect(nodes[childIds[0]].parentId).toBe('list')
    const firstTitleId = `${childIds[0].replace(/item$/, '')}title`
    expect(nodes[firstTitleId].props.children).toBe(
      `Hello world — ${new Date(1_700_000_000 * 1000).toLocaleDateString()}`,
    )
    const firstLinkId = `${childIds[0].replace(/item$/, '')}link`
    expect(nodes[firstLinkId].props.href).toBe('/blog/hello-world')
    const secondTitleId = `${childIds[1].replace(/item$/, '')}title`
    expect(nodes[secondTitleId].props.children).toBe('Second — ')
  })

  it('resolves an explicit collectionSlug prop over the routed default', () => {
    const nodes = baseNodes()
    nodes['list'].props.collectionSlug = 'news'
    const news = {
      slug: 'news',
      entries: [{ title: 'Launch', slug: 'launch' }],
    }
    const expanded = expandCollectionEntries(nodes, { blog, news }, 'blog')
    const childIds = expanded['list'].nodes as string[]
    expect(childIds).toHaveLength(1)
    const linkId = `${childIds[0].replace(/item$/, '')}link`
    expect(expanded[linkId].props.href).toBe('/news/launch')
  })

  it('caps clones at entriesLimit', () => {
    const nodes = baseNodes()
    nodes['list'].props.entriesLimit = 1
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(expanded['list'].nodes).toHaveLength(1)
  })

  it('fails open when the collection is unknown or empty', () => {
    const untouched = baseNodes()
    expect(expandCollectionEntries(untouched, {}, 'blog')).toEqual(untouched)
    const empty = expandCollectionEntries(
      baseNodes(),
      { blog: { slug: 'blog', entries: [] } },
      'blog',
    )
    expect(empty['list'].nodes).toEqual(['item'])
  })

  it('never mutates the input map', () => {
    const nodes = baseNodes()
    const snapshot = JSON.parse(JSON.stringify(nodes))
    expandCollectionEntries(nodes, { blog }, 'blog')
    expect(nodes).toEqual(snapshot)
  })

  it('filters clones by filterCategory/filterTag props (AGL-582)', () => {
    const tagged = {
      slug: 'blog',
      entries: [
        { title: 'A', slug: 'a', category: 'News', tags: ['x'] },
        { title: 'B', slug: 'b', category: 'Guides', tags: ['x', 'y'] },
        { title: 'C', slug: 'c', category: 'Guides', tags: [] },
      ],
    }
    const byCategory = baseNodes()
    byCategory['list'].props.filterCategory = 'guides'
    const categoryExpanded = expandCollectionEntries(
      byCategory,
      { blog: tagged },
      'blog',
    )
    expect(categoryExpanded['list'].nodes).toHaveLength(2)

    const byTag = baseNodes()
    byTag['list'].props.filterTag = 'y'
    const tagExpanded = expandCollectionEntries(byTag, { blog: tagged }, 'blog')
    expect(tagExpanded['list'].nodes).toHaveLength(1)
    const onlyChild = (tagExpanded['list'].nodes as string[])[0]
    const linkId = `${onlyChild.replace(/item$/, '')}link`
    expect(tagExpanded[linkId].props.href).toBe('/blog/b')

    // No matches renders an empty block, not the literal template.
    const noMatch = baseNodes()
    noMatch['list'].props.filterTag = 'missing'
    expect(
      expandCollectionEntries(noMatch, { blog: tagged }, 'blog')['list'].nodes,
    ).toEqual([])
  })
})

describe('selectRelatedEntries (AGL-582)', () => {
  const entries = [
    {
      $id: 'current',
      title: 'Current',
      slug: 'current',
      category: 'Guides',
      tags: ['nextjs'],
      publishedAt: { seconds: 400 },
    },
    {
      $id: 'a',
      title: 'Same category',
      slug: 'a',
      category: 'Guides',
      publishedAt: { seconds: 100 },
    },
    {
      $id: 'b',
      title: 'Shared tag',
      slug: 'b',
      category: 'News',
      tags: ['NextJS', 'seo'],
      publishedAt: { seconds: 300 },
    },
    {
      $id: 'c',
      title: 'Unrelated',
      slug: 'c',
      category: 'News',
      tags: ['design'],
      publishedAt: { seconds: 200 },
    },
  ]
  const current = entries[0]

  it('picks entries sharing category or a tag, newest first', () => {
    const related = selectRelatedEntries(entries, current)
    expect(related.map((entry) => entry.$id)).toEqual(['b', 'a'])
  })

  it('never returns the current entry and honors the limit', () => {
    const related = selectRelatedEntries(entries, current, 1)
    expect(related.map((entry) => entry.$id)).toEqual(['b'])
    expect(related.some((entry) => entry.$id === 'current')).toBe(false)
  })

  it('returns nothing for an entry with no category or tags', () => {
    expect(selectRelatedEntries(entries, { $id: 'x', slug: 'x' })).toEqual([])
  })
})

describe('expandCollectionRelated (AGL-582)', () => {
  const relatedNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['related'] },
      related: {
        $id: 'related',
        componentId: 'collectionRelated',
        parentId: 'root',
        props: { heading: 'Related articles' },
      },
    }) as any
  const source = {
    slug: 'blog',
    entries: [
      {
        $id: 'current',
        title: 'Current',
        slug: 'current',
        tags: ['x'],
      },
      {
        $id: 'match',
        title: 'Match',
        slug: 'match',
        excerpt: 'A match',
        category: 'News',
        tags: ['x'],
        publishedAt: { seconds: 1_700_000_000 },
      },
    ],
  }

  it('stamps related items as a serializable entries prop', () => {
    const nodes = expandCollectionRelated(
      relatedNodes(),
      source,
      source.entries[0],
    )
    expect(nodes['related'].props.entries).toEqual([
      {
        title: 'Match',
        url: '/blog/match',
        date: new Date(1_700_000_000 * 1000).toLocaleDateString(),
        excerpt: 'A match',
        category: 'News',
      },
    ])
    expect(nodes['related'].props.heading).toBe('Related articles')
  })

  it('leaves nodes untouched without an entry context and never mutates', () => {
    const untouched = relatedNodes()
    const snapshot = JSON.parse(JSON.stringify(untouched))
    expect(expandCollectionRelated(untouched, source, null)).toEqual(snapshot)
    expect(expandCollectionRelated(untouched, undefined, source.entries[0]))
      .toEqual(snapshot)
    expandCollectionRelated(untouched, source, source.entries[0])
    expect(untouched).toEqual(snapshot)
  })
})
