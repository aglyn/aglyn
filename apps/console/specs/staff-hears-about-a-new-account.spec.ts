/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and this runs on jsdom, where the route's Response helpers
 * are unavailable.
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
 * AGL-3225: staff hears that somebody signed up.
 *
 * Nothing announced a new account. The announcement hangs off
 * `seedUserProfile`'s `created` flag rather than off a signup form, because
 * that flag is the one fact in the product that means "this person did not
 * exist before" — and it lives on the path every interactive sign-in takes,
 * so it covers password, Google, passkey and SSO without a hook per provider.
 *
 * The load-bearing test is the second one: a returning user must raise
 * nothing. Announcing on every mint would turn one staff member's feed into
 * a log of every sign-in on the platform.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockSeedUserProfile = jest.fn()
const mockNotifyStaff = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ssoDomainRefusal: () => null,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        createSessionCookie: (...args: unknown[]) =>
          mockCreateSessionCookie(...args),
        tenantManager: () => ({
          authForTenant: () => ({
            createSessionCookie: (...args: unknown[]) =>
              mockCreateSessionCookie(...args),
          }),
        }),
      }),
    }),
    firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
  },
  isImpersonationSession: () => false,
  getLockdownVerdict: async () => null,
  getFeatureLockdown: async () => null,
  lockdownJsonResponse: () =>
    Response.json({ error: 'locked' }, { status: 423 }),
  seedUserProfile: (...args: unknown[]) => mockSeedUserProfile(...args),
  notifyStaff: (...args: unknown[]) => mockNotifyStaff(...args),
  findUserByUidAcrossPools: async () => null,
  backfillMemberIdentityEverywhere: async () => undefined,
  consoleSessionEpochRefuses: async () => null,
  resolveConsoleDomain: async () => null,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
}))

jest.mock('@aglyn/tenant-data-admin/server/account-emails', () => ({
  __esModule: true,
  registerProviderAddresses: async () => undefined,
}))

jest.mock('../app/api/_lib/security-alerts', () => ({
  __esModule: true,
  DEVICE_COOKIE: '__device',
  DEVICE_COOKIE_MAX_AGE_S: 60,
  DEVICES_COLLECTION: 'devices',
  describeSignInClient: () => ({}),
  recordDeviceAndMaybeAlert: async () => undefined,
}))

/*
 * `after` RUNS here, unlike in its neighbours.
 *
 * The other session specs stub it to discard the callback, which is right for
 * them — they assert on the response. The announcement lives INSIDE that
 * callback, so discarding it would make every test below pass against a route
 * that announces nothing.
 */
jest.mock('next/server', () => ({
  __esModule: true,
  after: (fn: () => unknown) => {
    void Promise.resolve(fn()).catch(() => undefined)
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: () => ({}),
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
  resolveIdpAddress: () => ({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }),
  isLockdownActive: (state: unknown) => state != null,
  toEpochMs: () => undefined,
}))

import { POST } from '../app/api/auth/session/route'

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
    }),
  )

/** `after` resolves on a later tick than the response does. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a new account is announced to staff (AGL-3225)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateSessionCookie.mockResolvedValue('minted-cookie')
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-new',
      email: 'new@example.com',
      email_verified: true,
    })
    mockNotifyStaff.mockResolvedValue(undefined)
  })

  it('announces the account the seed had to create', async () => {
    mockSeedUserProfile.mockResolvedValue({ created: true, fields: [] })
    await post()
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    const payload = mockNotifyStaff.mock.calls[0][0]
    expect(payload.type).toBe('staff.userSignedUp')
    expect(payload.body).toContain('new@example.com')
    // The link opens the account, not the list.
    expect(payload.link).toContain('uid-new')
  })

  it('says nothing when the account already existed', async () => {
    // The whole restraint of the feature. `seedUserProfile` runs on EVERY
    // interactive sign-in and fills absent fields as it goes, so announcing
    // on anything but `created` would announce every sign-in on the platform.
    mockSeedUserProfile.mockResolvedValue({ created: false, fields: ['photoUrl'] })
    await post()
    await settle()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('still mints the session when the announcement throws', async () => {
    mockSeedUserProfile.mockResolvedValue({ created: true, fields: [] })
    mockNotifyStaff.mockRejectedValue(new Error('boom'))
    const response = await post()
    await settle()
    // A sign-up must never fail because we could not tell ourselves about it.
    expect(response.status).toBe(200)
  })
})
