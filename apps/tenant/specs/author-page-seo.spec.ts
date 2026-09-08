/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where the route's reach into `next/cache` throws.
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
 * The head of an author's page: the snippet and the card it is shared as.
 *
 * `/author/{slug}` described itself out of the two fields the record already
 * had, and neither is the right shape for the tag it landed in. The BIO is
 * printed beside a byline on a page whose heading already names the person,
 * so it runs as long as they want and reaches a search result cut off
 * mid-clause. The PORTRAIT is square — correct as `schema.org/Person.image`,
 * and the reason the page deliberately shipped the small `summary` card,
 * because a square face in a wide slot is cropped to a letterbox.
 *
 * So the record gained an override for each, and the load-bearing property of
 * both is the one asserted hardest below: with neither set, an author page
 * emits exactly what it emitted before — the bio, the portrait, and
 * `summary`. A seam that changes the pages nobody has touched is not a seam.
 */

jest.mock('../app/[host]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
// The client renderer is a large browser-side graph and nothing here renders
// it; `generateMetadata` never touches it.
jest.mock('../app/[host]/[[...slug]]/catch-all-client', () => ({
  __esModule: true,
  default: () => null,
}))

import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'
import { generateMetadata } from '../app/[host]/[[...slug]]/page'

const mockLoad = loadPageData as jest.Mock

const ORIGIN = 'https://custom.example'

/** Longer than a result shows, which is the whole complaint about it. */
const BIO =
  'Zach founded Aglyn in 2024 after a decade building content platforms, ' +
  'and writes here about the parts of the open web that publishers still ' +
  'have to assemble themselves — search, syndication and the long tail of ' +
  'metadata nobody reads until it is wrong.'

const SNIPPET = 'Aglyn’s founder on search, syndication and the open web.'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: {},
  seo: { title: 'Acme', separator: '|' },
}

const givenAuthor = (record: Record<string, unknown> | null) =>
  mockLoad.mockResolvedValue({
    props: {
      data: { host: HOST },
      nodes: null,
      author: {
        slug: 'zg',
        name: 'Zach Gover',
        // A stored slug, because the page's address is what the canonical and
        // `og:url` are built from and a derived one would drift with the name.
        record: record
          ? { $id: 'a1', name: 'Zach Gover', slug: 'zg', ...record }
          : record,
        page: 1,
        totalPages: 1,
        totalEntries: 3,
      },
    },
  })

const metadataFor = () =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug: ['author', 'zg'] }),
  } as never) as Promise<any>

beforeEach(() => jest.clearAllMocks())

describe('the author page description (AGL-2689)', () => {
  it('prefers the snippet the author wrote for a search result', async () => {
    givenAuthor({ bio: BIO, seoDescription: SNIPPET })

    const metadata = await metadataFor()

    expect(metadata.description).toBe(SNIPPET)
    // Every tag that carries a description carries the same one — a page that
    // says one thing in a SERP and another in a share sheet is two pages.
    expect(metadata.openGraph.description).toBe(SNIPPET)
    expect(metadata.twitter.description).toBe(SNIPPET)
  })

  it('falls back to the bio, exactly as before', async () => {
    givenAuthor({ bio: BIO })

    const metadata = await metadataFor()

    expect(metadata.description).toBe(BIO)
    expect(metadata.openGraph.description).toBe(BIO)
  })

  it('emits no description for an author with neither', async () => {
    // Absent, never empty: `<meta name="description" content="">` is a claim
    // that the page has nothing to say about itself.
    givenAuthor({})

    const metadata = await metadataFor()

    expect(metadata).not.toHaveProperty('description')
    expect(metadata.openGraph).not.toHaveProperty('description')
  })

  it('ignores a whitespace-only override rather than blanking the page', async () => {
    givenAuthor({ bio: BIO, seoDescription: '   ' })

    expect((await metadataFor()).description).toBe(BIO)
  })
})

describe('the author page share card (AGL-2689)', () => {
  it('shares a purpose-made card as the WIDE card, described', async () => {
    givenAuthor({
      image: 'media:host-1/portrait',
      seoImage: 'media:host-1/card',
      seoImageAlt: 'Zach Gover speaking at a conference',
    })

    const metadata = await metadataFor()

    expect(metadata.openGraph.images).toEqual([
      {
        url: `${ORIGIN}/api/media/cdn/host-1/card`,
        alt: 'Zach Gover speaking at a conference',
      },
    ])
    expect(metadata.twitter.card).toBe('summary_large_image')
  })

  it('keeps the portrait on the SMALL card when there is no card', async () => {
    // The AGL-2518 rule, unchanged and load-bearing: a square face in a
    // `summary_large_image` slot is cropped to a letterbox.
    givenAuthor({ image: 'media:host-1/portrait' })

    const metadata = await metadataFor()

    expect(metadata.openGraph.images).toEqual([
      { url: `${ORIGIN}/api/media/cdn/host-1/portrait` },
    ])
    expect(metadata.twitter.card).toBe('summary')
  })

  it('never carries the card’s description over to the portrait', async () => {
    // An alt travels with the picture it describes (AGL-2417). Describing the
    // portrait with a sentence written about a different image is worse than
    // describing it with nothing.
    givenAuthor({
      image: 'media:host-1/portrait',
      seoImageAlt: 'Zach Gover speaking at a conference',
    })

    const metadata = await metadataFor()

    expect(metadata.openGraph.images[0]).not.toHaveProperty('alt')
    expect(metadata.twitter.card).toBe('summary')
  })

  it('emits no image at all for an author with no picture', async () => {
    givenAuthor({})

    const metadata = await metadataFor()

    expect(metadata.openGraph).not.toHaveProperty('images')
    expect(metadata.twitter).not.toHaveProperty('images')
    expect(metadata.twitter.card).toBe('summary')
  })

  it('absolutizes an external URL by leaving it alone', async () => {
    // A card is fetched out of band, so the tag has to be absolute — which a
    // URL an author typed already is, and must survive untouched.
    givenAuthor({ seoImage: 'https://cdn.example.com/zach-card.png' })

    const metadata = await metadataFor()

    expect(metadata.openGraph.images).toEqual([
      { url: 'https://cdn.example.com/zach-card.png' },
    ])
  })
})

describe('an author page that sets nothing new', () => {
  it('emits the head it emitted before the fields existed', async () => {
    givenAuthor({ bio: BIO, image: 'media:host-1/portrait' })

    const metadata = await metadataFor()

    expect(metadata.title).toBe('Zach Gover | Acme')
    expect(metadata.description).toBe(BIO)
    expect(metadata.openGraph.type).toBe('profile')
    expect(metadata.openGraph.url).toBe(`${ORIGIN}/author/zg`)
    expect(metadata.openGraph.siteName).toBe('Acme')
    expect(metadata.openGraph.images).toEqual([
      { url: `${ORIGIN}/api/media/cdn/host-1/portrait` },
    ])
    expect(metadata.twitter.card).toBe('summary')
  })
})
