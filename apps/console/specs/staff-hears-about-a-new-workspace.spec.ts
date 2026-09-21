/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Response
 * helpers are unavailable.
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
 * AGL-3225: staff hears that somebody created a workspace.
 *
 * The route already sent a welcome email — to the CUSTOMER. Nothing went the
 * other way, so the only way to learn that a workspace existed was to go and
 * look at Firestore.
 *
 * The load-bearing test is the last one: the announcement sits after the org
 * is created and inside its own catch, so a notification that cannot be sent
 * must not turn a created workspace into a 500.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateOrganization = jest.fn()
const mockNotifyStaff = jest.fn()

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
  notifyStaff: (...args: unknown[]) => mockNotifyStaff(...args),
  recordSignupAttempt: () => undefined,
  recordSignupRefusal: () => undefined,
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isSignupCanaryOrgSlug: () => false,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { host: 'app.aglyn.com', authorization: 'Bearer tok' },
  }),
  generateOrgSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  isValidOrgSlug: (slug: string) => /^[a-z0-9-]{3,30}$/.test(slug),
  resolveIdpDisplayName: () => 'New Person',
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

jest.mock('../constants/sanctions-geo', () => ({
  __esModule: true,
  enforceSanctionsGeo: () => null,
}))

import { POST } from '../app/api/orgs/create/route'

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Acme Co' }),
    }),
  )

describe('a new workspace is announced to staff (AGL-3225)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-owner',
      email: 'owner@example.com',
      email_verified: true,
    })
    mockCreateOrganization.mockResolvedValue('org-new')
    mockNotifyStaff.mockResolvedValue(undefined)
  })

  it('announces the workspace, its owner and where to open it', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    const payload = mockNotifyStaff.mock.calls[0][0]
    expect(payload.type).toBe('staff.orgCreated')
    expect(payload.title).toContain('Acme Co')
    expect(payload.body).toContain('owner@example.com')
    expect(payload.body).toContain('/acme-co')
    // The org's own staff page, keyed by the id creation just returned.
    expect(payload.link).toContain('org-new')
  })

  it('says nothing when the workspace was never created', async () => {
    mockCreateOrganization.mockRejectedValue(new Error('slug clash'))
    const response = await post()
    expect(response.status).toBe(500)
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('still returns the workspace when the announcement throws', async () => {
    mockNotifyStaff.mockRejectedValue(new Error('boom'))
    const response = await post()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ orgId: 'org-new' })
  })
})
