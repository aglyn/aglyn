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
 * A paged list cannot be filtered or searched in the browser (AGL-2501,
 * AGL-3321).
 *
 * The staff organization list filtered the rows it had already fetched — ten
 * of them by default — so it answered "no such organization" for every
 * organization past the first page. That is the one answer a search must
 * never give wrongly, and it gets quietly more wrong as the platform grows.
 *
 * So every clause of the Filters panel and the search word are planned onto
 * ONE Firestore query (`ORG_LIST_QUERY`, `utils/org-list-query.ts`) and the
 * route matches nothing afterwards. The search is an `array-contains` over
 * `nameTokens` — every prefix of every WORD — so it finds "Acme Coffee" by
 * "coffee". What it cannot do is match MID-word, and a multi-word query
 * narrows by its first word only: one array clause per query. What one query
 * cannot hold is refused by name and not applied.
 */

/** Everything the query builder was asked for, in order. */
let ordering: Array<[string, string]> = []
let wheres: Array<[string, string, unknown]> = []
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
    path: `orgs/${id}`,
    collection: () => ({ doc: () => ({ id, __billing: true }) }),
  },
})

let orgs: Array<{ id: string; data: Record<string, unknown> }> = []

/** The document id, however the SDK spelled it. */
const pathOf = (field: unknown) => (typeof field === 'string' ? field : '__name__')

function orgQuery(): any {
  return {
    orderBy: (field: unknown, direction = 'asc') => {
      ordering.push([pathOf(field), direction])
      return orgQuery()
    },
    where: (field: unknown, op: string, value: unknown) => {
      wheres.push([pathOf(field), op, value])
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
  }
}

const docAt = (path: string) => ({
  get: async () => {
    const id = path.split('/').pop() as string
    const found = path.startsWith('orgs/') ? orgs.find((o) => o.id === id) : undefined
    return found
      ? orgDoc(found.id, found.data)
      : { id, exists: false, data: () => ({}), get: () => undefined }
  },
})

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
        doc: (path: string) => (global as any).__docAt(path),
        // No billing subdocument for these fixtures; the route falls back to
        // the org's own inline `subscription`, which is the common case.
        getAll: async (...refs: unknown[]) =>
          refs.map(() => ({ exists: false, data: () => ({}) })),
      }),
    }),
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
;(global as any).__docAt = (path: string) => docAt(path)

import { GET } from '../app/api/admin/orgs/route'

const get = (params: Record<string, string> = {}) => {
  const url = new URL('https://console.test/api/admin/orgs')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return GET(
    new Request(url.toString(), { headers: { authorization: 'Bearer t' } }),
  )
}

const filtered = (...clauses: Array<[string, string, string?]>) =>
  get({
    filters: JSON.stringify(clauses.map(([field, op, value = '']) => ({ field, op, value }))),
  })

beforeEach(() => {
  ordering = []
  wheres = []
  startedAfter = null
  capped = null
  orgs = [
    {
      id: 'org-a',
      data: {
        name: 'Acme Coffee',
        nameLower: 'acme coffee',
        nameTokens: ['a', 'ac', 'acm', 'acme', 'c', 'co', 'cof', 'coff', 'coffe', 'coffee'],
      },
    },
  ]
})

describe('the staff organization list searches the COLLECTION', () => {
  it('orders by document id and filters on nothing when not searching', async () => {
    // The instrument: without a term the list is the plain paged walk it
    // always was, so the assertions below read as a difference.
    const response = await get()
    // Asserted FIRST, and in every case below that inspects the query: the
    // builder records what it was asked for before the handler can throw,
    // so a route 500ing on every request would leave these green.
    expect(response.status).toBe(200)
    expect(ordering).toEqual([['__name__', 'asc']])
    expect(wheres).toEqual([])
    const payload = await response.json()
    expect(payload.orgs.map((org: any) => org.$id)).toEqual(['org-a'])
    expect(payload.refused).toEqual([])
  })

  it('matches a word ANYWHERE in the name, not just the first', async () => {
    expect((await get({ search: 'coffee' })).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'coffee']])
    expect(ordering).toEqual([['__name__', 'asc']])
  })

  it('normalizes case and stray whitespace like the stored tokens', async () => {
    expect((await get({ search: '  COF ' })).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'cof']])
  })

  it('narrows a multi-word query by its FIRST word, and says so', async () => {
    const response = await get({ search: 'acme cof' })
    expect(response.status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'acme']])
    const payload = await response.json()
    expect(payload.notices.join(' ')).toMatch(/one word at a time/)
  })

  it('caps the query at the length the tokens were written to', async () => {
    // A longer query would look for a token that was never stored, so every
    // search past twelve characters would find nothing at all.
    expect((await get({ search: 'extraordinarilylongname' })).status).toBe(200)
    expect(wheres[0][2]).toBe('extraordinar')
  })

  it('a blank search is NOT a search', async () => {
    expect((await get({ search: '   ' })).status).toBe(200)
    expect(ordering).toEqual([['__name__', 'asc']])
    expect(wheres).toEqual([])
  })

  it('resumes from a SNAPSHOT, not a raw cursor value', async () => {
    /*
     * `startAfter(snapshot)` compares every ordering field including the
     * `__name__` Firestore appends, so it is exact in any order — a raw value
     * compared against a non-unique field would skip a namesake silently.
     */
    expect((await get({ search: 'acme', cursor: 'orgs/org-a' })).status).toBe(200)
    expect(startedAfter).toBe('org-a')
  })

  it('takes the staff pickers’ `after` as the same cursor', async () => {
    // `fetchAllPages` walks this route by `after`; it hands back whatever
    // `nextCursor` said, which is a document path.
    expect((await get({ after: 'orgs/org-a' })).status).toBe(200)
    expect(startedAfter).toBe('org-a')
  })

  it('a cursor that no longer resolves restarts at the top', async () => {
    const response = await get({ search: 'acme', cursor: 'orgs/deleted-org' })
    expect(response.status).toBe(200)
    expect(startedAfter).toBeNull()
  })

  it('asks for one row past the page, and reports the next cursor as a path', async () => {
    orgs = [
      { id: 'org-a', data: { name: 'A' } },
      { id: 'org-b', data: { name: 'B' } },
    ]
    const payload = await (await get({ pageSize: '1' })).json()
    expect(capped).toBe(2)
    expect(payload.hasMore).toBe(true)
    expect(payload.nextCursor).toBe('orgs/org-a')
    expect(payload.orgs).toHaveLength(1)
  })

  it('refuses unreadable filters rather than listing everything under them', async () => {
    expect((await get({ filters: '{not json' })).status).toBe(400)
  })
})

/**
 * The Filters panel, answered by the query — every clause at once.
 */
describe('every clause reaches the query', () => {
  it('name · contains → array-contains over the word tokens', async () => {
    expect((await filtered(['name', 'contains', 'Coffee'])).status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'coffee']])
  })

  it('name · equals → equality on the normalized key', async () => {
    expect((await filtered(['name', 'equals', '  Acme Coffee '])).status).toBe(200)
    expect(wheres).toEqual([['nameLower', '==', 'acme coffee']])
  })

  it('plan · isAnyOf → `in`', async () => {
    expect((await filtered(['plan', 'isAnyOf', 'free, business'])).status).toBe(200)
    expect(wheres).toEqual([['plan', 'in', ['free', 'business']]])
  })

  it('subscription · equals reaches the DENORMALIZED status', async () => {
    /*
     * `subscription` is not a field on the org document. It moved to
     * `orgs/{orgId}/billing/stripe` (AGL-1028) and the row merges it in after
     * the query has run. `billingStatus` is the mirror `writeOrgBilling`
     * keeps on the org document, and it is the only status a query can reach.
     */
    expect((await filtered(['subscription', 'equals', 'canceled'])).status).toBe(200)
    expect(wheres).toEqual([['billingStatus', '==', 'canceled']])
  })

  it('$id · isAnyOf → the document id', async () => {
    expect((await filtered(['$id', 'isAnyOf', 'org-a,org-b'])).status).toBe(200)
    expect(wheres).toEqual([['__name__', 'in', ['org-a', 'org-b']]])
  })

  it('several clauses and the search compose into ONE query', async () => {
    const response = await get({
      search: 'acme',
      filters: JSON.stringify([
        { field: 'plan', op: 'equals', value: 'pro' },
        { field: 'subscription', op: 'equals', value: 'active' },
        { field: 'ownerUid', op: 'equals', value: 'uid-1' },
        { field: 'slug', op: 'equals', value: 'Acme' },
      ]),
    })
    expect(response.status).toBe(200)
    expect(wheres).toEqual([
      ['nameTokens', 'array-contains', 'acme'],
      ['plan', '==', 'pro'],
      ['billingStatus', '==', 'active'],
      ['ownerUid', '==', 'uid-1'],
      ['slug', '==', 'acme'],
    ])
    expect(ordering).toEqual([['__name__', 'asc']])
    expect((await response.json()).refused).toEqual([])
  })

  it('createdAt · is covers the DAY, and Created leads the order', async () => {
    /*
     * A stored timestamp carries a time of day, so equality against midnight
     * matches nothing. It is a range across the day instead, and a range
     * orders the list by the field it ranges over.
     */
    expect(
      (await filtered(['createdAt', 'is', '2026-07-18'], ['plan', 'equals', 'pro'])).status,
    ).toBe(200)
    expect(ordering).toEqual([['createdAt', 'desc']])
    expect(wheres.map(([path, op]) => [path, op])).toEqual([
      ['createdAt', '>='],
      ['createdAt', '<'],
      ['plan', '=='],
    ])
    const start = (wheres[0][2] as any).toDate() as Date
    expect((wheres[1][2] as any).toDate().getTime()).toBeGreaterThan(start.getTime())
    expect([start.getFullYear(), start.getMonth() + 1, start.getDate()]).toEqual([2026, 7, 18])
  })

  it('refuses by name what one query cannot hold, and applies none of it', async () => {
    // The search took the one array clause; a second range is not offered;
    // an operator Firestore cannot answer is not either.
    const response = await get({
      search: 'acme',
      filters: JSON.stringify([
        { field: 'name', op: 'contains', value: 'coffee' },
        { field: 'name', op: 'doesNotContain', value: 'x' },
        { field: 'nonesuch', op: 'equals', value: 'x' },
        { field: 'plan', op: 'equals', value: '   ' },
      ]),
    })
    expect(response.status).toBe(200)
    expect(wheres).toEqual([['nameTokens', 'array-contains', 'acme']])
    const payload = await response.json()
    expect(payload.refused.map((entry: any) => entry.clause.field)).toEqual([
      'name',
      'name',
      'nonesuch',
      'plan',
    ])
    // Refused is NOT "no such organization": the rows still come back.
    expect(payload.orgs).toHaveLength(1)
  })
})
