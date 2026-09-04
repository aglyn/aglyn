/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * AGL-2464 — `/api/orgs/invites` must gate on `members.manage`, not on the
 * built-in role tier.
 *
 * The route asked `canManageOrg(actor?.member.role)`, which is
 * `orgRoleAtLeast(role, 'admin')` and nothing else: it never reads
 * `orgs/{orgId}/roles/{roleId}` and never applies `member.permissions`. That
 * one boolean gated the pending-invite list, `create`, `revoke` and `resend`.
 *
 * It is wrong in BOTH directions, and the specs below drive both:
 *
 * * A permission the customer GRANTED is refused — an editor handed
 *   `members.manage` through a custom role can add and remove members at
 *   `/api/orgs/members` and cannot invite one, which is the normal way to add
 *   somebody.
 * * A permission the customer REVOKED still works — an admin whose
 *   `members.manage` was cleared by a per-member override is refused at
 *   `/api/orgs/members` and could still invite, revoke and resend here. That
 *   is the launch-blocking half: `members.manage` is effectively the root
 *   permission, because a holder can edit a custom role's permission map and
 *   assign it, so an override meant to take it away did not.
 *
 * The sibling `/api/orgs/members` already resolves this correctly through
 * `memberHasOrgPermission`, which layers role defaults → custom role →
 * per-member overrides. This route now asks the same resolver.
 */

import {
  hasOrgPermission as realHasOrgPermission,
  type AglynOrgCustomRole,
} from '@aglyn/aglyn'

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockInviteSet = jest.fn()
const mockInviteDelete = jest.fn()
const mockSendEmail = jest.fn()
const mockPendingInvites = jest.fn()
const mockInviteGet = jest.fn()
const mockListInvites = jest.fn()

/**
 * `orgs/{orgId}/roles/{roleId}` — the collection `canManageOrg` never read.
 * Keyed `orgId/roleId` so a member pointing at a role in another org gets
 * nothing, which is the real lookup's behaviour.
 */
const customRoles = new Map<string, AglynOrgCustomRole>()

/**
 * A `memberHasOrgPermission` double that MODELS THE REAL LAYERING.
 *
 * It delegates to the same exported `hasOrgPermission` production resolves
 * through, with the custom role fetched from the store above — so role
 * defaults, the custom role's map and the per-member overrides all decide
 * the answer. A double that returned a constant would make every assertion
 * below pass against the broken route as easily as the fixed one.
 */
const memberHasOrgPermissionDouble = async (
  orgId: string,
  member: { roleId?: string; [key: string]: unknown } | null | undefined,
  permission: string,
) => {
  if (!member) return false
  const customRole = member.roleId
    ? (customRoles.get(`${orgId}/${member.roleId}`) ?? null)
    : null
  return realHasOrgPermission(member as never, permission as never, customRole)
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: Date.now() + 3_600_000,
    degraded: false,
  }),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  collaboratorSeatRefusal: async () => null,
  collaboratorSeatRefusalResponse: () => null,
  /*
   * The manager-seat gate moved into `upsertOrgMember`'s transaction, and
   * the create door kept a pre-flight (AGL-2068 on the manager key). Both
   * helpers are added here for the reason the collaborator pair above is:
   * a closed-world mock that omits one dies on "is not a function" before
   * asserting anything.
   *
   * `null` is the REAL semantics and the load-bearing part — the refusal
   * arrives only for a `ManagerSeatLimitError`. A mock returning a Response
   * would turn every error in this file into a seat refusal.
   */
  managerSeatRefusal: async () => null,
  managerSeatRefusalResponse: () => null,
  memberHasOrgPermission: (...args: unknown[]) =>
    (memberHasOrgPermissionDouble as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ name: 'Acme', slug: 'acme', plan: 'free' }),
              get: (field: string) =>
                ({ name: 'Acme', slug: 'acme' })[field as 'name' | 'slug'],
            }),
            collection: (name: string) =>
              name === 'invites'
                ? {
                    where: () => ({
                      where: () => ({
                        limit: () => ({ get: () => mockPendingInvites() }),
                        get: () => mockListInvites(),
                      }),
                      limit: () => ({ get: () => mockListInvites() }),
                      get: () => mockPendingInvites(),
                    }),
                    doc: () => ({
                      set: (...args: unknown[]) => mockInviteSet(...args),
                      get: () => mockInviteGet(),
                      delete: (...args: unknown[]) => mockInviteDelete(...args),
                    }),
                  }
                : { get: async () => ({ docs: [] }) },
          }),
        }),
      }),
    }),
  },
  getOrgDoc: async () => ({ id: 'org-1', name: 'Acme' }),
  isImpersonationSession: () => false,
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  logOrgActivity: jest.fn(async () => undefined),
  meterOrgEmail: jest.fn(async () => undefined),
  notifyOrgAdmins: jest.fn(async () => undefined),
  resolveOrgMembership: (...args: unknown[]) =>
    mockResolveOrgMembership(...args),
  upsertOrgMember: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    body:
      request.method === 'GET' ? {} : await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
  buildRoute: () => '/',
  Route: {},
  /*
   * The tier answer, unchanged and DELIBERATELY generous: every actor in
   * this file that the old gate would have admitted, it still admits. If the
   * route were still consulting this, the revoked-override cases below would
   * be 200s — which is exactly the red they assert against.
   */
  canManageOrg: (role: string) => role === 'owner' || role === 'admin',
  checkSeatQuota: () => ({ allowed: true, limit: 99 }),
  countManagerSeats: () => 0,
  createResourceUid: () => 'invite-new',
  isOrgRole: (role: unknown) =>
    role === 'admin' || role === 'editor' || role === 'viewer',
  isOrgWideMember: ({ role, allHosts }: { role: string; allHosts: boolean }) =>
    allHosts === true || role === 'admin',
  resolveBrandingProfile: () => ({
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  }),
  brandMergeTokens: (branding: Record<string, string>) => ({
    'brand.productName': branding.productName,
  }),
  resolveIdpDisplayName: () => 'Admin Person',
  resolveIdpPhotoUrl: () => null,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'ts' },
}))

import { GET, POST } from '../app/api/orgs/invites/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/invites', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ orgId: 'org-1', ...body }),
    }),
  )

const list = () =>
  GET(
    new Request('https://app.aglyn.com/api/orgs/invites?orgId=org-1', {
      method: 'GET',
      headers: { authorization: 'Bearer tok' },
    }),
  )

const createInvite = {
  action: 'create',
  email: 'new@example.com',
  role: 'viewer',
  allHosts: false,
  hostAccess: {},
}

/** An admin whose `members.manage` a per-member override CLEARED. */
const OVERRIDDEN_ADMIN = {
  $id: 'u-admin',
  role: 'admin',
  permissions: { 'members.manage': false },
}

/** An editor a CUSTOM ROLE handed `members.manage`. */
const CUSTOM_ROLE_EDITOR = {
  $id: 'u-editor',
  role: 'editor',
  roleId: 'team-lead',
}

beforeEach(() => {
  jest.clearAllMocks()
  customRoles.clear()
  customRoles.set('org-1/team-lead', {
    name: 'Team lead',
    permissions: { 'members.manage': true },
  })
  mockLockdownRefusal.mockResolvedValue(null)
  mockResolveOrgMembership.mockResolvedValue({
    member: { $id: 'u-admin', role: 'admin' },
  })
  mockPendingInvites.mockResolvedValue({ empty: true, docs: [] })
  mockListInvites.mockResolvedValue({ docs: [] })
  mockInviteSet.mockResolvedValue(undefined)
  mockInviteDelete.mockResolvedValue(undefined)
  mockSendEmail.mockResolvedValue({ sent: true })
  mockInviteGet.mockResolvedValue({
    exists: true,
    data: () => ({
      email: 'someone@example.com',
      role: 'viewer',
      acceptedAt: null,
    }),
  })
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-admin',
    email: 'admin@acme.test',
    email_verified: true,
  })
})

describe('AGL-2464 · the double really layers (anti-vacuity)', () => {
  it('answers differently for the three actors this file uses', async () => {
    // If this ever collapses to one answer, every assertion below is
    // decorative: the route would be gating on a constant.
    await expect(
      memberHasOrgPermissionDouble(
        'org-1',
        { role: 'admin' } as never,
        'members.manage',
      ),
    ).resolves.toBe(true)
    await expect(
      memberHasOrgPermissionDouble('org-1', OVERRIDDEN_ADMIN, 'members.manage'),
    ).resolves.toBe(false)
    await expect(
      memberHasOrgPermissionDouble(
        'org-1',
        CUSTOM_ROLE_EDITOR,
        'members.manage',
      ),
    ).resolves.toBe(true)
    // And the editor's tier alone does NOT grant it — so the grant case
    // below is testing the custom role, not the base role.
    await expect(
      memberHasOrgPermissionDouble(
        'org-1',
        { role: 'editor' } as never,
        'members.manage',
      ),
    ).resolves.toBe(false)
  })
})

describe('AGL-2464 · a REVOKED permission stops working', () => {
  beforeEach(() => {
    mockResolveOrgMembership.mockResolvedValue({ member: OVERRIDDEN_ADMIN })
  })

  it('REFUSES `create` — no invite row, no email', async () => {
    const response = await post(createInvite)
    expect(response.status).toBe(403)
    expect(mockInviteSet).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('REFUSES `revoke` — the invite is not deleted', async () => {
    const response = await post({ action: 'revoke', inviteId: 'inv-1' })
    expect(response.status).toBe(403)
    expect(mockInviteDelete).not.toHaveBeenCalled()
  })

  it('REFUSES `resend` — nothing leaves the sending domain', async () => {
    const response = await post({ action: 'resend', inviteId: 'inv-1' })
    expect(response.status).toBe(403)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('REFUSES the pending-invite list — the roster is not readable either', async () => {
    const response = await list()
    expect(response.status).toBe(403)
  })

  it('names the PERMISSION, matching /api/orgs/members', async () => {
    // "requires the admin role" is a lie once the tier is not the gate — the
    // holder IS an admin. `/api/orgs/members` says `members.manage`.
    const response = await post(createInvite)
    expect((await response.json()).error).toContain('members.manage')
  })
})

describe('AGL-2464 · a GRANTED permission starts working', () => {
  beforeEach(() => {
    mockResolveOrgMembership.mockResolvedValue({ member: CUSTOM_ROLE_EDITOR })
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-editor',
      email: 'editor@acme.test',
      email_verified: true,
    })
  })

  it('ALLOWS `create` for an editor a custom role handed members.manage', async () => {
    const response = await post(createInvite)
    expect(response.status).toBe(200)
    expect(mockInviteSet).toHaveBeenCalled()
  })

  it('ALLOWS the pending-invite list for the same member', async () => {
    expect((await list()).status).toBe(200)
  })

  it('still REFUSES an editor without the custom role', async () => {
    // The premise: the tier alone is not what admitted them above.
    mockResolveOrgMembership.mockResolvedValue({
      member: { $id: 'u-editor', role: 'editor' },
    })
    const response = await post(createInvite)
    expect(response.status).toBe(403)
    expect(mockInviteSet).not.toHaveBeenCalled()
  })
})

describe('AGL-2464 · the paths that must not change', () => {
  it('an ordinary admin still invites', async () => {
    const response = await post(createInvite)
    expect(response.status).toBe(200)
  })

  it('a staff session still bypasses, override or not', async () => {
    // Staff support access is not a customer-configured permission, and an
    // org cannot revoke it by writing to its own member doc.
    mockResolveOrgMembership.mockResolvedValue({ member: OVERRIDDEN_ADMIN })
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-staff',
      email: 'staff@aglyn.com',
      email_verified: true,
      staff: true,
    })
    expect((await post(createInvite)).status).toBe(200)
  })

  it('a non-member is refused, and does not throw resolving a null actor', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)
    expect((await post(createInvite)).status).toBe(403)
  })
})
