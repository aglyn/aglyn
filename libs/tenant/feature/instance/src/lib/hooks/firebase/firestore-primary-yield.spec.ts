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
 * AGL-4204: a background tab holding the shared cache's live lease lets go
 * when a visible tab asks, through the SDK's own election. These pin who
 * asks, who yields, what each checks first, and that nothing here ever
 * writes a lease or acts on a guess.
 */

import {
  ASK_BURST,
  ASK_INTERVAL_MS,
  ASK_RETRY_MS,
  ASKER_FRESH_MS,
  BOOT_CHECK_DELAYS_MS,
  createPrimaryYield,
  decideAsk,
  decideYield,
  type LeaseRead,
  type PrimaryYieldDeps,
  readLease,
  RECHECK_MS,
  REFRESH_INTERVAL_MS,
  runPrimaryYield,
  VISIBLE_DWELL_MS,
  YIELD_INTERVAL_MS,
  type YieldMessage,
} from './firestore-primary-yield'
import type { ClientRow, LeaseRow } from './firestore-tab-handoff'

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  disableNetwork: jest.fn(),
  enableNetwork: jest.fn(),
}))

const NOW = 1_800_000_000_000

const lease = (ownerId: string, ageMs = 1_000): LeaseRow => ({
  ownerId,
  allowTabSynchronization: true,
  leaseTimestampMs: NOW - ageMs,
})

const row = (
  clientId: string,
  inForeground: boolean,
  { ageMs = 500, networkEnabled = true } = {},
): ClientRow => ({
  clientId,
  updateTimeMs: NOW - ageMs,
  networkEnabled,
  inForeground,
})

describe('decideAsk', () => {
  const base = {
    owner: lease('holder'),
    holder: row('holder', false),
    self: row('me', true),
    selfId: 'me',
    now: NOW,
  }

  it('asks a background holder whose lease is live', () => {
    expect(decideAsk(base)).toEqual({ ask: true, holderId: 'holder' })
  })

  it('never asks a holder that is visible somewhere else', () => {
    expect(decideAsk({ ...base, holder: row('holder', true) })).toEqual({
      ask: false,
      reason: 'holder-visible',
    })
  })

  it('leaves a lapsed lease to the SDK and AGL-3660', () => {
    expect(decideAsk({ ...base, owner: lease('holder', 5_000) })).toEqual({
      ask: false,
      reason: 'lease-lapsed',
    })
  })

  it('does nothing when it holds the lease, or nobody does', () => {
    expect(decideAsk({ ...base, owner: lease('me') })).toMatchObject({
      reason: 'self-holds',
    })
    expect(decideAsk({ ...base, owner: undefined })).toMatchObject({
      reason: 'vacant',
    })
  })

  it('waits until its own row says foreground and online, or the SDK would not hand to it', () => {
    expect(decideAsk({ ...base, self: row('me', false) })).toMatchObject({
      reason: 'self-not-ready',
    })
    expect(
      decideAsk({ ...base, self: row('me', true, { networkEnabled: false }) }),
    ).toMatchObject({ reason: 'self-not-ready' })
    expect(decideAsk({ ...base, self: undefined })).toMatchObject({
      reason: 'self-unknown',
    })
  })
})

describe('decideYield', () => {
  const base = {
    owner: lease('me'),
    asker: row('asker', true),
    selfId: 'me',
    pendingWrites: 0,
    now: NOW,
  }

  it('yields to a fresh, foreground, online asker', () => {
    expect(decideYield(base)).toEqual({ yield: true })
  })

  it('never yields a lease it does not hold', () => {
    expect(decideYield({ ...base, owner: lease('other') })).toMatchObject({
      reason: 'not-holder',
    })
  })

  it('never yields with a write pending — a new primary would send it again', () => {
    expect(decideYield({ ...base, pendingWrites: 1 })).toMatchObject({
      reason: 'pending-writes',
    })
  })

  it('never yields to an asker the SDK would pass over', () => {
    expect(decideYield({ ...base, asker: row('asker', false) })).toMatchObject({
      reason: 'asker-hidden',
    })
    expect(
      decideYield({
        ...base,
        asker: row('asker', true, { networkEnabled: false }),
      }),
    ).toMatchObject({ reason: 'asker-offline' })
    expect(
      decideYield({
        ...base,
        asker: row('asker', true, { ageMs: ASKER_FRESH_MS + 1 }),
      }),
    ).toMatchObject({ reason: 'asker-stale' })
    expect(decideYield({ ...base, asker: undefined })).toMatchObject({
      reason: 'asker-unknown',
    })
  })
})

function harness(
  selfId: string,
  read: LeaseRead,
  { visible = true, online = true } = {},
) {
  let now = NOW
  const state = { visible, online }
  const posted: YieldMessage[] = []
  const deps: PrimaryYieldDeps & {
    cycleNetwork: jest.Mock
    read: jest.Mock
  } = {
    selfId,
    isVisible: () => state.visible,
    isOnline: () => state.online,
    now: () => now,
    // The rows age with the clock only if the test says so: a read is what
    // the store holds NOW, and a live holder keeps renewing.
    read: jest.fn(async () => shift(read, now - NOW)),
    post: (message) => posted.push(message),
    cycleNetwork: jest.fn(async () => undefined),
  }
  return {
    deps,
    posted,
    state,
    advance: (ms: number) => {
      now += ms
    },
    handoff: createPrimaryYield(deps),
  }
}

const shift = (read: LeaseRead, by: number): LeaseRead =>
  read.state !== 'read'
    ? read
    : {
        ...read,
        owner: read.owner && {
          ...read.owner,
          leaseTimestampMs: read.owner.leaseTimestampMs + by,
        },
        rows: Object.fromEntries(
          Object.entries(read.rows).map(([id, r]) => [
            id,
            r && { ...r, updateTimeMs: r.updateTimeMs + by },
          ]),
        ),
      }

const readOf = (
  owner: LeaseRow | undefined,
  rows: ClientRow[],
  pendingWrites = 0,
): LeaseRead => ({
  state: 'read',
  owner,
  rows: Object.fromEntries(rows.map((r) => [r.clientId, r])),
  pendingWrites,
})

describe('createPrimaryYield — the visible tab', () => {
  const live = readOf(lease('holder'), [row('holder', false), row('me', true)])

  it('asks the holder by id, again while unanswered, then once per interval', async () => {
    const h = harness('me', live)
    expect(await h.handoff.check()).toEqual({
      side: 'asker',
      result: 'asked',
      holderId: 'holder',
    })
    expect(h.posted).toEqual([
      { type: 'yield', holderId: 'holder', askerId: 'me' },
    ])
    expect(await h.handoff.check()).toMatchObject({ reason: 'throttled' })
    // The holder has not let go: ask again, a short burst.
    for (let ask = 2; ask <= ASK_BURST; ask += 1) {
      h.advance(ASK_RETRY_MS)
      expect(await h.handoff.check()).toMatchObject({ result: 'asked' })
    }
    h.advance(ASK_RETRY_MS)
    expect(await h.handoff.check()).toMatchObject({ reason: 'throttled' })
    expect(h.posted).toHaveLength(ASK_BURST)
    // Then the long interval, and a new burst.
    h.advance(ASK_INTERVAL_MS)
    expect(await h.handoff.check()).toMatchObject({ result: 'asked' })
    h.advance(ASK_RETRY_MS)
    expect(await h.handoff.check()).toMatchObject({ result: 'asked' })
    expect(h.posted).toHaveLength(ASK_BURST + 2)
  })

  it('rewrites its own hidden first row with a network cycle, then asks in the same look', async () => {
    const firstRow = readOf(lease('holder'), [
      row('holder', false),
      row('me', false),
    ])
    const h = harness('me', live)
    h.deps.read.mockResolvedValueOnce(firstRow)
    const events: string[] = []
    h.deps.onEvent = (event) => events.push(event.result)
    expect(await h.handoff.check()).toMatchObject({ result: 'asked' })
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['refreshed', 'asked'])
    expect(h.posted).toHaveLength(1)
  })

  it('rewrites its own row at most once per SDK tick, and only when it would ask', async () => {
    const hiddenSelf = readOf(lease('holder'), [
      row('holder', false),
      row('me', false),
    ])
    const h = harness('me', hiddenSelf)
    expect(await h.handoff.check()).toMatchObject({ reason: 'self-not-ready' })
    expect(await h.handoff.check()).toMatchObject({ reason: 'self-not-ready' })
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(1)
    h.advance(REFRESH_INTERVAL_MS)
    await h.handoff.check()
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(2)
    // A visible holder or a vacant lease is no reason to touch the network.
    const visibleHolder = harness(
      'me',
      readOf(lease('holder'), [row('holder', true), row('me', false)]),
    )
    await visibleHolder.handoff.check()
    const vacant = harness('me', readOf(undefined, [row('me', false)]))
    await vacant.handoff.check()
    expect(visibleHolder.deps.cycleNetwork).not.toHaveBeenCalled()
    expect(vacant.deps.cycleNetwork).not.toHaveBeenCalled()
  })

  it('asks once when looks overlap', async () => {
    const h = harness('me', live)
    const looks = await Promise.all([
      h.handoff.check(),
      h.handoff.check(),
      h.handoff.check(),
    ])
    expect(looks.filter((look) => look.result === 'asked')).toHaveLength(1)
    expect(h.posted).toHaveLength(1)
    expect(h.deps.read).toHaveBeenCalledTimes(1)
  })

  it('never asks while hidden or offline', async () => {
    const hidden = harness('me', live, { visible: false })
    await hidden.handoff.check()
    const offline = harness('me', live, { online: false })
    await offline.handoff.check()
    expect([...hidden.posted, ...offline.posted]).toEqual([])
    expect(hidden.deps.read).not.toHaveBeenCalled()
  })

  it('asks nothing when the store is locked — the wedge check owns that', async () => {
    const h = harness('me', { state: 'locked' })
    expect(await h.handoff.check()).toMatchObject({ reason: 'locked' })
    expect(h.posted).toEqual([])
  })

  it('runs its own election at once when the holder says it let go', async () => {
    const h = harness('me', live)
    expect(
      await h.handoff.receive({
        type: 'yielded',
        holderId: 'holder',
        askerId: 'me',
      }),
    ).toEqual({ side: 'asker', result: 'took-over', fromId: 'holder' })
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(1)
  })

  it("ignores another tab's yielded and a yield naming someone else", async () => {
    const h = harness('me', live)
    await h.handoff.receive({
      type: 'yielded',
      holderId: 'holder',
      askerId: 'other',
    })
    await h.handoff.receive({
      type: 'yield',
      holderId: 'holder',
      askerId: 'other',
    })
    await h.handoff.receive('nonsense')
    await h.handoff.receive({ type: 'yield' })
    expect(h.deps.cycleNetwork).not.toHaveBeenCalled()
  })
})

describe('createPrimaryYield — the holder', () => {
  const ask = { type: 'yield', holderId: 'me', askerId: 'asker' } as const
  const mine = readOf(lease('me'), [row('me', false), row('asker', true)])

  it('lets go through its own network cycle, then says so', async () => {
    const h = harness('me', mine, { visible: false })
    expect(await h.handoff.receive(ask)).toEqual({
      side: 'holder',
      result: 'yielded',
      askerId: 'asker',
    })
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(1)
    expect(h.posted).toEqual([
      { type: 'yielded', holderId: 'me', askerId: 'asker' },
    ])
  })

  it('keeps the role while the user is looking at it', async () => {
    const h = harness('me', mine, { visible: true })
    expect(await h.handoff.receive(ask)).toMatchObject({ reason: 'visible' })
    expect(h.deps.cycleNetwork).not.toHaveBeenCalled()
  })

  it('keeps the role when it became visible during the read', async () => {
    const h = harness('me', mine, { visible: false })
    h.deps.read.mockImplementationOnce(async () => {
      h.state.visible = true
      return mine
    })
    expect(await h.handoff.receive(ask)).toMatchObject({ reason: 'visible' })
    expect(h.deps.cycleNetwork).not.toHaveBeenCalled()
  })

  it('never cycles with a write pending or a lease it no longer holds', async () => {
    const pending = harness(
      'me',
      readOf(lease('me'), [row('asker', true)], 2),
      { visible: false },
    )
    expect(await pending.handoff.receive(ask)).toMatchObject({
      reason: 'pending-writes',
    })
    const moved = harness('me', readOf(lease('other'), [row('asker', true)]), {
      visible: false,
    })
    expect(await moved.handoff.receive(ask)).toMatchObject({
      reason: 'not-holder',
    })
    expect(pending.deps.cycleNetwork).not.toHaveBeenCalled()
    expect(moved.deps.cycleNetwork).not.toHaveBeenCalled()
  })

  it('yields at most once per interval', async () => {
    const h = harness('me', mine, { visible: false })
    await h.handoff.receive(ask)
    expect(await h.handoff.receive(ask)).toMatchObject({ reason: 'throttled' })
    h.advance(YIELD_INTERVAL_MS)
    await h.handoff.receive(ask)
    expect(h.deps.cycleNetwork).toHaveBeenCalledTimes(2)
  })

  it('never rejects', async () => {
    const h = harness('me', mine, { visible: false })
    h.deps.cycleNetwork.mockRejectedValueOnce(new Error('terminated'))
    await expect(h.handoff.receive(ask)).resolves.toEqual({
      side: 'holder',
      result: 'error',
    })
    const asker = harness('me', mine)
    asker.deps.read.mockRejectedValueOnce(new Error('boom'))
    await expect(asker.handoff.check()).resolves.toMatchObject({
      result: 'error',
    })
  })
})

describe('runPrimaryYield', () => {
  function browser(before: string[], after: string[]) {
    const snapshots = [new Set(before), new Set(after)]
    const timers: Array<[() => void, number]> = []
    const repeating: Array<[() => void, number]> = []
    let visibleHandler: (() => void) | undefined
    let listener: ((message: unknown) => void) | undefined
    const posted: YieldMessage[] = []
    const factory = {
      isVisible: () => true,
      isOnline: () => true,
      now: () => NOW,
      read: jest.fn(async () =>
        readOf(lease('holder'), [row('holder', false), row('new', true)]),
      ),
      cycleNetwork: jest.fn(async () => undefined),
    }
    return {
      posted,
      timers,
      repeating,
      factory,
      fire: (message: unknown) => listener?.(message),
      show: () => visibleHandler?.(),
      readClientIds: jest.fn(() => snapshots.shift() ?? new Set<string>()),
      startClient: jest.fn(async () => undefined),
      openChannel: () => ({
        post: (message: YieldMessage) => posted.push(message),
        listen: (handler: (message: unknown) => void) => {
          listener = handler
        },
      }),
      onVisible: (handler: () => void) => {
        visibleHandler = handler
      },
      setTimer: (handler: () => void, ms: number) => {
        timers.push([handler, ms])
      },
      setRepeating: (handler: () => void, ms: number) => {
        repeating.push([handler, ms])
      },
    }
  }

  it('snapshots before starting, names itself the one new client, and schedules its looks', async () => {
    const b = browser(['holder'], ['holder', 'new'])
    await expect(runPrimaryYield(b)).resolves.toEqual({
      started: true,
      selfId: 'new',
    })
    expect(b.readClientIds.mock.invocationCallOrder[0]).toBeLessThan(
      b.startClient.mock.invocationCallOrder[0],
    )
    expect(b.timers.map(([, ms]) => ms)).toEqual([...BOOT_CHECK_DELAYS_MS])
    expect(b.repeating.map(([, ms]) => ms)).toEqual([RECHECK_MS])
    b.show()
    expect(b.timers.map(([, ms]) => ms)).toEqual([
      ...BOOT_CHECK_DELAYS_MS,
      VISIBLE_DWELL_MS,
    ])
    // The first look is immediate.
    expect(BOOT_CHECK_DELAYS_MS[0]).toBe(0)
    // Every boot look fires at once here; the ask goes out once
    // (ASK_RETRY_MS).
    for (const [fire] of b.timers) fire()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(b.posted).toEqual([
      { type: 'yield', holderId: 'holder', askerId: 'new' },
    ])
  })

  it('starts nothing when it cannot tell which client it is', async () => {
    const two = browser(['a'], ['a', 'b', 'c'])
    await expect(runPrimaryYield(two)).resolves.toEqual({
      started: false,
      reason: 'unidentified',
    })
    const early = browser(['a', 'me'], ['a', 'me'])
    await expect(runPrimaryYield(early)).resolves.toMatchObject({
      reason: 'unidentified',
    })
    expect(two.timers).toEqual([])
  })

  it('starts nothing without a BroadcastChannel', async () => {
    const b = browser([], ['me'])
    await expect(
      runPrimaryYield({ ...b, openChannel: () => undefined }),
    ).resolves.toEqual({ started: false, reason: 'no-channel' })
    expect(b.startClient).not.toHaveBeenCalled()
  })

  it('never rejects', async () => {
    const b = browser([], ['me'])
    b.startClient.mockRejectedValueOnce(new Error('failed-precondition'))
    await expect(runPrimaryYield(b)).resolves.toEqual({
      started: false,
      reason: 'error',
    })
  })
})

describe('readLease', () => {
  function fakeIndexedDb(
    initial: { owner?: LeaseRow; clients?: ClientRow[]; mutations?: number },
    { locked = false, exists = true } = {},
  ) {
    const stores: Record<string, Map<string, unknown>> = {
      owner: new Map(initial.owner ? [['owner', initial.owner]] : []),
      clientMetadata: new Map(
        (initial.clients ?? []).map((r) => [r.clientId, r]),
      ),
      mutations: new Map(
        Array.from({ length: initial.mutations ?? 0 }, (_, i) => [
          String(i),
          {},
        ]),
      ),
    }
    const modes: string[] = []
    const writes: string[] = []
    const database = {
      objectStoreNames: { contains: (name: string) => name in stores },
      close: jest.fn(),
      onversionchange: null,
      transaction: (_names: string[], mode: string) => {
        modes.push(mode)
        const queue: Array<() => void> = []
        let aborted = false
        const tx: Record<string, unknown> & {
          oncomplete?: () => void
          onabort?: () => void
        } = {
          abort: () => {
            aborted = true
            tx.onabort?.()
          },
          objectStore: (name: string) => {
            const request = (run: () => unknown) => {
              const req: { result?: unknown; onsuccess?: () => void } = {}
              queue.push(() => {
                req.result = run()
                req.onsuccess?.()
              })
              drain()
              return req
            }
            return {
              get: (key: string) => request(() => stores[name].get(key)),
              count: () => request(() => stores[name].size),
              put: () => writes.push(name),
            }
          },
        }
        let scheduled = false
        const drain = () => {
          if (locked || scheduled) return
          scheduled = true
          setTimeout(() => {
            scheduled = false
            while (queue.length && !aborted) queue.shift()!()
            if (queue.length) drain()
            else if (!aborted) tx.oncomplete?.()
          }, 0)
        }
        return tx
      },
    }
    const factory = {
      databases: async () => (exists ? [{ name: 'db', version: 17 }] : []),
      open: () => {
        const request: Record<string, unknown> & { onsuccess?: () => void } = {}
        setTimeout(() => {
          request.result = database
          request.onsuccess?.()
        }, 0)
        return request
      },
    } as unknown as IDBFactory
    return { factory, modes, writes, database }
  }

  it("reads the lease, the asked-for rows plus the holder's, and the write queue, read-only", async () => {
    const idb = fakeIndexedDb({
      owner: lease('holder'),
      clients: [row('holder', false), row('me', true), row('other', true)],
      mutations: 2,
    })
    const read = await readLease(idb.factory, 'db', ['me'])
    expect(read).toEqual({
      state: 'read',
      owner: lease('holder'),
      rows: { me: row('me', true), holder: row('holder', false) },
      pendingWrites: 2,
    })
    expect(idb.modes).toEqual(['readonly'])
    expect(idb.writes).toEqual([])
    expect(idb.database.close).toHaveBeenCalled()
  })

  it('gives up on a store another tab has locked', async () => {
    const idb = fakeIndexedDb({ owner: lease('holder') }, { locked: true })
    await expect(
      readLease(idb.factory, 'db', ['me'], { timeoutMs: 10 }),
    ).resolves.toEqual({ state: 'locked' })
  })

  it('never opens a database that does not exist', async () => {
    const idb = fakeIndexedDb({}, { exists: false })
    await expect(readLease(idb.factory, 'db', ['me'])).resolves.toEqual({
      state: 'unavailable',
    })
    await expect(readLease(undefined, 'db', ['me'])).resolves.toEqual({
      state: 'unavailable',
    })
  })
})
