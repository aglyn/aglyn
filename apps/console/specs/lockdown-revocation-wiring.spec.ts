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
 * THE REVOCATION ITSELF (AGL-1724) — `applyOrgLockdown` unmocked.
 *
 * The runbook's mode table says member sessions are revoked under a `full`
 * lock with reason `security`/`manual` and **never revoked** under read-only.
 * Three specs already assert the half of that which lives in the staff route:
 * `lockdown-read-only-mode.spec.ts` drives /api/admin/lockdown and checks the
 * `revokeMemberTokens` ARGUMENT it computes. Every one of those specs reaches
 * that assertion by `jest.mock`ing `../utils/server/org-lockdown` away — so
 * the module that actually calls `revokeRefreshTokens` had no test at all, and
 * "read-only never revokes" rested on an argument nobody proved was obeyed.
 *
 * That is the `feedback_verify_control_is_wired` shape pointed the other way:
 * not a control nothing calls, but a call whose callee nothing checked. A
 * one-word edit inside the fan-out loop — dropping the
 * `options.revokeMemberTokens` conjunct, or hoisting the `slice` above it —
 * would sign an entire workspace out during a maintenance window and leave
 * all three existing specs green.
 *
 * The pair is the point, and neither half means anything alone:
 *
 *  - read-only + reason `security` revokes NOTHING. `security` is chosen
 *    deliberately: it is the reason that DOES revoke under a full lock, so a
 *    pass discriminates on the MODE rather than on a mild reason;
 *  - full + reason `security` DOES revoke, which is what stops the first
 *    assertion from being satisfied by a revocation path that is simply
 *    broken for everyone.
 *
 * It also pins the fact that makes non-revocation SAFE rather than merely
 * intended: a read-only lock still writes `orgSuspended: true` onto every
 * member, and that projection is what `orgNotSuspended()` in
 * cloud/firebase-firestore.rules gates client writes on. The write freeze is
 * enforced by the rules and by the wired chokepoints; the session is not the
 * mechanism, which is exactly why keeping it costs nothing.
 */

const mockRevoked: string[] = []
const mockPools: string[] = []
let mockMembers: Array<Record<string, unknown>> = []
let mockClaims: Record<string, Record<string, unknown>> = {}
/** uids `findUserByUidAcrossPools` reports as having no auth account. */
let mockMissingAuth = new Set<string>()

// `mock`-prefixed because jest hoists the factory above every const: an
// out-of-band name here throws at transform time, not at assertion time.
const mockDeleteSentinel = Symbol('FieldValue.delete')
const mockServerTimestamp = Symbol('FieldValue.serverTimestamp')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => mockServerTimestamp,
    delete: () => mockDeleteSentinel,
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  listOrgMembers: async () => mockMembers,
  findUserByUidAcrossPools: async (uid: string) =>
    mockMissingAuth.has(uid)
      ? null
      : {
          tenantId: uid.startsWith('sso-') ? 'pool-sso' : null,
          record: { uid, customClaims: mockClaims[uid] ?? {} },
        },
  authForPool: (tenantId: string | null) => ({
    revokeRefreshTokens: async (uid: string) => {
      mockPools.push(String(tenantId))
      mockRevoked.push(uid)
    },
  }),
}))

/**
 * A Firestore double with the semantics this module actually depends on
 * (`feedback_a_test_double_must_model_real_semantics`):
 *
 *  - `set(…, { merge: true })` CONJURES a missing document rather than
 *    throwing the way `update()` would — the org doc and every member doc are
 *    written that way, and a double that threw would fabricate a red;
 *  - a `FieldValue.delete()` value REMOVES the key instead of storing a
 *    sentinel, which is the difference between an unlocked org and one whose
 *    `suspendedAt` reads as a truthy object forever;
 *  - `batch.set` is deferred until `commit()`, so a spec can tell a written
 *    projection from an intended one.
 */
let store: Record<string, Record<string, unknown>> = {}

function applyMerge(path: string, data: Record<string, unknown>): void {
  const next = { ...(store[path] ?? {}) }
  for (const [key, value] of Object.entries(data)) {
    if (value === mockDeleteSentinel) delete next[key]
    else next[key] = value
  }
  store[path] = next
}

interface DocRef {
  path: string
  set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>
  get: () => Promise<{
    exists: boolean
    get: (field: string) => unknown
    data: () => Record<string, unknown> | undefined
  }>
  collection: (name: string) => { doc: (id: string) => DocRef }
}

function docRef(path: string): DocRef {
  return {
    path,
    set: async (data, options) => {
      if (options?.merge) applyMerge(path, data)
      else store[path] = { ...data }
    },
    get: async () => {
      const data = store[path] ? { ...store[path] } : undefined
      return {
        exists: data !== undefined,
        get: (field: string) => data?.[field],
        data: () => data,
      }
    },
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
  }
}

let committedBatches = 0

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  batch: () => {
    const queued: Array<() => void> = []
    return {
      set: (
        ref: DocRef,
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        queued.push(() => {
          if (options?.merge) applyMerge(ref.path, data)
          else store[ref.path] = { ...data }
        })
      },
      commit: async () => {
        committedBatches += 1
        for (const write of queued) write()
      },
    }
  },
} as never

// `require` rather than `import`: the jest.mock factories above must be
// installed before the module under test resolves its own imports.
const { applyOrgLockdown } = require('../utils/server/org-lockdown') as {
  applyOrgLockdown: (options: Record<string, unknown>) => Promise<{
    membersUpdated: number
    tokensRevoked: number
    revokeTruncated: boolean
    revalidated: unknown[]
  }>
}

const ORG = 'org-acme'

/** Arm a lock through the real four-effect core. */
const lock = (mode: 'full' | 'read-only', reason: string) =>
  applyOrgLockdown({
    firestore,
    orgId: ORG,
    action: 'lock',
    lock: { reason, mode },
    // What the staff route computes at /api/admin/lockdown: read-only never
    // revokes, whatever the reason. Restated here rather than imported so a
    // change to the route cannot silently redefine what this spec asserts.
    revokeMemberTokens:
      mode !== 'read-only' && (reason === 'security' || reason === 'manual'),
  })

beforeEach(() => {
  store = {
    [`orgs/${ORG}`]: { name: 'Acme' },
  }
  mockRevoked.length = 0
  mockPools.length = 0
  committedBatches = 0
  mockClaims = {}
  mockMissingAuth = new Set()
  mockMembers = [
    { $id: 'member-a', role: 'owner' },
    { $id: 'sso-member-b', role: 'editor' },
  ]
  // No `hosts` key on the org doc, deliberately: the revalidation fan-out
  // must never be able to reach the network from a unit spec, and an empty
  // host list is the only guarantee that survives a leaked REVALIDATE_SECRET
  // (`feedback_nx_test_env_leak`).
})

describe('AGL-1724 · read-only never revokes member sessions', () => {
  it('revokes NOTHING under a read-only lock, even for reason security', async () => {
    const result = await lock('read-only', 'security')
    expect(mockRevoked).toEqual([])
    expect(result.tokensRevoked).toBe(0)
    expect(result.revokeTruncated).toBe(false)
    // The lock is real, not a no-op that trivially revokes nothing.
    expect(store[`orgs/${ORG}`]['suspendedAt']).toBe(mockServerTimestamp)
    expect(store[`orgs/${ORG}`]['suspendedMode']).toBe('read-only')
  })

  it('DOES revoke under a full lock with the same reason — the paired positive', async () => {
    // Without this, the assertion above passes just as well against a
    // revocation path that is broken for every mode.
    const result = await lock('full', 'security')
    expect(mockRevoked.sort()).toEqual(['member-a', 'sso-member-b'])
    expect(result.tokensRevoked).toBe(2)
    // Pool-aware: the SSO member's revoke goes to their own pool, not the
    // project pool, or an SSO org's "everyone out" would miss half the roster.
    expect(mockPools.sort()).toEqual(['null', 'pool-sso'])
    expect(store[`orgs/${ORG}`]['suspendedMode']).toBeUndefined()
  })

  it('keeps sessions under a full lock whose reason is billing or maintenance', async () => {
    await lock('full', 'billing')
    expect(mockRevoked).toEqual([])
    await lock('full', 'maintenance')
    expect(mockRevoked).toEqual([])
  })

  it('freezes writes through the projection in BOTH modes — why keeping the session is safe', async () => {
    // `orgSuspended` is what `orgNotSuspended()` in the Firestore rules gates
    // every client-direct write on (besigner saves included). It is written
    // for a read-only lock exactly as for a full one, which is the whole
    // reason a surviving session is a READ capability and not a write one.
    await lock('read-only', 'security')
    expect(store[`orgs/${ORG}/members/member-a`]).toEqual({ orgSuspended: true })
    expect(store[`orgs/${ORG}/members/sso-member-b`]).toEqual({
      orgSuspended: true,
    })
    expect(committedBatches).toBe(1)
  })

  it('lifts the projection on unlock, and revokes nothing on the way out', async () => {
    await lock('full', 'security')
    mockRevoked.length = 0
    await applyOrgLockdown({
      firestore,
      orgId: ORG,
      action: 'unlock',
      // The route cannot validate a reason on a lift, so it passes the
      // literal string "undefined" here. Even with the revoke flag set, an
      // unlock must never revoke — signing everyone out while READMITTING
      // them is the one combination that helps nobody.
      revokeMemberTokens: true,
    })
    expect(mockRevoked).toEqual([])
    expect(store[`orgs/${ORG}`]['suspendedAt']).toBeUndefined()
    expect(store[`orgs/${ORG}`]['suspendedMode']).toBeUndefined()
    expect(store[`orgs/${ORG}/members/member-a`]).toEqual({
      orgSuspended: false,
    })
  })

  it('never revokes a staff session on the roster, in either mode', async () => {
    // The un-panic invariant's fan-out twin: staff bypass every scope, so a
    // staff account that happens to be on a locked org's roster must not be
    // the one identity the lockdown succeeds in logging out.
    mockClaims['member-a'] = { staff: true }
    await lock('full', 'security')
    expect(mockRevoked).toEqual(['sso-member-b'])
  })

  it('survives a member with no auth account without stranding the rest', async () => {
    mockMissingAuth.add('member-a')
    const result = await lock('full', 'manual')
    expect(mockRevoked).toEqual(['sso-member-b'])
    expect(result.tokensRevoked).toBe(1)
    expect(result.membersUpdated).toBe(2)
  })

  it('reports truncation rather than silently cutting the tail', async () => {
    mockMembers = Array.from({ length: 201 }, (_, index) => ({
      $id: `member-${index}`,
    }))
    const result = await lock('full', 'security')
    expect(result.tokensRevoked).toBe(200)
    expect(result.revokeTruncated).toBe(true)
    // Every member is still projected as suspended — the ENFORCEMENT covers
    // the whole roster even when the courtesy logout does not.
    expect(result.membersUpdated).toBe(201)
    expect(store[`orgs/${ORG}/members/member-200`]).toEqual({
      orgSuspended: true,
    })
  })

  it('does not claim truncation for a read-only lock over the same roster', async () => {
    // `revokeTruncated` is conditioned on the revoke flag; a read-only lock of
    // a 201-member org revoked nothing, and reporting "we only got to 200 of
    // them" would describe a fan-out that never ran.
    mockMembers = Array.from({ length: 201 }, (_, index) => ({
      $id: `member-${index}`,
    }))
    const result = await lock('read-only', 'security')
    expect(result.revokeTruncated).toBe(false)
    expect(mockRevoked).toEqual([])
  })
})
