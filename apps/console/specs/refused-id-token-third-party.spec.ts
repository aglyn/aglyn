/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Response.json` is undefined.
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
 * A 401 speaks for the CALLER's credential, never for a teammate's account
 * (AGL-2796).
 *
 * `invalidIdTokenResponse` maps `auth/user-not-found` and `auth/user-disabled`
 * to 401. That is true of the account behind the bearer token and false of
 * anyone else's. Two routes act on OTHER accounts through Admin Auth inside the
 * same try as the caller's verification:
 *
 *  - `orgs/members/password` sets a teammate's password and revokes their
 *    sessions (`updateUser` / `revokeRefreshTokens` on the target uid);
 *  - `orgs/sso` `enforce-apply` sweeps every member of the SSO pool through
 *    `enforceSsoSignInMethods`, which unlinks providers and revokes sessions.
 *
 * Mapped at the catch, a teammate whose account vanished mid-request would
 * tell the admin THEIR sign-in had ended, and the console reads a 401 as a
 * session that is over. So both routes map verification alone. Each describe
 * below pairs the caller's refusal (401) with a third party's missing account
 * and a verification that broke (both the route's 500), and carries a control
 * that reaches the Admin Auth write, so the 500s cannot pass by never getting
 * there.
 */

const STAFF = {
  uid: 'staff-1',
  email: 'staff@aglyn.com',
  email_verified: true,
  staff: true,
}

/** The caller's verification: resolves to a decoded token, or throws. */
let mockVerifyOutcome: Record<string, unknown> | Error = STAFF
const mockUpdateUser = jest.fn()
const mockRevokeRefreshTokens = jest.fn()
const mockEnforce = jest.fn()

function mockOpenModule(named: Record<string, unknown>): Record<string, unknown> {
  const stubs = new Map<string, jest.Mock>()
  return new Proxy(
    { __esModule: true, ...named },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        if (typeof key !== 'string' || key === 'then') return undefined
        if (!stubs.has(key)) stubs.set(key, jest.fn())
        return stubs.get(key)
      },
    },
  )
}

/** A document snapshot over plain data. */
function mockSnapshot(data: Record<string, unknown>) {
  return { exists: true, data: () => data, get: (key: string) => data[key] }
}

jest.mock('@aglyn/tenant-data-admin', () =>
  mockOpenModule({
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async () => {
            if (mockVerifyOutcome instanceof Error) throw mockVerifyOutcome
            return mockVerifyOutcome
          },
          updateUser: (...args: unknown[]) => mockUpdateUser(...args),
          revokeRefreshTokens: (...args: unknown[]) => mockRevokeRefreshTokens(...args),
        }),
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              get: async () =>
                mockSnapshot({
                  name: 'Acme',
                  ownerUid: 'owner-1',
                  sso: { tenantId: 'acme-pool', providerId: 'saml.acme', status: 'active' },
                }),
              set: async () => undefined,
              collection: () => ({
                doc: () => ({
                  get: async () => mockSnapshot({ displayName: 'Teammate', role: 'editor' }),
                }),
              }),
            }),
          }),
        }),
      }),
    },
    findUserByUidAcrossPools: async () => ({
      record: { uid: 'member-1', email: 'member@example.com' },
      tenantId: null,
    }),
    enforceSsoSignInMethods: (...args: unknown[]) => mockEnforce(...args),
    lockdownRefusal: async () => null,
    resolveOrgMembership: async () => null,
  }),
)

jest.mock('@aglyn/aglyn/server', () =>
  mockOpenModule({
    pluginRequestFromWeb: (request: Request) =>
      (
        jest.requireActual('@aglyn/aglyn/app-utils/api-adapter') as {
          pluginRequestFromWeb: (r: Request) => Promise<unknown>
        }
      ).pluginRequestFromWeb(request),
    checkEntitlement: () => true,
    resolveIdpDisplayName: () => 'Staff Person',
  }),
)

jest.mock('../app/api/_lib/password-admin', () =>
  mockOpenModule({
    blockedReasonForOrgSetPassword: async () => null,
    originFromHeaders: () => 'https://app.aglyn.com',
    validateNewPassword: (password: unknown) => ({ password: String(password) }),
    sendPasswordChangedNotice: async () => true,
    sendAuthPasswordResetEmail: async () => true,
  }),
)

import * as passwordRoute from '../app/api/orgs/members/password/route'
import * as ssoRoute from '../app/api/orgs/sso/route'

const { IdTokenRevokedError, UserDisabledError } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/token-revocation',
) as typeof import('../../../libs/tenant/data/admin/src/lib/server/token-revocation')

const authError = (code: string, message: string) =>
  Object.assign(new Error(message), { code })

/** Gone between the roster read and the write — a teammate's account, not the caller's. */
const teammateGone = () =>
  authError(
    'auth/user-not-found',
    'There is no user record corresponding to the provided identifier.',
  )

const CALLER_REFUSED: [string, () => Error][] = [
  ['a deleted account', () => new IdTokenRevokedError('The user record no longer exists.')],
  ['a disabled account', () => new UserDisabledError()],
  ['an expired token', () => authError('auth/id-token-expired', 'Firebase ID token has expired.')],
]

const certOutage = () =>
  authError(
    'auth/argument-error',
    'Error fetching public keys for Google certs: connect ETIMEDOUT',
  )

function request(path: string, body: unknown): Request {
  return new Request(`https://app.aglyn.com${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer caller-id-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockVerifyOutcome = STAFF
  mockUpdateUser.mockReset().mockResolvedValue({})
  mockRevokeRefreshTokens.mockReset().mockResolvedValue(undefined)
  mockEnforce.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('orgs/members/password setPassword (AGL-2796)', () => {
  const setPassword = () =>
    passwordRoute.POST(
      request('/api/orgs/members/password', {
        orgId: 'org-1',
        uid: 'member-1',
        action: 'setPassword',
        password: 'a-long-enough-password',
      }),
    )

  it('CONTROL — reaches the teammate write for a caller whose token verifies', async () => {
    const response = await setPassword()
    expect(response.status).toBe(200)
    expect(mockUpdateUser).toHaveBeenCalledWith('member-1', {
      password: 'a-long-enough-password',
    })
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('member-1')
  })

  it.each(CALLER_REFUSED)('answers 401 for the caller’s %s', async (_label, makeError) => {
    mockVerifyOutcome = makeError()
    const response = await setPassword()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthenticated' })
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('keeps the 500 when the teammate’s account is gone at the password write', async () => {
    mockUpdateUser.mockRejectedValue(teammateGone())
    const response = await setPassword()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Password operation failed' })
  })

  it('keeps the 500 when revoking the teammate’s sessions finds no account', async () => {
    mockRevokeRefreshTokens.mockRejectedValue(teammateGone())
    const response = await setPassword()
    expect(response.status).toBe(500)
  })

  it('keeps the 500 when the caller’s verification could not run', async () => {
    mockVerifyOutcome = certOutage()
    const response = await setPassword()
    expect(response.status).toBe(500)
    expect(mockUpdateUser).not.toHaveBeenCalled()
  })
})

describe('orgs/sso enforce-apply (AGL-2796)', () => {
  const enforce = () =>
    ssoRoute.POST(
      request('/api/orgs/sso', { orgId: 'org-1', action: 'enforce-apply', confirm: true }),
    )

  beforeEach(() => {
    // The rehearsal passes; the real sweep is what each case decides.
    mockEnforce.mockResolvedValueOnce({ lockout: { safe: true } })
  })

  it('CONTROL — reaches the member sweep for a caller whose token verifies', async () => {
    mockEnforce.mockResolvedValueOnce({ changedUids: ['member-1'] })
    const response = await enforce()
    expect(response.status).toBe(200)
    expect(mockEnforce).toHaveBeenCalledTimes(2)
    expect(mockEnforce).toHaveBeenLastCalledWith('org-1', { actorUid: 'staff-1' })
  })

  it.each(CALLER_REFUSED)('answers 401 for the caller’s %s', async (_label, makeError) => {
    mockVerifyOutcome = makeError()
    const response = await enforce()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthenticated' })
    expect(mockEnforce).not.toHaveBeenCalled()
  })

  it('keeps the 500 when a member’s account vanishes mid-sweep', async () => {
    mockEnforce.mockRejectedValueOnce(teammateGone())
    const response = await enforce()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Single sign-on update failed' })
  })

  it('keeps the 500 when the caller’s verification could not run', async () => {
    mockVerifyOutcome = certOutage()
    const response = await enforce()
    expect(response.status).toBe(500)
    expect(mockEnforce).not.toHaveBeenCalled()
  })
})
