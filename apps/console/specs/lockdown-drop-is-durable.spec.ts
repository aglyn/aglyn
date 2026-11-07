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

// A module, so its top-level names do not collide with sibling specs'.
export {}

/**
 * IS A LOCKDOWN'S CACHE DROP DURABLE? (AGL-4121) — the real lock cores,
 * `applyHostLockdown` and `applyOrgLockdown`, with only the drop spied on.
 *
 * A host lock lives on the host doc, and the tenant's lockdown verdict reads
 * that doc through the cache the drop expires. With the render's copy of that
 * doc on the week-long backstop, a lost drop would have left a taken-down site
 * serving for days, and a lost drop on an unlock would have left a restored
 * site dark as long. So every lock and every lift must ask for a DURABLE drop
 * (staged in the publish outbox, retried by the drain, loud when lost); how
 * `durable` works is `durable-plugin-drops.spec.ts`'s subject, not this one's.
 */

const mockDrops: Array<{ hostId: string; options: Record<string, unknown> }> = []
let mockDropThrows = false
const mockDeleteSentinel = Symbol('FieldValue.delete')

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => 'ts',
    delete: () => mockDeleteSentinel,
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  listOrgMembers: async () => [],
  findUserByUidAcrossPools: async () => null,
  authForPool: () => ({ revokeRefreshTokens: async () => undefined }),
  invalidateTokenRevocationCache: () => undefined,
  lockRotatesDownloadTokens: () => false,
  rotateScopeDownloadTokens: async () => [],
}))

jest.mock('../utils/server/tenant-revalidate', () => ({
  __esModule: true,
  revalidateEntireHost: async (
    _firestore: unknown,
    hostId: string,
    options: Record<string, unknown> = {},
  ) => {
    mockDrops.push({ hostId, options })
    if (mockDropThrows) throw new Error('outbox unreachable')
    return { hostId, attempted: true, revalidated: [], reason: 'ok', pathsDropped: 1 }
  },
}))

let store: Record<string, Record<string, unknown>> = {}

function docRef(path: string): Record<string, unknown> {
  return {
    path,
    set: async (data: Record<string, unknown>) => {
      const next = { ...(store[path] ?? {}) }
      for (const [key, value] of Object.entries(data)) {
        if (value === mockDeleteSentinel) delete next[key]
        else next[key] = value
      }
      store[path] = next
    },
    get: async () => ({
      exists: Boolean(store[path]),
      get: (field: string) => store[path]?.[field],
      data: () => store[path],
    }),
  }
}

const firestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
  batch: () => {
    const queued: Array<() => Promise<void>> = []
    return {
      set: (ref: { set: (data: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => {
        queued.push(() => ref.set(data))
      },
      update: (ref: { set: (data: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => {
        queued.push(() => ref.set(data))
      },
      commit: async () => {
        for (const write of queued) await write()
      },
    }
  },
} as never

const { applyHostLockdown, applyOrgLockdown } =
  require('../utils/server/org-lockdown') as {
    applyHostLockdown: (options: Record<string, unknown>) => Promise<{
      revalidated: { ok: boolean; reason: string }
    }>
    applyOrgLockdown: (options: Record<string, unknown>) => Promise<{
      revalidated: Array<{ hostId: string; ok: boolean }>
    }>
  }

beforeEach(() => {
  mockDrops.length = 0
  mockDropThrows = false
  store = { 'orgs/org-acme': { hosts: { 'host-one': true, 'host-two': true } } }
})

describe('a site lock or lift asks for a durable drop', () => {
  it.each(['lock', 'unlock'] as const)('host %s: staged in the outbox, naming why', async (action) => {
    await applyHostLockdown({
      firestore,
      hostId: 'host-one',
      action,
      lock: { reason: 'abuse' },
    })
    expect(mockDrops).toEqual([
      {
        hostId: 'host-one',
        options: { durable: { reason: `site ${action}ed` } },
      },
    ])
  })

  it('writes the lock BEFORE the drop, so a regeneration reads it', async () => {
    let lockedWhenDropped: unknown
    const realPush = mockDrops.push.bind(mockDrops)
    mockDrops.push = (...items) => {
      lockedWhenDropped = store['hosts/host-one']?.['suspendedAt']
      return realPush(...items)
    }
    try {
      await applyHostLockdown({ firestore, hostId: 'host-one', action: 'lock' })
    } finally {
      mockDrops.push = realPush
    }
    expect(typeof lockedWhenDropped).toBe('number')
  })

  it('a drop that throws never undoes or hides the lock', async () => {
    mockDropThrows = true
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await applyHostLockdown({
      firestore,
      hostId: 'host-one',
      action: 'lock',
    })
    expect(result.revalidated).toEqual({ hostId: 'host-one', ok: false, reason: 'error' })
    expect(store['hosts/host-one']?.['suspendedAt']).toEqual(expect.any(Number))
  })
})

describe('a workspace lock or lift asks for a durable drop on every site', () => {
  it.each(['lock', 'unlock'] as const)('org %s', async (action) => {
    await applyOrgLockdown({
      firestore,
      orgId: 'org-acme',
      action,
      lock: { reason: 'abuse' },
      revokeMemberTokens: false,
    })
    // Premise: both sites were found, so an empty list cannot pass.
    expect(mockDrops.map((drop) => drop.hostId).sort()).toEqual(['host-one', 'host-two'])
    for (const drop of mockDrops) {
      expect(drop.options).toEqual({ durable: { reason: `workspace ${action}ed` } })
    }
  })
})
