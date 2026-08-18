/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * `/api/account/photo` fans a self-saved avatar out to the org roster
 * (AGL-1976), and the property that matters most is the one about what it
 * REFUSES to be.
 *
 * The roster row is a permissions document that every colleague's Team list
 * renders. A route that accepted a target uid would be a way to put an
 * arbitrary image URL on somebody else's row in front of their whole
 * workspace — so the uid is taken from the verified token and the body's is
 * ignored, which is asserted here rather than assumed from reading the file.
 */

const mockVerifyIdToken = jest.fn()
const mockTenantVerifyIdToken = jest.fn()
const mockPropagate = jest.fn()

/** The REAL normalizer — a stubbed one would assert that a mock validates. */
const mockRealMemberPhoto = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/member-photo',
)

const state: { locked: boolean } = { locked: false }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        tenantManager: () => ({
          authForTenant: () => ({
            verifyIdToken: (...args: unknown[]) => mockTenantVerifyIdToken(...args),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  lockdownRefusal: async () =>
    state.locked ? Response.json({ error: 'locked' }, { status: 423 }) : null,
  normalizeMemberPhotoUrl: (raw: unknown) =>
    mockRealMemberPhoto.normalizeMemberPhotoUrl(raw),
  propagateMemberPhoto: (...args: unknown[]) => mockPropagate(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(
      [...request.headers.entries()].map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    ),
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('../app/api/account/photo/route')

function photoRequest(body: Record<string, unknown>, token = 'tok') {
  return new Request('https://console.aglyn.com/api/account/photo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  state.locked = false
  mockVerifyIdToken.mockResolvedValue({
    uid: 'caller-uid',
    email_verified: true,
  })
  mockPropagate.mockResolvedValue({ orgIds: ['o1', 'o2'], missingRows: [], cleared: false })
})

describe('POST /api/account/photo', () => {
  it('propagates the caller’s own photo to every roster row', async () => {
    const response = await POST(photoRequest({ photoUrl: 'https://cdn.example/z.png' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, orgs: 2 })
    expect(mockPropagate).toHaveBeenCalledWith({
      uid: 'caller-uid',
      photoURL: 'https://cdn.example/z.png',
    })
  })

  it('IGNORES a uid in the body — the token is the only subject', async () => {
    // The whole reason this route has no target parameter. If this ever goes
    // green with 'victim-uid', anyone with an account can paint an image onto
    // a stranger's roster row in front of their colleagues.
    await POST(photoRequest({ photoUrl: 'https://cdn.example/z.png', uid: 'victim-uid' }))
    expect(mockPropagate).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'caller-uid' }),
    )
    expect(mockPropagate).not.toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'victim-uid' }),
    )
  })

  it('refuses a non-https url without writing anything', async () => {
    const response = await POST(photoRequest({ photoUrl: 'javascript:alert(1)' }))
    expect(response.status).toBe(400)
    expect(mockPropagate).not.toHaveBeenCalled()
  })

  it('treats an empty value as a clear rather than a refusal', async () => {
    mockPropagate.mockResolvedValue({ orgIds: ['o1'], missingRows: [], cleared: true })
    const response = await POST(photoRequest({ photoUrl: '' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ cleared: true })
    expect(mockPropagate).toHaveBeenCalledWith({ uid: 'caller-uid', photoURL: '' })
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await POST(
      new Request('https://console.aglyn.com/api/account/photo', {
        method: 'POST',
        body: JSON.stringify({ photoUrl: 'https://cdn.example/z.png' }),
      }),
    )
    expect(response.status).toBe(401)
    expect(mockPropagate).not.toHaveBeenCalled()
  })

  it('verifies an SSO caller against their own tenant pool', async () => {
    // The members this route exists for are precisely the ones the project
    // pool cannot see (AGL-1122). `email_verified` is deliberately absent —
    // an SSO account is verified by its IdP, and demanding the claim would
    // refuse every Enterprise member.
    mockVerifyIdToken.mockResolvedValue({
      uid: 'sso-uid',
      firebase: { tenant: 'tenant-1' },
    })
    mockTenantVerifyIdToken.mockResolvedValue({
      uid: 'sso-uid',
      firebase: { tenant: 'tenant-1' },
    })
    const response = await POST(photoRequest({ photoUrl: 'https://cdn.example/z.png' }))
    expect(mockTenantVerifyIdToken).toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(mockPropagate).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'sso-uid' }),
    )
  })

  it('answers a lockdown with the distinct 423 and writes nothing', async () => {
    state.locked = true
    const response = await POST(photoRequest({ photoUrl: 'https://cdn.example/z.png' }))
    expect(response.status).toBe(423)
    expect(mockPropagate).not.toHaveBeenCalled()
  })
})
