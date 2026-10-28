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
 * `GET|PATCH /api/hosts/members/permissions` (AGL-4047): a site
 * collaborator's per-site keys, the platform's own door. Assertions are on
 * what it answered, what it handed the writer, and what it recorded.
 */

const mockVerifyIdToken = jest.fn()
const mockSetHostPermissionOverrides = jest.fn()
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockManagesMembers = jest.fn(() => false)
/** What the server resolves for the ACTOR on the site, beyond `manageMembers` (AGL-4047). */
let mockActorSiteKeys: Record<string, boolean> = {}
const mockPermissionEvents = jest.fn()
const mockRosterEvents = jest.fn()
/** Every document, keyed by path. */
let mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => {
        const doc = (path: string): any => ({
          get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
          collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
        })
        return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) }
      },
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { ownerUid: 'owner-1' } }),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
  setHostPermissionOverrides: (...args: unknown[]) => mockSetHostPermissionOverrides(...args),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: async () => ({ permissions: { manageMembers: mockManagesMembers(), ...mockActorSiteKeys } }),
}))

import { registerPluginEntitlements, registerPluginEventHandler, registerPluginPermissions } from '@aglyn/aglyn/server'
import { GET, PATCH } from '../app/api/hosts/members/permissions/route'

const SITE_ROLES = { admin: true, editor: true, author: false, viewer: false }

beforeAll(() => {
  registerPluginEntitlements({
    pluginId: 'reviews',
    orgPermissions: [
      {
        key: 'reviews.reply',
        label: 'Reply to reviews',
        description: 'x',
        roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
        hostRoleDefaults: SITE_ROLES,
      },
    ],
  })
  // A register-shaped plugin whose keys a site narrows (AGL-4047).
  registerPluginPermissions([
    {
      key: 'till.open',
      pluginId: 'acme-till',
      label: 'Open the till',
      defaults: { admin: true, editor: true, viewer: false },
      narrowsPerSite: true,
    },
    {
      key: 'till.sell',
      pluginId: 'acme-till',
      label: 'Sell at the till',
      defaults: { admin: true, editor: true, viewer: false },
      refines: 'till.open',
      narrowsPerSite: true,
    },
  ])
  registerPluginEventHandler('org.permissions.changed', (payload) => mockPermissionEvents(payload), {
    pluginId: 'reviews',
  })
  registerPluginEventHandler('host.member.permissions.changed', (payload) => mockRosterEvents(payload), {
    pluginId: 'reviews',
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  mockActorSiteKeys = {}
  mockVerifyIdToken.mockResolvedValue({ uid: 'admin-1', email: 'admin@example.test', email_verified: true })
  mockDocs = new Map<string, Record<string, unknown>>([
    ['hosts/host-1', { displayName: 'Shop', memberRoles: { 'admin-1': 'admin' } }],
    ['hosts/host-1/members/row-1', { uid: 'c1', email: 'pat@example.com', role: 'author' }],
    ['hosts/host-1/members/row-org', { uid: 'e1', email: 'jordan@example.com', role: 'editor' }],
    ['hosts/host-1/members/row-invited', { email: 'new@example.com', role: 'editor', status: 'invited' }],
    [
      'orgs/org-1/members/c1',
      { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'author' }, hostPermissions: { 'host-1': { 'reviews.reply': true } } },
    ],
    ['orgs/org-1/members/e1', { role: 'editor', allHosts: true }],
    // A workspace editor given Viewer access to this site (AGL-4047).
    ['hosts/host-1/members/row-narrowed', { uid: 'n1', email: 'casey@example.com', role: 'viewer' }],
    ['orgs/org-1/members/n1', { role: 'editor', allHosts: true, hostAccess: { 'host-1': 'viewer' } }],
    ['orgs/org-1/members/admin-1', { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'admin' } }],
  ])
  mockSetHostPermissionOverrides.mockResolvedValue({
    before: { 'reviews.reply': true },
    after: { 'reviews.reply': false },
  })
})

function get(memberId: string) {
  return GET(
    new Request(`https://app.aglyn.com/api/hosts/members/permissions?hostId=host-1&memberId=${memberId}`, {
      headers: { authorization: 'Bearer tok' },
    }),
  )
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new Request('https://app.aglyn.com/api/hosts/members/permissions', {
      method: 'PATCH',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ hostId: 'host-1', ...body }),
    }),
  )
}

describe('the per-site permissions door (AGL-4047)', () => {
  it('answers a collaborator’s site role, stored toggles, defaults and verdict', async () => {
    const response = await get('row-1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      orgWide: false,
      role: 'author',
      keys: ['reviews.reply'],
      stored: { 'reviews.reply': true },
      defaults: { 'reviews.reply': false },
      effective: { 'reviews.reply': true },
    })
  })

  it('refuses a reader who is neither a site admin nor manages people', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'stranger', email_verified: true })
    expect((await get('row-1')).status).toBe(403)
  })

  it('sets and clears toggles, and records each key and the verdict', async () => {
    const response = await patch({ memberId: 'row-1', permissions: { 'reviews.reply': false } })
    expect(response.status).toBe(200)
    expect(mockSetHostPermissionOverrides).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'c1',
      hostId: 'host-1',
      changes: { 'reviews.reply': false },
    })
    expect(mockLogHostActivity.mock.calls[0]?.[2]).toBe('Denied "Reply to reviews" for a member')
    expect(mockPermissionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'reviews.reply', granted: false, subject: expect.objectContaining({ type: 'host', id: 'host-1' }) }),
    )
    expect(mockRosterEvents).toHaveBeenCalledWith({
      orgId: 'org-1',
      hostId: 'host-1',
      memberId: 'row-1',
      uid: 'c1',
      permissions: { 'reviews.reply': false },
    })
  })

  it('refuses a key that is not per-site, a member across the workspace, and an invite', async () => {
    expect((await patch({ memberId: 'row-1', permissions: { 'billing.view': true } })).status).toBe(400)
    expect((await patch({ memberId: 'row-org', permissions: { 'reviews.reply': false } })).status).toBe(409)
    expect((await patch({ memberId: 'row-invited', permissions: { 'reviews.reply': false } })).status).toBe(409)
    expect(mockSetHostPermissionOverrides).not.toHaveBeenCalled()
  })

  it('lets nobody but staff change their own, or grant what they do not hold on the site', async () => {
    mockDocs.set('hosts/host-1/members/row-self', { uid: 'admin-1', email: 'admin@example.test', role: 'admin' })
    expect((await patch({ memberId: 'row-self', permissions: { 'reviews.reply': false } })).status).toBe(403)
    // The actor's own toggle on this site is off, so they cannot hand it out.
    mockDocs.set('orgs/org-1/members/admin-1', {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'admin' },
      hostPermissions: { 'host-1': { 'reviews.reply': false } },
    })
    const beyond = await patch({ memberId: 'row-1', permissions: { 'reviews.reply': true } })
    expect(beyond.status).toBe(403)
    expect((await beyond.json()).error).toMatch(/Reply to reviews/)
    expect(mockSetHostPermissionOverrides).not.toHaveBeenCalled()
  })

  describe('a workspace editor this site narrows (AGL-4047)', () => {
    it('answers the keys the site narrows, what the narrower access leaves, and the verdict', async () => {
      mockDocs.set('orgs/org-1/members/n1', {
        role: 'editor',
        allHosts: true,
        hostAccess: { 'host-1': 'viewer' },
        hostPermissions: { 'host-1': { 'till.sell': true } },
      })
      const response = await get('row-narrowed')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        orgWide: true,
        narrowed: true,
        role: 'viewer',
        keys: ['till.open', 'till.sell'],
        stored: { 'till.sell': true },
        defaults: { 'till.open': false, 'till.sell': false },
        effective: { 'till.open': true, 'till.sell': true },
      })
    })

    it('sets a key the site narrows, for an actor who holds it on the site', async () => {
      mockActorSiteKeys = { 'till.open': true, 'till.sell': true }
      mockSetHostPermissionOverrides.mockResolvedValue({
        before: { 'till.open': false, 'till.sell': false },
        after: { 'till.open': true, 'till.sell': true },
      })
      const response = await patch({ memberId: 'row-narrowed', permissions: { 'till.sell': true } })
      expect(response.status).toBe(200)
      expect(mockSetHostPermissionOverrides).toHaveBeenCalledWith({
        orgId: 'org-1',
        uid: 'n1',
        hostId: 'host-1',
        changes: { 'till.sell': true },
      })
      expect(mockLogHostActivity.mock.calls[0]?.[2]).toBe('Allowed "Sell at the till" for a member')
    })

    it('refuses a key the site does not narrow, and one the actor does not hold', async () => {
      mockActorSiteKeys = { 'till.open': false, 'till.sell': false }
      expect((await patch({ memberId: 'row-narrowed', permissions: { 'reviews.reply': true } })).status).toBe(400)
      const beyond = await patch({ memberId: 'row-narrowed', permissions: { 'till.sell': true } })
      expect(beyond.status).toBe(403)
      expect((await beyond.json()).error).toMatch(/Sell at the till/)
      expect(mockSetHostPermissionOverrides).not.toHaveBeenCalled()
    })

    it('still sends a workspace member this site does not narrow to the Team page', async () => {
      mockActorSiteKeys = { 'till.open': true, 'till.sell': true }
      expect((await patch({ memberId: 'row-org', permissions: { 'till.sell': true } })).status).toBe(409)
    })

    it('lists only the keys that follow the site role for them: their custom role keeps the till', async () => {
      mockDocs.set('orgs/org-1/roles/floor', { name: 'Floor', siteNarrowing: { 'till.open': false } })
      mockDocs.set('orgs/org-1/members/n1', {
        role: 'editor',
        allHosts: true,
        roleId: 'floor',
        hostAccess: { 'host-1': 'viewer' },
      })
      const body = await (await get('row-narrowed')).json()
      expect(body.narrowed).toBe(true)
      expect(body.keys).toEqual(['till.sell'])
      expect(body.effective).toEqual({ 'till.sell': false })
      mockActorSiteKeys = { 'till.open': true, 'till.sell': true }
      expect((await patch({ memberId: 'row-narrowed', permissions: { 'till.open': true } })).status).toBe(400)
    })

    it('sends them to the Team page when they keep every key a site can narrow', async () => {
      mockDocs.set('orgs/org-1/members/n1', {
        role: 'editor',
        allHosts: true,
        hostAccess: { 'host-1': 'viewer' },
        siteNarrowing: { 'till.open': false, 'till.sell': false },
      })
      expect((await (await get('row-narrowed')).json()).narrowed).toBeUndefined()
      mockActorSiteKeys = { 'till.open': true, 'till.sell': true }
      expect((await patch({ memberId: 'row-narrowed', permissions: { 'till.sell': true } })).status).toBe(409)
    })
  })
})
