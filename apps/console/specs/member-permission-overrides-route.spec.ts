/**
 * @jest-environment node
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
 * `POST /api/orgs/members { action: 'permissions' }` (AGL-4047): a member's
 * own overrides, set and cleared. Gated on `members.manage` like every
 * roster write; the owner keeps every permission, nobody but staff changes
 * their own, and a grant beyond the actor's own is refused.
 */

const mockVerifyIdToken = jest.fn()
const mockSetOverrides = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockManages = jest.fn(async () => true)
const mockPluginVerdicts = jest.fn()
const mockPermissionEvents = jest.fn()
let mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => {
        const doc = (path: string): any => ({
          get: async () => ({
            exists: mockDocs.has(path),
            data: () => mockDocs.get(path),
            get: (field: string) => mockDocs.get(path)?.[field],
          }),
          collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
        })
        return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) }
      },
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  getOrgDoc: async () => null,
  lockdownRefusal: async () => null,
  logOrgActivity: (...a: unknown[]) => mockLogOrgActivity(...a),
  memberHasOrgPermission: () => mockManages(),
  resolveOrgMembership: async (uid: string, orgId: string) => {
    const member = mockDocs.get(`orgs/${orgId}/members/${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  resolveMemberOrgPermissions: async (_orgId: string, member: unknown) =>
    jest.requireActual('@aglyn/aglyn/app-utils/org-permissions').resolveOrgPermissions(member, null),
  resolveMemberPluginPermissionsOnOrg: (...a: unknown[]) => mockPluginVerdicts(...a),
  setMemberPermissionOverrides: (...a: unknown[]) => mockSetOverrides(...a),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: jest.fn(),
}))

import { registerPluginEventHandler, registerPluginPermissions } from '@aglyn/aglyn/server'
import { POST } from '../app/api/orgs/members/route'

beforeAll(() => {
  registerPluginPermissions([
    {
      key: 'managePos',
      pluginId: 'commerce',
      label: 'Use the point of sale',
      defaults: { admin: true, editor: true, viewer: false },
      narrowsPerSite: true,
    },
  ])
  registerPluginEventHandler('org.permissions.changed', (payload) => mockPermissionEvents(payload), {
    pluginId: 'commerce',
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin-1', email: 'admin@example.test', email_verified: true })
  mockDocs = new Map<string, Record<string, unknown>>([
    ['orgs/org-1', { ownerUid: 'owner-1', name: 'Acme Builders' }],
    ['orgs/org-1/members/owner-1', { role: 'owner', allHosts: true }],
    ['orgs/org-1/members/admin-1', { role: 'admin', allHosts: true, permissions: { 'billing.manage': false } }],
    ['orgs/org-1/members/viewer-1', { role: 'viewer', allHosts: true, displayName: 'Pat Lee' }],
  ])
  mockSetOverrides.mockResolvedValue({ before: {}, after: { managePos: true } })
  mockPluginVerdicts.mockResolvedValueOnce({ managePos: false }).mockResolvedValueOnce({ managePos: true })
})

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://app.aglyn.com/api/orgs/members', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', action: 'permissions', ...body }),
    }),
  )
}

describe('per-member permission overrides (AGL-4047)', () => {
  it('sets a plugin key and clears a core one, records each, and raises the moved key', async () => {
    const response = await post({ uid: 'viewer-1', permissions: { managePos: true, 'billing.view': null } })
    expect(response.status).toBe(200)
    expect(mockSetOverrides).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'viewer-1',
      changes: { managePos: true, 'billing.view': null },
      narrowing: {},
    })
    expect(mockLogOrgActivity.mock.calls.map((call) => call[2])).toEqual([
      'Allowed "Use the point of sale" for Pat Lee',
      `Reset Pat Lee's "View billing" to their role`,
    ])
    expect(mockPermissionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'managePos', granted: true, subject: expect.objectContaining({ id: 'viewer-1' }) }),
    )
  })

  it('needs members.manage', async () => {
    mockManages.mockResolvedValueOnce(false)
    expect((await post({ uid: 'viewer-1', permissions: { managePos: true } })).status).toBe(403)
    expect(mockSetOverrides).not.toHaveBeenCalled()
  })

  it('refuses the owner, oneself, an unknown key and a grant beyond the actor’s own', async () => {
    expect((await post({ uid: 'owner-1', permissions: { managePos: false } })).status).toBe(400)
    expect((await post({ uid: 'admin-1', permissions: { managePos: false } })).status).toBe(403)
    expect((await post({ uid: 'viewer-1', permissions: { 'no.such': true } })).status).toBe(400)
    const beyond = await post({ uid: 'viewer-1', permissions: { 'billing.manage': true } })
    expect(beyond.status).toBe(403)
    expect((await beyond.json()).error).toMatch(/Manage billing/)
    expect((await post({ uid: 'nobody', permissions: { managePos: true } })).status).toBe(404)
    expect(mockSetOverrides).not.toHaveBeenCalled()
  })

  it('lets staff grant what they do not hold', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    expect((await post({ uid: 'viewer-1', permissions: { 'billing.manage': true } })).status).toBe(200)
  })
})

describe('whether a key follows a narrower site role, per member (AGL-4047)', () => {
  beforeEach(() => {
    mockSetOverrides.mockResolvedValue({ before: {}, after: {}, siteNarrowing: { managePos: false } })
    mockDocs.set('orgs/org-1/members/editor-1', { role: 'editor', allHosts: true, displayName: 'Jordan Lee' })
  })

  it('keeps, follows and resets a key, records each, and answers the resolved choices', async () => {
    const response = await post({ uid: 'editor-1', siteNarrowing: { managePos: false } })
    expect(response.status).toBe(200)
    expect(mockSetOverrides).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'editor-1',
      changes: {},
      narrowing: { managePos: false },
    })
    expect((await response.json()).siteNarrowing).toEqual({ managePos: false })
    await post({ uid: 'editor-1', siteNarrowing: { managePos: true } })
    await post({ uid: 'editor-1', siteNarrowing: { managePos: null } })
    expect(mockLogOrgActivity.mock.calls.map((call) => call[2])).toEqual([
      'Jordan Lee keeps "Use the point of sale" on sites where their role is narrower',
      '"Use the point of sale" follows the site role for Jordan Lee on sites where their role is narrower',
      `Reset whether Jordan Lee's "Use the point of sale" follows a narrower site role to their role`,
    ])
  })

  it('sets a permission and a narrowing choice in one save', async () => {
    expect(
      (await post({ uid: 'editor-1', permissions: { 'billing.view': true }, siteNarrowing: { managePos: true } })).status,
    ).toBe(200)
    expect(mockSetOverrides).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'editor-1',
      changes: { 'billing.view': true },
      narrowing: { managePos: true },
    })
  })

  it('refuses a key no site can narrow, an empty save, and keeping a key the actor does not hold', async () => {
    expect((await post({ uid: 'editor-1', siteNarrowing: { 'billing.view': false } })).status).toBe(400)
    expect((await post({ uid: 'editor-1' })).status).toBe(400)
    // The actor's own custom layer takes the register from them.
    mockDocs.set('orgs/org-1/members/admin-1', { role: 'admin', allHosts: true, permissions: { managePos: false } })
    const keep = await post({ uid: 'editor-1', siteNarrowing: { managePos: false } })
    expect(keep.status).toBe(403)
    expect((await keep.json()).error).toMatch(/Use the point of sale/)
    // Following the site role takes access away, which needs no grant.
    expect((await post({ uid: 'editor-1', siteNarrowing: { managePos: true } })).status).toBe(200)
    expect(mockSetOverrides).toHaveBeenCalledTimes(1)
  })
})
