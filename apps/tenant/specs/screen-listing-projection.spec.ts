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
 * `GET /api/screen?host=` may not publish a screen's secrets (AGL-2191).
 *
 * The route is anonymous by design — `/api` is outside the middleware matcher
 * and a site's page list is public information — so the boundary is not WHO
 * calls it, it is WHAT it returns. It used to return `screen.data()`, the whole
 * Firestore document, which carries `protection.passwordHash`: the unsalted
 * sha256 of the visitor password (AGL-87). Handing that to an anonymous caller
 * defeats the protection outright and offline, with none of the durable
 * brute-force budget `/api/protection/unlock` charges (AGL-794).
 *
 * ## What makes this spec able to fail
 *
 * The Firestore stand-in models `select()` the way Firestore does: a query with
 * a projection yields documents holding ONLY the projected fields, and a query
 * WITHOUT one yields the whole document. That is the load-bearing detail — an
 * unfaithful double that always masked would report green over a route that had
 * stopped projecting. Restoring the raw return (dropping the `select()` and the
 * `toPublicScreen` copy from `utils/get-all-screens.ts`) turns every assertion
 * below red, which is how this was proven.
 *
 * The public screen deliberately carries a `passwordHash` of its own. It is
 * there so the leak cannot be closed by the visibility FILTER alone: if someone
 * removes the projection but keeps the filter, that screen still ships its hash
 * and this spec still fails.
 */

import { HostScreenStatus, HostScreenVisibility } from '@aglyn/aglyn/server'

/** A stored screen, exactly as Firestore holds it. */
interface StoredScreen {
  id: string
  doc: Record<string, unknown>
}

const HASH_PUBLIC = 'a'.repeat(64)
const HASH_PROTECTED = 'b'.repeat(64)

const storedScreens: StoredScreen[] = [
  {
    id: 'screen-about',
    doc: {
      status: HostScreenStatus.PUBLISHED,
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
      // A public page can still carry a stale hash. See the note above.
      protection: { passwordHash: HASH_PUBLIC },
      localeVariants: { fr: 'screen-about-fr' },
      versionId: 'version-secret',
    },
  },
  {
    id: 'screen-investors',
    doc: {
      status: HostScreenStatus.PUBLISHED,
      visibility: HostScreenVisibility.PASSWORD,
      slug: 'investors',
      displayName: 'Investor update Q3',
      protection: { passwordHash: HASH_PROTECTED },
    },
  },
  {
    id: 'screen-unpublished',
    doc: {
      status: HostScreenStatus.UNPUBLISHED,
      visibility: HostScreenVisibility.PUBLIC,
      slug: 'unreleased',
      displayName: 'Unreleased',
    },
  },
]

/**
 * The `select()` mask the query asked for, captured so the assertions can also
 * state that a projection was requested at all rather than only that the
 * response happened to look clean.
 */
let requestedProjection: string[] | null = null

/** Firestore's own masking rule: absent projection = the whole document. */
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

interface QueryState {
  filters: Array<[string, unknown]>
  fields: string[] | null
  limit: number
  /** Which field the query ordered by, or null — see `orderedBy` below. */
  orderBy: string | null
  /** The `startAfter` cursor, exclusive. */
  after: string | null
}

/**
 * The order the query asked for, captured so a test can assert that ONE was
 * asked for at all (AGL-2716).
 *
 * `limit()` with no `orderBy` returns an arbitrary slice, and a cursor into an
 * arbitrary order pages through a different set on every call — so "the
 * response looked right" is not evidence here. This is.
 */
let orderedBy: string | null = null

function mockMakeQuery(state: QueryState) {
  const query = {
    where: (field: string, _op: string, value: unknown) =>
      mockMakeQuery({ ...state, filters: [...state.filters, [field, value]] }),
    select: (...fields: string[]) => {
      requestedProjection = fields
      return mockMakeQuery({ ...state, fields })
    },
    orderBy: (field: string) => {
      orderedBy = field
      return mockMakeQuery({ ...state, orderBy: field })
    },
    startAfter: (after: string) => mockMakeQuery({ ...state, after }),
    limit: (limit: number) => mockMakeQuery({ ...state, limit }),
    get: async () => {
      let matched = storedScreens.filter((screen) =>
        state.filters.every(([field, value]) => screen.doc[field] === value),
      )
      // `__name__` is the document id. Ordering by anything else is not
      // modelled, because nothing asks for it.
      if (state.orderBy === '__name__') {
        matched = [...matched].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      }
      if (state.after) {
        matched = matched.filter((screen) => screen.id > (state.after as string))
      }
      const page = matched.slice(0, state.limit).map((screen) => ({
        id: screen.id,
        data: () => applyProjection(screen.doc, state.fields),
      }))
      return {
        size: page.length,
        docs: page,
        forEach: (fn: (doc: (typeof page)[number]) => void) => page.forEach(fn),
      }
    },
  }
  return query
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () =>
              mockMakeQuery({
                filters: [],
                fields: null,
                limit: Infinity,
                orderBy: null,
                after: null,
              }),
          }),
        }),
      }),
    }),
  },
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
  orderedBy = null
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
    // The card group survives whole, alt included (AGL-2398). `imageAlt` was
    // added to storage and to the resolver by AGL-2417 but never to this
    // key-by-key mapper, so a listing handed back an image with no
    // description — half a group, which is the shape this asserts against.
    expect(about.seo.image).toBe('media:host-demo/og-about')
    expect(about.seo.imageWidth).toBe(1200)
    expect(about.seo.imageHeight).toBe(630)
    expect(about.seo.imageAlt).toBe('The About page card')
  })

  it('omits gated and unpublished screens entirely', async () => {
    const { raw, body } = await callRoute()
    const ids = body.data.screens.map((screen: any) => screen.$id)

    expect(ids).not.toContain('screen-investors')
    expect(ids).not.toContain('screen-unpublished')
    // Not just the id — the TITLE of a members-only page is itself something
    // an anonymous listing should not disclose.
    expect(raw).not.toContain('Investor update Q3')
  })
})

/**
 * The cursor `nextPageToken` names (AGL-2716). It was accepted by the route,
 * threaded into the reader, and read by nothing: the query was a bare
 * `.limit(5)` and the token came back `''` every time, so a site's sixth page
 * was unreachable through this endpoint.
 */
describe('GET /api/screen pagination (AGL-2716)', () => {
  it('orders the query — a cursor into an unordered slice pages nothing', () => {
    return callRoute().then(() => {
      expect(orderedBy).toBe('__name__')
    })
  })

  it('hands back a cursor when the page is full, and none when it is not', async () => {
    const first = await callRoute('?host=demo&limit=1')
    expect(first.body.data.screens.length).toBe(1)
    expect(first.body.data.nextPageToken).toBeTruthy()

    const last = await callRoute('?host=demo&limit=100')
    expect(last.body.data.nextPageToken).toBe('')
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

  it('reaches every published, indexable screen by following the cursor', async () => {
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
    expect(seen).not.toContain('screen-unpublished')
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('clamps a limit nobody should be able to ask for', async () => {
    // A caller asking for 100,000 pages is asking for a Firestore sweep on an
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
      The spelling a stranger can guess — before this the endpoint answered
      `Bad request` to it, which made it undescribable in `/openapi.json`.

      The `Host` header is set explicitly because a `Request` built in a test
      carries none; a real one always does, which is the whole point of reading
      it. `getAllScreens` is reached with whatever this resolves to, and the
      mocked Firestore answers the same fixtures for any site.
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
