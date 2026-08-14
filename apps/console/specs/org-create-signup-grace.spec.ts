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
 * AGL-1523 — signup-time org provisioning must be able to succeed on the
 * password door.
 *
 * The signup form posts its collected org name to `/api/orgs/create` seconds
 * after `createUserWithEmailAndPassword` — when a password account is ALWAYS
 * unverified — so the flat AGL-479 email gate refused every signup-time
 * provisioning ever attempted there. The first production signup proved it:
 * org name typed, no org created, no explanation.
 *
 * The fix admits exactly the signup shape through a server-checked grace
 * (brand-new account, owns nothing) and keeps everything else: the verified
 * gate for older accounts, the AGL-1506 lockdown 423, and the AGL-1492
 * sanctions 451.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockCreateOrganization = jest.fn()
const mockGraceAllows = jest.fn()
const mockEnforceSanctions = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ size: 1 }) }),
          }),
        }),
      }),
    }),
  },
  // Always under the AGL-1534 limit here — its own spec
  // (org-create-rate-limit.spec.ts) owns the 429 behaviour.
  consumeRateLimit: jest.fn(async () => ({
    allowed: true,
    limit: 3,
    remaining: 2,
    resetMs: Date.now() + 60 * 60 * 1000,
    degraded: false,
  })),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  meterOrgEmail: jest.fn(async () => undefined),
  OrgSlugTakenError: class OrgSlugTakenError extends Error {},
  signupProvisioningGraceAllows: (...args: unknown[]) =>
    mockGraceAllows(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      host: 'app.aglyn.com',
    },
  }),
  generateOrgSlug: (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  isValidOrgSlug: (slug: string) => /^[a-z0-9-]{3,30}$/.test(slug),
  resolveIdpDisplayName: () => 'New Person',
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
  enforceSanctionsGeo: (...args: unknown[]) => mockEnforceSanctions(...args),
}))

import { POST } from '../app/api/orgs/create/route'

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/orgs/create', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ name: 'E2E Smoke Workspace' }),
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockEnforceSanctions.mockReturnValue(null)
  mockLockdownRefusal.mockResolvedValue(null)
  mockCreateOrganization.mockResolvedValue('org-new')
  mockGraceAllows.mockResolvedValue(false)
  // The signup moment: a token minted seconds after
  // createUserWithEmailAndPassword — email_verified is ALWAYS false here.
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-fresh',
    email: 'new@example.com',
    email_verified: false,
    auth_time: Math.floor(Date.now() / 1000),
  })
})

describe('AGL-1523 · signup-time org creation on the password door', () => {
  it('a brand-new unverified account within grace CREATES its org (the defect)', async () => {
    mockGraceAllows.mockResolvedValue(true)
    const response = await post()
    // Red before the fix: 403 email-unverified on every password signup.
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ orgId: 'org-new' })
    expect(mockGraceAllows).toHaveBeenCalledWith('u-fresh')
    expect(mockCreateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUid: 'u-fresh', name: 'E2E Smoke Workspace' }),
    )
  })

  it('outside the grace the AGL-479 gate stands: 403, no org', async () => {
    mockGraceAllows.mockResolvedValue(false)
    const response = await post()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'email-unverified' })
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('a verified caller never pays the grace lookups', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-verified',
      email: 'ok@example.com',
      email_verified: true,
    })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockGraceAllows).not.toHaveBeenCalled()
  })

  it('lockdown (AGL-1506) still refuses a graced signup with its 423', async () => {
    mockGraceAllows.mockResolvedValue(true)
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked', scope: 'platform' }, { status: 423 }),
    )
    const response = await post()
    expect(response.status).toBe(423)
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('sanctions (AGL-1492) still refuse before the token is even read', async () => {
    mockEnforceSanctions.mockReturnValue(
      Response.json({ error: 'unavailable' }, { status: 451 }),
    )
    const response = await post()
    expect(response.status).toBe(451)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })
})
