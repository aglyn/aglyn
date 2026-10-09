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
 * AGL-3660: a console tab opened while another, hidden console tab holds the
 * multi-tab cache's primary lease routed every query through that background
 * tab until its throttled lease renewal slipped — the first workspace read
 * landed ~6.9 s in. At boot the visible tab now takes the lease from a hidden
 * holder in one IndexedDB transaction, then cycles its network so the SDK's
 * own election makes it primary at once.
 *
 * What must hold: the claim is made only from a hidden multi-tab holder, with
 * no write pending, by a tab that can tell which client is its own; it is
 * written in the SDK's own row shapes; and every other path leaves the SDK's
 * election alone.
 */

import {
  claimPrimaryLease,
  type ClientRow,
  decideLeaseClaim,
  type LeaseRow,
  PRIMARY_LEASE_MAX_AGE_MS,
  readSharedClientIds,
  runTabHandoff,
  type TabHandoffDeps,
} from './firestore-tab-handoff'

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  disableNetwork: jest.fn(),
  enableNetwork: jest.fn(),
}))

const NOW = 1_800_000_000_000

const lease = (
  ownerId: string,
  ageMs = 1_000,
  allowTabSynchronization = true,
): LeaseRow => ({
  ownerId,
  allowTabSynchronization,
  leaseTimestampMs: NOW - ageMs,
})

const client = (clientId: string, inForeground: boolean): ClientRow => ({
  clientId,
  updateTimeMs: NOW - 500,
  networkEnabled: true,
  inForeground,
})

describe('decideLeaseClaim', () => {
  const self = client('self', false)
  const holder = client('holder', false)

  it('claims a lease a hidden multi-tab holder renewed moments ago', () => {
    expect(
      decideLeaseClaim({
        owner: lease('holder'),
        holder,
        self,
        pendingWrites: 0,
      }),
    ).toEqual({ claim: true })
  })

  it('claims from a hidden holder whose lease has lapsed, as the SDK would on its next tick', () => {
    expect(
      decideLeaseClaim({
        owner: lease('holder', PRIMARY_LEASE_MAX_AGE_MS + 2_000),
        holder,
        self,
        pendingWrites: 0,
      }),
    ).toEqual({ claim: true })
  })

  it.each([
    ['unidentified', { self: undefined }],
    ['vacant', { owner: undefined }],
    ['already-primary', { owner: lease('self') }],
    ['exclusive-holder', { owner: lease('holder', 1_000, false) }],
    ['pending-writes', { pendingWrites: 1 }],
    ['holder-unknown', { holder: undefined }],
    ['holder-visible', { holder: client('holder', true) }],
  ] as const)('leaves the SDK alone: %s', (reason, override) => {
    expect(
      decideLeaseClaim({
        owner: lease('holder'),
        holder,
        self,
        pendingWrites: 0,
        ...override,
      }),
    ).toEqual({ claim: false, reason })
  })
})

describe('runTabHandoff', () => {
  const deps = (overrides: Partial<TabHandoffDeps> = {}) => {
    const calls: string[] = []
    let started = false
    const base: TabHandoffDeps = {
      isVisible: () => true,
      isOnline: () => true,
      readClientIds: () => {
        calls.push(started ? 'read-after' : 'read-before')
        return new Set(started ? ['holder', 'self'] : ['holder'])
      },
      startClient: async () => {
        calls.push('start')
        started = true
      },
      claim: async (selfId) => {
        calls.push(`claim:${selfId}`)
        return { state: 'claimed', fromOwnerId: 'holder', leaseAgeMs: 900 }
      },
      cycleNetwork: async () => {
        calls.push('cycle')
      },
    }
    return { calls, deps: { ...base, ...overrides } }
  }

  it('snapshots the clients before starting, claims as the one new client, then cycles', async () => {
    const { calls, deps: d } = deps()
    const run = runTabHandoff(d)
    // Synchronously, in the caller's task, and before the client is started.
    expect(calls).toEqual(['read-before', 'start'])
    await expect(run).resolves.toEqual({
      result: 'claimed',
      fromOwnerId: 'holder',
      leaseAgeMs: 900,
    })
    expect(calls).toEqual([
      'read-before',
      'start',
      'read-after',
      'claim:self',
      'cycle',
    ])
  })

  it('does nothing in a hidden tab — a prerender or a background restore', async () => {
    const { calls, deps: d } = deps({ isVisible: () => false })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'hidden',
    })
    expect(calls).toEqual([])
  })

  it('does nothing offline', async () => {
    const { calls, deps: d } = deps({ isOnline: () => false })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'offline',
    })
    expect(calls).toEqual([])
  })

  it('does nothing when no other tab is registered — the first tab wins on its own', async () => {
    const { calls, deps: d } = deps({ readClientIds: () => new Set() })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'alone',
    })
    expect(calls).toEqual([])
  })

  it('claims nothing when two clients appeared, so it can never name the wrong tab', async () => {
    let reads = 0
    const { calls, deps: d } = deps({
      readClientIds: () =>
        new Set(
          reads++ === 0 ? ['holder'] : ['holder', 'self', 'other-new-tab'],
        ),
    })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'unidentified',
    })
    expect(calls).toEqual(['start'])
  })

  it('claims nothing when the client had started before the snapshot', async () => {
    const { calls, deps: d } = deps({
      readClientIds: () => new Set(['holder', 'self']),
    })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'unidentified',
    })
    expect(calls).toEqual(['start'])
  })

  it('stops if the user switched away while the client started', async () => {
    let visible = true
    const { calls, deps: d } = deps({
      isVisible: () => visible,
      startClient: async () => {
        calls.push('start')
        visible = false
      },
    })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'hidden',
    })
    expect(calls).not.toContain('cycle')
  })

  it('never cycles the network unless the claim was written', async () => {
    for (const state of ['locked', 'unavailable'] as const) {
      const { calls, deps: d } = deps({ claim: async () => ({ state }) })
      const outcome = await runTabHandoff(d)
      expect(outcome.result).toBe('skipped')
      expect(calls).not.toContain('cycle')
    }
  })

  it('never rejects', async () => {
    const { deps: d } = deps({
      startClient: async () => {
        throw new Error('terminated')
      },
    })
    await expect(runTabHandoff(d)).resolves.toEqual({
      result: 'skipped',
      reason: 'error',
    })
  })
})

/**
 * A minimal IndexedDB: requests in a transaction complete in the order they
 * were made, then `oncomplete` fires — the ordering `claimPrimaryLease`
 * relies on. `locked` models another tab's open transaction: nothing in this
 * one ever starts.
 */
function fakeIndexedDb(
  initial: { owner?: LeaseRow; clients?: ClientRow[]; mutations?: number },
  {
    locked = false,
    databaseName = 'db',
  }: { locked?: boolean; databaseName?: string } = {},
) {
  const stores = {
    owner: new Map<string, unknown>(
      initial.owner ? [['owner', initial.owner]] : [],
    ),
    clientMetadata: new Map<string, unknown>(
      (initial.clients ?? []).map((row) => [row.clientId, row]),
    ),
    mutations: new Map<string, unknown>(
      Array.from({ length: initial.mutations ?? 0 }, (_, i) => [String(i), {}]),
    ),
  }
  const aborts: string[] = []
  const transaction = () => {
    const queue: Array<() => void> = []
    let pending = 0
    let aborted = false
    const tx: Record<string, unknown> & {
      oncomplete?: () => void
      onabort?: () => void
      onerror?: () => void
    } = {
      abort: () => {
        aborted = true
        aborts.push('abort')
        tx.onabort?.()
      },
      objectStore: (name: keyof typeof stores) => {
        const store = stores[name]
        const request = (run: () => unknown) => {
          const req: { result?: unknown; onsuccess?: () => void } = {}
          pending++
          queue.push(() => {
            req.result = run()
            req.onsuccess?.()
            pending--
          })
          schedule()
          return req
        }
        return {
          get: (key: string) => request(() => store.get(key)),
          getAllKeys: () => request(() => [...store.keys()]),
          count: () => request(() => store.size),
          put: (value: { clientId?: string }, key?: string) =>
            request(() => store.set(key ?? String(value.clientId), value)),
        }
      },
    }
    let scheduled = false
    const schedule = () => {
      if (locked || scheduled) return
      scheduled = true
      setTimeout(() => {
        while (queue.length && !aborted) queue.shift()!()
        scheduled = false
        if (pending === 0 && !aborted) tx.oncomplete?.()
        else schedule()
      }, 0)
    }
    return tx
  }
  const database = {
    objectStoreNames: { contains: (name: string) => name in stores },
    transaction,
    close: jest.fn(),
    onversionchange: null,
  }
  const factory = {
    databases: async () => [{ name: databaseName, version: 17 }],
    open: () => {
      const request: Record<string, unknown> & { onsuccess?: () => void } = {}
      setTimeout(() => {
        request.result = database
        request.onsuccess?.()
      }, 0)
      return request
    },
  } as unknown as IDBFactory
  return { factory, stores, aborts, database }
}

describe('claimPrimaryLease', () => {
  const now = () => NOW

  it('writes this tab as foreground and the lease in its name, in the SDK shapes', async () => {
    const idb = fakeIndexedDb({
      owner: lease('holder', 1_200),
      clients: [client('holder', false), client('self', false)],
    })
    await expect(
      claimPrimaryLease(idb.factory, 'db', 'self', { now }),
    ).resolves.toEqual({
      state: 'claimed',
      fromOwnerId: 'holder',
      leaseAgeMs: 1_200,
    })
    expect(idb.stores.owner.get('owner')).toEqual({
      ownerId: 'self',
      allowTabSynchronization: true,
      leaseTimestampMs: NOW,
    })
    expect(idb.stores.clientMetadata.get('self')).toEqual({
      clientId: 'self',
      networkEnabled: true,
      inForeground: true,
      updateTimeMs: NOW,
    })
    // The holder's own row is the SDK's to rewrite.
    expect(idb.stores.clientMetadata.get('holder')).toEqual(
      client('holder', false),
    )
    expect(idb.database.close).toHaveBeenCalled()
  })

  it('writes nothing for a visible holder', async () => {
    const idb = fakeIndexedDb({
      owner: lease('holder'),
      clients: [client('holder', true), client('self', false)],
    })
    await expect(
      claimPrimaryLease(idb.factory, 'db', 'self', { now }),
    ).resolves.toEqual({
      state: 'skipped',
      reason: 'holder-visible',
    })
    expect(idb.stores.owner.get('owner')).toEqual(lease('holder'))
  })

  it('writes nothing while a write is pending', async () => {
    const idb = fakeIndexedDb({
      owner: lease('holder'),
      clients: [client('holder', false), client('self', false)],
      mutations: 2,
    })
    await expect(
      claimPrimaryLease(idb.factory, 'db', 'self', { now }),
    ).resolves.toEqual({
      state: 'skipped',
      reason: 'pending-writes',
    })
    expect(idb.stores.owner.get('owner')).toEqual(lease('holder'))
  })

  it('gives up on a store another tab has locked (the AGL-3428 wedge) and aborts', async () => {
    jest.useFakeTimers()
    try {
      const idb = fakeIndexedDb(
        {
          owner: lease('holder'),
          clients: [client('holder', false), client('self', false)],
        },
        { locked: true },
      )
      const claim = claimPrimaryLease(idb.factory, 'db', 'self', {
        now,
        timeoutMs: 1_500,
      })
      await jest.advanceTimersByTimeAsync(1_500)
      await expect(claim).resolves.toEqual({ state: 'locked' })
      expect(idb.aborts).toEqual(['abort'])
      expect(idb.stores.owner.get('owner')).toEqual(lease('holder'))
    } finally {
      jest.useRealTimers()
    }
  })

  it('never opens a database that does not exist', async () => {
    const idb = fakeIndexedDb({}, { databaseName: 'other' })
    const open = jest.spyOn(idb.factory, 'open')
    await expect(claimPrimaryLease(idb.factory, 'db', 'self')).resolves.toEqual(
      {
        state: 'unavailable',
      },
    )
    expect(open).not.toHaveBeenCalled()
  })
})

describe('readSharedClientIds', () => {
  const storage = (keys: string[]) => ({
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
  })
  const prefix = 'firestore/DEFAULT_AGLYN/aglyn-main/'

  it("reads the client ids from the SDK's own keys under this prefix only", () => {
    expect(
      readSharedClientIds(
        storage([
          `firestore_clients_${prefix}_p3wBz2522tc45hnGIrXd`,
          `firestore_clients_${prefix}_PGje80ZE736SYHFEaX72`,
          `firestore_targets_${prefix}_1072`,
          `firestore_online_state_${prefix}`,
          'firestore_clients_firestore/OTHER_APP/aglyn-main/_zzz',
          'aglyn:firestore-memory-cache-fallback',
        ]),
        prefix,
      ),
    ).toEqual(new Set(['p3wBz2522tc45hnGIrXd', 'PGje80ZE736SYHFEaX72']))
  })

  it('reads nothing when storage is blocked', () => {
    const blocked = {
      get length(): number {
        throw new DOMException('denied', 'SecurityError')
      },
      key: () => null,
    }
    expect(readSharedClientIds(blocked, prefix)).toEqual(new Set())
    expect(readSharedClientIds(undefined, prefix)).toEqual(new Set())
  })
})
