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
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
  resolveCollectionTemplateScreenId,
} from './compose-collection-page'
import composeScreenNodes, {
  composeNodesWithChrome,
} from './compose-screen-nodes'
import type { CollectionContent } from './get-collection-content'
import getScreen from './get-screen'

jest.mock('./compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(),
  composeNodesWithChrome: jest.fn(),
}))
jest.mock('./get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
  getScreen: jest.fn(),
}))

const composeScreenNodesMock = composeScreenNodes as jest.Mock
const composeNodesWithChromeMock = composeNodesWithChrome as jest.Mock
const getScreenMock = getScreen as jest.Mock

const content = (
  overrides: Partial<CollectionContent> = {},
): CollectionContent => ({
  collection: {
    $id: 'col-1',
    displayName: 'Blog',
    slug: 'blog',
    listScreenId: undefined,
    entryScreenId: undefined,
    templateScreenId: undefined,
  },
  entries: [
    { $id: 'e1', title: 'Hello', slug: 'hello', excerpt: 'Hi' },
  ],
  entry: null,
  error: null,
  ...overrides,
})

const entry = {
  $id: 'e1',
  title: 'Hello world',
  slug: 'hello-world',
  excerpt: 'The first post',
  body: '# Heading',
  coverImage: 'https://cdn.example.com/cover.png',
  category: 'Guides',
  tags: ['nextjs', 'seo'],
  publishedAt: { seconds: 1_700_000_000 },
}

beforeEach(() => {
  jest.clearAllMocks()
  getScreenMock.mockResolvedValue({
    screen: { $id: 'scr-1', displayName: 'Template', layoutId: 'lay-1' },
  })
  composeScreenNodesMock.mockResolvedValue({ root: {} })
  composeNodesWithChromeMock.mockResolvedValue({ root: {} })
})

describe('resolveCollectionTemplateScreenId (AGL-551)', () => {
  it('routes lists through listScreenId only', () => {
    expect(
      resolveCollectionTemplateScreenId({ listScreenId: 'list-1' }, 'list'),
    ).toBe('list-1')
    expect(
      resolveCollectionTemplateScreenId(
        { entryScreenId: 'entry-1', templateScreenId: 'legacy-1' },
        'list',
      ),
    ).toBeUndefined()
  })

  it('routes entries through entryScreenId with legacy fallback', () => {
    expect(
      resolveCollectionTemplateScreenId(
        { entryScreenId: 'entry-1', templateScreenId: 'legacy-1' },
        'entry',
      ),
    ).toBe('entry-1')
    expect(
      resolveCollectionTemplateScreenId(
        { templateScreenId: 'legacy-1' },
        'entry',
      ),
    ).toBe('legacy-1')
    expect(resolveCollectionTemplateScreenId({}, 'entry')).toBeUndefined()
  })
})

describe('composeCollectionTemplatePage (AGL-551)', () => {
  it('returns null when no template screen is designated', async () => {
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: content(),
    })
    expect(result).toBeNull()
    expect(getScreenMock).not.toHaveBeenCalled()
  })

  it('composes entry routes with {{entry.*}} tokens and entry SEO', async () => {
    const data = content({ entry })
    data.collection!.entryScreenId = 'entry-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    // `allowTemplate` is the flag that makes this composition legal against a
    // `kind: 'template'` document (AGL-1400) — every path-resolving caller
    // leaves it off, which is what 404s a template at an address of its own.
    expect(getScreenMock).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'entry-screen',
      allowTemplate: true,
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.tokens['entry.title']).toBe('Hello world')
    expect(composeArgs.tokens['entry.url']).toBe('/blog/hello-world')
    expect(composeArgs.tokens['entry.body']).toBe('# Heading')
    expect(composeArgs.tokens['entry.category']).toBe('Guides')
    expect(composeArgs.tokens['entry.tags']).toBe('nextjs, seo')
    expect(composeArgs.tokens['collection.name']).toBe('Blog')
    // Related posts (AGL-582): entry renders carry the routed entry.
    expect(composeArgs.collection).toEqual({ slug: 'blog', entry })
    expect(result?.screen['seo']).toEqual({
      title: 'Hello world',
      description: 'The first post',
      image: 'https://cdn.example.com/cover.png',
    })
    expect(result?.nodes).toEqual({ root: {} })
  })

  it('prefers seoTitle/seoDescription over title/excerpt (AGL-582)', async () => {
    const data = content({
      entry: {
        ...entry,
        seoTitle: 'SEO title',
        seoDescription: 'SEO description',
      },
    })
    data.collection!.entryScreenId = 'entry-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    expect(result?.screen['seo']).toEqual({
      title: 'SEO title',
      description: 'SEO description',
      image: 'https://cdn.example.com/cover.png',
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.tokens['entry.seoTitle']).toBe('SEO title')
    expect(composeArgs.tokens['entry.seoDescription']).toBe('SEO description')
  })

  it('resolves entry.category through the collection taxonomy (AGL-582)', async () => {
    const data = content({
      entry: { ...entry, category: undefined, categoryId: 'guides' },
    })
    data.collection!.entryScreenId = 'entry-screen'
    data.collection!.categories = [{ id: 'guides', name: 'Guides' }]
    await composeCollectionTemplatePage({ hostId: 'host-1', content: data })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    // The stable categoryId resolves to its display name…
    expect(composeArgs.tokens['entry.category']).toBe('Guides')
    // …and the taxonomy rides the collection context for block expansion.
    expect(composeArgs.collection.categories).toEqual([
      { id: 'guides', name: 'Guides' },
    ])
  })

  it('composes list routes with the fetched entries in context', async () => {
    const data = content()
    data.collection!.listScreenId = 'list-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.screenId).toBe('list-screen')
    expect(composeArgs.collection).toEqual({
      slug: 'blog',
      entries: data.entries,
    })
    expect(composeArgs.tokens).toEqual({
      'collection.name': 'Blog',
      'collection.slug': 'blog',
      // Empty on the unfiltered listing, so a template can bind them
      // unconditionally (AGL-1321).
      'collection.category': '',
      'collection.categorySlug': '',
      // An unpaginated listing is page 1 of 1 with nowhere to page to
      // (AGL-1386).
      'pagination.page': '1',
      'pagination.totalPages': '1',
      'pagination.prevUrl': '',
      'pagination.nextUrl': '',
    })
    // The template's SEO passes through as the screen wrote it (AGL-1345):
    // this once defaulted to the collection's display name, which left the
    // head unable to tell an authored title from a generated one.
    expect(result?.screen['seo']).toEqual({})
  })

  it('passes a list template’s authored SEO through untouched (AGL-1345)', async () => {
    getScreenMock.mockResolvedValue({
      screen: {
        $id: 'scr-1',
        displayName: 'Template',
        layoutId: 'lay-1',
        seo: {
          title: 'Changelog — What we’ve shipped | Acme',
          description: 'New features and improvements, updated as we ship.',
        },
      },
    })
    const data = content()
    data.collection!.listScreenId = 'list-screen'

    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })

    expect(result?.screen['seo']).toEqual({
      title: 'Changelog — What we’ve shipped | Acme',
      description: 'New features and improvements, updated as we ship.',
    })
  })

  it('hands the routed category and page to the list template (AGL-1321)', async () => {
    const data = content({
      category: { slug: 'open-source', id: 'opensrc', name: 'Open source', known: true },
      pagination: { page: 2, perPage: 10, totalPages: 3, totalEntries: 21 },
    })
    data.collection!.listScreenId = 'list-screen'
    data.collection!.categories = [{ id: 'opensrc', name: 'Open source' }]
    await composeCollectionTemplatePage({ hostId: 'host-1', content: data })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    // `entries` arrive ALREADY filtered by the reader; the block repeats
    // what the route resolved. The page rides along so a template listing
    // renders page 2 instead of re-serving page 1 at a second URL, and the
    // category slug marks the current pill.
    expect(composeArgs.collection).toEqual({
      slug: 'blog',
      entries: data.entries,
      categories: [{ id: 'opensrc', name: 'Open source' }],
      page: 2,
      categorySlug: 'open-source',
    })
    expect(composeArgs.tokens['collection.category']).toBe('Open source')
    expect(composeArgs.tokens['collection.categorySlug']).toBe('open-source')
  })

  describe('{{pagination.*}} on a list template (AGL-1386)', () => {
    // One static list screen serves EIGHT routes. A hand-built pager on it
    // renders identically on all of them, so the tokens have to carry the
    // difference — including the category, or "next" walks the reader off
    // the filter and onto the unfiltered page 2.
    const listTokens = async (
      pagination: CollectionContent['pagination'],
      category?: CollectionContent['category'],
    ) => {
      composeScreenNodesMock.mockClear()
      const data = content({ pagination, ...(category ? { category } : {}) })
      data.collection!.listScreenId = 'list-screen'
      await composeCollectionTemplatePage({ hostId: 'host-1', content: data })
      return composeScreenNodesMock.mock.calls[0][0].tokens
    }
    /**
     * The real route → the loader's content, so the fixture cannot quietly
     * disagree with the route table. Names the five categories `blogListTmpl`
     * actually serves; with 11 posts at 10 per page the unfiltered set is 2
     * pages and every category is exactly 1.
     */
    const CATEGORY_NAMES: Record<string, string> = {
      product: 'Product',
      engineering: 'Engineering',
      'open-source': 'Open source',
      guides: 'Guides',
      company: 'Company',
    }
    const routeTokens = async (path: string) => {
      const route = Aglyn.parseCollectionRoute(path.split('/').filter(Boolean))
      expect(route).not.toBeNull()
      const categorySlug = route!.categorySlug
      return listTokens(
        {
          page: route!.page,
          perPage: 10,
          // A category listing is one page; the unfiltered set is two.
          totalPages: categorySlug ? 1 : 2,
          totalEntries: categorySlug ? 3 : 11,
        },
        categorySlug
          ? {
              slug: categorySlug,
              name: CATEGORY_NAMES[categorySlug] ?? categorySlug,
              known: true,
            }
          : undefined,
      )
    }

    it('pages the unfiltered listing across /blog, /blog/page/1 and /page/2', async () => {
      // /blog and /blog/page/1 are the SAME page, and page 1 is the bare
      // listing — so "newer" from page 2 is /blog, never /blog/page/1.
      for (const path of ['/blog', '/blog/page/1']) {
        const tokens = await routeTokens(path)
        expect(tokens['pagination.page']).toBe('1')
        expect(tokens['pagination.totalPages']).toBe('2')
        expect(tokens['pagination.prevUrl']).toBe('')
        expect(tokens['pagination.nextUrl']).toBe('/blog/page/2')
      }
      const last = await routeTokens('/blog/page/2')
      expect(last['pagination.page']).toBe('2')
      expect(last['pagination.totalPages']).toBe('2')
      expect(last['pagination.prevUrl']).toBe('/blog')
      expect(last['pagination.nextUrl']).toBe('')
    })

    it('goes EMPTY at both edges on the five one-page category routes', async () => {
      // Without this, a hand-built "Older →" shows on all five — and points
      // at the UNFILTERED page 2.
      for (const slug of Object.keys(CATEGORY_NAMES)) {
        const tokens = await routeTokens(`/blog/category/${slug}`)
        expect(tokens['pagination.page']).toBe('1')
        expect(tokens['pagination.totalPages']).toBe('1')
        expect(tokens['pagination.prevUrl']).toBe('')
        expect(tokens['pagination.nextUrl']).toBe('')
        // …while the category itself still resolves, so one pager can sit
        // next to a heading that names the slice.
        expect(tokens['collection.categorySlug']).toBe(slug)
      }
    })

    it('CARRIES THE CATEGORY when a filtered listing does have a next page', async () => {
      // The whole point of routing the URLs through the shared builder: a
      // next that dropped the filter dumps the reader on the unfiltered list.
      const category = {
        slug: 'open-source',
        name: 'Open source',
        known: true,
      }
      const first = await listTokens(
        { page: 1, perPage: 10, totalPages: 3, totalEntries: 21 },
        category,
      )
      expect(first['pagination.prevUrl']).toBe('')
      expect(first['pagination.nextUrl']).toBe(
        '/blog/category/open-source/page/2',
      )
      const middle = await listTokens(
        { page: 2, perPage: 10, totalPages: 3, totalEntries: 21 },
        category,
      )
      expect(middle['pagination.prevUrl']).toBe('/blog/category/open-source')
      expect(middle['pagination.nextUrl']).toBe(
        '/blog/category/open-source/page/3',
      )
    })

    it('gives an entry template the same tokens, inert', async () => {
      // Entry routes have no listing to page; binding a pager there is
      // pointless but must not emit a link to a page that isn't.
      const data = content({ entry })
      data.collection!.entryScreenId = 'entry-screen'
      await composeCollectionTemplatePage({ hostId: 'host-1', content: data })
      const tokens = composeScreenNodesMock.mock.calls[0][0].tokens
      expect(tokens['pagination.page']).toBe('1')
      expect(tokens['pagination.totalPages']).toBe('1')
      expect(tokens['pagination.prevUrl']).toBe('')
      expect(tokens['pagination.nextUrl']).toBe('')
    })
  })

  it('falls through when the template fails to compose', async () => {
    const data = content({ entry })
    data.collection!.templateScreenId = 'legacy-screen'
    composeScreenNodesMock.mockResolvedValue(null)
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    expect(result).toBeNull()
  })
})

describe('composeCollectionFallbackPage (AGL-551)', () => {
  const host = {
    $id: 'host-1',
    screens: { 'home-screen': Aglyn.SCREEN_ROOT_PATH, other: 'about' },
  } as never

  it('wraps the built-in list in the home screen layout chrome', async () => {
    const result = await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content(),
    })
    expect(getScreenMock).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'home-screen',
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    expect(chromeArgs.layoutId).toBe('lay-1')
    expect(chromeArgs.collection).toEqual({
      slug: 'blog',
      entries: content().entries,
    })
    const componentIds = Object.values(chromeArgs.screenNodes).map(
      (node: any) => node.componentId,
    )
    expect(componentIds).toContain(Aglyn.COLLECTION_ENTRIES_COMPONENT_ID)
    expect(result?.nodes).toEqual({ root: {} })
  })

  it('gives the built-in list a pill row when the collection has categories (AGL-1321)', async () => {
    const data = content()
    data.collection!.categories = [{ id: 'opensrc', name: 'Open source' }]
    await composeCollectionFallbackPage({ hostId: 'host-1', host, content: data })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const componentIds = Object.values(chromeArgs.screenNodes).map(
      (node: any) => node.componentId,
    )
    expect(componentIds).toContain(Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID)
  })

  it('renders an honest empty state for a category with no entries (AGL-1321)', async () => {
    const data = content({
      entries: [],
      category: { slug: 'guides', name: 'Guides', known: true },
    })
    data.collection!.categories = [{ id: 'guides', name: 'Guides' }]
    await composeCollectionFallbackPage({ hostId: 'host-1', host, content: data })
    const nodes = Object.values(
      composeNodesWithChromeMock.mock.calls[0][0].screenNodes,
    ) as any[]
    const componentIds = nodes.map((node) => node.componentId)
    // No repeater at all — an empty grid is what a "broken" listing looks
    // like; a sentence naming the category is what an empty one looks like.
    expect(componentIds).not.toContain(Aglyn.COLLECTION_ENTRIES_COMPONENT_ID)
    expect(
      nodes.some((node) =>
        String(node.props?.children ?? '').includes(
          'Nothing published in Guides yet.',
        ),
      ),
    ).toBe(true)
    // The pills survive the empty state, or the reader has no way back.
    expect(componentIds).toContain(Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID)
    // The heading names the slice, not just the collection.
    expect(
      nodes.some((node) => node.props?.children === 'Blog · Guides'),
    ).toBe(true)
  })

  it('keeps the pager inside the category it is paging (AGL-1321)', async () => {
    const data = content({
      category: { slug: 'guides', name: 'Guides', known: true },
      pagination: { page: 2, perPage: 10, totalPages: 3, totalEntries: 21 },
    })
    await composeCollectionFallbackPage({ hostId: 'host-1', host, content: data })
    const nodes = Object.values(
      composeNodesWithChromeMock.mock.calls[0][0].screenNodes,
    ) as any[]
    const hrefs = nodes
      .map((node) => node.props?.href)
      .filter((href): href is string => typeof href === 'string')
    // A "next" that dropped the filter would silently return the reader to
    // the unfiltered list.
    expect(hrefs).toContain('/blog/category/guides')
    expect(hrefs).toContain('/blog/category/guides/page/3')
  })

  describe('the built-in pager is unchanged by the tokens (AGL-1386)', () => {
    // `paginationNodes` now reads the same computation the tokens do. A
    // collection with NO authored list screen must still get exactly the
    // pager it got before: prev only past page 1, next only before the last.
    const pagerHrefs = async (
      pagination: CollectionContent['pagination'],
      category?: CollectionContent['category'],
    ) => {
      composeNodesWithChromeMock.mockClear()
      const data = content({ pagination, ...(category ? { category } : {}) })
      await composeCollectionFallbackPage({
        hostId: 'host-1',
        host,
        content: data,
      })
      const nodes = Object.values(
        composeNodesWithChromeMock.mock.calls[0][0].screenNodes,
      ) as any[]
      return {
        labels: nodes
          .map((node) => node.props?.children)
          .filter((value): value is string => typeof value === 'string'),
        hrefs: nodes
          .map((node) => node.props?.href)
          .filter((value): value is string => typeof value === 'string'),
      }
    }

    it('drops the prev link on page 1 and the next link on the last', async () => {
      const first = await pagerHrefs({
        page: 1,
        perPage: 10,
        totalPages: 3,
        totalEntries: 21,
      })
      expect(first.labels).toContain('Older →')
      expect(first.labels).not.toContain('← Newer')
      expect(first.hrefs).toContain('/blog/page/2')
      expect(first.labels).toContain('Page 1 of 3')

      const last = await pagerHrefs({
        page: 3,
        perPage: 10,
        totalPages: 3,
        totalEntries: 21,
      })
      expect(last.labels).toContain('← Newer')
      expect(last.labels).not.toContain('Older →')
      // Page 1 is the bare listing, so "newer" from page 2 is /blog.
      expect(last.hrefs).toContain('/blog/page/2')
      expect(last.labels).toContain('Page 3 of 3')
    })

    it('renders no pager at all on a single-page listing', async () => {
      const only = await pagerHrefs(
        { page: 1, perPage: 10, totalPages: 1, totalEntries: 3 },
        { slug: 'guides', name: 'Guides', known: true },
      )
      expect(only.labels).not.toContain('← Newer')
      expect(only.labels).not.toContain('Older →')
      expect(only.labels).not.toContain('Page 1 of 1')
      // Only the entry template's own "Read more" link survives.
      expect(only.hrefs).not.toContain('/blog')
    })
  })

  it('renders entries through the markdown Entry body block', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content({ entry }),
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const bodyNode: any = Object.values(chromeArgs.screenNodes).find(
      (node: any) =>
        node.componentId === Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID,
    )
    expect(bodyNode?.props?.markdown).toBe('# Heading')
    // Entry routes hand the routed entry over for Related posts (AGL-582);
    // the empty just-this-entry list must NOT mask on-demand fetching.
    expect(chromeArgs.collection).toEqual({ slug: 'blog', entry })
  })

  it('includes meta/related/share blocks, image-component-free (AGL-582)', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content({ entry }),
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const nodes = Object.values(chromeArgs.screenNodes) as any[]
    const componentIds = nodes.map((node) => node.componentId)
    expect(componentIds).toContain(Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID)
    expect(componentIds).toContain(Aglyn.COLLECTION_RELATED_COMPONENT_ID)
    expect(componentIds).toContain(Aglyn.COLLECTION_SHARE_COMPONENT_ID)
    const metaNode = nodes.find(
      (node) =>
        node.componentId === Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
    )
    expect(metaNode?.props?.category).toBe('Guides')
    expect(metaNode?.props?.tags).toBe('nextjs, seo')
    // The first-party image component crashes tenant SSR (AGL-579): the
    // cover renders as a background-image stack instead.
    expect(componentIds).not.toContain('image')
    const coverNode = nodes.find((node) =>
      String(node.props?.sx?.backgroundImage ?? '').includes(
        'https://cdn.example.com/cover.png',
      ),
    )
    expect(coverNode?.componentId).toBe('muiStack')
  })

  it('resolves the fallback meta category via the taxonomy (AGL-582)', async () => {
    const data = content({
      entry: { ...entry, category: undefined, categoryId: 'guides' },
    })
    data.collection!.categories = [{ id: 'guides', name: 'Guides' }]
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: data,
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const metaNode: any = Object.values(chromeArgs.screenNodes).find(
      (node: any) =>
        node.componentId === Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
    )
    expect(metaNode?.props?.category).toBe('Guides')
    expect(chromeArgs.collection.categories).toEqual([
      { id: 'guides', name: 'Guides' },
    ])
  })

  it('skips the layout lookup when the host has no home screen', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host: { $id: 'host-1', screens: { a: 'about' } } as never,
      content: content(),
    })
    expect(getScreenMock).not.toHaveBeenCalled()
    expect(composeNodesWithChromeMock.mock.calls[0][0].layoutId).toBeUndefined()
  })

  it('fails open to null when composition throws', async () => {
    composeNodesWithChromeMock.mockRejectedValue(new Error('boom'))
    const result = await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content(),
    })
    expect(result).toBeNull()
  })
})
