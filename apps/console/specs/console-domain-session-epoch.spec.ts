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
 * §7.8 of `docs/design/agl-1099a-cross-domain-session-handoff.md`, the ROUTE
 * half (AGL-1902): bumping `sessionEpoch` invalidates an outstanding session
 * cookie on a custom console domain.
 *
 * The verdict itself is unit-tested in `auth-handoff.spec.ts`. What this file
 * pins is the wiring that unit cannot see, and the wiring is the part that was
 * missing: `consoleSessionEpochRefuses` existed and the ONLY other spec that
 * mentioned it stubbed it to `false`. A stub is not a caller — nothing
 * anywhere proved the exchange asks the question, feeds it the right two
 * values, or does anything with the answer.
 *
 * Four things are asserted, and each is a separate way for the revocation to
 * be silently absent:
 *
 *  1. it is ASKED on a custom console domain, with the request's own host and
 *     the `iat` off the VERIFIED cookie — not a header, not the body;
 *  2. a refusal 401s with the distinct `domain-revoked` reason;
 *  3. the cookies are CLEARED with it, so the browser stops re-presenting a
 *     credential we have already decided is dead;
 *  4. it is never asked on the workspace domain, where there is no claim to
 *     read — a Firestore round trip on every `*.aglyn.com` exchange would be a
 *     real cost added by a control that governs nothing there.
 */

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockCreateCustomToken = jest.fn()
const mockEpochRefuses = jest.fn()
const mockGetUser = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  ssoDomainRefusal: () => null,
  consoleSessionEpochRefuses: (...args: unknown[]) => mockEpochRefuses(...args),
  // The host gate is AGL-1099c's and has its own file. `active` here so it
  // cannot be what produces a refusal below — the epoch has to earn its own.
  resolveConsoleDomain: async () => ({
    known: true,
    servable: true,
    orgSlug: 'acme',
    reason: 'active',
    degraded: false,
  }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        verifySessionCookie: (...args: unknown[]) =>
          mockVerifySessionCookie(...args),
        createSessionCookie: (...args: unknown[]) =>
          mockCreateSessionCookie(...args),
        createCustomToken: (...args: unknown[]) => mockCreateCustomToken(...args),
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
      firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
    }),
  },
  isImpersonationSession: () => false,
  getLockdownVerdict: async () => null,
  getFeatureLockdown: async () => null,
  lockdownJsonResponse: () => Response.json({ error: 'locked' }, { status: 423 }),
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
   * AGL-2190. `render-system-email` builds its default brand tokens at MODULE
   * scope, so a missing `brandMergeTokens` in this closed-world mock is not a
   * failed assertion — the whole suite fails to LOAD, three requires deep from
   * the route under test.
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
  resolveIdpAddress: () => ({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }),
  ...(() => {
    const actual = jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/lockdown',
    )
    return { isLockdownActive: actual.isLockdownActive, toEpochMs: actual.toEpochMs }
  })(),
}))

import { GET } from '../app/api/auth/session/route'

const CUSTOM_HOST = 'console.acme-agency.com'
/** Seconds, as a Firebase claim carries it. */
const ISSUED_AT_S = 1_760_000_000

const exchangeOn = (host: string) =>
  GET(
    new Request(`https://${host}/api/auth/session`, {
      method: 'GET',
      headers: {
        host,
        'x-forwarded-proto': 'https',
        cookie: '__session=cookie-value',
      },
    }),
  )

const cookies = (response: Response) =>
  [...response.headers.entries()]
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .map(([, value]) => value)
    .join('\n')

beforeEach(() => {
  jest.clearAllMocks()
  mockEpochRefuses.mockResolvedValue(false)
  mockCreateCustomToken.mockResolvedValue('custom-token')
  mockCreateSessionCookie.mockResolvedValue('minted-cookie')
  mockVerifySessionCookie.mockResolvedValue({
    uid: 'u1',
    email_verified: true,
    iat: ISSUED_AT_S,
  })
  mockGetUser.mockResolvedValue({
    metadata: { creationTime: new Date(Date.now() - 86_400_000).toUTCString() },
  })
})

describe('§7.8 — the console-domain session epoch, on the GET exchange', () => {
  it('refuses a revoked cookie with 401 domain-revoked, and mints nothing', async () => {
    mockEpochRefuses.mockResolvedValue(true)

    const response = await exchangeOn(CUSTOM_HOST)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Signed out',
      reason: 'domain-revoked',
    })
    // The exchange's whole purpose is turning a cookie back into a credential.
    // A refusal that still handed one out would be decoration.
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it('CLEARS both cookies with the refusal', async () => {
    // Otherwise the browser re-presents a credential we have already decided is
    // dead on every navigation, and the user meets a permission error rather
    // than a sign-in page.
    mockEpochRefuses.mockResolvedValue(true)

    const set = cookies(await exchangeOn(CUSTOM_HOST))

    expect(set).toContain('__session=;')
    expect(set).toContain('Max-Age=0')
    expect(set).toMatch(/__session_tenant=;/)
  })

  it('asks with the REQUEST’s own host and the iat off the VERIFIED cookie', async () => {
    // Both halves matter. A host taken from anywhere but the request is a
    // control an attacker chooses the subject of; an `iat` taken from anywhere
    // but the verified claim is one they choose the answer to.
    await exchangeOn(CUSTOM_HOST)

    expect(mockEpochRefuses).toHaveBeenCalledWith({
      host: CUSTOM_HOST,
      cookieIssuedAtMs: ISSUED_AT_S * 1000,
    })
  })

  it('lets a cookie minted after the bump through — the positive control', async () => {
    // Without this, every assertion above would pass just as well against a
    // route that refused every exchange on a custom domain.
    const response = await exchangeOn(CUSTOM_HOST)

    expect(response.status).toBe(200)
    expect((await response.json()).token).toBe('custom-token')
  })

  it('is never asked on the workspace domain, where there is no claim to read', async () => {
    // Not a style point: this would be a Firestore round trip added to every
    // `*.aglyn.com` exchange by a control that governs nothing there.
    mockEpochRefuses.mockResolvedValue(true)

    for (const host of ['app.aglyn.com', 'acme.aglyn.com', 'aglyn.com']) {
      expect((await exchangeOn(host)).status).toBe(200)
    }
    expect(mockEpochRefuses).not.toHaveBeenCalled()
  })
})
