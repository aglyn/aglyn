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
 * A site nobody may see lists nothing (AGL-4086).
 *
 * While a site is in preview `robots.txt` disallows everything and names no
 * sitemap, the sitemap is an empty `<urlset>` (where maintenance leaves it
 * open), and `/llms.txt` is a 404. A page in preview on a public site is left
 * out of the sitemap. The verdict the middleware asks carries `preview` and
 * the paths of the pages in preview, so it can route the team without a read
 * of its own.
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

import { buildRobotsTxt } from '@aglyn/aglyn/server'
import { GET as robots } from '../app/api/robots/route'
import { GET as sitemap } from '../app/api/sitemap/route'
import { GET as llms } from '../app/api/llms/route'
import { GET as verdict } from '../app/api/lockdown-verdict/route'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  displayName: 'Acme Bakery',
  seo: {},
  screens: { home: '/', about: 'about', launch: 'launch' },
}

const givenHost = (overrides: Record<string, unknown> = {}) =>
  mockGetHost.mockResolvedValue({ host: { ...HOST, ...overrides }, error: null })

const request = (path: string) =>
  new Request(`https://acme.aglyn.app${path}`, {
    headers: { host: 'acme.aglyn.app', 'x-aglyn-tenant-host': 'acme' },
  })

beforeEach(() => {
  jest.clearAllMocks()
  givenHost()
})

describe('robots.txt (AGL-4086)', () => {
  it('disallows everything and names no sitemap while the site is in preview', async () => {
    givenHost({ preview: true })
    const body = await (await robots(request('/robots.txt'))).text()
    expect(body).toBe('User-agent: *\nDisallow: /\n')
    expect(body).not.toContain('Sitemap:')
  })

  it('CONTROL — a public site allows crawling and names its sitemap', async () => {
    const body = await (await robots(request('/robots.txt'))).text()
    expect(body).toContain('Allow: /')
    expect(body).toContain('Sitemap: https://acme.aglyn.app/sitemap.xml')
  })

  it('is the shared builder answering, so every surface agrees', () => {
    expect(buildRobotsTxt({ host: { preview: true }, origin: 'https://x.example' })).toBe(
      'User-agent: *\nDisallow: /\n',
    )
  })
})

describe('the sitemap (AGL-4086)', () => {
  const locs = async (path: string) => {
    const xml = await (await sitemap(request(path))).text()
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  }

  it('is an empty urlset while the site is in preview — the index and every child', async () => {
    givenHost({ preview: true })
    for (const path of ['/sitemap.xml', '/sitemaps/pages/1.xml']) {
      const response = await sitemap(request(path))
      const xml = await response.text()
      expect(response.status).toBe(200)
      expect(xml).toContain('<urlset')
      expect(xml).not.toContain('<loc>')
      expect(xml).not.toContain('<sitemapindex')
    }
  })

  it('leaves out a page in preview, and keeps the rest', async () => {
    givenHost({ previewScreens: { launch: true } })
    const pages = await locs('/sitemaps/pages/1.xml')
    expect(pages).toEqual(
      expect.arrayContaining(['https://acme.aglyn.app/', 'https://acme.aglyn.app/about']),
    )
    expect(pages).not.toContain('https://acme.aglyn.app/launch')
  })
})

describe('/llms.txt (AGL-4086)', () => {
  it('is a 404 while the site is in preview', async () => {
    givenHost({ preview: true })
    expect((await llms(request('/llms.txt'))).status).toBe(404)
  })
})

describe('the middleware verdict (AGL-4086)', () => {
  const ask = async () =>
    (await (
      await verdict(new Request('https://tenant.example/api/lockdown-verdict?host=acme'))
    ).json()) as Record<string, unknown>

  it('says the site is in preview', async () => {
    givenHost({ preview: true })
    expect(await ask()).toEqual(expect.objectContaining({ locked: false, preview: true }))
  })

  it('names the addresses of the pages in preview, and nothing unpublished', async () => {
    givenHost({ previewScreens: { launch: true, draft: true, about: false } })
    expect(await ask()).toEqual(
      expect.objectContaining({ preview: false, previewPaths: ['/launch'] }),
    )
  })

  it('CONTROL — a public site is not in preview', async () => {
    expect(await ask()).toEqual(
      expect.objectContaining({ preview: false, previewPaths: [] }),
    )
  })
})
