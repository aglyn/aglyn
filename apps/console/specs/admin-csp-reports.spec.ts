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
 * today, and the in-memory app/directive filters that keep the Firestore
 * query on the automatic single-field index.
 */

// A module, not a script: without this, tsc puts the file in the global
// scope and its `mock*` names collide with `admin-user-detail-phone.spec.ts`.
export {}

let mockDecodedToken: Record<string, unknown>
let mockRows: Array<Record<string, unknown>>
let mockQueries: Array<{ field: string; op: string; value: unknown; limit: number }>

const mockFirestore = {
  collection: (collection: string) => ({
    where: (field: string, op: string, value: unknown) => ({
      orderBy: () => ({
        limit: (limit: number) => ({
          get: async () => {
            mockQueries.push({ field, op, value, limit })
            void collection
            return { docs: mockRows.map((row) => ({ data: () => row })) }
          },
        }),
      }),
    }),
  }),
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

  it('queries a single field range so no composite index is needed', async () => {
    // The `/api/health/rate-limits` lesson: a range + orderBy on ONE field
    // rides the automatic index. If this asserts a different field pair, the
    // route now needs `firebase-firestore.indexes.json` and a deploy.
    await get('?days=3')
    expect(mockQueries).toHaveLength(1)
    expect(mockQueries[0].field).toBe('day')
    expect(mockQueries[0].op).toBe('>=')
    // days=3 counts TODAY as day one: cutoff is two days back, not three.
    const expected = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    expect(mockQueries[0].value).toBe(expected)
  })

  it('clamps `days` to the retention window instead of trusting the query string', async () => {
    await get('?days=5000')
    const floor = new Date(Date.now() - 59 * 86_400_000).toISOString().slice(0, 10)
    expect(mockQueries[0].value).toBe(floor)
    mockQueries = []
    await get('?days=-2')
    const today = new Date().toISOString().slice(0, 10)
    expect(mockQueries[0].value).toBe(today)
  })

  it('filters by app and directive in memory, not in the query', async () => {
    const byApp = await (await get('?app=console')).json()
    expect(byApp.rows.map((row: any) => row.origin)).toEqual([
      'a.example',
      'c.example',
    ])
    const byDirective = await (await get('?directive=img-src')).json()
    expect(byDirective.rows.map((row: any) => row.origin)).toEqual([
      'b.example',
      'a.example',
    ])
    // Both still issued the same one-field query — the filters must never
    // migrate into `where` clauses without an index plan.
    expect(mockQueries.every((query) => query.field === 'day')).toBe(true)
  })
})
