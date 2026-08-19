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
 * The session lockdown gate (AGL-1501) at the ROUTE level, layered on the
 * verdict's own unit proof (libs/tenant/data/admin lockdown.spec.ts, which
 * pins staff-bypass-with-zero-reads). What THIS file pins is the wiring the
 * unit spec cannot see:
 *
 *  - the mint feeds the verdict the `staff` claim off the VERIFIED token —
 *    never a header, never the request body — so the un-panic invariant
 *    holds through the route, not just inside the helper;
 *  - a locked caller is refused the cookie with the DISTINCT 423, before
 *    any mint happens;
 *  - the GET exchange refuses a locked user's still-valid cookie AND clears
 *    it — the logout is real, and what the client is left holding is the
 *    notice, not a sea of permission errors.
 */

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockCreateCustomToken = jest.fn()
const mockGetLockdownVerdict = jest.fn()
const mockGetFeatureLockdown = jest.fn()
const mockGetUser = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  // AGL-1993. Matches the real function under this env: the SSO domain
  // policy is unconfigured in tests, so it governs nothing and returns null.
  ssoDomainRefusal: () => null,
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        verifySessionCookie: (...args: unknown[]) =>
          mockVerifySessionCookie(...args),
        createSessionCookie: (...args: unknown[]) =>
          mockCreateSessionCookie(...args),
        createCustomToken: (...args: unknown[]) =>
          mockCreateCustomToken(...args),
        getUser: (...args: unknown[]) => mockGetUser(...args),
        tenantManager: () => ({
          authForTenant: () => ({
            createSessionCookie: (...args: unknown[]) =>
              mockCreateSessionCookie(...args),
            verifySessionCookie: (...args: unknown[]) =>
              mockVerifySessionCookie(...args),
            createCustomToken: (...args: unknown[]) =>
              mockCreateCustomToken(...args),
            getUser: (...args: unknown[]) => mockGetUser(...args),
          }),
        }),
      }),
      firestore: () => ({
        doc: () => ({ get: async () => ({ exists: false }) }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  getLockdownVerdict: (...args: unknown[]) => mockGetLockdownVerdict(...args),
  getFeatureLockdown: (...args: unknown[]) => mockGetFeatureLockdown(...args),
  // The 423 shape is unit-tested in the lib; the route only forwards it.
  lockdownJsonResponse: (state: {
    scope: string
    reason: string
    feature?: string
  }) =>
    Response.json(
      {
        error: 'locked',
        scope: state.scope,
        ...(state.feature ? { feature: state.feature } : {}),
        reason: state.reason,
      },
      { status: 423 },
    ),
  seedUserProfile: jest.fn(async () => undefined),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('next/server', () => ({
  __esModule: true,
  after: (fn: () => unknown) => void fn,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  /*
   * AGL-2190. `render-system-email` builds its default brand tokens at
   * MODULE scope, so a missing `brandMergeTokens` in this closed-world
   * mock is not a failed assertion — the whole suite fails to LOAD, three
   * requires deep from the route under test.
   *
   * Real shape and a real profile: the tokens are substituted into system
   * emails, and an empty object would leave `{{brand.productName}}` in the
   * body of every one of them with nothing here to notice.
   */
  PLATFORM_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: (branding: Record<string, string>) => ({
    'brand.productName': branding.productName,
    'brand.fromName': branding.fromName,
    'brand.supportUrl': branding.supportUrl,
  }),
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
  // The REAL activity/expiry and time readers (AGL-1510) — a stubbed
  // `isLockdownActive` would make "an expired signups lock restores with no
  // write" unfalsifiable.
  ...(() => {
    const actual = jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/lockdown',
    )
    return { isLockdownActive: actual.isLockdownActive, toEpochMs: actual.toEpochMs }
  })(),
}))

import { GET, POST } from '../app/api/auth/session/route'

const LOCKED = { scope: 'platform', reason: 'security' }

const mint = () =>
  POST(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
    }),
  )

const exchange = () =>
  GET(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'GET',
      headers: { cookie: '__session=cookie-value' },
    }),
  )

const cookies = (response: Response) =>
  [...response.headers.entries()]
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .map(([, value]) => value)
    .join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSessionCookie.mockResolvedValue('minted-cookie')
  mockCreateCustomToken.mockResolvedValue('custom-token')
  mockGetLockdownVerdict.mockResolvedValue(null)
  mockGetFeatureLockdown.mockResolvedValue(null)
  mockGetUser.mockResolvedValue({
    metadata: { creationTime: new Date(Date.now() - 86_400_000).toUTCString() },
  })
})

describe('POST mint × lockdown (AGL-1501)', () => {
  it('refuses a locked caller with 423 and never mints', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    mockGetLockdownVerdict.mockResolvedValue(LOCKED)
    const response = await mint()
    expect(response.status).toBe(423)
    expect((await response.json()).error).toBe('locked')
    expect(mockCreateSessionCookie).not.toHaveBeenCalled()
  })

  it('feeds the verdict the staff claim off the VERIFIED token — the un-panic wiring', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    const response = await mint()
    expect(response.status).toBe(200)
    expect(mockGetLockdownVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ staff: true, uid: 'staff-1' }),
    )
  })

  it('a non-staff token cannot claim the bypass', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    await mint()
    expect(mockGetLockdownVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ staff: false, uid: 'u1' }),
    )
  })

  it('mints normally when nothing is locked', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    const response = await mint()
    expect(response.status).toBe(200)
    expect(cookies(response)).toContain('__session=minted-cookie')
  })
})

describe('POST mint × SIGNUPS feature lock (AGL-1510)', () => {
  const LOCK_AT = Date.now() - 3_600_000
  const SIGNUPS_LOCK = {
    scope: 'feature',
    feature: 'signups',
    reason: 'security',
    atMs: LOCK_AT,
  }

  it('refuses an account CREATED SINCE THE LOCK the distinct feature 423, and never mints', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'bot-1', email_verified: true })
    mockGetFeatureLockdown.mockResolvedValue(SIGNUPS_LOCK)
    mockGetUser.mockResolvedValue({
      // Created ten minutes after the lock began — the bot wave.
      metadata: { creationTime: new Date(LOCK_AT + 600_000).toUTCString() },
    })
    const response = await mint()
    expect(response.status).toBe(423)
    expect(await response.json()).toMatchObject({
      error: 'locked',
      scope: 'feature',
      feature: 'signups',
    })
    expect(mockCreateSessionCookie).not.toHaveBeenCalled()
  })

  it('mints for an account that PREDATES the lock — existing users untouched', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-old', email_verified: true })
    mockGetFeatureLockdown.mockResolvedValue(SIGNUPS_LOCK)
    mockGetUser.mockResolvedValue({
      metadata: { creationTime: new Date(LOCK_AT - 600_000).toUTCString() },
    })
    const response = await mint()
    expect(response.status).toBe(200)
    expect(mockCreateSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('an EXPIRED signups lock restores mints with no write and no account read', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u-new', email_verified: true })
    mockGetFeatureLockdown.mockResolvedValue({
      ...SIGNUPS_LOCK,
      untilMs: Date.now() - 1,
    })
    const response = await mint()
    expect(response.status).toBe(200)
    // The expiry short-circuits BEFORE the getUser read — restoration costs
    // nothing and depends on no staff action.
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('costs zero account reads while the switch is off', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    const response = await mint()
    expect(response.status).toBe(200)
    expect(mockGetUser).not.toHaveBeenCalled()
  })
})

describe('GET exchange × lockdown (AGL-1501)', () => {
  it('refuses a locked user AND clears the session cookies — the logout is real', async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: 'u1' })
    mockGetLockdownVerdict.mockResolvedValue(LOCKED)
    const response = await exchange()
    expect(response.status).toBe(423)
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
    const jar = cookies(response)
    expect(jar).toMatch(/__session=;/)
    expect(jar).toMatch(/__session_tenant=;/)
  })

  it('exchanges a staff cookie during a platform lockdown (verified claim forwarded)', async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: 'staff-1', staff: true })
    const response = await exchange()
    expect(response.status).toBe(200)
    expect(mockGetLockdownVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ staff: true, uid: 'staff-1' }),
    )
  })

  it('exchanges normally when nothing is locked', async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: 'u1' })
    const response = await exchange()
    expect(response.status).toBe(200)
    expect((await response.json()).token).toBe('custom-token')
  })
})
