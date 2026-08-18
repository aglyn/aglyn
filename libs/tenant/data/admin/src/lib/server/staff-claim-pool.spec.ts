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
 * A staff grant must land in the pool the target actually lives in (AGL-1993).
 *
 * The failure being guarded is silent: `setCustomUserClaims` is per-pool, so a
 * grant aimed at the project pool for a tenant user either throws
 * `user-not-found` or — when a phantom shadow record shares the uid — succeeds
 * against the WRONG record while the real identity gets nothing. The staff
 * console then shows the grant, and the person still gets a 404.
 *
 * Every assertion therefore checks BOTH sides: the intended pool received the
 * claim AND the other pool did not.
 */

const projectUsers = new Map<string, any>()
const tenantUsers = new Map<string, Map<string, any>>()

const userRecord = (uid: string, email: string, claims?: any) => ({
  uid,
  email,
  displayName: null,
  disabled: false,
  customClaims: claims,
  metadata: { creationTime: null, lastSignInTime: null },
  providerData: [],
})

/**
 * Models the real per-pool semantics: `setCustomUserClaims` REPLACES the claim
 * object (it is not a merge), and throws `auth/user-not-found` for a uid this
 * pool does not hold. A double that silently accepted an unknown uid would
 * fabricate a green for exactly the bug under test.
 */
const poolApi = (users: Map<string, any>) => ({
  getUser: jest.fn(async (uid: string) => {
    const found = users.get(uid)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
  getUserByEmail: jest.fn(async (email: string) => {
    const found = [...users.values()].find((u) => u.email === email)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
  listUsers: jest.fn(async () => ({ users: [...users.values()], pageToken: undefined })),
  setCustomUserClaims: jest.fn(async (uid: string, claims: any) => {
    const found = users.get(uid)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    found.customClaims = claims
  }),
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      auth: () => ({
        ...poolApi(projectUsers),
        tenantManager: () => ({
          listTenants: jest.fn(async () => ({
            tenants: [...tenantUsers.keys()].map((tenantId) => ({ tenantId })),
            pageToken: undefined,
          })),
          authForTenant: (tenantId: string) =>
            poolApi(tenantUsers.get(tenantId) ?? new Map()),
        }),
      }),
    }),
  },
}))

import { resetAuthTenantCache, setClaimsInOwningPool } from './auth-pools'

const AGLYN_TENANT = 'aglyn-org-y5v14'
const CUSTOMER_TENANT = 'customer-co-8x21p'
const STAFF = { staff: true, staffRole: 'super' }

const claimsIn = (pool: Map<string, any> | undefined, uid: string) =>
  pool?.get(uid)?.customClaims ?? null

beforeEach(() => {
  projectUsers.clear()
  tenantUsers.clear()
  resetAuthTenantCache()
})

describe('a staff grant lands in the pool the identity lives in', () => {
  it("grants to Aglyn's SSO tenant identity, and the project pool receives nothing", async () => {
    // The live shape: zach@aglyn.com exists ONLY in the SAML tenant.
    tenantUsers.set(
      AGLYN_TENANT,
      new Map([['sso-uid', userRecord('sso-uid', 'zach@aglyn.com')]]),
    )
    const write = await setClaimsInOwningPool('sso-uid', STAFF)

    expect(write?.tenantId).toBe(AGLYN_TENANT)
    expect(claimsIn(tenantUsers.get(AGLYN_TENANT), 'sso-uid')).toEqual(STAFF)
    // The negative half — without it, a grant that wrote to BOTH pools would
    // pass, and "which record is authoritative" would be undefined.
    expect(claimsIn(projectUsers, 'sso-uid')).toBeNull()
  })

  it('grants to a CUSTOMER org tenant identity — staff is not restricted to one pool', async () => {
    tenantUsers.set(
      CUSTOMER_TENANT,
      new Map([['cust-uid', userRecord('cust-uid', 'staffer@customer-co.example')]]),
    )
    const write = await setClaimsInOwningPool('cust-uid', STAFF)

    expect(write?.tenantId).toBe(CUSTOMER_TENANT)
    expect(claimsIn(tenantUsers.get(CUSTOMER_TENANT), 'cust-uid')).toEqual(STAFF)
  })

  it('grants to a project-pool identity — the permanent break-glass shape', async () => {
    projectUsers.set(
      'break-glass',
      userRecord('break-glass', 'zachary.w.gover@gmail.com'),
    )
    tenantUsers.set(AGLYN_TENANT, new Map())
    const write = await setClaimsInOwningPool('break-glass', STAFF)

    expect(write?.tenantId).toBeNull()
    expect(claimsIn(projectUsers, 'break-glass')).toEqual(STAFF)
  })

  it('finds the identity even when it is in the THIRD pool checked', async () => {
    // Never assume a pool: enumerate. A grant path that knew only two pools
    // would miss this one entirely.
    tenantUsers.set(AGLYN_TENANT, new Map())
    tenantUsers.set(CUSTOMER_TENANT, new Map())
    tenantUsers.set(
      'third-org-zzz',
      new Map([['third-uid', userRecord('third-uid', 'someone@third.example')]]),
    )
    const write = await setClaimsInOwningPool('third-uid', STAFF)

    expect(write?.tenantId).toBe('third-org-zzz')
    expect(claimsIn(tenantUsers.get('third-org-zzz'), 'third-uid')).toEqual(STAFF)
  })

  it('returns null for a uid in no pool, rather than reporting a phantom success', async () => {
    tenantUsers.set(AGLYN_TENANT, new Map())
    expect(await setClaimsInOwningPool('nobody', STAFF)).toBeNull()
  })

  it('revoking also targets the owning pool', async () => {
    tenantUsers.set(
      AGLYN_TENANT,
      new Map([['sso-uid', userRecord('sso-uid', 'zach@aglyn.com', STAFF)]]),
    )
    await setClaimsInOwningPool('sso-uid', { staff: false })
    expect(claimsIn(tenantUsers.get(AGLYN_TENANT), 'sso-uid')).toEqual({
      staff: false,
    })
  })
})

describe('the phantom shadow record (AGL-1962) is reported, not silently preferred', () => {
  it('the SSO identity wins even while the shadow still exists (AGL-2005)', async () => {
    // Both pools hold the SAME uid — the state measured on production on
    // 2026-08-18, where `IHumyGGhGxZKjVV26qCRx5Okf573` existed in the project
    // pool and in `aglyn-org-y5v14` at once.
    //
    // This test used to pin the OPPOSITE outcome and called it "the
    // documented hazard": the project pool was checked first, so the empty
    // shadow won every lookup and a staff grant landed on it while the real
    // SSO identity got nothing — the 404-after-a-successful-grant that cost
    // two investigations.
    //
    // AGL-2005 fixed it. `findUserByUidAcrossPools` no longer returns the
    // first pool to answer: an UNIDENTIFIED record (no email, no provider —
    // exactly what a shadow looks like) is held as a fallback rather than
    // returned, so an identified tenant record outranks it. Deleting the
    // shadow is now remediation of a duplicate row, not a prerequisite for
    // grants working at all.
    //
    // Kept as an assertion rather than deleted with the hazard: this is where
    // a regression in pool precedence surfaces, and precedence is the whole
    // mechanism.
    projectUsers.set('dual-uid', userRecord('dual-uid', null as any))
    tenantUsers.set(
      AGLYN_TENANT,
      new Map([['dual-uid', userRecord('dual-uid', 'zach@aglyn.com')]]),
    )
    const write = await setClaimsInOwningPool('dual-uid', STAFF)

    expect(write?.tenantId).toBe(AGLYN_TENANT)
    expect(claimsIn(tenantUsers.get(AGLYN_TENANT), 'dual-uid')).toEqual(STAFF)
    // The negative half: the shadow must NOT also receive the grant, or
    // "which record is authoritative" is undefined again.
    expect(claimsIn(projectUsers, 'dual-uid')).toBeNull()
  })

  it('once the shadow is deleted, the same grant reaches the SSO identity', async () => {
    // The positive control for the case above — proves the remediation works
    // and that the test is measuring the shadow, not something else.
    tenantUsers.set(
      AGLYN_TENANT,
      new Map([['dual-uid', userRecord('dual-uid', 'zach@aglyn.com')]]),
    )
    const write = await setClaimsInOwningPool('dual-uid', STAFF)

    expect(write?.tenantId).toBe(AGLYN_TENANT)
    expect(claimsIn(tenantUsers.get(AGLYN_TENANT), 'dual-uid')).toEqual(STAFF)
  })
})
