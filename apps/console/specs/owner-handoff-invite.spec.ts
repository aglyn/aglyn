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
 * AGL-3466 — the invites route's owner handoff and staff stamping.
 *
 * The transaction behind acceptance is pinned against the real library in
 * `libs/tenant/data/admin/src/lib/server/owner-handoff.spec.ts`. This file
 * pins the DOOR: who may send a handoff, the one-pending rule, the seat
 * pre-flight that closes the free-manager loophole, the staff stamp on an
 * invite, and an acceptance that checks the SSO lockout first and then lands
 * the new owner on the org home like any other join.
 */

const mockVerifyIdToken = jest.fn()
const mockIsStaffAddress = jest.fn()
const mockOwnerHandoffSeatRefusal = jest.fn()
const mockManagerSeatRefusal = jest.fn()
const mockAcceptOwnerHandoff = jest.fn()
const mockLockout = jest.fn()
const mockLogOrgActivity = jest.fn()
const mockResolveOrgMembership = jest.fn()

type Doc = Record<string, unknown>
let mockStore = new Map<string, Doc>()

function mockSnapshot(path: string) {
  return {
    id: path.split('/').pop() as string,
    exists: mockStore.has(path),
    data: () => mockStore.get(path),
    get: (field: string) => (mockStore.get(path) ?? {})[field],
    ref: mockDoc(path),
  }
}
function mockQuery(prefix: string, filters: Array<[string, unknown]>): any {
  const run = async () => {
    const docs = [...mockStore.entries()]
      .filter(
        ([path, data]) =>
          path.startsWith(`${prefix}/`) &&
          !path.slice(prefix.length + 1).includes('/') &&
          filters.every(([field, value]) => (data[field] ?? null) === value),
      )
      .map(([path]) => mockSnapshot(path))
    return { empty: docs.length === 0, docs }
  }
  return {
    where: (field: string, _op: string, value: unknown) =>
      mockQuery(prefix, [...filters, [field, value]]),
    limit: () => mockQuery(prefix, filters),
    get: run,
  }
}
function mockDoc(path: string): any {
  return {
    path,
    get: async () => mockSnapshot(path),
    set: async (data: Doc, options?: { merge?: boolean }) => {
      const base = options?.merge ? { ...(mockStore.get(path) ?? {}) } : {}
      for (const [key, value] of Object.entries(data)) {
        if (value === '__delete__') delete base[key]
        else base[key] = value
      }
      mockStore.set(path, base)
    },
    delete: async () => {
      mockStore.delete(path)
    },
    collection: (name: string) => mockCollection(`${path}/${name}`),
  }
}
function mockCollection(prefix: string): any {
  return { ...mockQuery(prefix, []), doc: (id: string) => mockDoc(`${prefix}/${id}`) }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'NOW', delete: () => '__delete__' },
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
jest.mock('../app/api/_lib/sso-transfer-lockout', () => ({
  __esModule: true,
  assessOwnershipTransferLockout: (...args: unknown[]) => mockLockout(...args),
}))
jest.mock('@aglyn/tenant-data-admin/server/account-addresses', () => ({
  __esModule: true,
  attributableAccountForAddress: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  acceptOwnerHandoff: (...args: unknown[]) => mockAcceptOwnerHandoff(...args),
  collaboratorSeatRefusal: async () => null,
  collaboratorSeatRefusalResponse: () => null,
  consumeRateLimit: async () => ({ allowed: true }),
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  getOrgDoc: async () => mockStore.get('orgs/org-1'),
  isImpersonationSession: () => false,
  isStaffAddress: (...args: unknown[]) => mockIsStaffAddress(...args),
  lockdownRefusal: async () => null,
  logOrgActivity: (...args: unknown[]) => mockLogOrgActivity(...args),
  managerSeatRefusal: (...args: unknown[]) => mockManagerSeatRefusal(...args),
  managerSeatRefusalResponse: () => null,
  memberHasOrgPermission: async (_orgId: string, member?: { role?: string }) =>
    member?.role === 'owner' || member?.role === 'admin',
  meterOrgEmail: async () => undefined,
  notifyOrgAdmins: async () => undefined,
  notifyUsers: async () => undefined,
  orgOwnerSeatRefusalResponse: () => null,
  ownerHandoffRefusalResponse: () => null,
  ownerHandoffSeatRefusal: (...args: unknown[]) => mockOwnerHandoffSeatRefusal(...args),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
  upsertOrgMember: async () => {
    throw new Error('a handoff must not go through upsertOrgMember')
  },
  verifiedAccountEmails: async () => [],
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: (name: string) => mockCollection(name),
        batch: () => ({ update: () => undefined, commit: async () => undefined }),
      }),
    }),
  },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/console-routes'),
  createResourceUid: () => 'invite-new',
  resolveBrandingProfile: () => ({ productName: 'Aglyn', fromName: 'Aglyn' }),
  brandMergeTokens: () => ({}),
  resolveIdpDisplayName: () => 'Client',
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

const signedInAs = (uid: string, email: string, claims: Doc = {}) =>
  mockVerifyIdToken.mockResolvedValue({ uid, email, email_verified: true, ...claims })

const invites = () =>
  [...mockStore.entries()].filter(([path]) => path.startsWith('orgs/org-1/invites/'))

beforeEach(() => {
  jest.clearAllMocks()
  mockStore = new Map<string, Doc>([
    ['orgs/org-1', { name: 'Acme', slug: 'acme', ownerUid: 'owner' }],
    ['orgs/org-1/members/owner', { role: 'owner', email: 'owner@acme.test' }],
    ['orgs/org-1/members/admin', { role: 'admin', email: 'admin@acme.test' }],
  ])
  mockIsStaffAddress.mockResolvedValue(false)
  mockOwnerHandoffSeatRefusal.mockResolvedValue(null)
  mockManagerSeatRefusal.mockResolvedValue(null)
  mockLockout.mockResolvedValue({ refused: false, reason: null, verdict: 'allowed' })
  mockAcceptOwnerHandoff.mockResolvedValue({ previousOwnerUid: 'owner', previousOwner: 'stay' })
  mockResolveOrgMembership.mockImplementation(async (uid: string) => {
    const row = mockStore.get(`orgs/org-1/members/${uid}`)
    return row ? { orgId: 'org-1', member: { $id: uid, ...row } } : null
  })
})

describe('sending an owner handoff (AGL-3466)', () => {
  const handoff = (previousOwner: string) => ({
    action: 'create',
    email: 'client@acme.test',
    role: 'owner',
    handoff: { previousOwner },
  })

  it('the owner hands the workspace over: one invite, no seat reserved', async () => {
    signedInAs('owner', 'owner@acme.test')
    const response = await post(handoff('stay'))
    expect(response.status).toBe(200)
    expect(mockOwnerHandoffSeatRefusal).toHaveBeenCalledWith({
      orgId: 'org-1',
      email: 'client@acme.test',
      previousOwner: 'stay',
      inviteeStaff: false,
    })
    // The manager gate is not the question a handoff asks.
    expect(mockManagerSeatRefusal).not.toHaveBeenCalled()
    expect(mockStore.get('orgs/org-1/invites/invite-new')).toMatchObject({
      email: 'client@acme.test',
      role: 'owner',
      allHosts: true,
      hostAccess: {},
      handoff: { previousOwner: 'stay' },
      acceptedAt: null,
    })
  })

  it('staff may send one without being a member', async () => {
    signedInAs('staff', 'zed@aglyn.test', { staff: true })
    const response = await post(handoff('leave'))
    expect(response.status).toBe(200)
    expect(mockStore.get('orgs/org-1/invites/invite-new')).toMatchObject({
      handoff: { previousOwner: 'leave' },
    })
  })

  it('an admin may invite members but not give the workspace away', async () => {
    signedInAs('admin', 'admin@acme.test')
    const response = await post(handoff('stay'))
    expect(response.status).toBe(403)
    expect(invites()).toHaveLength(0)
  })

  it('refuses an owner invite with no stay/leave choice', async () => {
    signedInAs('owner', 'owner@acme.test')
    expect((await post({ ...handoff('stay'), handoff: undefined })).status).toBe(400)
    expect((await post(handoff('maybe'))).status).toBe(400)
    expect(invites()).toHaveLength(0)
  })

  it('refuses handing it to the address that already owns it', async () => {
    signedInAs('owner', 'owner@acme.test')
    const response = await post({ ...handoff('stay'), email: 'owner@acme.test' })
    expect(response.status).toBe(400)
  })

  it('THE LOOPHOLE: the pre-flight refusal is returned and nothing is written', async () => {
    signedInAs('owner', 'owner@acme.test')
    mockOwnerHandoffSeatRefusal.mockResolvedValue(
      Response.json(
        { error: 'Choose "Leave after the handoff"', code: 'owner_handoff_seat' },
        { status: 403 },
      ),
    )
    const response = await post(handoff('stay'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'owner_handoff_seat' })
    expect(invites()).toHaveLength(0)
  })

  it('one pending handoff per workspace: a new one replaces the old', async () => {
    mockStore.set('orgs/org-1/invites/old', {
      email: 'someone@else.test',
      role: 'owner',
      handoff: { previousOwner: 'stay' },
      acceptedAt: null,
    })
    signedInAs('owner', 'owner@acme.test')
    expect((await post(handoff('leave'))).status).toBe(200)
    expect(mockStore.has('orgs/org-1/invites/old')).toBe(false)
    expect(mockStore.has('orgs/org-1/invites/invite-new')).toBe(true)
  })

  it('re-sending an ordinary invite to a pending handoff’s address stops it being one', async () => {
    mockStore.set('orgs/org-1/invites/pending', {
      email: 'client@acme.test',
      role: 'owner',
      allHosts: true,
      handoff: { previousOwner: 'stay' },
      acceptedAt: null,
    })
    signedInAs('owner', 'owner@acme.test')
    const response = await post({
      action: 'create',
      email: 'client@acme.test',
      role: 'admin',
      allHosts: true,
    })
    expect(response.status).toBe(200)
    const row = mockStore.get('orgs/org-1/invites/pending') as Doc
    expect(row['role']).toBe('admin')
    expect(row['handoff']).toBeUndefined()
  })
})

describe('an invite to a staff address (AGL-3466)', () => {
  it('is stamped, and the manager pre-flight is told it takes no seat', async () => {
    mockIsStaffAddress.mockResolvedValue(true)
    signedInAs('owner', 'owner@acme.test')
    const response = await post({
      action: 'create',
      email: 'zed@aglyn.test',
      role: 'admin',
      allHosts: true,
    })
    expect(response.status).toBe(200)
    expect(mockManagerSeatRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ self: { staffSeat: true } }),
    )
    expect(mockStore.get('orgs/org-1/invites/invite-new')).toMatchObject({
      staffSeat: true,
    })
  })

  it('an ordinary address is not stamped', async () => {
    signedInAs('owner', 'owner@acme.test')
    await post({ action: 'create', email: 'client@acme.test', role: 'admin', allHosts: true })
    expect(mockStore.get('orgs/org-1/invites/invite-new')?.['staffSeat']).toBeUndefined()
  })
})

describe('accepting an owner handoff (AGL-3466)', () => {
  beforeEach(() => {
    mockStore.set('orgs/org-1/invites/handoff-1', {
      email: 'client@acme.test',
      role: 'owner',
      allHosts: true,
      handoff: { previousOwner: 'stay' },
      acceptedAt: null,
    })
    signedInAs('client', 'client@acme.test')
  })

  it('checks the SSO lockout first, then moves the workspace, and asks for no upgrade', async () => {
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(response.status).toBe(200)
    // The org home, like any join: no Billing destination, no plan.
    expect(await response.json()).toEqual({ ok: true, owner: true })
    expect(mockLockout).toHaveBeenCalledWith('org-1', 'client', expect.anything())
    expect(mockLockout.mock.invocationCallOrder[0]).toBeLessThan(
      mockAcceptOwnerHandoff.mock.invocationCallOrder[0],
    )
    expect(mockAcceptOwnerHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        inviteId: 'handoff-1',
        uid: 'client',
        email: 'client@acme.test',
      }),
    )
  })

  it('a lockout refusal answers 409, is logged, and moves nothing', async () => {
    mockLockout.mockResolvedValue({
      refused: true,
      reason: 'would strand',
      verdict: 'would-strand',
    })
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(response.status).toBe(409)
    expect(mockAcceptOwnerHandoff).not.toHaveBeenCalled()
    expect(mockLogOrgActivity).toHaveBeenCalled()
  })

  it('somebody else cannot accept it', async () => {
    signedInAs('intruder', 'intruder@evil.test')
    const response = await post({ action: 'accept', inviteId: 'handoff-1' })
    expect(response.status).toBe(403)
    expect(mockAcceptOwnerHandoff).not.toHaveBeenCalled()
  })
})
