/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
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
 * AGL-1959 — what a REVOKED device can and cannot still do.
 *
 * This is the file that decides whether "sign out" is a control or a label.
 * `POST /api/auth/session` mints the fourteen-day cross-subdomain cookie and
 * `GET` converts it into a fresh sign-in on every other workspace, so a revoked
 * browser that can still reach either one has not been signed out of anything.
 *
 * Two gates, tested separately because they fail for different reasons and a
 * single assertion would let either one rot:
 *
 *  1. `checkRevoked` on the MINT. `verifySessionCookie(c, true)` has passed it
 *     since AGL-236; `verifyIdToken` did not. So after any
 *     `revokeRefreshTokens(uid)` — this feature's, the lockdown panic button's
 *     (AGL-1501), a staff password reset's, an org member removal's — the
 *     browser still held an ID token valid for up to an hour, and this route
 *     would have exchanged it for a **fresh fourteen-day session cookie**.
 *     Every one of those revocations was leaking through the same hole.
 *  2. The per-device epoch, compared against when the presented credential was
 *     ISSUED rather than against the device id itself. That comparison is what
 *     makes the refusal survivable: a person who signs out the browser they
 *     are sitting at — the top row of the list, and so the likeliest
 *     mis-click — signs in again and is admitted, with no support path and no
 *     second mechanism. AGL-1888 is a live permanent lockout on this account
 *     and nothing here may add another.
 *
 * What a revoked device CAN still do is stated in
 * `app/api/_lib/device-revocation.ts` and is not hidden: a tab already open
 * holds a Firebase ID token that Firestore rules accept for up to an hour, and
 * our cookies have no say in that. It cannot obtain another one.
 */

const mockVerifyIdToken = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockCreateSessionCookie = jest.fn(async () => 'minted-cookie')
const mockCreateCustomToken = jest.fn(async () => 'custom-token')
/** `users/{uid}/devices/{id}` by full path, or an Error to throw. */
let mockDeviceDocs: Record<string, Record<string, unknown>> | Error = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  const firestore = () => ({
    doc: (path: string) => ({
      get: async () => {
        if (mockDeviceDocs instanceof Error) throw mockDeviceDocs
        const data = mockDeviceDocs[path]
        return { exists: data !== undefined, data: () => data }
      },
    }),
  })
  return {
    __esModule: true,
    ssoDomainRefusal: () => null,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          verifySessionCookie: (...args: unknown[]) =>
            mockVerifySessionCookie(...args),
          createSessionCookie: (...args: unknown[]) =>
            mockCreateSessionCookie(...(args as [])),
          createCustomToken: (...args: unknown[]) =>
            mockCreateCustomToken(...(args as [])),
          tenantManager: () => ({ authForTenant: () => ({}) }),
        }),
        firestore,
      }),
      firestore,
    },
    isImpersonationSession: () => false,
    getLockdownVerdict: async () => null,
    getFeatureLockdown: async () => null,
    lockdownJsonResponse: () =>
      Response.json({ error: 'locked' }, { status: 423 }),
    seedUserProfile: async () => undefined,
    emailUnverifiedResponse: () =>
      Response.json({ error: 'unverified' }, { status: 403 }),
    // The custom-domain guard (AGL-1099c). `app.aglyn.com` is the workspace
    // apex, so it returns before this is reached; present so the closed world
    // does not throw if that ever changes.
    resolveConsoleDomain: async () => ({ known: false, servable: false }),
  }
})

jest.mock('next/server', () => ({
  __esModule: true,
  after: (fn: () => unknown) => void fn,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  PLATFORM_BRAND_NAME: 'Aglyn',
  PLATFORM_BRANDING_PROFILE: {
    productName: 'Aglyn',
    fromName: 'Aglyn',
    supportUrl: 'https://aglyn.com/support',
  },
  brandMergeTokens: (b: Record<string, string>) => ({
    'brand.productName': b.productName,
  }),
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
  isLockdownActive: () => false,
  toEpochMs: () => undefined,
}))

import { GET, POST } from '../app/api/auth/session/route'

const UID = 'u1'
const DEVICE = 'dev-1'
const DEVICE_PATH = `users/${UID}/devices/${DEVICE}`
const REVOKED_AT = 1_760_000_000_000
const BEFORE_S = Math.floor((REVOKED_AT - 60_000) / 1000)
const AFTER_S = Math.floor((REVOKED_AT + 60_000) / 1000)

const request = (method: 'GET' | 'POST', cookies: string[]) =>
  new Request('https://app.aglyn.com/api/auth/session', {
    method,
    headers: {
      authorization: 'Bearer id-token',
      cookie: cookies.join('; '),
      host: 'app.aglyn.com',
    },
  })

const setCookies = (response: Response) =>
  [...(response.headers as unknown as Headers).entries()]
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => value)
    .join(' || ')

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSessionCookie.mockResolvedValue('minted-cookie')
  mockCreateCustomToken.mockResolvedValue('custom-token')
  mockDeviceDocs = { [DEVICE_PATH]: { revokedAt: REVOKED_AT } }
})

describe('the mint', () => {
  it('checks Firebase revocation — a stolen ID token buys no new cookie', async () => {
    mockDeviceDocs = {}
    mockVerifyIdToken.mockResolvedValue({
      uid: UID,
      email_verified: true,
      auth_time: AFTER_S,
    })

    await POST(request('POST', [`aglyn_device=${DEVICE}`]))

    // The whole point. Without `true`, `revokeRefreshTokens` stops the browser
    // getting a NEW id token and leaves the one it holds able to buy fourteen
    // more days.
    expect(mockVerifyIdToken).toHaveBeenCalledWith('id-token', true)
  })

  it('refuses a revoked device presenting a pre-revocation sign-in', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: UID,
      email_verified: true,
      auth_time: BEFORE_S,
    })

    const response = await POST(request('POST', [`aglyn_device=${DEVICE}`]))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ reason: 'device-revoked' })
    // Nothing minted. A refusal that still handed back a session cookie would
    // be the exact "looks finished" failure this file exists to catch.
    expect(mockCreateSessionCookie).not.toHaveBeenCalled()
    expect(setCookies(response)).toContain('__session=;')
  })

  it('ADMITS a genuinely fresh sign-in on the same revoked device', async () => {
    // `auth_time` moves only when someone actually authenticates, so this is
    // the branch a holder of stolen cookies cannot reach — and the branch that
    // stops a mis-click bricking the owner's own browser.
    mockVerifyIdToken.mockResolvedValue({
      uid: UID,
      email_verified: true,
      auth_time: AFTER_S,
    })

    const response = await POST(request('POST', [`aglyn_device=${DEVICE}`]))

    expect(response.status).toBe(200)
    expect(mockCreateSessionCookie).toHaveBeenCalled()
    expect(setCookies(response)).toContain('__session=minted-cookie')
  })

  it('is unaffected when the device was never revoked', async () => {
    mockDeviceDocs = { [DEVICE_PATH]: { lastSeenAt: 1 } }
    mockVerifyIdToken.mockResolvedValue({
      uid: UID,
      email_verified: true,
      auth_time: BEFORE_S,
    })

    expect((await POST(request('POST', [`aglyn_device=${DEVICE}`]))).status).toBe(
      200,
    )
  })

  it('fails OPEN when the device lookup throws', async () => {
    // Second gate, not the boundary. `checkRevoked` above is Firebase's own
    // bookkeeping and needs nothing from us, so a Firestore outage must not
    // turn into an account-wide sign-in outage — the same posture as the two
    // host guards in this route.
    mockDeviceDocs = new Error('firestore down')
    mockVerifyIdToken.mockResolvedValue({
      uid: UID,
      email_verified: true,
      auth_time: BEFORE_S,
    })

    expect((await POST(request('POST', [`aglyn_device=${DEVICE}`]))).status).toBe(
      200,
    )
  })
})

describe('the cross-subdomain exchange', () => {
  it('refuses a revoked device holding a pre-revocation cookie', async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, iat: BEFORE_S })

    const response = await GET(
      request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`]),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ reason: 'device-revoked' })
    // Otherwise "signed out" would mean "until you open a different
    // workspace" — this route is what turns the cookie back into a working
    // sign-in on every other subdomain.
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
    expect(setCookies(response)).toContain('__session=;')
    expect(setCookies(response)).toContain('__session_tenant=;')
  })

  it('admits a cookie minted after the revocation', async () => {
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, iat: AFTER_S })

    const response = await GET(
      request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`]),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ token: 'custom-token' })
  })

  it('checks revocation with Firebase too', async () => {
    mockDeviceDocs = {}
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, iat: AFTER_S })

    await GET(request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`]))

    expect(mockVerifySessionCookie).toHaveBeenCalledWith('cookie', true)
  })

  it('is unaffected by a device cookie the registry does not know', async () => {
    // A browser whose device row was never written — a sign-in that predates
    // AGL-665, or one recorded under a different uid — must not be locked out
    // by a lookup that finds nothing.
    mockDeviceDocs = {}
    mockVerifySessionCookie.mockResolvedValue({ uid: UID, iat: BEFORE_S })

    expect(
      (await GET(request('GET', ['__session=cookie', `aglyn_device=${DEVICE}`])))
        .status,
    ).toBe(200)
  })
})
