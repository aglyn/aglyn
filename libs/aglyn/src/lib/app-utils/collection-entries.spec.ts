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

import type {
  CollectionEntriesSource,
  CollectionEntrySearchItem,
} from './collection-entries'
import {
  COLLECTION_ALL_PILL_DEFAULT,
  COLLECTION_ALL_PILL_NONE,
  COLLECTION_ENTRIES_COMPONENT_ID,
  COLLECTION_ENTRIES_MAX,
  COLLECTION_ENTRIES_NODE_ID_PREFIX,
  COLLECTION_ENTRY_DATE_FORMAT_DEFAULT,
  COLLECTION_ENTRY_DATE_FORMAT_OPTIONS,
  COLLECTION_SEARCH_COMPONENT_ID,
  COLLECTION_SOURCE_MAX,
  buildCollectionCategoryLinks,
  collectionCategorySlug,
  collectionSourceIsBounded,
  collectionSourceReachedBound,
  collectionEntryAuthorValues,
  collectionEntryMetaValues,
  collectionEntryTokens,
  collectionListUrl,
  collectionPaginationLinks,
  collectionTotalPages,
  entryMatchesCategoryRoute,
  entryMatchesFilter,
  expandCollectionCategories,
  expandCollectionEntries,
  expandCollectionEntryAuthor,
  expandCollectionEntryMeta,
  expandCollectionRelated,
  expandCollectionSearch,
  formatCollectionEntryDate,
  buildCollectionSearchIndex,
  parseCollectionRoute,
  resolveCollectionAllLabel,
  resolveCollectionCategoryBySlug,
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
    // Through the shared formatter, not a bare `toLocaleDateString()`: the
    // contract is that the token carries what the ONE formatter produces
    // (AGL-1926). Written the old way this asserted only that two calls on
    // the developer's machine agreed, and went red in any zone that moved
    // the instant across midnight.
    expect(tokens['entry.date']).toBe(
      formatCollectionEntryDate({ seconds: 1_700_000_000 }),
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

/* ── Category routes (AGL-1321) ─────────────────────────────────────────── */

const taxonomy = [
  { id: 'product', name: 'Product' },
  { id: 'opensrc', name: 'Open source' },
]

describe('parseCollectionRoute (AGL-1321)', () => {
  it('reads every listing and entry shape', () => {
    expect(parseCollectionRoute(['blog'])).toEqual({
      collectionSlug: 'blog',
      page: 1,
    })
    expect(parseCollectionRoute(['blog', 'hello'])).toEqual({
      collectionSlug: 'blog',
      entrySlug: 'hello',
      page: 1,
    })
    expect(parseCollectionRoute(['blog', 'page', '3'])).toEqual({
      collectionSlug: 'blog',
      page: 3,
    })
    expect(parseCollectionRoute(['blog', 'category', 'product'])).toEqual({
      collectionSlug: 'blog',
      categorySlug: 'product',
      page: 1,
    })
    expect(
      parseCollectionRoute(['blog', 'category', 'open-source', 'page', '2']),
    ).toEqual({
      collectionSlug: 'blog',
      categorySlug: 'open-source',
      page: 2,
    })
  })

  it('refuses everything else so the caller falls through to 404', () => {
    expect(parseCollectionRoute([])).toBeNull()
    expect(parseCollectionRoute(['blog', 'page', '0'])).toBeNull()
    expect(parseCollectionRoute(['blog', 'page', 'two'])).toBeNull()
    expect(parseCollectionRoute(['blog', 'category', 'x', 'page', '0'])).toBeNull()
    expect(parseCollectionRoute(['blog', 'category', 'x', 'y'])).toBeNull()
    expect(parseCollectionRoute(['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull()
  })

  it('reserves page/category only as the HEAD of a longer path', () => {
    // An entry legitimately slugged "category" or "page" keeps its URL —
    // reserving the words outright would silently 404 published articles.
    expect(parseCollectionRoute(['blog', 'category'])).toEqual({
      collectionSlug: 'blog',
      entrySlug: 'category',
      page: 1,
    })
    expect(parseCollectionRoute(['blog', 'page'])).toEqual({
      collectionSlug: 'blog',
      entrySlug: 'page',
      page: 1,
    })
  })
})

describe('collectionListUrl (AGL-1321)', () => {
  it('makes the bare collection the canonical unfiltered URL', () => {
    // "All" is /blog — never /blog/category/all, never ?category=all.
    expect(collectionListUrl({ collectionSlug: 'blog' })).toBe('/blog')
    expect(collectionListUrl({ collectionSlug: 'blog', page: 1 })).toBe('/blog')
    expect(
      collectionListUrl({ collectionSlug: 'blog', categorySlug: null, page: 1 }),
    ).toBe('/blog')
  })

  it('composes category and page into one path', () => {
    expect(collectionListUrl({ collectionSlug: 'blog', page: 2 })).toBe(
      '/blog/page/2',
    )
    expect(
      collectionListUrl({ collectionSlug: 'blog', categorySlug: 'Open source' }),
    ).toBe('/blog/category/open-source')
    expect(
      collectionListUrl({
        collectionSlug: 'blog',
        categorySlug: 'product',
        page: 3,
      }),
    ).toBe('/blog/category/product/page/3')
  })

  it('gives every category a DISTINCT path — the ISR cache key', () => {
    const urls = ['product', 'opensrc', 'guides'].map((categorySlug) =>
      collectionListUrl({ collectionSlug: 'blog', categorySlug }),
    )
    expect(new Set([...urls, '/blog']).size).toBe(4)
  })
})

describe('collectionPaginationLinks (AGL-1386)', () => {
  it('resolves BOTH URLs to the empty string on a single-page listing', () => {
    // The whole point: /blog/category/open-source has exactly one page, and a
    // template that binds prevUrl/nextUrl unconditionally must render inert
    // placeholders there rather than an "Older →" onto a page that isn't.
    expect(
      collectionPaginationLinks({
        collectionSlug: 'blog',
        categorySlug: 'open-source',
        page: 1,
        totalPages: 1,
      }),
    ).toEqual({ page: 1, totalPages: 1, prevUrl: '', nextUrl: '' })
  })

  it('empties only the edge it is at, never both, mid-set', () => {
    expect(
      collectionPaginationLinks({
        collectionSlug: 'blog',
        page: 1,
        totalPages: 3,
      }),
    ).toEqual({
      page: 1,
      totalPages: 3,
      prevUrl: '',
      nextUrl: '/blog/page/2',
    })
    expect(
      collectionPaginationLinks({
        collectionSlug: 'blog',
        page: 3,
        totalPages: 3,
      }),
    ).toEqual({
      page: 3,
      totalPages: 3,
      prevUrl: '/blog/page/2',
      nextUrl: '',
    })
  })

  it('CARRIES THE CATEGORY on both links', () => {
    // A "next" built without the filter returns the reader to the unfiltered
    // list — the exact failure this exists to prevent.
    expect(
      collectionPaginationLinks({
        collectionSlug: 'blog',
        categorySlug: 'Open source',
        page: 2,
        totalPages: 3,
      }),
    ).toEqual({
      page: 2,
      totalPages: 3,
      prevUrl: '/blog/category/open-source',
      nextUrl: '/blog/category/open-source/page/3',
    })
  })

  it('reads a missing/unusable page count as a single page 1', () => {
    // An unpaginated listing IS page 1 of 1 — "Page 1 of 1", no links.
    expect(collectionPaginationLinks({ collectionSlug: 'blog' })).toEqual({
      page: 1,
      totalPages: 1,
      prevUrl: '',
      nextUrl: '',
    })
    expect(
      collectionPaginationLinks({
        collectionSlug: 'blog',
        page: 0,
        totalPages: -4,
      }),
    ).toEqual({ page: 1, totalPages: 1, prevUrl: '', nextUrl: '' })
  })

  it('agrees with collectionListUrl about page 1 being the bare listing', () => {
    const { prevUrl } = collectionPaginationLinks({
      collectionSlug: 'blog',
      categorySlug: 'guides',
      page: 2,
      totalPages: 2,
    })
    expect(prevUrl).toBe(
      collectionListUrl({ collectionSlug: 'blog', categorySlug: 'guides' }),
    )
    expect(prevUrl).not.toContain('/page/1')
  })
})

describe('collectionCategorySlug / resolveCollectionCategoryBySlug (AGL-1321)', () => {
  it('slugifies idempotently', () => {
    expect(collectionCategorySlug('Open source')).toBe('open-source')
    expect(collectionCategorySlug('open-source')).toBe('open-source')
    expect(collectionCategorySlug('  C++ & Rust!  ')).toBe('c-rust')
    expect(collectionCategorySlug(undefined)).toBe('')
  })

  it('resolves a segment by stable id OR slugified display name', () => {
    expect(resolveCollectionCategoryBySlug(taxonomy, 'product')?.id).toBe(
      'product',
    )
    expect(resolveCollectionCategoryBySlug(taxonomy, 'opensrc')?.id).toBe(
      'opensrc',
    )
    // The URL named the category by its display name; the id is opaque.
    expect(resolveCollectionCategoryBySlug(taxonomy, 'open-source')?.id).toBe(
      'opensrc',
    )
    expect(resolveCollectionCategoryBySlug(taxonomy, 'nope')).toBeUndefined()
    expect(resolveCollectionCategoryBySlug(undefined, 'product')).toBeUndefined()
  })
})

describe('entryMatchesCategoryRoute (AGL-1321)', () => {
  const category = taxonomy[1] // { id: 'opensrc', name: 'Open source' }

  it('matches an entry by its stable categoryId', () => {
    expect(
      entryMatchesCategoryRoute(
        { categoryId: 'opensrc' },
        { slug: 'open-source', category },
        taxonomy,
      ),
    ).toBe(true)
  })

  it('matches a legacy free-typed entry with no taxonomy at all', () => {
    // The multi-word case `entryMatchesFilter` cannot do: it compares raw
    // trimmed strings, so "Open source" never equals "open-source".
    expect(
      entryMatchesCategoryRoute({ category: 'Open source' }, {
        slug: 'open-source',
      }),
    ).toBe(true)
    expect(entryMatchesFilter({ category: 'Open source' }, {
      category: 'open-source',
    })).toBe(false)
  })

  it('rejects other categories and uncategorised entries', () => {
    expect(
      entryMatchesCategoryRoute(
        { categoryId: 'product' },
        { slug: 'open-source', category },
        taxonomy,
      ),
    ).toBe(false)
    expect(
      entryMatchesCategoryRoute({}, { slug: 'open-source', category }, taxonomy),
    ).toBe(false)
    // An unknown segment matches nothing rather than throwing.
    expect(
      entryMatchesCategoryRoute({ categoryId: 'product' }, { slug: 'ghosts' }),
    ).toBe(false)
    expect(entryMatchesCategoryRoute({ categoryId: 'product' }, { slug: '' })).toBe(
      false,
    )
  })
})

describe('buildCollectionCategoryLinks (AGL-1321)', () => {
  it('leads with All at the canonical URL and marks it current when unfiltered', () => {
    const links = buildCollectionCategoryLinks({
      collectionSlug: 'blog',
      categories: taxonomy,
    })
    expect(links[0]).toEqual({ label: 'All', href: '/blog', active: true })
    expect(links.slice(1)).toEqual([
      { label: 'Product', href: '/blog/category/product', active: false },
      { label: 'Open source', href: '/blog/category/opensrc', active: false },
    ])
  })

  it('marks the routed pill current through either spelling', () => {
    const byId = buildCollectionCategoryLinks({
      collectionSlug: 'blog',
      categories: taxonomy,
      activeCategorySlug: 'opensrc',
    })
    expect(byId.map((link) => link.active)).toEqual([false, false, true])
    // Same category, addressed by its display name.
    const byName = buildCollectionCategoryLinks({
      collectionSlug: 'blog',
      categories: taxonomy,
      activeCategorySlug: 'open-source',
    })
    expect(byName.map((link) => link.active)).toEqual([false, false, true])
  })

  it('omits All on request, and the whole row without a taxonomy', () => {
    expect(
      buildCollectionCategoryLinks({
        collectionSlug: 'blog',
        categories: taxonomy,
        allLabel: '',
      }),
    ).toHaveLength(2)
    // A lone "All" pill is decoration, not a filter.
    expect(
      buildCollectionCategoryLinks({ collectionSlug: 'blog', categories: [] }),
    ).toEqual([])
    expect(buildCollectionCategoryLinks({ collectionSlug: 'blog' })).toEqual([])
  })
})

/**
 * AGL-1336. "Clear it to omit that pill" was undoable by clicking: the
 * attributes form cannot persist `''`, so the emptied field's key vanished
 * and the default put the pill straight back. The field now clears to the
 * `none` sentinel, which is the only value that survives the round trip.
 */
describe('the All pill cleared value (AGL-1336)', () => {
  const pillNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['pills'] },
      pills: {
        $id: 'pills',
        componentId: 'collectionCategories',
        parentId: 'root',
        props: {} as Record<string, unknown>,
      },
    }) as any
  const pillSource: CollectionEntriesSource = {
    slug: 'blog',
    entries: [],
    categories: taxonomy,
  }

  it('defaults only when the label was never set', () => {
    expect(resolveCollectionAllLabel(undefined)).toBe('All')
    expect(resolveCollectionAllLabel(COLLECTION_ALL_PILL_DEFAULT)).toBe('All')
  })

  it.each([COLLECTION_ALL_PILL_NONE, 'None', ' none ', '', '   ', null])(
    'omits the pill for %p',
    (value) => {
      expect(resolveCollectionAllLabel(value as any)).toBe('')
    },
  )

  it('keeps any other label, trimmed', () => {
    expect(resolveCollectionAllLabel('Everything')).toBe('Everything')
    expect(resolveCollectionAllLabel('  Everything  ')).toBe('Everything')
    // Not a prefix or substring match — only the whole word is the sentinel.
    expect(resolveCollectionAllLabel('None of the above')).toBe(
      'None of the above',
    )
  })

  it('drops the All pill from the built row, keeping the categories', () => {
    const links = buildCollectionCategoryLinks({
      collectionSlug: 'blog',
      categories: taxonomy,
      allLabel: COLLECTION_ALL_PILL_NONE,
    })
    expect(links.map((link) => link.label)).toEqual(['Product', 'Open source'])
  })

  it('survives the round trip a stamped block makes', () => {
    // set → clear → reload: what the console persists after the ✕-less
    // "empty the box" gesture is the sentinel, and the tenant honours it on
    // every subsequent render.
    const nodes = pillNodes()
    nodes['pills'].props.allLabel = COLLECTION_ALL_PILL_NONE
    const stamped = expandCollectionCategories(
      nodes,
      { blog: pillSource },
      'blog',
    ) as any
    expect(stamped['pills'].props.items).toEqual([
      { label: 'Product', href: '/blog/category/product', active: false },
      { label: 'Open source', href: '/blog/category/opensrc', active: false },
    ])
  })

  it('still defaults when the prop is absent, and omits on a null', () => {
    const absent = expandCollectionCategories(
      pillNodes(),
      { blog: pillSource },
      'blog',
    ) as any
    expect(absent['pills'].props.items[0].label).toBe('All')

    const cleared = pillNodes()
    cleared['pills'].props.allLabel = null
    const stamped = expandCollectionCategories(
      cleared,
      { blog: pillSource },
      'blog',
    ) as any
    // `String(null)` would have labelled the pill "null" (AGL-1336).
    expect(stamped['pills'].props.items[0].label).toBe('Product')
  })
})

describe('expandCollectionCategories (AGL-1321)', () => {
  const pillNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['pills'] },
      pills: {
        $id: 'pills',
        componentId: 'collectionCategories',
        parentId: 'root',
        props: {},
      },
    }) as any
  const source: CollectionEntriesSource = {
    slug: 'blog',
    entries: [],
    categories: taxonomy,
  }

  it('stamps the pill row onto the block', () => {
    const nodes = expandCollectionCategories(
      pillNodes(),
      { blog: source },
      'blog',
      'product',
    ) as any
    expect(nodes['pills'].props.items).toEqual([
      { label: 'All', href: '/blog', active: false },
      { label: 'Product', href: '/blog/category/product', active: true },
      { label: 'Open source', href: '/blog/category/opensrc', active: false },
    ])
  })

  it('never marks a pill current on a block bound elsewhere', () => {
    const nodes = pillNodes()
    nodes['pills'].props.collectionSlug = 'news'
    const news: CollectionEntriesSource = {
      slug: 'news',
      entries: [],
      categories: taxonomy,
    }
    const expanded = expandCollectionCategories(
      nodes,
      { blog: source, news },
      'blog',
      'product',
    ) as any
    // /blog/category/product does not filter the NEWS listing.
    expect(
      expanded['pills'].props.items.some((item: any) => item.active),
    ).toBe(true) // "All" — news is unfiltered here
    expect(expanded['pills'].props.items[0]).toEqual({
      label: 'All',
      href: '/news',
      active: true,
    })
  })

  it('fails open on an unknown collection or empty taxonomy', () => {
    const untouched = pillNodes()
    expect(expandCollectionCategories(untouched, {}, 'blog')).toEqual(untouched)
    expect(
      expandCollectionCategories(
        pillNodes(),
        { blog: { slug: 'blog', entries: [] } },
        'blog',
      )['pills'].props.items,
    ).toBeUndefined()
  })

  it('never mutates the input map', () => {
    const nodes = pillNodes()
    const snapshot = JSON.parse(JSON.stringify(nodes))
    expandCollectionCategories(nodes, { blog: source }, 'blog', 'product')
    expect(nodes).toEqual(snapshot)
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
      `Hello world — ${formatCollectionEntryDate({ seconds: 1_700_000_000 })}`,
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

  it('takes the FEATURED entry from the route-filtered set (AGL-1871)', () => {
    // The `/blog` featured split card was hardcoded to one post, and
    // `blogListTmpl` is the single list screen behind `/blog`,
    // `/blog/page/{n}` and every `/blog/category/{slug}` — so the card led
    // `/blog/category/open-source` with a Product post that was not in the
    // category the reader had asked for.
    //
    // The fix is authored (a Collection Entries block with `entriesLimit: 1`
    // wrapping the card), and it rests on TWO properties of this function
    // that nothing asserted. The existing `entriesLimit` case only counts
    // clones, so a slice from the wrong end — or from the unfiltered set —
    // would have kept it green while putting the wrong post back on the page.
    //
    // 1. `source.entries` is what the ROUTE resolved. On a category URL the
    //    compose pipeline hands the block the already-filtered entries
    //    (`compose-collection-page.ts`), so a limit-1 block on that route can
    //    only ever render a post from that category.
    const openSourceRoute = {
      slug: 'blog',
      entries: [
        { $id: 'e4', title: 'Why Aglyn is Apache-2.0', slug: 'why-apache-2-0' },
      ],
    }
    const featured = baseNodes()
    featured['list'].props.entriesLimit = 1
    const filtered = expandCollectionEntries(
      featured,
      { blog: openSourceRoute },
      'blog',
    )
    const filteredChildren = filtered['list'].nodes as string[]
    expect(filteredChildren).toHaveLength(1)
    const filteredLink = `${filteredChildren[0].replace(/item$/, '')}link`
    expect(filtered[filteredLink].props.href).toBe('/blog/why-apache-2-0')

    // 2. The slice is from the TOP, so the unfiltered listing leads with the
    //    newest post rather than an arbitrary one. The card's own label says
    //    "· Latest"; this is what makes that label true.
    const unfiltered = baseNodes()
    unfiltered['list'].props.entriesLimit = 1
    const lead = expandCollectionEntries(unfiltered, { blog }, 'blog')
    const leadChildren = lead['list'].nodes as string[]
    const leadLink = `${leadChildren[0].replace(/item$/, '')}link`
    expect(lead[leadLink].props.href).toBe('/blog/hello-world')
    // And nothing from further down the feed leaks into the card.
    expect(
      Object.values(lead).some(
        (node: any) => node?.props?.href === '/blog/second',
      ),
    ).toBe(false)
  })

  it('drops a firstPageOnly LEAD block past route page 1 (AGL-1871)', () => {
    // The featured split card is a limit-1 block with no `perPage`, so it
    // slices the top of the set on EVERY route page: `/blog/page/2` led with
    // the same cover, title and excerpt as `/blog`, above six different
    // posts, under an eyebrow reading "Latest" that is only true on page 1.
    const lead = (routePage?: number, firstPageOnly?: boolean) => {
      const nodes = baseNodes()
      nodes['list'].props.entriesLimit = 1
      if (firstPageOnly !== undefined) {
        nodes['list'].props.firstPageOnly = firstPageOnly
      }
      const expanded = expandCollectionEntries(
        nodes,
        { blog: { ...blog, ...(routePage ? { page: routePage } : {}) } },
        'blog',
      )
      return (expanded['list'].nodes as string[]).map(
        (id) => expanded[`${id.replace(/item$/, '')}link`].props.href,
      )
    }

    // Page 1 is unchanged — the lead card is the whole point of the block.
    expect(lead(1, true)).toEqual(['/blog/hello-world'])
    // Past it, nothing: zero rows, not a second copy of page 1's lead.
    expect(lead(2, true)).toEqual([])
    expect(lead(3, true)).toEqual([])

    // DEFAULT OFF. Every block published before this switch existed keeps
    // rendering on every page — a "popular posts" rail is the same shape as
    // a lead card and only the author knows which one they built.
    expect(lead(2, false)).toEqual(['/blog/hello-world'])
    expect(lead(2)).toEqual(['/blog/hello-world'])

    // Off a routed listing (a blog rail on the homepage) `source.page` is
    // unset, so the switch has no page to be past and hides nothing.
    expect(lead(undefined, true)).toEqual(['/blog/hello-world'])
  })

  it('gates firstPageOnly on the ROUTE page, not a pinned page (AGL-1871)', () => {
    // A block that names its own `page` is a deliberately fixed window —
    // "the entries page 3 would show, here" — which says nothing about which
    // page of the listing the reader is on. Reading the pinned page instead
    // would blank that block on page 1, where it is supposed to render.
    const nodes = baseNodes()
    nodes['list'].props.entriesLimit = 1
    nodes['list'].props.firstPageOnly = true
    nodes['list'].props.perPage = 1
    nodes['list'].props.page = 2
    const pinned = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(pinned['list'].nodes).toHaveLength(1)
    const pinnedLink = `${(pinned['list'].nodes as string[])[0].replace(/item$/, '')}link`
    expect(pinned[pinnedLink].props.href).toBe('/blog/second')
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

  it("falls back to the ROUTE's page when the block names none (AGL-1321)", () => {
    const many = (page?: number) => ({
      slug: 'blog',
      ...(page ? { page } : {}),
      entries: Array.from({ length: 5 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    })
    const window = (routePage?: number, blockPage?: number) => {
      const nodes = baseNodes()
      nodes['list'].props.perPage = 2
      if (blockPage) nodes['list'].props.page = blockPage
      const expanded = expandCollectionEntries(
        nodes,
        { blog: many(routePage) },
        'blog',
      )
      return (expanded['list'].nodes as string[]).map((childId) => {
        const titleId = `${childId.replace(/item$/, '')}title`
        return expanded[titleId].props.children
      })
    }
    // Design time cannot know which page a visitor is on, so /blog/page/2
    // used to re-serve page 1 at a second URL.
    expect(window(2)).toEqual(['Post 2 — ', 'Post 3 — '])
    expect(window(3)).toEqual(['Post 4 — '])
    // A block that pins its own page still wins — that is a deliberate
    // window (a "latest three" strip), not a paginated list.
    expect(window(3, 1)).toEqual(['Post 0 — ', 'Post 1 — '])
    // No route page: unchanged, page 1.
    expect(window()).toEqual(['Post 0 — ', 'Post 1 — '])
  })

  it('perPage takes precedence over entriesLimit (AGL-620)', () => {
    const nodes = baseNodes()
    nodes['list'].props.entriesLimit = 1
    nodes['list'].props.perPage = 5
    nodes['list'].props.page = 1
    // The page window (5) wins over the legacy limit (1): both entries show.
    expect(expandCollectionEntries(nodes, { blog }, 'blog')['list'].nodes).toHaveLength(2)
  })

  it('fails open when the collection is UNKNOWN', () => {
    const untouched = baseNodes()
    expect(expandCollectionEntries(untouched, {}, 'blog')).toEqual(untouched)
  })

  it('renders zero rows — not the raw template — when empty (AGL-1321)', () => {
    // A known collection with nothing to show used to keep its template
    // child, which then rendered `{{entry.title}}` as body text. Rare while
    // only an empty collection could cause it; reachable from any category
    // pill with no posts yet once the route filters.
    const empty = expandCollectionEntries(
      baseNodes(),
      { blog: { slug: 'blog', entries: [] } },
      'blog',
    )
    expect(empty['list'].nodes).toEqual([])
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

describe('expandCollectionEntries search index (AGL-1516)', () => {
  it('leaves the props of a block without search UNTOUCHED (regression pin)', () => {
    // Search is opt-in: every already-published block's node must come out
    // byte-identical — the SAME props object, not an equal copy.
    const nodes = baseNodes()
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(expanded['list'].props).toBe(nodes['list'].props)
    expect('searchIndex' in expanded['list'].props).toBe(false)
    expect('searchTotal' in expanded['list'].props).toBe(false)
  })

  // ── searchTotal: the size of the set the window came FROM (AGL-1516) ──
  //
  // The component cannot tell a truncated block from a complete one on its
  // own. It used to guess from `perPage`, which is wrong under both of the
  // other two truncations below — and wrong in the other direction when
  // `perPage` exceeds the entry count. Each case here pins one of those, so
  // stamping the total for only one truncation path stays red.

  it('stamps the PRE-window total, not the count it rendered', () => {
    const many = {
      slug: 'blog',
      entries: Array.from({ length: 5 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.perPage = 2
    nodes['list'].props.page = 2
    const expanded = expandCollectionEntries(nodes, { blog: many }, 'blog')
    expect(expanded['list'].props.searchIndex).toHaveLength(2)
    expect(expanded['list'].props.searchTotal).toBe(5)
  })

  it('stamps a total larger than the index under entriesLimit ALONE', () => {
    // No `perPage` anywhere — the exact block ("latest 6 posts") whose miss
    // used to read as a flat "No matches", because `perPage` was the only
    // truncation the component could see.
    const many = {
      slug: 'blog',
      entries: Array.from({ length: 40 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.entriesLimit = 6
    const expanded = expandCollectionEntries(nodes, { blog: many }, 'blog')
    expect(expanded['list'].props.perPage).toBeUndefined()
    expect(expanded['list'].props.searchIndex).toHaveLength(6)
    expect(expanded['list'].props.searchTotal).toBe(40)
  })

  it('stamps a total larger than the index under the 100-entry CAP', () => {
    // Neither `perPage` nor `entriesLimit` is set: COLLECTION_ENTRIES_MAX is
    // the only thing doing the cutting, and nothing on the props records it.
    const many = {
      slug: 'blog',
      entries: Array.from({ length: COLLECTION_ENTRIES_MAX + 12 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog: many }, 'blog')
    expect(expanded['list'].props.searchIndex).toHaveLength(
      COLLECTION_ENTRIES_MAX,
    )
    expect(expanded['list'].props.searchTotal).toBe(COLLECTION_ENTRIES_MAX + 12)
  })

  it('stamps an EQUAL total when the block holds everything', () => {
    // A `perPage` bigger than the collection is one complete page. If this
    // stamped the window size unconditionally the component could never tell
    // complete from truncated, and every miss would blame pages that do not
    // exist.
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.perPage = 20
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    // Widened locally: `props` is an index signature, so `searchIndex` reads
    // as `unknown` and `.length` does not typecheck on it. Every other
    // assertion in this file reaches the array through a matcher, which
    // accepts `unknown`; this one compares two numbers and cannot.
    const searchIndex = expanded['list'].props.searchIndex as unknown[]
    expect(expanded['list'].props.searchTotal).toBe(searchIndex.length)
  })

  it('counts the FILTERED set, not the whole collection', () => {
    // "The rest of the collection is not searched" means the rest of what
    // this block would otherwise show. A category-filtered block that holds
    // every post in its category is complete, however large the collection.
    const tagged = {
      slug: 'blog',
      entries: [
        { title: 'A', slug: 'a', category: 'News' },
        { title: 'B', slug: 'b', category: 'Guides' },
        { title: 'C', slug: 'c', category: 'News' },
      ],
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.filterCategory = 'guides'
    const expanded = expandCollectionEntries(nodes, { blog: tagged }, 'blog')
    expect(expanded['list'].props.searchIndex).toHaveLength(1)
    expect(expanded['list'].props.searchTotal).toBe(1)
  })

  it('stamps a searchIndex aligned with the rendered entries', () => {
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(expanded['list'].nodes).toHaveLength(2)
    expect(expanded['list'].props.searchIndex).toEqual([
      {
        title: 'Hello world',
        excerpt: 'First post',
        url: '/blog/hello-world',
        date: formatCollectionEntryDate({ seconds: 1_700_000_000 }),
      },
      // No `publishedAt`, so no `date` key at all — an absent field is
      // absent, not an empty string (AGL-1525).
      { title: 'Second', excerpt: '', url: '/blog/second' },
    ])
  })

  it('indexes only the PAGE the block rendered — search is page-scoped', () => {
    const many = {
      slug: 'blog',
      entries: Array.from({ length: 5 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
        excerpt: `About ${i}`,
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.perPage = 2
    nodes['list'].props.page = 2
    const expanded = expandCollectionEntries(nodes, { blog: many }, 'blog')
    // The index covers exactly the window the reader can see; the block's
    // empty state owns saying so.
    expect(expanded['list'].props.searchIndex).toEqual([
      { title: 'Post 2', excerpt: 'About 2', url: '/blog/post-2' },
      { title: 'Post 3', excerpt: 'About 3', url: '/blog/post-3' },
    ])
  })

  it('indexes the FILTERED set, so search cannot resurface excluded entries', () => {
    const tagged = {
      slug: 'blog',
      entries: [
        { title: 'A', slug: 'a', category: 'News' },
        { title: 'B', slug: 'b', category: 'Guides' },
      ],
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.filterCategory = 'guides'
    const expanded = expandCollectionEntries(nodes, { blog: tagged }, 'blog')
    expect(expanded['list'].props.searchIndex).toEqual([
      { title: 'B', excerpt: '', url: '/blog/b', category: 'Guides' },
    ])
  })

  // ── Suggestion-row fields (AGL-1525, frame 496:1218) ──────────────────
  //
  // The panel is drawn from the INDEX, not from the clones: the component
  // holds only rendered markup by then, so a row's link, date and chip can
  // only reach it from here. Each is asserted against the resolver the rest
  // of the collection surfaces use, because a suggestion for a post that
  // disagrees with the card below it about its date or its category is worse
  // than no suggestion.

  it('stamps the entry permalink so a suggestion row can be a real link', () => {
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    const index = expanded['list'].props
      .searchIndex as CollectionEntrySearchItem[]
    expect(index.map((item) => item.url)).toEqual([
      '/blog/hello-world',
      '/blog/second',
    ])
  })

  it('omits the url for a slugless entry rather than linking to /blog/', () => {
    // A slugless entry has no permalink to offer. `/blog/` is not a smaller
    // version of that fact, it is a link to the LISTING wearing the post's
    // title — the reader clicks their result and lands somewhere else.
    const slugless = {
      slug: 'blog',
      entries: [{ $id: 'e1', title: 'Draft-ish', excerpt: 'No slug' }],
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog: slugless }, 'blog')
    const index = expanded['list'].props
      .searchIndex as CollectionEntrySearchItem[]
    expect(index).toHaveLength(1)
    expect('url' in index[0]).toBe(false)
  })

  it('dates a suggestion through the ONE formatter (AGL-1926)', () => {
    // Not a second inline `toLocaleDateString()`: the suggestion row and the
    // card it points at are the same published date and must not be able to
    // disagree. Compared against the formatter itself rather than a literal,
    // so a change to the site-wide format moves both together.
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    const index = expanded['list'].props
      .searchIndex as CollectionEntrySearchItem[]
    expect(index[0].date).toBe(
      formatCollectionEntryDate({ seconds: 1_700_000_000 }),
    )
    expect('date' in index[1]).toBe(false)
  })

  it('resolves the category chip through the taxonomy, so a rename lands', () => {
    // `categoryId` is the stored form; the chip must show the CURRENT name,
    // exactly as Category Pills and Related posts resolve it. Stamping the
    // raw id would put "guides" on a chip the site calls "Playbooks".
    const renamed = {
      slug: 'blog',
      categories: [{ id: 'guides', name: 'Playbooks' }],
      entries: [
        { $id: 'e1', title: 'New', slug: 'new', categoryId: 'guides' },
        { $id: 'e2', title: 'Bare', slug: 'bare' },
      ],
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog: renamed }, 'blog')
    const index = expanded['list'].props
      .searchIndex as CollectionEntrySearchItem[]
    expect(index[0].category).toBe('Playbooks')
    // Uncategorized stays uncategorized — no empty chip.
    expect('category' in index[1]).toBe(false)
  })

  it('still stamps NOTHING on a block that never asked for search', () => {
    // The row fields must not become a back door around the opt-in: the
    // regression pin above asserts the same props OBJECT, and this asserts
    // the new keys specifically, so a future `searchIndex` built outside the
    // `searchEnabled` branch cannot pass by leaving `search` alone.
    const nodes = baseNodes()
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect(expanded['list'].props.searchIndex).toBeUndefined()
  })

  it('still fails open on an UNKNOWN collection, search or not', () => {
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const untouched = JSON.parse(JSON.stringify(nodes))
    expect(expandCollectionEntries(nodes, {}, 'blog')).toEqual(untouched)
  })

  // ── searchCapped: whether `searchTotal` is a total or a ceiling ────────
  //
  // `searchTotal` counts the entries the SERVER saw, and the read behind it
  // stops at COLLECTION_SOURCE_MAX. Past that bound `index.length ===
  // searchTotal` — the component's test for "this block holds everything" —
  // is satisfied by a block holding 100 of 400 posts, and the bare
  // "No matches." is the branch it takes. The count alone cannot see this.

  it('marks a search over a BOUNDED read as capped', () => {
    const atBound = {
      slug: 'blog',
      entries: Array.from({ length: COLLECTION_SOURCE_MAX }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog: atBound }, 'blog')
    expect(expanded['list'].props.searchCapped).toBe(true)
  })

  it('leaves the flag OFF for a read that came back short of its bound', () => {
    // Absent, not `false` — the same absent-key discipline the index rows
    // use, and what keeps an uncapped block's payload as small as it was.
    const nodes = baseNodes()
    nodes['list'].props.search = true
    const expanded = expandCollectionEntries(nodes, { blog }, 'blog')
    expect('searchCapped' in expanded['list'].props).toBe(false)
  })

  it('reads the cap off the RAW set, never off the filtered one', () => {
    // A category filter narrows a COMPLETE read; the narrowed set is not a
    // bounded one. Keying the flag off `filtered` would clear it on exactly
    // the blocks that most need it — a filtered view of a collection nobody
    // read all of.
    const atBound = {
      slug: 'blog',
      entries: Array.from({ length: COLLECTION_SOURCE_MAX }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
        category: i === 0 ? 'Guides' : 'News',
      })),
    }
    const nodes = baseNodes()
    nodes['list'].props.search = true
    nodes['list'].props.filterCategory = 'guides'
    const expanded = expandCollectionEntries(nodes, { blog: atBound }, 'blog')
    expect(expanded['list'].props.searchTotal).toBe(1)
    expect(expanded['list'].props.searchCapped).toBe(true)
  })

  it('never stamps the flag on a block without search', () => {
    const atBound = {
      slug: 'blog',
      entries: Array.from({ length: COLLECTION_SOURCE_MAX }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const nodes = baseNodes()
    const expanded = expandCollectionEntries(nodes, { blog: atBound }, 'blog')
    expect(expanded['list'].props).toBe(nodes['list'].props)
    expect('searchCapped' in expanded['list'].props).toBe(false)
  })
})

describe('expandCollectionSearch (AGL-1516, Figma 494:1220)', () => {
  const searchNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['box'] },
      box: {
        $id: 'box',
        componentId: COLLECTION_SEARCH_COMPONENT_ID,
        parentId: 'root',
        props: {},
      },
    }) as any

  it('stamps the index, the total and the entry rows', () => {
    const expanded = expandCollectionSearch(
      searchNodes(),
      { blog },
      'blog',
    ) as any
    expect(expanded['box'].props.searchIndex).toEqual([
      {
        title: 'Hello world',
        excerpt: 'First post',
        url: '/blog/hello-world',
        date: formatCollectionEntryDate({ seconds: 1_700_000_000 }),
      },
      { title: 'Second', excerpt: '', url: '/blog/second' },
    ])
    expect(expanded['box'].props.searchTotal).toBe(2)
    expect('searchCapped' in expanded['box'].props).toBe(false)
  })

  it('indexes the WHOLE source, not one page window', () => {
    // The entries block scopes its box to the entries it rendered because it
    // filters them in place. A toolbar box hides nothing, so cutting it to a
    // page would be an arbitrary limit nobody asked for — and one the reader
    // could not see.
    const many = {
      slug: 'blog',
      entries: Array.from({ length: 25 }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
      page: 2,
    }
    const expanded = expandCollectionSearch(
      searchNodes(),
      { blog: many },
      'blog',
    ) as any
    expect(expanded['box'].props.searchIndex).toHaveLength(25)
    expect(expanded['box'].props.searchTotal).toBe(25)
  })

  it('marks a bounded read as capped', () => {
    const atBound = {
      slug: 'blog',
      entries: Array.from({ length: COLLECTION_SOURCE_MAX }, (_, i) => ({
        $id: `e${i}`,
        title: `Post ${i}`,
        slug: `post-${i}`,
      })),
    }
    const expanded = expandCollectionSearch(
      searchNodes(),
      { blog: atBound },
      'blog',
    ) as any
    expect(expanded['box'].props.searchCapped).toBe(true)
  })

  it('fails open on an UNKNOWN collection', () => {
    const nodes = searchNodes()
    const untouched = JSON.parse(JSON.stringify(nodes))
    expect(expandCollectionSearch(nodes, {}, 'blog')).toEqual(untouched)
  })

  it('gives an EMPTY collection no box at all', () => {
    // A field over an empty index can only ever answer "no matches", which
    // reads as a fact about the reader's query rather than about the
    // collection with nothing in it.
    const nodes = searchNodes()
    const untouched = JSON.parse(JSON.stringify(nodes))
    expect(
      expandCollectionSearch(nodes, { blog: { slug: 'blog', entries: [] } }, 'blog'),
    ).toEqual(untouched)
  })

  it('skips a box CLONED into an entry template', () => {
    // Every child of an entries block is cloned per entry. A search box that
    // ended up inside one would otherwise be stamped once per card.
    const nodes = searchNodes()
    nodes[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__box`] = {
      $id: `${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__box`,
      componentId: COLLECTION_SEARCH_COMPONENT_ID,
      props: {},
    }
    const expanded = expandCollectionSearch(nodes, { blog }, 'blog') as any
    expect(
      'searchIndex' in
        expanded[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__box`].props,
    ).toBe(false)
    // …while the real one is still stamped.
    expect(expanded['box'].props.searchIndex).toHaveLength(2)
  })

  it('honours the block’s own collection slug over the routed one', () => {
    const nodes = searchNodes()
    nodes['box'].props.collectionSlug = 'changelog'
    const expanded = expandCollectionSearch(
      nodes,
      {
        blog,
        changelog: {
          slug: 'changelog',
          entries: [{ $id: 'c1', title: 'Shipped', slug: 'shipped' }],
        },
      },
      'blog',
    ) as any
    expect(expanded['box'].props.searchIndex).toEqual([
      { title: 'Shipped', excerpt: '', url: '/changelog/shipped' },
    ])
  })

  it('never mutates its inputs', () => {
    const nodes = searchNodes()
    const before = JSON.parse(JSON.stringify(nodes))
    expandCollectionSearch(nodes, { blog }, 'blog')
    expect(nodes).toEqual(before)
  })
})

describe('collectionSourceReachedBound (AGL-1516)', () => {
  it('is true only once a read comes back holding its own limit', () => {
    expect(collectionSourceReachedBound([])).toBe(false)
    expect(
      collectionSourceReachedBound(Array(COLLECTION_SOURCE_MAX - 1).fill(0)),
    ).toBe(false)
    expect(
      collectionSourceReachedBound(Array(COLLECTION_SOURCE_MAX).fill(0)),
    ).toBe(true)
  })

  it('reads an absent set as unbounded rather than throwing', () => {
    expect(collectionSourceReachedBound(undefined)).toBe(false)
  })

  it('shares its bound with the query that produces the read', () => {
    // Two independent 100s is how this silently stops working: the fetch
    // limit moves, the flag keeps testing the old number, and a capped read
    // stops declaring itself. `get-collection-content.ts` passes this exact
    // constant to `.limit()`.
    expect(COLLECTION_SOURCE_MAX).toBe(100)
  })
})

describe('collectionSourceIsBounded (AGL-1516)', () => {
  /**
   * Counting the entries is a PROXY for "the read hit its limit", and the
   * proxy is wrong in the one direction that matters.
   *
   * The tenant query asks for `status in ['published', 'scheduled']` and then
   * drops what is not live yet — a future `publishAt`, or (AGL-471) a due
   * schedule on a plan without `scheduledPublishing`. So a read that came back
   * holding all 100 of its documents can hand over 96 entries, and 96 does not
   * look like a ceiling to anything downstream. That is a blog with a
   * scheduling queue, which is most of them.
   *
   * A false here is not a cosmetic miss: `searchCapped` is the ONLY thing
   * stopping a search over 96 of 400 posts from answering a miss with the flat
   * "No matches." that claims to have looked everywhere.
   */
  const shortOfBound = Array.from(
    { length: COLLECTION_SOURCE_MAX - 4 },
    (_, i) => ({ $id: `e${i}`, title: `Post ${i}`, slug: `post-${i}` }),
  )

  it('believes a read that DECLARES it stopped at its bound', () => {
    expect(
      collectionSourceIsBounded({
        entries: shortOfBound,
        reachedBound: true,
      }),
    ).toBe(true)
    // …and the count alone would have said otherwise, which is the whole
    // reason the flag is threaded down from the query.
    expect(collectionSourceReachedBound(shortOfBound)).toBe(false)
  })

  it('falls back to counting for a source that declares nothing', () => {
    // A payload cached before the flag shipped, or a source assembled by
    // hand. The old reading is still the best available one there.
    expect(collectionSourceIsBounded({ entries: shortOfBound })).toBe(false)
    expect(
      collectionSourceIsBounded({
        entries: Array.from({ length: COLLECTION_SOURCE_MAX }, (_, i) => ({
          $id: `e${i}`,
          title: `Post ${i}`,
          slug: `post-${i}`,
        })),
      }),
    ).toBe(true)
  })

  it('reads an absent source as unbounded rather than throwing', () => {
    expect(collectionSourceIsBounded(undefined)).toBe(false)
  })

  it('stamps the entries block from the DECLARED bound, not the count', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['list'] },
      list: {
        $id: 'list',
        componentId: COLLECTION_ENTRIES_COMPONENT_ID,
        parentId: 'root',
        props: { search: true },
        nodes: ['card'],
      },
      card: {
        $id: 'card',
        componentId: 'muiStack',
        parentId: 'list',
        props: {},
        nodes: [],
      },
    } as any
    const expanded = expandCollectionEntries(
      nodes,
      { blog: { slug: 'blog', entries: shortOfBound, reachedBound: true } },
      'blog',
    ) as any
    expect(expanded['list'].props.searchCapped).toBe(true)
  })

  it('stamps the standalone box from the DECLARED bound too', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['box'] },
      box: {
        $id: 'box',
        componentId: COLLECTION_SEARCH_COMPONENT_ID,
        parentId: 'root',
        props: {},
      },
    } as any
    const expanded = expandCollectionSearch(
      nodes,
      { blog: { slug: 'blog', entries: shortOfBound, reachedBound: true } },
      'blog',
    ) as any
    expect(expanded['box'].props.searchCapped).toBe(true)
    // The count it names is still the honest one — the entries it actually
    // holds — and `searchCapped` is what says that number is a floor.
    expect(expanded['box'].props.searchTotal).toBe(shortOfBound.length)
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
        date: formatCollectionEntryDate({ seconds: 1_700_000_000 }),
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

  /**
   * AGL-1457. The block owns its markup, so a cover can only reach it as a
   * stamped field — there is no template to bind `{{entry.coverImage}}` on.
   * The raw stored value is stamped, not a URL: a `media:` reference resolves
   * at RENDER through `resolveMediaSrc`, exactly as the Image element does,
   * so one reference keeps working across sites and CDN route changes.
   */
  it('stamps the raw cover reference on related items (AGL-1457)', () => {
    const withCover = {
      slug: 'blog',
      entries: [
        { $id: 'current', slug: 'current', tags: ['x'] },
        {
          $id: 'match',
          title: 'Match',
          slug: 'match',
          coverImage: 'media:org:jWmGooWE3L/4GF1hRJBUp',
          tags: ['x'],
        },
      ],
    }
    const nodes = expandCollectionRelated(
      relatedNodes(),
      withCover,
      withCover.entries[0],
    )
    expect(nodes['related'].props.entries).toEqual([
      {
        title: 'Match',
        url: '/blog/match',
        coverImage: 'media:org:jWmGooWE3L/4GF1hRJBUp',
      },
    ])
  })

  it('omits the cover key entirely for an entry without one (AGL-1457)', () => {
    const nodes = expandCollectionRelated(
      relatedNodes(),
      source,
      source.entries[0],
    )
    const [first] = nodes['related'].props.entries as any[]
    expect(first).not.toHaveProperty('coverImage')
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

  /**
   * AGL-2486. The rail stamped `formatCollectionEntryDate(publishedAt)` with
   * no format at all, so every related card was pinned to the raw locale date
   * — `7/19/2026` under a byline the same template could set to "Jul 19,
   * 2026". The format is answered here for the reason the byline's is: by the
   * time a date reaches the block it is a formatted string, and re-parsing
   * one is ambiguous by construction.
   */
  describe('the card date reads in the authored format (AGL-2486)', () => {
    const formatNodes = (dateFormat?: string) =>
      ({
        root: { $id: 'root', componentId: 'div', nodes: ['related'] },
        related: {
          $id: 'related',
          componentId: 'collectionRelated',
          parentId: 'root',
          props: dateFormat ? { dateFormat } : {},
        },
      }) as any

    const dateOf = (dateFormat?: string) => {
      const nodes = expandCollectionRelated(
        formatNodes(dateFormat),
        source,
        source.entries[0],
      )
      return (nodes['related'].props.entries as any[])[0].date
    }

    it('uses the locale date when nothing is chosen, as it always has', () => {
      expect(dateOf()).toBe(
        formatCollectionEntryDate({ seconds: 1_700_000_000 }),
      )
    })

    it('uses the locale date for the explicit do-nothing choice', () => {
      expect(dateOf('default')).toBe(dateOf())
    })

    it('honours each named format', () => {
      for (const format of ['monthYear', 'mediumDate', 'longDate', 'iso']) {
        expect(dateOf(format)).toBe(
          formatCollectionEntryDate({ seconds: 1_700_000_000 }, format as any),
        )
      }
    })

    it('falls back rather than stamping a format nothing renders', () => {
      expect(dateOf('not-a-format')).toBe(dateOf())
    })

    it('is read PER NODE, so two rails can date differently', () => {
      const nodes = expandCollectionRelated(
        {
          root: { $id: 'root', componentId: 'div', nodes: ['a', 'b'] },
          a: {
            $id: 'a',
            componentId: 'collectionRelated',
            parentId: 'root',
            props: { dateFormat: 'iso' },
          },
          b: {
            $id: 'b',
            componentId: 'collectionRelated',
            parentId: 'root',
            props: { dateFormat: 'longDate' },
          },
        } as any,
        source,
        source.entries[0],
      )
      expect((nodes['a'].props.entries as any[])[0].date).toBe('2023-11-14')
      expect((nodes['b'].props.entries as any[])[0].date).not.toBe('2023-11-14')
    })
  })
})

describe('expandCollectionEntryMeta (AGL-1385)', () => {
  /**
   * The node as it is ACTUALLY stored on the live `blogEntryTmpl`, read out of
   * the rendered page: three switches on, and not one value bound. It rendered
   * an empty `<div>` at height 0 while the same entry's date and category were
   * in its feed item and its JSON-LD.
   */
  const metaNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['meta'] },
      meta: {
        $id: 'meta',
        componentId: 'collectionEntryMeta',
        parentId: 'root',
        props: { showDate: true, showCategory: true, showTags: true },
        sx: { textAlign: 'center' },
      },
    }) as any

  const categories = [{ id: 'guides', name: 'Guides' }]
  const entry = {
    $id: 'fHkaaFRRWF',
    title: 'From a form to a dataset in five minutes',
    slug: 'from-a-form-to-a-dataset-in-five-minutes',
    categoryId: 'guides',
    tags: ['forms', 'datasets'],
    publishedAt: { seconds: 1_754_714_956 },
  }

  it('fills a block that binds nothing — the shape that rendered empty', () => {
    const nodes = expandCollectionEntryMeta(metaNodes(), entry, categories)

    expect(nodes['meta'].props).toEqual({
      showDate: true,
      showCategory: true,
      showTags: true,
      // 2025-08-09T05:29:16Z — before dawn UTC, so this instant is the
      // PREVIOUS day in every American zone. Written as a bare
      // `toLocaleDateString()` it asserted the developer's zone; the stamped
      // prop is the shared formatter's answer (AGL-1926).
      date: formatCollectionEntryDate({ seconds: 1_754_714_956 }),
      category: 'Guides',
      tags: 'forms, datasets',
    })
  })

  it('reads identically to the tokens an author can bind by hand', () => {
    const stamped = expandCollectionEntryMeta(metaNodes(), entry, categories)
    const tokens = collectionEntryTokens(entry, 'blog', categories)

    expect(stamped['meta'].props.date).toBe(tokens['entry.date'])
    expect(stamped['meta'].props.category).toBe(tokens['entry.category'])
    expect(stamped['meta'].props.tags).toBe(tokens['entry.tags'])
  })

  it('never overwrites an authored value or a token awaiting substitution', () => {
    const authored = metaNodes()
    authored['meta'].props = {
      date: 'Updated weekly',
      category: '{{entry.category}}',
    }

    const nodes = expandCollectionEntryMeta(authored, entry, categories)

    expect(nodes['meta'].props.date).toBe('Updated weekly')
    // Still the literal token: substitution runs later and must win.
    expect(nodes['meta'].props.category).toBe('{{entry.category}}')
    expect(nodes['meta'].props.tags).toBe('forms, datasets')
  })

  it("shows the author's own portrait instead of the template's mark", () => {
    // The live blogEntryTmpl pins the SITE's brand mark on the block, chosen
    // when a byline was a string and no portrait existed anywhere. Once the
    // entry resolves to an author record with an image, the mark is the wrong
    // face beside a named person.
    const authored = metaNodes()
    authored['meta'].props = {
      ...authored['meta'].props,
      avatarImage: 'media:org:jWmGooWE3L/brandMark',
    }
    const withAuthor = {
      ...entry,
      author: { name: 'Zach Gover', image: 'media:org:jWmGooWE3L/portrait' },
    }

    const nodes = expandCollectionEntryMeta(authored, withAuthor, categories)

    expect(nodes['meta'].props.avatarImage).toBe('media:org:jWmGooWE3L/portrait')
  })

  it("keeps the template's mark when the author carries no portrait", () => {
    // Narrow on purpose: a legacy string byline, or a record with no image,
    // must leave the block exactly as authored.
    const authored = metaNodes()
    authored['meta'].props = {
      ...authored['meta'].props,
      avatarImage: 'media:org:jWmGooWE3L/brandMark',
    }

    const legacy = expandCollectionEntryMeta(
      authored,
      { ...entry, authorName: 'The Aglyn Team' },
      categories,
    )
    expect(legacy['meta'].props.avatarImage).toBe(
      'media:org:jWmGooWE3L/brandMark',
    )

    const imageless = expandCollectionEntryMeta(
      authored,
      { ...entry, author: { name: 'Zach Gover' } },
      categories,
    )
    expect(imageless['meta'].props.avatarImage).toBe(
      'media:org:jWmGooWE3L/brandMark',
    )
  })

  it('leaves the tag row faceless — the avatar follows the byline', () => {
    // The live blogEntryTmpl ends on a second Entry Meta block used purely
    // for chips: author, date and category switched off, "Tagged" typed as a
    // label beside it. Filling the portrait in there put the author's face
    // among the tags, halfway down the page from the byline it belongs to —
    // and the image is `alt=""` precisely because a name is supposed to sit
    // next to it.
    const chipsOnly = metaNodes()
    chipsOnly['meta'].props = {
      showTags: true,
      showAuthor: false,
      showDate: false,
      showCategory: false,
    }

    const nodes = expandCollectionEntryMeta(
      chipsOnly,
      { ...entry, author: { name: 'Zach Gover', image: 'media:x/portrait' } },
      categories,
    )

    expect(nodes['meta'].props.avatarImage).toBeUndefined()
    expect(nodes['meta'].props.tags).toBe('forms, datasets')
  })

  it('leaves the avatar alone when the block hides it', () => {
    // `showAvatar: false` is the author saying "no face here"; a portrait
    // arriving later must not turn it back on.
    const hidden = metaNodes()
    hidden['meta'].props = { ...hidden['meta'].props, showAvatar: false }

    const nodes = expandCollectionEntryMeta(
      hidden,
      { ...entry, author: { name: 'Zach Gover', image: 'media:x/portrait' } },
      categories,
    )

    expect(nodes['meta'].props.avatarImage).toBeUndefined()
  })

  it('skips the per-entry clones a listing block produced', () => {
    // A card inside a Collection entries block resolves its OWN entry's
    // tokens; stamping the routed entry here would date every card the same.
    const cloned = metaNodes()
    cloned['centry__list__0__meta'] = {
      ...cloned['meta'],
      $id: 'centry__list__0__meta',
    }
    const snapshot = JSON.parse(JSON.stringify(cloned['centry__list__0__meta']))

    const nodes = expandCollectionEntryMeta(cloned, entry, categories)

    expect(nodes['centry__list__0__meta']).toEqual(snapshot)
  })

  it('leaves the block alone without a routed entry, and never mutates', () => {
    const untouched = metaNodes()
    const snapshot = JSON.parse(JSON.stringify(untouched))

    // A list route or a plain screen: the besigner affordance stands.
    expect(expandCollectionEntryMeta(untouched, null, categories)).toEqual(
      snapshot,
    )
    expandCollectionEntryMeta(untouched, entry, categories)
    expect(untouched).toEqual(snapshot)
  })

  it('omits a value the entry genuinely lacks rather than stamping blank', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes(),
      { $id: 'x', slug: 'x', publishedAt: null, tags: [] },
      categories,
    )

    expect(nodes['meta'].props).not.toHaveProperty('date')
    expect(nodes['meta'].props).not.toHaveProperty('category')
    expect(nodes['meta'].props).not.toHaveProperty('tags')
  })
})

/**
 * AGL-1459. The block emitted `8/9/2026` and the article frame's byline wants
 * `Jul 2026`, so the only way to reach the frame was to hardcode a string into
 * the Date OVERRIDE — which on a *template* stamps one fabricated date onto
 * all 11 published entries. A raw locale date is also simply the wrong default
 * for an editorial surface; the format is a presentation choice, and it had no
 * control at all.
 *
 * The formatter lives HERE, next to the timestamp, and not in the block. By
 * the time a date reaches the component it is already a formatted string, and
 * re-parsing `8/9/2026` is ambiguous by construction: the very same string
 * reads as 8 September under a `en-GB` runtime. A byline that silently moves
 * an article three weeks is worse than one that is the wrong shape.
 */
describe('formatCollectionEntryDate (AGL-1459)', () => {
  /** 2026-07-15T12:00:00Z — mid-month and midday, so no zone moves it. */
  const seconds = 1_784_116_800
  const at = { seconds }

  it('leaves the shipped format byte-identical to what the block emits today', () => {
    // The whole point of the default option: an author who opens the new
    // dropdown and closes it must not restyle 11 published pages.
    //
    // Asserted against the LITERAL production spelling, not against
    // `date.toLocaleDateString()` (AGL-1926). Comparing the formatter to a
    // bare call was a check that could not fail while the formatter WAS a
    // bare call — it agreed on any machine by construction, including the
    // machines where the two now legitimately differ. `7/15/2026` is what
    // aglyn.com serves.
    expect(formatCollectionEntryDate(at)).toBe('7/15/2026')
    expect(
      formatCollectionEntryDate(at, COLLECTION_ENTRY_DATE_FORMAT_DEFAULT),
    ).toBe('7/15/2026')
    // And so must an unknown value from a hand-edited document.
    expect(formatCollectionEntryDate(at, 'nonsense' as never)).toBe('7/15/2026')
  })

  it('produces the article frame’s "Jul 2026" byline shape', () => {
    expect(formatCollectionEntryDate(at, 'monthYear', 'en-US')).toBe('Jul 2026')
    // No day number: that is the whole difference from the shipped format.
    expect(formatCollectionEntryDate(at, 'monthYear', 'en-US')).not.toContain(
      '15',
    )
  })

  it('offers the other editorial shapes an author would reach for', () => {
    expect(formatCollectionEntryDate(at, 'mediumDate', 'en-US')).toBe(
      'Jul 15, 2026',
    )
    expect(formatCollectionEntryDate(at, 'longDate', 'en-US')).toBe(
      'July 15, 2026',
    )
  })

  it('writes ISO from the PINNED calendar day, not the runtime’s', () => {
    // This used to read the local calendar day through `getFullYear`/
    // `getMonth`/`getDate`, which made the entry's date a property of
    // whoever rendered it — the server said one day and the visitor's
    // browser said another, which is the mismatch AGL-1926 is about. The
    // day is now read in the pinned zone, the same one the three
    // `toLocaleDateString` branches use, so all four agree.
    const pinned = formatCollectionEntryDate(at, 'iso')
    expect(pinned).toBe('2026-07-15')
    expect(pinned).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('empties an unpublished entry rather than printing the epoch', () => {
    expect(formatCollectionEntryDate(undefined, 'monthYear')).toBe('')
    expect(formatCollectionEntryDate(null, 'monthYear')).toBe('')
    expect(formatCollectionEntryDate({ seconds: 0 }, 'monthYear')).toBe('')
  })

  it('offers only values that can actually be persisted (AGL-1451/AGL-1453)', () => {
    const values = COLLECTION_ENTRY_DATE_FORMAT_OPTIONS.map(
      (option) => option.value,
    )
    // "Use the entry's default" is a REAL value, not absence: `''` cannot
    // survive a save, so an author who tried a format would have no way back.
    expect(values).toContain(COLLECTION_ENTRY_DATE_FORMAT_DEFAULT)
    for (const option of COLLECTION_ENTRY_DATE_FORMAT_OPTIONS) {
      expect(option.value).toBeTruthy()
      expect(option.label).toBeTruthy()
    }
    // Every offered value has to mean something to the formatter.
    for (const value of values) {
      expect(formatCollectionEntryDate(at, value)).toBeTruthy()
    }
    expect(new Set(values).size).toBe(values.length)
  })
})

/**
 * AGL-1459. Every published post was authored with `The Aglyn Team`, so the
 * frame's byline was a PRESENTATION gap, not a content gap: the value was in
 * the collection and the block could not render it. The previous build session
 * considered binding the author into the `Category` override and rejected it —
 * the stored node would say "category" and mean "author".
 */
describe('the entry author reaches the block (AGL-1459)', () => {
  const entry = {
    title: 'Hello',
    slug: 'hello',
    authorName: 'The Aglyn Team',
    publishedAt: { seconds: 1_784_116_800 },
  }

  it('is one of the values an Entry Meta block shows', () => {
    expect(collectionEntryMetaValues(entry).author).toBe('The Aglyn Team')
  })

  it('is bindable by hand as {{entry.author}}, like every other field', () => {
    expect(collectionEntryTokens(entry, 'blog')['entry.author']).toBe(
      'The Aglyn Team',
    )
    // An entry with no byline empties rather than leaking the token.
    expect(collectionEntryTokens({}, 'blog')['entry.author']).toBe('')
  })

  it('reads the same whether it was bound or server-filled', () => {
    // The reason `collectionEntryMetaValues` exists at all: one entry has to
    // read one way on both paths.
    expect(collectionEntryMetaValues(entry).author).toBe(
      collectionEntryTokens(entry, 'blog')['entry.author'],
    )
  })

  it('applies the block’s date format to the values it fills in', () => {
    expect(collectionEntryMetaValues(entry, undefined, 'monthYear')).toEqual({
      date: formatCollectionEntryDate(entry.publishedAt, 'monthYear'),
      author: 'The Aglyn Team',
      category: '',
      tags: '',
    })
  })
})

/**
 * AGL-1459, the stamping half. `dateFormat` is a COMPOSE-TIME prop like
 * Related Posts' `limit`: it is answered where the timestamp still exists and
 * never reaches the DOM.
 */
describe('expandCollectionEntryMeta honours author and date format (AGL-1459)', () => {
  const categories = [{ id: 'guides', name: 'Guides' }]
  const entry = {
    $id: 'fHkaaFRRWF',
    title: 'From a form to a dataset in five minutes',
    slug: 'from-a-form-to-a-dataset-in-five-minutes',
    authorName: 'The Aglyn Team',
    categoryId: 'guides',
    publishedAt: { seconds: 1_784_116_800 },
  }
  const metaNodes = (props: Record<string, unknown>) =>
    ({
      root: { $id: 'root', componentId: 'stack', nodes: ['meta'] },
      meta: {
        $id: 'meta',
        componentId: 'collectionEntryMeta',
        parentId: 'root',
        props,
      },
    }) as any

  it('fills the author in, so the byline needs nothing typed', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({ showAuthor: true }),
      entry,
      categories,
    )
    expect(nodes['meta'].props.author).toBe('The Aglyn Team')
  })

  it('never overwrites a hand-typed byline', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({ author: 'Guest writer' }),
      entry,
      categories,
    )
    expect(nodes['meta'].props.author).toBe('Guest writer')
  })

  it('omits the author for an entry that genuinely has none', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({}),
      { ...entry, authorName: '' },
      categories,
    )
    expect(nodes['meta'].props).not.toHaveProperty('author')
  })

  it('stamps the chosen format instead of the raw locale date', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({ dateFormat: 'monthYear' }),
      entry,
      categories,
    )
    expect(nodes['meta'].props.date).toBe('Jul 2026')
  })

  /**
   * The live template carries the PRESET's `date: '{{entry.date}}'`, so a
   * format that only filled a blank field would do nothing on the one surface
   * it was built for — the same shape of trap the issue was filed about. The
   * token is not a hand-typed override; it names the very value being
   * reformatted, so a chosen format reformats it. A literal string still wins.
   */
  it('reformats the {{entry.date}} binding the preset seeds', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({ date: '{{entry.date}}', dateFormat: 'monthYear' }),
      entry,
      categories,
    )
    expect(nodes['meta'].props.date).toBe('Jul 2026')
  })

  it('leaves a literal Date override exactly as typed', () => {
    const nodes = expandCollectionEntryMeta(
      metaNodes({ date: 'Updated weekly', dateFormat: 'monthYear' }),
      entry,
      categories,
    )
    expect(nodes['meta'].props.date).toBe('Updated weekly')
  })

  it('changes nothing at all on the default format', () => {
    for (const props of [
      {},
      { dateFormat: COLLECTION_ENTRY_DATE_FORMAT_DEFAULT },
    ]) {
      const nodes = expandCollectionEntryMeta(
        metaNodes(props),
        entry,
        categories,
      )
      expect(nodes['meta'].props.date).toBe(
        formatCollectionEntryDate({ seconds: 1_784_116_800 }),
      )
    }
    // And a bound token stays literal for later substitution, as before.
    const bound = expandCollectionEntryMeta(
      metaNodes({ date: '{{entry.date}}' }),
      entry,
      categories,
    )
    expect(bound['meta'].props.date).toBe('{{entry.date}}')
  })
})

/**
 * AGL-2486, the card half. Custom authors made the byline a RECORD with a
 * portrait, a bio and a url, and the only block that could show one printed
 * the name alone. The live blogEntryTmpl closed every article with a card
 * whose name and blurb were typed in as literal text — text that said "The
 * Aglyn Team" under posts written by somebody else and that no edit to the
 * author record could ever reach.
 */
describe('the author card fills itself from the record (AGL-2486)', () => {
  const author = {
    name: 'Zach Gover',
    bio: 'Building the open web platform.',
    image: 'media:org:jWmGooWE3L/portrait',
    url: 'https://example.com/zach',
  }
  const entry = {
    $id: 'fHkaaFRRWF',
    title: 'From a form to a dataset in five minutes',
    slug: 'from-a-form-to-a-dataset-in-five-minutes',
    authorName: 'Zach Gover',
    author,
    publishedAt: { seconds: 1_754_714_956 },
  }
  const cardNodes = (props: Record<string, unknown> = {}) =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['card'] },
      card: {
        $id: 'card',
        componentId: 'collectionEntryAuthor',
        parentId: 'root',
        props,
      },
    }) as any

  it('reads every field off the record', () => {
    expect(collectionEntryAuthorValues(entry)).toEqual({
      name: 'Zach Gover',
      bio: 'Building the open web platform.',
      image: 'media:org:jWmGooWE3L/portrait',
      url: 'https://example.com/zach',
      // Their page HERE, which is not their own site above it (AGL-2519).
      pageUrl: '/author/zach-gover',
      links: [],
    })
  })

  it('falls back to the legacy byline string for an older entry', () => {
    // An entry written before custom authors has one field, and a card with
    // a name in it beats no card at all.
    expect(
      collectionEntryAuthorValues({ authorName: 'The Aglyn Team' }),
    ).toEqual({
      name: 'The Aglyn Team',
      bio: '',
      image: '',
      url: '',
      // A legacy byline still addresses a page, so a decade of posts by a
      // name that was never a record still lead somewhere (AGL-2519).
      pageUrl: '/author/the-aglyn-team',
      links: [],
    })
  })

  it('stamps the card, so nothing has to be typed as literal text', () => {
    const nodes = expandCollectionEntryAuthor(cardNodes(), entry)

    expect(nodes['card'].props).toEqual({
      name: 'Zach Gover',
      bio: 'Building the open web platform.',
      image: 'media:org:jWmGooWE3L/portrait',
      url: 'https://example.com/zach',
      pageUrl: '/author/zach-gover',
    })
  })

  it('never overwrites an authored value or a token awaiting substitution', () => {
    const nodes = expandCollectionEntryAuthor(
      cardNodes({ name: 'Guest writer', bio: '{{entry.authorBio}}' }),
      entry,
    )

    expect(nodes['card'].props.name).toBe('Guest writer')
    // Substitution runs later and must win.
    expect(nodes['card'].props.bio).toBe('{{entry.authorBio}}')
    expect(nodes['card'].props.image).toBe('media:org:jWmGooWE3L/portrait')
  })

  it('leaves the card empty when the entry names no author', () => {
    // Rendered as nothing, never as an empty bordered box.
    const nodes = expandCollectionEntryAuthor(cardNodes(), {
      title: 'Anonymous',
    })

    expect(nodes['card'].props).toEqual({})
  })

  it('skips the per-entry clones a listing block produced', () => {
    const cloned = cardNodes()
    cloned[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__card`] = {
      ...cloned['card'],
      $id: `${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__card`,
    }

    const nodes = expandCollectionEntryAuthor(cloned, entry)

    expect(
      nodes[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__0__card`].props,
    ).toEqual({})
  })

  it('is bindable by hand for a card the designer laid out themselves', () => {
    const tokens = collectionEntryTokens(entry, 'blog')

    expect(tokens['entry.author']).toBe('Zach Gover')
    expect(tokens['entry.authorBio']).toBe('Building the open web platform.')
    expect(tokens['entry.authorImage']).toBe('media:org:jWmGooWE3L/portrait')
    expect(tokens['entry.authorUrl']).toBe('https://example.com/zach')
  })

  it('reads the same whether it was bound or server-filled', () => {
    // The reason `collectionEntryAuthorValues` exists: one entry has to read
    // one way on both paths.
    const stamped = expandCollectionEntryAuthor(cardNodes(), entry)
    const tokens = collectionEntryTokens(entry, 'blog')

    expect(stamped['card'].props.bio).toBe(tokens['entry.authorBio'])
    expect(stamped['card'].props.image).toBe(tokens['entry.authorImage'])
    expect(stamped['card'].props.url).toBe(tokens['entry.authorUrl'])
  })

  it('shows the record’s name in the byline even undenormalized', () => {
    // The tenant copies `author.name` onto `authorName` before render, so the
    // two normally agree. Reading the record first is what keeps that a
    // convenience rather than the only thing holding the byline up.
    expect(
      collectionEntryMetaValues({ author: { name: 'Zach Gover' } }).author,
    ).toBe('Zach Gover')
  })
})

/**
 * A CARD'S DATE FORMAT HAS TO MOVE THE CARD'S DATE (AGL-2486).
 *
 * The routed-entry passes skip clones on purpose — stamping the routed entry
 * into a listing would date every card the same — so a cloned Entry Meta had
 * only its `{{entry.date}}` binding, and a binding carries no format. The
 * Date format picker sat on the card doing nothing, while the identical block
 * on the article above it obeyed it. Measured on aglyn.com/blog: every card
 * read `8/9/2026` where the article byline read `Aug 2026`.
 */
describe('entry blocks inside a listing fill from their own card (AGL-2486)', () => {
  const entries = [
    {
      $id: 'a',
      title: 'First',
      slug: 'first',
      authorName: 'Zach Gover',
      categoryId: 'guides',
      publishedAt: { seconds: 1_754_714_956 },
    },
    {
      $id: 'b',
      title: 'Second',
      slug: 'second',
      authorName: 'A Guest',
      publishedAt: { seconds: 1_784_116_800 },
    },
  ]
  const sources = {
    blog: {
      slug: 'blog',
      entries,
      categories: [{ id: 'guides', name: 'Guides' }],
    },
  } as any
  const listNodes = (metaProps: Record<string, unknown>) =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['list'] },
      list: {
        $id: 'list',
        componentId: COLLECTION_ENTRIES_COMPONENT_ID,
        parentId: 'root',
        props: { collectionSlug: 'blog' },
        nodes: ['card'],
      },
      card: {
        $id: 'card',
        componentId: 'muiStack',
        parentId: 'list',
        nodes: ['meta'],
      },
      meta: {
        $id: 'meta',
        componentId: 'collectionEntryMeta',
        parentId: 'card',
        props: metaProps,
      },
    }) as any
  const cloneMeta = (nodes: any, index: number) =>
    nodes[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__${index}__meta`]?.props

  it('applies the card’s Date format to each card’s own date', () => {
    const nodes = expandCollectionEntries(
      listNodes({ date: '{{entry.date}}', dateFormat: 'monthYear' }),
      sources,
    )
    expect(cloneMeta(nodes, 0).date).toBe(
      formatCollectionEntryDate(entries[0].publishedAt, 'monthYear'),
    )
    // The SECOND card dates itself, not the first — the whole reason the
    // routed-entry pass skips clones.
    expect(cloneMeta(nodes, 1).date).toBe(
      formatCollectionEntryDate(entries[1].publishedAt, 'monthYear'),
    )
    expect(cloneMeta(nodes, 0).date).not.toBe(cloneMeta(nodes, 1).date)
  })

  it('CONTROL — the default format is the string it has always emitted', () => {
    const nodes = expandCollectionEntries(
      listNodes({ date: '{{entry.date}}' }),
      sources,
    )
    expect(cloneMeta(nodes, 0).date).toBe(
      formatCollectionEntryDate(entries[0].publishedAt),
    )
  })

  it('fills a card block that binds nothing at all', () => {
    // "Drop it on and it works" has to hold inside a card too.
    const nodes = expandCollectionEntries(listNodes({}), sources)
    expect(cloneMeta(nodes, 0).author).toBe('Zach Gover')
    expect(cloneMeta(nodes, 1).author).toBe('A Guest')
    expect(cloneMeta(nodes, 0).category).toBe('Guides')
  })

  it('never overwrites a value typed onto the card', () => {
    const nodes = expandCollectionEntries(
      listNodes({ author: 'The editors', dateFormat: 'monthYear' }),
      sources,
    )
    expect(cloneMeta(nodes, 0).author).toBe('The editors')
    expect(cloneMeta(nodes, 1).author).toBe('The editors')
  })

  it('fills an Entry Author card from the card’s own entry', () => {
    const nodes = expandCollectionEntries(
      {
        root: { $id: 'root', componentId: 'div', nodes: ['list'] },
        list: {
          $id: 'list',
          componentId: COLLECTION_ENTRIES_COMPONENT_ID,
          parentId: 'root',
          props: { collectionSlug: 'blog' },
          nodes: ['author'],
        },
        author: {
          $id: 'author',
          componentId: 'collectionEntryAuthor',
          parentId: 'list',
          props: {},
        },
      } as any,
      sources,
    )
    const name = (index: number) =>
      nodes[`${COLLECTION_ENTRIES_NODE_ID_PREFIX}list__${index}__author`].props
        .name
    expect(name(0)).toBe('Zach Gover')
    expect(name(1)).toBe('A Guest')
  })
})

/**
 * The author's profile links reach the card (AGL-2516).
 *
 * `sameAs` never did: it is a crawler field and nothing rendered it. These are
 * the rows a reader clicks, so they travel the path the portrait and the bio
 * already take — from the record, per entry, with the template retyping
 * nothing.
 */
describe('the author card fills its links from the record (AGL-2516)', () => {
  const authored = (links: unknown) =>
    ({
      $id: 'e1',
      title: 'A post',
      slug: 'a-post',
      author: { name: 'Zach Gover', links },
    }) as any

  const cardOnly = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['a'] },
      a: {
        $id: 'a',
        componentId: 'collectionEntryAuthor',
        parentId: 'root',
        props: {},
      },
    }) as any

  it('carries the record’s rows onto the card', () => {
    expect(
      collectionEntryAuthorValues(
        authored([
          { platform: 'x', url: 'https://x.com/aglyn' },
          {
            label: 'Newsletter',
            icon: 'email-newsletter',
            iconPath: 'M0 0',
            url: 'https://e.com/n',
          },
        ]),
      ).links,
    ).toEqual([
      { platform: 'x', url: 'https://x.com/aglyn' },
      {
        label: 'Newsletter',
        icon: 'email-newsletter',
        iconPath: 'M0 0',
        url: 'https://e.com/n',
      },
    ])
  })

  it('normalizes at the boundary rather than trusting the store', () => {
    // A hand-written document reaches props without ever passing the record
    // normalizer, so an unsafe scheme has to die HERE too — not only where
    // the console writes.
    expect(
      collectionEntryAuthorValues(
        authored([
          // eslint-disable-next-line no-script-url
          { label: 'Bad', url: 'javascript:alert(1)' },
          { platform: 'github', url: 'https://github.com/aglyn' },
        ]),
      ).links,
    ).toEqual([{ platform: 'github', url: 'https://github.com/aglyn' }])
  })

  it('stamps them onto an Entry Author block', () => {
    const out: any = expandCollectionEntryAuthor(
      cardOnly(),
      authored([{ platform: 'x', url: 'https://x.com/aglyn' }]),
    )
    expect(out['a'].props['links']).toEqual([
      { platform: 'x', url: 'https://x.com/aglyn' },
    ])
  })

  it('stamps nothing when the author has none', () => {
    const out: any = expandCollectionEntryAuthor(cardOnly(), authored(undefined))
    // Absent, not an empty array: the card's emptiness check and its
    // `Show links` switch both read "no rows" from the same absence.
    expect(out['a'].props['links']).toBeUndefined()
  })
})

/**
 * The two links a byline can offer, which are not the same link (AGL-2519).
 */
describe('linking to an author from an entry (AGL-2519)', () => {
  it('offers their page here, beside their own site', () => {
    const tokens = collectionEntryTokens(
      {
        $id: 'e1',
        title: 'A post',
        slug: 'a-post',
        author: { $id: 'aB12', name: 'Zach Gover', url: 'https://zach.example' },
      } as never,
      'blog',
    )
    // Site-wide, and NAME-first rather than id-first: this is a public
    // address on a marketing site, and `/author/ab12` is not one anybody can
    // read. The id still resolves on the way back in.
    expect(tokens['entry.authorPageUrl']).toBe('/author/zach-gover')
    expect(tokens['entry.authorUrl']).toBe('https://zach.example')
  })

  it('prefers the author’s stored slug over their name', () => {
    const tokens = collectionEntryTokens(
      {
        $id: 'e1',
        title: 'A post',
        slug: 'a-post',
        author: { $id: 'aB12', name: 'Zach Gover', slug: 'zg' },
      } as never,
      'blog',
    )
    expect(tokens['entry.authorPageUrl']).toBe('/author/zg')
  })

  it('empties the token when nothing is addressable', () => {
    const tokens = collectionEntryTokens(
      { $id: 'e1', title: 'A post', slug: 'a-post' } as never,
      'blog',
    )
    // A binding then renders no link at all, rather than one pointing at
    // `/author/`.
    expect(tokens['entry.authorPageUrl']).toBe('')
  })

  it('still resolves for a legacy byline with no record', () => {
    const tokens = collectionEntryTokens(
      {
        $id: 'e1',
        title: 'A post',
        slug: 'a-post',
        authorName: 'The Aglyn Team',
      } as never,
      'blog',
    )
    expect(tokens['entry.authorPageUrl']).toBe('/author/the-aglyn-team')
  })

  it('does not depend on which collection the entry came from', () => {
    // The whole point of the reshape: one person, one page, whatever they
    // wrote in. Two collections, one address.
    const author = { $id: 'aB12', name: 'Zach Gover' }
    const inBlog = collectionEntryTokens(
      { $id: 'e1', title: 'A', slug: 'a', author } as never,
      'blog',
    )
    const inChangelog = collectionEntryTokens(
      { $id: 'e2', title: 'B', slug: 'b', author } as never,
      'changelog',
    )
    expect(inBlog['entry.authorPageUrl']).toBe(
      inChangelog['entry.authorPageUrl'],
    )
  })
})

/**
 * A listing that MIXES collections has to say where each entry came from
 * (AGL-2518) — the author page is the first one that does.
 */
describe('an entry that carries its own collection (AGL-2518)', () => {
  const base = { $id: 'e1', title: 'A post', slug: 'a-post' }

  it('builds the url from the entry’s own collection, not the routed one', () => {
    const tokens = collectionEntryTokens(
      { ...base, collectionSlug: 'changelog', collectionName: 'Changelog' } as never,
      // The routed slug an author page would otherwise pass for every card.
      '__author__',
    )
    expect(tokens['entry.url']).toBe('/changelog/a-post')
    expect(tokens['entry.collection']).toBe('Changelog')
    expect(tokens['entry.collectionSlug']).toBe('changelog')
    expect(tokens['entry.collectionUrl']).toBe('/changelog')
  })

  it('changes nothing for a single-collection listing', () => {
    // Every existing caller passes one slug and stamps nothing, so this is
    // the case that must stay byte-identical.
    const tokens = collectionEntryTokens(base as never, 'blog')
    expect(tokens['entry.url']).toBe('/blog/a-post')
    expect(tokens['entry.collection']).toBe('')
    expect(tokens['entry.collectionSlug']).toBe('blog')
  })

  it('sends each search hit to its own collection', () => {
    // The index is built from the same window the cards were, so a mixed
    // listing whose search sent every hit to one collection would be a page
    // of links to 404s.
    const index = buildCollectionSearchIndex(
      [
        { ...base, collectionSlug: 'changelog' },
        { $id: 'e2', title: 'B', slug: 'b' },
      ] as never,
      'blog',
    )
    expect(index.map((row) => row.url)).toEqual(['/changelog/a-post', '/blog/b'])
  })
})
