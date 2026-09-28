/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * Staff read-back for the durable CSP counters (AGL-1799).
 *
 * The route is the reader that makes AGL-1702/AGL-1726's gating conditions
 * checkable, and it is NOT public: rows carry customer site hostnames and
 * page paths, so the properties pinned here are the gate (staff claim, not
 * merely a valid token) and the window arithmetic the reader depends on —
 * `days` clamped to the retention, the cutoff counted so `days=1` means
 * today — and, for the table (`view=rows`, AGL-3321), that every clause and
 * the search reach the Firestore query beneath the window and nothing is
 * matched after it. The plan's shapes and their composites are pinned by
 * `csp-report-list-query.spec.ts`.
 */

// A module, not a script: without this, tsc puts the file in the global
// scope and its `mock*` names collide with `admin-user-detail-phone.spec.ts`.
export {}

let mockDecodedToken: Record<string, unknown>
let mockRows: Array<Record<string, unknown>>
/** Every query the route ran: its predicates, its order and its limit. */
let mockQueries: Array<{
  where: Array<{ field: string; op: string; value: unknown }>
  orderBy: Array<{ field: string; direction: string }>
  limit: number
}>

/**
 * A query that records what it was built from and answers with `mockRows` as
 * given — it filters nothing, so a row it returns that a clause excludes
 * would show the route matching after the read.
 */
const mockQuery = (
  where: Array<{ field: string; op: string; value: unknown }> = [],
  orderBy: Array<{ field: string; direction: string }> = [],
): any => ({
  where: (field: unknown, op: string, value: unknown) =>
    mockQuery([...where, { field: String(field), op, value }], orderBy),
  orderBy: (field: unknown, direction = 'asc') =>
    mockQuery(where, [...orderBy, { field: String(field), direction }]),
  startAfter: () => mockQuery(where, orderBy),
  limit: (limit: number) => ({
    get: async () => {
      mockQueries.push({ where, orderBy, limit })
      return {
        docs: mockRows.map((row, index) => ({
          id: `c${index}`,
          ref: { path: `cspViolationDaily/c${index}` },
          data: () => row,
        })),
      }
    },
  }),
})

const mockFirestore = {
  collection: () => mockQuery(),
  doc: () => ({ get: async () => ({ exists: false }) }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  CSP_AGGREGATE_COLLECTION: 'cspViolationDaily',
  CSP_AGGREGATE_RETENTION_DAYS: 60,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('../app/api/admin/csp-reports/route') as {
  GET: (request: Request) => Promise<Response>
}

const get = (query = '', headers: Record<string, string> = { authorization: 'Bearer staff-token' }) =>
  route.GET(
    new Request(`https://app.aglyn.com/api/admin/csp-reports${query}`, {
      headers,
    }),
  )

beforeEach(() => {
  mockDecodedToken = { email_verified: true, staff: true }
  mockQueries = []
  mockRows = [
    { day: '2026-08-16', app: 'console', directive: 'img-src', origin: 'a.example', count: 4 },
    { day: '2026-08-16', app: 'tenant', directive: 'img-src', origin: 'b.example', count: 9 },
    { day: '2026-08-15', app: 'console', directive: 'script-src-elem', origin: 'c.example', count: 1 },
  ]
})

describe('GET /api/admin/csp-reports (AGL-1799)', () => {
  it('refuses without a token, and refuses a non-staff token', async () => {
    expect((await get('', {})).status).toBe(401)
    mockDecodedToken = { email_verified: true, staff: false }
    expect((await get()).status).toBe(403)
    // Neither refusal touched Firestore — the gate is ahead of the read.
    expect(mockQueries).toEqual([])
  })

  it('returns every row in the window for staff, largest counts first', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.rowCount).toBe(3)
    expect(body.rows.map((row: any) => row.count)).toEqual([9, 4, 1])
    expect(body.windowDays).toBe(7)
    expect(body.truncated).toBe(false)
  })

  it('reads the window with a single field range so no composite index is needed', async () => {
    // The `/api/health/rate-limits` lesson: a range + orderBy on ONE field
    // rides the automatic index. If this asserts a different field pair, the
    // rollup now needs `firebase-firestore.indexes.json` and a deploy.
    await get('?days=3')
    expect(mockQueries).toHaveLength(1)
    expect(mockQueries[0].where).toHaveLength(1)
    expect(mockQueries[0].where[0].field).toBe('day')
    expect(mockQueries[0].where[0].op).toBe('>=')
    // days=3 counts TODAY as day one: cutoff is two days back, not three.
    const expected = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    expect(mockQueries[0].where[0].value).toBe(expected)
  })

  it('clamps `days` to the retention window instead of trusting the query string', async () => {
    await get('?days=5000')
    const floor = new Date(Date.now() - 59 * 86_400_000).toISOString().slice(0, 10)
    expect(mockQueries[0].where[0].value).toBe(floor)
    mockQueries = []
    await get('?days=-2')
    const today = new Date().toISOString().slice(0, 10)
    expect(mockQueries[0].where[0].value).toBe(today)
  })

  it('answers the rollup whole: no filter narrows the window read', async () => {
    const body = await (await get('?app=console&directive=img-src')).json()
    expect(body.rowCount).toBe(3)
    expect(mockQueries[0].where).toHaveLength(1)
  })

  it('hands back the counter, not its search tokens or its TTL stamp', async () => {
    mockRows = [
      { ...mockRows[0], searchTokens: ['a'], expiresAt: new Date() },
    ]
    const body = await (await get()).json()
    expect(Object.keys(body.rows[0])).not.toContain('searchTokens')
    expect(Object.keys(body.rows[0])).not.toContain('expiresAt')
    expect(body.rows[0].origin).toBe('a.example')
  })
})

describe('GET /api/admin/csp-reports?view=rows — the table (AGL-3321)', () => {
  const rows = (params: Record<string, string>) =>
    get(`?${new URLSearchParams({ view: 'rows', ...params }).toString()}`)

  it('puts every clause and the search on the query, beneath the window', async () => {
    const response = await rows({
      days: '14',
      pageSize: '2',
      search: 'googletag',
      filters: JSON.stringify([
        { field: 'app', op: 'equals', value: 'tenant' },
        { field: 'directive', op: 'isAnyOf', value: 'img-src,script-src-elem' },
      ]),
    })
    expect(response.status).toBe(200)
    expect(mockQueries).toHaveLength(1)
    const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10)
    expect(mockQueries[0].where).toEqual([
      { field: 'day', op: '>=', value: since },
      { field: 'searchTokens', op: 'array-contains', value: 'googletag' },
      { field: 'app', op: '==', value: 'tenant' },
      { field: 'directive', op: 'in', value: ['img-src', 'script-src-elem'] },
    ])
    expect(mockQueries[0].orderBy).toEqual([{ field: 'day', direction: 'desc' }])
    // One past the page, so "is there more" is observed.
    expect(mockQueries[0].limit).toBe(3)
  })

  it('pages what the query returned and matches nothing after it', async () => {
    const body = await (
      await rows({ pageSize: '2', filters: JSON.stringify([{ field: 'app', op: 'equals', value: 'tenant' }]) })
    ).json()
    // The double returns console rows too; the route hands them on as read.
    expect(body.rows.map((row: any) => row.origin)).toEqual(['a.example', 'b.example'])
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toBe('cspViolationDaily/c1')
  })

  it('refuses what one query cannot hold, by name, rather than apply it to some rows', async () => {
    const body = await (
      await rows({ filters: JSON.stringify([{ field: 'count', op: '>', value: '5' }]) })
    ).json()
    expect(body.refused.map((entry: any) => entry.clause.field)).toEqual(['count'])
    expect(mockQueries[0].where).toHaveLength(1)
  })

  it('refuses unreadable filters with a 400', async () => {
    expect((await rows({ filters: 'nope' })).status).toBe(400)
    expect(mockQueries).toEqual([])
  })
})
