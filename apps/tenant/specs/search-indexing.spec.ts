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
 * Search-indexing controls end to end at the two files a crawler actually
 * fetches (AGL-1263).
 *
 * Both directions are asserted for every claim. A switch that turns a site
 * dark and cannot turn it back is worse than no switch at all, and "off"
 * cannot be inferred from "on" — the two states run different code paths
 * here, and the discouraged path returns before the reads the normal path
 * depends on.
 */

// Factories, not bare `jest.mock`: both routes reach `@aglyn/tenant-data-admin`
// → `undici`, and an auto-mock still evaluates the real module graph to derive
// its shape. That fails before any test runs.
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
}))

import { HostScreenVisibility } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { GET as robotsGet } from '../app/api/robots/route'
import { GET as sitemapGet } from '../app/api/sitemap/route'
import getHost from '../utils/get-host'

const mockGetHost = getHost as jest.MockedFunction<typeof getHost>

/** The domain the request arrives on — never the answer we want emitted. */
const CALLER_HOST = 'preview-xyz.vercel.app'

const requestFor = (path: string) =>
  new Request(`https://${CALLER_HOST}${path}?host=acme`, {
    headers: { host: CALLER_HOST, 'x-aglyn-tenant-host': 'acme' },
  })

/**
 * A host record plus the screen docs the sitemap projects `visibility` from.
 * `screens` is the routing map (id → path); `screenDocs` is what the
 * subcollection read returns for those same ids.
 */
function given(options: {
  discouraged?: boolean
  screens?: Record<string, string>
  screenDocs?: Array<{ id: string; visibility?: HostScreenVisibility }>
  /** `hosts/{id}/collections` docs, read for both the template-screen
   * exclusion (AGL-1267) and the content-collection URLs. */
  collectionDocs?: Array<Record<string, unknown>>
}) {
  // Routing-map values are bare slugs; the root screen is the literal '/'.
  const screens = options.screens ?? { home: '/', secret: 'secret' }
  mockGetHost.mockResolvedValue({
    host: {
      $id: 'host-1',
      subdomain: 'acme',
      screens,
      ...(options.discouraged
        ? { seo: { discourageSearchEngines: true } }
        : {}),
    },
    nextPageToken: '',
    error: null,
  } as never)

  const emptySnapshot = { docs: [], get: () => undefined, exists: false }
  const screenSnapshot = {
    docs: (options.screenDocs ?? []).map((screen) => ({
      id: screen.id,
      data: () => ({ visibility: screen.visibility }),
    })),
  }
  const collectionSnapshot = {
    docs: (options.collectionDocs ?? []).map((fields) => ({
      id: String(fields['slug'] ?? 'col'),
      get: (field: string) => fields[field],
      data: () => fields,
      ref: { collection: (name: string) => collectionRef(name) },
    })),
  }
  const collectionRef = (name: string): any => ({
    select: () => collectionRef(name),
    limit: () => collectionRef(name),
    where: () => collectionRef(name),
    doc: () => ({ get: async () => emptySnapshot }),
    get: async () =>
      name === 'screens'
        ? screenSnapshot
        : name === 'collections'
          ? collectionSnapshot
          : emptySnapshot,
  })
  const hostRef = { collection: (name: string) => collectionRef(name) }
  ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
    firestore: () => ({ collection: () => ({ doc: () => hostRef }) }),
  })
}

const locsIn = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

describe('robots.txt (AGL-1263)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('allows everything and names the site\'s own sitemap by default', async () => {
    given({})

    const body = await (await robotsGet(requestFor('/robots.txt'))).text()

    expect(body).toContain('Allow: /')
    expect(body).toContain('Sitemap: https://acme.aglyn.app/sitemap.xml')
    // AGL-1160 applied here too: the `Sitemap:` line used to be built from the
    // caller's `Host`, so a preview deployment advertised a vercel.app URL and
    // one cached response served it to everyone.
    expect(body).not.toContain(CALLER_HOST)
  })

  it('disallows everything and drops the sitemap when discouraged', async () => {
    given({ discouraged: true })

    const body = await (await robotsGet(requestFor('/robots.txt'))).text()

    expect(body).toBe('User-agent: *\nDisallow: /\n')
  })

  it('returns to allowing everything once the switch is cleared', async () => {
    given({ discouraged: true })
    expect(await (await robotsGet(requestFor('/robots.txt'))).text()).toContain(
      'Disallow: /',
    )

    given({})
    const body = await (await robotsGet(requestFor('/robots.txt'))).text()

    expect(body).toContain('Allow: /')
    expect(body).not.toContain('Disallow')
  })

  it('fails OPEN when the host cannot be resolved', async () => {
    // A transient Firestore error must never be able to de-index a customer.
    mockGetHost.mockResolvedValue({
      host: undefined,
      nextPageToken: '',
      error: new Error('unavailable'),
    } as never)

    const body = await (await robotsGet(requestFor('/robots.txt'))).text()

    expect(body).toContain('Allow: /')
    expect(body).not.toContain('Disallow')
  })
})

describe('sitemap.xml (AGL-1263)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('lists public screens', async () => {
    given({
      screens: { home: '/', about: 'about' },
      screenDocs: [
        { id: 'home', visibility: HostScreenVisibility.PUBLIC },
        { id: 'about' },
      ],
    })

    const locs = locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text())

    expect(locs).toEqual([
      'https://acme.aglyn.app/',
      'https://acme.aglyn.app/about',
    ])
  })

  it('drops screens that are not indexable', async () => {
    // The contradiction this fixes: an unlisted page carried `noindex` in its
    // own head AND was submitted here as a canonical URL. Password-protected
    // and members-only pages were listed too — URLs that answer with a gate.
    given({
      screens: {
        home: '/',
        unlisted: 'unlisted',
        locked: 'locked',
        members: 'members',
      },
      screenDocs: [
        { id: 'home', visibility: HostScreenVisibility.PUBLIC },
        { id: 'unlisted', visibility: HostScreenVisibility.UNLISTED },
        { id: 'locked', visibility: HostScreenVisibility.PASSWORD },
        { id: 'members', visibility: HostScreenVisibility.AUTHENTICATED },
      ],
    })

    const locs = locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text())

    expect(locs).toEqual(['https://acme.aglyn.app/'])
  })

  it('drops a collection list/entry template screen (AGL-1267)', async () => {
    // Publishing the blog's entry template put it in the routing map, so the
    // sitemap submitted `/blog-entry-template` — a URL whose body is raw
    // `{{entry.*}}` tokens, sitting next to the real `/blog` it duplicates.
    // The de-dupe at `sitemapResponse` cannot see that: different paths, same
    // page. The router 404s it now, so listing it would submit a dead URL.
    given({
      screens: {
        home: '/',
        blogEntryTmpl: 'blog-entry-template',
        blogListTmpl: 'blog',
      },
      screenDocs: [
        { id: 'home', visibility: HostScreenVisibility.PUBLIC },
        { id: 'blogEntryTmpl', visibility: HostScreenVisibility.PUBLIC },
        { id: 'blogListTmpl', visibility: HostScreenVisibility.PUBLIC },
      ],
      collectionDocs: [
        {
          slug: 'blog',
          listScreenId: 'blogListTmpl',
          entryScreenId: 'blogEntryTmpl',
        },
      ],
    })

    const locs = locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text())

    expect(locs).not.toContain('https://acme.aglyn.app/blog-entry-template')
    // The collection itself still has a URL — contributed by the collection
    // loop, not by the list template's routing entry.
    expect(locs).toEqual(['https://acme.aglyn.app/', 'https://acme.aglyn.app/blog'])
  })

  it('is empty but still a valid sitemap when the site is discouraged', async () => {
    given({
      discouraged: true,
      screens: { home: '/', about: 'about' },
      screenDocs: [{ id: 'home', visibility: HostScreenVisibility.PUBLIC }],
    })

    const response = await sitemapGet(requestFor('/sitemap.xml'))
    const xml = await response.text()

    // 200 with an empty urlset, not a 404: Search Console keeps asking, and an
    // error is something it retries rather than something it believes.
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml')
    expect(xml).toContain('<urlset')
    expect(xml).toContain('</urlset>')
    expect(locsIn(xml)).toEqual([])
  })

  it('restores every URL once the switch is cleared', async () => {
    const screens = { home: '/', about: 'about' }
    const screenDocs = [
      { id: 'home', visibility: HostScreenVisibility.PUBLIC },
      { id: 'about', visibility: HostScreenVisibility.PUBLIC },
    ]

    given({ discouraged: true, screens, screenDocs })
    expect(
      locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text()),
    ).toEqual([])

    given({ screens, screenDocs })
    expect(
      locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text()),
    ).toEqual(['https://acme.aglyn.app/', 'https://acme.aglyn.app/about'])
  })

  it('keeps listing screens when the visibility read fails', async () => {
    // Fail OPEN, matching robots.txt. The pages' own `noindex` still holds, so
    // a read failure costs precision, not correctness — whereas a blanked
    // sitemap costs a customer their search presence.
    given({ screens: { home: '/' } })
    ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => {
              throw new Error('unavailable')
            },
          }),
        }),
      }),
    })

    const locs = locsIn(await (await sitemapGet(requestFor('/sitemap.xml'))).text())

    expect(locs).toEqual(['https://acme.aglyn.app/'])
  })
})
