/**
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
 * Two server writes that change what a live site serves, and drop it
 * (AGL-3386).
 *
 * A COLLECTION'S settings decide every page it serves — the entry template
 * renders every entry, the list screen every listing, and the slug is the
 * first segment of all of them — so a template change or a rename drops the
 * collection's whole scope, and a rename the addresses it moved AWAY from,
 * which nothing can name once the write has landed.
 *
 * A DELETED SITE drops from the snapshot read before its documents went,
 * because afterwards there is nothing to resolve the site from.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockAnnounce = jest.fn(async (_options: unknown) => true)
const mockTarget = jest.fn()

jest.mock('../utils/server/announce-live-paths', () => ({
  __esModule: true,
  announceLivePaths: (options: unknown) => mockAnnounce(options),
}))

jest.mock('@aglyn/tenant-data-admin/server/collection-live-pages', () => ({
  __esModule: true,
  collectionLivePageTarget: (options: unknown) => mockTarget(options),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  hostCollectionKind: (data: { kind?: string }) =>
    data?.kind === 'catalog' ? 'catalog' : 'content',
  screenRoutePathToUrl: (path: string) => `/${path.replace(/^\/+/, '')}`,
  TENANT_APEX: 'aglyn.site',
}))

import {
  announceCollectionChange,
  collectionLivePaths,
} from '../utils/server/announce-collection-change'
import {
  dropDeletedSiteCache,
  wholeHostPaths,
} from '../utils/server/tenant-revalidate'

/** One host, one collection, its published entries — read-only. */
function fakeFirestore(options: {
  collection?: Record<string, unknown> | null
  entrySlugs?: string[]
  screens?: Record<string, string>
}) {
  const { collection = { slug: 'blog' }, entrySlugs = [], screens = {} } = options
  const entriesQuery = {
    where: () => entriesQuery,
    select: () => entriesQuery,
    limit: () => entriesQuery,
    get: async () => ({
      docs: entrySlugs.map((slug) => ({ get: () => slug })),
    }),
  }
  const collectionDoc = {
    get: async () => ({
      exists: collection !== null,
      get: (field: string) => (collection ?? {})[field],
      data: () => collection,
    }),
    collection: () => entriesQuery,
  }
  const hostDoc = {
    get: async () => ({
      exists: true,
      get: (field: string) =>
        ({ subdomain: 'acme', screens } as Record<string, unknown>)[field],
    }),
    collection: () => ({ doc: () => collectionDoc }),
  }
  return {
    collection: () => ({ doc: () => hostDoc }),
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockTarget.mockImplementation(async ({ entrySlugs }: { entrySlugs: string[] }) => ({
    paths: [...entrySlugs.map((slug) => `/blog/${slug}`), '/blog'],
  }))
})

describe('collectionLivePaths', () => {
  it('puts every published entry in front of the collection scope', async () => {
    const paths = await collectionLivePaths({
      firestore: fakeFirestore({ entrySlugs: ['one', 'two'] }),
      hostId: 'host-1',
      collectionId: 'c1',
    })
    expect(mockTarget).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-1', collectionId: 'c1', entrySlugs: ['one', 'two'] }),
    )
    expect(paths).toEqual(['/blog/one', '/blog/two', '/blog'])
  })

  it('names a catalog collection by its store address', async () => {
    const paths = await collectionLivePaths({
      firestore: fakeFirestore({ collection: { slug: 'shoes', kind: 'catalog' } }),
      hostId: 'host-1',
      collectionId: 'c1',
    })
    expect(paths).toEqual(['/collections/shoes'])
    expect(mockTarget).not.toHaveBeenCalled()
  })

  it('names nothing for a collection that is gone', async () => {
    const paths = await collectionLivePaths({
      firestore: fakeFirestore({ collection: null }),
      hostId: 'host-1',
      collectionId: 'c1',
    })
    expect(paths).toEqual([])
  })
})

describe('announceCollectionChange', () => {
  it('drops the old addresses, the new ones and the demoted screens’ routes', async () => {
    await announceCollectionChange({
      firestore: fakeFirestore({ entrySlugs: ['one'], screens: { s9: 'old-template' } }),
      hostId: 'host-1',
      collectionId: 'c1',
      before: ['/news/one', '/news'],
      screenIds: ['s9', 'not-routed'],
    })
    expect(mockAnnounce).toHaveBeenCalledTimes(1)
    const { paths, hostId } = mockAnnounce.mock.calls[0][0] as {
      paths: string[]
      hostId: string
    }
    expect(hostId).toBe('host-1')
    expect(paths).toEqual(['/old-template', '/news/one', '/news', '/blog/one', '/blog'])
  })

  it('never throws — the collection write has already landed', async () => {
    mockTarget.mockRejectedValue(new Error('boom'))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      announceCollectionChange({
        firestore: fakeFirestore({}),
        hostId: 'host-1',
        collectionId: 'c1',
      }),
    ).resolves.toBe(false)
  })
})

describe('the collections route asks for the drop', () => {
  const route = readFileSync(
    join(__dirname, '..', 'app', 'api', 'hosts', 'collections', 'route.ts'),
    'utf8',
  )

  it('after a template pointer write, with the screens it demoted', () => {
    const body = route.slice(
      route.indexOf('async function writeTemplatePointers('),
      route.indexOf('async function handler('),
    )
    expect(body.indexOf('await batch.commit()')).toBeGreaterThan(0)
    expect(body.indexOf('await announceCollectionChange(')).toBeGreaterThan(
      body.indexOf('await batch.commit()'),
    )
    expect(body).toMatch(/screenIds: \[\.\.\.demote\]/)
  })

  it('reads a rename’s old addresses BEFORE the transaction, and drops after it', () => {
    const body = route.slice(route.indexOf('async function handler('))
    const before = body.indexOf('await collectionLivePaths(')
    const transaction = body.indexOf('await firestore.runTransaction(')
    const announce = body.indexOf('await announceCollectionChange(')
    expect(before).toBeGreaterThan(0)
    expect(transaction).toBeGreaterThan(before)
    expect(announce).toBeGreaterThan(transaction)
    expect(body.slice(announce, announce + 120)).toMatch(/before/)
  })
})

describe('a deleted site', () => {
  const snapshot = (fields: Record<string, unknown>) => ({
    id: 'host-1',
    get: (field: string) => fields[field],
  })
  const fetchMock = jest.fn()
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.REVALIDATE_SECRET = 'secret'
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ revalidated: ['/'] }),
    })
    global.fetch = fetchMock as never
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.REVALIDATE_SECRET
  })

  it('names the root and every routed page', () => {
    expect(
      wholeHostPaths(snapshot({ screens: { a: 'pricing', b: 'about/team' } })),
    ).toEqual(['/', '/pricing', '/about/team'])
  })

  it('drops every page on both cache keys and expires both names, from the snapshot', async () => {
    await expect(
      dropDeletedSiteCache(
        snapshot({ subdomain: 'acme', cname: 'acme.com', screens: { a: 'pricing' } }),
      ),
    ).resolves.toBe(true)
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse((call[1] as { body: string }).body),
    )
    expect(bodies).toEqual(
      expect.arrayContaining([
        { host: 'acme', hostId: 'host-1', paths: ['/', '/pricing'] },
        { host: 'cname--acme.com', hostId: 'host-1', paths: ['/', '/pricing'] },
        { host: 'acme', hostId: 'host-1', paths: [], aliases: ['cname--acme.com'] },
      ]),
    )
  })

  it('does nothing for a site that never had a subdomain', async () => {
    await expect(dropDeletedSiteCache(snapshot({}))).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
