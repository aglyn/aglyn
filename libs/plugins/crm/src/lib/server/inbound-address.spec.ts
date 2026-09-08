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
 * `crm/inbound-address` (AGL-2657): who may read the workspace's capture
 * address, who may rotate it, and that the answer is the token in the
 * deployment's domain. The token store is a spy — its transaction is
 * proved in the admin lib — so the claims here are about the gates and
 * the shape of the answer.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const HOST = 'site-1'
const ORG = 'org-1'
const TOKEN = 'k7m2p9q4r1s8t3u6v0w5x2y7z1a4b8c3'

let mockDecoded: Record<string, unknown> = { uid: 'u-1', email: 'ada@acme.test' }
let mockMember: Record<string, unknown> | null = { role: 'editor', allHosts: true }
let mockPermitted = true
let mockPermissions: Record<string, unknown> = {
  orgId: ORG,
  role: 'editor',
  isOwner: false,
  permissions: { 'data.manage': true },
  orgWide: true,
  hostRole: 'editor',
}
const mockVerifyIdToken = jest.fn(async () => mockDecoded)
const mockEnsure = jest.fn(async (_db: unknown, _orgId: string, options?: { rotate?: boolean }) =>
  options?.rotate
    ? { token: 'r'.repeat(32), createdAtMs: 1_000, rotatedAtMs: 2_000, rotated: true }
    : { token: TOKEN, createdAtMs: 1_000, rotated: false },
)
const mockLogOrgActivity = jest.fn(async () => undefined)
const firestoreHandle = { kind: 'firestore' }

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => mockPermissions,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => (mockVerifyIdToken as any)(...args) }),
      firestore: () => firestoreHandle,
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === HOST ? { orgId: ORG, org: { $id: ORG, plan: 'agency' } } : null,
  getOrgDoc: async (orgId: string) => (orgId === ORG ? { $id: ORG, plan: 'agency' } : null),
  resolveOrgMembership: async () => ({ member: mockMember }),
  memberHasOrgPermission: async () => mockPermitted,
  ensureCrmInboundToken: (...args: unknown[]) => (mockEnsure as any)(...args),
  logOrgActivity: (...args: unknown[]) => (mockLogOrgActivity as any)(...args),
}))

import {
  CRM_INBOUND_ADDRESS_ROUTE,
  CRM_INBOUND_ROTATE_REFUSAL,
  crmInboundAddressHandler,
} from './inbound-address'

async function call(body: unknown, options: { method?: string; token?: string | null } = {}) {
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
  await crmInboundAddressHandler(req, res)
  return { status, answer }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDecoded = { uid: 'u-1', email: 'ada@acme.test' }
  mockMember = { role: 'editor', allHosts: true }
  mockPermitted = true
  mockPermissions = {
    orgId: ORG,
    role: 'editor',
    isOwner: false,
    permissions: { 'data.manage': true },
    orgWide: true,
    hostRole: 'editor',
  }
  delete process.env['CRM_INBOUND_DOMAIN']
})

describe('crm/inbound-address', () => {
  it('is registered under the name the client posts to', () => {
    expect(CRM_INBOUND_ADDRESS_ROUTE).toBe('crm/inbound-address')
  })

  it('refuses anything but a POST, a body with no scope, and a caller with no token', async () => {
    expect((await call({ hostId: HOST }, { method: 'GET' })).status).toBe(405)
    expect((await call({})).status).toBe(400)
    expect((await call({ hostId: HOST }, { token: null })).status).toBe(401)
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('answers a site member holding data.manage with the address in the deployment’s domain', async () => {
    process.env['CRM_INBOUND_DOMAIN'] = 'in.example.com'
    const { status, answer } = await call({ hostId: HOST })
    expect(status).toBe(200)
    expect(answer).toEqual({
      ok: true,
      address: `crm+${TOKEN}@in.example.com`,
      createdAtMs: 1_000,
      rotated: false,
    })
    expect(mockEnsure).toHaveBeenCalledWith(firestoreHandle, ORG, { rotate: false })
    expect(mockLogOrgActivity).not.toHaveBeenCalled()
  })

  it('falls back to the platform domain when the deployment names none', async () => {
    const { answer } = await call({ hostId: HOST })
    expect(answer.address).toBe(`crm+${TOKEN}@in.aglyn.com`)
  })

  it('refuses a member without data.manage, and a scoped collaborator on another site', async () => {
    mockPermitted = false
    expect((await call({ hostId: HOST })).status).toBe(403)
    mockPermitted = true
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'site-9': 'editor' } }
    expect((await call({ hostId: HOST })).status).toBe(403)
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('refuses an unknown site', async () => {
    expect((await call({ hostId: 'site-none' })).status).toBe(404)
  })

  it('lets an editor read but not rotate; an owner rotates, and the feed says so', async () => {
    const refused = await call({ hostId: HOST, rotate: true })
    expect(refused.status).toBe(403)
    expect(refused.answer).toEqual({ error: CRM_INBOUND_ROTATE_REFUSAL })
    expect(mockEnsure).not.toHaveBeenCalled()

    mockMember = { role: 'owner' }
    const { status, answer } = await call({ hostId: HOST, rotate: true })
    expect(status).toBe(200)
    expect(answer).toEqual({
      ok: true,
      address: `crm+${'r'.repeat(32)}@in.aglyn.com`,
      createdAtMs: 1_000,
      rotatedAtMs: 2_000,
      rotated: true,
    })
    expect(mockEnsure).toHaveBeenCalledWith(firestoreHandle, ORG, { rotate: true })
    expect(mockLogOrgActivity).toHaveBeenCalledWith(
      ORG,
      { uid: 'u-1', email: 'ada@acme.test' },
      'Rotated the email capture address',
      { type: 'org' },
    )
  })

  it('admits staff to read and refuses them the rotation', async () => {
    mockDecoded = { uid: 'staff-1', email: 'staff@aglyn.com', staff: true }
    mockMember = null
    expect((await call({ hostId: HOST })).status).toBe(200)
    expect((await call({ hostId: HOST, rotate: true })).status).toBe(403)
  })

  describe('at the organization level', () => {
    it('answers an org-wide member holding data.manage, resolved by the org the body names', async () => {
      const { status, answer } = await call({ hostId: null, orgId: ORG })
      expect(status).toBe(200)
      expect(answer.address).toBe(`crm+${TOKEN}@in.aglyn.com`)
      expect(mockEnsure).toHaveBeenCalledWith(firestoreHandle, ORG, { rotate: false })
    })

    it('refuses a scoped collaborator, however permitted', async () => {
      mockPermissions = { ...mockPermissions, orgWide: false }
      expect((await call({ hostId: null, orgId: ORG })).status).toBe(403)
    })

    it('rotates for an owner and refuses an editor', async () => {
      expect((await call({ orgId: ORG, rotate: true })).status).toBe(403)
      mockPermissions = { ...mockPermissions, role: 'owner', isOwner: true }
      const { status, answer } = await call({ orgId: ORG, rotate: true })
      expect(status).toBe(200)
      expect(answer.rotated).toBe(true)
      expect(mockLogOrgActivity).toHaveBeenCalledTimes(1)
    })
  })
})
