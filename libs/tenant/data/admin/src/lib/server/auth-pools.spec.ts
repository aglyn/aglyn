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
 * AGL-1122. The bug these guard against is not "a lookup returned the wrong
 * user" — it is "a whole pool of users was never asked about", which fails
 * silently and looks exactly like the account not existing. So every case
 * here puts the user ONLY in a tenant pool and asserts they are still found.
 */

const projectUsers = new Map<string, any>()
const tenantUsers = new Map<string, Map<string, any>>()
let tenantListError: Error | null = null

const userRecord = (uid: string, email: string, claims?: any) => ({
  uid,
  email,
  displayName: null,
  disabled: false,
  customClaims: claims,
  metadata: { creationTime: null, lastSignInTime: null },
  providerData: [],
})

const poolApi = (users: Map<string, any>) => ({
  getUserByEmail: jest.fn(async (email: string) => {
    const found = [...users.values()].find((u) => u.email === email)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
  getUser: jest.fn(async (uid: string) => {
    const found = users.get(uid)
    if (!found) {
      const error = new Error('not found') as Error & { code?: string }
      error.code = 'auth/user-not-found'
      throw error
    }
    return found
  }),
  listUsers: jest.fn(async () => ({
    users: [...users.values()],
    pageToken: undefined,
  })),
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      auth: () => ({
        ...poolApi(projectUsers),
        tenantManager: () => ({
          listTenants: jest.fn(async () => {
            if (tenantListError) throw tenantListError
            return {
              tenants: [...tenantUsers.keys()].map((tenantId) => ({
                tenantId,
              })),
              pageToken: undefined,
            }
          }),
          authForTenant: (tenantId: string) =>
            poolApi(tenantUsers.get(tenantId) ?? new Map()),
        }),
      }),
    }),
  },
}))

import {
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
  listStaffUidsAcrossPools,
  listUsersAcrossPools,
  resetAuthTenantCache,
} from './auth-pools'

beforeEach(() => {
  projectUsers.clear()
  tenantUsers.clear()
  tenantListError = null
  resetAuthTenantCache()
})

describe('findUserByEmailAcrossPools (AGL-1122)', () => {
  it('finds a user who exists ONLY in a GCIP tenant pool', async () => {
    // The exact shape that hid the owner of aglyn-org: absent from the
    // project pool, present in the org's SSO tenant.
    tenantUsers.set(
      'aglyn-org-y5v14',
      new Map([['u1', userRecord('u1', 'zach@aglyn.com')]]),
    )
    const found = await findUserByEmailAcrossPools('zach@aglyn.com')
    expect(found?.record.uid).toBe('u1')
    expect(found?.tenantId).toBe('aglyn-org-y5v14')
  })

  it('prefers the project pool and does not consult tenants for it', async () => {
    projectUsers.set('p1', userRecord('p1', 'someone@example.com'))
    tenantUsers.set('t1', new Map())
    const found = await findUserByEmailAcrossPools('someone@example.com')
    expect(found?.tenantId).toBeNull()
    expect(found?.record.uid).toBe('p1')
  })

  it('normalizes the address before looking anywhere', async () => {
    tenantUsers.set('t1', new Map([['u1', userRecord('u1', 'a@b.com')]]))
    expect((await findUserByEmailAcrossPools('  A@B.CoM '))?.record.uid).toBe(
      'u1',
    )
  })

  it('returns null when no pool has the address', async () => {
    tenantUsers.set('t1', new Map())
    expect(await findUserByEmailAcrossPools('nobody@example.com')).toBeNull()
  })

  it('degrades to the project pool when tenant listing fails', async () => {
    // A tenant-listing outage must not break member-add or staff lookup —
    // it should behave like the pre-fix code, not throw.
    tenantListError = new Error('boom')
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    tenantUsers.set('t1', new Map([['u1', userRecord('u1', 'sso@example.com')]]))
    const project = await findUserByEmailAcrossPools('p@example.com')
    expect(project?.record.uid).toBe('p1')
    expect(project?.tenantId).toBeNull()
    // The tenant user becomes unreachable rather than crashing the caller —
    // degraded, not broken. Asserting BOTH halves: a bare "does not throw"
    // would pass even if the project lookup had also stopped working.
    expect(await findUserByEmailAcrossPools('sso@example.com')).toBeNull()
  })
})

describe('findUserByUidAcrossPools (AGL-1122)', () => {
  it('finds a tenant user by uid', async () => {
    tenantUsers.set('t1', new Map([['u9', userRecord('u9', 'x@y.com')]]))
    const found = await findUserByUidAcrossPools('u9')
    expect(found?.tenantId).toBe('t1')
  })

  it('returns null for an unknown uid and for a blank one', async () => {
    expect(await findUserByUidAcrossPools('nope')).toBeNull()
    expect(await findUserByUidAcrossPools('')).toBeNull()
  })
})

describe('listUsersAcrossPools (AGL-1122)', () => {
  it('appends tenant users once the project pool is exhausted', async () => {
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    tenantUsers.set('t1', new Map([['u1', userRecord('u1', 'sso@example.com')]]))
    const page = await listUsersAcrossPools(200)
    expect(page.users.map((entry) => entry.record.uid)).toEqual(['p1', 'u1'])
    expect(page.users.map((entry) => entry.tenantId)).toEqual([null, 't1'])
    expect(page.tenantsIncluded).toBe(true)
    expect(page.tenantTruncated).toEqual([])
  })
})

describe('listStaffUidsAcrossPools (AGL-1122)', () => {
  it('includes a staff member who signs in through SSO', async () => {
    // The silent one: notifyStaff simply never reached these accounts.
    projectUsers.set('p1', userRecord('p1', 'a@x.com', { staff: true }))
    projectUsers.set('p2', userRecord('p2', 'b@x.com'))
    tenantUsers.set(
      't1',
      new Map([
        ['u1', userRecord('u1', 'c@x.com', { staff: true })],
        ['u2', userRecord('u2', 'd@x.com')],
      ]),
    )
    expect((await listStaffUidsAcrossPools()).sort()).toEqual(['p1', 'u1'])
  })

  it('still returns project staff when a tenant scan fails', async () => {
    projectUsers.set('p1', userRecord('p1', 'a@x.com', { staff: true }))
    tenantListError = new Error('boom')
    expect(await listStaffUidsAcrossPools()).toEqual(['p1'])
  })
})
