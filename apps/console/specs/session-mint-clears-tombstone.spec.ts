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
 * AGL-1142: a refused mint must not leave a sign-out tombstone standing.
 *
 * Measured on production 2026-07-31: a `__session` cookie holding a tombstone
 * from **nine days earlier**, on an account that had signed in interactively
 * since. Every cross-subdomain silent sign-in was answered `401 signed-out`
 * for those nine days.
 *
 * The mechanism is that `POST /api/auth/session` REFUSES rather than fails:
 * 403 for an unverified email, 401 for a mint error. `await fetch(...)`
 * resolves on both, so the client's best-effort `catch` never fired and
 * nothing overwrote the cookie. The tombstone outlived the sign-in that should
 * have replaced it.
 *
 * A refusal to mint a shared cookie is a statement about ELIGIBILITY. It is
 * not a statement that this person is signed out, and a tombstone saying so is
 * simply false — so the refusal paths clear it.
 *
 * The load-bearing test here is the last one: an unauthenticated caller must
 * NOT be able to erase a real sign-out. Without it this change would be a way
 * to un-sign-out someone by sending a garbage token.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockIsImpersonationSession = jest.fn(() => false)

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
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
  isImpersonationSession: (...args: unknown[]) =>
    mockIsImpersonationSession(...(args as [])),
  seedUserProfile: jest.fn(async () => undefined),
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
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

import { POST } from '../app/api/auth/session/route'
import { signedOutTombstone } from '../app/api/auth/session/session-tombstone'

const TOMBSTONE = signedOutTombstone(Date.now() - 60_000)

const post = (opts: { cookie?: string; token?: string | null }) =>
  POST(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'POST',
      headers: {
        ...(opts.token === null
          ? {}
          : { authorization: `Bearer ${opts.token ?? 'tok'}` }),
        ...(opts.cookie ? { cookie: `__session=${opts.cookie}` } : {}),
      },
    }),
  )

/** Every Set-Cookie the response emits, as one searchable string. */
const cookies = (response: Response) =>
  [...response.headers.entries()]
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .map(([, value]) => value)
    .join('\n')

/** Does the response clear `__session`? */
const clearsSession = (response: Response) =>
  /__session=;/.test(cookies(response))

describe('POST /api/auth/session tombstone handling (AGL-1142)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsImpersonationSession.mockReturnValue(false)
    mockCreateSessionCookie.mockResolvedValue('minted-cookie')
  })

  it('clears the tombstone when it refuses an unverified email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: false })
    const response = await post({ cookie: TOMBSTONE })
    // The refusal itself is correct and unchanged (AGL-479).
    expect(response.status).toBe(403)
    // What changed: it no longer walks away leaving a cookie that says the
    // user is signed out, which is the state that lasted nine days.
    expect(clearsSession(response)).toBe(true)
  })

  it('clears the tombstone when the mint itself fails', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    mockCreateSessionCookie.mockRejectedValue(new Error('boom'))
    const response = await post({ cookie: TOMBSTONE })
    expect(response.status).toBe(401)
    expect(clearsSession(response)).toBe(true)
  })

  it('CONTROL — an unauthenticated caller cannot erase a real sign-out', async () => {
    // The whole safety of this change. A token that does not verify must
    // leave the tombstone exactly where it is, or "clear the tombstone"
    // becomes "un-sign-out anyone who sends junk".
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'))
    const response = await post({ cookie: TOMBSTONE, token: 'garbage' })
    expect(response.status).toBe(401)
    expect(clearsSession(response)).toBe(false)
  })

  it('CONTROL — no Authorization header clears nothing', async () => {
    const response = await post({ cookie: TOMBSTONE, token: null })
    expect(response.status).toBe(401)
    expect(clearsSession(response)).toBe(false)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('CONTROL — a refusal with no tombstone present sets no cookie at all', async () => {
    // Guards against clearing `__session` unconditionally, which would delete
    // a perfectly good session cookie every time an unverified user loaded a
    // page.
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: false })
    const response = await post({ cookie: 'a-real-session-cookie-value' })
    expect(response.status).toBe(403)
    expect(cookies(response)).toBe('')
  })

  it('a successful mint still replaces the tombstone with a real cookie', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    const response = await post({ cookie: TOMBSTONE })
    expect(response.status).toBe(200)
    expect(cookies(response)).toContain('__session=minted-cookie')
    expect(clearsSession(response)).toBe(false)
  })
})
