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
 * The RSS feed must answer to the host spellings a PERSON has (AGL-1385).
 *
 * MEASURED against production before the fix, for the marketing site (custom
 * domain `aglyn.com`, no subdomain):
 *
 *   ?host=aglyn.com           → 404
 *   ?host=marketing           → 404
 *   ?host=marketing.aglyn.app → 404
 *   ?host=cname--aglyn.com    → 200
 *
 * Only the middleware's internal sentinel resolved — a spelling no reader,
 * author or template could know, and the very reason nothing linked to the
 * feed. `/api/collections-rss` documents its parameter as "your site's
 * subdomain (or custom domain)", and the custom-domain half was never true.
 *
 * So this drives the REAL `getHost` over a Firestore stand-in that answers
 * exactly like the real one — `subdomain ==` for a bare alias, `cname ==` for
 * the sentinel, and nothing else. Mocking `getHost` (as `seo-origin.spec.ts`
 * does, for a different question) would mock away the entire defect: the bug
 * was that the route handed Firestore a string it could never match.
 */

const mockHostId = 'host-marketing'
/** As stored: a custom domain, and NO subdomain. The shape that 404'd. */
const mockHostDoc = { $id: mockHostId, cname: 'aglyn.com', subdomain: null }

/**
 * The only two queries `get-host` issues, and the only two Firestore can
 * serve — a `where(field,'==')` key projection and a doc get. Anything else
 * resolves empty, which is what makes a wrong spelling a 404 here just as it
 * is in production.
 */
const mockAliasQuery = jest.fn((field: string, value: string) =>
  (field === 'cname' && value === 'aglyn.com') ||
  (field === 'subdomain' && value === 'marketing')
    ? { size: 1, docs: [{ id: mockHostId }] }
    : { size: 0, docs: [] as Array<{ id: string }> },
)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  hostConverter: {},
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          where: (field: string, _op: string, value: string) => ({
            select: () => ({
              limit: () => ({ get: async () => mockAliasQuery(field, value) }),
            }),
          }),
          withConverter: () => ({
            doc: (id: string) => ({
              get: async () => ({
                exists: id === mockHostId,
                data: () => mockHostDoc,
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

// Pass-through: the cache is AGL-1302's concern, not this one, and a real one
// would make the second lookup in a test answer from the first.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  tenantHostAliasTag: (alias: string) => `tenant-host-alias:${alias}`,
  withRenderCache: async ({ read }: { read: () => Promise<unknown> }) => read(),
}))

jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    collection: { displayName: 'Blog', slug: 'blog', categories: [] },
    entries: [
      {
        title: 'From a form to a dataset in five minutes',
        slug: 'from-a-form-to-a-dataset-in-five-minutes',
        excerpt: 'Collect submissions in the Inbox.',
        publishedAt: { seconds: 1_754_714_956 },
        tags: [],
      },
    ],
  })),
}))

import { GET } from '../app/api/collections-rss/route'
import { normalizeHostAlias } from '../utils/get-host'

const feedFor = (host: string) =>
  GET(
    new Request(
      `https://aglyn.com/api/collections-rss?host=${host}&collection=blog`,
      { headers: { host: 'aglyn.com' } },
    ),
  )

/** A response only counts if it is a FEED, not merely a 200. */
const expectValidFeed = async (response: Response) => {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/rss+xml')
  const xml = await response.text()
  expect(xml).toContain('<rss version="2.0">')
  expect(xml).toContain(
    '<link>https://aglyn.com/blog/from-a-form-to-a-dataset-in-five-minutes</link>',
  )
  return xml
}

describe('collections RSS host forms (AGL-1385)', () => {
  beforeEach(() => mockAliasQuery.mockClear())

  it('serves the feed for a custom domain', async () => {
    await expectValidFeed(await feedFor('aglyn.com'))
    // The control: the resolver was asked about `cname`, not handed the
    // domain as a subdomain — which is the exact shape of the 404.
    expect(mockAliasQuery).toHaveBeenCalledWith('cname', 'aglyn.com')
  })

  it('serves the feed for the platform origin a site advertises', async () => {
    await expectValidFeed(await feedFor('marketing.aglyn.app'))
    expect(mockAliasQuery).toHaveBeenCalledWith('subdomain', 'marketing')
  })

  it('serves the feed for the bare subdomain', async () => {
    await expectValidFeed(await feedFor('marketing'))
  })

  it('still serves the middleware sentinel it always did', async () => {
    await expectValidFeed(await feedFor('cname--aglyn.com'))
  })

  it('resolves the host the middleware rewrite sends as a header', async () => {
    // `/blog/rss.xml` arrives here with the resolved tenant host on
    // `x-aglyn-tenant-host` — the linkable form, and the one a query-dropping
    // dev rewrite would otherwise break.
    const response = await GET(
      new Request('https://aglyn.com/api/collections-rss?collection=blog', {
        headers: { host: 'aglyn.com', 'x-aglyn-tenant-host': 'cname--aglyn.com' },
      }),
    )
    await expectValidFeed(response)
  })

  it('404s a host that names no site, rather than serving someone else', async () => {
    expect((await feedFor('not-a-site.example')).status).toBe(404)
  })
})

describe('normalizeHostAlias (AGL-1385)', () => {
  it.each([
    ['aglyn.com', 'cname--aglyn.com'],
    ['AGLYN.COM', 'cname--aglyn.com'],
    ['aglyn.com:4500', 'cname--aglyn.com'],
    ['aglyn.com.', 'cname--aglyn.com'],
    ['marketing.aglyn.app', 'marketing'],
    ['marketing', 'marketing'],
    ['cname--aglyn.com', 'cname--aglyn.com'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHostAlias(input)).toBe(expected)
  })

  it('is idempotent, so a normalized value can be passed on', () => {
    for (const input of ['aglyn.com', 'marketing.aglyn.app', 'marketing']) {
      const once = normalizeHostAlias(input)
      expect(normalizeHostAlias(once)).toBe(once)
    }
  })

  it('leaves a deeper name under the apex to the cname branch', () => {
    // `a.b.aglyn.app` is not a subdomain lookup — resolving it to `b` would
    // hand one site's feed to a name it does not own.
    expect(normalizeHostAlias('a.b.aglyn.app')).toBe('cname--a.b.aglyn.app')
  })
})
