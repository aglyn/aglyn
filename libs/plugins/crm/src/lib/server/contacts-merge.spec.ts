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
 * The merge route (AGL-2625): org-wide `data.manage` only, the data
 * library's `mergeContacts` behind it with the caller and the site named,
 * and each of its refusals answered with the status the dialog branches on.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const HOST = 'h1'
const ORG = 'org1'
let mockDecoded: Record<string, unknown> = {
  uid: 'u-1',
  email: 'ada@acme.test',
  name: 'Ada',
}
let mockPermissions: Record<string, unknown> = {
  orgId: ORG,
  role: 'admin',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'admin',
}
let mockMergeResult: Record<string, unknown> = {
  ok: true,
  survivorId: 'c-keep',
  survivorEmail: 'jane@acme.com',
  mergedId: 'c-gone',
  mergedEmail: 'jane@gmail.com',
  emails: ['jane@acme.com', 'jane@gmail.com'],
  repointed: { deals: 1, tasks: 0, activities: 0, leads: 0 },
}
/** The org document both variants read; Starter is the lowest plan carrying the CRM suite. */
let mockOrg: Record<string, unknown> = { plan: 'starter' }
const mockMergeContacts = jest.fn(async () => mockMergeResult)
const mockVerifyIdToken = jest.fn(async () => mockDecoded)
const mockResolveOrgPermissions = jest.fn(async () => mockPermissions)
const mockLogOrgActivity = jest.fn(async () => undefined)

/** What the resolver double last answered: the membership the case describes. */
let mockLastMembership: any = null
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async (...args: unknown[]) =>
    (mockLastMembership = await (mockResolveOrgPermissions as any)(...args)),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  // `data.manage` is the permission catalog's answer (AGL-2843), read off the
  // membership the resolver double just answered, so a case states it once.
  resolveOrgMembership: async (uid: string, orgId: string) =>
    mockLastMembership?.orgId === orgId
      ? { orgId, member: { $id: uid, role: mockLastMembership.role } }
      : null,
  memberHasOrgPermission: async (_orgId: string, _member: unknown, permission: string) =>
    mockLastMembership?.permissions?.[permission] === true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({ path: `${name}/${id}` }),
        }),
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === HOST ? { orgId: ORG, org: mockOrg } : null,
  getOrgDoc: async (orgId: string) => (orgId === ORG ? { $id: ORG, ...mockOrg } : null),
  logOrgActivity: (...args: unknown[]) => (mockLogOrgActivity as any)(...args),
  mergeContacts: (...args: unknown[]) => (mockMergeContacts as any)(...args),
}))

import { CONTACTS_MERGE_ROUTE, contactsMergeHandler } from './contacts-merge'

async function call(
  body: unknown,
  options: { method?: string; token?: string | null } = {},
) {
  const { method = 'POST', token = 'token' } = options
  let status = 0
  let answer: any
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (value: unknown) => {
      answer = value
    },
    setHeader: () => undefined,
    send: () => undefined,
  } as unknown as PluginApiResponse
  const req = {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query: {},
  } as unknown as PluginApiRequest
  await contactsMergeHandler(req, res)
  return { status, answer }
}

const good = { hostId: HOST, survivorId: 'c-keep', mergedId: 'c-gone' }

beforeEach(() => {
  mockDecoded = { uid: 'u-1', email: 'ada@acme.test', name: 'Ada' }
  mockPermissions = {
    orgId: ORG,
    role: 'admin',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'admin',
  }
  mockMergeResult = {
    ok: true,
    survivorId: 'c-keep',
    survivorEmail: 'jane@acme.com',
    mergedId: 'c-gone',
    mergedEmail: 'jane@gmail.com',
    emails: ['jane@acme.com', 'jane@gmail.com'],
    repointed: { deals: 1, tasks: 0, activities: 0, leads: 0 },
  }
  mockOrg = { plan: 'starter' }
  mockMergeContacts.mockClear()
  mockResolveOrgPermissions.mockClear()
  mockLogOrgActivity.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('crm/contacts-merge', () => {
  it('is registered under the name the client posts to', () => {
    expect(CONTACTS_MERGE_ROUTE).toBe('crm/contacts-merge')
  })

  it('merges through the data library with the caller and the site named', async () => {
    const { status, answer } = await call(good)
    expect(status).toBe(200)
    expect(answer).toEqual(mockMergeResult)
    expect(mockMergeContacts).toHaveBeenCalledTimes(1)
    const options = (mockMergeContacts.mock.calls[0] as unknown[])[0] as Record<string, any>
    expect(options).toMatchObject({
      survivorId: 'c-keep',
      mergedId: 'c-gone',
      hostId: HOST,
      actor: { uid: 'u-1', email: 'ada@acme.test' },
      actorName: 'Ada',
    })
    expect(options.orgRef.path).toBe(`orgs/${ORG}`)
  })

  it('refuses a site-scoped member, and an org-wide one without data.manage', async () => {
    mockPermissions = { ...mockPermissions, orgWide: false, hostRole: 'admin' }
    expect((await call(good)).status).toBe(403)
    mockPermissions = { ...mockPermissions, orgWide: true, permissions: { 'data.manage': false } }
    expect((await call(good)).status).toBe(403)
    expect(mockMergeContacts).not.toHaveBeenCalled()
  })

  it('admits staff whatever the roster says', async () => {
    mockDecoded = { ...mockDecoded, staff: true }
    mockPermissions = { ...mockPermissions, orgWide: false, permissions: {} }
    expect((await call(good)).status).toBe(200)
  })

  it('answers the shape refusals before reading anything', async () => {
    expect((await call(good, { method: 'GET' })).status).toBe(405)
    expect((await call({ hostId: HOST, survivorId: 'c-keep' })).status).toBe(400)
    expect(
      (await call({ hostId: HOST, survivorId: 'c-keep', mergedId: 'c-keep' })).status,
    ).toBe(400)
    expect((await call(good, { token: null })).status).toBe(401)
    expect((await call({ ...good, hostId: 'nope' })).status).toBe(404)
    expect(mockMergeContacts).not.toHaveBeenCalled()
  })

  it('maps a missing record to 404 and names which one', async () => {
    mockMergeResult = { ok: false, reason: 'merged-missing' }
    const gone = await call(good)
    expect(gone.status).toBe(404)
    expect(gone.answer.error).toMatch(/merge could not be found/)
    mockMergeResult = { ok: false, reason: 'survivor-missing' }
    const keep = await call(good)
    expect(keep.status).toBe(404)
    expect(keep.answer.error).toMatch(/keep could not be found/)
  })

  it('answers 500 with a sentence when the merge throws', async () => {
    mockMergeContacts.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const { status, answer } = await call(good)
    expect(status).toBe(500)
    expect(answer.error).toBe('The contacts could not be merged.')
  })
})

/**
 * THE ORGANIZATION VARIANT (AGL-2634): the org named in the body is what the
 * caller is authorized against, a site beside it is only where the data
 * library files the note, and the act lands in the org's feed.
 */
describe('crm/contacts-merge at the organization level', () => {
  const org = { orgId: ORG, survivorId: 'c-keep', mergedId: 'c-gone' }

  it('merges a record no site captured, authorized by the org, and logs the org line', async () => {
    const { status, answer } = await call(org)
    expect(status).toBe(200)
    expect(answer).toEqual(mockMergeResult)
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith('u-1', { orgId: ORG })
    const options = (mockMergeContacts.mock.calls[0] as unknown[])[0] as Record<string, any>
    expect(options).toMatchObject({ hostId: null, actorName: 'Ada' })
    expect(options.orgRef.path).toBe(`orgs/${ORG}`)
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: 'u-1', email: 'ada@acme.test' },
      'Merged with jane@gmail.com',
      { type: 'contact', id: 'c-keep', name: 'jane@acme.com' },
    )
  })

  it('hands the record’s own site to the data library when the body names one', async () => {
    await call({ ...org, hostId: HOST })
    const options = (mockMergeContacts.mock.calls[0] as unknown[])[0] as Record<string, any>
    expect(options.hostId).toBe(HOST)
    // Authorized by the org, not resolved through the site.
    expect(mockResolveOrgPermissions).toHaveBeenCalledWith('u-1', { orgId: ORG })
  })

  it('refuses a site-scoped member at the org level, and writes no line on a refusal', async () => {
    mockPermissions = { ...mockPermissions, orgWide: false, hostRole: 'admin' }
    expect((await call(org)).status).toBe(403)
    expect(mockMergeContacts).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('writes no org line when the merge itself was refused', async () => {
    mockMergeResult = { ok: false, reason: 'merged-missing' }
    expect((await call(org)).status).toBe(404)
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('writes no org line under a site — the site variant’s feed is the site’s', async () => {
    await call(good)
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })
})

/**
 * THE PLAN (AGL-2787). Merging is the CRM suite's, included from Starter, at
 * either level. It is asked once the caller is admitted, and of the
 * workspace, so staff merging inside a Free one are refused as a member is.
 */
describe('the plan (AGL-2787)', () => {
  const orgLevel = { orgId: ORG, survivorId: 'c-keep', mergedId: 'c-gone' }
  const expectRefused = ({ status, answer }: { status: number; answer: any }) => {
    expect(status).toBe(403)
    expect(answer).toMatchObject({ reason: 'plan_required', code: 'crm' })
    expect(answer.error).toMatch(/part of the CRM suite/)
    expect(answer.error).toMatch(/Included from Starter/)
  }

  it('refuses a Free workspace under a site, merging nothing', async () => {
    mockOrg = { plan: 'free' }
    expectRefused(await call(good))
    expect(mockMergeContacts).not.toHaveBeenCalled()
  })

  it('refuses a Free workspace at the organization level, writing no org line', async () => {
    mockOrg = { plan: 'free' }
    expectRefused(await call(orgLevel))
    expect(mockMergeContacts).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('refuses staff merging inside a Free workspace the same way, at either level', async () => {
    mockOrg = { plan: 'free' }
    mockDecoded = { ...mockDecoded, staff: true }
    mockPermissions = { ...mockPermissions, orgWide: false, permissions: {} }
    expectRefused(await call(good))
    expectRefused(await call(orgLevel))
    expect(mockMergeContacts).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('tells a site-scoped member about the permission, not the plan', async () => {
    mockOrg = { plan: 'free' }
    mockPermissions = { ...mockPermissions, orgWide: false }
    const { status, answer } = await call(good)
    expect(status).toBe(403)
    expect(answer).toEqual({
      error: 'Merging contacts requires the data permission across the whole workspace',
    })
  })

  it('admits Starter, the lowest plan that carries the suite, at both levels', async () => {
    mockOrg = { plan: 'starter' }
    expect((await call(good)).status).toBe(200)
    expect((await call(orgLevel)).status).toBe(200)
    expect(mockMergeContacts).toHaveBeenCalledTimes(2)
  })
})
