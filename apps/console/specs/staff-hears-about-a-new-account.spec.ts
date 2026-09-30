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
 * AGL-3225: staff hears that somebody signed up — once per account, on every
 * sign-up path.
 *
 * The notice first hung off `seedUserProfile` reporting that it CREATED
 * `users/{uid}`. That document has other writers that reach it first: the
 * sign-up page writes the profile, plan intent and campaign there, the
 * acquisition record lands there, and since AGL-3355 the /signin consent
 * bounce records acquisition there before the person has ever minted a
 * session. So the notice went out only for the sign-ups that won the race —
 * never for a password account, and never for a bounced Google one.
 *
 * Newness now comes from the auth record's creation time, and "once" from a
 * marker only the first claim can create. The Firestore below is a fake with
 * the one behaviour that matters: `create()` refuses a document that exists.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const mockVerifyIdToken = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockSeedUserProfile = jest.fn()
const mockNotifyStaff = jest.fn()
const mockFindUser = jest.fn()

/** Documents the fake has created, by path. */
const mockCreated = new Map<string, unknown>()
const mockFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      create: async (data: unknown) => {
        const path = `${name}/${id}`
        if (mockCreated.has(path)) {
          throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
        }
        mockCreated.set(path, data)
      },
    }),
  }),
}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => mockFirestore }) },
}))

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
  findUserByUidAcrossPools: (...args: unknown[]) => mockFindUser(...args),
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
  // The real shape, not a flat `false`: the canary exclusion below is only
  // exercised if this can actually say yes (AGL-3248).
  isSignupCanaryEmail: (email: string) =>
    typeof email === 'string' &&
    (email.toLowerCase().split('@')[0].split('+')[1] ?? '').startsWith(
      'signup-canary',
    ),
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

/** The auth record, created `ageMs` ago. */
function authRecordAged(ageMs: number) {
  mockFindUser.mockResolvedValue({
    tenantId: null,
    record: {
      uid: 'uid-new',
      providerData: [],
      metadata: { creationTime: new Date(Date.now() - ageMs).toUTCString() },
    },
  })
}

describe('a new account is announced to staff (AGL-3225)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreated.clear()
    mockCreateSessionCookie.mockResolvedValue('minted-cookie')
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-new',
      email: 'new@example.com',
      email_verified: true,
    })
    mockNotifyStaff.mockResolvedValue(undefined)
    mockSeedUserProfile.mockResolvedValue({ created: true, fields: [] })
    authRecordAged(5_000)
  })

  it('announces an account on its first session', async () => {
    await post()
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    const payload = mockNotifyStaff.mock.calls[0][0]
    expect(payload.type).toBe('staff.userSignedUp')
    expect(payload.body).toContain('new@example.com')
    // The link opens the account, not the list.
    expect(payload.link).toContain('uid-new')
    expect(mockCreated.has('accountAnnouncements/uid-new')).toBe(true)
  })

  it('announces a /signup account whose page wrote users/{uid} before the mint', async () => {
    // The race the old key lost: the sign-up page's profile, campaign and
    // acquisition writes all land on `users/{uid}` while the session mint is
    // still in flight, so the seed finds the document already there.
    mockSeedUserProfile.mockResolvedValue({ created: false, fields: ['photoUrl'] })
    await post()
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('announces an account /signin bounced for consent, when it comes back hours later', async () => {
    // Created by "Sign in with Google" on /signin, recorded there (AGL-3355)
    // and signed straight back out, so `users/{uid}` has existed since
    // before this account ever held a session. Its first mint is on
    // /signup, after the person consents.
    authRecordAged(3 * 60 * 60 * 1000)
    mockSeedUserProfile.mockResolvedValue({ created: false, fields: [] })
    await post()
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('announces a password account on its first verified session, days after it was created', async () => {
    authRecordAged(2 * DAY_MS)
    mockSeedUserProfile.mockResolvedValue({ created: false, fields: [] })
    await post()
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('never announces the same account twice', async () => {
    // A second tab, a retry, the next sign-in the same afternoon — the
    // account is still inside the window every time, and only the first
    // claim may win.
    await post()
    await settle()
    await post()
    await settle()
    await Promise.all([post(), post()])
    await settle()
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
  })

  it('says nothing about an account older than the window', async () => {
    // Every account created before the marker existed has none, so without
    // the window each one's next sign-in would read as a sign-up.
    authRecordAged(30 * DAY_MS)
    mockSeedUserProfile.mockResolvedValue({ created: true, fields: [] })
    await post()
    await settle()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
    expect(mockCreated.size).toBe(0)
  })

  it('says nothing when the auth record cannot be read', async () => {
    mockFindUser.mockResolvedValue(null)
    await post()
    await settle()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('says nothing about the canary walking its own signup (AGL-3248)', async () => {
    /*
     * The hourly walk signs up for real through this path and then deletes
     * the account, so an announcement here is a person who no longer exists
     * behind a link to an admin page that 404s. It genuinely is a brand-new
     * account, which is why nothing in the newness check catches it.
     */
    mockVerifyIdToken.mockResolvedValue({
      uid: 'uid-canary',
      email: 'ops+signup-canary-m2rso9ab12@example.com',
      email_verified: true,
    })
    const response = await post()
    await settle()
    // Minted, and silently: the walk has to take the same path a stranger
    // takes or it proves nothing about signup.
    expect(response.status).toBe(200)
    expect(mockNotifyStaff).not.toHaveBeenCalled()
    expect(mockCreated.size).toBe(0)
  })

  it('still mints the session when the announcement throws', async () => {
    mockNotifyStaff.mockRejectedValue(new Error('boom'))
    const response = await post()
    await settle()
    // A sign-up must never fail because we could not tell ourselves about it.
    expect(response.status).toBe(200)
  })
})
