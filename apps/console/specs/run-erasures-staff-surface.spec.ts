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
 * The erasure queue became reachable from the console (AGL-2165).
 *
 * `POST /api/admin/run-erasures` executes the GDPR erasures whose 7-day hold
 * has expired, and was cron-secret-only — so a browser could not call it at
 * all. `staff-org-actions.component.tsx` describes it as the operator's escape
 * hatch while itself only calling `erasure-request`, which QUEUES an erasure.
 * Staff could ask for a workspace to be erased and then had no way to run it,
 * to see what was pending, or to find out why one had not gone through, short
 * of hand-dispatching a GitHub workflow — against a statutory deadline.
 *
 * The claims, and each is given the input that makes it fail:
 *
 * 1. **GET is READ-ONLY.** It used to be a bare alias for POST, so a GET on
 *    this URL permanently erased up to five workspaces. Nothing called it that
 *    way — `scheduled-crons.yml` POSTs every route it fires — so the alias was
 *    pure hazard: an irreversible delete behind the one verb the web treats as
 *    safe to prefetch and retry.
 * 2. **A staff token authorizes, and the cron secret still does.** The
 *    scheduler has no user and must keep working.
 * 3. **A non-staff token does not**, and neither does no credential.
 * 4. **A staff-triggered run is audited with an actor and a reason**, and is
 *    refused without one. `eraseOrg` audits each erasure; nothing said who
 *    asked for the batch or why it could not wait for 04:00 UTC.
 * 5. The preview separates DUE from HOLDING, which is the only question the
 *    operator has — per row, and as totals over the whole queue.
 * 6. The preview's list is ONE query (AGL-3321): oldest request first, the
 *    State filter a range over the request time, paged by a cursor.
 */

// A module, not a script.
export {}

const mockVerifyIdToken = jest.fn()
const mockEraseOrg = jest.fn()
let mockAudit: Record<string, unknown>[] = []
/** `orgs` documents the preview and the runner read. */
let mockOrgs: Array<{ id: string; data: Record<string, unknown> }> = []

const HOLD_MS = 7 * 24 * 60 * 60 * 1000

/** Every `where` and `orderBy` a read of `orgs` carried, per read. */
let mockOrgReads: Array<{ wheres: Array<[string, string, unknown]>; orderBy: string[] }> = []

function mockSnapshot(entry: { id: string; data: Record<string, unknown> }) {
  return {
    id: entry.id,
    data: () => entry.data,
    get: (field: string) => entry.data[field],
    ref: { id: entry.id, path: `orgs/${entry.id}` },
  }
}

/** The instant a bound names — a Date, or the Timestamp the plan made of one. */
const mockMillis = (bound: any): number =>
  bound instanceof Date ? bound.getTime() : typeof bound?.toMillis === 'function' ? bound.toMillis() : Number(bound)

function mockOrgsQuery(
  limit: number | null = null,
  read: { wheres: Array<[string, string, unknown]>; orderBy: string[] } = { wheres: [], orderBy: [] },
): any {
  const matching = () =>
    mockOrgs.filter((entry) =>
      read.wheres.every(([field, op, bound]) => {
        if (field !== 'erasureRequestedAt') return true
        const at = (entry.data[field] as { toMillis: () => number }).toMillis()
        const edge = mockMillis(bound)
        return op === '<=' ? at <= edge : op === '<' ? at < edge : op === '>' ? at > edge : at >= edge
      }),
    )
  return {
    orderBy: (field: string, direction: string) =>
      mockOrgsQuery(limit, { ...read, orderBy: [...read.orderBy, `${field} ${direction}`] }),
    where: (field: string, op: string, value: unknown) =>
      mockOrgsQuery(limit, { ...read, wheres: [...read.wheres, [String(field), op, value]] }),
    limit: (count: number) => mockOrgsQuery(count, read),
    startAfter: () => mockOrgsQuery(limit, read),
    count: () => ({
      get: async () => ({ data: () => ({ count: matching().length }) }),
    }),
    get: async () => {
      mockOrgReads.push(read)
      const rows = matching().map(mockSnapshot)
      const sliced = limit == null ? rows : rows.slice(0, limit)
      return { size: sliced.length, docs: sliced }
    },
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    body:
      request.method === 'POST'
        ? await request.json().catch(() => ({}))
        : undefined,
    headers: Object.fromEntries(request.headers),
  }),
  resolveBrandingProfile: () => ({
    productName: 'Aglyn',
    fromName: 'Aglyn',
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

// The person queue has its own spec; here it is empty, so the workspace
// queue is what the surface shows.
jest.mock('../utils/server/run-person-erasures', () => ({
  __esModule: true,
  runPersonErasures: async () => ({ erased: [], failed: [], scanned: 0 }),
  countPendingPersonErasures: async () => ({ pending: 0, truncated: false, maxPerRun: 25 }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ERASURE_HOLD_MS: 7 * 24 * 60 * 60 * 1000,
  eraseOrg: (...args: unknown[]) => mockEraseOrg(...args),
  findUserByUidAcrossPools: async () => null,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  meterPlatformEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: mockVerifyIdToken }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'adminAudit') {
            return {
              add: async (data: Record<string, unknown>) => {
                mockAudit.push(data)
                return { id: `audit-${mockAudit.length}` }
              },
            }
          }
          return mockOrgsQuery()
        },
        doc: (path: string) => ({ get: async () => ({ exists: false, path }) }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => '__now__' } },
  },
}))

const ORIGINAL_ENV = process.env

function load() {
  jest.resetModules()
  return require('../app/api/admin/run-erasures/route') as {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
}

function request(
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
  search = '',
) {
  return new Request(`https://app.aglyn.com/api/admin/run-erasures${search}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const STAFF = { authorization: 'Bearer staff-id-token' }
const CRON = { 'x-cron-secret': 'cron-fake' }

describe('the erasure queue is reachable, and GET no longer deletes (AGL-2165)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: 'cron-fake' } as NodeJS.ProcessEnv
    mockAudit = []
    mockOrgReads = []
    mockEraseOrg.mockReset().mockResolvedValue({ ok: true })
    mockVerifyIdToken.mockReset().mockResolvedValue({
      uid: 'uid-staff',
      email_verified: true,
      staff: true,
    })
    mockOrgs = [
      {
        id: 'org-due',
        data: {
          name: 'Overdue Ltd',
          slug: 'overdue',
          ownerUid: 'uid-owner-1',
          erasureRequestedAt: { toMillis: () => Date.now() - HOLD_MS - 60_000 },
        },
      },
      {
        id: 'org-holding',
        data: {
          name: 'Fresh Ltd',
          slug: 'fresh',
          ownerUid: 'uid-owner-2',
          erasureRequestedAt: { toMillis: () => Date.now() - 60_000 },
        },
      },
    ]
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('GET erases NOTHING — it used to be a bare alias for POST', async () => {
    const response = await load().GET(request('GET', STAFF))
    expect(response.status).toBe(200)
    // The whole point. An irreversible delete behind GET is reachable by a
    // prefetch, a retry, or a link.
    expect(mockEraseOrg).not.toHaveBeenCalled()
    expect(mockAudit).toHaveLength(0)
  })

  it('GET separates DUE from HOLDING and states the hold expiry', async () => {
    const response = await load().GET(request('GET', STAFF))
    const payload = await response.json()
    expect(payload.rows).toHaveLength(2)
    const due = payload.rows.find((row: any) => row.orgId === 'org-due')
    const holding = payload.rows.find(
      (row: any) => row.orgId === 'org-holding',
    )
    expect(due.due).toBe(true)
    expect(holding.due).toBe(false)
    // "Waiting on the hold, or waiting on us?" is unanswerable without this.
    expect(holding.holdExpiresAtMs).toBeGreaterThan(Date.now())
    expect(due.holdExpiresAtMs).toBeLessThanOrEqual(Date.now())
    // The queue is the request order: oldest first, no other predicate.
    expect(mockOrgReads[0]).toEqual({ wheres: [], orderBy: ['erasureRequestedAt asc'] })
  })

  it('GET ?view=summary counts the whole queue, due and queued', async () => {
    const payload = await (await load().GET(request('GET', STAFF, undefined, '?view=summary'))).json()
    expect(payload.dueCount).toBe(1)
    expect(payload.queued).toBe(2)
    expect(payload.maxPerRun).toBe(5)
    expect(payload.people).toMatchObject({ pending: 0 })
  })

  it('serves State on the query as a range over the request time', async () => {
    const filters = encodeURIComponent(JSON.stringify([{ field: 'due', op: 'equals', value: 'due' }]))
    const payload = await (await load().GET(request('GET', STAFF, undefined, `?filters=${filters}`))).json()
    expect(payload.refused).toEqual([])
    expect(payload.rows.map((row: any) => row.orgId)).toEqual(['org-due'])
    expect(mockOrgReads[0].wheres.map(([field, op]) => `${field} ${op}`)).toEqual([
      'erasureRequestedAt <=',
    ])
    expect(mockOrgReads[0].orderBy).toEqual(['erasureRequestedAt asc'])
  })

  it('serves the search on the name tokens, and names what it cannot apply', async () => {
    const filters = encodeURIComponent(JSON.stringify([{ field: 'due', op: 'equals', value: 'soon' }]))
    const payload = await (
      await load().GET(request('GET', STAFF, undefined, `?search=Overdue&filters=${filters}`))
    ).json()
    expect(mockOrgReads[0].wheres).toEqual([['nameTokens', 'array-contains', 'overdue']])
    expect(payload.refused).toEqual([
      { clause: { field: 'due', op: 'equals', value: 'soon' }, reason: 'pick Due or Holding' },
    ])
  })

  it('a staff POST runs the batch and records the actor AND the reason', async () => {
    const reason = 'DSAR deadline 2026-08-20, cannot wait for 04:00 UTC'
    const response = await load().POST(request('POST', STAFF, { reason }))
    expect(response.status).toBe(200)
    expect(mockEraseOrg).toHaveBeenCalled()
    expect(mockAudit).toHaveLength(1)
    expect(mockAudit[0]).toMatchObject({
      actorUid: 'uid-staff',
      action: 'erasure.runBatch',
      reason,
    })
  })

  it('a staff POST with no reason is refused, before erasing anything', async () => {
    const response = await load().POST(request('POST', STAFF, {}))
    expect(response.status).toBe(400)
    expect(mockEraseOrg).not.toHaveBeenCalled()
    expect(mockAudit).toHaveLength(0)
  })

  it('a staff POST with a keystroke reason is refused too', async () => {
    const response = await load().POST(request('POST', STAFF, { reason: 'x' }))
    expect(response.status).toBe(400)
    expect(mockEraseOrg).not.toHaveBeenCalled()
  })

  it('the SCHEDULER still runs without a reason — it has no user', async () => {
    const response = await load().POST(request('POST', CRON))
    expect(response.status).toBe(200)
    expect(mockEraseOrg).toHaveBeenCalled()
    // No batch audit row: there is no actor to attribute and no reason to
    // give beyond "it is 04:00 UTC". `eraseOrg` still audits each erasure.
    expect(mockAudit).toHaveLength(0)
  })

  it('a NON-staff token authorizes nothing', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-customer',
      email_verified: true,
    })
    const get = await load().GET(request('GET', STAFF))
    expect(get.status).toBe(401)
    const post = await load().POST(
      request('POST', STAFF, { reason: 'a perfectly good reason' }),
    )
    expect(post.status).toBe(401)
    expect(mockEraseOrg).not.toHaveBeenCalled()
  })

  it('no credential at all authorizes nothing', async () => {
    const response = await load().POST(
      request('POST', {}, { reason: 'a perfectly good reason' }),
    )
    expect(response.status).toBe(401)
    expect(mockEraseOrg).not.toHaveBeenCalled()
  })

  it('a WRONG cron secret authorizes nothing', async () => {
    const response = await load().POST(
      request('POST', { 'x-cron-secret': 'not-the-secret' }),
    )
    expect(response.status).toBe(401)
    expect(mockEraseOrg).not.toHaveBeenCalled()
  })
})
