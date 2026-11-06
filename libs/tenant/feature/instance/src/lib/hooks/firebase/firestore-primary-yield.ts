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

import {
  disableNetwork,
  enableNetwork,
  type Firestore,
} from 'firebase/firestore'
import {
  type ClientRow,
  type LeaseRow,
  openExisting,
  PRIMARY_LEASE_MAX_AGE_MS,
  readSharedClientIds,
} from './firestore-tab-handoff'

/**
 * A BACKGROUND TAB HANDS THE SHARED CACHE TO THE TAB THE USER IS LOOKING AT
 * (AGL-4204).
 *
 * ## What it fixes
 *
 * With `persistentMultipleTabManager` one tab, the lease holder, does every
 * tab's network and most of their IndexedDB work, and every SDK transaction
 * locks every store. The SDK never moves a LIVE lease
 * (`IndexedDbPersistence.canActAsPrimary`, `@firebase/firestore` 4.18.0):
 * a holder whose lease is under 5 s old and whose network is on keeps it
 * whatever its visibility, and a visible tab wins only on a lapse. A console
 * tab left in the background therefore serves the tab the user is in for as
 * long as it keeps renewing, from a renderer the browser runs at background
 * priority. Measured in production on 2026-11-06: reads in other tabs waited
 * 16.9 s, 18.9 s and 4.5 s behind a background holder within three minutes,
 * and a lease went 23.7 s stale. The cache's size never moved in those
 * stalls, so they were not LRU collection.
 *
 * `firestore-tab-handoff.ts` (AGL-3660) claims a LAPSED lease for a new
 * visible tab at boot. It cannot take a live one: two primaries over one
 * cache write tombstones (AGL-3788). This module covers the live case by
 * having the HOLDER let go, through the SDK's own election.
 *
 * ## How
 *
 * - **The asker** (a visible, online tab on the durable multi-tab cache) reads
 *   the lease and the holder's row, read-only. When the lease is live, held
 *   by another tab, and that tab's own row says it is in the background, it
 *   posts `yield` on a `BroadcastChannel` named for this cache. It looks
 *   three times in its first 9 s, once it has been visible for
 *   {@link VISIBLE_DWELL_MS}, and
 *   every {@link RECHECK_MS} while it stays visible.
 * - **The holder** knows its own client id (the one `firestore_clients_*` key
 *   that appeared while its client started, as in AGL-3660). On a `yield`
 *   naming it, while it is hidden and online, it rereads in one transaction:
 *   still the holder; the asker's row fresh, foreground and online; no write
 *   pending. Then `disableNetwork` → `enableNetwork`. With its network off,
 *   the SDK's election finds the asker a better candidate
 *   (`otherClientHasBetterNetworkState`) and releases the lease, after the
 *   disable has stopped its Watch and write streams, because the election
 *   is queued behind the disable. Re-enabled, it finds the lease vacant and
 *   a foreground candidate, so it stays secondary. It replies `yielded`.
 * - **The asker** then cycles its own network. That cycle is invisible in a
 *   secondary (`syncEngineApplyOnlineStateChange` ignores its own remote
 *   store there), and the election it runs takes the vacant lease at once
 *   instead of on its next 4 s tick.
 *
 * ## Why it is safe
 *
 * - **Never two primaries.** The lease is only ever released by its holder
 *   and only ever taken vacant, both by the SDK's own code. Nothing here
 *   writes a lease.
 * - **Never with a write in flight.** A new primary resends every
 *   unacknowledged batch, so the holder declines while `mutations` has a row,
 *   the same rule AGL-3660 follows.
 * - **Never on a guess.** A tab that cannot tell which client it is (two tabs
 *   started together) never acts as holder. The asker's row must be younger
 *   than {@link ASKER_FRESH_MS}, or the SDK would not hand to it and the
 *   holder's cycle would only flicker its network.
 * - **Rate-limited both ways**: one ask per {@link ASK_INTERVAL_MS}, one
 *   yield per {@link YIELD_INTERVAL_MS}. Switching between two console tabs
 *   moves the role at most that often.
 * - **Every failure is the old behaviour.** No `BroadcastChannel`, no
 *   database, a store another tab has locked, any throw: nothing is posted
 *   or cycled, and the SDK's election runs as it always has.
 */

/** How long a tab must stay visible before it asks for the role. */
export const VISIBLE_DWELL_MS = 3_000

/** How often a visible tab looks again while it stays visible. */
export const RECHECK_MS = 15_000

/**
 * The looks after boot. The first comes once AGL-3660's claim has had its
 * turn. The SDK writes a new tab's first row as hidden, and corrects it at
 * its first 4 s tick (see `firestore-tab-handoff.ts`), so the first look
 * often finds this tab "not ready". The later ones land after that tick. Each
 * is a no-op once an ask has gone out (`ASK_INTERVAL_MS`) or the role has
 * moved here.
 */
export const BOOT_CHECK_DELAYS_MS = [2_000, 5_000, 9_000] as const

/** At most one ask per this long from one tab. */
export const ASK_INTERVAL_MS = 15_000

/** At most one yield per this long from one tab. */
export const YIELD_INTERVAL_MS = 30_000

/**
 * The asker's row must be at least this fresh. The SDK only hands the lease
 * to a client renewed within `MAX_PRIMARY_ELIGIBLE_AGE_MS` (5 s); a visible
 * tab renews every 4 s.
 */
export const ASKER_FRESH_MS = 4_500

/** How long a read may wait to start before it counts as locked. */
export const READ_TIMEOUT_MS = 1_500

export type YieldMessage =
  | { type: 'yield'; holderId: string; askerId: string }
  | { type: 'yielded'; holderId: string; askerId: string }

/** Why a visible tab did not ask. */
export type AskSkip =
  | 'vacant'
  | 'self-holds'
  | 'holder-unknown'
  | 'holder-visible'
  | 'lease-lapsed'
  | 'self-unknown'
  | 'self-not-ready'

export type AskDecision =
  { ask: true; holderId: string } | { ask: false; reason: AskSkip }

/**
 * Whether the tab `selfId` should ask the holder to yield. Pure.
 *
 * A lapsed lease is left alone: the SDK's next election in a visible tab
 * takes it, and AGL-3660 claims it at boot.
 */
export function decideAsk(input: {
  owner: LeaseRow | undefined
  holder: ClientRow | undefined
  self: ClientRow | undefined
  selfId: string
  now: number
}): AskDecision {
  const { owner, holder, self, selfId, now } = input
  if (!owner) return { ask: false, reason: 'vacant' }
  if (owner.ownerId === selfId) return { ask: false, reason: 'self-holds' }
  if (now - owner.leaseTimestampMs >= PRIMARY_LEASE_MAX_AGE_MS)
    return { ask: false, reason: 'lease-lapsed' }
  if (!holder) return { ask: false, reason: 'holder-unknown' }
  if (holder.inForeground) return { ask: false, reason: 'holder-visible' }
  if (!self) return { ask: false, reason: 'self-unknown' }
  // The SDK hands only to a client that has recorded itself foreground and
  // online; the first record a new tab writes says hidden (AGL-3660).
  if (!self.inForeground || !self.networkEnabled)
    return { ask: false, reason: 'self-not-ready' }
  return { ask: true, holderId: owner.ownerId }
}

/** Why the holder did not yield. */
export type YieldSkip =
  | 'not-holder'
  | 'asker-unknown'
  | 'asker-stale'
  | 'asker-hidden'
  | 'asker-offline'
  | 'pending-writes'

export type YieldDecision =
  { yield: true } | { yield: false; reason: YieldSkip }

/** Whether the holder `selfId` should let go for `asker`. Pure. */
export function decideYield(input: {
  owner: LeaseRow | undefined
  asker: ClientRow | undefined
  selfId: string
  pendingWrites: number
  now: number
}): YieldDecision {
  const { owner, asker, selfId, pendingWrites, now } = input
  if (owner?.ownerId !== selfId) return { yield: false, reason: 'not-holder' }
  if (pendingWrites > 0) return { yield: false, reason: 'pending-writes' }
  if (!asker) return { yield: false, reason: 'asker-unknown' }
  if (!asker.inForeground) return { yield: false, reason: 'asker-hidden' }
  if (!asker.networkEnabled) return { yield: false, reason: 'asker-offline' }
  if (now - asker.updateTimeMs > ASKER_FRESH_MS)
    return { yield: false, reason: 'asker-stale' }
  return { yield: true }
}

/** One read-only look at the lease, two client rows and the write queue. */
export type LeaseRead =
  | {
      state: 'read'
      owner: LeaseRow | undefined
      rows: Record<string, ClientRow | undefined>
      pendingWrites: number
    }
  | { state: 'locked' }
  | { state: 'unavailable' }

const OWNER_STORE = 'owner'
const OWNER_KEY = 'owner'
const CLIENT_METADATA_STORE = 'clientMetadata'
const MUTATIONS_STORE = 'mutations'

/**
 * Reads the lease, the rows for `clientIds` (plus the holder's), and the
 * pending-write count in one `readonly` transaction. Gives up when the
 * transaction cannot start within `timeoutMs`: a store another tab holds is
 * the AGL-3428 wedge, which `firestore-multitab-wedge.ts` handles.
 */
export async function readLease(
  factory: IDBFactory | undefined,
  databaseName: string,
  clientIds: string[],
  { timeoutMs = READ_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<LeaseRead> {
  if (!factory) return { state: 'unavailable' }
  const database = await openExisting(factory, databaseName).catch(
    () => undefined,
  )
  if (!database) return { state: 'unavailable' }
  const stores = [OWNER_STORE, CLIENT_METADATA_STORE, MUTATIONS_STORE]
  if (!stores.every((store) => database.objectStoreNames.contains(store))) {
    database.close()
    return { state: 'unavailable' }
  }
  return new Promise<LeaseRead>((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(stores, 'readonly')
    } catch {
      database.close()
      resolve({ state: 'unavailable' })
      return
    }
    let settled = false
    let started = false
    let result: LeaseRead = { state: 'unavailable' }
    const finish = (value: LeaseRead) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      database.close()
      resolve(value)
    }
    const timer = setTimeout(() => {
      if (started) return
      try {
        transaction.abort()
      } catch {
        // Already finished.
      }
      finish({ state: 'locked' })
    }, timeoutMs)
    transaction.oncomplete = () => finish(result)
    transaction.onabort = () =>
      finish(started ? { state: 'unavailable' } : { state: 'locked' })
    transaction.onerror = () => finish({ state: 'unavailable' })

    const clients = transaction.objectStore(CLIENT_METADATA_STORE)
    const ownerRequest = transaction.objectStore(OWNER_STORE).get(OWNER_KEY)
    ownerRequest.onsuccess = () => {
      started = true
      const owner = ownerRequest.result as LeaseRow | undefined
      const ids = [...new Set([...clientIds, owner?.ownerId].filter(Boolean))]
      const requests = ids.map((id) => [id, clients.get(id!)] as const)
      const countRequest = transaction.objectStore(MUTATIONS_STORE).count()
      countRequest.onsuccess = () => {
        // Requests in one transaction complete in order: every get landed.
        const rows: Record<string, ClientRow | undefined> = {}
        for (const [id, request] of requests)
          rows[id!] = request.result as ClientRow | undefined
        result = {
          state: 'read',
          owner,
          rows,
          pendingWrites: countRequest.result,
        }
      }
    }
  })
}

/** What one look or one message did, for the debug log and the specs. */
export type YieldEvent =
  | { side: 'asker'; result: 'asked'; holderId: string }
  | {
      side: 'asker'
      result: 'skipped'
      reason: AskSkip | 'locked' | 'unavailable' | 'throttled'
    }
  | { side: 'asker'; result: 'took-over'; fromId: string }
  | { side: 'holder'; result: 'yielded'; askerId: string }
  | {
      side: 'holder'
      result: 'skipped'
      reason:
        | YieldSkip
        | 'visible'
        | 'offline'
        | 'locked'
        | 'unavailable'
        | 'throttled'
    }
  | { side: 'holder' | 'asker'; result: 'error' }

export interface PrimaryYieldDeps {
  selfId: string
  isVisible: () => boolean
  isOnline: () => boolean
  now: () => number
  read: (clientIds: string[]) => Promise<LeaseRead>
  post: (message: YieldMessage) => void
  /** `disableNetwork` then `enableNetwork`: two elections, at once. */
  cycleNetwork: () => Promise<void>
  onEvent?: (event: YieldEvent) => void
}

/**
 * Both halves of the handoff for one tab, with the browser parts injected.
 * Neither method ever rejects.
 */
export function createPrimaryYield(deps: PrimaryYieldDeps) {
  let lastAskAt = Number.NEGATIVE_INFINITY
  let lastYieldAt = Number.NEGATIVE_INFINITY
  let busy = false
  // Looks can overlap (a boot look, the dwell look and the recheck): only
  // one reads at a time, so the throttle sees the ask the first one made.
  let looking = false
  const emit = (event: YieldEvent) => {
    deps.onEvent?.(event)
    return event
  }

  /** A visible tab's look: ask the holder to yield when it should. */
  async function check(): Promise<YieldEvent> {
    try {
      if (!deps.isVisible() || !deps.isOnline())
        return emit({
          side: 'asker',
          result: 'skipped',
          reason: 'self-not-ready',
        })
      if (looking || deps.now() - lastAskAt < ASK_INTERVAL_MS)
        return emit({ side: 'asker', result: 'skipped', reason: 'throttled' })
      looking = true
      try {
        return await look()
      } finally {
        looking = false
      }
    } catch {
      return emit({ side: 'asker', result: 'error' })
    }
  }

  /** One read and, when it says so, one ask. */
  async function look(): Promise<YieldEvent> {
    const read = await deps.read([deps.selfId])
    if (read.state !== 'read')
      return emit({ side: 'asker', result: 'skipped', reason: read.state })
    const decision = decideAsk({
      owner: read.owner,
      holder: read.owner ? read.rows[read.owner.ownerId] : undefined,
      self: read.rows[deps.selfId],
      selfId: deps.selfId,
      now: deps.now(),
    })
    if ('reason' in decision)
      return emit({ side: 'asker', result: 'skipped', reason: decision.reason })
    // Hidden or offline since the read: the SDK would not hand to us.
    if (!deps.isVisible() || !deps.isOnline())
      return emit({
        side: 'asker',
        result: 'skipped',
        reason: 'self-not-ready',
      })
    lastAskAt = deps.now()
    deps.post({
      type: 'yield',
      holderId: decision.holderId,
      askerId: deps.selfId,
    })
    return emit({ side: 'asker', result: 'asked', holderId: decision.holderId })
  }

  /** Both sides' message handler. */
  async function receive(message: unknown): Promise<YieldEvent | undefined> {
    if (!message || typeof message !== 'object') return undefined
    const { type, holderId, askerId } = message as Partial<YieldMessage>
    if (typeof holderId !== 'string' || typeof askerId !== 'string')
      return undefined
    try {
      if (type === 'yielded' && askerId === deps.selfId) {
        // The holder let go: run our election now, not on the next tick.
        if (!deps.isVisible() || !deps.isOnline()) return undefined
        await deps.cycleNetwork()
        return emit({ side: 'asker', result: 'took-over', fromId: holderId })
      }
      if (type !== 'yield' || holderId !== deps.selfId) return undefined
      if (deps.isVisible())
        return emit({ side: 'holder', result: 'skipped', reason: 'visible' })
      if (!deps.isOnline())
        return emit({ side: 'holder', result: 'skipped', reason: 'offline' })
      if (busy || deps.now() - lastYieldAt < YIELD_INTERVAL_MS)
        return emit({ side: 'holder', result: 'skipped', reason: 'throttled' })
      busy = true
      try {
        const read = await deps.read([askerId])
        if (read.state !== 'read')
          return emit({ side: 'holder', result: 'skipped', reason: read.state })
        const decision = decideYield({
          owner: read.owner,
          asker: read.rows[askerId],
          selfId: deps.selfId,
          pendingWrites: read.pendingWrites,
          now: deps.now(),
        })
        if ('reason' in decision)
          return emit({
            side: 'holder',
            result: 'skipped',
            reason: decision.reason,
          })
        // Shown again while we read: keep the role, the user is here now.
        if (deps.isVisible())
          return emit({ side: 'holder', result: 'skipped', reason: 'visible' })
        lastYieldAt = deps.now()
        await deps.cycleNetwork()
        deps.post({ type: 'yielded', holderId: deps.selfId, askerId })
        return emit({ side: 'holder', result: 'yielded', askerId })
      } finally {
        busy = false
      }
    } catch {
      return emit({
        side: type === 'yielded' ? 'asker' : 'holder',
        result: 'error',
      })
    }
  }

  return { check, receive }
}

/** What started, for the specs. */
export type PrimaryYieldStart =
  | { started: true; selfId: string }
  | { started: false; reason: 'no-channel' | 'unidentified' | 'error' }

export interface PrimaryYieldBrowser {
  /** Synchronous: the first call is the snapshot before this client starts. */
  readClientIds: () => ReadonlySet<string>
  startClient: () => Promise<void>
  openChannel: () =>
    | {
        post: (message: YieldMessage) => void
        listen: (handler: (message: unknown) => void) => void
      }
    | undefined
  onVisible: (handler: () => void) => void
  setTimer: (handler: () => void, ms: number) => void
  setRepeating: (handler: () => void, ms: number) => void
  factory: Omit<PrimaryYieldDeps, 'selfId' | 'post'>
}

/**
 * Identifies this tab's client, then wires the asker's looks and the
 * holder's handler. Never rejects.
 */
export async function runPrimaryYield(
  browser: PrimaryYieldBrowser,
): Promise<PrimaryYieldStart> {
  try {
    // Before this tab's Firestore starts, or this tab would be in it.
    const before = browser.readClientIds()
    const channel = browser.openChannel()
    if (!channel) return { started: false, reason: 'no-channel' }
    await browser.startClient()
    const added = [...browser.readClientIds()].filter((id) => !before.has(id))
    // Exactly one new client is this tab; anything else cannot be told apart.
    if (added.length !== 1) return { started: false, reason: 'unidentified' }
    const selfId = added[0]
    const handoff = createPrimaryYield({
      ...browser.factory,
      selfId,
      post: channel.post,
    })
    channel.listen((message) => void handoff.receive(message))
    for (const delay of BOOT_CHECK_DELAYS_MS)
      browser.setTimer(() => {
        if (browser.factory.isVisible()) void handoff.check()
      }, delay)
    browser.onVisible(() =>
      browser.setTimer(() => {
        if (browser.factory.isVisible()) void handoff.check()
      }, VISIBLE_DWELL_MS),
    )
    browser.setRepeating(() => {
      if (browser.factory.isVisible()) void handoff.check()
    }, RECHECK_MS)
    return { started: true, selfId }
  } catch {
    return { started: false, reason: 'error' }
  }
}

/**
 * Starts the handoff for a Firestore that `initializeFirestore` has just
 * configured with the durable multi-tab cache under `prefix`. Call it in the
 * same task as `initializeFirestore`, before any read: its first step is the
 * synchronous snapshot of the clients that are not this tab.
 */
export function startFirestorePrimaryYield(
  firestore: Firestore,
  prefix: string,
): Promise<PrimaryYieldStart> {
  if (typeof window === 'undefined')
    return Promise.resolve({ started: false, reason: 'no-channel' })
  let storage: Storage | undefined
  let factory: IDBFactory | undefined
  try {
    storage = window.localStorage
    factory = window.indexedDB
  } catch {
    // Site data blocked: the snapshot reads nothing and nothing starts.
  }
  const databaseName = `${prefix}main`
  const isVisible = () => document.visibilityState === 'visible'
  return runPrimaryYield({
    readClientIds: () => readSharedClientIds(storage, prefix),
    startClient: () => enableNetwork(firestore),
    openChannel: () => {
      if (typeof BroadcastChannel !== 'function') return undefined
      const channel = new BroadcastChannel(`aglyn:firestore-primary:${prefix}`)
      return {
        post: (message) => channel.postMessage(message),
        listen: (handler) => {
          channel.onmessage = (event) => handler(event.data)
        },
      }
    },
    onVisible: (handler) =>
      document.addEventListener('visibilitychange', () => {
        if (isVisible()) handler()
      }),
    setTimer: (handler, ms) => void setTimeout(handler, ms),
    setRepeating: (handler, ms) => void setInterval(handler, ms),
    factory: {
      isVisible,
      isOnline: () => navigator.onLine !== false,
      now: Date.now,
      read: (clientIds) => readLease(factory, databaseName, clientIds),
      cycleNetwork: async () => {
        await disableNetwork(firestore)
        await enableNetwork(firestore)
      },
      onEvent: (event) => {
        if (event.result === 'yielded' || event.result === 'took-over')
          console.debug(
            '[firestore] Moved the shared cache to the visible tab (AGL-4204).',
            event,
          )
      },
    },
  })
}
