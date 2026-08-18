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
  /**
   * Paginates for real (AGL-1962). This used to ignore `pageSize` and
   * `pageToken` and hand back every user with no token, which made the
   * pagination ordering in `listUsersAcrossPools` untestable: no page could
   * ever carry a cursor, so the early return before the tenant loop was
   * never taken and no assertion about repeated pages could fail. A double
   * that cannot express the shape of the bug cannot guard against it.
   */
  listUsers: jest.fn(async (pageSize?: number, pageToken?: string) => {
    const all = [...users.values()]
    const start = pageToken ? Number(pageToken) : 0
    const size = pageSize ?? all.length
    const slice = all.slice(start, start + size)
    const next = start + size
    return {
      users: slice,
      // Firebase omits the token on the last page — that absence is the
      // signal `listUsersAcrossPools` keys the tenant append off.
      pageToken: next < all.length ? String(next) : undefined,
    }
  }),
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
  markCrossPoolUidCollisions,
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

  /**
   * AGL-1962. Zach saw an SSO account listed twice. One candidate cause was
   * the tenant pools being re-appended on every page: the staff page appends
   * each new page to the ones already loaded, so a tenant user attached to
   * more than one page would be re-listed once per "Load more".
   *
   * The tenant append is guarded behind the project pool being exhausted,
   * and these hold that guard in place. Forced red by deleting the
   * `if (page.pageToken) return { ... }` early return in
   * `listUsersAcrossPools`: the first assertion then reports
   * ['p1','p2','sso1'] instead of ['p1','p2'], and the concatenation below
   * carries 'sso1' twice.
   */
  it('withholds tenant users from every page but the last', async () => {
    projectUsers.set('p1', userRecord('p1', 'p1@example.com'))
    projectUsers.set('p2', userRecord('p2', 'p2@example.com'))
    projectUsers.set('p3', userRecord('p3', 'p3@example.com'))
    tenantUsers.set(
      't1',
      new Map([['sso1', userRecord('sso1', 'sso@example.com')]]),
    )
    const first = await listUsersAcrossPools(2)
    expect(first.users.map((entry) => entry.record.uid)).toEqual(['p1', 'p2'])
    expect(first.tenantsIncluded).toBe(false)
    expect(first.nextPageToken).not.toBeNull()
  })

  it('lists an SSO account exactly once across repeated pagination', async () => {
    for (const uid of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      projectUsers.set(uid, userRecord(uid, `${uid}@example.com`))
    }
    tenantUsers.set(
      't1',
      new Map([['sso1', userRecord('sso1', 'sso@example.com')]]),
    )
    // Exactly what the page does: keep loading while a cursor comes back,
    // appending each payload to the rows already on screen.
    const accumulated: string[] = []
    let token: string | null | undefined
    let pages = 0
    do {
      const page = await listUsersAcrossPools(2, token ?? undefined)
      accumulated.push(...page.users.map((entry) => entry.record.uid))
      token = page.nextPageToken
      pages += 1
    } while (token && pages < 10)

    expect(pages).toBeGreaterThan(2)
    expect(accumulated.filter((uid) => uid === 'sso1')).toHaveLength(1)
    expect(accumulated).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'sso1'])
  })

  /**
   * The other half of the guard, and the one that matters most: two people
   * who share an address across pools are two accounts, not one row shown
   * twice. Deduplicating by email would "fix" the reported symptom by
   * deleting a real user from the staff console — strictly worse than the
   * bug, and invisible until someone cannot find an account.
   *
   * Forced red by keying the returned rows on `record.email`.
   */
  it('keeps two DISTINCT accounts that share an email across pools', async () => {
    projectUsers.set('p1', userRecord('p1', 'shared@example.com'))
    tenantUsers.set(
      't1',
      new Map([['t1u1', userRecord('t1u1', 'shared@example.com')]]),
    )
    const page = await listUsersAcrossPools(200)
    expect(page.users.map((entry) => entry.record.uid)).toEqual(['p1', 't1u1'])
    expect(page.users.map((entry) => entry.tenantId)).toEqual([null, 't1'])
    // Distinct uids in distinct pools, so nothing to flag — the collision
    // marker must not fire merely because an address repeats.
    expect(page.users.every((entry) => !entry.uidAlsoInPools)).toBe(true)
  })

  /**
   * The shape actually found on production: ONE uid in TWO pools, because
   * `/api/presence/token` minted an SSO user's GCIP-tenant uid against the
   * project pool and `signInWithCustomToken` created the missing account
   * rather than refusing. Both records are real; both stay listed; each is
   * told which other pool holds its twin.
   *
   * Forced red by dropping the `markCrossPoolUidCollisions` call from
   * `listUsersAcrossPools` — both `uidAlsoInPools` assertions then read
   * undefined.
   */
  it('flags one uid living in two pools instead of merging the rows', async () => {
    const uid = 'QQ7fixtureUid0000000000000001'
    // The project copy is the empty shadow: no address at all, which is why
    // the staff page fell back to printing its uid.
    projectUsers.set(uid, userRecord(uid, undefined as any))
    tenantUsers.set(
      'aglyn-org-y5v14',
      new Map([[uid, userRecord(uid, 'zach@aglyn.com')]]),
    )
    const page = await listUsersAcrossPools(200)

    expect(page.users).toHaveLength(2)
    expect(page.users.map((entry) => entry.tenantId)).toEqual([
      null,
      'aglyn-org-y5v14',
    ])
    // Each row names the OTHER pool, never its own.
    expect(page.users[0].uidAlsoInPools).toEqual(['aglyn-org-y5v14'])
    expect(page.users[1].uidAlsoInPools).toEqual([null])
  })
})

describe('markCrossPoolUidCollisions (AGL-1962)', () => {
  const entry = (uid: string, tenantId: string | null) =>
    ({ record: { uid } as any, tenantId }) as any

  it('leaves ordinary rows untouched', () => {
    const marked = markCrossPoolUidCollisions([
      entry('a', null),
      entry('b', 't1'),
    ])
    expect(marked.every((row) => !row.uidAlsoInPools)).toBe(true)
  })

  it('reports every other pool when a uid is in three', () => {
    const marked = markCrossPoolUidCollisions([
      entry('a', null),
      entry('a', 't1'),
      entry('a', 't2'),
    ])
    expect(marked[0].uidAlsoInPools).toEqual(['t1', 't2'])
    expect(marked[1].uidAlsoInPools).toEqual([null, 't2'])
    expect(marked[2].uidAlsoInPools).toEqual([null, 't1'])
  })

  it('never drops a row', () => {
    const marked = markCrossPoolUidCollisions([
      entry('a', null),
      entry('a', 't1'),
      entry('b', null),
    ])
    expect(marked.map((row) => row.record.uid)).toEqual(['a', 'a', 'b'])
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
