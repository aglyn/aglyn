/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 */

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
 * The staff self-check must diagnose the caller WITHOUT becoming an
 * enumeration surface (AGL-1993). Two properties, both tested:
 *
 *  - it answers only about the caller's own verified address;
 *  - it never tells a stranger anything about anyone else's staff grant.
 */

const mockTokens = new Map<string, any>()
const mockProjectUsers = new Map<string, any>()
const mockTenantUsers = new Map<string, Map<string, any>>()

const mockUserRecord = (uid: string, email: string, claims?: any) => ({
  uid,
  email,
  customClaims: claims,
})

const mockPoolApi = (users: Map<string, any>) => ({
  getUserByEmail: jest.fn(async (email: string) => {
    const found = [...users.values()].find((u) => u.email === email)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // Models the REAL predicate, byte for byte with
  // `firebase-admin.ts:370` — `typeof decoded['impersonatedBy'] === 'string'`.
  // An impersonation session is exempt from the email-verification gate
  // (AGL-480) because staff have already authenticated and the act is audited.
  // A double that always returned false would make the two unverified cases
  // below pass for the wrong reason, and one keyed on an invented claim name
  // would silently never fire.
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded?.['impersonatedBy'] === 'string',
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: jest.fn(async (token: string) => {
          const decoded = mockTokens.get(token)
          if (!decoded) throw new Error('invalid token')
          return decoded
        }),
      }),
    }),
  },
  listAuthTenantIds: jest.fn(async () => [...mockTenantUsers.keys()]),
  authForPool: (tenantId: string | null) =>
    mockPoolApi(tenantId ? (mockTenantUsers.get(tenantId) ?? new Map()) : mockProjectUsers),
}))

import { GET } from '../app/api/auth/staff-self-check/route'

const AGLYN_TENANT = 'aglyn-org-y5v14'

const call = (token?: string) =>
  GET(
    new Request('https://app.aglyn.com/api/auth/staff-self-check', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

beforeEach(() => {
  mockTokens.clear()
  mockProjectUsers.clear()
  mockTenantUsers.clear()
})

describe('authentication', () => {
  it('401s with no Bearer token', async () => {
    expect((await call()).status).toBe(401)
  })

  it('401s on an unverifiable token', async () => {
    expect((await call('garbage')).status).toBe(401)
  })
})

describe('it diagnoses the caller, and only the caller', () => {
  it('tells an SSO staff member their claim is present and names the pool', async () => {
    mockTokens.set('t', { email_verified: true,
      uid: 'sso-uid',
      email: 'staff@aglyn.com',
      staff: true,
      staffRole: 'super',
      firebase: { tenant: AGLYN_TENANT },
    })
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['sso-uid', mockUserRecord('sso-uid', 'staff@aglyn.com', {
          staff: true,
          staffRole: 'super',
        })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(true)
    expect(body.staffRole).toBe('super')
    expect(body.tenantId).toBe(AGLYN_TENANT)
    expect(body.hint).toBeNull()
    // The record they are signed in as must be marked `current`. Without this
    // assertion the flag is unguarded, and a self-check that recognised
    // nobody's own record would still pass every other case here.
    expect(body.identities).toEqual([
      { tenantId: AGLYN_TENANT, staff: true, staffRole: 'super', current: true },
    ])
  })

  it('tells a user whose OWN address holds staff in another pool which one', async () => {
    // The shape that cost two investigations: signed in as the wrong one of
    // your own identities.
    mockTokens.set('t', { email_verified: true,
      uid: 'proj-uid',
      email: 'someone@example.com',
      firebase: {},
    })
    mockProjectUsers.set(
      'proj-uid',
      mockUserRecord('proj-uid', 'someone@example.com', {}),
    )
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['sso-uid', mockUserRecord('sso-uid', 'someone@example.com', { staff: true })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(false)
    expect(body.hint).toContain('single sign-on')
    expect(body.identities).toHaveLength(2)
  })

  it('gives a plain non-staff answer with NO hint when no identity holds staff', async () => {
    // The stranger case. They learn they are not staff — which the 404
    // already told them — and nothing else.
    mockTokens.set('t', { email_verified: true,
      uid: 'nobody',
      email: 'stranger@example.com',
      firebase: {},
    })
    mockProjectUsers.set('nobody', mockUserRecord('nobody', 'stranger@example.com', {}))
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        ['staff-uid', mockUserRecord('staff-uid', 'staff@aglyn.com', { staff: true, staffRole: 'super' })],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.staff).toBe(false)
    expect(body.hint).toBeNull()
    // The critical negative: somebody ELSE's staff grant is not disclosed.
    expect(body.identities).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('staff@aglyn.com')
  })

  it('does not leak another address even when the caller asks about theirs', async () => {
    mockTokens.set('t', { email_verified: true, uid: 'u', email: 'a@example.com', firebase: {} })
    mockProjectUsers.set('u', mockUserRecord('u', 'a@example.com', {}))
    mockProjectUsers.set('other', mockUserRecord('other', 'b@example.com', { staff: true }))
    const body = await (await call('t')).json()
    expect(JSON.stringify(body)).not.toContain('b@example.com')
    expect(body.hint).toBeNull()
  })

  /**
   * AGL-1881. The docblock promised the cross-pool disclosure was "limited to
   * identities sharing THEIR OWN verified address"; nothing enforced the word
   * "verified", and — the part worth recording — EVERY fixture in this file
   * was an unverified token until this test was written. The suite was
   * exercising the vulnerable path exclusively and passing, which is why the
   * `email_verified: true` above had to be added to five cases at the same
   * time as this one was added below.
   *
   * Firebase allows one address per pool, so the project pool blocks an
   * attacker from claiming an address it already holds. An address that lives
   * only in a GCIP tenant — every SSO-only enterprise user — is claimable by
   * ordinary self-signup, and the sweep then reported which tenants hold it
   * and whether it carries staff.
   */
  it('discloses no other pool to a caller whose address is unverified', async () => {
    mockTokens.set('t', {
      uid: 'squatter',
      email: 'staff@aglyn.com',
      email_verified: false,
      firebase: {},
    })
    mockProjectUsers.set(
      'squatter',
      mockUserRecord('squatter', 'staff@aglyn.com', {}),
    )
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        [
          'staff-uid',
          mockUserRecord('staff-uid', 'staff@aglyn.com', {
            staff: true,
            staffRole: 'super',
          }),
        ],
      ]),
    )
    const body = await (await call('t')).json()
    // The sweep does not run at all, so the SSO-only staff record stays dark.
    expect(body.identities).toEqual([])
    expect(body.hint).toBeNull()
    expect(JSON.stringify(body)).not.toContain(AGLYN_TENANT)
    // The route still does its actual job: answering "am I staff".
    expect(body.staff).toBe(false)
  })

  it('still answers "am I staff" from the token when the address is unverified', async () => {
    // The gate is on the FAN-OUT, not the route. A staff member who has not
    // verified must not be locked out of their own answer.
    mockTokens.set('t', {
      uid: 'u',
      email: 'a@example.com',
      email_verified: false,
      staff: true,
      firebase: {},
    })
    const body = await (await call('t')).json()
    expect(body.staff).toBe(true)
    expect(body.staffRole).toBe('support')
  })

  it('an impersonation session keeps the sweep, unverified or not', async () => {
    // AGL-480: staff have already authenticated and the act is audited, so
    // the impersonated account's own verification state is not the gate.
    // Without this case the fix would silently break support's diagnosis of
    // exactly the accounts they are called in to diagnose.
    mockTokens.set('t', {
      uid: 'staff-uid',
      email: 'staff@aglyn.com',
      email_verified: false,
      impersonatedBy: 'staff-uid',
      firebase: {},
    })
    mockTenantUsers.set(
      AGLYN_TENANT,
      new Map([
        [
          'staff-uid',
          mockUserRecord('staff-uid', 'staff@aglyn.com', {
            staff: true,
            staffRole: 'super',
          }),
        ],
      ]),
    )
    const body = await (await call('t')).json()
    expect(body.identities).toHaveLength(1)
  })

  it('a missing staffRole on a staff token reads as support, not super', async () => {
    // Mirrors AGL-495: the routes fail closed to the least-privileged role,
    // and a self-check that guessed `super` would contradict them.
    mockTokens.set('t', { email_verified: true, uid: 'u', email: 'a@example.com', staff: true, firebase: {} })
    mockProjectUsers.set('u', mockUserRecord('u', 'a@example.com', { staff: true }))
    const body = await (await call('t')).json()
    expect(body.staffRole).toBe('support')
  })
})
