/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * The routes around the site's 503 answer (AGL-4110).
 *
 * The middleware sends the 503 page as a 503 (`site-unavailable-middleware`
 * spec); these are the Node routes it depends on, and the ones that decide
 * their own status:
 *
 *  - the verdict says when a site is in maintenance, with the loader's test;
 *  - robots.txt and the sitemap of a site in maintenance are what they always
 *    were — crawling allowed, every page listed — because a temporary 503 is
 *    the whole signal, and closing robots.txt would be a removal signal;
 *  - a page's Markdown twin is that page, so it answers 503 with it;
 *  - a collection's feed stops carrying entries in maintenance, as a 503.
 */

const mockGetHost = jest.fn()
const mockGetOrgBilling = jest.fn(async () => ({ org: { $id: 'org-1' } }))
const mockScreensGet = jest.fn(async () => ({ docs: [] as unknown[] }))

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
  getHost: (...args: unknown[]) => mockGetHost(...args),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
  getOrgBilling: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: jest.fn(async () => null),
  getDomainLockdown: jest.fn(async () => null),
  // Nothing is locked in these scenarios (AGL-2495).
  visitorContentRefusal: jest.fn(async () => null),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) =>
              name === 'screens'
                ? { select: () => ({ limit: () => ({ get: mockScreensGet }) }) }
                : {
                    doc: () => ({ get: async () => ({ get: () => undefined }) }),
                    limit: () => ({ get: async () => ({ docs: [] }) }),
                  },
          }),
        }),
      }),
    }),
  },
}))
// Pass-through: the feed's cache is AGL-1302's concern, not this one.
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/tenant-data-admin/render-cache'),
  withRenderCache: async ({ read }: { read: () => Promise<unknown> }) => read(),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    collection: { displayName: 'Blog', slug: 'blog', categories: [] },
    entries: [
      {
        title: 'Our spring menu',
        slug: 'our-spring-menu',
        excerpt: 'Rhubarb, at last.',
        publishedAt: { seconds: 1_754_714_956 },
        tags: [],
      },
    ],
  })),
}))
jest.mock('../app/[host]/[scheme]/[[...slug]]/load-page-data', () => ({
  __esModule: true,
  loadPageData: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: jest.fn(async () => new Set<string>()),
  getTemplateScreenIds: jest.fn(async () => new Set<string>()),
  getTemplateScreenRouting: jest.fn(async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {} as Record<string, string>,
    collectionListings: {} as Record<string, string>,
  })),
}))
jest.mock('@aglyn/tenant-runtime/entry-link-routes', () => ({
  __esModule: true,
  resolveEntryLinkRoutes: jest.fn(async () => ({})),
}))

import { SITE_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@aglyn/aglyn/app-utils/site-unavailable'
import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'
import { GET as feed } from '../app/api/collections-rss/route'
import { GET as verdict } from '../app/api/lockdown-verdict/route'
import { GET as markdown } from '../app/api/markdown/route'
import { GET as robots } from '../app/api/robots/route'
import { GET as sitemap } from '../app/api/sitemap/route'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  displayName: 'Acme Bakery',
  seo: {},
  screens: { home: '/', about: 'about' },
}

const givenHost = (overrides: Record<string, unknown> = {}) =>
  mockGetHost.mockResolvedValue({ host: { ...HOST, ...overrides }, error: null })

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://acme.aglyn.app${path}`, {
    headers: { host: 'acme.aglyn.app', 'x-aglyn-tenant-host': 'acme', ...headers },
  })

const RETRY_AFTER = String(SITE_UNAVAILABLE_RETRY_AFTER_SECONDS)
const mockLoad = loadPageData as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  givenHost()
})

describe('the middleware verdict says when a site is in maintenance (AGL-4110)', () => {
  const ask = async () =>
    (await (
      await verdict(new Request('https://tenant.example/api/lockdown-verdict?host=acme'))
    ).json()) as Record<string, unknown>

  it('in maintenance', async () => {
    givenHost({ maintenance: true })
    expect(await ask()).toEqual(
      expect.objectContaining({ locked: false, maintenance: true, preview: false }),
    )
  })

  it('read as the loader reads it: any truthy field', async () => {
    givenHost({ maintenance: 1 })
    expect(await ask()).toEqual(expect.objectContaining({ maintenance: true }))
  })

  it('in preview, which is not maintenance', async () => {
    givenHost({ preview: true })
    expect(await ask()).toEqual(
      expect.objectContaining({ maintenance: false, preview: true }),
    )
  })

  it('CONTROL — a live site is in neither', async () => {
    expect(await ask()).toEqual(
      expect.objectContaining({ maintenance: false, preview: false }),
    )
  })
})

describe('robots.txt and the sitemap stay open in maintenance (AGL-4110)', () => {
  it('robots.txt still allows crawling and names the sitemap', async () => {
    givenHost({ maintenance: true })
    const response = await robots(request('/robots.txt'))
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('Allow: /')
    expect(body).toContain('Sitemap: https://acme.aglyn.app/sitemap.xml')
  })

  it('the sitemap still lists every page, each of which now answers 503', async () => {
    givenHost({ maintenance: true })
    const response = await sitemap(request('/sitemaps/pages/1.xml'))
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(xml).toContain('<loc>https://acme.aglyn.app/</loc>')
    expect(xml).toContain('<loc>https://acme.aglyn.app/about</loc>')
  })
})

describe('a page’s Markdown twin answers 503 with it (AGL-4110)', () => {
  const ask = (path: string) =>
    markdown(request('/api/markdown', { 'x-aglyn-markdown-path': path }))

  it('maintenance: the notice, as a 503 with Retry-After, never cached', async () => {
    mockLoad.mockResolvedValue({
      props: { data: { host: HOST }, nodes: null, maintenanceFallback: true },
    })
    const response = await ask('about')
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe(RETRY_AFTER)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('link')).toBeNull()
  })

  it('preview, to the public: the same', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST },
        nodes: null,
        maintenanceFallback: true,
        sitePreview: true,
      },
    })
    const response = await ask('')
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe(RETRY_AFTER)
  })

  it('CONTROL — a live page is a cached 200, as before', async () => {
    mockLoad.mockResolvedValue({
      props: {
        data: { host: HOST, screen: { data: { $id: 'about', displayName: 'About' } } },
        nodes: null,
      },
    })
    const response = await ask('about')
    expect(response.status).toBe(200)
    expect(response.headers.get('retry-after')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('s-maxage=')
  })
})

describe('a collection’s feed in maintenance (AGL-4111)', () => {
  const ask = () => feed(request('/api/collections-rss?host=acme&collection=blog'))

  it('carries no entries: a 503 with Retry-After, never cached', async () => {
    givenHost({ maintenance: true })
    const response = await ask()
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe(RETRY_AFTER)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).not.toContain('Our spring menu')
  })

  it('CONTROL — a live site’s feed carries its entries', async () => {
    const response = await ask()
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Our spring menu')
  })
})
