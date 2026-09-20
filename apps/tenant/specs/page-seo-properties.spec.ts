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
 * EVERY OPEN GRAPH AND TWITTER PROPERTY A PAGE TYPE CARRIES (AGL-3148).
 *
 * The set is pinned per page type, here, because twice now a field has gone
 * missing without anything failing: AGL-2689 and AGL-1343 were both "a field
 * the tenant never read", found by looking at a live page rather than by a
 * red test. A property that only one branch emits is a property three page
 * types silently lack — `buildMetadata` returns early four times, and a live
 * audit of aglyn.com found `og:locale`, `og:locale:alternate`, `twitter:site`
 * and `twitter:creator` absent from all four.
 *
 * So each `describe` below asserts the WHOLE set for one page type, including
 * the properties that must stay ABSENT when there is nothing behind them.
 */

jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// The client renderer is a large browser-side graph and nothing here renders
// it; `generateMetadata` never touches it.
jest.mock('../app/[host]/[scheme]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import { generateMetadata } from '../app/[host]/[scheme]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const ORIGIN = 'https://custom.example'

/** The X profile the site renders in its own footer, and nowhere else. */
const SITE_X = 'https://twitter.com/AcmeSoftware'
const AUTHOR_X = 'https://x.com/adalovelace'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: { 'screen-1': 'about/team' },
  seo: { title: 'Acme Widgets', separator: '|' },
  business: { socialLinks: [{ label: 'X', url: SITE_X }] },
}

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

beforeEach(() => jest.clearAllMocks())

/**
 * The properties EVERY page type must carry, whatever branch built it.
 *
 * Asserted from one helper rather than restated six times, so a branch that
 * stops emitting one of them fails in the page type that lost it AND cannot
 * be "fixed" by quietly deleting a line from its own expectations.
 */
const expectSiteWideProperties = (metadata: any) => {
  // The brand travels with every share. This was gated on `seo.title` alone,
  // so a site with neither an SEO title nor a display name shared as a card
  // naming nobody.
  expect(metadata.openGraph.siteName).toBe('Acme Widgets')
  // The language the page is in — absent from every page type on the platform
  // before this, while the document itself declared one.
  expect(metadata.openGraph.locale).toBe('en')
  // The account the card is attributed to, read back out of the site's own
  // rendered social links.
  expect(metadata.twitter.site).toBe('@AcmeSoftware')
  // An absolute URL, because a crawler resolves it without a page.
  expect(metadata.openGraph.url).toMatch(/^https:\/\/custom\.example\//)
}

describe('a screen', () => {
  const givenScreen = (
    screen: Record<string, unknown> = {},
    host: Record<string, unknown> = {},
  ) =>
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: { ...HOST, ...host },
          screen: {
            data: {
              $id: 'screen-1',
              displayName: 'Team',
              description: 'The people behind Acme.',
              ...screen,
            },
          },
        },
        nodes: null,
      },
    })

  it('carries the whole site-wide set', async () => {
    givenScreen()
    const metadata = await metadataFor(['about', 'team'])

    expectSiteWideProperties(metadata)
    expect(metadata.openGraph.type).toBe('website')
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/about/team`)
  })

  it('names the translations it has, and never itself', async () => {
    /*
      `og:locale:alternate` is read off the very map that drives
      `alternates.languages`, so a locale is advertised to a card only once its
      variant resolves to a routed path — the same test a crawler's hreflang
      link has to pass.
    */
    givenScreen(
      { locale: 'en', localeVariants: { fr: 'screen-fr', de: 'screen-gone' } },
      { screens: { 'screen-1': 'about/team', 'screen-fr': 'fr/equipe' } },
    )

    const metadata = await metadataFor(['about', 'team'])

    expect(metadata.openGraph.alternateLocale).toEqual(['fr'])
    expect(metadata.alternates.languages).toEqual({
      fr: `${ORIGIN}/fr/equipe`,
      en: `${ORIGIN}/about/team`,
    })
    // `de` names a variant the routing map has no path for, so it reaches
    // neither surface — an alternate with no page is a promise of a
    // translation that does not exist.
    expect(metadata.openGraph.alternateLocale).not.toContain('de')
  })

  it('takes its locale from the screen, over the site default', async () => {
    givenScreen({ locale: 'fr-CA' }, { defaultLocale: 'de' })
    const metadata = await metadataFor(['about', 'team'])
    expect(metadata.openGraph.locale).toBe('fr_CA')
  })

  it('emits no alternate locales for a page with no variants', async () => {
    givenScreen()
    const metadata = await metadataFor(['about', 'team'])
    expect(metadata.openGraph.alternateLocale).toBeUndefined()
  })
})

describe('the home page', () => {
  it('carries the same set as any other screen', async () => {
    // The root is a screen like any other, and it is the page most likely to
    // be shared — it must not be the one branch that misses a property.
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: { ...HOST, screens: { 'screen-1': '' } },
          screen: { data: { $id: 'screen-1', displayName: 'Home' } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor([])

    expectSiteWideProperties(metadata)
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/`)
    expect(metadata.openGraph.type).toBe('website')
  })
})

describe('a collection listing', () => {
  const givenList = (extra: Record<string, unknown> = {}) =>
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST },
        nodes: null,
        content: {
          collection: { slug: 'blog', displayName: 'Blog' },
          entries: [{ $id: 'e1', title: 'Hello', slug: 'hello' }],
          ...extra,
        },
      },
    })

  it('carries the whole site-wide set', async () => {
    givenList()
    const metadata = await metadataFor(['blog'])

    expectSiteWideProperties(metadata)
    expect(metadata.openGraph.type).toBe('website')
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/blog`)
  })

  it('credits nobody — a list has no author', async () => {
    givenList()
    const metadata = await metadataFor(['blog'])
    expect(metadata.twitter.creator).toBeUndefined()
    // Article properties belong to an article, not to the page that lists them.
    expect(metadata.openGraph.publishedTime).toBeUndefined()
  })

  it('carries the set on a CATEGORY listing too', async () => {
    givenList({ category: { slug: 'guides', name: 'Guides', known: true } })
    const metadata = await metadataFor(['blog', 'category', 'guides'])

    expectSiteWideProperties(metadata)
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/blog/category/guides`)
  })
})

describe('a content entry', () => {
  const AUTHOR = {
    $id: 'a1',
    name: 'Ada Lovelace',
    slug: 'ada',
    sameAs: [AUTHOR_X],
  }

  const givenEntry = (entry: Record<string, unknown> = {}) =>
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST },
        nodes: null,
        content: {
          collection: {
            slug: 'blog',
            displayName: 'Blog',
            categories: [{ id: 'c1', name: 'Guides' }],
          },
          entry: {
            $id: 'e1',
            title: 'Hello',
            slug: 'hello',
            excerpt: 'An entry',
            ...entry,
          },
        },
      },
    })

  it('carries the whole site-wide set', async () => {
    givenEntry()
    const metadata = await metadataFor(['blog', 'hello'])

    expectSiteWideProperties(metadata)
    expect(metadata.openGraph.type).toBe('article')
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/blog/hello`)
  })

  it('carries what `og:type: article` is supposed to come with', async () => {
    /*
      The type was declared and none of its properties were, while the same
      values were resolved a few lines over for the `BlogPosting` node — so
      the structured data knew when a post was written and who wrote it and
      the share card knew neither.
    */
    givenEntry({
      publishedAt: { seconds: 1_700_000_000 },
      updatedAt: { seconds: 1_700_086_400 },
      author: AUTHOR,
      categoryId: 'c1',
      tags: ['seo', 'metadata'],
    })

    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.openGraph.publishedTime).toBe('2023-11-14T22:13:20.000Z')
    expect(metadata.openGraph.modifiedTime).toBe('2023-11-15T22:13:20.000Z')
    // The author's PAGE, not their name: `article:author` is defined as a
    // profile, and this platform publishes one for every author.
    expect(metadata.openGraph.authors).toEqual([`${ORIGIN}/author/ada`])
    expect(metadata.openGraph.section).toBe('Guides')
    expect(metadata.openGraph.tags).toEqual(['seo', 'metadata'])
    // The card credits the person who wrote it beside the site that ran it.
    expect(metadata.twitter.creator).toBe('@adalovelace')
    expect(metadata.twitter.site).toBe('@AcmeSoftware')
  })

  it('omits every article property the entry has nothing behind', async () => {
    // Absent, never a placeholder: an invented `article:published_time` is a
    // date Google would read as real.
    givenEntry()
    const metadata = await metadataFor(['blog', 'hello'])

    expect(metadata.openGraph.publishedTime).toBeUndefined()
    expect(metadata.openGraph.modifiedTime).toBeUndefined()
    expect(metadata.openGraph.authors).toBeUndefined()
    expect(metadata.openGraph.section).toBeUndefined()
    expect(metadata.openGraph.tags).toBeUndefined()
    expect(metadata.twitter.creator).toBeUndefined()
  })

  it('falls back to the byline TEXT for a legacy free-typed author', async () => {
    // That shape has no record and so no page to point at; the name is still
    // a truer `article:author` than nothing.
    givenEntry({ authorName: 'Grace Hopper' })
    const metadata = await metadataFor(['blog', 'hello'])
    expect(metadata.openGraph.authors).toEqual(['Grace Hopper'])
  })
})

describe('an author page', () => {
  const givenAuthor = (record: Record<string, unknown> | null = {}) =>
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST },
        nodes: null,
        author: {
          slug: 'ada',
          name: 'Ada Lovelace',
          record: record
            ? { $id: 'a1', name: 'Ada Lovelace', slug: 'ada', ...record }
            : record,
          page: 1,
          totalPages: 1,
          totalEntries: 2,
        },
      },
    })

  it('carries the whole site-wide set', async () => {
    givenAuthor()
    const metadata = await metadataFor(['author', 'ada'])

    expectSiteWideProperties(metadata)
    // `profile`, not `website`: the subject of the page is a person.
    expect(metadata.openGraph.type).toBe('profile')
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/author/ada`)
  })

  it('credits the person the page is about', async () => {
    givenAuthor({ links: [{ label: 'X', url: AUTHOR_X }] })
    const metadata = await metadataFor(['author', 'ada'])

    // Read from the rows the profile PRINTS as well as the declared ones —
    // an author who filled in either is credited (AGL-2516).
    expect(metadata.twitter.creator).toBe('@adalovelace')
    expect(metadata.openGraph.username).toBe('adalovelace')
  })

  it('never splits a display name to fill the other profile fields', async () => {
    /*
      `profile:first_name`/`last_name` would be a claim nobody made: many
      names are neither, and a space is not a name boundary.
    */
    givenAuthor({ sameAs: [AUTHOR_X] })
    const metadata = await metadataFor(['author', 'ada'])

    expect(metadata.openGraph.firstName).toBeUndefined()
    expect(metadata.openGraph.lastName).toBeUndefined()
  })

  it('omits the username for an author with no profile to read it from', async () => {
    givenAuthor()
    const metadata = await metadataFor(['author', 'ada'])

    expect(metadata.openGraph.username).toBeUndefined()
    expect(metadata.twitter.creator).toBeUndefined()
    // …while the SITE's own account still attributes the card.
    expect(metadata.twitter.site).toBe('@AcmeSoftware')
  })
})

describe('what a site with nothing configured emits', () => {
  /**
   * The other half of "fill every gap": a property with nothing behind it is
   * omitted, never filled in. These are the cases that would tempt a
   * placeholder.
   */
  const BARE = {
    $id: 'host-1',
    subdomain: 'acme',
    cname: 'custom.example',
    screens: { 'screen-1': 'about' },
    seo: {},
  }

  it('emits no `og:site_name` for a site with no name anywhere', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: BARE,
          screen: { data: { $id: 'screen-1', displayName: 'About' } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.siteName).toBeUndefined()
    // The platform's own brand is NOT the fallback: this is the customer's
    // site, and naming it "Aglyn" on a share card would be a white-label leak.
    expect(JSON.stringify(metadata)).not.toMatch(/Aglyn/)
  })

  it('takes the business name when the site has no SEO or display title', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: { ...BARE, seo: { entity: { name: 'Acme Holdings LLC' } } },
          screen: { data: { $id: 'screen-1', displayName: 'About' } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.openGraph.siteName).toBe('Acme Holdings LLC')
  })

  it('emits no `twitter:site` for a site with no X profile', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: {
            ...BARE,
            business: {
              socialLinks: [
                { label: 'LinkedIn', url: 'https://linkedin.com/company/acme' },
              ],
            },
          },
          screen: { data: { $id: 'screen-1', displayName: 'About' } },
        },
        nodes: null,
      },
    })

    const metadata = await metadataFor(['about'])

    expect(metadata.twitter.site).toBeUndefined()
    // The card itself still ships — attribution is an addition to it, not a
    // condition on it.
    expect(metadata.twitter.card).toBeDefined()
  })
})
