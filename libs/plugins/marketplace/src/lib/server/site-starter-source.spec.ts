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
 *
 * @jest-environment node
 */

/**
 * The marketplace's site starter source (AGL-4049): what "Create site"
 * searches, what a picked starter creates, and how an install is counted.
 *
 * Over an in-memory Firestore that applies the clauses it is asked, so a
 * search's answer is what the query and the in-memory pass together return,
 * and the REAL purchase predicate runs against purchase documents.
 */

import type { SiteStarterPayload } from '@aglyn/aglyn/app-utils/site-starter'

type Data = Record<string, any>
type Clause = { field: string; op: string; value: unknown }
interface QuerySpec {
  path: string
  clauses: Clause[]
  orderBy?: { field: string; direction: string }
  limit?: number
}

const state = {
  docs: new Map<string, Data>(),
  queries: [] as QuerySpec[],
  getAllCalls: [] as string[][],
  updates: [] as Array<{ path: string; data: Data }>,
  failUpdate: false,
  locked: new Set<string>(),
  /** `${uid}@${orgId}` for each owner/admin. */
  managers: new Set<string>(),
  versionMoves: [] as Array<Record<string, unknown>>,
}

const snapshotOf = (path: string) => {
  const data = state.docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const matches = (data: Data, clause: Clause): boolean => {
  const value = data[clause.field]
  if (clause.op === '==') return value === clause.value
  if (clause.op === 'array-contains') return Array.isArray(value) && value.includes(clause.value)
  if (clause.op === 'array-contains-any') {
    return Array.isArray(value) && (clause.value as unknown[]).some((entry) => value.includes(entry))
  }
  throw new Error(`unsupported op ${clause.op}`)
}

const millis = (value: unknown) => (typeof value === 'number' ? value : 0)

function query(spec: QuerySpec): any {
  return {
    where: (field: string, op: string, value: unknown) =>
      query({ ...spec, clauses: [...spec.clauses, { field, op, value }] }),
    orderBy: (field: string, direction = 'asc') => query({ ...spec, orderBy: { field, direction } }),
    limit: (limit: number) => query({ ...spec, limit }),
    get: async () => {
      state.queries.push(spec)
      let rows = [...state.docs.entries()]
        .filter(([path]) => path.startsWith(`${spec.path}/`) && !path.slice(spec.path.length + 1).includes('/'))
        .filter(([, data]) => spec.clauses.every((clause) => matches(data, clause)))
      if (spec.orderBy) {
        const { field, direction } = spec.orderBy
        rows = rows.sort(([, a], [, b]) =>
          direction === 'desc' ? millis(b[field]) - millis(a[field]) : millis(a[field]) - millis(b[field]),
        )
      }
      if (spec.limit !== undefined) rows = rows.slice(0, spec.limit)
      const docs = rows.map(([path]) => snapshotOf(path))
      return { empty: !docs.length, docs, size: docs.length }
    },
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snapshotOf(path),
    update: async (data: Data) => {
      if (state.failUpdate) throw new Error('write refused')
      state.updates.push({ path, data })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { ...query({ path, clauses: [] }), doc: (id: string) => docRef(`${path}/${id}`) }
}

const fakeFirestore = {
  collection: (name: string) => collectionRef(name),
  getAll: async (...refs: Array<{ path: string }>) => {
    state.getAllCalls.push(refs.map((ref) => ref.path))
    return refs.map((ref) => snapshotOf(ref.path))
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldValue: { increment: (by: number) => ({ increment: by }) } },
  },
}))

jest.mock('./publisher-profile', () => ({
  PUBLISHER_PROFILES: 'publisherProfiles',
  canActAsPublisher: async (_firestore: unknown, uid: string, orgId: string) =>
    state.managers.has(`${uid}@${orgId}`),
}))

jest.mock('./sale-risk', () => ({
  isPublisherSecurityLocked: async (_firestore: unknown, orgId: string) => state.locked.has(orgId),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async (input: Record<string, any>) => {
    state.versionMoves.push({
      listing: input['listingRef'].path,
      artifactType: input['artifactType'],
      from: input['from'],
      to: input['to'],
    })
  },
}))

import { marketplaceSiteStarterSource as source } from './site-starter-source'

const PUBLISHER = 'pub-org'
const BUYER = { orgId: 'buyer-org', uid: 'buyer-1' }

const payload = (over: Partial<SiteStarterPayload> = {}): SiteStarterPayload => ({
  mode: 'base',
  facets: { kind: null, base: 'starter', fonts: null, pages: 1, mode: 'base' },
  theme: { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null },
  screens: [{ displayName: 'Home', slug: '/', nodes: {} }],
  layout: { displayName: 'Site header and footer', nodes: {} },
  ...over,
})

/** A starter listing as the publish door and the query-field refresh leave it. */
function listing(id: string, over: Data = {}) {
  const reviewStatus = over['reviewStatus'] ?? 'listed'
  const browsable = reviewStatus === 'listed' || reviewStatus === 'verified'
  const name = String(over['displayName'] ?? 'Corner bistro')
  const words = name.toLowerCase().split(' ')
  const audience = browsable ? '*' : String(over['profileId'] ?? PUBLISHER)
  state.docs.set(`marketplaceListings/${id}`, {
    artifactType: 'siteStarter',
    profileId: PUBLISHER,
    displayName: name,
    description: 'A starter',
    priceUsd: 0,
    latestVersion: 1,
    deletedAt: null,
    reviewStatus,
    starterKind: 'restaurant',
    starterBase: 'starter',
    starterFonts: null,
    starterPages: 1,
    starterMode: 'base',
    createdAt: 100,
    browseAudience: [audience],
    browseTokens: words.map((word) => `${audience}~${word}`),
    ...over,
  })
  state.docs.set(`marketplaceListings/${id}/versions/1`, { starter: payload() })
}

beforeEach(() => {
  state.docs.clear()
  state.queries = []
  state.getAllCalls = []
  state.updates = []
  state.failUpdate = false
  state.locked.clear()
  state.managers.clear()
  state.versionMoves = []
  state.docs.set(`publisherProfiles/${PUBLISHER}`, { handle: 'pub', displayName: 'Pub Studio' })
})

const search = (input: Partial<{ word: string; filter: Data; limit: number }> = {}) =>
  source.search({ word: '', filter: {}, limit: 10, ...input } as any, BUYER)

describe('search (AGL-4049)', () => {
  it('asks the public shelf for starters, newest first, twice the page', async () => {
    listing('a')
    await search({ limit: 6 })
    expect(state.queries).toEqual([
      {
        path: 'marketplaceListings',
        clauses: [
          { field: 'artifactType', op: '==', value: 'siteStarter' },
          { field: 'browseAudience', op: 'array-contains', value: '*' },
        ],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 12,
      },
    ])
  })

  it('folds a typed search into the audience, one public token per word', async () => {
    listing('a', { displayName: 'Corner bistro' })
    listing('b', { displayName: 'Plumbing pros' })
    const found = await search({ word: '  Bistro   CAFE ' })
    expect(state.queries[0].clauses).toEqual([
      { field: 'artifactType', op: '==', value: 'siteStarter' },
      { field: 'browseTokens', op: 'array-contains-any', value: ['*~bistro', '*~cafe'] },
    ])
    expect(found.map((row) => row.listingId)).toEqual(['a'])
  })

  it('asks the facets the query can hold, and matches the rest in memory', async () => {
    listing('a', { starterMode: 'ai', starterKind: 'restaurant', starterBase: 'bootstrap', starterFonts: 'oswald' })
    listing('b', { starterMode: 'ai', starterKind: 'restaurant', starterBase: 'bootstrap', starterFonts: null })
    const found = await search({
      filter: { mode: 'ai', kind: 'restaurant', base: 'bootstrap', fonts: 'oswald', pages: 1 },
    })
    expect(state.queries[0].clauses).toEqual([
      { field: 'artifactType', op: '==', value: 'siteStarter' },
      { field: 'starterMode', op: '==', value: 'ai' },
      { field: 'starterKind', op: '==', value: 'restaurant' },
      { field: 'starterBase', op: '==', value: 'bootstrap' },
      { field: 'browseAudience', op: 'array-contains', value: '*' },
    ])
    expect(found.map((row) => row.listingId)).toEqual(['a'])
  })

  it('lists the platform’s own starters first, then newest first', async () => {
    listing('old-publisher', { createdAt: 10 })
    listing('new-publisher', { createdAt: 30 })
    listing('official', { createdAt: 20, official: true })
    const found = await search()
    expect(found.map((row) => [row.listingId, row.official])).toEqual([
      ['official', true],
      ['new-publisher', false],
      ['old-publisher', false],
    ])
  })

  it('cuts to the limit after ordering, so an official starter is never cut for a newer one', async () => {
    listing('new', { createdAt: 30 })
    listing('official', { createdAt: 10, official: true })
    expect((await search({ limit: 1 })).map((row) => row.listingId)).toEqual(['official'])
  })

  it('drops what is not browsable even when its stored audience says otherwise', async () => {
    // Query fields a refresh has not caught up with: the in-memory pass is
    // the second line, not the first.
    listing('in-review', { reviewStatus: 'submitted', browseAudience: ['*'] })
    listing('taken-down', { hiddenAt: 5 })
    listing('deleted', { deletedAt: 5 })
    listing('locked', { workspaceLockedAt: 5 })
    listing('fine')
    expect((await search()).map((row) => row.listingId)).toEqual(['fine'])
  })

  it('answers each card in the seam’s shape, with the author read once per publisher', async () => {
    listing('a', {
      priceUsd: 29,
      previewImageUrl: 'https://cdn.example/a.png',
      category: ' Restaurant & café ',
    })
    listing('b', { createdAt: 50 })
    listing('c', { createdAt: 60, profileId: 'other-org', browseAudience: ['*'] })
    state.docs.set('publisherProfiles/other-org', { handle: 'other' })
    const found = await search()
    expect(found.find((row) => row.listingId === 'a')).toEqual({
      listingId: 'a',
      displayName: 'Corner bistro',
      description: 'A starter',
      authorName: 'Pub Studio',
      official: false,
      priceUsd: 29,
      previewImageUrl: 'https://cdn.example/a.png',
      facets: { kind: 'restaurant', base: 'starter', fonts: null, pages: 1, mode: 'base' },
      // The listing's "What kind of site is it?", trimmed; the card shows it.
      category: 'Restaurant & café',
    })
    // A listing that names no kind in words answers null, never ''.
    expect(found.find((row) => row.listingId === 'b')?.category).toBeNull()
    // A profile with no display name shows its handle.
    expect(found.find((row) => row.listingId === 'c')?.authorName).toBe('other')
    expect(found.find((row) => row.listingId === 'b')?.previewImageUrl).toBeNull()
    expect(state.getAllCalls).toEqual([['publisherProfiles/pub-org', 'publisherProfiles/other-org']])
  })

  it('answers nothing, and reads nothing, for no page at all; caps a large one', async () => {
    listing('a')
    expect(await search({ limit: 0 })).toEqual([])
    expect(state.queries).toEqual([])
    await search({ limit: 500 })
    expect(state.queries[0].limit).toBe(100)
  })
})

describe('resolve (AGL-4049)', () => {
  it('hands over a free listed starter’s latest version', async () => {
    listing('a')
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual(payload())
  })

  it.each([
    ['unknown', () => undefined],
    ['deleted', () => listing('a', { deletedAt: 5 })],
    ['taken down', () => listing('a', { hiddenAt: 5 })],
    ['from a publisher under a security lock', () => {
      listing('a')
      state.locked.add(PUBLISHER)
    }],
    ['not a starter', () => listing('a', { artifactType: 'template' })],
  ])('is gone when the listing is %s', async (_case, arrange) => {
    arrange()
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual({ error: 'Unknown starter', status: 404 })
  })

  it('is gone for a missing listing id, without a read', async () => {
    expect(await source.resolve({ listingId: '' }, BUYER)).toEqual({ error: 'Unknown starter', status: 404 })
  })

  it('keeps a starter in review to its own workspace', async () => {
    listing('a', { reviewStatus: 'submitted' })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toMatchObject({ status: 404 })
    state.managers.add(`owner-1@${PUBLISHER}`)
    expect(await source.resolve({ listingId: 'a' }, { orgId: PUBLISHER, uid: 'owner-1' })).toEqual(payload())
  })

  it('keeps a private starter to its own workspace', async () => {
    listing('a', { visibility: 'private' })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toMatchObject({ status: 404 })
    state.managers.add(`owner-1@${PUBLISHER}`)
    expect(await source.resolve({ listingId: 'a' }, { orgId: PUBLISHER, uid: 'owner-1' })).toEqual(payload())
  })

  it('asks for payment on an unpaid priced starter, with its price', async () => {
    listing('a', { priceUsd: 29 })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual({
      error: 'Purchase required',
      status: 402,
      priceUsd: 29,
    })
  })

  it('hands a priced starter over once the workspace holds a live licence for it', async () => {
    listing('a', { priceUsd: 29 })
    state.docs.set('marketplacePurchases/p1', { buyerOrgId: BUYER.orgId, buyerUid: 'someone', listingId: 'a' })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual(payload())
  })

  it('does not count a refunded licence', async () => {
    listing('a', { priceUsd: 29 })
    state.docs.set('marketplacePurchases/p1', {
      buyerOrgId: BUYER.orgId,
      listingId: 'a',
      refundedAt: 5,
    })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toMatchObject({ status: 402 })
  })

  it('waives the price for the publisher only on a site in the publisher’s own workspace', async () => {
    listing('a', { priceUsd: 29 })
    state.managers.add(`owner-1@${PUBLISHER}`)
    expect(await source.resolve({ listingId: 'a' }, { orgId: PUBLISHER, uid: 'owner-1' })).toEqual(payload())
    // The same person, creating a site in another workspace, is a buyer there (AGL-2484).
    expect(await source.resolve({ listingId: 'a' }, { orgId: 'elsewhere', uid: 'owner-1' })).toMatchObject({
      status: 402,
    })
  })

  it('resolves a pinned version, and is gone when that version is not stored', async () => {
    listing('a', { latestVersion: 2 })
    const older = payload({ screens: [{ displayName: 'Old home', slug: '/', nodes: {} }] })
    state.docs.set('marketplaceListings/a/versions/1', { starter: older })
    expect(await source.resolve({ listingId: 'a', version: '1' }, BUYER)).toEqual(older)
    // Latest is 2, which has nothing stored.
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toMatchObject({ status: 404 })
  })

  it('is gone, with the reason, when the stored starter cannot start a site', async () => {
    listing('a')
    state.docs.set('marketplaceListings/a/versions/1', { starter: payload({ layout: null }) })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual({
      error: 'A starter needs a shared layout',
      status: 404,
    })
    state.docs.set('marketplaceListings/a/versions/1', {
      starter: payload({ theme: { kind: 'builtin', base: 'no-such-base', brand: { light: {} }, fonts: null } }),
    })
    expect(await source.resolve({ listingId: 'a' }, BUYER)).toEqual({
      error: 'Unknown base theme "no-such-base"',
      status: 404,
    })
  })
})

describe('installed (AGL-4049)', () => {
  it('counts an install on the listing and on the version it landed on', async () => {
    listing('a', { latestVersion: 3 })
    await source.installed({ listingId: 'a' }, BUYER, { hostId: 'h1' })
    expect(state.versionMoves).toEqual([
      { listing: 'marketplaceListings/a', artifactType: 'siteStarter', from: null, to: 3 },
    ])
    expect(state.updates).toEqual([
      { path: 'marketplaceListings/a', data: { installCount: { increment: 1 } } },
    ])
  })

  it('counts a pinned version as the one it landed on', async () => {
    listing('a', { latestVersion: 3 })
    await source.installed({ listingId: 'a', version: '2' }, BUYER, { hostId: 'h1' })
    expect(state.versionMoves[0]).toMatchObject({ to: '2' })
  })

  it('never throws, whatever fails', async () => {
    listing('a')
    state.failUpdate = true
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(source.installed({ listingId: 'a' }, BUYER, { hostId: 'h1' })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      'site starter install count failed',
      expect.objectContaining({ listingId: 'a', hostId: 'h1' }),
    )
    error.mockRestore()
  })
})
