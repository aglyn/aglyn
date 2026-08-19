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
 * `admin/audit-archive` reports on a GET and archives on a POST (AGL-2084).
 *
 * Four scheduled routes export `handler as GET, handler as POST`. Two of them
 * — `reap-plugin-artifacts` and `reverify-plugin-versions` — deliberately make
 * a GET a dry run, so that "a browser or a curl someone pasted" cannot cause
 * writes. The two that delete permanently did not have that guard;
 * `run-erasures` got it in AGL-2165, and this route was the last one left: a
 * GET moved audit rows into Storage and then DELETED them from Firestore.
 *
 * The claims, each given the input that makes it fail:
 *
 * 1. **A GET writes nothing** — no Storage object, no delete, no staff email —
 *    and reports the plan it would have executed.
 * 2. **A bodyless POST still archives.** This is the exact shape
 *    `scheduled-crons.yml` sends (`curl -X POST` with no body), so defaulting
 *    an absent `dryRun` to true would silently stop archiving for 90 days —
 *    a worse failure than the one being fixed. The default is keyed on the
 *    METHOD, not on the body being absent.
 * 3. **An explicit flag wins over the method in both directions**:
 *    `GET ?dryRun=0` archives, `POST {dryRun: true}` does not.
 * 4. The dry run pages with a cursor. The real run relies on DELETING a batch
 *    to advance the window, so a dry run that reused that loop unchanged would
 *    re-count the first 500 rows until it hit the batch ceiling.
 */

// A module, not a script.
export {}

/** Rows in `adminAudit`, oldest first. */
let mockAudit: Array<{ id: string; at: Date }> = []
/** Every Storage object the run wrote. */
let mockSaved: Array<{ path: string; body: string }> = []
/** Every document id the run deleted. */
let mockDeleted: string[] = []
const mockSendEmail = jest.fn()

const BATCH_SIZE = 500

function mockAuditDoc(entry: { id: string; at: Date }) {
  return {
    id: entry.id,
    data: () => ({ action: 'test.entry' }),
    get: (field: string) => (field === 'at' ? { toDate: () => entry.at } : undefined),
    ref: { id: entry.id },
  }
}

/**
 * A cursor-aware `adminAudit` query. `startAfter` takes the snapshot the route
 * passes and resumes after it — modelling the real semantics is the whole
 * point, because a fake that ignored the cursor would report a green for the
 * looping bug this suite exists to catch.
 */
function mockAuditQuery(after: string | null = null, limit = BATCH_SIZE) {
  const query = {
    where: () => query,
    orderBy: () => query,
    startAfter: (doc: { id?: string }) => mockAuditQuery(doc?.id ?? null, limit),
    limit: (count: number) => mockAuditQuery(after, count),
    get: async () => {
      const start = after ? mockAudit.findIndex((row) => row.id === after) + 1 : 0
      const rows = mockAudit.slice(start, start + limit).map(mockAuditDoc)
      return { size: rows.length, empty: rows.length === 0, docs: rows }
    },
  }
  return query
}

/** `orgs`: one workspace past its erasure hold, so the email path is live. */
function mockOrgsQuery() {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({
      size: 1,
      empty: false,
      docs: [
        {
          id: 'org-due',
          data: () => ({}),
          get: (field: string) =>
            field === 'name'
              ? 'Overdue Ltd'
              : field === 'erasureRequestedAt'
                ? { toDate: () => new Date(0) }
                : undefined,
          ref: { id: 'org-due' },
        },
      ],
    }),
  }
  return query
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const query: Record<string, string> = {}
    for (const [key, value] of url.searchParams) query[key] = value
    return {
      method: request.method,
      query,
      body:
        request.method === 'GET'
          ? undefined
          : await request.json().catch(() => undefined),
      headers: Object.fromEntries(request.headers),
    }
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  meterPlatformEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) =>
          name === 'adminAudit' ? mockAuditQuery() : mockOrgsQuery(),
        batch: () => {
          const staged: string[] = []
          return {
            delete: (ref: { id: string }) => staged.push(ref.id),
            commit: async () => {
              mockDeleted.push(...staged)
              mockAudit = mockAudit.filter((row) => !staged.includes(row.id))
            },
          }
        },
      }),
      storage: () => ({
        bucket: () => ({
          file: (path: string) => ({
            save: async (body: string) => {
              mockSaved.push({ path, body })
            },
          }),
        }),
      }),
    }),
  },
}))

const ORIGINAL_ENV = process.env

function load() {
  jest.resetModules()
  return require('../app/api/admin/audit-archive/route') as {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
}

const CRON = { 'x-cron-secret': 'cron-fake' }

function request(method: 'GET' | 'POST', search = '', body?: unknown) {
  return new Request(`https://app.aglyn.com/api/admin/audit-archive${search}`, {
    method,
    headers: {
      ...CRON,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** `count` rows, all older than the 90-day cutoff. */
function seed(count: number) {
  const old = Date.now() - 200 * 24 * 60 * 60 * 1000
  mockAudit = Array.from({ length: count }, (_, index) => ({
    id: `audit-${index}`,
    at: new Date(old + index * 1000),
  }))
}

describe('audit-archive: a GET reports, a POST archives (AGL-2084)', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      CRON_SECRET: 'cron-fake',
      STAFF_ALERT_EMAIL: 'staff@aglyn.com',
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'bucket',
    } as NodeJS.ProcessEnv
    mockSaved = []
    mockDeleted = []
    mockSendEmail.mockReset().mockResolvedValue(undefined)
    seed(3)
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('a GET deletes nothing, writes nothing and sends nothing', async () => {
    const response = await load().GET(request('GET'))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      dryRun: boolean
      archived: number
    }
    expect(payload.dryRun).toBe(true)
    // The plan is still reported — a dry run that reported zero would be
    // indistinguishable from an empty collection.
    expect(payload.archived).toBe(3)
    expect(mockDeleted).toEqual([])
    expect(mockSaved).toEqual([])
    expect(mockSendEmail).not.toHaveBeenCalled()
    // And the rows are still there.
    expect(mockAudit).toHaveLength(3)
  })

  it('a bodyless POST — the shape scheduled-crons.yml sends — still archives', async () => {
    const response = await load().POST(request('POST'))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      dryRun: boolean
      archived: number
    }
    expect(payload.dryRun).toBe(false)
    expect(payload.archived).toBe(3)
    expect(mockDeleted).toEqual(['audit-0', 'audit-1', 'audit-2'])
    expect(mockSaved).toHaveLength(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('an explicit flag beats the method in both directions', async () => {
    await load().GET(request('GET', '?dryRun=0'))
    expect(mockDeleted).toEqual(['audit-0', 'audit-1', 'audit-2'])

    seed(3)
    mockDeleted = []
    mockSaved = []
    const held = await load().POST(request('POST', '', { dryRun: true }))
    expect(((await held.json()) as { dryRun: boolean }).dryRun).toBe(true)
    expect(mockDeleted).toEqual([])
    expect(mockSaved).toEqual([])
  })

  it('the dry run pages with a cursor instead of re-reading the first batch', async () => {
    // Two full batches and a short one. Without a cursor the dry run would
    // re-read rows 0..499 on every pass and report 10 x BATCH_SIZE — the
    // MAX_BATCHES_PER_RUN ceiling — because nothing is deleted to advance it.
    seed(BATCH_SIZE * 2 + 7)
    const response = await load().GET(request('GET'))
    const payload = (await response.json()) as {
      archived: number
      batches: number
    }
    expect(payload.archived).toBe(BATCH_SIZE * 2 + 7)
    expect(payload.batches).toBe(3)
    expect(mockDeleted).toEqual([])
  })
})
