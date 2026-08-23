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
 * Error screens must never be submitted to a crawler (AGL-2486).
 *
 * Measured on production 2026-08-23, minutes after `aglyn.com` was made
 * indexable: its sitemap carried `/401`, `/404` and `/503` among 97 URLs.
 * That is the worst possible first crawl for a brand-new domain — Google
 * fetches each one, receives the status code the page exists to represent,
 * and records crawl errors and soft-404s against a site it has never seen.
 * Nothing errors and nothing logs; the damage appears in Search Console
 * weeks later, which is why it needs a test rather than a look.
 *
 * BOTH exclusion sources are pinned here, because they are not equivalent:
 * `resolveNotFoundScreenId` records that `errorScreens` was unset on EVERY
 * production host as of 2026-08-19 and that an error screen on this platform
 * is simply a screen published at the status path. So a filter on bound ids
 * alone would have left the real site broken, and a filter on paths alone
 * would miss a host that did bind one.
 */

// Factories, not bare `jest.mock`: the route reaches `@aglyn/tenant-data-admin`
// → `undici`, and an auto-mock still evaluates the real module graph to derive
// its shape. That fails before any test runs.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const mockScreensGet = jest.fn()
const mockSettingsGet = jest.fn()
const mockProductsGet = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => {
              if (name === 'settings') {
                return { doc: () => ({ get: mockSettingsGet }) }
              }
              if (name === 'screens') {
                return {
                  select: () => ({ limit: () => ({ get: mockScreensGet }) }),
                }
              }
              return { limit: () => ({ get: mockProductsGet }) }
            },
          }),
        }),
      }),
    }),
  },
}))

import { GET } from '../app/api/sitemap/route'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.MockedFunction<typeof getHost>

const request = () =>
  new Request('https://aglyn.com/api/sitemap?host=marketing', {
    headers: { host: 'aglyn.com' },
  })

const givenHost = (host: Record<string, unknown>) => {
  mockGetHost.mockResolvedValue({
    host: { $id: 'host-1', cname: 'aglyn.com', seo: {}, ...host },
    nextPageToken: '',
    error: null,
  } as never)
  // No screen is independently non-indexable, so anything excluded below is
  // excluded by the rule under test rather than by `isScreenIndexable`.
  mockScreensGet.mockResolvedValue({ docs: [] } as never)
  mockSettingsGet.mockResolvedValue({ get: () => undefined } as never)
  mockProductsGet.mockResolvedValue({ docs: [] } as never)
}

const locsOf = async () => {
  const xml = await (await GET(request())).text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

describe('sitemap excludes error screens (AGL-2486)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('drops screens published at a bare status path', async () => {
    givenHost({
      screens: {
        home: '',
        about: 'about',
        notFound: '404',
        unauthorized: '401',
        unavailable: '503',
      },
    })

    const locs = await locsOf()

    expect(locs).toEqual(
      expect.arrayContaining(['https://aglyn.com/', 'https://aglyn.com/about']),
    )
    for (const status of ['401', '404', '503']) {
      expect(locs).not.toContain(`https://aglyn.com/${status}`)
    }
  })

  it('drops a screen BOUND as an error page even at an ordinary path', async () => {
    // The binding is the source a filter on paths alone cannot see.
    givenHost({
      screens: { home: '', oops: 'something-went-wrong' },
      errorScreens: { notFound: 'oops' },
    })

    expect(await locsOf()).not.toContain(
      'https://aglyn.com/something-went-wrong',
    )
  })

  it('honours the pre-AGL-131 notFoundScreenId binding too', async () => {
    givenHost({
      screens: { home: '', legacy: 'gone' },
      notFoundScreenId: 'legacy',
    })

    expect(await locsOf()).not.toContain('https://aglyn.com/gone')
  })

  it('KEEPS a real page whose path merely contains a status number', async () => {
    // The anchor is the whole point: `/404-guide` is a page someone wrote.
    // An unanchored match would silently delete real URLs from the sitemap,
    // which is the same class of invisible loss this suite exists to catch.
    givenHost({
      screens: { home: '', guide: '404-guide', deep: 'products/503' },
    })

    const locs = await locsOf()

    expect(locs).toContain('https://aglyn.com/404-guide')
    expect(locs).toContain('https://aglyn.com/products/503')
  })
})
