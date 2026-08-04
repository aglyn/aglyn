/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom, where `Request` is not a constructor.
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
 * @jest-environment node
 */

/**
 * The SEO routes must name the site's own origin, never the caller's
 * `Host` header (AGL-1160).
 *
 * This is a silent failure mode: reverting to `request.headers.get('host')`
 * produces a perfectly well-formed feed on every request an author would make
 * by hand, because they visit the site on its real domain. It only goes wrong
 * for a crawler arriving on the OTHER domain a site answers to, and the damage
 * — a sitemap that disagrees with the page's own `<link rel="canonical">`, or
 * `<guid>`s that re-announce old entries as new — shows up in search results
 * weeks later rather than in any response anyone reads.
 *
 * So every case below sends a `Host` that deliberately DISAGREES with the host
 * record. A test that sent the matching host would pass against the bug.
 */

// Factories, not bare `jest.mock`: both modules reach `@aglyn/tenant-data-admin`
// → `undici`, and an auto-mock still evaluates the real module graph to derive
// its shape. That fails before any test runs.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import getCollectionContent from '@aglyn/tenant-runtime/get-collection-content'
import { GET } from '../app/api/collections-rss/route'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.MockedFunction<typeof getHost>
const mockGetContent = getCollectionContent as jest.MockedFunction<
  typeof getCollectionContent
>

/** The domain the request arrives on — never the answer we want emitted. */
const CALLER_HOST = 'preview-xyz.vercel.app'

const requestFor = (host: string) =>
  new Request(
    `https://${CALLER_HOST}/api/collections-rss?host=${host}&collection=blog`,
    { headers: { host: CALLER_HOST } },
  )

const givenHost = (host: Record<string, unknown>) => {
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', ...host },
    nextPageToken: '',
    error: null,
  } as never)
  mockGetContent.mockResolvedValue({
    collection: { displayName: 'Blog', categories: [] },
    entries: [{ title: 'First post', slug: 'first-post', tags: [] }],
  } as never)
}

describe('collections RSS origin (AGL-1160)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('uses the custom domain, not the host the request arrived on', async () => {
    givenHost({ cname: 'blog.customer.com', subdomain: 'customer' })

    const xml = await (await GET(requestFor('customer'))).text()

    expect(xml).toContain('<link>https://blog.customer.com/blog/first-post</link>')
    expect(xml).toContain('<guid>https://blog.customer.com/blog/first-post</guid>')
    // The control that makes this a real test: the caller's host must be
    // absent entirely, not merely deprioritised.
    expect(xml).not.toContain(CALLER_HOST)
  })

  it('falls back to the platform subdomain when there is no custom domain', async () => {
    givenHost({ cname: null, subdomain: 'customer' })

    const xml = await (await GET(requestFor('customer'))).text()

    expect(xml).toContain('<link>https://customer.aglyn.app/blog/first-post</link>')
    expect(xml).not.toContain(CALLER_HOST)
  })

  it('still answers when the record has neither, rather than emitting "undefined"', async () => {
    // `hostPublicOrigin` returns undefined by design here. The route may fall
    // back to the caller's host — what it must never do is interpolate the
    // undefined into a URL, which is the shape that silently ships
    // `https://undefined/...` to a search engine.
    givenHost({ cname: null, subdomain: null })

    const xml = await (await GET(requestFor('customer'))).text()

    expect(xml).not.toContain('undefined')
    expect(xml).toContain('/blog/first-post')
  })

  it('bounds the CDN cache so a publish is not invisible for an hour', async () => {
    givenHost({ cname: null, subdomain: 'customer' })

    const cacheControl = (await GET(requestFor('customer'))).headers.get(
      'cache-control',
    )

    // The old value was `s-maxage=3600, stale-while-revalidate` — an hour, and
    // an SWR with no delta-seconds, which RFC 5861 requires and without which a
    // CDN may serve stale indefinitely.
    expect(cacheControl).toBe('s-maxage=60, stale-while-revalidate=60')
    expect(cacheControl).toMatch(/stale-while-revalidate=\d+/)
  })
})
