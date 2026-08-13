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

jest.mock('@aglyn/tenant-data-admin', () => ({
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
        tenantManager: () => ({
          authForTenant: () => ({
            createSessionCookie: (...args: unknown[]) =>
              mockCreateSessionCookie(...args),
            verifySessionCookie: (...args: unknown[]) =>
              mockVerifySessionCookie(...args),
            createCustomToken: (...args: unknown[]) =>
              mockCreateCustomToken(...args),
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
  // The 423 shape is unit-tested in the lib; the route only forwards it.
  lockdownJsonResponse: (state: { scope: string; reason: string }) =>
    Response.json(
      { error: 'locked', scope: state.scope, reason: state.reason },
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
  resolveIdpDisplayName: () => null,
  resolveIdpPhotoUrl: () => null,
  resolveIdpPhone: () => null,
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
