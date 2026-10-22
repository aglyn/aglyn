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
 * AGL-3952 — a staff build for a client is comped as it is created.
 *
 * The dialog's "Build for a client" switch sends `clientComp`; the route
 * hands it to `createOrganization` as `planComp`, stamped with the staff
 * uid, so the org is born with its comp and its audit row in one
 * transaction. The claim decides, never the body: a non-staff caller who
 * sends it is refused and nothing is created.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateOrganization = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          where: () => ({ limit: () => ({ get: async () => ({ size: 1 }) }) }),
        }),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 5,
    remaining: 4,
    resetMs: Date.now() + 3_600_000,
    degraded: false,
  }),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  freeWorkspaceCapRefusalResponse: () => null,
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  meterOrgEmail: async () => undefined,
  notifyStaff: async () => undefined,
  recordSignupAttempt: () => undefined,
  recordSignupRefusal: () => undefined,
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isSignupCanaryOrgSlug: () => false,
  isSignupCanaryEmail: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { host: 'app.aglyn.com', authorization: 'Bearer tok' },
  }),
  generateOrgSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  isValidOrgSlug: (slug: string) => /^[a-z0-9-]{3,30}$/.test(slug),
  resolveIdpDisplayName: () => 'Staff Person',
  PLATFORM_BRANDING_PROFILE: { productName: 'Aglyn', fromName: 'Aglyn' },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: async () => null,
}))

jest.mock('../app/api/_lib/growth-announcements', () => ({
  __esModule: true,
  announceNewWorkspace: async () => undefined,
}))

jest.mock('../constants/sanctions-geo', () => ({
  __esModule: true,
  enforceSanctionsGeo: () => null,
}))

import { POST } from '../app/api/orgs/create/route'

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Pecos Valley Dirt Bike Repair', ...body }),
    }),
  )

const CLIENT_COMP = {
  plan: 'starter',
  reason: 'trial',
  note: 'Booth build, Three Palms MX round 4, owner Ray Delgado',
}

const staffToken = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-staff',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
  })

const customerToken = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-owner',
    email: 'owner@example.com',
    email_verified: true,
  })

describe('a staff build for a client is comped at birth (AGL-3952)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateOrganization.mockResolvedValue('org-new')
  })

  it('hands the comp to the creation, stamped with the staff uid and always capped', async () => {
    staffToken()
    const response = await post({ clientComp: CLIENT_COMP })
    expect(response.status).toBe(200)
    const options = mockCreateOrganization.mock.calls[0][0]
    expect(options).toMatchObject({
      ownerUid: 'uid-staff',
      ownerStaffSeat: true,
      bypassFreeWorkspaceCap: true,
      planComp: {
        plan: 'starter',
        reason: 'trial',
        note: CLIENT_COMP.note,
        grantedBy: 'uid-staff',
      },
    })
    // The body has no say over the caps; `uncapped` is written by the lib.
    expect(options.planComp).not.toHaveProperty('uncapped')
  })

  it('a staff member with the switch off creates exactly as before', async () => {
    staffToken()
    const response = await post({})
    expect(response.status).toBe(200)
    expect(mockCreateOrganization.mock.calls[0][0]).not.toHaveProperty('planComp')
  })

  it('refuses the comp from a non-staff caller and creates nothing', async () => {
    customerToken()
    const response = await post({ clientComp: CLIENT_COMP })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Staff only' })
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('refuses a plan a comp cannot grant', async () => {
    staffToken()
    for (const plan of ['free', 'enterprise', 'platinum', 7]) {
      const response = await post({ clientComp: { ...CLIENT_COMP, plan } })
      expect(response.status).toBe(400)
    }
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('refuses a comp with no note, or a reason outside the override set', async () => {
    staffToken()
    expect((await post({ clientComp: { ...CLIENT_COMP, note: '   ' } })).status).toBe(400)
    expect((await post({ clientComp: { ...CLIENT_COMP, reason: 'vibes' } })).status).toBe(400)
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })
})
