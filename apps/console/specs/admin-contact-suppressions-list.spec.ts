/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * The do-not-contact list pages every record and counts every active one
 * (AGL-3321). It read the newest 200 and stopped, and its header counted the
 * active ones among those, so past 200 an opt-out went unlisted and
 * uncounted. The double answers the queries: order, cursor, limit, and the
 * `revokedAt == null` count.
 */

export {}

const records: Array<{ id: string; updatedAt: number; revokedAt: number | null }> = []
const mockDecodedToken: Record<string, unknown> = {}

function query(after: string | null = null, count = Infinity, activeOnly = false): any {
  const rows = () => {
    let sorted = [...records]
      .filter((row) => !activeOnly || row.revokedAt === null)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
    if (after) sorted = sorted.slice(sorted.findIndex((row) => row.id === after) + 1)
    return sorted.slice(0, count)
  }
  return {
    orderBy: (field: string, direction: string) => {
      if (field !== 'updatedAt' || direction !== 'desc') throw new Error(`${field} ${direction}`)
      return query(after, count, activeOnly)
    },
    where: (field: string, op: string, value: unknown) => {
      if (field !== 'revokedAt' || op !== '==' || value !== null) throw new Error('unexpected where')
      return query(after, count, true)
    },
    startAfter: (snapshot: { id: string }) => query(snapshot.id, count, activeOnly),
    limit: (next: number) => query(after, next, activeOnly),
    count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
    get: async () => ({
      docs: rows().map((row) => ({
        id: row.id,
        ref: { path: `contactSuppressions/${row.id}` },
        data: () => ({ phoneNumber: `+1${row.id}`, updatedAt: row.updatedAt, revokedAt: row.revokedAt }),
      })),
    }),
  }
}

const mockFirestore = {
  collection: () => query(),
  doc: (path: string) => ({
    get: async () => {
      const id = path.split('/').pop() as string
      return { id, exists: records.some((row) => row.id === id) }
    },
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  CONTACT_SUPPRESSIONS_COLLECTION: 'contactSuppressions',
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

const route = require('../app/api/admin/contact-suppressions/route') as {
  GET: (request: Request) => Promise<Response>
}

async function get(params: Record<string, string> = {}): Promise<any> {
  const response = await route.GET(
    new Request(`https://app.aglyn.com/api/admin/contact-suppressions?${new URLSearchParams(params)}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

beforeAll(() => {
  Object.assign(mockDecodedToken, { uid: 'staff_1', email_verified: true, staff: true })
  for (let at = 0; at < 230; at += 1) {
    records.push({
      id: String(5550000 + at),
      updatedAt: 1_000_000 + at,
      revokedAt: at % 10 === 0 ? 1 : null,
    })
  }
})

describe('the do-not-contact list', () => {
  it('pages past the old 200-record window, none twice and none skipped', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 20; guard += 1) {
      const page: any = await get({ pageSize: '50', ...(cursor ? { cursor } : {}) })
      seen.push(...page.records.map((row: any) => row.$id))
      if (!page.hasMore) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(230)
    expect(new Set(seen).size).toBe(230)
    expect(seen[0]).toBe('5550229')
  })

  it('counts every active record, not the ones on a page', async () => {
    expect((await get({ view: 'summary' })).active).toBe(207)
  })
})
