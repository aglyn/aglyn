/**
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
 * AGL-3229: `checkRevoked` never reaches the SDK, so an SSO account can sign
 * in.
 *
 * `revocationCheckedAuth` routes the revocation lookup to the pool the TOKEN
 * names (AGL-2005). It used to do that only for callers that passed no
 * `checkRevoked` argument — a caller passing `true` got firebase-admin's own
 * check instead, which runs `this.getUser(sub)` on the handle that verified
 * the token. For an SSO account that handle is the project pool and the uid
 * is not in it: `auth/user-not-found`, which `id-token-refusal.ts` reads as a
 * bad credential.
 *
 * `POST /api/auth/session` was one of the two callers that passed `true`, so
 * on production (1.0.0-beta.147) every tenant user was answered
 * `401 Unauthenticated` by the route that mints the shared cookie. The
 * sign-out tombstone that a successful mint replaces therefore survived every
 * sign-in, and the console re-opened "Sign in again to verify your device" on
 * each load — a loop no amount of signing in could leave.
 *
 * The two properties below are the fix. The first is the bug; the second is
 * what stops the fix from being a way to skip the check entirely.
 */

const PROJECT_POOL_UID_ABSENT = Object.assign(
  new Error('There is no user record corresponding to the provided identifier.'),
  { code: 'auth/user-not-found' },
)

const TENANT_ID = 'aglyn-org-y5v14'

const ssoToken = {
  uid: 'sso-uid',
  sub: 'sso-uid',
  auth_time: Math.floor(Date.now() / 1000),
  email: 'person@example.com',
  email_verified: true,
  firebase: { tenant: TENANT_ID },
}

const mockApp = { name: 'mock-default-app' }
/** What the PROJECT pool would answer about a tenant uid. */
const mockProjectGetUser = jest.fn(async () => {
  throw PROJECT_POOL_UID_ABSENT
})
/** What the TENANT pool answers — the account is there, and is fine. */
const mockTenantGetUser = jest.fn(async () => ({
  uid: ssoToken.uid,
  disabled: false,
  tokensValidAfterTime: undefined,
}))
const mockAuthForTenant = jest.fn(() => ({ getUser: mockTenantGetUser }))
/**
 * The SDK's `verifyIdToken`. It records what it was handed, and honours
 * `checkRevoked` exactly as firebase-admin does — by looking the uid up in
 * ITS OWN pool, which is the whole of the bug.
 */
const mockVerifyIdToken = jest.fn(async (...args: unknown[]) => {
  if (args[1] === true) await mockProjectGetUser()
  return ssoToken
})

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApps: () => [mockApp],
  getApp: () => mockApp,
  initializeApp: jest.fn(() => mockApp),
  cert: jest.fn(() => ({})),
}))

jest.mock('firebase-admin/auth', () => ({
  __esModule: true,
  getAuth: () => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
    getUser: (...args: unknown[]) => mockProjectGetUser(...(args as [])),
    tenantManager: () => ({
      authForTenant: (...args: unknown[]) =>
        mockAuthForTenant(...(args as [])),
    }),
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  FieldValue: { serverTimestamp: () => ({}) },
  Timestamp: { now: () => ({}) },
  FieldPath: class {},
}))

jest.mock('firebase-admin/database', () => ({
  __esModule: true,
  getDatabase: () => ({}),
}))

jest.mock('firebase-admin/remote-config', () => ({
  __esModule: true,
  getRemoteConfig: () => ({}),
}))

jest.mock('firebase-admin/storage', () => ({
  __esModule: true,
  getStorage: () => ({}),
}))

import firebaseAdmin from './firebase-admin'
import { resetTokenRevocationCache } from './token-revocation'

beforeEach(() => {
  resetTokenRevocationCache()
  mockVerifyIdToken.mockClear()
  mockProjectGetUser.mockClear()
  mockTenantGetUser.mockClear()
  mockAuthForTenant.mockClear()
})

describe('an SSO token through the checked handle', () => {
  it('verifies even when the caller asks for checkRevoked', async () => {
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken('sso-id-token', true)

    expect(decoded).toEqual(ssoToken)
    // The flag was stripped: one argument reaches the SDK, so its
    // project-pool lookup never runs.
    expect(mockVerifyIdToken).toHaveBeenCalledWith('sso-id-token')
    expect(mockProjectGetUser).not.toHaveBeenCalled()
  })

  it('asks the tenant pool about revocation, not the project pool', async () => {
    await firebaseAdmin.app().auth().verifyIdToken('sso-id-token', true)

    expect(mockAuthForTenant).toHaveBeenCalledWith(TENANT_ID)
    expect(mockTenantGetUser).toHaveBeenCalledWith(ssoToken.uid)
  })

  it('still refuses a token the tenant pool says is revoked', async () => {
    // A second past the token's `auth_time`, so the epoch postdates it.
    mockTenantGetUser.mockResolvedValueOnce({
      uid: ssoToken.uid,
      disabled: false,
      tokensValidAfterTime: new Date(
        (ssoToken.auth_time + 1) * 1000,
      ).toUTCString(),
    } as never)

    await expect(
      firebaseAdmin.app().auth().verifyIdToken('sso-id-token', true),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })
})
