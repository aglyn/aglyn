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
const mockMergeContacts = jest.fn(async () => mockMergeResult)
const mockVerifyIdToken = jest.fn(async () => mockDecoded)

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => mockPermissions,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
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
    hostId === HOST ? { orgId: ORG, org: {} } : null,
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
  mockMergeContacts.mockClear()
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
