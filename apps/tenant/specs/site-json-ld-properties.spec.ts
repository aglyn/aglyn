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
 * THE STRUCTURED DATA EVERY PAGE TYPE CARRIES (AGL-3148).
 *
 * `buildJsonLd` returns early four times, and until this issue `WebSite` was
 * pushed only in the fifth — so a live audit of aglyn.com found it on `/`,
 * `/product` and `/alternatives/webflow` and absent from `/blog`,
 * `/blog/category/product`, `/blog/one-platform-not-a-stack` and
 * `/author/zach-gover`: between them, most of a content site's indexed URLs.
 *
 * These pin the site-wide set against EVERY branch, the way the head's
 * property set is pinned in `page-seo-properties.spec.ts`. A node that only
 * one branch emits is the defect, so a test that only checks one branch
 * cannot see it.
 */

jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// The client renderer is a large browser-side graph; the JSON-LD is emitted by
// the server component beside it and nothing here mounts it.
jest.mock('../app/[host]/[scheme]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import CatchAllPage from '../app/[host]/[scheme]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const ORIGIN = 'https://custom.example'
const SITE_X = 'https://twitter.com/AcmeSoftware'
const SITE_LINKEDIN = 'https://www.linkedin.com/company/acme'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'about/team' },
  seo: { title: 'Acme Widgets' },
  business: {
    socialLinks: [
      { label: 'X', url: SITE_X },
      { label: 'LinkedIn', url: SITE_LINKEDIN },
    ],
  },
}

/** Renders the route and returns every JSON-LD block it emitted, parsed. */
const blocksFor = async (props: Record<string, unknown>, slug: string[]) => {
  mockLoad.mockResolvedValue({ props: { nodes: null, ...props } })
  const tree = await CatchAllPage({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never)
  // The route renders `<script dangerouslySetInnerHTML>` per block; walking
  // the element tree reads what the HTML would carry without a DOM.
  const raw: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const html = node.props?.dangerouslySetInnerHTML?.__html
    if (typeof html === 'string') raw.push(html)
    walk(node.props?.children)
  }
  walk(tree)
  return raw.map((block) => JSON.parse(block) as Record<string, any>)
}

const nodeOfType = (blocks: Record<string, any>[], type: string) =>
  blocks.find((block) => block['@type'] === type)

/** The four shapes `buildJsonLd` returns early with, plus the general case. */
const PAGE_TYPES: Array<{
  name: string
  slug: string[]
  props: Record<string, unknown>
}> = [
  {
    name: 'a screen',
    slug: ['about', 'team'],
    props: {
      data: {
        host: HOST,
        screen: { data: { $id: 'screen-1', displayName: 'Team' } },
      },
    },
  },
  {
    name: 'a collection listing',
    slug: ['blog'],
    props: {
      data: { host: HOST },
      content: {
        collection: { slug: 'blog', displayName: 'Blog' },
        entries: [{ $id: 'e1', title: 'Hello', slug: 'hello' }],
      },
    },
  },
  {
    name: 'a category listing',
    slug: ['blog', 'category', 'guides'],
    props: {
      data: { host: HOST },
      content: {
        collection: { slug: 'blog', displayName: 'Blog' },
        category: { slug: 'guides', name: 'Guides', known: true },
        entries: [{ $id: 'e1', title: 'Hello', slug: 'hello' }],
      },
    },
  },
  {
    name: 'a content entry',
    slug: ['blog', 'hello'],
    props: {
      data: { host: HOST },
      content: {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: { $id: 'e1', title: 'Hello', slug: 'hello', excerpt: 'An entry' },
      },
    },
  },
  {
    name: 'an author page',
    slug: ['author', 'ada'],
    props: {
      data: { host: HOST },
      author: {
        slug: 'ada',
        name: 'Ada Lovelace',
        record: { $id: 'a1', name: 'Ada Lovelace', slug: 'ada' },
        page: 1,
        totalPages: 1,
        totalEntries: 2,
      },
    },
  },
]

beforeEach(() => jest.clearAllMocks())

describe.each(PAGE_TYPES)('$name', ({ slug, props }) => {
  it('publishes the site entity AND the site itself', async () => {
    const blocks = await blocksFor(props, slug)

    const organization = nodeOfType(blocks, 'Organization')
    const website = nodeOfType(blocks, 'WebSite')
    expect(organization).toBeDefined()
    expect(website).toBeDefined()
    expect(website?.['url']).toBe(ORIGIN)
    expect(website?.['name']).toBe('Acme Widgets')
  })

  it('names the language the page is in', async () => {
    // `inLanguage` was absent from every node on every page type, while the
    // head declared a language and the hreflang map keyed on one.
    const blocks = await blocksFor(props, slug)
    expect(nodeOfType(blocks, 'WebSite')?.['inLanguage']).toBe('en')
  })

  it('claims the profiles the site renders as its own', async () => {
    /*
      `seo.entity.sameAs` was the only field read and a production sweep found
      it unset on every host on the platform, so no site published a single
      profile — while `business.socialLinks` sat one field over, populated and
      being drawn into the site's own footer.
    */
    const blocks = await blocksFor(props, slug)
    expect(nodeOfType(blocks, 'Organization')?.['sameAs']).toEqual([
      SITE_X,
      SITE_LINKEDIN,
    ])
  })
})

describe('the WebSite node', () => {
  it('omits its name rather than calling an unnamed site “Site”', async () => {
    /*
      This read `name: siteTitle ?? host.displayName ?? 'Site'`. A site whose
      owner had filled in no name published the literal word "Site" as its
      name, into the structured data search engines read — a placeholder, and
      the one thing this issue says never to emit.
    */
    const blocks = await blocksFor(
      {
        data: {
          host: {
            $id: 'host-1',
            subdomain: 'acme',
            cname: 'custom.example',
            screens: { 'screen-1': 'about' },
            seo: {},
          },
          screen: { data: { $id: 'screen-1', displayName: 'About' } },
        },
      },
      ['about'],
    )

    const website = nodeOfType(blocks, 'WebSite')
    expect(website).toBeDefined()
    expect(website && 'name' in website).toBe(false)
    expect(JSON.stringify(blocks)).not.toMatch(/"Site"/)
  })

  it('takes the business name when the site has no title of its own', async () => {
    const blocks = await blocksFor(
      {
        data: {
          host: {
            $id: 'host-1',
            subdomain: 'acme',
            cname: 'custom.example',
            screens: { 'screen-1': 'about' },
            seo: { entity: { name: 'Acme Holdings LLC' } },
          },
          screen: { data: { $id: 'screen-1', displayName: 'About' } },
        },
      },
      ['about'],
    )

    expect(nodeOfType(blocks, 'WebSite')?.['name']).toBe('Acme Holdings LLC')
  })
})

describe('the page-level node of each type', () => {
  it('names the language on a ProfilePage', async () => {
    const page = PAGE_TYPES.find((type) => type.name === 'an author page')!
    const blocks = await blocksFor(page.props, page.slug)
    expect(nodeOfType(blocks, 'ProfilePage')?.['inLanguage']).toBe('en')
  })

  it('names the language on an Article', async () => {
    const page = PAGE_TYPES.find((type) => type.name === 'a content entry')!
    const blocks = await blocksFor(page.props, page.slug)
    expect(nodeOfType(blocks, 'Article')?.['inLanguage']).toBe('en')
  })

  it('takes the screen’s own locale over the site default', async () => {
    const blocks = await blocksFor(
      {
        data: {
          host: { ...HOST, defaultLocale: 'de' },
          screen: {
            data: { $id: 'screen-1', displayName: 'Team', locale: 'fr-CA' },
          },
        },
      },
      ['about', 'team'],
    )
    // BCP-47 here, where the head emits `fr_CA` — `inLanguage` takes the
    // hyphenated form and `og:locale` the underscored one, from one resolver.
    expect(nodeOfType(blocks, 'WebSite')?.['inLanguage']).toBe('fr-CA')
  })
})

describe('the ItemList of a DEEP listing page (AGL-3213)', () => {
  /** `/blog/page/7` as the loader now hands it over: ten entries, page 7. */
  const page7 = {
    data: { host: HOST },
    content: {
      collection: { slug: 'blog', displayName: 'Blog' },
      pagination: { page: 7, perPage: 10, totalEntries: 100, totalPages: 10 },
      entries: Array.from({ length: 10 }, (_, i) => ({
        $id: `e${61 + i}`,
        title: `Post ${61 + i}`,
        slug: `post-${61 + i}`,
      })),
    },
  }

  it('counts the items this page has, not the ones the read held', async () => {
    /*
      `numberOfItems` and the positions below are ONE claim, and it used to be
      false in both halves at once. The loader serialized the whole bounded
      read into props — up to a hundred entries — and this builder maps all of
      them while numbering from `pagination.page`, so `/blog/page/7` told
      every crawler that the page carried a hundred items at positions 61
      through 160. Sixty of those positions name entries the collection does
      not have.
    */
    const blocks = await blocksFor(page7, ['blog', 'page', '7'])
    const list = nodeOfType(blocks, 'ItemList')

    expect(list?.['numberOfItems']).toBe(10)
  })

  it('numbers them from where the page actually starts', async () => {
    const blocks = await blocksFor(page7, ['blog', 'page', '7'])
    const items = nodeOfType(blocks, 'ItemList')?.['itemListElement']

    expect(items.map((item: any) => item.position)).toEqual([
      61, 62, 63, 64, 65, 66, 67, 68, 69, 70,
    ])
    // …and each position names the entry standing at it, which is the whole
    // point of numbering across pages rather than restarting at 1.
    expect(items[0].name).toBe('Post 61')
    expect(items[0].url).toBe(`${ORIGIN}/blog/post-61`)
    expect(items[9].name).toBe('Post 70')
  })

  it('still numbers an unpaginated listing from one', async () => {
    const blocks = await blocksFor(
      {
        data: { host: HOST },
        content: {
          collection: { slug: 'blog', displayName: 'Blog' },
          entries: [
            { $id: 'e1', title: 'Hello', slug: 'hello' },
            { $id: 'e2', title: 'World', slug: 'world' },
          ],
        },
      },
      ['blog'],
    )
    const items = nodeOfType(blocks, 'ItemList')?.['itemListElement']

    expect(items.map((item: any) => item.position)).toEqual([1, 2])
  })
})

describe('the author page’s breadcrumb', () => {
  const authorPage = PAGE_TYPES.find((type) => type.name === 'an author page')!

  it('publishes a trail, as the entry and category pages do', async () => {
    const blocks = await blocksFor(authorPage.props, authorPage.slug)
    const crumbs = nodeOfType(blocks, 'BreadcrumbList')

    expect(crumbs?.['itemListElement']).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Acme Widgets',
        item: `${ORIGIN}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Ada Lovelace',
        item: `${ORIGIN}/author/ada`,
      },
    ])
  })

  it('roots the trail at a page the site actually serves', async () => {
    /*
      Nothing on this platform answers a bare `/author` — it 404s on a live
      site — so an "Authors" crumb would be a fabricated step in the trail.
      Home is the nearest parent that exists.
    */
    const blocks = await blocksFor(authorPage.props, authorPage.slug)
    const items = nodeOfType(blocks, 'BreadcrumbList')?.['itemListElement']
    expect(items.map((item: any) => item.item)).not.toContain(`${ORIGIN}/author`)
  })

  it('publishes no trail for a site with no name to head it', async () => {
    // One crumb is the page restating its own title, which Google treats as
    // ineligible — the helper declines it rather than padding the list.
    const blocks = await blocksFor(
      {
        data: {
          host: {
            $id: 'host-1',
            subdomain: 'acme',
            cname: 'custom.example',
            screens: {},
            seo: {},
          },
        },
        author: authorPage.props['author'],
      },
      authorPage.slug,
    )

    expect(nodeOfType(blocks, 'BreadcrumbList')).toBeUndefined()
  })
})
