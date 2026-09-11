/**
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
 * `crm/next-activity` (AGL-2661): the door a client-direct task write uses.
 *
 * What has to hold: it is gated the way the task routes are — no token, no
 * write; the links are read off the body held to ids and handed to the
 * admin library's recompute; `all: true` runs the org sweep instead; and
 * the answer is counts, never a record.
 */

const verifyIdToken = jest.fn()
const getOrgForHost = jest.fn()
const resolveOrgMembership = jest.fn()
const memberHasOrgPermission = jest.fn()
const recomputeCrmNextTaskAt = jest.fn()
const sweepCrmNextTaskAt = jest.fn()
const resolveOrgPermissions = jest.fn()
const getOrgDoc = jest.fn()
const firestoreHandle = { collection: () => ({}) }

jest.mock('@aglyn/tenant-runtime', () => ({ __esModule: true, emitHostEvent: jest.fn() }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) => resolveOrgPermissions(...args),
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__serverTimestamp', delete: () => '__delete' },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: (...args: unknown[]) => getOrgForHost(...args),
  getOrgDoc: (...args: unknown[]) => getOrgDoc(...args),
  resolveOrgMembership: (...args: unknown[]) => resolveOrgMembership(...args),
  memberHasOrgPermission: (...args: unknown[]) => memberHasOrgPermission(...args),
  notifyUsers: jest.fn(),
  recomputeCrmNextTaskAt: (...args: unknown[]) => recomputeCrmNextTaskAt(...(args as [])),
  sweepCrmNextTaskAt: (...args: unknown[]) => sweepCrmNextTaskAt(...(args as [])),
  crmNextActivityLinksOf: (task: Record<string, unknown>) => task,
}))

import { crmNextActivityHandler } from './next-activity-routes'

const HOST_ID = 'site-1'
const ORG_ID = 'org-1'

async function call(options: { method?: string; body?: unknown; token?: string | null }) {
  const { method = 'POST', body, token = 'good-token' } = options
  let status = 0
  let payload: unknown
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      payload = value
    },
  }
  await crmNextActivityHandler(
    {
      method,
      query: {},
      body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cookies: {},
      socket: {},
    } as never,
    res as never,
  )
  return { status, body: payload as Record<string, unknown> }
}

beforeEach(() => {
  jest.clearAllMocks()
  verifyIdToken.mockImplementation(async (token: string) => {
    if (token !== 'good-token') throw new Error('bad token')
    return { uid: 'editor-uid' }
  })
  getOrgForHost.mockResolvedValue({ orgId: ORG_ID, org: { plan: 'starter' } })
  // The organization variant: an org-wide admin holding the permission, in an
  // org on Starter, the lowest plan carrying the CRM suite.
  resolveOrgPermissions.mockResolvedValue({
    orgId: ORG_ID,
    orgWide: true,
    role: 'admin',
    permissions: { 'data.manage': true },
  })
  getOrgDoc.mockImplementation(async (orgId: string) =>
    orgId === ORG_ID ? { $id: ORG_ID, plan: 'starter' } : null,
  )
  resolveOrgMembership.mockResolvedValue({ member: { role: 'editor', orgWide: true } })
  memberHasOrgPermission.mockResolvedValue(true)
  recomputeCrmNextTaskAt.mockResolvedValue({ records: 2, missing: 1 })
  sweepCrmNextTaskAt.mockResolvedValue({ tasks: 40, scheduled: 12, cleared: 3, truncated: false })
})

describe('crm/next-activity (AGL-2661)', () => {
  it('answers only POST, needs a scope, and refuses a caller with no token before touching anything', async () => {
    expect((await call({ method: 'GET' })).status).toBe(405)
    expect((await call({ body: { links: [{ dealId: 'd-1' }] } })).status).toBe(400)
    expect((await call({ body: { hostId: HOST_ID, links: [] }, token: null })).status).toBe(401)
    expect(recomputeCrmNextTaskAt).not.toHaveBeenCalled()
    expect(sweepCrmNextTaskAt).not.toHaveBeenCalled()
  })

  it('hands the links off the body to the recompute, held to ids, and answers with counts', async () => {
    const { status, body } = await call({
      body: {
        hostId: HOST_ID,
        links: [{ contactId: ' c-1 ', dealId: 'd-1', title: 'not a link' }, {}, { companyId: 'k-1' }],
      },
    })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, records: 2, missing: 1 })
    expect(recomputeCrmNextTaskAt).toHaveBeenCalledWith(firestoreHandle, ORG_ID, [
      { contactId: 'c-1', dealId: 'd-1' },
      { companyId: 'k-1' },
    ])
  })

  it('refuses a body with neither links nor all', async () => {
    expect((await call({ body: { hostId: HOST_ID } })).status).toBe(400)
    expect(recomputeCrmNextTaskAt).not.toHaveBeenCalled()
  })

  it('runs the organization sweep for all: true and reports what it read', async () => {
    const { status, body } = await call({ body: { hostId: HOST_ID, all: true } })
    expect(status).toBe(200)
    expect(sweepCrmNextTaskAt).toHaveBeenCalledWith(firestoreHandle, ORG_ID)
    expect(body).toEqual({ ok: true, records: 15, missing: 0, tasks: 40, cleared: 3, truncated: false })
  })
})

/**
 * THE PLAN (AGL-2787). The recompute is authorized as a task write is, so it
 * is refused as one is: once the caller is known, for a workspace whose plan
 * does not carry the CRM suite, staff included, at either level.
 */
describe('the plan (AGL-2787)', () => {
  const FREE_SITE = { orgId: ORG_ID, org: { plan: 'free' } }
  const expectRefused = ({ status, body }: { status: number; body: Record<string, unknown> }) => {
    expect(status).toBe(403)
    expect(body).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(body['error']).toMatch(/part of the CRM/)
    expect(body['error']).toMatch(/Included from Starter/)
  }

  it('refuses a Free workspace under a site, recomputing and sweeping nothing', async () => {
    getOrgForHost.mockResolvedValue(FREE_SITE)
    expectRefused(await call({ body: { hostId: HOST_ID, links: [{ dealId: 'd-1' }] } }))
    expectRefused(await call({ body: { hostId: HOST_ID, all: true } }))
    expect(recomputeCrmNextTaskAt).not.toHaveBeenCalled()
    expect(sweepCrmNextTaskAt).not.toHaveBeenCalled()
  })

  it('refuses staff acting inside a Free workspace the same way', async () => {
    getOrgForHost.mockResolvedValue(FREE_SITE)
    verifyIdToken.mockImplementation(async () => ({ uid: 'staff-uid', staff: true }))
    resolveOrgMembership.mockResolvedValue(null)
    expectRefused(await call({ body: { hostId: HOST_ID, links: [{ dealId: 'd-1' }] } }))
    expect(recomputeCrmNextTaskAt).not.toHaveBeenCalled()
  })

  it('refuses a Free workspace at the organization level', async () => {
    getOrgDoc.mockImplementation(async () => ({ $id: ORG_ID, plan: 'free' }))
    expectRefused(await call({ body: { orgId: ORG_ID, links: [{ dealId: 'd-1' }] } }))
    expectRefused(await call({ body: { orgId: ORG_ID, all: true } }))
    expect(recomputeCrmNextTaskAt).not.toHaveBeenCalled()
    expect(sweepCrmNextTaskAt).not.toHaveBeenCalled()
  })

  it('admits Starter, the lowest plan that carries the suite, at both levels', async () => {
    expect((await call({ body: { hostId: HOST_ID, links: [{ dealId: 'd-1' }] } })).status).toBe(200)
    expect((await call({ body: { orgId: ORG_ID, all: true } })).status).toBe(200)
    expect(recomputeCrmNextTaskAt).toHaveBeenCalledTimes(1)
    expect(sweepCrmNextTaskAt).toHaveBeenCalledWith(firestoreHandle, ORG_ID)
  })
})
