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
 * AGL-2845. Locks what the shared-client-state prune may delete, stated as the
 * property it protects rather than as the loop that implements it: a record a
 * live tab depends on survives, and a record the SDK strands does not.
 *
 * Every value below is in the shape `@firebase/firestore` 4.17.1 writes, under
 * the persistence prefix read off a production console profile. Each stranded
 * record is one the module docblock traces to its cause — a secondary tab's
 * unlisten, a rejected listen, a closed tab, a tab that ended without
 * `pagehide`.
 *
 * What this cannot prove: jsdom has no IndexedDB, so `readHeartbeatClientIds`
 * is exercised here only where it must refuse to open anything. Opening the
 * SDK's own database and reading `clientMetadata` needs a real browser.
 */

import {
  STALE_SHARED_CLIENT_STATE_MS,
  firestorePersistencePrefix,
  planSharedClientStatePrune,
  pruneBrowserSharedClientState,
  pruneSharedClientState,
  readHeartbeatClientIds,
} from './firestore-shared-client-state'

const PREFIX = firestorePersistencePrefix('DEFAULT_AGLYN', 'aglyn-main')
const NOW = Date.UTC(2026, 8, 10, 12)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const clientKey = (clientId: string, prefix = PREFIX) =>
  `firestore_clients_${prefix}_${clientId}`
const targetKey = (targetId: number, prefix = PREFIX) =>
  `firestore_targets_${prefix}_${targetId}`
const zombieKey = (clientId: string, prefix = PREFIX) =>
  `firestore_zombie_${prefix}_${clientId}`

/** A tab's record: its active targets, and when that set last changed. */
function putClient(clientId: string, activeTargetIds: number[], ageMs: number) {
  localStorage.setItem(
    clientKey(clientId),
    JSON.stringify({ activeTargetIds, updateTimeMs: NOW - ageMs }),
  )
}

/** A target's state as the primary tab writes it. */
function putTarget(
  targetId: number,
  state: 'current' | 'not-current' | 'rejected' = 'current',
  error?: { code: string; message: string },
) {
  localStorage.setItem(
    targetKey(targetId),
    JSON.stringify({ state, updateTimeMs: NOW - 30 * DAY, ...(error ? { error } : {}) }),
  )
}

/** When a tab closed, as `markClientZombied` writes it. */
function putZombie(clientId: string, ageMs: number) {
  localStorage.setItem(zombieKey(clientId), String(NOW - ageMs))
}

/** The client ids with a row in the SDK's `clientMetadata` store. */
const heartbeat =
  (...clientIds: string[]) =>
  async (): Promise<ReadonlySet<string>> =>
    new Set(clientIds)

function prune(heartbeatClientIds: () => Promise<ReadonlySet<string> | undefined>) {
  return pruneSharedClientState({
    storage: localStorage,
    prefix: PREFIX,
    heartbeatClientIds,
    now: () => NOW,
  })
}

const has = (key: string) => localStorage.getItem(key) !== null

beforeEach(() => {
  localStorage.clear()
})

describe('the persistence prefix', () => {
  it('composes into the exact key the SDK writes', () => {
    expect(targetKey(2)).toBe('firestore_targets_firestore/DEFAULT_AGLYN/aglyn-main/_2')
  })
})

describe('target records', () => {
  it('removes every target record that no client lists', async () => {
    putClient('liveTab', [2], HOUR)
    putTarget(2)
    putTarget(4)
    putTarget(6, 'not-current')
    putTarget(8, 'rejected', {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    })
    putTarget(10, 'rejected', {
      code: 'failed-precondition',
      message: 'The query requires an index.',
    })

    const plan = await prune(heartbeat('liveTab'))

    expect(has(targetKey(2))).toBe(true)
    for (const targetId of [4, 6, 8, 10]) expect(has(targetKey(targetId))).toBe(false)
    expect(plan?.targets).toEqual({ kept: 1, removed: 4 })
  })

  it('keeps a target that a surviving client still lists when another lister goes', async () => {
    putClient('deadTab', [2, 4], 2 * DAY)
    putClient('liveTab', [4], HOUR)
    putTarget(2)
    putTarget(4)

    await prune(heartbeat('liveTab'))

    expect(has(clientKey('deadTab'))).toBe(false)
    expect(has(targetKey(2))).toBe(false)
    // Removing it would start target 4 `not-current` in the next tab to join it.
    expect(has(targetKey(4))).toBe(true)
  })

  it('plans without deleting anything', () => {
    putTarget(4)

    const plan = planSharedClientStatePrune(localStorage, PREFIX, new Set(), NOW)

    expect(plan.remove).toEqual([targetKey(4)])
    expect(has(targetKey(4))).toBe(true)
  })
})

describe('client records', () => {
  it('removes a tab the SDK has already given up on, and releases its targets', async () => {
    // Ended without `pagehide`: the record stays, and a primary has since
    // deleted the tab's heartbeat row.
    putClient('deadTab', [2], STALE_SHARED_CLIENT_STATE_MS)
    putTarget(2)

    const plan = await prune(heartbeat())

    expect(has(clientKey('deadTab'))).toBe(false)
    expect(has(targetKey(2))).toBe(false)
    expect(plan?.clients).toEqual({ kept: 0, removed: 1 })
  })

  it('never removes a tab that still has a heartbeat row, however old its record', async () => {
    // A live tab left idle rewrites its heartbeat row every 4 seconds and this
    // record only when its listeners change. Deleting the record would make
    // every other tab drop its targets and the primary stop watching them.
    putClient('idleTab', [2], 365 * DAY)
    putTarget(2)

    await prune(heartbeat('idleTab'))

    expect(has(clientKey('idleTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
  })

  it('keeps a tab with no heartbeat row until its record has sat unchanged for a day', async () => {
    // A tab frozen rather than closed loses its heartbeat row after 30 minutes.
    putClient('frozenTab', [2], STALE_SHARED_CLIENT_STATE_MS - 1)
    putTarget(2)

    await prune(heartbeat())

    expect(has(clientKey('frozenTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
  })

  it('judges a tab that starts during the heartbeat read by its age, so it survives', async () => {
    putTarget(2)

    await prune(async () => {
      // Its heartbeat row lands after the read, its record before the scan.
      localStorage.setItem(
        clientKey('newTab'),
        JSON.stringify({ activeTargetIds: [2], updateTimeMs: NOW }),
      )
      return new Set<string>()
    })

    expect(has(clientKey('newTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
  })

  it('removes no tab at all when the heartbeat cannot be read', async () => {
    putClient('oldTab', [2], 365 * DAY)
    putTarget(2)
    putTarget(4)

    const plan = await prune(async () => undefined)

    expect(plan?.heartbeat).toBe(false)
    expect(has(clientKey('oldTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
    // A target nobody lists is dead data with or without a heartbeat.
    expect(has(targetKey(4))).toBe(false)
  })

  it('treats a heartbeat read that throws as unreadable', async () => {
    putClient('oldTab', [2], 365 * DAY)

    await prune(async () => {
      throw new Error('IndexedDB is unavailable')
    })

    expect(has(clientKey('oldTab'))).toBe(true)
  })

  it('never treats a record without a numeric update time as stale', async () => {
    localStorage.setItem(clientKey('timelessTab'), JSON.stringify({ activeTargetIds: [2] }))
    putTarget(2)

    await prune(heartbeat())

    expect(has(clientKey('timelessTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
  })

  it.each([
    ['is not JSON', '{"activeTargetIds": [2'],
    ['has no target list', JSON.stringify({ updateTimeMs: 0 })],
    ['lists a target id that is not an integer', JSON.stringify({ activeTargetIds: [2, '4'], updateTimeMs: 0 })],
  ])('keeps a record that %s and lets it pin nothing, as the SDK does', async (_, value) => {
    localStorage.setItem(clientKey('oddTab'), value)
    putTarget(2)
    putTarget(4)

    await prune(heartbeat())

    expect(localStorage.getItem(clientKey('oddTab'))).toBe(value)
    expect(has(targetKey(2))).toBe(false)
    expect(has(targetKey(4))).toBe(false)
  })
})

describe('zombie markers', () => {
  it('removes a marker a day old and keeps a recent or unreadable one', async () => {
    putZombie('closedYesterday', STALE_SHARED_CLIENT_STATE_MS)
    putZombie('closedJustNow', 5 * MINUTE)
    localStorage.setItem(zombieKey('garbled'), 'not-a-time')

    const plan = await prune(heartbeat())

    expect(has(zombieKey('closedYesterday'))).toBe(false)
    expect(has(zombieKey('closedJustNow'))).toBe(true)
    expect(has(zombieKey('garbled'))).toBe(true)
    expect(plan?.zombies).toEqual({ kept: 2, removed: 1 })
  })
})

describe('what is never touched', () => {
  it('leaves every other record family and every other key alone', async () => {
    const untouched: Record<string, string> = {
      [`firestore_mutations_${PREFIX}_7_someUid`]: JSON.stringify({
        state: 'pending',
        updateTimeMs: 0,
      }),
      [`firestore_online_state_${PREFIX}`]: JSON.stringify({
        clientId: 'deadTab',
        onlineState: 'Online',
      }),
      [`firestore_sequence_number_${PREFIX}`]: '1234',
      [`firestore_bundle_loaded_v2_${PREFIX}`]: '[]',
      unrelated: 'value',
    }
    for (const [key, value] of Object.entries(untouched)) localStorage.setItem(key, value)
    putTarget(2)

    await prune(heartbeat())

    for (const [key, value] of Object.entries(untouched)) {
      expect(localStorage.getItem(key)).toBe(value)
    }
    expect(has(targetKey(2))).toBe(false)
  })

  it("leaves another app's and another database's records alone", async () => {
    const otherApp = firestorePersistencePrefix('OTHER_APP', 'aglyn-main')
    const namedDatabase = 'firestore/DEFAULT_AGLYN/aglyn-main.crm/'
    for (const prefix of [otherApp, namedDatabase]) {
      localStorage.setItem(targetKey(2, prefix), JSON.stringify({ state: 'current' }))
      localStorage.setItem(
        clientKey('deadTab', prefix),
        JSON.stringify({ activeTargetIds: [], updateTimeMs: 0 }),
      )
      localStorage.setItem(zombieKey('deadTab', prefix), '0')
    }

    const plan = await prune(heartbeat())

    expect(plan?.remove).toEqual([])
    expect(localStorage.length).toBe(6)
  })

  it('matches its prefix literally, so regex characters in it reach nothing else', async () => {
    const bracketed = firestorePersistencePrefix('[DEFAULT]', 'aglyn-main')
    // What `[DEFAULT]` would match if it were read as a character class.
    const lookalike = firestorePersistencePrefix('D', 'aglyn-main')
    localStorage.setItem(targetKey(2, bracketed), '{}')
    localStorage.setItem(targetKey(2, lookalike), '{}')

    await pruneSharedClientState({
      storage: localStorage,
      prefix: bracketed,
      heartbeatClientIds: heartbeat(),
      now: () => NOW,
    })

    expect(has(targetKey(2, bracketed))).toBe(false)
    expect(has(targetKey(2, lookalike))).toBe(true)
  })
})

describe('running it again', () => {
  it('finds nothing left to remove', async () => {
    putClient('liveTab', [2], HOUR)
    putClient('deadTab', [4], 2 * DAY)
    putTarget(2)
    putTarget(4)
    putTarget(6)
    putZombie('deadTab', 2 * DAY)

    const first = await prune(heartbeat('liveTab'))
    const second = await prune(heartbeat('liveTab'))

    expect(first?.remove).toHaveLength(4)
    expect(second?.remove).toEqual([])
  })
})

describe('failure', () => {
  it('resolves undefined instead of rejecting when storage cannot be read', async () => {
    const removeItem = jest.fn()
    const blocked = {
      get length(): number {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      key: () => null,
      getItem: () => null,
      removeItem,
    } as unknown as Storage

    await expect(
      pruneSharedClientState({
        storage: blocked,
        prefix: PREFIX,
        heartbeatClientIds: heartbeat(),
        now: () => NOW,
      }),
    ).resolves.toBeUndefined()
    expect(removeItem).not.toHaveBeenCalled()
  })
})

describe('readHeartbeatClientIds', () => {
  const DATABASE = `${PREFIX}main`

  function fakeFactory(databases?: () => Promise<IDBDatabaseInfo[]>) {
    const open = jest.fn()
    const factory = { open, ...(databases ? { databases } : {}) } as unknown as IDBFactory
    return { factory, open }
  }

  it('reads nothing where there is no IndexedDB', async () => {
    await expect(readHeartbeatClientIds(undefined, DATABASE)).resolves.toBeUndefined()
  })

  it.each([
    ['cannot list databases', undefined],
    ['does not list this one', async () => [{ name: 'firebase-heartbeat-database', version: 1 }]],
    [
      'fails to list them',
      async () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    ],
  ])(
    'never opens the database when the browser %s, because open() would create it',
    async (_, databases) => {
      const { factory, open } = fakeFactory(databases)

      await expect(readHeartbeatClientIds(factory, DATABASE)).resolves.toBeUndefined()
      expect(open).not.toHaveBeenCalled()
    },
  )
})

describe('pruneBrowserSharedClientState', () => {
  it("prunes this page's storage under the app's own prefix", async () => {
    putClient('someTab', [2], 365 * DAY)
    putTarget(2)
    putTarget(4)

    const plan = await pruneBrowserSharedClientState('DEFAULT_AGLYN', 'aglyn-main')

    // jsdom has no IndexedDB: the heartbeat is unreadable, so no tab goes.
    expect(plan?.heartbeat).toBe(false)
    expect(has(clientKey('someTab'))).toBe(true)
    expect(has(targetKey(2))).toBe(true)
    expect(has(targetKey(4))).toBe(false)
  })

  it('does nothing without an app name or a project id', async () => {
    putTarget(4)

    await expect(pruneBrowserSharedClientState(undefined, 'aglyn-main')).resolves.toBeUndefined()
    await expect(pruneBrowserSharedClientState('DEFAULT_AGLYN', undefined)).resolves.toBeUndefined()
    expect(has(targetKey(4))).toBe(true)
  })
})
