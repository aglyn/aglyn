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
 * Form submissions become actionable over `/v1` (AGL-2127).
 *
 * The list was the whole surface, which shaped every integration written
 * against it badly: a lead sync could read a submission and had nowhere to
 * record that it had, so it re-pushed the same lead on every poll or kept its
 * own high-water mark against a list ordered by document id rather than time.
 *
 * The assertion that matters most is the negative one: `read` is the ONLY
 * writable field. A submission is what a visitor typed, and an API that let an
 * integration quietly rewrite it would make the inbox unattributable — so the
 * spec checks the stored `fields` are untouched, not merely that the handler
 * answered 400.
 */

const mockDocs = new Map<string, Record<string, unknown>>()

let mockScopes: string[] = ['forms:read', 'forms:write']

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
    // Real `update()` semantics: rejects a missing document, merges shallowly
    // over an existing one. `set(merge)` here would fabricate a green for a
    // PATCH on a submission somebody already deleted.
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
  const query = (filters: Array<[string, unknown]>) => ({
    where: (field: string, _op: string, value: unknown) =>
      query([...filters, [field, value]]),
    orderBy: () => query(filters),
    limit: (n: number) => ({
      startAfter: () => ({ get: async () => run(filters, n) }),
      get: async () => run(filters, n),
    }),
  })
  const run = async (filters: Array<[string, unknown]>, n: number) => {
    await tick()
    const docs = childPaths(path)
      .sort()
      .filter((docPath) =>
        filters.every(([field, value]) => mockDocs.get(docPath)?.[field] === value),
      )
      .slice(0, n)
      .map((docPath) => ({
        id: docPath.slice(docPath.lastIndexOf('/') + 1),
        exists: true,
        data: () => mockDocs.get(docPath),
        get: (field: string) => mockDocs.get(docPath)?.[field],
      }))
    return { docs }
  }
  return {
    path,
    doc: (id: string) => mockDocRef(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) =>
      query([[field, value]]),
    orderBy: () => query([]),
    limit: (n: number) => ({
      startAfter: () => ({ get: async () => run([], n) }),
      get: async () => run([], n),
    }),
    count: () => ({
      get: async () => {
        await tick()
        return { data: () => ({ count: childPaths(path).length }) }
      },
    }),
  }
}

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
    // The site must be one the org owns, or `handleSites` 404s before the
    // sub-resource is reached at all.
    getOrgDoc: async () => ({ plan: 'business', hosts: { 'host-1': true } }),
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
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/api-idempotency'),
  checkEntitlement: () => true,
  effectiveDatasetModel: () => ({ fields: [] }),
  coerceDocumentValues: (_m: unknown, v: Record<string, unknown>) => v,
  validateDocument: () => ({}),
  createResourceUid: () => 'unused',
  checkDatasetQuota: () => ({ allowed: true, limit: 100 }),
  defaultScopeForNewResource: () => ['org'],
  newResourceScopeFields: (tokens: string[]) => ({ visibleTo: tokens }),
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

const SUBMISSIONS = 'hosts/host-1/formSubmissions'
const BASE = 'https://app.aglyn.com/api/v1/sites/host-1/form-submissions'

function headers(key: string | null): Record<string, string> {
  const built: Record<string, string> = {
    authorization: 'Bearer aglyn_sk_test',
    'content-type': 'application/json',
  }
  if (key) built['Idempotency-Key'] = key
  return built
}

const route = (id?: string) =>
  id
    ? ['sites', 'host-1', 'form-submissions', id]
    : ['sites', 'host-1', 'form-submissions']

function list(query = '') {
  const request = new Request(`${BASE}${query}`, { headers: headers(null) })
  return GET(request, { params: Promise.resolve({ route: route() }) })
}

function retrieve(id: string) {
  const request = new Request(`${BASE}/${id}`, { headers: headers(null) })
  return GET(request, { params: Promise.resolve({ route: route(id) }) })
}

function patch(id: string, body: Record<string, unknown>) {
  const request = new Request(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: headers(null),
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ route: route(id) }) })
}

function remove(id: string, key: string | null = null) {
  const request = new Request(`${BASE}/${id}`, {
    method: 'DELETE',
    headers: headers(key),
  })
  return DELETE(request, { params: Promise.resolve({ route: route(id) }) })
}

function seed(id: string, extra: Record<string, unknown> = {}) {
  mockDocs.set(`${SUBMISSIONS}/${id}`, {
    formName: 'contact',
    path: '/contact',
    fields: { email: 'avery@example.com', message: 'Hello' },
    read: false,
    ...extra,
  })
}

beforeEach(() => {
  mockDocs.clear()
  mockScopes = ['forms:read', 'forms:write']
})

describe('GET /v1/sites/{id}/form-submissions/{submissionId} (AGL-2127)', () => {
  it('retrieves one submission', async () => {
    seed('sub_1')
    const response = await retrieve('sub_1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'sub_1',
      object: 'form_submission',
      form: 'contact',
      path: '/contact',
      fields: { email: 'avery@example.com', message: 'Hello' },
      read: false,
      created: null,
    })
  })

  it('404s an unknown submission with its own message', async () => {
    const response = await retrieve('sub_missing')
    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('No such form submission')
  })

  it('needs forms:read, not sites:read', async () => {
    seed('sub_1')
    mockScopes = ['sites:read']
    const response = await retrieve('sub_1')
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('forms:read')
  })

  it('leaves the list working, filter included', async () => {
    seed('sub_1')
    seed('sub_2', { formName: 'newsletter' })
    const all = await list()
    expect((await all.json()).data).toHaveLength(2)
    const filtered = await list('?form=newsletter')
    const body = await filtered.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe('sub_2')
  })
})

describe('PATCH /v1/sites/{id}/form-submissions/{submissionId} (AGL-2127)', () => {
  it('marks a submission read', async () => {
    seed('sub_1')
    const response = await patch('sub_1', { read: true })
    expect(response.status).toBe(200)
    expect((await response.json()).read).toBe(true)
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.read).toBe(true)
  })

  it('marks it unread again', async () => {
    seed('sub_1', { read: true })
    await patch('sub_1', { read: false })
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.read).toBe(false)
  })

  it('refuses to rewrite what the visitor typed, and says which key', async () => {
    // The one that matters. A silent drop would read as "we stored your
    // correction" while the inbox kept the original.
    seed('sub_1')
    const response = await patch('sub_1', {
      read: true,
      fields: { email: 'attacker@example.com' },
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.fields).toEqual({
      fields: 'Not writable on a form submission',
    })
    // Asserted against the STORE, not the response: a handler that answered
    // 400 after writing would pass a response-shaped test.
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.fields).toEqual({
      email: 'avery@example.com',
      message: 'Hello',
    })
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.read).toBe(false)
  })

  it('requires read to be a boolean, not a truthy string', async () => {
    seed('sub_1')
    const response = await patch('sub_1', { read: 'yes' })
    expect(response.status).toBe(400)
    expect((await response.json()).error.fields).toEqual({
      read: 'Must be true or false',
    })
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.read).toBe(false)
  })

  it('404s a submission that is not there, rather than creating one', async () => {
    const response = await patch('sub_missing', { read: true })
    expect(response.status).toBe(404)
    expect(mockDocs.has(`${SUBMISSIONS}/sub_missing`)).toBe(false)
  })

  it('is idempotent in state AND response, which is why it takes no key', async () => {
    seed('sub_1')
    const first = await patch('sub_1', { read: true })
    const second = await patch('sub_1', { read: true })
    expect(first.status).toBe(second.status)
    expect(await first.json()).toEqual(await second.json())
  })

  it('needs forms:write — forms:read is not enough', async () => {
    seed('sub_1')
    mockScopes = ['forms:read']
    const response = await patch('sub_1', { read: true })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('forms:write')
    expect(mockDocs.get(`${SUBMISSIONS}/sub_1`)?.read).toBe(false)
  })
})

describe('DELETE /v1/sites/{id}/form-submissions/{submissionId} (AGL-2127)', () => {
  it('deletes and returns a receipt', async () => {
    seed('sub_1')
    const response = await remove('sub_1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'sub_1',
      object: 'form_submission',
      deleted: true,
    })
    expect(mockDocs.has(`${SUBMISSIONS}/sub_1`)).toBe(false)
  })

  it('replays the receipt on a retry instead of 404-ing', async () => {
    // The purge-after-export case: a response lost to a timeout must be safe
    // to re-send, and without a key the retry cannot tell "already gone" from
    // "wrong id".
    seed('sub_1')
    const first = await remove('sub_1', 'key-a')
    const replay = await remove('sub_1', 'key-a')
    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(await first.json())
  })

  it('still 404s an id that was never there, key or no key', async () => {
    const response = await remove('sub_missing', 'key-b')
    expect(response.status).toBe(404)
  })

  it('releases the key on that 404, so a corrected id can reuse it', async () => {
    expect((await remove('sub_missing', 'key-c')).status).toBe(404)
    seed('sub_1')
    expect((await remove('sub_1', 'key-c')).status).toBe(200)
    expect(mockDocs.has(`${SUBMISSIONS}/sub_1`)).toBe(false)
  })

  it('scopes the key to the SITE, so one key purges on two sites', async () => {
    // `hosts/{hostId}/formSubmissions` ids are only unique within a host, so
    // an org-wide digest would let a purge on site A replay onto site B and
    // report a delete that never happened.
    seed('sub_1')
    await remove('sub_1', 'key-d')
    mockDocs.set('hosts/host-2/formSubmissions/sub_1', { fields: {} })
    const other = new Request(
      'https://app.aglyn.com/api/v1/sites/host-2/form-submissions/sub_1',
      { method: 'DELETE', headers: headers('key-d') },
    )
    const response = await DELETE(other, {
      params: Promise.resolve({
        route: ['sites', 'host-2', 'form-submissions', 'sub_1'],
      }),
    })
    // host-2 is not in the org's `hosts` map, so it 404s as a foreign site —
    // which is the point: the key did not carry a success across.
    expect(response.status).toBe(404)
    expect(mockDocs.has('hosts/host-2/formSubmissions/sub_1')).toBe(true)
  })

  it('needs forms:write', async () => {
    seed('sub_1')
    mockScopes = ['forms:read']
    const response = await remove('sub_1')
    expect(response.status).toBe(403)
    expect(mockDocs.has(`${SUBMISSIONS}/sub_1`)).toBe(true)
  })
})

describe('method handling', () => {
  it('405s a POST to the collection with an Allow header', async () => {
    const request = new Request(BASE, {
      method: 'POST',
      headers: headers(null),
      body: '{}',
    })
    const response = await POST(request, {
      params: Promise.resolve({ route: route() }),
    })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })

  it('405s a POST to one submission with an Allow header', async () => {
    seed('sub_1')
    const request = new Request(`${BASE}/sub_1`, {
      method: 'POST',
      headers: headers(null),
      body: '{}',
    })
    const response = await POST(request, {
      params: Promise.resolve({ route: route('sub_1') }),
    })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, PATCH, DELETE')
  })
})
