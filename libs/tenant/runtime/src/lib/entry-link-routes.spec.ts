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
 * Where the entries a page links to are served (AGL-3118).
 *
 * Two claims, and the suite is split along them:
 *
 * - WHICH entries answer is a wrong-answer failure — a link offered to a
 *   draft is a link to a 404, and a live entry left out is a dead link — so
 *   every state an entry can be in is planted and asserted by path.
 * - WHAT it costs is invisible in behavior: a resolver that read every
 *   document one at a time, or the whole collection, or on every render,
 *   returns exactly what this one returns. So the Firestore stand-in counts
 *   the batches that reach it and records what each asked for, and the cache
 *   is a real one keyed the way `withRenderCache` keys.
 */

/** Every `getAll` that reached the fake: the paths it read and its mask. */
const batches: Array<{ paths: string[]; fieldMask?: string[] }> = []
/** The entry documents that exist, by path, with their stored fields. */
let documents: Record<string, Record<string, unknown>> = {}
/** `getAll` rejects, for the fail-open cases. */
let readFails = false

let orgForHost: { orgId: string; org: Record<string, unknown> } | null = null
let orgReads = 0

interface FakeRef {
  path: string
  collection: (name: string) => { doc: (id: string) => FakeRef }
}

const refAt = (path: string): FakeRef => ({
  path,
  collection: (name) => ({ doc: (id) => refAt(`${path}/${name}/${id}`) }),
})

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => refAt(`${name}/${id}`) }),
  getAll: async (...args: Array<Partial<FakeRef> & { fieldMask?: string[] }>) => {
    const refs = args.filter((arg): arg is FakeRef => typeof arg.path === 'string')
    const options = args.find((arg) => typeof arg.path !== 'string')
    batches.push({
      paths: refs.map((ref) => ref.path),
      fieldMask: options?.fieldMask,
    })
    if (readFails) throw new Error('firestore down')
    return refs.map((ref) => {
      const fields = documents[ref.path]
      return {
        exists: Boolean(fields),
        data: () => (fields ? { ...fields } : undefined),
      }
    })
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => firestore }) },
  getOrgForHost: async () => {
    orgReads += 1
    return orgForHost
  },
}))

/** Keys the cache saw, in order, and what it holds. */
const cacheKeys: string[] = []
const cacheStore = new Map<string, unknown>()

/**
 * A REAL cache rather than a pass-through: the cache key and the `store`
 * refusal are both under test. Keyed on `key.join('|')`, honoring `store`.
 */
jest.mock('@aglyn/tenant-data-admin/render-cache', () => ({
  __esModule: true,
  PUBLISHED_SITE_DATA_TTL_SECONDS: 3600,
  tenantDataTag: (hostId: string) => `tenant-data:${hostId}`,
  withRenderCache: async (options: {
    key: readonly string[]
    tags: readonly string[]
    revalidate: number
    read: () => Promise<unknown>
    store?: (value: unknown) => boolean
  }) => {
    const key = options.key.join('|')
    cacheKeys.push(key)
    expect(options.tags).toEqual(['tenant-data:host-1'])
    expect(options.revalidate).toBe(3600)
    if (cacheStore.has(key)) return cacheStore.get(key)
    // What `withRenderCache` does to a value: it stores JSON.
    const value = JSON.parse(JSON.stringify(await options.read()))
    if (!options.store || options.store(value)) cacheStore.set(key, value)
    return value
  },
}))

import { ENTRY_LINK_ROUTES_MAX, resolveEntryLinkRoutes } from './entry-link-routes'

const HOST = 'host-1'
const COLLECTIONS = { blog: 'blog', vids: 'videos' }

const nowSeconds = () => Math.floor(Date.now() / 1000)
const AN_HOUR_AGO = () => ({ seconds: nowSeconds() - 3600 })
const IN_AN_HOUR = () => ({ seconds: nowSeconds() + 3600 })

const entryPath = (collectionId: string, entryId: string) =>
  `hosts/${HOST}/collections/${collectionId}/entries/${entryId}`

const plant = (
  collectionId: string,
  entryId: string,
  fields: Record<string, unknown>,
) => {
  documents[entryPath(collectionId, entryId)] = fields
}

const resolve = (
  refs: string[],
  collectionSlugs: Record<string, string> | null | undefined = COLLECTIONS,
) => resolveEntryLinkRoutes({ hostId: HOST, refs, collectionSlugs })

beforeEach(() => {
  batches.length = 0
  cacheKeys.length = 0
  cacheStore.clear()
  documents = {}
  readFails = false
  orgForHost = { orgId: 'org-1', org: { plan: 'business' } }
  orgReads = 0
})

describe('which entries answer (AGL-3118)', () => {
  it('routes a published entry to its collection slug and its own slug', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'we-launched' })
    plant('vids', 'v1', { status: 'published', slug: 'the-film' })

    expect(await resolve(['entry:blog/e1', 'entry:vids/v1'])).toEqual({
      'entry:blog/e1': 'blog/we-launched',
      'entry:vids/v1': 'videos/the-film',
    })
  })

  it('leaves out a draft, an unpublished and a deleted entry', async () => {
    plant('blog', 'draft', { status: 'draft', slug: 'draft' })
    plant('blog', 'pulled', { status: 'unpublished', slug: 'pulled' })
    plant('blog', 'live', { status: 'published', slug: 'live' })

    expect(
      await resolve([
        'entry:blog/draft',
        'entry:blog/pulled',
        'entry:blog/deleted',
        'entry:blog/live',
      ]),
    ).toEqual({ 'entry:blog/live': 'blog/live' })
  })

  it('answers for a scheduled entry once it is due, on a plan that schedules', async () => {
    plant('blog', 'due', {
      status: 'scheduled',
      publishAt: AN_HOUR_AGO(),
      slug: 'due',
    })
    plant('blog', 'later', {
      status: 'scheduled',
      publishAt: IN_AN_HOUR(),
      slug: 'later',
    })

    expect(await resolve(['entry:blog/due', 'entry:blog/later'])).toEqual({
      'entry:blog/due': 'blog/due',
    })
  })

  it('does not answer for a due entry the plan refuses, as its own page does not', async () => {
    orgForHost = { orgId: 'org-1', org: { plan: 'free' } }
    plant('blog', 'due', {
      status: 'scheduled',
      publishAt: AN_HOUR_AGO(),
      slug: 'due',
    })

    expect(await resolve(['entry:blog/due'])).toEqual({})
  })

  it('reads the plan only when a referenced entry is due', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'e1' })
    await resolve(['entry:blog/e1'])
    expect(orgReads).toBe(0)
  })

  it('has no address for an entry without a single-segment slug', async () => {
    plant('blog', 'bare', { status: 'published' })
    plant('blog', 'nested', { status: 'published', slug: 'a/b' })

    expect(await resolve(['entry:blog/bare', 'entry:blog/nested'])).toEqual({})
  })

  it('has none for an entry whose collection has no listing to route it under', async () => {
    plant('gone', 'e1', { status: 'published', slug: 'e1' })

    expect(await resolve(['entry:gone/e1'])).toEqual({})
    // Nothing could route it, so nothing was read.
    expect(batches).toHaveLength(0)
  })
})

describe('what it reads (AGL-3118)', () => {
  it('reads nothing for a page that names no entry', async () => {
    expect(await resolve([])).toEqual({})
    expect(await resolve(['screen:home', 'collection:blog', 'entry:blog'])).toEqual(
      {},
    )
    // No routing read to name the collections: nothing could be routed.
    expect(
      await resolveEntryLinkRoutes({
        hostId: HOST,
        refs: ['entry:blog/e1'],
        collectionSlugs: undefined,
      }),
    ).toEqual({})
    expect(batches).toHaveLength(0)
    expect(cacheKeys).toHaveLength(0)
  })

  it('reads exactly the named documents, in one batch, projected to four fields', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'e1', body: '…' })
    plant('blog', 'e2', { status: 'published', slug: 'e2', body: '…' })

    await resolve(['entry:blog/e2', 'entry:blog/e1', 'entry:blog/e2'])

    expect(batches).toEqual([
      {
        paths: [entryPath('blog', 'e1'), entryPath('blog', 'e2')],
        fieldMask: ['status', 'publishAt', 'scheduleStatus', 'slug'],
      },
    ])
  })

  it('caps the batch, reading the keys that sort first', async () => {
    const refs = Array.from(
      { length: ENTRY_LINK_ROUTES_MAX + 50 },
      (_, index) => `entry:blog/e${String(index).padStart(3, '0')}`,
    )
    for (const ref of refs) {
      plant('blog', ref.slice('entry:blog/'.length), {
        status: 'published',
        slug: ref.slice('entry:blog/'.length),
      })
    }

    const routes = await resolve([...refs].reverse())

    expect(ENTRY_LINK_ROUTES_MAX).toBe(100)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.paths).toHaveLength(ENTRY_LINK_ROUTES_MAX)
    expect(Object.keys(routes)).toHaveLength(ENTRY_LINK_ROUTES_MAX)
    expect(routes['entry:blog/e000']).toBe('blog/e000')
    expect(routes['entry:blog/e149']).toBeUndefined()
  })

  it('skips an id Firestore would refuse, so it cannot fail the batch', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'e1' })

    const routes = await resolve([
      'entry:blog/e1',
      'entry:blog/..',
      'entry:blog/__reserved__',
    ])

    expect(routes).toEqual({ 'entry:blog/e1': 'blog/e1' })
    expect(batches[0]?.paths).toEqual([entryPath('blog', 'e1')])
  })
})

describe('the cache (AGL-3118)', () => {
  it('is keyed by the host and the sorted set, so order does not matter', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'e1' })
    plant('blog', 'e2', { status: 'published', slug: 'e2' })

    await resolve(['entry:blog/e2', 'entry:blog/e1'])
    await resolve(['entry:blog/e1', 'entry:blog/e2'])

    expect(batches).toHaveLength(1)
    expect(cacheKeys).toEqual([
      `tenant-entry-link-routes|${HOST}|["entry:blog/e1","entry:blog/e2"]`,
      `tenant-entry-link-routes|${HOST}|["entry:blog/e1","entry:blog/e2"]`,
    ])
  })

  it('asks again for a different set', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'e1' })
    plant('blog', 'e2', { status: 'published', slug: 'e2' })

    await resolve(['entry:blog/e1'])
    await resolve(['entry:blog/e1', 'entry:blog/e2'])

    expect(batches).toHaveLength(2)
  })

  it('moves a cached link with a renamed collection, without reading again', async () => {
    plant('blog', 'e1', { status: 'published', slug: 'we-launched' })

    expect(await resolve(['entry:blog/e1'])).toEqual({
      'entry:blog/e1': 'blog/we-launched',
    })
    expect(await resolve(['entry:blog/e1'], { blog: 'news' })).toEqual({
      'entry:blog/e1': 'news/we-launched',
    })
    expect(batches).toHaveLength(1)
  })

  it('does not store a read that holds a schedule still waiting on its time', async () => {
    // No beat publishes an entry: only a render notices one come due, so a
    // stored "not live" would outlast the schedule by the whole window.
    plant('blog', 'later', {
      status: 'scheduled',
      publishAt: IN_AN_HOUR(),
      slug: 'later',
    })

    await resolve(['entry:blog/later'])
    await resolve(['entry:blog/later'])

    expect(batches).toHaveLength(2)
  })

  it('does not store a due entry withheld because the plan could not be read', async () => {
    orgForHost = null
    plant('blog', 'due', {
      status: 'scheduled',
      publishAt: AN_HOUR_AGO(),
      slug: 'due',
    })

    expect(await resolve(['entry:blog/due'])).toEqual({})
    orgForHost = { orgId: 'org-1', org: { plan: 'business' } }
    expect(await resolve(['entry:blog/due'])).toEqual({
      'entry:blog/due': 'blog/due',
    })
    expect(batches).toHaveLength(2)
  })
})

describe('failing open (AGL-3118)', () => {
  it('answers no routes, not an error, when the read fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    readFails = true

    await expect(resolve(['entry:blog/e1'])).resolves.toEqual({})
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not store the failure, so the next render asks again', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    plant('blog', 'e1', { status: 'published', slug: 'e1' })
    readFails = true
    await resolve(['entry:blog/e1'])
    readFails = false

    expect(await resolve(['entry:blog/e1'])).toEqual({ 'entry:blog/e1': 'blog/e1' })
    expect(batches).toHaveLength(2)
    spy.mockRestore()
  })
})
