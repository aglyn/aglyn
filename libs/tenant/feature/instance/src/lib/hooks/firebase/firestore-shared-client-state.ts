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
 * The multi-tab records the Firestore SDK strands in `localStorage`, and the
 * prune that bounds them (AGL-2845).
 *
 * ## What leaks
 *
 * `persistentMultipleTabManager` shares one IndexedDB cache between tabs and
 * coordinates them through `localStorage` (`WebStorageSharedClientState`).
 * Three of its record families grow without bound, all keyed under the
 * persistence prefix `firestore/<appName>/<projectId>/`:
 *
 * | record | holds |
 * | -- | -- |
 * | `firestore_clients_<prefix>_<clientId>` | the target ids one tab listens to, and when that set last changed |
 * | `firestore_targets_<prefix>_<targetId>` | a target's `current` / `not-current` / `rejected` state, written by the primary tab |
 * | `firestore_zombie_<prefix>_<clientId>` | when a tab closed, so no other tab waits on its lease |
 *
 * Measured against `@firebase/firestore` 4.17.1, and unchanged on the SDK's
 * main branch, a target record is removed in exactly one place:
 * `clearQueryState`, which runs only when the PRIMARY tab unlistens a target no
 * other tab holds. Every other way a target ends leaves its record behind:
 *
 * - a secondary tab unlistens — the primary releases the target and never
 *   clears its state;
 * - the backend rejects the listen — `rejected` is written and nothing removes
 *   it, so a missing composite index or a `permission-denied` stays on disk;
 * - any tab closes or reloads — `pagehide` removes that tab's own client record
 *   and none of its targets.
 *
 * A client record is stranded the same way when a tab ends without `pagehide`
 * (a crash, a discarded tab, a browser quit), and a zombie marker survives
 * whenever its tab's shutdown does not finish and no primary later finds that
 * tab's heartbeat row. Nothing sweeps any of the three. A target id is reused
 * for an identical query, so the pile grows with the number of distinct queries
 * a browser has ever listened to: one production console profile held 2,531
 * target records going back five weeks, against 3 live tabs.
 *
 * ## Why it cannot be left alone
 *
 * `localStorage` holds about 5 MB per origin. Once it is full, the next
 * `setItem` inside the SDK throws `QuotaExceededError` on the SDK's async
 * queue. That marks the queue failed, and every later Firestore operation in
 * the tab dies on `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)` — the
 * whole Firestore client, not only tab sync. Upstream treats a full
 * `localStorage` as expected under multi-tab (firebase-js-sdk#8305) and closed
 * the leak report without a fix (#9209), so no SDK upgrade removes this.
 *
 * ## What is safe to delete
 *
 * The constraint is absolute: a record a live tab depends on is never removed.
 *
 * - **A target record no surviving client record lists is dead data.** The SDK
 *   reads one only when some tab lists that target as active
 *   (`addLocalQueryTarget` asks `isActiveQueryTarget` first), and it ignores a
 *   storage event reporting one deleted. A record any readable client lists is
 *   kept, whether or not that client is live: without it, the next tab to join
 *   the target would start it `not-current`.
 * - **A client record is deleted only after the SDK itself has given up on that
 *   tab.** Its heartbeat row must be gone from IndexedDB's `clientMetadata`
 *   store — a running tab rewrites that row every 4 seconds, and the primary
 *   deletes rows 30 minutes stale — AND the record must not have changed for
 *   {@link STALE_SHARED_CLIENT_STATE_MS}. Deleting a live tab's client record
 *   would make every other tab drop its targets, and the primary would stop
 *   watching them. The heartbeat is what separates a live tab left idle (fresh
 *   row, old record) from a dead one; the age covers a tab frozen rather than
 *   closed, and a tab that started between the heartbeat read and the scan.
 * - **When the heartbeat cannot be read** — no `indexedDB.databases()`, no
 *   database yet, a schema without that store — no client record is deleted,
 *   and every readable client record keeps pinning its targets.
 * - **A client record that does not parse** pins nothing and is never deleted,
 *   matching the SDK, which ignores it the same way.
 * - **A zombie marker older than {@link STALE_SHARED_CLIENT_STATE_MS}** is
 *   deleted. The SDK consults one only while the closed tab's heartbeat could
 *   still count as fresh, and a day later it cannot.
 *
 * Mutation, online-state, sequence-number and bundle records are never touched,
 * and neither is anything under another app's or another database's prefix.
 *
 * ## When it runs
 *
 * Once per page load, after the provider has initialized the durable cache
 * (`pruneSharedClientStateFor` in `firestore-cache.ts`). Each load clears what
 * earlier sessions stranded, which is what bounds the growth; a one-off cleanup
 * would not, because the SDK strands more on every close.
 */

/**
 * How long a client record or zombie marker must sit unchanged before it can
 * be treated as dead. A day, against the SDK's own 30-minute inactivity
 * horizon, because deleting a live tab's record is the one outcome this must
 * never produce.
 */
export const STALE_SHARED_CLIENT_STATE_MS = 24 * 60 * 60 * 1000

/** The IndexedDB store holding one heartbeat row per running tab, keyed by client id. */
const CLIENT_METADATA_STORE = 'clientMetadata'

/**
 * `firestore/<appName>/<projectId>/` — the SDK's `indexedDbStoragePrefix` for
 * the default database, the only one the console opens. Every record family
 * above hangs off it, and so does the IndexedDB database, `<prefix>main`.
 */
export function firestorePersistencePrefix(appName: string, projectId: string): string {
  return `firestore/${appName}/${projectId}/`
}

export interface SharedClientStateTally {
  kept: number
  removed: number
}

export interface SharedClientStatePrunePlan {
  /** Every record to delete. */
  remove: string[]
  targets: SharedClientStateTally
  clients: SharedClientStateTally
  zombies: SharedClientStateTally
  /** Whether the heartbeat was readable — without it no client record is eligible. */
  heartbeat: boolean
}

interface ClientRecord {
  activeTargetIds: readonly number[]
  updateTimeMs: number | undefined
}

/** The SDK's `RemoteClientState` parse: whatever it would reject is `undefined`. */
function parseClientRecord(value: string | null): ClientRecord | undefined {
  if (value === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { activeTargetIds, updateTimeMs } = parsed as Record<string, unknown>
  if (!Array.isArray(activeTargetIds) || !activeTargetIds.every(Number.isSafeInteger)) {
    return undefined
  }
  return {
    activeTargetIds,
    updateTimeMs:
      typeof updateTimeMs === 'number' && Number.isFinite(updateTimeMs)
        ? updateTimeMs
        : undefined,
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Decides what to delete. Reads `storage` and changes nothing.
 *
 * `heartbeatClientIds` is the set of client ids that still have a row in the
 * SDK's `clientMetadata` store, or `undefined` when it could not be read — in
 * which case no client record is eligible.
 */
export function planSharedClientStatePrune(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  prefix: string,
  heartbeatClientIds: ReadonlySet<string> | undefined,
  now: number,
): SharedClientStatePrunePlan {
  const escaped = escapeRegExp(prefix)
  // The SDK's own key shapes: a client id never contains `_`, a target id is digits.
  const clientKey = new RegExp(`^firestore_clients_${escaped}_([^_]*)$`)
  const targetKey = new RegExp(`^firestore_targets_${escaped}_(\\d+)$`)
  const zombieKey = new RegExp(`^firestore_zombie_${escaped}_([^_]*)$`)
  const isStale = (at: number | undefined) =>
    at !== undefined && now - at >= STALE_SHARED_CLIENT_STATE_MS

  const plan: SharedClientStatePrunePlan = {
    remove: [],
    targets: { kept: 0, removed: 0 },
    clients: { kept: 0, removed: 0 },
    zombies: { kept: 0, removed: 0 },
    heartbeat: heartbeatClientIds !== undefined,
  }
  const targets: Array<{ key: string; targetId: number }> = []
  const pinned = new Set<number>()

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key === null) continue

    const target = targetKey.exec(key)
    if (target) {
      targets.push({ key, targetId: Number(target[1]) })
      continue
    }

    const client = clientKey.exec(key)
    if (client) {
      const record = parseClientRecord(storage.getItem(key))
      const dead =
        record !== undefined &&
        heartbeatClientIds !== undefined &&
        !heartbeatClientIds.has(client[1]) &&
        isStale(record.updateTimeMs)
      if (dead) {
        plan.remove.push(key)
        plan.clients.removed++
      } else {
        plan.clients.kept++
        record?.activeTargetIds.forEach((targetId) => pinned.add(targetId))
      }
      continue
    }

    if (zombieKey.test(key)) {
      const value = storage.getItem(key)
      if (value !== null && /^\d+$/.test(value) && isStale(Number(value))) {
        plan.remove.push(key)
        plan.zombies.removed++
      } else {
        plan.zombies.kept++
      }
    }
  }

  // Judged last, once every surviving client record has pinned its targets.
  for (const { key, targetId } of targets) {
    if (pinned.has(targetId)) {
      plan.targets.kept++
    } else {
      plan.remove.push(key)
      plan.targets.removed++
    }
  }
  return plan
}

/**
 * The client ids that still have a heartbeat row in the SDK's `clientMetadata`
 * store, or `undefined` when that cannot be established.
 *
 * Opens only a database that already exists, at whatever version it already
 * has: `open(name)` on a missing database would CREATE it at version 1, and the
 * SDK would then try to migrate a schema that was never written. The connection
 * serves one read-only request and is closed — at once, too, on
 * `versionchange`, so it can never hold up the SDK's own upgrade.
 */
export async function readHeartbeatClientIds(
  factory: IDBFactory | undefined,
  databaseName: string,
  timeoutMs = 5_000,
): Promise<ReadonlySet<string> | undefined> {
  if (!factory || typeof factory.databases !== 'function') return undefined
  try {
    const databases = await factory.databases()
    if (!databases.some((database) => database.name === databaseName)) return undefined
  } catch {
    return undefined
  }

  return new Promise((resolve) => {
    let settled = false
    const settle = (value: ReadonlySet<string> | undefined, database?: IDBDatabase) => {
      database?.close()
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => settle(undefined), timeoutMs)

    let request: IDBOpenDBRequest
    try {
      request = factory.open(databaseName)
    } catch {
      settle(undefined)
      return
    }
    // The database was deleted between `databases()` and `open()`: abort the
    // creation rather than leave the SDK an empty version-1 database.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => settle(undefined)
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (settled || !database.objectStoreNames.contains(CLIENT_METADATA_STORE)) {
        settle(undefined, database)
        return
      }
      try {
        const keys = database
          .transaction(CLIENT_METADATA_STORE, 'readonly')
          .objectStore(CLIENT_METADATA_STORE)
          .getAllKeys()
        keys.onsuccess = () =>
          settle(
            new Set(keys.result.filter((key): key is string => typeof key === 'string')),
            database,
          )
        keys.onerror = () => settle(undefined, database)
      } catch {
        settle(undefined, database)
      }
    }
  })
}

export interface PruneSharedClientStateOptions {
  storage: Storage
  prefix: string
  heartbeatClientIds: () => Promise<ReadonlySet<string> | undefined>
  now?: () => number
}

/**
 * Reads the heartbeat, then plans and deletes in one synchronous pass, so
 * nothing else in this tab can write a record between the scan and the
 * deletes. The heartbeat is read BEFORE the scan: a tab that starts in between
 * shows up with a brand-new record and no heartbeat row, which the age rule
 * keeps.
 *
 * Never rejects. Resolves `undefined` when storage could not be read.
 */
export async function pruneSharedClientState({
  storage,
  prefix,
  heartbeatClientIds,
  now = Date.now,
}: PruneSharedClientStateOptions): Promise<SharedClientStatePrunePlan | undefined> {
  let heartbeat: ReadonlySet<string> | undefined
  try {
    heartbeat = await heartbeatClientIds()
  } catch {
    heartbeat = undefined
  }
  try {
    const plan = planSharedClientStatePrune(storage, prefix, heartbeat, now())
    for (const key of plan.remove) storage.removeItem(key)
    return plan
  } catch {
    return undefined
  }
}

/**
 * {@link pruneSharedClientState} against this page's own `localStorage` and
 * IndexedDB. Resolves `undefined` off-browser, without an app name or project
 * id, or where site data is blocked (reading `window.localStorage` throws
 * there).
 */
export async function pruneBrowserSharedClientState(
  appName: string | undefined,
  projectId: string | undefined,
): Promise<SharedClientStatePrunePlan | undefined> {
  if (!appName || !projectId || typeof window === 'undefined') return undefined
  let storage: Storage | undefined
  let factory: IDBFactory | undefined
  try {
    storage = window.localStorage
    factory = window.indexedDB
  } catch {
    return undefined
  }
  if (!storage) return undefined
  const prefix = firestorePersistencePrefix(appName, projectId)
  return pruneSharedClientState({
    storage,
    prefix,
    heartbeatClientIds: () => readHeartbeatClientIds(factory, `${prefix}main`),
  })
}
