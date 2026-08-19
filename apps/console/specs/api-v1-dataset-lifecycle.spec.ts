/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * The dataset LIFECYCLE over `/v1` (AGL-2126) — create, update, delete.
 *
 * Until this shipped, `/v1` could create and edit records but not the dataset
 * holding them, so the API could not bootstrap itself: an agency provisioning
 * a client workspace had to click a dataset into existence in the console
 * before its first API call could write anything.
 *
 * Three things here are not response-shaped and are asserted against the
 * store rather than the handler's answer, in the manner of
 * `api-v1-idempotency.spec.ts`:
 *
 *  - `visibleTo` is stamped. A dataset created without it matches no
 *    `array-contains-any` and renders on NO site (AGL-1044) — the API would
 *    create data that never appears anywhere and answer 201.
 *  - the quota is the REAL `checkDatasetQuota`, not a stub, so the refusal
 *    tracks the plan table rather than this file's idea of it.
 *  - a refused create does not consume its `Idempotency-Key`, because the
 *    refusal clears when somebody buys an add-on and the retry that should
 *    then succeed must not replay the refusal.
 */

/** Every document, by path. The thing the assertions read. */
const mockDocs = new Map<string, Record<string, unknown>>()

/** The org document `getOrgDoc` hands the pipeline. Drives plan + quota. */
let mockOrg: Record<string, unknown> = { plan: 'business' }
/** Scopes on the authenticated key. */
let mockScopes: string[] = ['datasets:read', 'datasets:write']
/** Deterministic dataset ids, so assertions can name them. */
let mockUidSeq = 0

/** Yield, so two in-flight requests actually interleave. */
const tick = () => Promise.resolve()

function mockDocRef(path: string) {
  const id = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    id,
    collection: (name: string) => mockCollectionRef(`${path}/${name}`),
    get: async () => {
      await tick()
      return {
        id,
        exists: mockDocs.has(path),
        data: () => mockDocs.get(path),
        get: (field: string) => mockDocs.get(path)?.[field],
      }
    },
    create: async (data: Record<string, unknown>) => {
      await tick()
      // The dedupe primitive: a create on an existing document is rejected.
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, { ...data })
    },
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      await tick()
      mockDocs.set(path, {
        ...(options?.merge ? (mockDocs.get(path) ?? {}) : {}),
        ...data,
      })
    },
    // Firestore's `update()` REJECTS a missing document and merges shallowly
    // over an existing one. Modelling it as `set(merge)` would fabricate a
    // green for a PATCH on a deleted dataset, which is the whole point of the
    // existence check the handler makes first.
    update: async (data: Record<string, unknown>) => {
      await tick()
      if (!mockDocs.has(path)) throw new Error('NOT_FOUND')
      mockDocs.set(path, { ...(mockDocs.get(path) ?? {}), ...data })
    },
    delete: async () => {
      await tick()
      mockDocs.delete(path)
    },
  }
}

function mockCollectionRef(path: string) {
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    count: () => ({
      get: async () => {
        await tick()
        return { data: () => ({ count: childPaths(path).length }) }
      },
    }),
  }
}

/** Immediate children of a collection path — not grandchildren. */
function childPaths(collectionPath: string): string[] {
  const prefix = `${collectionPath}/`
  return [...mockDocs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

const mockFirestore = { collection: (name: string) => mockCollectionRef(name) }

jest.mock('@aglyn/tenant-data-admin', () => {
  const apiHttp = jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/api-http',
  )
  return {
    __esModule: true,
    ...apiHttp,
    verifyApiKey: async () => ({
      orgId: 'org-1',
      keyId: 'key-1',
      scopes: mockScopes,
    }),
    getOrgDoc: async () => mockOrg,
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

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // REAL entitlements, REAL quota arithmetic and REAL scope-token stamping.
  // Stubbing any of the three would leave this spec asserting against its own
  // idea of the plan table, and the plan table is half the subject.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_model: unknown, values: Record<string, unknown>) =>
    values,
  validateDocument: () => ({}),
  createResourceUid: () => `ds_${++mockUidSeq}`,
}))

jest.mock('firebase-admin/firestore', () => {
  class MockTimestamp {
    ms: number
    constructor(ms: number) {
      this.ms = ms
    }
    static now() {
      return new MockTimestamp(1_760_000_000_000)
    }
    toDate() {
      return new Date(this.ms)
    }
  }
  return {
    __esModule: true,
    FieldPath: { documentId: () => '__name__' },
    Timestamp: MockTimestamp,
  }
})

import { DELETE, GET, PATCH, POST } from '../app/api/v1/[[...route]]/route'

const DATASETS = 'orgs/org-1/datasets'

function headers(key: string | null): Record<string, string> {
  const built: Record<string, string> = {
    authorization: 'Bearer aglyn_sk_test',
    'content-type': 'application/json',
  }
  if (key) built['Idempotency-Key'] = key
  return built
}

function createDataset(
  body: Record<string, unknown>,
  key: string | null = null,
) {
  const request = new Request('https://app.aglyn.com/api/v1/datasets', {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
  })
  return POST(request, { params: Promise.resolve({ route: ['datasets'] }) })
}

function patchDataset(id: string, body: Record<string, unknown>) {
  const request = new Request(`https://app.aglyn.com/api/v1/datasets/${id}`, {
    method: 'PATCH',
    headers: headers(null),
    body: JSON.stringify(body),
  })
  return PATCH(request, {
    params: Promise.resolve({ route: ['datasets', id] }),
  })
}

function deleteDataset(id: string, key: string | null = null) {
  const request = new Request(`https://app.aglyn.com/api/v1/datasets/${id}`, {
    method: 'DELETE',
    headers: headers(key),
  })
  return DELETE(request, {
    params: Promise.resolve({ route: ['datasets', id] }),
  })
}

function getDataset(id: string) {
  const request = new Request(`https://app.aglyn.com/api/v1/datasets/${id}`, {
    headers: headers(null),
  })
  return GET(request, { params: Promise.resolve({ route: ['datasets', id] }) })
}

/** Dataset documents actually in the store. */
const storedDatasets = () => childPaths(DATASETS)

const VALID = { name: 'Customers', fields: ['name', 'email'] }

beforeEach(() => {
  mockDocs.clear()
  mockOrg = { plan: 'business' }
  mockScopes = ['datasets:read', 'datasets:write']
  mockUidSeq = 0
})

describe('POST /v1/datasets (AGL-2126)', () => {
  it('creates a dataset and answers 201 with the created view', async () => {
    const response = await createDataset(VALID)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      id: 'ds_1',
      object: 'dataset',
      name: 'Customers',
      fields: ['name', 'email'],
    })
    expect(storedDatasets()).toEqual([`${DATASETS}/ds_1`])
  })

  it('stamps visibleTo, so the dataset is reachable from a site', async () => {
    // The invisible one. Without `visibleTo` the dataset matches no
    // `array-contains-any` and renders on no site at all (AGL-1044) — the API
    // would answer 201 for data nothing can ever read.
    await createDataset(VALID)
    expect(mockDocs.get(`${DATASETS}/ds_1`)?.visibleTo).toEqual(['org'])
  })

  it('follows the org default when it scopes new resources to a host', async () => {
    // No site is in context on an org-scoped API key, so a `host` default has
    // no host to name and must still land somewhere readable.
    mockOrg = { plan: 'business', defaultResourceScope: 'host' }
    await createDataset(VALID)
    expect(mockDocs.get(`${DATASETS}/ds_1`)?.visibleTo).toEqual(['org'])
  })

  it('names the offending field rather than a bare 400', async () => {
    const response = await createDataset({ fields: [] })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.fields).toEqual({
      name: 'Required',
      fields: 'At least one field is required',
    })
    expect(storedDatasets()).toEqual([])
  })

  it('refuses a model that would not fit the document', async () => {
    const response = await createDataset({
      ...VALID,
      model: { blob: 'x'.repeat(70 * 1024) },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields.model).toMatch(/65536 bytes/)
    expect(storedDatasets()).toEqual([])
  })

  it('answers plan_required with code data_store when the org lacks datasets', async () => {
    // A per-org override, not a lower plan: `apiAccess` starts at Business,
    // so every plan without `dataStore` is also a plan whose key never gets
    // past the authenticator. The only reachable shape is an org that may
    // call the API and may not have datasets.
    mockOrg = { plan: 'business', entitlements: { features: { dataStore: false } } }
    const response = await createDataset(VALID)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      type: 'plan_required',
      code: 'data_store',
    })
    expect(storedDatasets()).toEqual([])
  })

  it('answers plan_required with code dataset_quota at the limit, naming the add-on', async () => {
    // The REAL `checkDatasetQuota`, over a real override: included 2, ceiling
    // 10, so more datasets are BUYABLE and the refusal must say so rather
    // than sending the customer to an upgrade they do not need. Business's
    // own $1 add-on price comes from the plan table, so this fails if the
    // table moves.
    mockOrg = {
      plan: 'business',
      entitlements: { datasetsPerOrg: 2, maxDatasetsPerOrg: 10 },
    }
    for (let i = 0; i < 2; i++) await createDataset(VALID)
    expect(storedDatasets()).toHaveLength(2)

    const response = await createDataset(VALID)
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toMatchObject({
      type: 'plan_required',
      code: 'dataset_quota',
    })
    expect(body.error.message).toContain('(2)')
    expect(body.error.message).toContain('$1/mo')
    expect(storedDatasets()).toHaveLength(2)
  })

  it('does not consume the Idempotency-Key on a quota refusal', async () => {
    // The refusal clears when somebody buys an add-on. A burned key would mean
    // the retry that should finally succeed replays the refusal forever.
    mockOrg = {
      plan: 'business',
      entitlements: { datasetsPerOrg: 2, maxDatasetsPerOrg: 10 },
    }
    for (let i = 0; i < 2; i++) await createDataset(VALID)
    expect((await createDataset(VALID, 'key-a')).status).toBe(403)

    // The add-on lands: the same key must now create, not replay the refusal.
    mockOrg = { plan: 'business' }
    const retried = await createDataset(VALID, 'key-a')
    expect(retried.status).toBe(201)
    expect(storedDatasets()).toHaveLength(3)
  })

  it('replays a retried create instead of making a second dataset', async () => {
    const first = await createDataset(VALID, 'key-b')
    const replay = await createDataset(VALID, 'key-b')
    expect(first.status).toBe(201)
    // 200 vs 201 is how a client tells a replay from a fresh create — the rule
    // conventions.md publishes.
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ id: 'ds_1' })
    expect(storedDatasets()).toEqual([`${DATASETS}/ds_1`])
  })

  it('refuses a concurrent duplicate rather than serving it', async () => {
    const [first, second] = await Promise.all([
      createDataset(VALID, 'key-c'),
      createDataset(VALID, 'key-c'),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([201, 409])
    expect(storedDatasets()).toHaveLength(1)
  })

  it('requires datasets:write, not datasets:read', async () => {
    mockScopes = ['datasets:read']
    const response = await createDataset(VALID)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatchObject({
      type: 'insufficient_scope',
      code: 'datasets:write',
    })
    expect(storedDatasets()).toEqual([])
  })
})

describe('PATCH /v1/datasets/{id} (AGL-2126)', () => {
  it('renames without touching the fields it was not sent', async () => {
    await createDataset(VALID)
    const response = await patchDataset('ds_1', { name: 'Leads' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      name: 'Leads',
      fields: ['name', 'email'],
    })
  })

  it('replaces fields when they are sent', async () => {
    await createDataset(VALID)
    const response = await patchDataset('ds_1', { fields: ['company'] })
    expect((await response.json()).fields).toEqual(['company'])
  })

  it('never clears a schema on an empty body', async () => {
    // A PATCH that treated "absent" as "empty" would take a dataset's schema
    // away on a typo'd request body, with a 200 to say it worked.
    await createDataset(VALID)
    const response = await patchDataset('ds_1', {})
    expect(response.status).toBe(200)
    expect(mockDocs.get(`${DATASETS}/ds_1`)?.fields).toEqual(['name', 'email'])
  })

  it('rejects an explicit empty fields array', async () => {
    await createDataset(VALID)
    const response = await patchDataset('ds_1', { fields: [] })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields.fields).toBe(
      'At least one field is required',
    )
    expect(mockDocs.get(`${DATASETS}/ds_1`)?.fields).toEqual(['name', 'email'])
  })

  it('is idempotent in state AND response, which is why it takes no key', async () => {
    await createDataset(VALID)
    const first = await patchDataset('ds_1', { name: 'Leads' })
    const second = await patchDataset('ds_1', { name: 'Leads' })
    expect(first.status).toBe(second.status)
    expect(await first.json()).toEqual(await second.json())
  })

  it('404s a dataset that is not there', async () => {
    const response = await patchDataset('ds_missing', { name: 'Leads' })
    expect(response.status).toBe(404)
  })
})

describe('DELETE /v1/datasets/{id} (AGL-2126)', () => {
  it('deletes an empty dataset and returns a receipt', async () => {
    await createDataset(VALID)
    const response = await deleteDataset('ds_1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'ds_1',
      object: 'dataset',
      deleted: true,
    })
    expect(storedDatasets()).toEqual([])
  })

  it('refuses while records remain, and says how many', async () => {
    // A recursive delete behind one REST call would take the customer's
    // content with no receipt naming what went.
    await createDataset(VALID)
    mockDocs.set(`${DATASETS}/ds_1/records/rec_1`, { values: {} })
    const response = await deleteDataset('ds_1')
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatchObject({
      type: 'conflict',
      code: 'dataset_not_empty',
    })
    expect(storedDatasets()).toEqual([`${DATASETS}/ds_1`])
  })

  it('does not consume the key on a not-empty refusal', async () => {
    await createDataset(VALID)
    mockDocs.set(`${DATASETS}/ds_1/records/rec_1`, { values: {} })
    expect((await deleteDataset('ds_1', 'key-d')).status).toBe(409)

    mockDocs.delete(`${DATASETS}/ds_1/records/rec_1`)
    expect((await deleteDataset('ds_1', 'key-d')).status).toBe(200)
    expect(storedDatasets()).toEqual([])
  })

  it('replays the receipt on a retry, rather than 404-ing', async () => {
    await createDataset(VALID)
    const first = await deleteDataset('ds_1', 'key-e')
    const replay = await deleteDataset('ds_1', 'key-e')
    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(await first.json())
  })

  it('still 404s a dataset that was never there, key or no key', async () => {
    const response = await deleteDataset('ds_missing', 'key-f')
    expect(response.status).toBe(404)
  })

  it('a create key and a delete key do not share a namespace', async () => {
    // Reusing one key across both operations must not replay the create's
    // dataset to a delete — a client would parse that as a successful delete.
    const created = await createDataset(VALID, 'key-g')
    expect(created.status).toBe(201)
    const deleted = await deleteDataset('ds_1', 'key-g')
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({
      id: 'ds_1',
      object: 'dataset',
      deleted: true,
    })
    expect(storedDatasets()).toEqual([])
  })
})

describe('method handling on the dataset paths', () => {
  it('answers 405 with an Allow header on the collection', async () => {
    const request = new Request('https://app.aglyn.com/api/v1/datasets', {
      method: 'PATCH',
      headers: headers(null),
      body: '{}',
    })
    const response = await PATCH(request, {
      params: Promise.resolve({ route: ['datasets'] }),
    })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, POST')
  })

  it('answers 405 with an Allow header on one dataset', async () => {
    await createDataset(VALID)
    const request = new Request('https://app.aglyn.com/api/v1/datasets/ds_1', {
      method: 'POST',
      headers: headers(null),
      body: '{}',
    })
    const response = await POST(request, {
      params: Promise.resolve({ route: ['datasets', 'ds_1'] }),
    })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, PATCH, DELETE')
  })

  it('keeps the read path working', async () => {
    await createDataset(VALID)
    const response = await getDataset('ds_1')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ name: 'Customers' })
  })
})
