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
 * @jest-environment jsdom
 */

/**
 * AGL-3428: a background tab frozen partway through an IndexedDB transaction
 * holds every store the SDK uses, so no other tab can run the lease election,
 * read the cache, queue a write, or even start. The AGL-3373 network cycle
 * queues behind the same stuck operation and never finishes.
 *
 * The fake IndexedDB below models the two shapes production showed: the
 * `owner` store locked (a read-only request that never lands until the
 * frozen tab is released), and a lease row held by a tab that stopped
 * renewing it. The client's network calls hang, as they do behind the lock.
 * What must hold: the tab recovers on its own onto the memory cache, a healthy
 * tab never does, and a tab already on the fallback never loops.
 */

import { memoryLocalCache, persistentLocalCache } from 'firebase/firestore'

import { firestoreCacheClassFor, localCacheFor } from './firestore-cache'
import {
  createWedgeEscalation,
  fallBackToMemoryCache,
  memoryCacheFallbackActive,
  MEMORY_CACHE_FALLBACK_KEY,
  MEMORY_CACHE_FALLBACK_TTL_MS,
  probePrimaryLease,
  readMemoryCacheFallback,
  STALE_PRIMARY_LEASE_MS,
  wedgeEvidenceFrom,
  type WedgeEvidence,
} from './firestore-multitab-wedge'
import { createStallRecovery } from './firestore-stall-recovery'

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  disableNetwork: jest.fn(),
  enableNetwork: jest.fn(),
  memoryLocalCache: jest.fn(() => ({ kind: 'memory' })),
  memoryLruGarbageCollector: jest.fn(() => ({ kind: 'memoryLru' })),
  persistentLocalCache: jest.fn(() => ({ kind: 'persistent' })),
  persistentMultipleTabManager: jest.fn(() => ({ kind: 'PERSISTENT_MULTIPLE_TAB' })),
}))

const DATABASE = 'firestore/DEFAULT_AGLYN/aglyn-main/main'
const NOW = 1_790_000_000_000

interface FakeDatabase {
  closed: boolean
}

/**
 * The SDK's database as another tab leaves it. `lease` is the `owner` row;
 * `locked` holds every read until `release()` — a frozen tab's open
 * readwrite transaction over every store.
 */
function fakeIndexedDb({
  exists = true,
  lease,
  locked = false,
}: {
  exists?: boolean
  lease?: { ownerId: string; allowTabSynchronization: boolean; leaseTimestampMs: number }
  locked?: boolean
}) {
  const connections: FakeDatabase[] = []
  const held: Array<() => void> = []
  const open = jest.fn((name: string) => {
    expect(name).toBe(DATABASE)
    const request: Record<string, unknown> = {}
    queueMicrotask(() => {
      const database = {
        closed: false,
        objectStoreNames: { contains: (store: string) => store === 'owner' },
        close() {
          database.closed = true
        },
        transaction: (store: string, mode: string) => {
          expect(store).toBe('owner')
          // A probe must never take a write lock of its own.
          expect(mode).toBe('readonly')
          return {
            objectStore: () => ({
              get: (key: string) => {
                expect(key).toBe('owner')
                const read: Record<string, unknown> = {}
                const land = () => {
                  read.result = lease
                  ;(read.onsuccess as (() => void) | undefined)?.()
                }
                if (locked) held.push(land)
                else queueMicrotask(land)
                return read
              },
            }),
          }
        },
      }
      connections.push(database)
      request.result = database
      ;(request.onsuccess as (() => void) | undefined)?.()
    })
    return request
  })
  const factory = {
    databases: async () => (exists ? [{ name: DATABASE, version: 18 }] : []),
    open,
  } as unknown as IDBFactory
  return {
    factory,
    open,
    connections,
    release: () => held.splice(0).forEach((land) => land()),
  }
}

/** A client call queued behind the frozen tab's transaction: it never settles. */
const hangs = () => new Promise<void>(() => undefined)

describe('probePrimaryLease (AGL-3428)', () => {
  it('reports the store locked when another tab holds it, and closes once the lock lifts', async () => {
    const idb = fakeIndexedDb({ locked: true })

    await expect(
      probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20 }),
    ).resolves.toEqual({ state: 'locked' })
    expect(idb.connections).toHaveLength(1)
    expect(idb.connections[0].closed).toBe(false)

    // The frozen tab is released: the late read must not leave a connection
    // open that could hold up the SDK's own version upgrade.
    idb.release()
    expect(idb.connections[0].closed).toBe(true)
  })

  it('reads who holds the lease and how long ago it was renewed', async () => {
    const idb = fakeIndexedDb({
      lease: { ownerId: 'hCao0NnJ', allowTabSynchronization: true, leaseTimestampMs: NOW - 90_000 },
    })

    await expect(
      probePrimaryLease(idb.factory, DATABASE, { now: () => NOW }),
    ).resolves.toEqual({ state: 'leased', ownerId: 'hCao0NnJ', ageMs: 90_000 })
    expect(idb.connections[0].closed).toBe(true)
  })

  it('never opens a database that does not exist, which would create it under the SDK', async () => {
    const idb = fakeIndexedDb({ exists: false })

    await expect(probePrimaryLease(idb.factory, DATABASE)).resolves.toEqual({
      state: 'unknown',
    })
    expect(idb.open).not.toHaveBeenCalled()
  })

  it('reports vacant when there is no lease row, and unknown without IndexedDB', async () => {
    await expect(probePrimaryLease(fakeIndexedDb({}).factory, DATABASE)).resolves.toEqual({
      state: 'vacant',
    })
    await expect(probePrimaryLease(undefined, DATABASE)).resolves.toEqual({
      state: 'unknown',
    })
  })
})

describe('wedgeEvidenceFrom (AGL-3428)', () => {
  it('treats a locked store and a lease stale past the threshold as the wedge', () => {
    expect(wedgeEvidenceFrom({ state: 'locked' })).toEqual({ reason: 'lease-locked' })
    expect(
      wedgeEvidenceFrom({ state: 'leased', ownerId: 'win8uLYt', ageMs: STALE_PRIMARY_LEASE_MS }),
    ).toEqual({ reason: 'lease-stale', ownerId: 'win8uLYt', ageMs: STALE_PRIMARY_LEASE_MS })
  })

  it('never treats a healthy or unreadable cache as the wedge', () => {
    // Within the SDK's 5 s eligibility window and the late-tick margin above it.
    expect(wedgeEvidenceFrom({ state: 'leased', ownerId: 'x', ageMs: 4_000 })).toBeUndefined()
    expect(
      wedgeEvidenceFrom({ state: 'leased', ownerId: 'x', ageMs: STALE_PRIMARY_LEASE_MS - 1 }),
    ).toBeUndefined()
    expect(wedgeEvidenceFrom({ state: 'vacant' })).toBeUndefined()
    expect(wedgeEvidenceFrom({ state: 'unknown' })).toBeUndefined()
  })
})

describe('a stalled tab behind a frozen primary recovers onto the memory cache (AGL-3428)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    jest.clearAllMocks()
  })

  /**
   * The whole path the console runs: a stalled reader asks for recovery, the
   * network cycle queues behind the lock, and the lease check that follows
   * moves the tab off the shared cache.
   */
  const stalledTab = (
    idb: ReturnType<typeof fakeIndexedDb>,
    {
      network = hangs,
      visible = true,
      fallBack = jest.fn<void, [WedgeEvidence]>(),
    }: {
      network?: () => Promise<void>
      visible?: boolean
      fallBack?: jest.Mock
    } = {},
  ) => {
    const recovery = createStallRecovery({
      disable: network,
      enable: network,
      isOnline: () => true,
      isVisible: () => visible,
      stepTimeoutMs: 20,
      afterCycle: createWedgeEscalation({
        probe: () => probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20, now: () => NOW }),
        fallBack,
        isOnline: () => true,
        isVisible: () => visible,
        wait: async () => undefined,
      }),
    })
    return { recovery, fallBack }
  }

  it('falls back when the frozen tab holds the store, although the network cycle never finishes', async () => {
    const { recovery, fallBack } = stalledTab(fakeIndexedDb({ locked: true }))

    await expect(recovery.recover()).resolves.toBe('fell-back')
    expect(fallBack).toHaveBeenCalledWith({ reason: 'lease-locked' })
  })

  it('falls back when the lease belongs to a tab that stopped renewing it', async () => {
    const { recovery, fallBack } = stalledTab(
      fakeIndexedDb({
        lease: { ownerId: 'hCao0NnJ', allowTabSynchronization: true, leaseTimestampMs: NOW - 120_000 },
      }),
    )

    await expect(recovery.recover()).resolves.toBe('fell-back')
    expect(fallBack).toHaveBeenCalledWith({
      reason: 'lease-stale',
      ownerId: 'hCao0NnJ',
      ageMs: 120_000,
    })
  })

  it('leaves a healthy tab alone: a fresh lease after the election means the server is only slow', async () => {
    const { recovery, fallBack } = stalledTab(
      fakeIndexedDb({
        lease: { ownerId: 'this-tab', allowTabSynchronization: true, leaseTimestampMs: NOW - 1_000 },
      }),
      { network: async () => undefined },
    )

    await expect(recovery.recover()).resolves.toBe('recovered')
    expect(fallBack).not.toHaveBeenCalled()
  })

  it('does nothing from a hidden tab: nobody is waiting on it', async () => {
    const { recovery, fallBack } = stalledTab(fakeIndexedDb({ locked: true }), {
      visible: false,
    })

    await expect(recovery.recover()).resolves.toBe('hidden')
    expect(fallBack).not.toHaveBeenCalled()
  })

  it('never escalates from a tab already on the fallback, so it cannot reload in a loop', async () => {
    const probe = jest.fn(async () => ({ state: 'locked' as const }))
    const fallBack = jest.fn()
    const escalate = createWedgeEscalation({
      probe,
      fallBack,
      isFallbackActive: () => true,
      isOnline: () => true,
      isVisible: () => true,
      wait: async () => undefined,
    })

    await expect(escalate()).resolves.toBe(false)
    expect(probe).not.toHaveBeenCalled()
    expect(fallBack).not.toHaveBeenCalled()
  })

  it('reloads onto the memory cache, and only this tab keeps it', () => {
    const reload = jest.fn()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    fallBackToMemoryCache({ reason: 'lease-locked' }, { reload, now: () => Date.now() })

    expect(reload).toHaveBeenCalledTimes(1)
    // The one trace a reload leaves, for whoever reads the console after.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AGL-3428'),
      expect.objectContaining({ reason: 'lease-locked' }),
    )
    warn.mockRestore()
    expect(memoryCacheFallbackActive()).toBe(true)
    // What the reloaded tab's provider asks: the memory cache, not the
    // shared IndexedDB the frozen tab holds.
    expect(firestoreCacheClassFor('durable')).toBe('ephemeral')
    localCacheFor(firestoreCacheClassFor('durable'))
    expect(memoryLocalCache).toHaveBeenCalled()
    expect(persistentLocalCache).not.toHaveBeenCalled()
    // An ephemeral origin was never on the durable cache to begin with.
    expect(firestoreCacheClassFor('ephemeral')).toBe('ephemeral')
  })

  it('does not reload when the fallback cannot be recorded, which would only hang again', () => {
    const reload = jest.fn()
    fallBackToMemoryCache(
      { reason: 'lease-locked' },
      {
        reload,
        storage: {
          setItem: () => {
            throw new Error('QuotaExceededError')
          },
        },
      },
    )

    expect(reload).not.toHaveBeenCalled()
  })

  it('gives the durable cache back once the fallback expires', () => {
    const storage = {
      getItem: () => JSON.stringify({ reason: 'lease-locked', at: NOW }),
    }

    expect(readMemoryCacheFallback(storage, NOW + 1_000)).toEqual({
      reason: 'lease-locked',
      at: NOW,
    })
    expect(readMemoryCacheFallback(storage, NOW + MEMORY_CACHE_FALLBACK_TTL_MS)).toBeUndefined()
    expect(readMemoryCacheFallback({ getItem: () => 'not json' }, NOW)).toBeUndefined()
    expect(window.sessionStorage.getItem(MEMORY_CACHE_FALLBACK_KEY)).toBeNull()
    expect(firestoreCacheClassFor('durable')).toBe('durable')
  })
})
