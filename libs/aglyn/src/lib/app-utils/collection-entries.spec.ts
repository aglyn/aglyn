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
  collectionTotalPages,
  entryMatchesFilter,
  expandCollectionEntries,
  expandCollectionRelated,
  resolveEntryCategoryName,
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

describe('resolveEntryCategoryName (AGL-582)', () => {
  const categories = [
    { id: 'guides', name: 'Guides' },
    { id: 'news', name: 'Newsroom' },
  ]

  it('resolves categoryId against the taxonomy first', () => {
    expect(
      resolveEntryCategoryName({ categoryId: 'news' }, categories),
    ).toBe('Newsroom')
    // The id lookup wins even when a stale legacy string is present.
    expect(
      resolveEntryCategoryName(
        { categoryId: 'guides', category: 'Old name' },
        categories,
      ),
    ).toBe('Guides')
  })

  it('falls back to the legacy free-typed category', () => {
    expect(
      resolveEntryCategoryName({ category: 'Engineering' }, categories),
    ).toBe('Engineering')
    expect(resolveEntryCategoryName({ category: 'Engineering' })).toBe(
      'Engineering',
    )
    // Unknown id with a legacy string still resolves to the string.
    expect(
      resolveEntryCategoryName(
        { categoryId: 'deleted', category: 'Engineering' },
        categories,
      ),
    ).toBe('Engineering')
  })

  it('resolves to nothing on a miss (deleted category)', () => {
    expect(
      resolveEntryCategoryName({ categoryId: 'deleted' }, categories),
    ).toBeUndefined()
    expect(resolveEntryCategoryName({}, categories)).toBeUndefined()
    expect(resolveEntryCategoryName({ category: '  ' })).toBeUndefined()
  })
})

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

  it('resolves entry.category through the taxonomy (AGL-582)', () => {
    const categories = [{ id: 'guides', name: 'Guides' }]
    // categoryId → display name when the taxonomy is present.
    expect(
      collectionEntryTokens({ categoryId: 'guides' }, 'blog', categories)[
        'entry.category'
      ],
    ).toBe('Guides')
    // Legacy free-typed entries keep rendering with or without it.
    expect(
      collectionEntryTokens({ category: 'Engineering' }, 'blog', categories)[
        'entry.category'
      ],
    ).toBe('Engineering')
    expect(
      collectionEntryTokens({ category: 'Engineering' }, 'blog')[
        'entry.category'
      ],
    ).toBe('Engineering')
    // Absent taxonomy (or a deleted id) empties instead of leaking the id.
    expect(
      collectionEntryTokens({ categoryId: 'guides' }, 'blog')['entry.category'],
    ).toBe('')
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

  it('matches categoryId entries by id OR resolved name (AGL-582)', () => {
    const categories = [{ id: 'guides', name: 'How-to Guides' }]
    const migrated = { categoryId: 'guides' }
    // Filter written against the stable id.
    expect(
      entryMatchesFilter(migrated, { category: 'Guides' }, categories),
    ).toBe(true)
    // Filter written against the display name (case-insensitive).
    expect(
      entryMatchesFilter(migrated, { category: 'how-to guides' }, categories),
    ).toBe(true)
    expect(
      entryMatchesFilter(migrated, { category: 'News' }, categories),
    ).toBe(false)
    // A deleted id still matches by id, but resolves to no name.
    expect(entryMatchesFilter(migrated, { category: 'guides' })).toBe(true)
    expect(entryMatchesFilter(migrated, { category: 'How-to Guides' })).toBe(
      false,
    )
  })
})

describe('collectionTotalPages (AGL-620)', () => {
  it('computes page counts and never drops below 1', () => {
    expect(collectionTotalPages(0, 10)).toBe(1)
    expect(collectionTotalPages(5, 10)).toBe(1)
    expect(collectionTotalPages(10, 10)).toBe(1)
    expect(collectionTotalPages(11, 10)).toBe(2)
    expect(collectionTotalPages(25, 10)).toBe(3)
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

  it('renders one page window with perPage/page (AGL-620)', () => {
    const many = {
      slug: 'blog',
      entries: Array.from({ length: 5 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const pageCount = (n: number) => {
      const nodes = baseNodes()
      nodes['list'].props.perPage = 2
      nodes['list'].props.page = n
      return (
        expandCollectionEntries(nodes, { blog: many }, 'blog')['list']
          .nodes as string[]
      ).length
    }
    expect(pageCount(1)).toBe(2)
    expect(pageCount(2)).toBe(2)
    expect(pageCount(3)).toBe(1) // 5 entries → last page has one
    expect(pageCount(4)).toBe(0) // past the end
  })

  it('perPage takes precedence over entriesLimit (AGL-620)', () => {
    const nodes = baseNodes()
    nodes['list'].props.entriesLimit = 1
    nodes['list'].props.perPage = 5
    nodes['list'].props.page = 1
    // The page window (5) wins over the legacy limit (1): both entries show.
    expect(expandCollectionEntries(nodes, { blog }, 'blog')['list'].nodes).toHaveLength(2)
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

  it('filters and tokenizes categoryId entries via the taxonomy (AGL-582)', () => {
    const source = {
      slug: 'blog',
      categories: [{ id: 'guides', name: 'Guides' }],
      entries: [
        { title: 'New', slug: 'new', categoryId: 'guides' },
        { title: 'Legacy', slug: 'legacy', category: 'Guides' },
        { title: 'Other', slug: 'other', category: 'News' },
      ],
    }
    // filterCategory by display name catches migrated AND legacy entries…
    const byName = baseNodes()
    byName['list'].props.filterCategory = 'guides'
    byName['title'].props.children = '{{entry.category}}'
    const expanded = expandCollectionEntries(byName, { blog: source }, 'blog')
    expect(expanded['list'].nodes).toHaveLength(2)
    // …and the {{entry.category}} token resolves the id to its name.
    const firstTitleId = `${(expanded['list'].nodes as string[])[0].replace(/item$/, '')}title`
    expect(expanded[firstTitleId].props.children).toBe('Guides')

    // filterCategory by stable id keeps matching after a rename.
    const renamed = {
      slug: 'blog',
      categories: [{ id: 'guides', name: 'Playbooks' }],
      entries: [
        { title: 'New', slug: 'new', categoryId: 'guides' },
        { title: 'Other', slug: 'other', category: 'News' },
      ],
    }
    const byId = baseNodes()
    byId['list'].props.filterCategory = 'guides'
    expect(
      expandCollectionEntries(byId, { blog: renamed }, 'blog')['list'].nodes,
    ).toHaveLength(1)
    // …and by the NEW display name too.
    const byNewName = baseNodes()
    byNewName['list'].props.filterCategory = 'Playbooks'
    expect(
      expandCollectionEntries(byNewName, { blog: renamed }, 'blog')['list']
        .nodes,
    ).toHaveLength(1)
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

  it('relates categoryId and legacy entries across the migration (AGL-582)', () => {
    const categories = [{ id: 'guides', name: 'Guides' }]
    const mixed = [
      { $id: 'new', slug: 'new', categoryId: 'guides' },
      { $id: 'legacy', slug: 'legacy', category: 'guides' },
      { $id: 'other', slug: 'other', category: 'News' },
    ]
    // A migrated entry still relates to a legacy free-typed sibling whose
    // string spells the (case-insensitive) taxonomy name…
    expect(
      selectRelatedEntries(mixed, mixed[0], 3, categories).map(
        (entry) => entry.$id,
      ),
    ).toEqual(['legacy'])
    // …and vice versa from the legacy side.
    expect(
      selectRelatedEntries(mixed, mixed[1], 3, categories).map(
        (entry) => entry.$id,
      ),
    ).toEqual(['new'])
  })

  it('relates same-categoryId entries even after the category is deleted', () => {
    const orphaned = [
      { $id: 'a', slug: 'a', categoryId: 'guides' },
      { $id: 'b', slug: 'b', categoryId: 'guides' },
      { $id: 'c', slug: 'c', categoryId: 'news' },
    ]
    // No taxonomy at all: the stable ids still pair the entries up.
    expect(
      selectRelatedEntries(orphaned, orphaned[0], 3).map(
        (entry) => entry.$id,
      ),
    ).toEqual(['b'])
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

  it('stamps taxonomy-resolved category names on related items (AGL-582)', () => {
    const taxonomySource = {
      slug: 'blog',
      categories: [{ id: 'guides', name: 'Guides' }],
      entries: [
        { $id: 'current', slug: 'current', categoryId: 'guides' },
        {
          $id: 'match',
          title: 'Match',
          slug: 'match',
          categoryId: 'guides',
        },
      ],
    }
    const nodes = expandCollectionRelated(
      relatedNodes(),
      taxonomySource,
      taxonomySource.entries[0],
    )
    expect(nodes['related'].props.entries).toEqual([
      { title: 'Match', url: '/blog/match', category: 'Guides' },
    ])
  })
})
