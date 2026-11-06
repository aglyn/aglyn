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
  BOOT_WEDGE_CHECK_DELAY_MS,
  BOOT_WEDGE_LOCK_MS,
  confirmSharedCacheLock,
  createWedgeEscalation,
  fallBackToMemoryCache,
  memoryCacheFallbackActive,
  MEMORY_CACHE_FALLBACK_KEY,
  MEMORY_CACHE_FALLBACK_TTL_MS,
  firestoreClientId,
  isFirestoreQueueFailure,
  leaseCheckFrom,
  LEASE_PROBE_TIMEOUT_MS,
  LEASE_PROMPT_READ_MS,
  probePrimaryLease,
  readMemoryCacheFallback,
  readSharedCacheLock,
  recordSharedCacheLock,
  runBootWedgeCheck,
  startBootWedgeCheck,
  markMultiTabFirestore,
  SHARED_CACHE_LOCK_KEY,
  SHARED_CACHE_LOCK_TTL_MS,
  STALE_PRIMARY_LEASE_MS,
  WEDGE_LOCK_MS,
  watchFirestoreQueueFailure,
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

  /**
   * While the main thread is frozen, the read's answer waits in the same task
   * queue as the timeout. On a wall clock a four-second freeze therefore reads
   * as a locked store, and a healthy tab gets reloaded, losing what was typed
   * (AGL-4120). The probe counts ticks, and a browser coalesces the ones a
   * frozen thread missed.
   */
  it('does not take a frozen main thread for a locked store (AGL-4120)', async () => {
    const lease = { ownerId: 'tab', allowTabSynchronization: true, leaseTimestampMs: 1_000 }
    const idb = fakeIndexedDb({ lease, locked: true })
    let tick: () => void = () => undefined
    const interval = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((callback: () => void) => {
        tick = callback
        return 1
      }) as never)
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      const probe = probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 4_000 })
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
      await new Promise((resolve) => setTimeout(resolve, 0))

      // A freeze far longer than the timeout, then the one tick it leaves.
      clock.mockReturnValue(61_000)
      tick()
      idb.release()

      await expect(probe).resolves.toEqual({
        state: 'leased',
        ownerId: 'tab',
        ageMs: 60_000,
      })
    } finally {
      interval.mockRestore()
      clock.mockRestore()
    }
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

describe('leaseCheckFrom: what the shared cache says about a quiet client (AGL-4135)', () => {
  it('reads a store that did not answer promptly as a client waiting behind a transaction', () => {
    expect(leaseCheckFrom({ state: 'locked' }, 'this-tab')).toEqual({ state: 'waiting' })
  })

  it("reads another tab's live lease as that tab serving this one", () => {
    expect(
      leaseCheckFrom({ state: 'leased', ownerId: 'slow-tab', ageMs: 4_999 }, 'this-tab'),
    ).toEqual({ state: 'served', ownerId: 'slow-tab' })
  })

  it('leaves the cycle to a tab holding its own lease, and to a lapsed or vacant one', () => {
    expect(
      leaseCheckFrom({ state: 'leased', ownerId: 'this-tab', ageMs: 1_000 }, 'this-tab'),
    ).toEqual({ state: 'silent' })
    // The SDK's own 5 s: past it, the election the cycle forces is due.
    expect(
      leaseCheckFrom({ state: 'leased', ownerId: 'dead-tab', ageMs: 5_000 }, 'this-tab'),
    ).toEqual({ state: 'silent' })
    expect(leaseCheckFrom({ state: 'vacant' }, 'this-tab')).toEqual({ state: 'silent' })
    expect(leaseCheckFrom({ state: 'unknown' }, 'this-tab')).toEqual({ state: 'silent' })
  })

  it('cannot attribute a live lease without this tab\'s id, so the stall is taken at its word', () => {
    expect(
      leaseCheckFrom({ state: 'leased', ownerId: 'slow-tab', ageMs: 1_000 }, undefined),
    ).toEqual({ state: 'silent' })
  })

  it('asks for a prompt answer, well inside the wedge probe', () => {
    expect(LEASE_PROMPT_READ_MS).toBeLessThan(4_000)
  })
})

describe('WEDGE_LOCK_MS (AGL-4135)', () => {
  /**
   * A starved tab held the store for about 15 s and then let go, with a fresh
   * lease (production, v1.5.0). Read at 4 s, that reloaded a healthy tab onto
   * the memory cache and lost what had been typed.
   */
  it('outlasts a store a starved tab holds, so a living tab is not taken for a frozen one', () => {
    expect(WEDGE_LOCK_MS).toBeGreaterThan(15_000)
    expect(WEDGE_LOCK_MS).toBeGreaterThan(LEASE_PROBE_TIMEOUT_MS)
  })

  it('leaves a tab on the shared cache when a long-held store answers with a fresh lease', async () => {
    const idb = fakeIndexedDb({
      lease: { ownerId: 'this-tab', allowTabSynchronization: true, leaseTimestampMs: NOW - 1_000 },
      locked: true,
    })
    const fallBack = jest.fn()
    const escalate = createWedgeEscalation({
      // The starved tab's transaction ends before the longer bound.
      probe: () => {
        const read = probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 200, now: () => NOW })
        setTimeout(() => idb.release(), 60)
        return read
      },
      fallBack,
      isFallbackActive: () => false,
      isOnline: () => true,
      isVisible: () => true,
      wait: async () => undefined,
    })

    await expect(escalate()).resolves.toBe(false)
    expect(fallBack).not.toHaveBeenCalled()
  })
})

describe('firestoreClientId (AGL-4135)', () => {
  it("reads the id the SDK writes this tab's clientMetadata row under", () => {
    const firestore = { _firestoreClient: { clientId: 'AE346lHAlQVBVHA11pQn' } }
    expect(firestoreClientId(firestore as never)).toBe('AE346lHAlQVBVHA11pQn')
  })

  it('answers undefined before the client starts, or when the SDK no longer has it', () => {
    expect(firestoreClientId({} as never)).toBeUndefined()
    expect(firestoreClientId({ _firestoreClient: {} } as never)).toBeUndefined()
    expect(firestoreClientId({ _firestoreClient: { clientId: 7 } } as never)).toBeUndefined()
  })
})

describe('a stalled tab behind a frozen primary recovers onto the memory cache (AGL-3428)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
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
    const cycled = jest.fn(network)
    const recovery = createStallRecovery({
      disable: cycled,
      enable: cycled,
      isOnline: () => true,
      isVisible: () => visible,
      stepTimeoutMs: 20,
      // What the console reads first (AGL-4135): the same probe, prompt.
      checkLease: async () =>
        leaseCheckFrom(
          await probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20, now: () => NOW }),
          'this-tab',
        ),
      escalate: createWedgeEscalation({
        probe: () => probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20, now: () => NOW }),
        fallBack,
        isOnline: () => true,
        isVisible: () => visible,
        wait: async () => undefined,
      }),
    })
    return { recovery, fallBack, cycled }
  }

  /**
   * The cycle's calls would only queue behind the same lock (AGL-4135), so the
   * wedge check runs without them, and sooner.
   */
  it('falls back when the frozen tab holds the store, without queueing a network cycle behind it', async () => {
    const { recovery, fallBack, cycled } = stalledTab(fakeIndexedDb({ locked: true }))

    await expect(recovery.recover()).resolves.toBe('fell-back')
    expect(fallBack).toHaveBeenCalledWith({ reason: 'lease-locked' })
    expect(cycled).not.toHaveBeenCalled()
  })

  /**
   * A starved tab holds each transaction for seconds, and a healthy tab waits
   * behind it. Cycled when its queue drained, that tab broadcast `Offline` and
   * put every confirmed view back on the cache (production, AGL-4135).
   */
  it('never cycles a tab that is only waiting on another tab, and keeps it on the shared cache once the store answers', async () => {
    const lease = { ownerId: 'this-tab', allowTabSynchronization: true, leaseTimestampMs: NOW - 1_000 }
    // Held when the stall is noticed; free again by the wedge check.
    const busy = fakeIndexedDb({ lease, locked: true })
    const free = fakeIndexedDb({ lease })
    const cycled = jest.fn(async () => undefined)
    const fallBack = jest.fn()
    const recovery = createStallRecovery({
      disable: cycled,
      enable: cycled,
      isOnline: () => true,
      isVisible: () => true,
      checkLease: async () =>
        leaseCheckFrom(await probePrimaryLease(busy.factory, DATABASE, { timeoutMs: 20 }), 'this-tab'),
      escalate: createWedgeEscalation({
        probe: () => probePrimaryLease(free.factory, DATABASE, { timeoutMs: 20, now: () => NOW }),
        fallBack,
        isFallbackActive: () => false,
        isOnline: () => true,
        isVisible: () => true,
        wait: async () => undefined,
      }),
    })

    await expect(recovery.recover()).resolves.toBe('waiting')
    expect(cycled).not.toHaveBeenCalled()
    expect(fallBack).not.toHaveBeenCalled()
    busy.release()
  })

  it('never cycles a tab another tab is serving on a live lease (AGL-4135)', async () => {
    const { recovery, fallBack, cycled } = stalledTab(
      fakeIndexedDb({
        lease: { ownerId: 'slow-tab', allowTabSynchronization: true, leaseTimestampMs: NOW - 2_000 },
      }),
    )

    await expect(recovery.recover()).resolves.toBe('served')
    expect(cycled).not.toHaveBeenCalled()
    expect(fallBack).not.toHaveBeenCalled()
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

/**
 * AGL-4090: each tab used to find the lock on its own, so every NEW tab sat on
 * an empty page through the stall, the cycle, the settle and the lease read
 * before reloading — about half a minute, per tab. Here the first tab runs
 * that whole path once; the tab opened after it is a fresh `sessionStorage`
 * over the same origin's `localStorage`, which is exactly what a browser
 * gives a new tab.
 */
describe('a tab opened after another has seen the lock skips the wait (AGL-4090)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    jest.clearAllMocks()
  })
  afterEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  /** A new tab: its own, empty `sessionStorage`; the origin's `localStorage`. */
  const openNewTab = () => window.sessionStorage.clear()

  /** The whole AGL-3428 path in the first tab, recording what it finds. */
  const firstTabRecovers = async (idb: ReturnType<typeof fakeIndexedDb>) => {
    const reload = jest.fn()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const recovery = createStallRecovery({
      disable: hangs,
      enable: hangs,
      isOnline: () => true,
      isVisible: () => true,
      stepTimeoutMs: 20,
      escalate: createWedgeEscalation({
        probe: () => probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20 }),
        fallBack: (evidence) =>
          fallBackToMemoryCache(evidence, { databaseName: DATABASE, reload }),
        isOnline: () => true,
        isVisible: () => true,
        wait: async () => undefined,
      }),
    })
    const outcome = await recovery.recover()
    warn.mockRestore()
    return { outcome, reload }
  }

  it('starts the next tab on the memory cache at boot, with no stall, no cycle and no reload', async () => {
    const first = await firstTabRecovers(fakeIndexedDb({ locked: true }))

    // The first tab behaves exactly as before: it finds the lock itself,
    // keeps its own fallback and reloads once.
    expect(first.outcome).toBe('fell-back')
    expect(first.reload).toHaveBeenCalledTimes(1)
    expect(memoryCacheFallbackActive()).toBe(true)

    openNewTab()
    // The new tab has seen nothing itself…
    expect(memoryCacheFallbackActive()).toBe(false)
    // …yet the provider's synchronous question, asked before
    // `initializeFirestore` and before any read could stall, already answers
    // with the memory cache. The durable cache is never built, so the tab is
    // never registered for the escalation and never reloads.
    expect(firestoreCacheClassFor('durable', DATABASE)).toBe('ephemeral')
    localCacheFor(firestoreCacheClassFor('durable', DATABASE))
    expect(memoryLocalCache).toHaveBeenCalled()
    expect(persistentLocalCache).not.toHaveBeenCalled()
  })

  it('leaves a single tab exactly as before: with no lock seen, it boots on the durable cache', () => {
    expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()

    expect(firestoreCacheClassFor('durable', DATABASE)).toBe('durable')
    localCacheFor(firestoreCacheClassFor('durable', DATABASE))
    expect(persistentLocalCache).toHaveBeenCalled()
    expect(memoryLocalCache).not.toHaveBeenCalled()
  })

  it('keeps a stale lease to the tab that saw it: a new tab wins a lapsed lease on start', async () => {
    const first = await firstTabRecovers(
      fakeIndexedDb({
        lease: { ownerId: 'hCao0NnJ', allowTabSynchronization: true, leaseTimestampMs: Date.now() - 120_000 },
      }),
    )
    expect(first.outcome).toBe('fell-back')

    expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()
    openNewTab()
    expect(firestoreCacheClassFor('durable', DATABASE)).toBe('durable')
  })

  it('moves nothing for another database, an ephemeral origin, or a caller that names no database', () => {
    recordSharedCacheLock('firestore/OTHER_APP/aglyn-main/main')
    expect(firestoreCacheClassFor('durable', DATABASE)).toBe('durable')

    recordSharedCacheLock(DATABASE)
    expect(firestoreCacheClassFor('durable')).toBe('durable')
    // An ephemeral origin was never on the durable cache to begin with.
    expect(firestoreCacheClassFor('ephemeral', DATABASE)).toBe('ephemeral')
  })

  it('expires, and ignores a record that does not parse or is not a lock', () => {
    const storage = (record: unknown) => ({ getItem: () => JSON.stringify(record) })
    const lock = { reason: 'lease-locked', databaseName: DATABASE, at: NOW }

    expect(readSharedCacheLock(storage(lock), DATABASE, NOW + 1_000)).toEqual(lock)
    expect(
      readSharedCacheLock(storage(lock), DATABASE, NOW + SHARED_CACHE_LOCK_TTL_MS),
    ).toBeUndefined()
    // A stamp ahead of this clock is no evidence of anything.
    expect(readSharedCacheLock(storage(lock), DATABASE, NOW - 1)).toBeUndefined()
    // A stale lease is never shared, whatever the record says.
    expect(
      readSharedCacheLock(storage({ ...lock, reason: 'lease-stale' }), DATABASE, NOW),
    ).toBeUndefined()
    expect(readSharedCacheLock({ getItem: () => 'not json' }, DATABASE, NOW)).toBeUndefined()
    expect(
      readSharedCacheLock(
        {
          getItem: () => {
            throw new Error('SecurityError')
          },
        },
        DATABASE,
        NOW,
      ),
    ).toBeUndefined()
  })

  it('still shares the lock when this tab cannot keep its own record, and still falls back when it cannot share', () => {
    const reload = jest.fn()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const refuses = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }

    fallBackToMemoryCache(
      { reason: 'lease-locked' },
      { databaseName: DATABASE, storage: refuses, reload },
    )
    expect(reload).not.toHaveBeenCalled()
    expect(readSharedCacheLock(window.localStorage, DATABASE, Date.now())).toBeDefined()

    window.localStorage.clear()
    fallBackToMemoryCache(
      { reason: 'lease-locked' },
      { databaseName: DATABASE, sharedStorage: refuses, reload },
    )
    expect(reload).toHaveBeenCalledTimes(1)
    expect(memoryCacheFallbackActive()).toBe(true)
    expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()
    warn.mockRestore()
  })
})

describe('confirmSharedCacheLock: the record lasts only as long as the lock (AGL-4090)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('re-stamps the record while the store is still locked, so the tabs after this one skip the wait too', async () => {
    recordSharedCacheLock(DATABASE, { now: () => NOW })
    const idb = fakeIndexedDb({ locked: true })

    await expect(
      confirmSharedCacheLock(DATABASE, {
        probe: () => probePrimaryLease(idb.factory, DATABASE, { timeoutMs: 20 }),
        now: () => NOW + 60_000,
      }),
    ).resolves.toBe('still-locked')
    expect(readSharedCacheLock(window.localStorage, DATABASE, NOW + 60_000)).toEqual({
      reason: 'lease-locked',
      databaseName: DATABASE,
      at: NOW + 60_000,
    })
    // Read-only, and released once the lock lifts (asserted by the fake).
    idb.release()
    expect(idb.connections[0].closed).toBe(true)
  })

  it('clears the record as soon as the store answers, so the next tab gets the durable cache back', async () => {
    const answers = [
      // The lock lifted and a tab is renewing the lease.
      fakeIndexedDb({
        lease: { ownerId: 'hCao0NnJ', allowTabSynchronization: true, leaseTimestampMs: NOW - 1_000 },
      }),
      // Readable, though no tab holds the lease: a new tab would take it.
      fakeIndexedDb({}),
      // The database is gone, and with it the lock.
      fakeIndexedDb({ exists: false }),
    ]
    for (const idb of answers) {
      recordSharedCacheLock(DATABASE, { now: () => NOW })
      await expect(
        confirmSharedCacheLock(DATABASE, {
          probe: () => probePrimaryLease(idb.factory, DATABASE, { now: () => NOW }),
          now: () => NOW + 1_000,
        }),
      ).resolves.toBe('cleared')
      expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()
    }
    expect(firestoreCacheClassFor('durable', DATABASE)).toBe('durable')
  })

  it('never reads the lease, and never creates a record, when no tab has seen a lock', async () => {
    const probe = jest.fn(async () => ({ state: 'locked' as const }))

    await expect(confirmSharedCacheLock(DATABASE, { probe })).resolves.toBe('absent')
    expect(probe).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()
  })

  it('leaves a record another tab wrote while this read ran: it saw the lock later', async () => {
    recordSharedCacheLock(DATABASE, { now: () => NOW })

    await expect(
      confirmSharedCacheLock(DATABASE, {
        probe: async () => {
          recordSharedCacheLock(DATABASE, { now: () => NOW + 500 })
          return { state: 'vacant' }
        },
        now: () => NOW + 1_000,
      }),
    ).resolves.toBe('still-locked')
    expect(readSharedCacheLock(window.localStorage, DATABASE, NOW + 1_000)?.at).toBe(NOW + 500)
  })
})

describe('a tab whose Firestore queue has failed recovers onto the memory cache (AGL-4156)', () => {
  // Verbatim from production, 2026-11-04 (Firefox, v1.9.0).
  const B815 =
    'FIRESTORE (13.0.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"RE":"Attempt to get a record from database without an in-progress transaction"}'
  const rejection = (reason: unknown) => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown }
    event.reason = reason
    return event
  }

  beforeEach(() => window.sessionStorage.clear())

  it('knows the failed-queue assertion, and nothing else', () => {
    expect(isFirestoreQueueFailure(new Error(B815))).toBe(true)
    expect(isFirestoreQueueFailure(`Uncaught Error: ${B815}`)).toBe(true)
    // The first, raw IndexedDB error is not yet the dead queue.
    expect(
      isFirestoreQueueFailure(
        new Error('Attempt to get a record from database without an in-progress transaction'),
      ),
    ).toBe(false)
    expect(
      isFirestoreQueueFailure(
        new Error('FIRESTORE (13.0.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) CONTEXT: {}'),
      ),
    ).toBe(false)
    expect(isFirestoreQueueFailure(undefined)).toBe(false)
    expect(isFirestoreQueueFailure({ message: 42 })).toBe(false)
  })

  it('falls back once, on the first uncaught b815 or unhandled rejection', () => {
    const fallBack = jest.fn()
    const target = new EventTarget()
    watchFirestoreQueueFailure(fallBack, { target: target as unknown as Window })

    target.dispatchEvent(rejection(new Error('some other failure')))
    expect(fallBack).not.toHaveBeenCalled()

    target.dispatchEvent(rejection(new Error(B815)))
    target.dispatchEvent(new ErrorEvent('error', { error: new Error(B815), message: B815 }))
    expect(fallBack).toHaveBeenCalledTimes(1)
    expect(fallBack).toHaveBeenCalledWith({ reason: 'queue-failed' })
  })

  it('hears an uncaught error by its message when the error object is gone', () => {
    const fallBack = jest.fn()
    const target = new EventTarget()
    watchFirestoreQueueFailure(fallBack, { target: target as unknown as Window })
    target.dispatchEvent(new ErrorEvent('error', { message: `Uncaught Error: ${B815}` }))
    expect(fallBack).toHaveBeenCalledTimes(1)
  })

  it('never loops: a tab already on the fallback does not reload again', () => {
    const fallBack = jest.fn()
    const target = new EventTarget()
    watchFirestoreQueueFailure(fallBack, {
      target: target as unknown as Window,
      isFallbackActive: () => true,
    })
    target.dispatchEvent(rejection(new Error(B815)))
    expect(fallBack).not.toHaveBeenCalled()
  })

  it('reloads this tab alone onto the memory cache and shares no lock', () => {
    const reload = jest.fn()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.localStorage.removeItem(SHARED_CACHE_LOCK_KEY)
    const target = new EventTarget()
    watchFirestoreQueueFailure(
      (evidence) => fallBackToMemoryCache(evidence, { databaseName: 'db', reload }),
      { target: target as unknown as Window },
    )
    target.dispatchEvent(rejection(new Error(B815)))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AGL-4156'),
      expect.objectContaining({ reason: 'queue-failed' }),
    )
    warn.mockRestore()
    expect(readMemoryCacheFallback(window.sessionStorage, Date.now())?.reason).toBe('queue-failed')
    expect(firestoreCacheClassFor('durable')).toBe('ephemeral')
    // Another tab's client is alive: nothing tells the next tab to skip the durable cache.
    expect(window.localStorage.getItem(SHARED_CACHE_LOCK_KEY)).toBeNull()
  })

  it('stops watching when asked', () => {
    const fallBack = jest.fn()
    const target = new EventTarget()
    const stop = watchFirestoreQueueFailure(fallBack, { target: target as unknown as Window })
    stop()
    target.dispatchEvent(rejection(new Error(B815)))
    expect(fallBack).not.toHaveBeenCalled()
  })
})

describe('a tab still booting finds another tab\'s lock in seconds (AGL-4201)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    jest.clearAllMocks()
  })

  /** The deps of a visible, online, booting tab; override what a case is about. */
  const booting = (overrides: Partial<Parameters<typeof runBootWedgeCheck>[0]> = {}) => ({
    probe: jest.fn(async (): Promise<{ state: 'locked' }> => ({ state: 'locked' })),
    fallBack: jest.fn(),
    hasServerAnswered: () => false,
    isFallbackActive: () => false,
    isOnline: () => true,
    whenVisible: async () => undefined,
    wait: jest.fn(async () => undefined),
    ...overrides,
  })

  /**
   * The budget the in-use rescue spends before a lock verdict (8 s stall, 1 s
   * prompt read, 3 s settle, 20 s lock) was the whole 37 s measured on a booting
   * tab in production. The boot check must land well inside it.
   */
  it('reaches a verdict in a few seconds, far inside the in-use budget', () => {
    expect(BOOT_WEDGE_CHECK_DELAY_MS + BOOT_WEDGE_LOCK_MS).toBeLessThanOrEqual(6_000)
    expect(BOOT_WEDGE_LOCK_MS).toBeLessThan(WEDGE_LOCK_MS)
  })

  it('moves a booting tab to the memory cache when the store stays locked', async () => {
    const deps = booting()

    await expect(runBootWedgeCheck(deps)).resolves.toBe('fell-back')
    expect(deps.wait).toHaveBeenCalledWith(BOOT_WEDGE_CHECK_DELAY_MS)
    expect(deps.fallBack).toHaveBeenCalledWith({ reason: 'lease-locked' })
  })

  /**
   * A stale lease at boot is what every tab finds once the last one went
   * quiet (production: 200 s stale while the store answered in 1-5 ms), and a
   * fresh tab wins it at its first election. It is never a reason to leave.
   */
  it('leaves a stale or vacant lease to the election', async () => {
    for (const read of [
      { state: 'leased' as const, ownerId: 'gone', ageMs: 200_000 },
      { state: 'vacant' as const },
      { state: 'unknown' as const },
    ]) {
      const deps = booting({ probe: jest.fn(async () => read) })
      await expect(runBootWedgeCheck(deps)).resolves.toBe('clear')
      expect(deps.fallBack).not.toHaveBeenCalled()
    }
  })

  it('never touches a tab the server has already answered, before or after the read', async () => {
    const before = booting({ hasServerAnswered: () => true })
    await expect(runBootWedgeCheck(before)).resolves.toBe('answered')
    expect(before.probe).not.toHaveBeenCalled()

    let answered = false
    const during = booting({
      hasServerAnswered: () => answered,
      probe: jest.fn(async () => {
        answered = true
        return { state: 'locked' as const }
      }),
    })
    await expect(runBootWedgeCheck(during)).resolves.toBe('answered')
    expect(during.fallBack).not.toHaveBeenCalled()
  })

  it('stands down offline and on a tab already on the fallback', async () => {
    const offline = booting({ isOnline: () => false })
    await expect(runBootWedgeCheck(offline)).resolves.toBe('offline')
    expect(offline.probe).not.toHaveBeenCalled()

    const fallen = booting({ isFallbackActive: () => true })
    await expect(runBootWedgeCheck(fallen)).resolves.toBe('fallback-active')
    expect(fallen.wait).not.toHaveBeenCalled()
  })

  it('waits for a background tab to be shown before reading the lease', async () => {
    let show: () => void = () => undefined
    const deps = booting({ whenVisible: () => new Promise<void>((resolve) => (show = resolve)) })

    const outcome = runBootWedgeCheck(deps)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.probe).not.toHaveBeenCalled()
    show()
    await expect(outcome).resolves.toBe('fell-back')
  })

  it('never rejects', async () => {
    const deps = booting({ probe: jest.fn(async () => { throw new Error('boom') }) })
    await expect(runBootWedgeCheck(deps)).resolves.toBe('error')
    expect(deps.fallBack).not.toHaveBeenCalled()
  })

  it('does nothing for a client that does not run the durable multi-tab cache', async () => {
    await expect(startBootWedgeCheck({} as never, () => false)).resolves.toBe('not-multi-tab')
  })

  /**
   * The browser wiring end to end, against a store another tab holds: the read
   * is bounded by the boot budget, the tab records its fallback, the lock is
   * shared with the tabs that open next (AGL-4090), and the tab reloads.
   */
  it('wires the browser: a locked store records the fallback, shares the lock and reloads the tab', async () => {
    jest.useFakeTimers()
    const idb = fakeIndexedDb({ locked: true })
    const original = Object.getOwnPropertyDescriptor(window, 'indexedDB')
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: idb.factory })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    // jsdom answers `location.reload()` with a not-implemented console error.
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const firestore = {} as never
      markMultiTabFirestore(firestore, DATABASE)
      const outcome = startBootWedgeCheck(firestore, () => false)

      await jest.advanceTimersByTimeAsync(BOOT_WEDGE_CHECK_DELAY_MS + BOOT_WEDGE_LOCK_MS + 500)

      await expect(outcome).resolves.toBe('fell-back')
      expect(readMemoryCacheFallback(window.sessionStorage, Date.now())).toMatchObject({
        reason: 'lease-locked',
      })
      expect(readSharedCacheLock(window.localStorage, DATABASE, Date.now())).toMatchObject({
        reason: 'lease-locked',
        databaseName: DATABASE,
      })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('reloading this tab on the memory cache'),
        expect.anything(),
      )
    } finally {
      warn.mockRestore()
      error.mockRestore()
      if (original) Object.defineProperty(window, 'indexedDB', original)
      jest.useRealTimers()
    }
  })
})
