/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, this runs on jsdom, and `Request` is not a constructor
 * there.
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
 * AGL-1259: an EMPTY duplicate `__session` shadowed the real one.
 *
 * A browser sends every cookie matching the request, and two cookies with the
 * same name at different scopes — one `Domain=.aglyn.com`, one host-only —
 * arrive as two pairs in one `Cookie` header with nothing to tell them apart.
 * `readCookie` returned the first match, so an empty duplicate won.
 *
 * Reproduced against PRODUCTION before the fix, which is why this is a test
 * of the endpoint rather than of the helper:
 *
 * ```
 * curl -H 'Cookie: __session=; __session=bogus' …  → 401 {"reason":"absent"}
 * curl -H 'Cookie: __session=bogus'            …  → 401 {"reason":"invalid"}
 * ```
 *
 * `absent` is the damaging answer. It is what the client treats as "no cookie
 * yet, mint one" — so the tab mints, the mint succeeds, the empty duplicate
 * still sorts first, and the next read says `absent` again. A deadlock, not a
 * hiccup: observed in production as a console signed in as the right user and
 * rendering **0 Workspaces**, a silent wrong answer with no way out but
 * clearing site data.
 */

const mockVerifyIdToken = jest.fn()
const mockCreateSessionCookie = jest.fn()
const mockVerifySessionCookie = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        createSessionCookie: (...args: unknown[]) =>
          mockCreateSessionCookie(...args),
        verifySessionCookie: (...args: unknown[]) =>
          mockVerifySessionCookie(...args),
        createCustomToken: async () => 'custom-token',
        tenantManager: () => ({
          authForTenant: () => ({
            createSessionCookie: (...args: unknown[]) =>
              mockCreateSessionCookie(...args),
            verifySessionCookie: (...args: unknown[]) =>
              mockVerifySessionCookie(...args),
            createCustomToken: async () => 'custom-token',
          }),
        }),
      }),
    }),
    firestore: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
  },
  isImpersonationSession: () => false,
  seedUserProfile: jest.fn(async () => undefined),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email', reason: 'email-unverified' }, {
      status: 403,
    }),
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

import { GET } from '../app/api/auth/session/route'

const get = (cookie: string) =>
  GET(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'GET',
      headers: { cookie },
    }),
  )

const reasonOf = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as {
    reason?: string
  } | null
  return payload?.reason ?? 'ok'
}

describe('a duplicate __session cookie (AGL-1259)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // A cookie that reaches verification is a cookie the route CHOSE. What it
    // then verifies to is beside the point here — `invalid` proves the choice.
    mockVerifySessionCookie.mockRejectedValue(
      Object.assign(new Error('bad'), { code: 'auth/argument-error' }),
    )
  })

  it('prefers the real cookie over an empty duplicate that sorts first', async () => {
    const response = await get('__session=; __session=real-session-value')
    // NOT `absent` — that is the answer that sends the client into the
    // mint-and-never-converge loop.
    expect(await reasonOf(response)).not.toBe('absent')
    expect(mockVerifySessionCookie).toHaveBeenCalledWith(
      'real-session-value',
      true,
    )
  })

  it('prefers it whichever side the empty duplicate lands on', async () => {
    await get('__session=real-session-value; __session=')
    expect(mockVerifySessionCookie).toHaveBeenCalledWith(
      'real-session-value',
      true,
    )
  })

  it('is unchanged for a single real cookie', async () => {
    await get('__session=real-session-value')
    expect(mockVerifySessionCookie).toHaveBeenCalledWith(
      'real-session-value',
      true,
    )
  })

  /**
   * The one case that must still answer `absent`: a jar holding only empties
   * genuinely has no session, and the client SHOULD mint one.
   */
  it('still reports absent when every copy is empty', async () => {
    const response = await get('__session=; __session=')
    expect(response.status).toBe(401)
    expect(await reasonOf(response)).toBe('absent')
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
  })

  it('still reports absent when there is no cookie at all', async () => {
    const response = await get('other=1')
    expect(await reasonOf(response)).toBe('absent')
  })

  /** The sidecar is read by the same helper and has the same exposure. */
  it('applies to the tenant sidecar too', async () => {
    await get(
      '__session_tenant=; __session_tenant=tenant-a; __session=real-session-value',
    )
    expect(mockVerifySessionCookie).toHaveBeenCalled()
  })
})
