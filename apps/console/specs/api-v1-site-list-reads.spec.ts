/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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
 * `GET /v1/sites` scaled Firestore round trips with the org's site count
 * (AGL-1302).
 *
 * The list read one whole host document per site inside a `Promise.all`.
 * `DocumentReference.get()` is `getAll([ref])` in the Admin SDK, so that was
 * one BatchGetDocuments per site — up to `MAX_PAGE_LIMIT` of them in a single
 * request — each returning the largest document in the product (theme,
 * routing map and all) so three fields could be read off it.
 *
 * **These assertions are a MEASUREMENT.** `mockBatches` counts the real
 * `getAll` calls the handler makes against a stand-in store, so the number
 * here is the number the production path spends: restore the per-site loop
 * and the first test reads `25` instead of `1`.
 *
 * The double MODELS the field mask rather than ignoring it — a store that
 * handed back whole documents would green-light a projection missing a field
 * the response is made of, and the symptom in production is a `null` name
 * rather than an error. It also RETURNS THE BATCH REVERSED, because the one
 * failure a batched read can introduce that the loop could not is handing a
 * site its neighbour's name.
 */

interface Batch {
  paths: string[]
  fieldMask: string[] | undefined
}

const mockDocs = new Map<string, Record<string, unknown>>()
/** Every `getAll` the code under test issued, most recent last. */
let mockBatches: Batch[] = []
/** Hand the snapshots back in reverse — order must not be load-bearing. */
let mockReverseBatchOrder = false

const mockScopes: string[] = ['sites:read']
/** Which sites the org owns; the handler pages over these ids, sorted. */
let mockOrgHosts: Record<string, boolean> = {}

const mockTick = () => Promise.resolve()

jest.mock('@aglyn/tenant-data-admin', () => {
  // Spread the REAL http helpers: `apiJson`, `ApiErrors`, `listResponse`,
  // `parseLimit`, `encodeCursor`/`decodeCursor`. A factory is a CLOSED
  // WORLD, and stubbing these would test a fake envelope rather than the
  // documented one — including the page limit this suite measures against.
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  const snapshotOf = (path: string, fieldMask: string[] | undefined) => {
    const stored = mockDocs.get(path)
    const projected =
      stored === undefined || !fieldMask
        ? stored
        : Object.fromEntries(
            fieldMask
              .filter((field) => field in stored)
              .map((field) => [field, stored[field]]),
          )
    return {
      id: path.slice(path.lastIndexOf('/') + 1),
      exists: stored !== undefined,
      data: () => projected,
      get: (field: string) => projected?.[field],
    }
  }
  const mockFirestore = {
    getAll: async (...args: unknown[]) => {
      await mockTick()
      const last = args[args.length - 1] as { fieldMask?: string[] } | undefined
      const options =
        last && typeof last === 'object' && 'fieldMask' in last
          ? last
          : undefined
      const refs = (options ? args.slice(0, -1) : args) as { path: string }[]
      mockBatches.push({
        paths: refs.map((ref) => ref.path),
        fieldMask: options?.fieldMask,
      })
      const snapshots = refs.map((ref) =>
        snapshotOf(ref.path, options?.fieldMask),
      )
      return mockReverseBatchOrder ? snapshots.reverse() : snapshots
    },
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        id,
        collection: (sub: string) => ({
          doc: (childId: string) => ({
            path: `${name}/${id}/${sub}/${childId}`,
            id: childId,
            get: async () => {
              await mockTick()
              return { exists: false, data: () => undefined }
            },
            set: async () => {
              await mockTick()
            },
          }),
        }),
        set: async () => {
          await mockTick()
        },
        get: async () => {
          await mockTick()
          if (name !== 'hosts') return { exists: false, data: () => undefined }
          // Deliberately unmodelled: this suite exists because the site read
          // is NOT one document at a time. A handler that fell back to it
          // fails loudly here rather than quietly costing a round trip.
          throw new Error(`per-document read of ${name}/${id}`)
        },
      }),
    }),
  }
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => ({ plan: 'business', hosts: mockOrgHosts }),
    lockdownRefusal: async () => null,
    consumeRateLimit: async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetMs: Date.now() + 60_000,
      degraded: false,
    }),
    firebaseAdmin: {
      app: () => ({ firestore: () => mockFirestore }),
      firestore: {
        FieldValue: {
          increment: (n: number) => n,
          serverTimestamp: () => 'NOW',
        },
      },
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => {
  const entitlements = jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  )
  return {
    __esModule: true,
    ...jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/api-idempotency',
    ),
    apiRequestEnforcementShape: entitlements.apiRequestEnforcementShape,
    checkApiRequestQuota: entitlements.checkApiRequestQuota,
    checkEntitlement: () => true,
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { now: () => ({ toDate: () => new Date(0) }) },
}))

import { MAX_PAGE_LIMIT } from '@aglyn/tenant-data-admin'
import { GET } from '../app/api/v1/[[...route]]/route'

const AUTH = {
  authorization: 'Bearer aglyn_sk_test',
  'content-type': 'application/json',
}

function get(path: string, route: string[]) {
  return GET(
    new Request(`https://app.aglyn.com/api/v1${path}`, { headers: AUTH }),
    { params: Promise.resolve({ route }) },
  )
}

const listSites = (query = '') => get(`/sites${query}`, ['sites'])

/** `site-00`…`site-{n-1}`, each a host document far larger than its view. */
function seedSites(n: number) {
  mockOrgHosts = {}
  for (let index = 0; index < n; index += 1) {
    const id = `site-${String(index).padStart(2, '0')}`
    mockOrgHosts[id] = true
    mockDocs.set(`hosts/${id}`, {
      displayName: `Site ${index}`,
      subdomain: `sub-${index}`,
      cname: index === 0 ? 'www.example.com' : null,
      // The bulk of a real host document, and none of it a site resource.
      theme: { palette: { primary: { main: '#0af' } } },
      screens: Object.fromEntries(
        Array.from({ length: 50 }, (_, s) => [`screen-${s}`, `/path-${s}`]),
      ),
      memberRoles: { 'uid-1': 'admin' },
    })
  }
}

beforeEach(() => {
  mockDocs.clear()
  mockBatches = []
  mockReverseBatchOrder = false
  seedSites(25)
})

describe('AGL-1302 · GET /v1/sites costs one read, not one per site', () => {
  it('a full default page of 25 sites is ONE batched read', async () => {
    const body = await (await listSites()).json()
    expect(body.data).toHaveLength(25)
    expect(mockBatches).toHaveLength(1)
    expect(mockBatches[0].paths).toHaveLength(25)
  })

  it('CONTROL: the counter is not stuck at one — an empty org reads nothing', async () => {
    // `getAll` rejects a call with no references, so the empty page has to
    // skip the read entirely. Without this the test above would also pass
    // against a handler that never read anything at all.
    mockOrgHosts = {}
    const body = await (await listSites()).json()
    expect(body.data).toEqual([])
    expect(mockBatches).toHaveLength(0)
  })

  it('the read is projected to the three fields a site resource is made of', async () => {
    await listSites()
    expect(mockBatches[0].fieldMask).toEqual(['displayName', 'subdomain', 'cname'])
  })

  it('every field of the response survives that projection', async () => {
    const body = await (await listSites()).json()
    expect(body.data[0]).toEqual({
      id: 'site-00',
      object: 'site',
      displayName: 'Site 0',
      subdomain: 'sub-0',
      domain: 'www.example.com',
    })
  })

  it('a batch returned out of order still pairs each site with its own name', async () => {
    mockReverseBatchOrder = true
    const body = await (await listSites()).json()
    expect(body.data.map((site: { id: string }) => site.id)).toEqual(
      Object.keys(mockOrgHosts).sort(),
    )
    expect(body.data[0].displayName).toBe('Site 0')
    expect(body.data[24].displayName).toBe('Site 24')
  })

  it('a site the org lists but no document exists for is still returned, nulled', async () => {
    mockDocs.delete('hosts/site-07')
    const body = await (await listSites()).json()
    const orphan = body.data.find((s: { id: string }) => s.id === 'site-07')
    expect(orphan).toEqual({
      id: 'site-07',
      object: 'site',
      displayName: null,
      subdomain: null,
      domain: null,
    })
  })

  it(`the largest page the API allows (${MAX_PAGE_LIMIT}) is still one read`, async () => {
    seedSites(MAX_PAGE_LIMIT)
    const body = await (await listSites(`?limit=${MAX_PAGE_LIMIT}`)).json()
    expect(body.data).toHaveLength(MAX_PAGE_LIMIT)
    expect(mockBatches).toHaveLength(1)
  })

  it('the single-site GET reads the same three fields', async () => {
    const body = await (await get('/sites/site-03', ['sites', 'site-03'])).json()
    expect(body).toEqual({
      id: 'site-03',
      object: 'site',
      displayName: 'Site 3',
      subdomain: 'sub-3',
      domain: null,
    })
    expect(mockBatches).toHaveLength(1)
    expect(mockBatches[0].fieldMask).toEqual(['displayName', 'subdomain', 'cname'])
  })
})
