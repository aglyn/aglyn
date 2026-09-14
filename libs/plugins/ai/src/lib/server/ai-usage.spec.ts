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
 * `/api/ai/usage` (AGL-2928) is the customer's read of who drew the AI
 * credits, so what gets pinned is who may read it and what leaves: the table
 * behind `billing.view`, one person's months behind that OR `org.auditLog`
 * OR being that person, a month past the retention window refused rather than
 * answered empty, a share and never a dollar figure on the wire, and a CSV
 * whose body carries every row the header promised across a roster larger
 * than one page of the stream.
 *
 * The reader is the REAL one, over a document double: a stubbed
 * `readOrgAiUsageByUser` would prove only that the route calls something.
 */

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn(async (..._args: unknown[]) => undefined)
/** Which permissions the current member holds, by name. */
let mockPermissions: Record<string, boolean> = {}
let mockMember: Record<string, unknown> | null = null
/** Documents by path. */
let mockDocs: Record<string, Record<string, unknown> | undefined> = {}

const mockSnapshotOf = (path: string) => ({
  id: path.split('/').pop() ?? '',
  exists: mockDocs[path] !== undefined,
  data: () => mockDocs[path],
  get: (field: string) => mockDocs[path]?.[field],
})

/** Direct children of `prefix`, ordered by id. */
const mockChildrenOf = (prefix: string) =>
  Object.keys(mockDocs)
    .filter(
      (path) =>
        path.startsWith(`${prefix}/`) &&
        path.slice(prefix.length + 1).split('/').length === 1,
    )
    .sort()

function mockMakeCollection(path: string): any {
  let direction: 'asc' | 'desc' = 'asc'
  let cap = Number.POSITIVE_INFINITY
  const query: any = {
    orderBy: (_field: unknown, dir: 'asc' | 'desc' = 'asc') => {
      direction = dir
      return query
    },
    limit: (n: number) => {
      cap = n
      return query
    },
    get: async () => {
      const paths = mockChildrenOf(path)
      if (direction === 'desc') paths.reverse()
      return { docs: paths.slice(0, cap).map(mockSnapshotOf) }
    },
    add: (...args: unknown[]) => mockAuditAdd(...args),
    doc: (id: string) => mockMakeDoc(`${path}/${id}`),
  }
  return query
}

function mockMakeDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => mockSnapshotOf(path),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', increment: (n: number) => n },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
        getAll: async (...refs: Array<{ path: string }>) =>
          refs.map((ref) => mockSnapshotOf(ref.path)),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
  memberHasOrgPermission: async (
    _orgId: string,
    member: unknown,
    permission: string,
  ) => Boolean(member) && mockPermissions[permission] === true,
  resolveOrgMembership: async () =>
    mockMember ? { orgId: 'org-1', member: mockMember } : null,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { aiUsageMonthKeys } from '../model/ai-usage-by-user'
import { GET } from './ai-usage'
import {
  AI_USAGE_CSV_HEADER,
  AI_USAGE_EXPORT_ROWS_HEADER,
} from '../usage/ai-usage-wire'

const MONTHS = aiUsageMonthKeys()
const MONTH = MONTHS[0]
const LAST_MONTH = MONTHS[1]

const get = (params: Record<string, string> = {}, token: string | null = 'tok') =>
  GET(
    new Request(
      `https://app.aglyn.com/api/ai/usage?${new URLSearchParams({
        orgId: 'org-1',
        ...params,
      }).toString()}`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
    ),
  )

const signedIn = (uid = 'user-a', extra: Record<string, unknown> = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true, ...extra })

const monthPath = (uid: string, month = MONTH) =>
  `orgs/org-1/aiUsageByUser/${uid}/months/${month}`

const seedRoster = () => {
  mockDocs['orgs/org-1/members/user-a'] = {
    displayName: 'Ada',
    email: 'ada@example.com',
    role: 'admin',
  }
  mockDocs['orgs/org-1/members/user-b'] = { email: 'bo@example.com', role: 'editor' }
  mockDocs['orgs/org-1/members/user-c'] = { email: 'quiet@example.com', role: 'viewer' }
  mockDocs[`orgs/org-1/assistUsage/${MONTH}`] = { estCostUsd: 2.5 }
  mockDocs[monthPath('user-a')] = {
    uid: 'user-a',
    credits: 700,
    estCostUsd: 0.7,
    requests: 10,
    byKind: { assist: 700 },
    byHost: { 'host-1': 700 },
  }
  mockDocs[monthPath('user-b')] = {
    uid: 'user-b',
    credits: 1800,
    estCostUsd: 1.8,
    requests: 30,
    refusals: 2,
    byKind: { element: 1000, page: 800 },
    byHost: { 'host-1': 300, 'host-2': 1500 },
  }
  mockDocs[monthPath('user-a', LAST_MONTH)] = {
    uid: 'user-a',
    credits: 50,
    estCostUsd: 0.05,
    requests: 2,
  }
  mockDocs[`orgs/org-1/assistUsage/${LAST_MONTH}`] = { estCostUsd: 0.1 }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPermissions = {}
  mockMember = { role: 'admin' }
  mockDocs = {}
  seedRoster()
})

describe('/api/ai/usage — who may read (AGL-2928)', () => {
  it('401s an unauthenticated caller', async () => {
    expect((await get({}, null)).status).toBe(401)
  })

  it('404s a signed-in stranger to the org', async () => {
    signedIn('outsider')
    mockMember = null
    expect((await get()).status).toBe(404)
  })

  it('refuses the table to a member without billing.view', async () => {
    signedIn()
    const response = await get()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/billing\.view/)
  })

  it('refuses a month outside the retention window rather than answering it empty', async () => {
    signedIn()
    mockPermissions = { 'billing.view': true }
    const reaped = new Date(Date.UTC(2000, 0, 1)).toISOString().slice(0, 7)
    const response = await get({ month: reaped })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/kept for 13 months/)
    // Junk is not a month either.
    expect((await get({ month: 'latest' })).status).toBe(400)
  })

  it('lets a member read their OWN months with no permission at all', async () => {
    signedIn('user-a')
    const response = await get({ uid: 'user-a' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.uid).toBe('user-a')
    // Newest first, capped at the two the member card asks for by default.
    expect(body.months.map((entry: { month: string }) => entry.month)).toEqual([
      MONTH,
      LAST_MONTH,
    ])
    // Each month's share is of THAT month's org spend: 0.7 of 2.5, 0.05 of 0.1.
    expect(body.months[0].share).toBe(0.28)
    expect(body.months[1].share).toBe(0.5)
    expect(body.months[0].byHost).toEqual({ 'host-1': 700 })
  })

  it('refuses another person’s months without billing.view or org.auditLog, and admits either', async () => {
    signedIn('user-a')
    expect((await get({ uid: 'user-b' })).status).toBe(403)
    mockPermissions = { 'org.auditLog': true }
    expect((await get({ uid: 'user-b' })).status).toBe(200)
    mockPermissions = { 'billing.view': true }
    expect((await get({ uid: 'user-b' })).status).toBe(200)
  })

  it('serves the table to staff with no membership', async () => {
    signedIn('staff-1', { staff: true })
    mockMember = null
    expect((await get()).status).toBe(200)
  })
})

describe('/api/ai/usage — what leaves (AGL-2928)', () => {
  beforeEach(() => {
    signedIn()
    mockPermissions = { 'billing.view': true }
  })

  it('lists the roster’s months dearest first, with a share and no dollar figure', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.month).toBe(MONTH)
    expect(body.months).toEqual(MONTHS)
    expect(body.orgCredits).toBe(2_500)
    expect(body.rows.map((row: { uid: string }) => row.uid)).toEqual(['user-b', 'user-a'])
    expect(body.rows[0]).toEqual({
      uid: 'user-b',
      name: 'bo@example.com',
      email: 'bo@example.com',
      role: 'editor',
      credits: 1800,
      share: 0.72,
      requests: 30,
      refusals: 2,
      byKind: { element: 1000, page: 800 },
      byHost: { 'host-1': 300, 'host-2': 1500 },
    })
    // The member with no month document is not a zero row.
    expect(JSON.stringify(body)).not.toContain('user-c')
    // Our provider bill stays on the server.
    expect(JSON.stringify(body)).not.toContain('estCostUsd')
  })

  it('names a site and each row carries its credits THERE, dearest on the site first', async () => {
    const body = await (await get({ hostId: 'host-1' })).json()
    expect(body.rows.map((row: { uid: string; hostCredits: number }) => [row.uid, row.hostCredits])).toEqual([
      ['user-a', 700],
      ['user-b', 300],
    ])
  })

  it('streams the CSV whole across a roster larger than one page, and promises its row count', async () => {
    // 250 members with a month each: more than the stream's page of 200.
    for (let index = 0; index < 250; index += 1) {
      const uid = `bulk-${String(index).padStart(3, '0')}`
      mockDocs[`orgs/org-1/members/${uid}`] = { email: `${uid}@example.com`, role: 'viewer' }
      mockDocs[monthPath(uid)] = {
        uid,
        credits: 1 + index,
        estCostUsd: (1 + index) / 1000,
        requests: 1,
        byKind: { assist: 1 + index },
      }
    }
    const response = await get({ format: 'csv' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toMatch(/text\/csv/)
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="ai-usage-${MONTH}.csv"`,
    )
    expect(response.headers.get(AI_USAGE_EXPORT_ROWS_HEADER)).toBe('252')
    const text = await response.text()
    const lines = text.split('\n')
    // A trailing newline closes the file; everything before it is a row.
    expect(lines.pop()).toBe('')
    expect(lines[0]).toBe(AI_USAGE_CSV_HEADER.join(','))
    expect(lines).toHaveLength(1 + 252)
    // Dearest first: the roster's admin, then the bulk in descending credits.
    expect(lines[1]).toContain('bo@example.com')
    expect(lines[1]).toContain('72%')
    expect(lines[lines.length - 1].startsWith('bulk-000@example.com')).toBe(true)
    // The export is an act worth a row: counts and the month, never names.
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    const audit = mockAuditAdd.mock.calls[0][0] as Record<string, unknown>
    expect(audit).toMatchObject({
      actorUid: 'user-a',
      action: 'ai-usage.exported',
      target: 'orgs/org-1/aiUsageByUser',
      after: { month: MONTH, rows: 252, hostId: null },
    })
    expect(JSON.stringify(audit)).not.toContain('bo@example.com')
  })
})
