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
 * Collection pages must ANNOUNCE their feed (AGL-2391).
 *
 * `/{collection}/rss.xml` has been served since AGL-1385 and the feed is
 * correct — but no page ever emitted an alternate-link tag of type
 * `application/rss+xml`, so nothing could discover it. Measured on the live
 * marketing site 2026-08-19: `aglyn.com/blog` carries a visible "RSS" text
 * link in the body and ZERO autodiscovery links in the head.
 *
 * The URL asserted here is the one the middleware rewrite accepts
 * (`/{collection}/rss.xml`) on the site's PUBLIC origin — never the
 * `/api/collections-rss?host=…` internal form, whose host parameter is a
 * sentinel nothing outside the middleware can spell.
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

import { generateMetadata } from '../app/[host]/[[...slug]]/page'
import { loadPageData } from '../app/[host]/[[...slug]]/load-page-data'

const mockLoad = loadPageData as jest.Mock

/** A site on a custom domain that ALSO still has its platform subdomain. */
const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  cname: 'custom.example',
  displayName: 'Acme',
  screens: {},
}

const givenContent = (content: unknown, host: unknown = HOST) =>
  mockLoad.mockResolvedValue({
    props: { data: { host }, nodes: null, content },
  })

const metadataFor = (slug: string[]) =>
  generateMetadata({
    params: Promise.resolve({ host: 'acme', slug }),
  } as never) as Promise<any>

const feedOf = (metadata: any) =>
  metadata?.alternates?.types?.['application/rss+xml']

beforeEach(() => jest.clearAllMocks())

describe('collection pages announce their RSS feed (AGL-2391)', () => {
  it('names the feed on the list root', async () => {
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: null,
      entries: [],
      pagination: { page: 1, perPage: 10, totalPages: 2 },
    })

    expect(feedOf(await metadataFor(['blog']))).toBe(
      'https://custom.example/blog/rss.xml',
    )
  })

  it('keeps the canonical alongside it rather than replacing it', async () => {
    // The two live on the same `alternates` object, so a careless spread can
    // drop one while the other still reads green.
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: null,
      entries: [],
      pagination: { page: 2, perPage: 10, totalPages: 2 },
    })

    const metadata = await metadataFor(['blog', 'page', '2'])

    expect(metadata.alternates.canonical).toBe(
      'https://custom.example/blog/page/2',
    )
    // The feed is the COLLECTION's, not the page's — there is no per-page
    // feed, and pointing page 2 at a feed that does not exist would be worse
    // than pointing it at the one that does.
    expect(feedOf(metadata)).toBe('https://custom.example/blog/rss.xml')
  })

  it('names the collection feed on an entry page', async () => {
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: { $id: 'e1', title: 'Hello', slug: 'hello' },
      entries: [],
    })

    expect(feedOf(await metadataFor(['blog', 'hello']))).toBe(
      'https://custom.example/blog/rss.xml',
    )
  })

  it('uses the PUBLIC origin, never the requested subdomain', async () => {
    // A feed URL that named `{sub}.aglyn.app` would subscribe readers to the
    // origin the canonical-domain redirect exists to retire.
    givenContent({
      collection: { slug: 'changelog', displayName: 'Changelog' },
      entry: null,
      entries: [],
    })

    expect(feedOf(await metadataFor(['changelog']))).toBe(
      'https://custom.example/changelog/rss.xml',
    )
  })

  it('omits it rather than guessing when the host has no public origin', async () => {
    // Negative control: without this case a hard-coded string would pass
    // every assertion above.
    givenContent(
      {
        collection: { slug: 'blog', displayName: 'Blog' },
        entry: null,
        entries: [],
      },
      { $id: 'host-1', displayName: 'Acme', screens: {} },
    )

    expect(feedOf(await metadataFor(['blog']))).toBeUndefined()
  })

  it('omits it on a category segment that names nothing', async () => {
    // Same reasoning as that branch's `noindex`: the address names no
    // content, so it has no feed to offer.
    givenContent({
      collection: { slug: 'blog', displayName: 'Blog' },
      entry: null,
      entries: [],
      category: { slug: 'not-a-category', known: false },
    })

    expect(feedOf(await metadataFor(['blog', 'category', 'not-a-category']))).toBe(
      undefined,
    )
  })

  it('does not announce a feed on an ordinary screen', async () => {
    // The second negative control: the screen branch returns before any of
    // this, and a feed link on `/pricing` would be a lie.
    mockLoad.mockResolvedValue({
      props: {
        data: {
          host: HOST,
          screen: { $id: 's1', name: 'Pricing', path: '/pricing' },
        },
        nodes: {},
        content: null,
      },
    })

    expect(feedOf(await metadataFor(['pricing']))).toBeUndefined()
  })
})
