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

import { HostScreenVisibility } from '@aglyn/aglyn/server'

interface StoredScreen {
  id: string
  doc: Record<string, unknown>
}

const HASH_PUBLIC = 'a'.repeat(64)
const HASH_PROTECTED = 'b'.repeat(64)

/*
  ⚠️ NOT ONE OF THESE CARRIES A `status` FIELD, and that is deliberate
  (AGL-2719). The previous fixture stamped `status: PUBLISHED` on every screen,
  which is a shape production has never held — measured on the live site: 69
  screen documents, `status` undefined on all 69. So the suite answered a
  `where('status','==',PUBLISHED)` with rows while the same query returned
  nothing in reality, and the endpoint shipped empty for every site on the
  platform with a green test beside it.

  A fixture must hold what the database holds. These do.
*/
const storedScreens: StoredScreen[] = [
  {
    id: 'screen-about',
    doc: {
      visibility: HostScreenVisibility.PUBLIC,
      slug: 'about',
      displayName: 'About',
      description: 'Who we are',
      order: 1,
      seo: {
        title: 'About us',
        description: 'The team',
        // The social card group (AGL-1337, AGL-2417) — carried here so the
        // projection is asked about the alt too, which it used to drop.
        image: 'media:host-demo/og-about',
        imageWidth: 1200,
        imageHeight: 630,
        imageAlt: 'The About page card',
      },
      // A public page can still carry a stale hash.
      protection: { passwordHash: HASH_PUBLIC },
      localeVariants: { fr: 'screen-about-fr' },
      versionId: 'version-secret',
    },
  },
  {
    id: 'screen-careers',
    doc: {
      visibility: HostScreenVisibility.PUBLIC,
      slug: 'careers',
      displayName: 'Careers',
      order: 2,
    },
  },
  {
    id: 'screen-investors',
    doc: {
      visibility: HostScreenVisibility.PASSWORD,
      slug: 'investors',
      displayName: 'Investor update Q3',
      protection: { passwordHash: HASH_PROTECTED },
    },
  },
  {
    id: 'screen-template',
    doc: { visibility: HostScreenVisibility.PUBLIC, slug: 'products' },
  },
  {
    id: 'screen-404',
    doc: { visibility: HostScreenVisibility.PUBLIC, slug: '404' },
  },
  {
    // In the collection but NOT in the routing map: an unpublished draft. The
    // routing map is what the router serves, so this is not a page.
    id: 'screen-unpublished',
    doc: {
      visibility: HostScreenVisibility.PUBLIC,
      slug: 'unreleased',
      displayName: 'Unreleased',
    },
  },
]

/*
  The routing map, which is now the published set. `screen-orphan` is in it
  with no document behind it — a routing entry a publish left dangling, which
  the router cannot render and this must not list.
*/
const mockRoutes: Record<string, string> = {
  'screen-about': 'company/about',
  'screen-careers': 'careers',
  'screen-investors': 'investors',
  'screen-template': 'products',
  'screen-404': '404',
  'screen-orphan': 'ghost',
}

let requestedProjection: string[] | null = null

function applyProjection(
  doc: Record<string, unknown>,
  fields: string[] | null,
): Record<string, unknown> {
  if (!fields) return { ...doc }
  const masked: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in doc) masked[field] = doc[field]
  }
  return masked
}

function mockMakeQuery(fields: string[] | null = null): any {
  return {
    select: (...next: string[]) => {
      requestedProjection = next
      return mockMakeQuery(next)
    },
    limit: () => mockMakeQuery(fields),
    get: async () => {
      const docs = storedScreens.map((screen) => ({
        id: screen.id,
        data: () => applyProjection(screen.doc, fields),
      }))
      return { size: docs.length, docs }
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({ collection: () => mockMakeQuery() }),
        }),
      }),
    }),
  },
}))

/*
  Resolving the ADDRESSED name to a host document is the half of AGL-2719 that
  the old mock could not express at all: it resolved every `.doc()` to the same
  collection, so `.doc('aglyn.com')` — a document that does not exist — looked
  identical to `.doc('DXnRbPH4CQ')`, which does.
*/
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: async ({ host }: { host: string }) =>
    host === 'demo.aglyn.app' || host === 'demo'
      ? {
          host: {
            $id: 'host-demo',
            screens: mockRoutes,
            notFoundScreenId: 'screen-404',
          },
        }
      : { host: undefined },
}))

jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: async () => new Set(['screen-template']),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('../app/api/screen/route')

async function callRoute(query = '?host=demo'): Promise<{ raw: string; body: any }> {
  const response = await GET(new Request(`https://demo.aglyn.app/api/screen${query}`))
  const raw = await response.text()
  return { raw, body: JSON.parse(raw) }
}

beforeEach(() => {
  requestedProjection = null
})

describe('GET /api/screen response projection (AGL-2191)', () => {
  it('never ships a password hash, under any key', async () => {
    const { raw, body } = await callRoute()

    expect(raw).not.toContain('passwordHash')
    expect(raw).not.toContain(HASH_PUBLIC)
    expect(raw).not.toContain(HASH_PROTECTED)
    // Not the field NAME but the SHAPE: any long hex run is a digest, whatever
    // the key that carried it is called.
    expect(raw).not.toMatch(/"[0-9a-f]{32,}"/)
    expect(JSON.stringify(body)).not.toMatch(/hash/i)
  })

  it('reads a projection rather than the whole document', async () => {
    await callRoute()

    expect(requestedProjection).not.toBeNull()
    expect(requestedProjection).not.toContain('protection')
  })

  it('publishes only allow-listed fields', async () => {
    const { body } = await callRoute()
    const allowed = new Set([
      '$id',
      'path',
      'slug',
      'parentId',
      'order',
      'displayName',
      'description',
      'locale',
      'publishedAt',
      'updatedAt',
      'seo',
    ])

    expect(body.data.screens.length).toBeGreaterThan(0)
    for (const screen of body.data.screens) {
      for (const key of Object.keys(screen)) {
        // Fails on a field NOBODY has thought about yet, which is the point:
        // a denylist would only fail on the one field somebody remembered.
        expect(allowed.has(key)).toBe(true)
      }
    }
  })

  it('still serves the page metadata a listing is for', async () => {
    const { body } = await callRoute()
    const about = body.data.screens.find(
      (screen: any) => screen.$id === 'screen-about',
    )

    expect(about).toBeDefined()
    expect(about.slug).toBe('about')
    expect(about.displayName).toBe('About')
    expect(about.order).toBe(1)
    expect(about.seo.title).toBe('About us')
    // The card group survives whole, alt included (AGL-2398).
    expect(about.seo.image).toBe('media:host-demo/og-about')
    expect(about.seo.imageWidth).toBe(1200)
    expect(about.seo.imageHeight).toBe(630)
    expect(about.seo.imageAlt).toBe('The About page card')
  })

  it('serves the composed route, not just the slug segment', async () => {
    // `slug` is one segment; the routing map holds the whole path. A caller
    // rebuilding `/company/about` from `slug` + `parentId` is doing the
    // router's job with less information than the router had.
    const { body } = await callRoute()
    const about = body.data.screens.find(
      (screen: any) => screen.$id === 'screen-about',
    )
    expect(about.path).toBe('/company/about')
    expect(about.slug).toBe('about')
  })

  it('omits gated screens entirely', async () => {
    const { raw, body } = await callRoute('?host=demo&limit=100')
    const ids = body.data.screens.map((screen: any) => screen.$id)

    expect(ids).not.toContain('screen-investors')
    // Not just the id — the TITLE of a members-only page is itself something
    // an anonymous listing should not disclose.
    expect(raw).not.toContain('Investor update Q3')
  })
})

/**
 * The two faults that made this endpoint answer `[]` for every site on the
 * platform (AGL-2719). Each of these fails against the pre-fix reader.
 */
describe('GET /api/screen lists what the router actually serves (AGL-2719)', () => {
  it('lists a screen that carries NO status field — which is every screen', async () => {
    // The regression in one line. `where('status','==',PUBLISHED)` matched
    // nothing because nothing writes `status`; these fixtures now hold the
    // shape production holds, so a reader that still filtered on it returns
    // an empty list here and fails.
    const { body } = await callRoute('?host=demo&limit=100')
    const ids = body.data.screens.map((screen: any) => screen.$id)

    expect(ids).toContain('screen-about')
    expect(ids).toContain('screen-careers')
    for (const screen of storedScreens) {
      expect(screen.doc.status).toBeUndefined()
    }
  })

  it('resolves the site from the name the caller addressed, not a document id', async () => {
    // `hosts/demo.aglyn.app` does not exist; `hosts/host-demo` does. Reading
    // `.doc(host)` with the addressed name queried a document that is not
    // there, which is fatal on its own even with a correct filter.
    const { body } = await callRoute('?host=demo.aglyn.app&limit=100')
    expect(body.data.screens.length).toBeGreaterThan(0)
  })

  it('says "no such site" rather than answering with an empty page', async () => {
    // The failure mode that hid all of this: "no pages" and "no such site"
    // read identically, so nothing downstream could tell them apart.
    const { body } = await callRoute('?host=nobody.example&limit=100')
    expect(body.status).not.toBe('success')
  })

  it('answers an unknown site 404, not 500 (AGL-2724)', async () => {
    /*
      Measured on production before this assertion existed: it returned 500.
      A 500 says the server is broken and the request is worth retrying —
      and an agent walking a list of domains then retries a host that will
      never exist, and cannot tell it apart from a real outage. The request
      was well-formed; only the status carries the difference.
    */
    const response = await GET(
      new Request('https://demo.aglyn.app/api/screen?host=nobody.example'),
    )
    expect(response.status).toBe(404)

    // And a site that DOES exist is still a 200, so the 404 is about the
    // host and not about the shape of the request.
    const ok = await GET(new Request('https://demo.aglyn.app/api/screen?host=demo'))
    expect(ok.status).toBe(200)
  })

  it('excludes template screens and error screens, exactly as the sitemap does', async () => {
    const { body } = await callRoute('?host=demo&limit=100')
    const ids = body.data.screens.map((screen: any) => screen.$id)

    // A template is not a page — the router refuses to serve one.
    expect(ids).not.toContain('screen-template')
    // An error screen is a status, not a destination (AGL-2486).
    expect(ids).not.toContain('screen-404')
  })

  it('skips a routing entry with no document behind it', async () => {
    const { body } = await callRoute('?host=demo&limit=100')
    const ids = body.data.screens.map((screen: any) => screen.$id)
    expect(ids).not.toContain('screen-orphan')
  })

  it('lists nothing that is absent from the routing map', async () => {
    // The collection holds drafts the router does not serve. The routing map,
    // not the collection, is the published set.
    const { body } = await callRoute('?host=demo&limit=100')
    const ids = body.data.screens.map((screen: any) => screen.$id)
    expect(ids).not.toContain('screen-unpublished')
  })
})

/**
 * The cursor `nextPageToken` names (AGL-2716), carried across the AGL-2719
 * rewrite: the token is still the last id of the page just served, so a caller
 * holding one from before the change keeps working.
 */
describe('GET /api/screen pagination (AGL-2716)', () => {
  it('orders the listing, so a cursor addresses the same set on every call', async () => {
    // The invariant `orderBy('__name__')` used to buy at the query. The set is
    // now assembled in memory, so the ordering is asserted on the OUTPUT,
    // which is the thing that actually had to hold.
    const first = await callRoute('?host=demo&limit=100')
    const again = await callRoute('?host=demo&limit=100')
    const ids = (page: any) => page.body.data.screens.map((s: any) => s.$id)

    expect(ids(first)).toEqual(ids(again))
    expect(ids(first)).toEqual([...ids(first)].sort())
  })

  it('hands back a cursor when more remain, and none when they do not', async () => {
    const first = await callRoute('?host=demo&limit=1')
    expect(first.body.data.screens.length).toBe(1)
    expect(first.body.data.nextPageToken).toBeTruthy()

    const last = await callRoute('?host=demo&limit=100')
    expect(last.body.data.nextPageToken).toBe('')
  })

  it('never hands back a cursor that returns nothing', async () => {
    // The old reader could: it compared the page size to the LIMIT, so a full
    // page whose successor was empty still advertised a token.
    let token = ''
    let guard = 0
    do {
      const page: { body: any } = await callRoute(
        `?host=demo&limit=1${token ? `&nextPageToken=${token}` : ''}`,
      )
      if (token) expect(page.body.data.screens.length).toBeGreaterThan(0)
      token = page.body.data.nextPageToken
      guard += 1
    } while (token && guard < 20)
  })

  it('continues from the cursor without repeating a page', async () => {
    const first = await callRoute('?host=demo&limit=1')
    const second = await callRoute(
      `?host=demo&limit=1&nextPageToken=${first.body.data.nextPageToken}`,
    )
    const firstIds = first.body.data.screens.map((screen: any) => screen.$id)
    const secondIds = second.body.data.screens.map((screen: any) => screen.$id)
    expect(secondIds).not.toEqual(firstIds)
    for (const id of secondIds) expect(firstIds).not.toContain(id)
  })

  it('reaches every listable screen by following the cursor', async () => {
    const seen: string[] = []
    let token = ''
    for (let request = 0; request < 20; request += 1) {
      const page: { body: any } = await callRoute(
        `?host=demo&limit=1${token ? `&nextPageToken=${token}` : ''}`,
      )
      for (const screen of page.body.data.screens) seen.push(screen.$id)
      token = page.body.data.nextPageToken
      if (!token) break
    }
    expect(seen).toContain('screen-about')
    expect(seen).toContain('screen-careers')
    expect(seen).not.toContain('screen-investors')
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('clamps a limit nobody should be able to ask for', async () => {
    // A caller asking for 100,000 pages is asking for a sweep on an
    // anonymous endpoint.
    const huge = await callRoute('?host=demo&limit=100000')
    expect(huge.body.data.screens.length).toBeLessThanOrEqual(100)
    const zero = await callRoute('?host=demo&limit=0')
    expect(zero.body.status).toBe('success')
    const nonsense = await callRoute('?host=demo&limit=abc')
    expect(nonsense.body.status).toBe('success')
  })

  it('resolves the site from the request host when no parameter is given', async () => {
    /*
      The spelling a stranger can guess. The `Host` header is set explicitly
      because a `Request` built in a test carries none; a real one always does,
      which is the whole point of reading it.
    */
    const response = await GET(
      new Request('https://demo.aglyn.app/api/screen', {
        headers: { host: 'demo.aglyn.app' },
      }),
    )
    expect(response.status).toBe(200)
  })

  it('still refuses when there is no site to resolve at all', async () => {
    const response = await GET(new Request('https://demo.aglyn.app/api/screen'))
    expect(response.status).not.toBe(200)
  })
})
