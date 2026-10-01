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
 * The invitee's side of an invitation (AGL-3402).
 *
 * An account holder invited to a second workspace had no in-app trace of it:
 * `create` notified the org's admins only, and the banner that listed it
 * lived on a page nothing inside a workspace links to. And an unwanted
 * invitation could never be turned down, only withdrawn by the org.
 *
 * Pinned here: `create` notifies the one account that holds the address,
 * carrying the ids the console's accept/decline dialog opens on, and never an
 * account the address cannot be attributed to; `decline` answers only for
 * the addressee, deletes the row, and tells the admins.
 */

const mockVerifyIdToken = jest.fn()
const mockVerifiedAccountEmails = jest.fn()
const mockAttributable = jest.fn()
const mockNotifyUsers = jest.fn()
const mockNotifyOrgAdmins = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockInviteSet = jest.fn()
const mockInviteDelete = jest.fn()
const mockNotificationUpdate = jest.fn()

let mockInvite: Record<string, unknown> | null = null
let mockInviteNotifications: Array<{ ref: string }> = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW' },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: async () => ({ sent: false }),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('@aglyn/tenant-data-admin/server/account-addresses', () => ({
  __esModule: true,
  attributableAccountForAddress: (...args: unknown[]) => mockAttributable(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const invitesCollection = {
    doc: () => ({
      get: async () => ({
        exists: mockInvite !== null,
        data: () => mockInvite,
        get: (field: string) => mockInvite?.[field],
      }),
      set: (...args: unknown[]) => mockInviteSet(...args),
      delete: (...args: unknown[]) => mockInviteDelete(...args),
    }),
    where: () => ({
      where: () => ({
        limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
      }),
    }),
  }
  const notificationsCollection = {
    where: () => ({
      limit: () => ({
        get: async () => ({
          empty: mockInviteNotifications.length === 0,
          docs: mockInviteNotifications,
        }),
      }),
    }),
  }
  return {
    __esModule: true,
    consumeRateLimit: async () => ({ allowed: true }),
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    collaboratorSeatRefusal: async () => null,
    collaboratorSeatRefusalResponse: () => null,
    managerSeatRefusal: async () => null,
    managerSeatRefusalResponse: () => null,
    isImpersonationSession: () => false,
    lockdownRefusal: async () => null,
    logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
    memberHasOrgPermission: async (
      _orgId: string,
      member: { role?: string } | null | undefined,
    ) => member?.role === 'admin',
    meterOrgEmail: async () => undefined,
    notifyOrgAdmins: (...args: unknown[]) => mockNotifyOrgAdmins(...args),
    notifyUsers: (...args: unknown[]) => mockNotifyUsers(...args),
    getOrgDoc: async () => ({ slug: 'acme', name: 'Acme' }),
    upsertOrgMember: async () => undefined,
    verifiedAccountEmails: (...args: unknown[]) =>
      mockVerifiedAccountEmails(...args),
    // The admin inviting is a member; the invitee answering is not.
    resolveOrgMembership: async (uid: string) =>
      uid === 'admin-1' ? { member: { role: 'admin' } } : null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        }),
        firestore: () => ({
          batch: () => ({
            update: (...args: unknown[]) => mockNotificationUpdate(...args),
            commit: async () => undefined,
          }),
          collection: (name: string) => ({
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ name: 'Acme', slug: 'acme' }),
                get: (field: string) =>
                  ({ name: 'Acme', slug: 'acme' })[field as 'name' | 'slug'],
              }),
              collection: (sub: string) =>
                name === 'users' && sub === 'notifications'
                  ? notificationsCollection
                  : invitesCollection,
            }),
          }),
        }),
      }),
    },
  }
})

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/console-routes'),
  createResourceUid: () => 'invite-new',
  resolveBrandingProfile: () => ({ productName: 'Aglyn', fromName: 'Aglyn' }),
  brandMergeTokens: () => ({}),
  resolveIdpDisplayName: () => 'Ada',
  resolveIdpPhotoUrl: () => '',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

import { POST } from '../app/api/orgs/invites/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/invites', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

const signedInAs = (uid: string, email: string) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email, email_verified: true })

beforeEach(() => {
  jest.clearAllMocks()
  mockInvite = {
    email: 'ada@work.test',
    role: 'admin',
    allHosts: true,
    acceptedAt: null,
    invitedBy: 'admin-1',
  }
  mockInviteNotifications = []
  mockVerifiedAccountEmails.mockResolvedValue([])
  mockNotifyUsers.mockResolvedValue(undefined)
  mockNotifyOrgAdmins.mockResolvedValue(undefined)
  mockInviteSet.mockResolvedValue(undefined)
  mockInviteDelete.mockResolvedValue(undefined)
})

describe('create tells an invitee who already has an account', () => {
  beforeEach(() => signedInAs('admin-1', 'admin@acme.test'))

  it('notifies that account, with the ids the dialog opens on, and no email', async () => {
    mockAttributable.mockResolvedValue('user-ada')
    const response = await post({
      action: 'create',
      email: 'ada@work.test',
      role: 'admin',
      allHosts: true,
    })
    expect(response.status).toBe(200)
    expect(mockNotifyUsers).toHaveBeenCalledWith(
      ['user-ada'],
      expect.objectContaining({
        type: 'team.invite',
        orgId: 'org-1',
        inviteId: 'invite-new',
        title: "You've been invited to Acme",
      }),
      { skipEmail: true },
    )
    // The admins' notice says who invited whom, to which workspace (AGL-3432).
    // "Ada" is the signed-in admin's name as the mocked IdP resolver gives it.
    expect(mockNotifyOrgAdmins).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        type: 'team.invite',
        title: 'Invited ada@work.test to Acme',
        body: expect.stringMatching(/^Ada invited ada@work\.test to Acme as admin\. /),
      }),
    )
  })

  it('notifies nobody when the address belongs to no single account', async () => {
    // Null covers both "nobody" and "more than one": the workspace's name is
    // never shown to an account the address cannot be pinned to.
    mockAttributable.mockResolvedValue(null)
    const response = await post({
      action: 'create',
      email: 'ada@work.test',
      role: 'admin',
      allHosts: true,
    })
    expect(response.status).toBe(200)
    expect(mockNotifyUsers).not.toHaveBeenCalled()
  })

  it('still answers 200 when the lookup throws — the invite is already made', async () => {
    mockAttributable.mockRejectedValue(new Error('pool unavailable'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await post({
      action: 'create',
      email: 'ada@work.test',
      role: 'admin',
      allHosts: true,
    })
    error.mockRestore()
    expect(response.status).toBe(200)
    expect(mockInviteSet).toHaveBeenCalledTimes(1)
    expect(mockNotifyUsers).not.toHaveBeenCalled()
  })
})

describe('decline', () => {
  it('lets the addressee turn the invitation down', async () => {
    signedInAs('user-ada', 'ada@work.test')
    mockInviteNotifications = [{ ref: 'notification-1' }]
    const response = await post({ action: 'decline', inviteId: 'invite-1' })
    expect(response.status).toBe(200)
    // Asserted on the writes: a 200 that left the row in place would keep
    // the seat held and the banner showing.
    expect(mockInviteDelete).toHaveBeenCalledTimes(1)
    expect(mockNotifyOrgAdmins).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        type: 'team.invite',
        // The workspace is named: an admin of several cannot otherwise tell
        // which one was turned down (AGL-3432).
        title: 'ada@work.test declined the invitation to Acme',
        body:
          'ada@work.test declined the invitation to join Acme as admin. ' +
          'The invite was removed, so it no longer holds a seat.',
      }),
    )
    expect(mockLogOrgActivity).toHaveBeenCalledTimes(1)
    // The answered invitation leaves the bell's inbox.
    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      'notification-1',
      expect.objectContaining({ read: true }),
    )
  })

  it('answers for a confirmed secondary address, as accept does', async () => {
    signedInAs('user-ada', 'ada@personal.test')
    mockVerifiedAccountEmails.mockResolvedValue(['ada@work.test'])
    expect((await post({ action: 'decline', inviteId: 'invite-1' })).status).toBe(200)
    expect(mockInviteDelete).toHaveBeenCalledTimes(1)
  })

  it('refuses anyone the invitation is not addressed to', async () => {
    signedInAs('user-eve', 'eve@elsewhere.test')
    const response = await post({ action: 'decline', inviteId: 'invite-1' })
    expect(response.status).toBe(403)
    expect(mockInviteDelete).not.toHaveBeenCalled()
    expect(mockNotifyOrgAdmins).not.toHaveBeenCalled()
  })

  it('refuses an invitation already accepted', async () => {
    signedInAs('user-ada', 'ada@work.test')
    mockInvite = { ...mockInvite, acceptedAt: 'then' }
    expect((await post({ action: 'decline', inviteId: 'invite-1' })).status).toBe(409)
    expect(mockInviteDelete).not.toHaveBeenCalled()
  })

  it('404s an invitation that no longer exists', async () => {
    signedInAs('user-ada', 'ada@work.test')
    mockInvite = null
    expect((await post({ action: 'decline', inviteId: 'invite-1' })).status).toBe(404)
  })
})
