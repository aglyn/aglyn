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
 * Console sign-out ends the site edit bar in THAT browser (AGL-1842
 * follow-on).
 *
 * `DELETE /api/auth/session` is where every deliberate sign-out converges,
 * and it is the only moment the server still holds the session that is
 * ending. So it records `users/{uid}/editHintEnds/{did}` for the browser's
 * `aglyn_device` id, and the tenant then refuses every hint and hint-bought
 * token from that browser dated before it. Pinned here:
 *
 * - the record is written for the VERIFIED session's uid and this browser's
 *   device id, and for nothing a caller merely claims;
 * - a deleted account writes nothing (closing an account ends on /signout,
 *   and a record there would outlive the erasure), while a session revoked
 *   elsewhere still ends its hint;
 * - a tombstone (the second DELETE of the same sign-out) writes nothing;
 * - signing out always works: a failed write still answers 200 and still
 *   lays the tombstone.
 */

const mockVerifySessionCookie = jest.fn()
/** Every `set` the route made, as `path → data`. */
let mockWrites: Record<string, unknown>
let mockWriteError: Error | null

jest.mock('@aglyn/tenant-data-admin', () => {
  const docAt = (path: string): Record<string, unknown> => ({
    set: async (data: unknown) => {
      if (mockWriteError) throw mockWriteError
      mockWrites[path] = data
    },
    collection: (sub: string) => ({
      doc: (id: string) => docAt(`${path}/${sub}/${id}`),
    }),
  })
  const firestore = () => ({
    collection: (name: string) => ({ doc: (id: string) => docAt(`${name}/${id}`) }),
  })
  return {
    __esModule: true,
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/edit-hint-token',
    ),
    ...jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/edit-hint-end',
    ),
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifySessionCookie: (...args: unknown[]) =>
            mockVerifySessionCookie(...args),
          tenantManager: () => ({
            authForTenant: () => ({
              verifySessionCookie: (...args: unknown[]) =>
                mockVerifySessionCookie(...args),
            }),
          }),
        }),
        firestore,
      }),
      firestore,
    },
    isImpersonationSession: () => false,
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
  isLockdownActive: () => false,
  toEpochMs: () => undefined,
}))

import { DELETE } from '../app/api/auth/session/route'

const UID = 'uid-editor'
const DEVICE = 'f2a1c3d4-5b6e-4f70-8a91-b2c3d4e5f607'
const END_PATH = `users/${UID}/editHintEnds/${DEVICE}`

const signOut = (cookies: string[]) =>
  DELETE(
    new Request('https://app.aglyn.com/api/auth/session', {
      method: 'DELETE',
      headers: { cookie: cookies.join('; '), host: 'app.aglyn.com' },
    }),
  )

const authError = (code: string) => Object.assign(new Error(code), { code })

beforeEach(() => {
  jest.clearAllMocks()
  mockWrites = {}
  mockWriteError = null
  mockVerifySessionCookie.mockResolvedValue({ uid: UID })
})

describe('DELETE /api/auth/session ends the edit hint for this browser', () => {
  it('records the ending for the verified session and this device', async () => {
    const before = Date.now()
    const response = await signOut([
      '__session=live-session-cookie',
      `aglyn_device=${DEVICE}`,
    ])
    expect(response.status).toBe(200)
    expect(mockVerifySessionCookie).toHaveBeenCalledWith('live-session-cookie', true)
    expect(Object.keys(mockWrites)).toEqual([END_PATH])
    const endedAt = (mockWrites[END_PATH] as { endedAt: number }).endedAt
    expect(endedAt).toBeGreaterThanOrEqual(before)
    expect(endedAt).toBeLessThanOrEqual(Date.now())
  })

  it('writes nothing without a device id: there is no browser to name', async () => {
    await signOut(['__session=live-session-cookie'])
    expect(mockWrites).toEqual({})
  })

  it('writes nothing for a session it cannot verify', async () => {
    mockVerifySessionCookie.mockRejectedValue(authError('auth/argument-error'))
    const response = await signOut([
      '__session=forged',
      `aglyn_device=${DEVICE}`,
    ])
    expect(response.status).toBe(200)
    expect(mockWrites).toEqual({})
  })

  it('writes nothing for a DELETED account, so nothing outlives the erasure', async () => {
    mockVerifySessionCookie.mockRejectedValue(authError('auth/user-not-found'))
    await signOut(['__session=live-session-cookie', `aglyn_device=${DEVICE}`])
    expect(mockWrites).toEqual({})
  })

  it('still ends the hint of a session revoked elsewhere', async () => {
    mockVerifySessionCookie.mockImplementation(async (_cookie, checkRevoked) => {
      if (checkRevoked) throw authError('auth/session-cookie-revoked')
      return { uid: UID }
    })
    await signOut(['__session=live-session-cookie', `aglyn_device=${DEVICE}`])
    expect(Object.keys(mockWrites)).toEqual([END_PATH])
  })

  it('writes nothing on the second DELETE of a sign-out (a tombstone)', async () => {
    await signOut([`__session=signed-out:${Date.now()}`, `aglyn_device=${DEVICE}`])
    expect(mockVerifySessionCookie).not.toHaveBeenCalled()
    expect(mockWrites).toEqual({})
  })

  it('signs out anyway when the write fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockWriteError = new Error('UNAVAILABLE')
    const response = await signOut([
      '__session=live-session-cookie',
      `aglyn_device=${DEVICE}`,
    ])
    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie().join(' || ')).toContain('__session=signed-out')
  })
})
