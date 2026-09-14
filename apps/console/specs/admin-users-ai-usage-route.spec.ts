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
 * `/api/admin/users/ai-usage` (AGL-2928) backs the staff user page's card,
 * so the staff gate is pinned (401 / 403 / 200) together with the two things
 * the card relies on: every membership's months land in one list, newest
 * month first and dearest workspace first within it, and the open is
 * recorded as an ACCESS about THIS person — `subjectUid` set — before the
 * rows are served.
 */

const mockVerifyIdToken = jest.fn()
const mockRecordAdminAudit = jest.fn(async (..._args: unknown[]) => undefined)
let mockDocs: Record<string, Record<string, unknown> | undefined> = {}

const mockSnapshotOf = (path: string) => ({
  id: path.split('/').pop() ?? '',
  exists: mockDocs[path] !== undefined,
  data: () => mockDocs[path],
  get: (field: string) => mockDocs[path]?.[field],
})

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
      const docs = paths.slice(0, cap).map(mockSnapshotOf)
      return { docs, size: docs.length }
    },
    doc: (id: string) => ({
      id,
      path: `${path}/${id}`,
      collection: (name: string) => mockMakeCollection(`${path}/${id}/${name}`),
    }),
  }
  return query
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
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

jest.mock('../app/api/_lib/admin-audit', () => ({
  __esModule: true,
  recordAdminAudit: (...args: unknown[]) => mockRecordAdminAudit(...args),
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

import { GET } from '../app/api/admin/users/ai-usage/route'

const get = (token: string | null = 'tok', uid = 'user-a') =>
  GET(
    new Request(`https://app.aglyn.com/api/admin/users/ai-usage?uid=${uid}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const staff = () =>
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs = {
    'users/user-a/orgs/org-1': { orgName: 'Acme', slug: 'acme' },
    'users/user-a/orgs/org-2': { orgName: 'Beta', slug: 'beta' },
    'orgs/org-1/aiUsageByUser/user-a/months/2026-08': { credits: 40, requests: 4 },
    'orgs/org-1/aiUsageByUser/user-a/months/2026-09': { credits: 120, requests: 9, refusals: 1 },
    'orgs/org-2/aiUsageByUser/user-a/months/2026-09': { credits: 300, requests: 12 },
  }
})

describe('/api/admin/users/ai-usage (AGL-2928)', () => {
  it('401s an unauthenticated caller', async () => {
    expect((await get(null)).status).toBe(401)
  })

  it('403s a verified NON-staff token, and records no access', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email_verified: true })
    expect((await get()).status).toBe(403)
    expect(mockRecordAdminAudit).not.toHaveBeenCalled()
  })

  it('400s a call that names nobody', async () => {
    staff()
    expect((await get('tok', '')).status).toBe(400)
  })

  it('lists every workspace’s months, newest first and dearest first within a month', async () => {
    staff()
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.uid).toBe('user-a')
    expect(body.truncated).toBe(false)
    expect(
      body.rows.map((row: Record<string, unknown>) => [row.orgName, row.month, row.credits]),
    ).toEqual([
      ['Beta', '2026-09', 300],
      ['Acme', '2026-09', 120],
      ['Acme', '2026-08', 40],
    ])
    expect(body.rows[1]).toEqual({
      orgId: 'org-1',
      orgName: 'Acme',
      slug: 'acme',
      month: '2026-09',
      credits: 120,
      requests: 9,
      refusals: 1,
    })
  })

  it('records the open as an access ABOUT this person before serving it', async () => {
    staff()
    await get()
    expect(mockRecordAdminAudit).toHaveBeenCalledTimes(1)
    expect(mockRecordAdminAudit.mock.calls[0][0]).toMatchObject({
      actorUid: 'staff-1',
      action: 'user.ai-usage-viewed',
      target: 'users/user-a',
      subjectUid: 'user-a',
    })
  })
})
