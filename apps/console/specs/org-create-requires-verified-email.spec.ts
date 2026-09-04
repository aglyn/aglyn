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
 * AGL-2590 — NOBODY CLAIMS A WORKSPACE ADDRESS WITHOUT A PROVEN EMAIL.
 *
 * An org's name becomes its address, `acme-inc.aglyn.com`. AGL-1523 opened a
 * grace here so the sign-up form could post the name it had just collected
 * seconds after `createUserWithEmailAndPassword`, when a password account is
 * always unverified — and that grace was the last way an unproven address
 * could be taken. AGL-2585 then had to reserve, expire and reap behind it.
 *
 * The sign-up form no longer posts here at all: it holds the typed name
 * against the account and the workspace chooser creates the workspace on the
 * first VERIFIED session, which is the first session that could open one
 * anyway. So this route's AGL-479 gate stands with no exception.
 *
 * These cases pin that, plus the refusals whose order they share: the
 * AGL-1506 lockdown 423 and the AGL-1492 sanctions 451.
 */

const mockVerifyIdToken = jest.fn()
const mockLockdownRefusal = jest.fn()
const mockCreateOrganization = jest.fn()
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
  // The signup moment: a token minted seconds after
  // createUserWithEmailAndPassword — email_verified is ALWAYS false here.
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-fresh',
    email: 'new@example.com',
    email_verified: false,
    auth_time: Math.floor(Date.now() / 1000),
  })
})

describe('AGL-2590 · org creation requires a proven email address', () => {
  it('refuses a brand-new unverified account: 403, no org, no address held', async () => {
    // The signup moment the AGL-1523 grace used to admit. Red before this
    // change, which is the point — a throwaway inbox took a name permanently.
    const response = await post()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ reason: 'email-unverified' })
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('refuses an older unverified account for the same reason', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-stale',
      email: 'stale@example.com',
      email_verified: false,
      auth_time: Math.floor(Date.now() / 1000) - 86_400,
    })
    const response = await post()
    expect(response.status).toBe(403)
    expect(mockCreateOrganization).not.toHaveBeenCalled()
  })

  it('a verified caller creates, and takes a GRANTED address', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-verified',
      email: 'ok@example.com',
      email_verified: true,
    })
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ orgId: 'org-new' })
    // No expiry travels with it: the reservation window went with the grace,
    // because nothing unverified can reach this call any more.
    const options = mockCreateOrganization.mock.calls[0][0]
    expect(options).toMatchObject({
      ownerUid: 'u-verified',
      name: 'E2E Smoke Workspace',
    })
    expect(options).not.toHaveProperty('reserveSlugUntilMs')
  })

  it('a staff impersonation session still passes — the owner exists already', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-owner',
      email: 'owner@example.com',
      email_verified: false,
      impersonatedBy: 'staff-1',
    })
    const response = await post()
    expect(response.status).toBe(200)
    expect(mockCreateOrganization).toHaveBeenCalled()
  })

  it('lockdown (AGL-1506) refuses a verified caller with its 423', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'u-verified',
      email: 'ok@example.com',
      email_verified: true,
    })
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
