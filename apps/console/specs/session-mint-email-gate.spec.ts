/**
 * @jest-environment jsdom
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
 * `mintSession` stops asking for a cookie the token says it cannot have
 * (AGL-2691).
 *
 * The refusal it used to collect is a 403 on the sign-up path, where it fired
 * the AGL-1142 "mint refused" warning — a line written to make a REAL refusal
 * visible, spent on the most ordinary event the console has. A warning that
 * cries on every new account is a warning nobody reads on the day it matters.
 *
 * The three negatives are what keep the suppression honest, and each is a
 * feature that would break silently if the guard over-reached: impersonation
 * (AGL-480), a token that could not be read, and — the one that must never
 * regress — a verified session, which still mints and still warns when it is
 * refused for any reason the token could not predict.
 */

const mockAuthorizedFetch = jest.fn()

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  FIREBASE_AUTH_EMULATOR_ENABLED: false,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useAuth: () => ({}),
  useUser: () => ({ data: undefined }),
}))

jest.mock('firebase/auth', () => ({
  __esModule: true,
  signOut: jest.fn(),
  signInWithCustomToken: jest.fn(),
}))

import { mintSession } from '../hooks/use-session-cookie'

const ok = { ok: true, status: 200, json: async () => ({}) }

const account = (claims: Record<string, unknown> | Error) => ({
  uid: 'uid-1',
  getIdToken: async () => 'id-token-123',
  getIdTokenResult: async () => {
    if (claims instanceof Error) throw claims
    return { claims }
  },
})

describe('mintSession and the email gate (AGL-2691)', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    mockAuthorizedFetch.mockReset().mockResolvedValue(ok)
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not ask, and does not warn, for an unverified session', async () => {
    const mintedForUid = { current: 'uid-1' }
    await expect(
      mintSession(account({ email_verified: false }), mintedForUid),
    ).resolves.toBe(false)
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    // Reported as "not minted", exactly as a collected refusal was — so a
    // later auth emission still gets another attempt (AGL-1142).
    expect(mintedForUid.current).toBeNull()
  })

  it('mints for a verified session', async () => {
    const mintedForUid = { current: null as string | null }
    await expect(
      mintSession(account({ email_verified: true }), mintedForUid),
    ).resolves.toBe(true)
    expect(mockAuthorizedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'uid-1' }),
      '/api/auth/session',
      { method: 'POST' },
    )
    expect(mintedForUid.current).toBe('uid-1')
  })

  it('mints for a staff impersonation session of an unverified owner (AGL-480)', async () => {
    await expect(
      mintSession(
        account({ email_verified: false, impersonatedBy: 'staff-uid' }),
        { current: null },
      ),
    ).resolves.toBe(true)
    expect(mockAuthorizedFetch).toHaveBeenCalled()
  })

  it('CONTROL — an unreadable token still mints; the route decides', async () => {
    await expect(
      mintSession(account(new Error('token refresh failed')), {
        current: null,
      }),
    ).resolves.toBe(true)
    expect(mockAuthorizedFetch).toHaveBeenCalled()
  })

  it('CONTROL — a verified session refused for another reason still warns', async () => {
    // The AGL-1142 line has to survive this change intact: the refusals it
    // was written for are the ones the token cannot predict.
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ reason: 'revoked' }),
    })
    const mintedForUid = { current: 'uid-1' }
    await expect(
      mintSession(account({ email_verified: true }), mintedForUid),
    ).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(
      '[auth/session] mint refused',
      JSON.stringify({ status: 401, reason: 'revoked' }),
    )
    expect(mintedForUid.current).toBeNull()
  })
})
