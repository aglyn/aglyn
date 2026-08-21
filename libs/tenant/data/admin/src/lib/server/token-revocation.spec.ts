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
 * AGL-1881 — a revoked ID token stops being accepted by the console.
 *
 * These assert against the CHOKE POINT, not against the helper in isolation:
 * every one of them goes through `firebaseAdmin.app().auth().verifyIdToken()`,
 * which is the call the ~117 console API routes actually make. A spec that
 * only exercised `assertIdTokenNotRevoked` directly would stay green even if
 * nothing were wired to it — which is precisely the shape of the bug.
 *
 * Every case here FAILS against the pre-AGL-1881 tree: `verifyIdToken` there
 * resolved a revoked token, a disabled account's token, and a deleted user's
 * token alike, for up to an hour after the revoke.
 */

const now = 1_760_000_000_000

/** A decoded ID token as firebase-admin hands it back. */
const decodedToken = (over: Record<string, unknown> = {}) => ({
  uid: 'u1',
  // Seconds since epoch, and the claim that moves ONLY on a real
  // authentication — the one an attacker holding cookies cannot forge.
  auth_time: Math.floor((now - 600_000) / 1000),
  iat: Math.floor((now - 600_000) / 1000),
  email_verified: true,
  ...over,
})

const userRecord = (over: Record<string, unknown> = {}) => ({
  uid: 'u1',
  email: 'owner@example.com',
  disabled: false,
  tokensValidAfterTime: undefined as string | undefined,
  ...over,
})

/** What each pool's `getUser` answers, and how often it was asked. */
let projectRecord: any = userRecord()
let tenantRecord: any = userRecord()
let projectGetUserError: any = null
let poolsAsked: (string | null)[] = []
let verifyArgs: unknown[][] = []

const poolAuth = (poolId: string | null) => ({
  verifyIdToken: jest.fn(async (...args: unknown[]) => {
    verifyArgs.push(args)
    return decodedToken(poolId ? { firebase: { tenant: poolId } } : {})
  }),
  getUser: jest.fn(async (_uid: string) => {
    poolsAsked.push(poolId)
    if (poolId === null && projectGetUserError) throw projectGetUserError
    return poolId === null ? projectRecord : tenantRecord
  }),
  tenantManager: () => ({
    authForTenant: (tenantId: string) => poolAuth(tenantId),
  }),
})

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({ name: '[DEFAULT]' }),
  getApps: () => [{ name: '[DEFAULT]' }],
  initializeApp: () => ({ name: '[DEFAULT]' }),
  cert: () => ({}),
}))
jest.mock('firebase-admin/auth', () => ({
  __esModule: true,
  getAuth: () => poolAuth(null),
}))
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  getFirestore: () => ({}),
  FieldPath: class {},
  FieldValue: {},
  Timestamp: { now: () => ({}) },
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
jest.mock('@aglyn/shared-util-fbserver', () => ({
  __esModule: true,
  firestoreDatabaseId: () => undefined,
}))
jest.mock('@aglyn/aglyn/server', () => ({ __esModule: true }))

import firebaseAdmin from './firebase-admin'
import {
  TOKEN_REVOCATION_TTL_MS,
  invalidateTokenRevocationCache,
  resetTokenRevocationCache,
  revocationRefuses,
} from './token-revocation'

/** Frozen so the TTL is stepped explicitly rather than raced. */
let clock = now
beforeEach(() => {
  clock = now
  jest.spyOn(Date, 'now').mockImplementation(() => clock)
  projectRecord = userRecord()
  tenantRecord = userRecord()
  projectGetUserError = null
  poolsAsked = []
  verifyArgs = []
  resetTokenRevocationCache()
})
afterEach(() => {
  jest.restoreAllMocks()
})

/** `revokeRefreshTokens` stamps this, as an RFC-1123 string. */
const validAfter = (ms: number) => new Date(ms).toUTCString()

describe('a revoked ID token is refused by the console choke point', () => {
  it('rejects a token issued BEFORE the revocation', async () => {
    // The panic path: `revokeRefreshTokens(uid)` one minute ago, against a
    // token authenticated ten minutes ago and valid for another fifty.
    projectRecord = userRecord({
      tokensValidAfterTime: validAfter(now - 60_000),
    })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })

  it('admits a token issued AFTER the revocation', async () => {
    // The person who signed out the device they are sitting at, then signed
    // back in. Their new `auth_time` postdates the stamp, so the same account
    // is admitted with no support ticket — the AGL-1888 lockout rule.
    projectRecord = userRecord({
      tokensValidAfterTime: validAfter(now - 900_000),
    })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).resolves.toMatchObject({ uid: 'u1' })
  })

  it('admits a token when nothing was ever revoked', async () => {
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).resolves.toMatchObject({ uid: 'u1' })
  })

  it('rejects the token of a DISABLED account', async () => {
    // A user-scope panic lock disables the account and revokes; the disable
    // is the half that survives a clock skew, so it is checked on its own.
    projectRecord = userRecord({ disabled: true })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/user-disabled' })
  })

  it('rejects the token of a DELETED account', async () => {
    projectGetUserError = Object.assign(new Error('nope'), {
      code: 'auth/user-not-found',
    })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })
})

describe('the check is asked of the pool the account lives in (AGL-2005)', () => {
  it('reads the TENANT record for an SSO token, not the project twin', async () => {
    // The project pool would answer "never revoked" for a uid that only
    // really exists inside the GCIP tenant — a forged green.
    tenantRecord = userRecord({
      tokensValidAfterTime: validAfter(now - 60_000),
    })
    const auth = firebaseAdmin.app().auth()
    await expect(
      auth.tenantManager().authForTenant('t1').verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
    expect(poolsAsked).toEqual(['t1'])
  })
})

describe('the cost is bounded by a short TTL, not paid per request', () => {
  it('serves the verdict from cache inside the TTL', async () => {
    await firebaseAdmin.app().auth().verifyIdToken('token')
    await firebaseAdmin.app().auth().verifyIdToken('token')
    await firebaseAdmin.app().auth().verifyIdToken('token')
    expect(poolsAsked).toHaveLength(1)
  })

  it('re-reads once the TTL has passed, so the window really closes', async () => {
    await firebaseAdmin.app().auth().verifyIdToken('token')
    clock += TOKEN_REVOCATION_TTL_MS + 1
    projectRecord = userRecord({
      tokensValidAfterTime: validAfter(now + 1),
    })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
    expect(poolsAsked).toHaveLength(2)
  })

  it('refuses IMMEDIATELY in the process that took the action', async () => {
    // The revoking route invalidates this uid after the write, so the reply
    // to the very next request from that process is already a refusal —
    // the TTL only bounds the OTHER processes.
    await firebaseAdmin.app().auth().verifyIdToken('token')
    projectRecord = userRecord({ tokensValidAfterTime: validAfter(now + 1) })
    invalidateTokenRevocationCache('u1')
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })

  it('does not cache a transport failure, and does not lock the console out', async () => {
    // An unreachable Identity Toolkit is an outage, not a revocation. The
    // failure must also not be remembered, or one blip would blind the check
    // for a full TTL.
    projectGetUserError = Object.assign(new Error('ETIMEDOUT'), {
      code: 'auth/internal-error',
    })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).resolves.toMatchObject({ uid: 'u1' })
    projectGetUserError = null
    projectRecord = userRecord({ tokensValidAfterTime: validAfter(now + 1) })
    await expect(
      firebaseAdmin.app().auth().verifyIdToken('token'),
    ).rejects.toMatchObject({ code: 'auth/id-token-revoked' })
  })
})

describe("Firebase's own checkRevoked still passes through", () => {
  it('forwards an explicit `true` to the SDK', async () => {
    await firebaseAdmin.app().auth().verifyIdToken('token', true)
    expect(verifyArgs[0]).toEqual(['token', true])
  })

  it('does not invent a second argument when the caller passed none', async () => {
    await firebaseAdmin.app().auth().verifyIdToken('token')
    expect(verifyArgs[0]).toEqual(['token'])
  })
})

describe('revocationRefuses', () => {
  it('refuses an undateable token rather than admitting it', () => {
    // Same direction as `deviceRevocationRefuses`: a credential that cannot
    // be shown to postdate the revocation is not shown to be live.
    expect(revocationRefuses({ uid: 'u1' } as never, now)).toBe(true)
  })

  it('is inert when nothing was revoked', () => {
    expect(revocationRefuses(decodedToken() as never, null)).toBe(false)
    expect(revocationRefuses(decodedToken() as never, 0)).toBe(false)
  })

  it('falls back to `iat` when `auth_time` is absent', () => {
    const t = { uid: 'u1', iat: Math.floor((now - 600_000) / 1000) }
    expect(revocationRefuses(t as never, now - 900_000)).toBe(false)
    expect(revocationRefuses(t as never, now - 60_000)).toBe(true)
  })

  it('does not refuse on sub-second rounding', () => {
    // `tokensValidAfterTime` has second granularity and `auth_time` is a
    // whole second; a token minted in the same second as the revoke must not
    // flap between processes over a few hundred milliseconds.
    const authTimeMs = now - 600_000
    const t = { uid: 'u1', auth_time: Math.floor(authTimeMs / 1000) }
    expect(revocationRefuses(t as never, authTimeMs + 400)).toBe(false)
  })
})
