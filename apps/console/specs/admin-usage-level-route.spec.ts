/**
 * @jest-environment node
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
 * The staff usage level's one writer, `/api/admin/usage-level` (AGL-4228).
 *
 * What has to hold: only staff (and never a staff member signed in as a
 * customer) set it; a site's level carries to its workspace and that
 * workspace's owner when asked, and a carry RAISES a level but never lowers
 * one somebody set from a closer look; every write is audited.
 */

const mockVerifyIdToken = jest.fn()
const mockImpersonating = { value: false }
const mockDocs: Record<string, Record<string, unknown>> = {}
const mockAudit: Array<Record<string, unknown>> = []

const mockRef = (collection: string, id: string): any => ({
  id,
  get: async () => {
    const data = mockDocs[`${collection}/${id}`]
    return {
      id,
      exists: data != null,
      ref: mockRef(collection, id),
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, unknown>) => {
    mockDocs[`${collection}/${id}`] = { ...(mockDocs[`${collection}/${id}`] ?? {}), ...patch }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => {
  const firestore: any = () => ({
    collection: (collection: string) => ({ doc: (id: string) => mockRef(collection, id) }),
  })
  firestore.FieldValue = { serverTimestamp: () => 'ts' }
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
        firestore,
      }),
      firestore,
    },
    isImpersonationSession: () => mockImpersonating.value,
    emailUnverifiedResponse: () => Response.json({ error: 'Verify' }, { status: 403 }),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: async (_db: unknown, entry: Record<string, unknown>) => {
    mockAudit.push(entry)
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/admin/usage-level/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/usage-level', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  for (const key of Object.keys(mockDocs)) delete mockDocs[key]
  mockAudit.length = 0
  mockImpersonating.value = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', staff: true, email_verified: true })
  mockDocs['hosts/site-1'] = { orgId: 'org-1', usageLevel: 'unreviewed' }
  mockDocs['orgs/org-1'] = { ownerUid: 'owner-1', usageLevel: 'unreviewed' }
})

describe('who may set it', () => {
  it('refuses an account without the staff claim', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u', email_verified: true })
    expect((await post({ target: 'site', id: 'site-1', level: 'live' })).status).toBe(403)
    expect(mockDocs['hosts/site-1']['usageLevel']).toBe('unreviewed')
  })

  it('refuses staff signed in as a customer', async () => {
    mockImpersonating.value = true
    expect((await post({ target: 'site', id: 'site-1', level: 'live' })).status).toBe(403)
  })

  it('refuses a level that is not one', async () => {
    expect((await post({ target: 'site', id: 'site-1', level: 'real' })).status).toBe(400)
  })

  it('refuses an id that would address another collection', async () => {
    expect((await post({ target: 'org', id: 'org-1/members/x', level: 'live' })).status).toBe(400)
  })

  it('answers a workspace or site that does not exist with 404', async () => {
    expect((await post({ target: 'site', id: 'nope', level: 'live' })).status).toBe(404)
  })
})

describe('what it writes', () => {
  it('sets the level, who set it and when, and audits it', async () => {
    const response = await post({ target: 'site', id: 'site-1', level: 'live' })
    expect(response.status).toBe(200)
    expect(mockDocs['hosts/site-1']).toMatchObject({
      usageLevel: 'live',
      usageLevelBy: 'staff-1',
      usageLevelAt: 'ts',
    })
    expect(mockAudit).toEqual([
      expect.objectContaining({
        action: 'host.usageLevel',
        target: 'hosts/site-1',
        before: { usageLevel: 'unreviewed' },
        after: { usageLevel: 'live' },
      }),
    ])
  })

  it('sets an account that has no profile document yet', async () => {
    expect((await post({ target: 'user', id: 'new-uid', level: 'trying' })).status).toBe(200)
    expect(mockDocs['users/new-uid']['usageLevel']).toBe('trying')
  })

  it('carries a site to its workspace and the owner when asked', async () => {
    await post({ target: 'site', id: 'site-1', level: 'live', also: ['org', 'owner'] })
    expect(mockDocs['orgs/org-1']['usageLevel']).toBe('live')
    expect(mockDocs['users/owner-1']['usageLevel']).toBe('live')
    expect(mockAudit.map((entry) => entry['action'])).toEqual([
      'host.usageLevel',
      'org.usageLevel',
      'user.usageLevel',
    ])
  })

  it('a carry never lowers a higher level', async () => {
    mockDocs['orgs/org-1']['usageLevel'] = 'power'
    await post({ target: 'site', id: 'site-1', level: 'building', also: ['org'] })
    expect(mockDocs['hosts/site-1']['usageLevel']).toBe('building')
    expect(mockDocs['orgs/org-1']['usageLevel']).toBe('power')
  })

  it('the thing itself is always written, lower or not: that is the correction', async () => {
    mockDocs['orgs/org-1']['usageLevel'] = 'power'
    await post({ target: 'org', id: 'org-1', level: 'trying' })
    expect(mockDocs['orgs/org-1']['usageLevel']).toBe('trying')
  })
})
