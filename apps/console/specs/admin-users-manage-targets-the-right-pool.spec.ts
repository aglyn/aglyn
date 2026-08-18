/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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

export {}

/**
 * AGL-2005 — a staff action lands in the pool the person actually signs in to.
 *
 * Collapsing the staff list to one row per human is only half the fix. A tidy
 * list that still routes `grantStaff` / `disable` / `setPassword` to a ghost is
 * worse than two honest rows: it looks like it worked. AGL-1962 measured the
 * consequence on production — a `revokeRefreshTokens` dated 2026-08-14 sitting
 * on the forged project-pool twin while `zach@aglyn.com`'s own
 * `tokensValidAfterTime` never moved, so "sign out everywhere" did nothing.
 *
 * `findUserByUidAcrossPools` now returns the identified record (guarded in
 * `auth-pools.spec.ts`). What that cannot show is whether this route then ACTS
 * on the pool that lookup named. Every mutation here must go through
 * `authForPool(found.tenantId)`; the project-level `auth` is for verifying the
 * CALLER's token and nothing else. The two are indistinguishable in a review
 * — both are called `auth` — and the difference is invisible at runtime for
 * every non-SSO account, which is why it survived.
 *
 * So each pool records what it was asked to do, and every assertion checks
 * BOTH that the tenant pool got the call and that the project pool did not.
 * Asserting only the first would pass a route that wrote to both.
 */

const SSO_TENANT = 'aglyn-org-y5v14'
const TARGET_UID = 'IHumyGGhGxZKjVV26qCRx5Okf573'

/**
 * Every mutation attempted, tagged with the pool it was attempted on.
 * `mock`-prefixed because jest hoists the factory below above every const in
 * this file, and only that prefix is allowed through the hoist check.
 */
let mockCalls: string[] = []
const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => {
  const serverTimestamp = () => 'SERVER_TIMESTAMP'
  /** A recording auth surface. `pool` is null for the project pool. */
  const recordingPool = (pool: string | null) => {
    const tag = pool ?? 'PROJECT'
    return {
      setCustomUserClaims: async (uid: string, claims: any) => {
        mockCalls.push(
          `${tag}:setCustomUserClaims:${uid}:staff=${claims.staff}`,
        )
      },
      updateUser: async (uid: string, update: any) => {
        mockCalls.push(
          `${tag}:updateUser:${uid}:${Object.keys(update).sort().join(',')}`,
        )
      },
      revokeRefreshTokens: async (uid: string) => {
        mockCalls.push(`${tag}:revokeRefreshTokens:${uid}`)
      },
    }
  }
  const targetRecord = {
    uid: 'IHumyGGhGxZKjVV26qCRx5Okf573',
    email: 'zach@aglyn.com',
    displayName: null,
    photoURL: null,
    disabled: false,
    customClaims: {},
    providerData: [{ providerId: 'saml.aglyn-workspace' }],
    metadata: { creationTime: null, lastSignInTime: null },
  }
  return {
    __esModule: true,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
          ...recordingPool(null),
        }),
        firestore: () => ({
          collection: () => ({
            add: async () => undefined,
            doc: () => ({ set: async () => undefined }),
          }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp } },
    },
    emailUnverifiedResponse: () =>
      Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
    // The fixed lookup: the SSO record, not the emailless project twin.
    findUserByUidAcrossPools: async () => ({
      record: targetRecord,
      tenantId: 'aglyn-org-y5v14',
      uidAlsoInPools: [null],
    }),
    authForPool: (tenantId: string | null) => recordingPool(tenantId ?? null),
    eraseUser: async () => ({ ok: true, deleted: {} }),
    consumePasswordResetSend: async () => ({ allowed: true }),
    passwordResetThrottleMessage: () => '',
  }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
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

jest.mock('../app/api/_lib/password-admin', () => ({
  __esModule: true,
  originFromHeaders: () => 'https://console.aglyn.com',
  sendAuthPasswordResetEmail: async () => true,
  sendPasswordChangedNotice: async () => true,
  validateNewPassword: () => ({ password: 'a-new-password' }),
}))

const { POST } = require('../app/api/admin/users/manage/route')

async function manage(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request('https://console.aglyn.com/api/admin/users/manage', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer staff-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uid: TARGET_UID, ...body }),
    }),
  )
}

beforeEach(() => {
  mockCalls = []
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('AGL-2005 · staff actions land in the identified account’s pool', () => {
  it('grants staff in the SSO tenant pool, never the project pool', async () => {
    expect((await manage({ action: 'grantStaff' })).status).toBe(200)
    expect(mockCalls).toContain(
      `${SSO_TENANT}:setCustomUserClaims:${TARGET_UID}:staff=true`,
    )
    // A claim set on the project pool cannot reach a tenant user at all, so
    // the console would report success and grant nothing.
    expect(mockCalls.some((call) => call.startsWith('PROJECT:'))).toBe(false)
  })

  it('disables the account in the SSO tenant pool', async () => {
    expect((await manage({ action: 'disable' })).status).toBe(200)
    expect(mockCalls).toContain(
      `${SSO_TENANT}:updateUser:${TARGET_UID}:disabled`,
    )
    expect(mockCalls.some((call) => call.startsWith('PROJECT:'))).toBe(false)
  })

  /**
   * The one that was actually broken. `updateUser` used `targetAuth` while
   * `revokeRefreshTokens` used the project-level `auth` one line later, so for
   * an SSO account the password changed and every existing session kept
   * working on the old credential — "changed the password" without "took back
   * the account", which is the entire point of the revocation.
   *
   * Forced red by restoring `await auth.revokeRefreshTokens(uid)`: the
   * revocation is recorded against PROJECT and both assertions below fail.
   */
  it('revokes sessions in the pool whose password it just changed', async () => {
    expect(
      (await manage({ action: 'setPassword', password: 'a-new-password' }))
        .status,
    ).toBe(200)
    expect(mockCalls).toContain(
      `${SSO_TENANT}:revokeRefreshTokens:${TARGET_UID}`,
    )
    expect(mockCalls).not.toContain(
      `PROJECT:revokeRefreshTokens:${TARGET_UID}`,
    )
    // Both halves of the operation in the same pool, or it is half-done.
    expect(mockCalls).toContain(
      `${SSO_TENANT}:updateUser:${TARGET_UID}:password`,
    )
  })

  it('edits the profile in the SSO tenant pool', async () => {
    expect(
      (await manage({ action: 'updateProfile', displayName: 'Zach Gover' }))
        .status,
    ).toBe(200)
    expect(
      mockCalls.some(
        (call) => call.startsWith(`${SSO_TENANT}:updateUser:`),
      ),
    ).toBe(true)
    expect(mockCalls.some((call) => call.startsWith('PROJECT:'))).toBe(false)
  })
})
