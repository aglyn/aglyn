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
 * Which collections `/llms.txt` and `/openapi.json` advertise (AGL-3101).
 *
 * Both files are built from `readAgentSiteFacts`, and both hand an agent two
 * addresses per collection: its listing and its feed. A collection with
 * nothing published answers 404 at both until its first entry goes live, so
 * naming it gives an agent two dead links — and agents cache what a site told
 * them. `agent-discovery-routes.spec.ts` covers the routes around a mocked
 * reader; this drives the REAL reader over a Firestore stand-in, because the
 * decision under test lives in it.
 *
 * The count stays fail-open: a count that errors is a missing number, not a
 * zero, and a live collection must not disappear from the guide over one.
 */

/*
  MODULE, not a script: a file with no top-level `import`/`export` is a global
  script whose consts share one namespace with every other script spec.
*/
export {}

interface MockCollection {
  id: string
  data: Record<string, unknown>
  /** Entry statuses, one per entry document. */
  entries?: string[]
  /** The `count()` aggregation rejects, as a transient Firestore error does. */
  countFails?: boolean
}

const mockSite: { collections: MockCollection[] } = { collections: [] }

const mockCollectionSnapshot = (row: MockCollection) => ({
  id: row.id,
  data: () => row.data,
  get: (field: string) => row.data[field],
  ref: {
    collection: () => ({
      where: (field: string, _op: string, wanted: unknown) => ({
        count: () => ({
          get: async () => {
            if (row.countFails) throw new Error('count unavailable')
            return {
              data: () => ({
                count: (row.entries ?? []).filter(
                  (status) => field === 'status' && status === wanted,
                ).length,
              }),
            }
          },
        }),
      }),
    }),
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => {
              const query = {
                select: () => query,
                limit: () => query,
                get: async () => ({
                  docs: mockSite.collections.map(mockCollectionSnapshot),
                }),
              }
              return query
            },
          }),
        }),
      }),
    }),
  },
  visitorContentRefusal: async () => null,
}))

jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: async () => ({ host: mockHostRecord, error: null }),
}))

jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  getTemplateScreenRouting: async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {},
    collectionListings: {},
  }),
}))

const mockHostRecord = {
  $id: 'host-1',
  displayName: 'Acme',
  cname: 'acme.test',
  screens: { home: '/' },
  seo: { title: 'Acme' },
}

const { readAgentSiteFacts } = require('../app/api/_agent-site-facts')
const { GET: llmsGet } = require('../app/api/llms/route')
const { GET: openapiGet } = require('../app/api/openapi/route')

const request = (path: string) =>
  new Request(`https://acme.test${path}?host=acme`, {
    headers: { host: 'acme.test' },
  })

beforeEach(() => {
  mockSite.collections = [
    {
      id: 'c-blog',
      data: { kind: 'content', slug: 'blog', displayName: 'Blog' },
      entries: ['published', 'published', 'draft'],
    },
    // Created, nothing written yet — the case AGL-3101 is about.
    {
      id: 'c-videos',
      data: { kind: 'content', slug: 'videos', displayName: 'Videos' },
      entries: [],
    },
    // Written, but nothing PUBLISHED: drafts and a schedule still to come.
    {
      id: 'c-notes',
      data: { kind: 'content', slug: 'notes', displayName: 'Notes' },
      entries: ['draft', 'scheduled'],
    },
    {
      id: 'c-press',
      data: { kind: 'content', slug: 'press', displayName: 'Press' },
      entries: ['published'],
      countFails: true,
    },
    { id: 'c-sale', data: { kind: 'catalog', slug: 'sale' } },
  ]
})

describe('readAgentSiteFacts (AGL-3101)', () => {
  it('names only the collections with something published', async () => {
    const facts = await readAgentSiteFacts(mockHostRecord)
    expect(facts.collections.map((c: { slug: string }) => c.slug)).toEqual([
      'blog',
      'press',
    ])
  })

  it('keeps the count of a live collection exactly as before', async () => {
    const facts = await readAgentSiteFacts(mockHostRecord)
    expect(facts.collections[0]).toEqual({
      slug: 'blog',
      name: 'Blog',
      entryCount: 2,
    })
  })

  it('keeps a collection whose count failed, without a number', async () => {
    // Fail-open: an unknown count is not a zero, and hiding a live collection
    // over a transient error would be the worse of the two mistakes.
    const facts = await readAgentSiteFacts(mockHostRecord)
    expect(
      facts.collections.find((c: { slug: string }) => c.slug === 'press'),
    ).toEqual({ slug: 'press', name: 'Press' })
  })
})

describe('the two files built from it (AGL-3101)', () => {
  it('leaves an unpublished collection out of /llms.txt, listing and feed alike', async () => {
    const body = await (await llmsGet(request('/api/llms'))).text()
    expect(body).toContain('[Blog](https://acme.test/blog)')
    expect(body).toContain('[Blog (RSS)](https://acme.test/blog/rss.xml)')
    expect(body).not.toContain('https://acme.test/videos')
    expect(body).not.toContain('https://acme.test/notes')
  })

  it('leaves it out of the collections /openapi.json describes', async () => {
    const document = JSON.parse(
      await (await openapiGet(request('/api/openapi'))).text(),
    )
    expect(
      document.paths['/{collectionSlug}/rss.xml'].get.parameters[0].schema.enum,
    ).toEqual(['blog', 'press'])
  })
})
