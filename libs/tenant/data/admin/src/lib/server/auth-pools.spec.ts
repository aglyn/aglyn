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
/**
 * Which pools a `getUser` was actually asked of, in order (AGL-2005). The
 * doubles are rebuilt per call — `authForTenant` returns a fresh object every
 * time — so a `jest.fn` on one of them cannot answer "did the lookup consult
 * the tenants at all". This can, and the fast-path guard depends on it: a
 * version that swept every tenant on every lookup would still return the
 * right record and pass every other assertion here.
 */
let poolsAsked: (string | null)[] = []

/**
 * Every `listUsers` the sweeps made, by pool, and how many were open at once.
 *
 * The count alone cannot tell a serial sweep from a concurrent one — both ask
 * each pool exactly once, and both return the same users. Only the OVERLAP
 * separates them, so the double holds each call open for a turn of the event
 * loop and records the peak. A sweep that awaits each pool before starting the
 * next can never push the peak above 1.
 */
let listUsersCalls: (string | null)[] = []
let listUsersInFlight = 0
let listUsersPeakInFlight = 0

/** Yields the event loop, so calls that COULD overlap actually do. */
const holdOpen = () => new Promise((resolve) => setTimeout(resolve, 0))

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
 * The production shape of the forgery (AGL-1962): no address, no provider
 * entry, nothing but a uid. `signInWithCustomToken` manufactures exactly this
 * when a token is minted against a pool the uid does not live in.
 */
const shadowRecord = (uid: string) => ({
  ...userRecord(uid, undefined as any),
  providerData: [],
})

/** A real sign-in leaves provider data behind; the forgery never can. */
const ssoRecord = (uid: string, email: string) => ({
  ...userRecord(uid, email),
  providerData: [{ providerId: 'saml.aglyn-workspace' }],
})

const poolApi = (users: Map<string, any>, poolId: string | null = null) => ({
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
    poolsAsked.push(poolId)
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
    listUsersCalls.push(poolId)
    listUsersInFlight += 1
    listUsersPeakInFlight = Math.max(listUsersPeakInFlight, listUsersInFlight)
    try {
      // Held open deliberately: a call that returns synchronously never
      // overlaps another, so a serial sweep would be indistinguishable from a
      // concurrent one and the peak assertion could not fail.
      await holdOpen()
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
    } finally {
      listUsersInFlight -= 1
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
            poolApi(tenantUsers.get(tenantId) ?? new Map(), tenantId),
        }),
      }),
    }),
  },
}))

import {
  collapseCrossPoolUidRows,
  findUserByEmailAcrossPools,
  findUserByUidAcrossPools,
  identityStrength,
  isIdentifiedUserRecord,
  listStaffUidsAcrossPools,
  listUsersAcrossPools,
  markCrossPoolUidCollisions,
  resetAuthTenantCache,
  scanUsersAcrossPools,
} from './auth-pools'

beforeEach(() => {
  projectUsers.clear()
  tenantUsers.clear()
  tenantListError = null
  poolsAsked = []
  listUsersCalls = []
  listUsersInFlight = 0
  listUsersPeakInFlight = 0
  resetAuthTenantCache()
})

describe('findUserByEmailAcrossPools (AGL-1122)', () => {
  it('finds a user who exists ONLY in a GCIP tenant pool', async () => {
    // The exact shape that hid the owner of aglyn-org: absent from the
    // project pool, present in the org's SSO tenant.
    tenantUsers.set(
      'aglyn-org-y5v14',
      new Map([['u1', userRecord('u1', 'staff@aglyn.com')]]),
    )
    const found = await findUserByEmailAcrossPools('staff@aglyn.com')
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

  /**
   * AGL-2005, and the half that actually matters. A tidy staff list that
   * still routes `grantStaff` / `disable` / `revokeRefreshTokens` to a ghost
   * is worse than two honest rows.
   *
   * This is the production shape: one uid present in the
   * project pool with nothing on it, and the same uid in `aglyn-org-y5v14`
   * carrying `staff@aglyn.com` and the SAML provider. The old lookup returned
   * the project pool's answer because it asked first, so every staff action
   * on that person mutated the forgery — a `revokeRefreshTokens` really did
   * land there on 2026-08-14 while the real account's sessions stayed live.
   *
   * Forced red by restoring the old first-answer-wins body
   * (`try { return { record: await auth().getUser(uid), tenantId: null } }`):
   * `tenantId` reads null and `record.email` undefined.
   */
  it('returns the IDENTIFIED record, not whichever pool answers first', async () => {
    const uid = 'SsoTenantUidFixture000000000'
    projectUsers.set(uid, shadowRecord(uid))
    tenantUsers.set(
      'aglyn-org-y5v14',
      new Map([[uid, ssoRecord(uid, 'staff@aglyn.com')]]),
    )
    const found = await findUserByUidAcrossPools(uid)
    expect(found?.tenantId).toBe('aglyn-org-y5v14')
    expect(found?.record.email).toBe('staff@aglyn.com')
    // And it says the twin exists, so a caller is never silently redirected.
    expect(found?.uidAlsoInPools).toEqual([null])
  })

  /**
   * The cost guard. Preferring the identified record must not turn every uid
   * lookup into a sweep of every enterprise tenant — this runs on sign-in,
   * billing and erasure paths. A normal project account is answered by the
   * project pool alone.
   *
   * Forced red by deleting the `isIdentifiedUserRecord` early return in the
   * project branch: `poolsAsked` then reads [null, 't1', 't2'].
   */
  it('answers an ordinary project account without consulting any tenant', async () => {
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    tenantUsers.set('t1', new Map())
    tenantUsers.set('t2', new Map())
    const found = await findUserByUidAcrossPools('p1')
    expect(found?.tenantId).toBeNull()
    expect(poolsAsked).toEqual([null])
  })

  /**
   * An emailless, providerless account is not always a forgery — anonymous
   * and half-created accounts look identical. When no pool has anything
   * better, the project record is still the answer. Being stricter here would
   * 404 exactly the half-deleted accounts erasure exists to clean up.
   */
  it('still returns an unidentified project record when nothing better exists', async () => {
    projectUsers.set('anon', shadowRecord('anon'))
    tenantUsers.set('t1', new Map())
    const found = await findUserByUidAcrossPools('anon')
    expect(found?.record.uid).toBe('anon')
    expect(found?.tenantId).toBeNull()
    // It looked, though — that is the difference from the old code.
    expect(poolsAsked).toEqual([null, 't1'])
  })

  /**
   * A provider entry identifies a record even with no address on it — phone
   * auth is the ordinary case. Gating on email alone would send every
   * phone-only account through the tenant sweep.
   */
  it('treats a provider entry with no email as an identity', async () => {
    projectUsers.set('ph', {
      ...shadowRecord('ph'),
      providerData: [{ providerId: 'phone' }],
    })
    tenantUsers.set('t1', new Map())
    await findUserByUidAcrossPools('ph')
    expect(poolsAsked).toEqual([null])
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
   * AGL-1962, one of two ways an SSO account gets listed twice: the tenant
   * pools being re-appended on every page. The staff page appends
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
      new Map([[uid, userRecord(uid, 'staff@aglyn.com')]]),
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

/**
 * AGL-2005. **decided:** "We still have two users list in this list
 * with the same uid but one without an email attached, this needs fixed we
 * should only see one user, even if they are sso."
 *
 * AGL-1962 refused to merge because merging can hide an identity split. That
 * objection is answered by WHAT this keys on, not by declining to merge: uid
 * collisions are an artifact of our own cross-pool mint and merge; two
 * distinct accounts are two people and never do. The email control below is
 * the one that keeps that honest, and it is the test that must fail if anyone
 * ever "simplifies" this to dedupe on address.
 */
describe('collapseCrossPoolUidRows (AGL-2005)', () => {
  const uid = 'SsoTenantUidFixture000000000'
  const row = (record: any, tenantId: string | null) => ({ record, tenantId })

  /**
   * Guard 1. Forced red by inverting the comparison in the winner loop to
   * `<`: the surviving row's email reads undefined and its tenantId null —
   * the emailless forgery displayed as the person, which is the whole bug.
   */
  it('collapses one uid in two pools to ONE row, and keeps the identified one', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(shadowRecord(uid), null),
      row(ssoRecord(uid, 'staff@aglyn.com'), 'aglyn-org-y5v14'),
    ])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].record.email).toBe('staff@aglyn.com')
    expect(collapsed[0].tenantId).toBe('aglyn-org-y5v14')
  })

  /** Order of arrival must not decide it — the same pair, listed the other way. */
  it('picks the identified record whichever order the pools arrive in', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(ssoRecord(uid, 'staff@aglyn.com'), 'aglyn-org-y5v14'),
      row(shadowRecord(uid), null),
    ])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].record.email).toBe('staff@aglyn.com')
  })

  /**
   * Guard 2. Merged is not hidden. Collapsing the twin rows is a display
   * decision; a merge that records nothing is indistinguishable from a real
   * duplicate being quietly dropped.
   *
   * Forced red by having `collapseCrossPoolUidRows` skip its internal
   * `markCrossPoolUidCollisions` call: `uidAlsoInPools` reads undefined and
   * the console loses every trace that a second record exists.
   */
  it('leaves the collision visible on the row it keeps', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(shadowRecord(uid), null),
      row(ssoRecord(uid, 'staff@aglyn.com'), 'aglyn-org-y5v14'),
    ])
    expect(collapsed[0].uidAlsoInPools).toEqual([null])
  })

  /**
   * Guard 3 — THE CONTROL, and the reason this is safe to ship. Two genuinely
   * distinct accounts that happen to share an address are two people. Keying
   * the merge on email instead of uid would delete one of them from the staff
   * console: the reported symptom would disappear and a real user would go
   * with it, invisibly, until somebody could not find an account.
   *
   * Forced red by keying `winnerByUid` / `emitted` on `record.email` instead
   * of `record.uid` — the result collapses to a single row and `p1` is gone.
   */
  it('keeps two DISTINCT accounts that share an email as two rows', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(userRecord('p1', 'shared@example.com'), null),
      row(userRecord('t1u1', 'shared@example.com'), 't1'),
    ])
    expect(collapsed.map((entry) => entry.record.uid)).toEqual(['p1', 't1u1'])
    expect(collapsed.map((entry) => entry.tenantId)).toEqual([null, 't1'])
    // Distinct uids collide with nothing, so nothing is marked either.
    expect(collapsed.every((entry) => !entry.uidAlsoInPools)).toBe(true)
  })

  it('leaves an ordinary list completely alone', () => {
    const rows = [
      row(userRecord('a', 'a@x.com'), null),
      row(userRecord('b', 'b@x.com'), 't1'),
    ]
    const collapsed = collapseCrossPoolUidRows(rows)
    expect(collapsed.map((entry) => entry.record.uid)).toEqual(['a', 'b'])
    expect(collapsed.every((entry) => !entry.uidAlsoInPools)).toBe(true)
  })

  it('holds the first occurrence position so the list does not reshuffle', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(userRecord('a', 'a@x.com'), null),
      row(shadowRecord(uid), null),
      row(userRecord('z', 'z@x.com'), null),
      row(ssoRecord(uid, 'staff@aglyn.com'), 'aglyn-org-y5v14'),
    ])
    expect(collapsed.map((entry) => entry.record.uid)).toEqual([
      'a',
      uid,
      'z',
    ])
    // Position of the first copy, content of the identified one.
    expect(collapsed[1].record.email).toBe('staff@aglyn.com')
  })

  it('reduces a uid found in three pools to one row and names both others', () => {
    const collapsed = collapseCrossPoolUidRows([
      row(shadowRecord(uid), null),
      row(shadowRecord(uid), 't1'),
      row(ssoRecord(uid, 'staff@aglyn.com'), 't2'),
    ])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].tenantId).toBe('t2')
    expect(collapsed[0].uidAlsoInPools).toEqual([null, 't1'])
  })

  /**
   * The staff list composed exactly as `/api/admin/users` composes it: the
   * honest primitive still returns both records, and the display merges them.
   * the report was about the list, so the list is where it is asserted.
   */
  it('gives the staff list ONE row for the production shape', async () => {
    projectUsers.set(uid, shadowRecord(uid))
    tenantUsers.set(
      'aglyn-org-y5v14',
      new Map([[uid, ssoRecord(uid, 'staff@aglyn.com')]]),
    )
    const page = await listUsersAcrossPools(200)
    // The data layer still reports both — nothing is destroyed upstream.
    expect(page.users).toHaveLength(2)
    const rows = collapseCrossPoolUidRows(page.users)
    expect(rows).toHaveLength(1)
    expect(rows[0].record.email).toBe('staff@aglyn.com')
    expect(rows[0].uidAlsoInPools).toEqual([null])
  })
})

describe('isIdentifiedUserRecord / identityStrength (AGL-2005)', () => {
  it('rejects the forgery shape and accepts a real sign-in', () => {
    expect(isIdentifiedUserRecord(shadowRecord('x') as any)).toBe(false)
    expect(isIdentifiedUserRecord(ssoRecord('x', 'a@b.com') as any)).toBe(true)
    expect(isIdentifiedUserRecord(userRecord('x', 'a@b.com') as any)).toBe(true)
  })

  /**
   * The load-bearing exclusion. `updateProfile` and `grantStaff` both write to
   * whatever record the uid lookup returned — so while the shadow was winning,
   * it could acquire a displayName and a staff claim. If either counted as an
   * identity the forgery would go on winning after being acted upon, and the
   * fix would decay silently the first time staff touched it.
   */
  it('does not let a displayName or a staff claim launder a forgery', () => {
    const dressed = {
      ...shadowRecord('x'),
      displayName: 'Zach Gover',
      customClaims: { staff: true, staffRole: 'super' },
    }
    expect(isIdentifiedUserRecord(dressed as any)).toBe(false)
    // And it still loses the merge to the record with the actual address.
    expect(identityStrength(dressed as any)).toBeLessThan(
      identityStrength(ssoRecord('x', 'staff@aglyn.com') as any),
    )
  })

  it('scores an empty record at zero', () => {
    expect(identityStrength(shadowRecord('x') as any)).toBe(0)
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

/**
 * The cross-pool sweeps ask every GCIP tenant the same question, and each
 * enterprise customer signed adds a pool. Asked in series that is `N` round
 * trips, so the staff list degrades with exactly the thing the SSO feature is
 * for; asked together it is one.
 *
 * These assert the NUMBER and the OVERLAP of the Auth calls, never the rows.
 * A row assertion cannot see the difference — a serial sweep returns the same
 * users — so a spec written against the output would pass on the shape it was
 * written to kill.
 *
 * Nothing here relaxes completeness. Every case checks the users too: a sweep
 * that got fast by asking fewer pools is a worse bug than a slow one, because
 * a staff member is told an account does not exist when it does.
 */
describe('cross-pool sweeps are concurrent, and still complete', () => {
  const seedTenants = (count: number) => {
    for (let index = 1; index <= count; index += 1) {
      const id = `t${index}`
      tenantUsers.set(
        id,
        new Map([[`${id}u`, userRecord(`${id}u`, `${id}@example.com`)]]),
      )
    }
  }

  /**
   * Forced red by restoring the serial `for (const tenantId of ...)` loop in
   * `listUsersAcrossPools`: the peak assertion then reports 1, not 5.
   */
  it('asks all five tenant pools at once, once each', async () => {
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    seedTenants(5)

    const page = await listUsersAcrossPools(200)

    // Completeness first: every pool's user is present and correctly labeled.
    expect(page.users.map((entry) => entry.record.uid)).toEqual([
      'p1', 't1u', 't2u', 't3u', 't4u', 't5u',
    ])
    expect(page.tenantsIncluded).toBe(true)
    expect(page.tenantTruncated).toEqual([])

    // One call per tenant pool — not fewer (a pool skipped) and not more
    // (a pool asked twice, which is what a naive concurrency fix does when it
    // re-reads the tenant id list per worker).
    expect(listUsersCalls.filter((pool) => pool !== null)).toEqual([
      't1', 't2', 't3', 't4', 't5',
    ])
    // The whole point: all five were open together.
    expect(listUsersPeakInFlight).toBe(5)
  })

  /**
   * Concurrency is bounded, not unbounded. Identity Platform rate limits
   * `listUsers` per project, so one in-flight call per enterprise customer
   * would trade a latency problem for a `RESOURCE_EXHAUSTED` one at the
   * customer count where latency stopped being the issue.
   *
   * Forced red by replacing `mapPoolsConcurrently` with a bare
   * `Promise.all(tenantIds.map(...))`: the peak then reports 20, not 8.
   */
  it('holds concurrency at the bound with twenty pools, and still reads them all', async () => {
    seedTenants(20)

    const page = await listUsersAcrossPools(200)

    expect(page.users).toHaveLength(20)
    expect(listUsersCalls.filter((pool) => pool !== null)).toHaveLength(20)
    expect(listUsersPeakInFlight).toBeLessThanOrEqual(8)
    // And it is actually concurrent rather than accidentally serial.
    expect(listUsersPeakInFlight).toBeGreaterThan(1)
  })

  /**
   * The filtered path, which is the one that runs per request rather than
   * per last page. Forced red by restoring the serial loop in
   * `scanUsersAcrossPools`: the peak reports 1.
   */
  it('sweeps the pools concurrently when a staff filter scans them', async () => {
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    seedTenants(4)

    const scan = await scanUsersAcrossPools(2000)

    expect(scan.users.map((entry) => entry.record.uid)).toEqual([
      'p1', 't1u', 't2u', 't3u', 't4u',
    ])
    expect(scan.truncated).toBe(false)
    expect(scan.tenantTruncated).toEqual([])
    expect(listUsersPeakInFlight).toBe(4)
  })

  /**
   * The cap still binds, and a pool cut short still SAYS it was cut short.
   * Sizing each pool's page from the running total is what forced the old
   * sweep into a series; a fixed budget gives the same rows because a larger
   * page can only be a superset of the shrinking one.
   *
   * Forced red by dropping the `rows.length > room` arm that pushes onto
   * `tenantTruncated`: `tenantTruncated` then comes back empty while rows are
   * silently discarded — a scan reporting "no such account" for people it
   * fetched and threw away.
   */
  it('trims to the cap in pool order and names the pool it cut', async () => {
    projectUsers.set('p1', userRecord('p1', 'p@example.com'))
    tenantUsers.set(
      't1',
      new Map([
        ['t1a', userRecord('t1a', 't1a@example.com')],
        ['t1b', userRecord('t1b', 't1b@example.com')],
      ]),
    )
    tenantUsers.set(
      't2',
      new Map([['t2a', userRecord('t2a', 't2a@example.com')]]),
    )

    // Room for the project user and both of t1's, and nothing for t2's.
    const scan = await scanUsersAcrossPools(3)

    expect(scan.users.map((entry) => entry.record.uid)).toEqual([
      'p1', 't1a', 't1b',
    ])
    expect(scan.truncated).toBe(true)
    // t2 was read and discarded, so the caller must be told its pool is not
    // represented rather than being left to read the absence as "empty".
    expect(scan.tenantTruncated).toContain('t2')
  })

  /**
   * Staff notification fan-out. Within a pool the paging stays serial — each
   * cursor comes from the page before it — so only the pools overlap.
   *
   * Forced red by restoring the serial `for (const tenantId of ...)` loop in
   * `listStaffUidsAcrossPools`: the peak reports 1.
   */
  it('scans staff pools concurrently and returns them in pool order', async () => {
    projectUsers.set('p1', userRecord('p1', 'a@x.com', { staff: true }))
    for (const id of ['t1', 't2', 't3']) {
      tenantUsers.set(
        id,
        new Map([[`${id}s`, userRecord(`${id}s`, `${id}@x.com`, { staff: true })]]),
      )
    }

    const uids = await listStaffUidsAcrossPools()

    // Ordered by POOL, not by which pool answered first. A caller diffing
    // this against a stored copy would otherwise see a change every run.
    expect(uids).toEqual(['p1', 't1s', 't2s', 't3s'])
    // All four pools — the project one and all three tenants — open together.
    // Deliberately not `> 1`: the project scan already runs alongside the
    // tenant sweep, so a serial tenant loop still reaches 2 and an assertion
    // written that way would pass on the shape it exists to reject.
    expect(listUsersPeakInFlight).toBe(4)
  })
})
