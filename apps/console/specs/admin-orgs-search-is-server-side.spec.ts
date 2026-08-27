/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * A paged list cannot be searched in the browser.
 *
 * The staff organization list filtered the rows it had already fetched — ten
 * of them by default — so it answered "no such organization" for every
 * organization past the first page. That is the one answer a search must
 * never give wrongly, and it gets quietly more wrong as the platform grows.
 *
 * The search is a Firestore PREFIX RANGE over the normalized `nameLower`,
 * which reaches the whole collection. Prefix, not contains: Firestore cannot
 * answer contains without a search service, and this is the honest trade.
 */

/** Everything the query builder was asked for, in order. */
let ordering: string[] = []
let startAt: string | null = null
let endAt: string | null = null
let startedAfter: string | null = null
let capped: number | null = null

/*
 * `ref.collection(...)` is modelled because the route reaches through it for
 * each org's billing document. A `ref` without it made every request throw
 * into the 500 handler — and the ordering assertions still passed, because
 * they are recorded before the throw. A double that lets the assertions pass
 * on a response nobody received is worse than no double at all.
 */
const orgDoc = (id: string, data: Record<string, unknown>) => ({
  id,
  exists: true,
  data: () => data,
  get: (key: string) => data[key],
  ref: {
    id,
    collection: () => ({ doc: () => ({ id, __billing: true }) }),
  },
})

let orgs: Array<{ id: string; data: Record<string, unknown> }> = []

function orgQuery(): any {
  return {
    orderBy: (field: unknown) => {
      ordering.push(typeof field === 'string' ? field : '__name__')
      return orgQuery()
    },
    startAt: (value: string) => {
      startAt = value
      return orgQuery()
    },
    endAt: (value: string) => {
      endAt = value
      return orgQuery()
    },
    startAfter: (cursor: { id?: string }) => {
      startedAfter = cursor?.id ?? null
      return orgQuery()
    },
    limit: (value: number) => {
      capped = value
      return orgQuery()
    },
    get: async () => ({ docs: orgs.map((o) => orgDoc(o.id, o.data)) }),
    doc: (id: string) => ({
      get: async () => {
        const found = orgs.find((o) => o.id === id)
        return found
          ? orgDoc(found.id, found.data)
          : { id, exists: false, data: () => ({}), get: () => undefined }
      },
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'staff-1',
          email_verified: true,
          staff: true,
        }),
      }),
      firestore: () => ({
        collection: () => (global as any).__orgQuery(),
        // No billing subdocument for these fixtures; the route falls back to
        // the org's own inline `subscription`, which is the common case.
        getAll: async (...refs: unknown[]) =>
          refs.map(() => ({ exists: false, data: () => ({}) })),
      }),
    }),
    firestore: {
      FieldPath: { documentId: () => '__name__' },
      Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
    },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/server') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))
;(global as any).__orgQuery = () => orgQuery()

import { GET } from '../app/api/admin/orgs/route'

const get = (params: Record<string, string> = {}) => {
  const url = new URL('https://console.test/api/admin/orgs')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(
    new Request(url.toString(), { headers: { authorization: 'Bearer t' } }),
  )
}

beforeEach(() => {
  ordering = []
  startAt = null
  endAt = null
  startedAfter = null
  capped = null
  orgs = [{ id: 'org-a', data: { name: 'Acme', nameLower: 'acme' } }]
})

describe('the staff organization list searches the COLLECTION', () => {
  it('orders by document id and ranges over nothing when not searching', () => {
    // The instrument: without a term the list is the plain paged walk it
    // always was, so the assertions below read as a difference.
    return get().then(async (response) => {
      // Asserted FIRST, and in every case below that inspects the query: the
      // builder records what it was asked for before the handler can throw,
      // so a route 500ing on every request would leave these green.
      expect(response.status).toBe(200)
      expect(ordering).toEqual(['__name__'])
      expect(startAt).toBeNull()
      expect(endAt).toBeNull()
    })
  })

  it('runs a PREFIX RANGE over nameLower when searching', async () => {
    expect((await get({ search: 'Acme' })).status).toBe(200)
    expect(ordering).toEqual(['nameLower'])
    // Normalized on the way in — the stored key is lowercased and
    // whitespace-collapsed, so the range has to be too or it matches nothing.
    expect(startAt).toBe('acme')
    expect(endAt).toBe('acme')
  })

  it('normalizes case and stray whitespace like the stored key', async () => {
    expect((await get({ search: '  ACME   Coffee ' })).status).toBe(200)
    expect(startAt).toBe('acme coffee')
  })

  it('a blank search is NOT a search', async () => {
    // Otherwise an empty box would range from '' to '' — every
    // organization, ordered by a field some may not carry.
    expect((await get({ search: '   ' })).status).toBe(200)
    expect(ordering).toEqual(['__name__'])
    expect(startAt).toBeNull()
  })

  it('resumes from a SNAPSHOT, not a raw cursor value', async () => {
    /*
     * A search page is ordered by `nameLower`, which is not unique. A raw
     * string cursor would be compared against that field, so two
     * organizations sharing a name would make the second one vanish —
     * silently, from the list whose whole job is that nobody is missing.
     * `startAfter(snapshot)` compares every ordering field including the
     * `__name__` Firestore appends.
     */
    expect((await get({ search: 'acme', after: 'org-a' })).status).toBe(200)
    expect(startedAfter).toBe('org-a')
  })

  it('a cursor that no longer resolves restarts at the top', async () => {
    const response = await get({ search: 'acme', after: 'deleted-org' })
    expect(response.status).toBe(200)
    expect(startedAfter).toBeNull()
  })

  it('asks for one row past the page, in both modes', async () => {
    await get({ pageSize: '10' })
    expect(capped).toBe(11)
    await get({ pageSize: '10', search: 'acme' })
    expect(capped).toBe(11)
  })
})
