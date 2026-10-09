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

/**
 * A NEWLY OPENED, VISIBLE TAB TAKES THE PRIMARY LEASE FROM A HIDDEN ONE
 * (AGL-3660).
 *
 * ## What the SDK does on its own
 *
 * With `persistentMultipleTabManager`, exactly one tab per origin — the
 * holder of the `owner` row in `firestore/<app>/<project>/main` — runs the
 * network. Every other tab sends its queries to that tab through
 * `localStorage` and reads the answers back out of IndexedDB. Read against
 * `@firebase/firestore` 4.17.2 (`IndexedDbPersistence`):
 *
 * - **A valid lease is never handed over.** `canActAsPrimary` returns `true`
 *   for the holder whenever its own lease is under 5 s old
 *   (`MAX_PRIMARY_ELIGIBLE_AGE_MS`) and its network is enabled, whatever its
 *   visibility. The "prefer the foreground tab" rule only applies once the
 *   lease has lapsed. A console tab the user left in the background therefore
 *   keeps serving the tab they are looking at, for as long as its 4 s renewal
 *   timer keeps firing.
 * - **A background holder is a slow server.** Its renewal timer is throttled
 *   (production lease rows, 2026-10-08: renewed every ~4.9 s, against a 5 s
 *   lapse), and every query the new tab issues waits on that tab's event loop.
 *   The workspace read on a fresh `/aglyn-org/media` tab came back only once
 *   the new tab had won the lease on a lapse, its own Listen channel opening
 *   ~4.7 s in (PR #1313).
 * - **The new tab's first record says it is hidden.** `start()` runs its
 *   first election (`updateClientMetadataAndTryBecomePrimary`) before
 *   `attachVisibilityHandler()` has read `document.visibilityState`, so the
 *   `clientMetadata` row it writes carries `inForeground: false` until the
 *   next 4 s tick. When the holder's lease does lapse in that window, the
 *   holder finds no better candidate and takes it straight back.
 *
 * ## What this does
 *
 * Once, at boot, in a tab that is visible and online:
 *
 * 1. Snapshot the client ids already registered, synchronously, in the same
 *    task as `initializeFirestore` — before anything can start this tab's
 *    client. They come from the SDK's `firestore_clients_<prefix>_<id>` keys
 *    in `localStorage`, which a tab writes once its persistence has started.
 * 2. Start this tab's Firestore (`enableNetwork` — a no-op on a client whose
 *    network is on — resolves once persistence has started and the tab has
 *    run its first election). The one id that was not there before is this
 *    tab.
 * 3. In ONE IndexedDB transaction over `owner`, `clientMetadata` and
 *    `mutations`, decide with {@link decideLeaseClaim}. When the holder is
 *    another tab that has recorded itself as hidden and no write is pending,
 *    write this tab's row as foreground and the lease in this tab's name.
 * 4. Cycle this tab's network (`disableNetwork` then `enableNetwork`): each
 *    step runs the SDK's own election at once, and the second finds a valid
 *    lease that is this tab's and becomes primary.
 *
 * ## Why this is safe
 *
 * - **It is the SDK's own handoff.** A holder that finds the lease in another
 *   tab's name is exactly a holder whose lease lapsed: every
 *   `readwrite-primary` transaction re-verifies the lease inside the
 *   transaction (`verifyPrimaryLease`), fails, flips the tab to secondary and
 *   throws the `failed-precondition` its sync engine already swallows
 *   (`ignoreIfPrimaryLeaseLoss`). IndexedDB serialises our transaction against
 *   the SDK's (which span every store), so no election interleaves with it.
 * - **The old holder cannot take it back.** The lease is valid and not its
 *   own, so its `canActAsPrimary` is `false`. Should this tab fail to renew,
 *   the lease lapses in 5 s and the corrected `inForeground: true` row makes
 *   this tab the preferred candidate, not the hidden one.
 * - **Never with a write in flight.** The holder sends pending mutations; a
 *   new primary resends every unacknowledged batch. Any row in `mutations`
 *   skips the claim, so a write is never sent twice by two tabs.
 * - **Never from a visible holder.** A tab visible in another window serves
 *   quickly (measured in production: ~390 ms from a query target written to
 *   it being `current`), and taking its lease would only move the work.
 * - **The cycle is invisible in a secondary.** The sync engine ignores its
 *   own remote store's online state while secondary
 *   (`syncEngineApplyOnlineStateChange`), so no listener sees an offline
 *   flicker. If this tab somehow became primary in between, the cycle is the
 *   same one `firestore-stall-recovery.ts` runs.
 * - **Every failure is the old behaviour.** Anything unexpected — no
 *   database, the store locked (the AGL-3428 wedge), two new tabs at once, a
 *   holder that is visible — skips the claim, and the SDK's own election runs
 *   as it always has.
 *
 * Not chosen: `persistentSingleTabManager` (rejected in AGL-3373/3428, and
 * `forceOwnership` there fails every other tab with
 * `PRIMARY_LEASE_EXCLUSIVE_ERROR_MSG`); `getDocFromServer` (a secondary routes
 * it through the holder like any listen); a per-tab memory cache for the first
 * read (the cache is fixed at `initializeFirestore`); a synthetic
 * `visibilitychange` to rerun the election (also fires the console's own
 * twenty-odd visibility listeners).
 */

/** The SDK's lease lifetime (`MAX_PRIMARY_ELIGIBLE_AGE_MS`). */
export const PRIMARY_LEASE_MAX_AGE_MS = 5_000

/**
 * How long the claim transaction may wait to start. The SDK's own take
 * milliseconds; one that cannot start is behind the AGL-3428 wedge, which
 * `firestore-multitab-wedge.ts` handles.
 */
export const CLAIM_TIMEOUT_MS = 1_500

/** The SDK's stores and the lease row's key (`indexeddb_sentinels.ts`). */
const OWNER_STORE = 'owner'
const OWNER_KEY = 'owner'
const CLIENT_METADATA_STORE = 'clientMetadata'
const MUTATIONS_STORE = 'mutations'

/** `DbPrimaryClient`. */
export interface LeaseRow {
  ownerId: string
  allowTabSynchronization: boolean
  leaseTimestampMs: number
}

/** `DbClientMetadata`. */
export interface ClientRow {
  clientId: string
  updateTimeMs: number
  networkEnabled: boolean
  inForeground: boolean
}

/** Why the claim was not made. */
export type LeaseClaimSkip =
  | 'unidentified'
  | 'vacant'
  | 'already-primary'
  | 'exclusive-holder'
  | 'holder-unknown'
  | 'holder-visible'
  | 'pending-writes'

export type LeaseClaimDecision =
  { claim: true } | { claim: false; reason: LeaseClaimSkip }

/**
 * Whether this tab (`self`) should take the lease `owner` holds. Pure: the
 * caller reads every input inside the one transaction that writes the result.
 *
 * A vacant or lapsed-and-vacant lease is left to the SDK, whose next election
 * takes it; only a lease another tab holds is ever claimed, and only from a
 * holder whose own row says it is in the background.
 */
export function decideLeaseClaim(input: {
  owner: LeaseRow | undefined
  holder: ClientRow | undefined
  self: ClientRow | undefined
  pendingWrites: number
}): LeaseClaimDecision {
  const { owner, holder, self, pendingWrites } = input
  if (!self) return { claim: false, reason: 'unidentified' }
  if (!owner) return { claim: false, reason: 'vacant' }
  if (owner.ownerId === self.clientId)
    return { claim: false, reason: 'already-primary' }
  // A single-tab holder never shares; `persistentMultipleTabManager` never
  // writes `false`, so this is another configuration on the origin.
  if (!owner.allowTabSynchronization)
    return { claim: false, reason: 'exclusive-holder' }
  if (pendingWrites > 0) return { claim: false, reason: 'pending-writes' }
  if (!holder) return { claim: false, reason: 'holder-unknown' }
  if (holder.inForeground) return { claim: false, reason: 'holder-visible' }
  return { claim: true }
}

/** What the boot handoff did. */
export type TabHandoffOutcome =
  | { result: 'claimed'; fromOwnerId: string; leaseAgeMs: number }
  | {
      result: 'skipped'
      reason:
        | LeaseClaimSkip
        | 'hidden'
        | 'offline'
        | 'alone'
        | 'no-database'
        | 'locked'
        | 'error'
    }

/** What one claim transaction found and did. */
export type ClaimTransactionResult =
  | { state: 'claimed'; fromOwnerId: string; leaseAgeMs: number }
  | { state: 'skipped'; reason: LeaseClaimSkip }
  | { state: 'locked' }
  | { state: 'unavailable' }

export interface TabHandoffDeps {
  isVisible: () => boolean
  isOnline: () => boolean
  /**
   * Client ids registered on this origin. Must be synchronous: the first call
   * is the snapshot taken before this tab's client can start.
   */
  readClientIds: () => ReadonlySet<string>
  /** Starts this tab's Firestore; resolves once its persistence has started. */
  startClient: () => Promise<void>
  /** Runs the claim for `selfId` in one transaction. */
  claim: (selfId: string | undefined) => Promise<ClaimTransactionResult>
  /** `disableNetwork` then `enableNetwork`: two elections, at once. */
  cycleNetwork: () => Promise<void>
}

/**
 * The boot handoff, with its browser parts injected. Never rejects.
 */
export async function runTabHandoff(
  deps: TabHandoffDeps,
): Promise<TabHandoffOutcome> {
  try {
    if (!deps.isVisible()) return { result: 'skipped', reason: 'hidden' }
    if (!deps.isOnline()) return { result: 'skipped', reason: 'offline' }
    // Before this tab's Firestore starts, or this tab would be in it.
    const before = deps.readClientIds()
    // No other tab: this one wins the lease at its first election.
    if (before.size === 0) return { result: 'skipped', reason: 'alone' }
    await deps.startClient()
    // The user may have switched away while the client started.
    if (!deps.isVisible()) return { result: 'skipped', reason: 'hidden' }
    const added = [...deps.readClientIds()].filter((id) => !before.has(id))
    // Exactly one new client is this tab. None means this tab's Firestore
    // started before the snapshot; two means another tab started alongside.
    // Either way this tab cannot be told apart, so nothing is claimed.
    if (added.length !== 1) return { result: 'skipped', reason: 'unidentified' }
    const selfId = added[0]
    const outcome = await deps.claim(selfId)
    if (outcome.state === 'locked')
      return { result: 'skipped', reason: 'locked' }
    if (outcome.state === 'unavailable')
      return { result: 'skipped', reason: 'no-database' }
    if (outcome.state === 'skipped')
      return { result: 'skipped', reason: outcome.reason }
    await deps.cycleNetwork()
    return {
      result: 'claimed',
      fromOwnerId: outcome.fromOwnerId,
      leaseAgeMs: outcome.leaseAgeMs,
    }
  } catch {
    return { result: 'skipped', reason: 'error' }
  }
}

/**
 * Opens `databaseName` only if it already exists, at its current version —
 * never creating it under the SDK (the rule `probePrimaryLease` follows) —
 * and closes on `versionchange` so an SDK upgrade is never held up.
 */
async function openExisting(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase | undefined> {
  if (typeof factory.databases !== 'function') return undefined
  const databases = await factory.databases()
  if (!databases.some((database) => database.name === databaseName))
    return undefined
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(databaseName)
    } catch {
      resolve(undefined)
      return
    }
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => resolve(undefined)
    request.onblocked = () => resolve(undefined)
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

const hasStores = (database: IDBDatabase, stores: string[]) =>
  stores.every((store) => database.objectStoreNames.contains(store))

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The client ids the SDK has registered under `prefix`
 * (`firestore/<app>/<project>/`), from its `firestore_clients_<prefix>_<id>`
 * keys. Synchronous, so a snapshot can be taken before this tab's client
 * starts. A key whose tab has since closed is harmless here: only ids that
 * APPEAR between two snapshots are read as this tab.
 */
export function readSharedClientIds(
  storage: Pick<Storage, 'length' | 'key'> | undefined,
  prefix: string,
): ReadonlySet<string> {
  const ids = new Set<string>()
  if (!storage) return ids
  // The SDK's own key shape: a client id never contains `_`.
  const clientKey = new RegExp(
    `^firestore_clients_${escapeRegExp(prefix)}_([^_]+)$`,
  )
  try {
    for (let i = 0; i < storage.length; i++) {
      const match = clientKey.exec(storage.key(i) ?? '')
      if (match) ids.add(match[1])
    }
  } catch {
    // Site data blocked: no ids, so the handoff stands down.
  }
  return ids
}

/**
 * Reads the lease, both client rows and the pending-write count, decides, and
 * writes the claim — all in one `readwrite` transaction, so no election runs
 * between the read and the write. Aborted when it cannot start within
 * `timeoutMs`.
 */
export async function claimPrimaryLease(
  factory: IDBFactory | undefined,
  databaseName: string,
  selfId: string | undefined,
  {
    timeoutMs = CLAIM_TIMEOUT_MS,
    now = Date.now,
  }: { timeoutMs?: number; now?: () => number } = {},
): Promise<ClaimTransactionResult> {
  if (!factory) return { state: 'unavailable' }
  const database = await openExisting(factory, databaseName).catch(
    () => undefined,
  )
  if (!database) return { state: 'unavailable' }
  const stores = [OWNER_STORE, CLIENT_METADATA_STORE, MUTATIONS_STORE]
  if (!hasStores(database, stores)) {
    database.close()
    return { state: 'unavailable' }
  }
  return new Promise<ClaimTransactionResult>((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(stores, 'readwrite')
    } catch {
      database.close()
      resolve({ state: 'unavailable' })
      return
    }
    let settled = false
    let started = false
    let result: ClaimTransactionResult = { state: 'unavailable' }
    // Only a transaction that cannot START is aborted: once the lease read
    // has landed, the decision and its writes take milliseconds.
    const timer = setTimeout(() => {
      if (started) return
      try {
        transaction.abort()
      } catch {
        // Already finished.
      }
      finish({ state: 'locked' })
    }, timeoutMs)
    const finish = (value: ClaimTransactionResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      database.close()
      resolve(value)
    }
    transaction.oncomplete = () => finish(result)
    transaction.onabort = () =>
      finish(started ? { state: 'unavailable' } : { state: 'locked' })
    transaction.onerror = () => finish({ state: 'unavailable' })

    const owners = transaction.objectStore(OWNER_STORE)
    const clients = transaction.objectStore(CLIENT_METADATA_STORE)
    const ownerRequest = owners.get(OWNER_KEY)
    ownerRequest.onsuccess = () => {
      started = true
      const owner = ownerRequest.result as LeaseRow | undefined
      const selfRequest = selfId === undefined ? undefined : clients.get(selfId)
      const holderRequest = owner?.ownerId
        ? clients.get(owner.ownerId)
        : undefined
      const countRequest = transaction.objectStore(MUTATIONS_STORE).count()
      countRequest.onsuccess = () => {
        // Requests in one transaction complete in order: both gets landed.
        const self = selfRequest?.result as ClientRow | undefined
        const holder = holderRequest?.result as ClientRow | undefined
        const decision = decideLeaseClaim({
          owner,
          holder,
          self,
          pendingWrites: countRequest.result,
        })
        if ('reason' in decision) {
          result = { state: 'skipped', reason: decision.reason }
          return
        }
        const at = now()
        // The row the SDK's first election should have written, then the
        // lease in this tab's name — `acquireOrExtendPrimaryLease`'s shape.
        clients.put({ ...self, inForeground: true, updateTimeMs: at })
        owners.put(
          {
            ownerId: self!.clientId,
            allowTabSynchronization: true,
            leaseTimestampMs: at,
          } satisfies LeaseRow,
          OWNER_KEY,
        )
        result = {
          state: 'claimed',
          fromOwnerId: owner!.ownerId,
          leaseAgeMs: at - owner!.leaseTimestampMs,
        }
      }
    }
  })
}

const browserIndexedDb = (): IDBFactory | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.indexedDB
  } catch {
    return undefined
  }
}

const browserLocalStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Runs the handoff for a Firestore that `initializeFirestore` has just
 * configured with the durable multi-tab cache under `prefix`
 * (`firestorePersistencePrefix`). Call it in the same task as
 * `initializeFirestore`, before any read: its first step is the synchronous
 * snapshot of the clients that are not this tab. Fire and forget: it never
 * rejects, and every failure leaves the SDK's own election in charge.
 */
export function startFirestoreTabHandoff(
  firestore: Firestore,
  prefix: string,
): Promise<TabHandoffOutcome> {
  const factory = browserIndexedDb()
  const storage = browserLocalStorage()
  const databaseName = `${prefix}main`
  return runTabHandoff({
    isVisible: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible',
    isOnline: () =>
      typeof navigator === 'undefined' || navigator.onLine !== false,
    readClientIds: () => readSharedClientIds(storage, prefix),
    startClient: () => enableNetwork(firestore),
    claim: (selfId) => claimPrimaryLease(factory, databaseName, selfId),
    cycleNetwork: async () => {
      await disableNetwork(firestore)
      await enableNetwork(firestore)
    },
  }).then((outcome) => {
    if (outcome.result === 'claimed') {
      console.debug(
        '[firestore] This visible tab took the primary lease from a background tab (AGL-3660).',
        outcome,
      )
    }
    return outcome
  })
}
