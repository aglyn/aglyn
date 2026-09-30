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

import { type Firestore } from 'firebase/firestore'

/**
 * A MULTI-TAB CACHE THAT ANOTHER TAB HAS LOCKED, AND THE WAY OUT (AGL-3428).
 *
 * ## The wedge the network cycle cannot clear
 *
 * `firestore-stall-recovery.ts` recovers a lapsed primary lease by cycling the
 * network, which runs the lease election at once (AGL-3373). That needs the
 * election's IndexedDB transaction to run. Measured against
 * `@firebase/firestore` 4.17.2: `IndexedDbPersistence.runTransaction` opens
 * EVERY transaction over EVERY object store (`getObjectStores(schemaVersion)`),
 * so one tab that stops partway through a readwrite transaction — frozen or
 * discarded by the browser while it runs — holds every store for every tab on
 * the origin. Behind it, in every other tab:
 *
 * - the lease election waits, so the lease row is never renewed by anyone;
 * - cache reads wait, so pages sit on their spinners;
 * - the mutation-queue write waits, so a save never reaches the network;
 * - a freshly opened tab's persistence `start()` waits, so a new tab hangs too;
 * - `disableNetwork`, `enableNetwork` and `terminate` are queued on the same
 *   AsyncQueue behind the stuck operation, so none of them ever runs.
 *
 * On 2026-09-30 production (beta.218) did exactly this three times in two
 * hours: every console tab stopped, and the `owner` row named a background
 * tab that had stopped renewing it.
 *
 * ## How it is told apart from a slow read
 *
 * Only after the network cycle, and only from a visible tab on a browser that
 * reports a network. Such a tab wins a lapsed lease within one 4-second
 * election tick, and the cycle has just forced one. So, after a short settle,
 * the tab reads the `owner` row itself:
 *
 * - **the read cannot complete in time** — the store is locked by another
 *   tab's open transaction; or
 * - **the lease is older than {@link STALE_PRIMARY_LEASE_MS}** — no tab,
 *   including this one, is completing an election.
 *
 * Either is the wedge. A fresh lease — this tab's or another's — is a healthy
 * cache and a merely slow server, and nothing more happens.
 *
 * ## The way out
 *
 * The tab records a {@link MemoryCacheFallback} in `sessionStorage` and
 * reloads. `firestoreCacheClassFor` reads it at startup and gives this tab the
 * memory cache, which shares nothing with other tabs, so the locked database
 * cannot reach it. `sessionStorage` is per tab: other tabs keep the durable
 * cache, and the fallback leaves when this tab closes or after
 * {@link MEMORY_CACHE_FALLBACK_TTL_MS}.
 *
 * A reload, not an in-place swap, because nothing in place can work: the
 * wedged instance's `terminate()` is queued behind the stuck operation, a
 * second instance for the same app throws until the first is gone, and
 * hundreds of readers hold the instance from context and from closures.
 * Nothing that could be saved is lost — the wedge had already stopped every
 * write in the tab from leaving it.
 */

/** `sessionStorage` key of this tab's memory-cache fallback. */
export const MEMORY_CACHE_FALLBACK_KEY = 'aglyn:firestore-memory-cache-fallback'

/**
 * How long a tab keeps the memory cache after falling back. The SDK's own
 * inactivity horizon (`MAX_CLIENT_AGE_MS`), after which a tab that is still
 * stuck no longer counts as a client; past it, a reload tries the durable
 * cache again, and falls back again if it has to.
 */
export const MEMORY_CACHE_FALLBACK_TTL_MS = 30 * 60 * 1000

/**
 * A lease older than this, read from a visible online tab right after a
 * forced election, means no election is completing. The SDK treats a lease as
 * lapsed at 5 s (`MAX_PRIMARY_ELIGIBLE_AGE_MS`) and runs the election every
 * 4 s; this is three times the first, so an election that is merely late is
 * never mistaken for one that cannot run.
 */
export const STALE_PRIMARY_LEASE_MS = 15_000

/**
 * How long the lease read may take before the store is judged locked. The
 * SDK's own transactions take milliseconds.
 */
export const LEASE_PROBE_TIMEOUT_MS = 4_000

/**
 * How long after the network cycle the lease is read, so the election the
 * cycle queued has run.
 */
export const LEASE_SETTLE_MS = 3_000

/** The SDK's lease store and its single row's key (`DbPrimaryClientStore`, `DbPrimaryClientKey`). */
const OWNER_STORE = 'owner'
const OWNER_KEY = 'owner'

/** What reading the lease found. */
export type PrimaryLeaseProbe =
  /** The read did not complete in time: another tab's transaction holds the store. */
  | { state: 'locked' }
  /** The lease row: who holds it and how long ago it was renewed. */
  | { state: 'leased'; ownerId: string; ageMs: number }
  /** There is no lease row. */
  | { state: 'vacant' }
  /** The lease could not be read: no IndexedDB, no database, no store, an error. */
  | { state: 'unknown' }

/** Why a tab concluded the multi-tab cache is wedged. */
export type WedgeEvidence =
  | { reason: 'lease-locked' }
  | { reason: 'lease-stale'; ownerId: string; ageMs: number }

/** The fallback this tab recorded, and why. */
export type MemoryCacheFallback = WedgeEvidence & { at: number }

/**
 * Reads the SDK's `owner` row from `databaseName`.
 *
 * Opens only a database that already exists, at whatever version it has (the
 * same rule as `readHeartbeatClientIds`): `open(name)` on a missing database
 * would create it at version 1 under the SDK. The connection serves one
 * read-only request and is closed — also on `versionchange`, so it never
 * holds up the SDK's own upgrade, and also when the read lands after the
 * timeout.
 */
export async function probePrimaryLease(
  factory: IDBFactory | undefined,
  databaseName: string,
  {
    timeoutMs = LEASE_PROBE_TIMEOUT_MS,
    now = Date.now,
  }: { timeoutMs?: number; now?: () => number } = {},
): Promise<PrimaryLeaseProbe> {
  if (!factory || typeof factory.databases !== 'function') return { state: 'unknown' }
  try {
    const databases = await factory.databases()
    if (!databases.some((database) => database.name === databaseName)) {
      return { state: 'unknown' }
    }
  } catch {
    return { state: 'unknown' }
  }

  return new Promise((resolve) => {
    let settled = false
    let database: IDBDatabase | undefined
    const settle = (probe: PrimaryLeaseProbe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(probe)
    }
    const close = () => {
      try {
        database?.close()
      } catch {
        // Already closed.
      }
    }
    // Only a lock can hold a read-only request this long; the connection is
    // closed when the request finally lands.
    const timer = setTimeout(() => settle({ state: 'locked' }), timeoutMs)

    let request: IDBOpenDBRequest
    try {
      request = factory.open(databaseName)
    } catch {
      settle({ state: 'unknown' })
      return
    }
    // The database was deleted between `databases()` and `open()`: abort the
    // creation rather than leave the SDK an empty version-1 database.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => settle({ state: 'unknown' })
    request.onsuccess = () => {
      database = request.result
      database.onversionchange = close
      if (settled || !database.objectStoreNames.contains(OWNER_STORE)) {
        close()
        settle({ state: 'unknown' })
        return
      }
      try {
        const read = database
          .transaction(OWNER_STORE, 'readonly')
          .objectStore(OWNER_STORE)
          .get(OWNER_KEY)
        read.onsuccess = () => {
          close()
          const row = read.result as
            | { ownerId?: unknown; leaseTimestampMs?: unknown }
            | undefined
          if (
            !row ||
            typeof row.ownerId !== 'string' ||
            typeof row.leaseTimestampMs !== 'number'
          ) {
            settle({ state: 'vacant' })
            return
          }
          settle({
            state: 'leased',
            ownerId: row.ownerId,
            ageMs: now() - row.leaseTimestampMs,
          })
        }
        read.onerror = () => {
          close()
          settle({ state: 'unknown' })
        }
      } catch {
        close()
        settle({ state: 'unknown' })
      }
    }
  })
}

/**
 * Whether a lease read taken right after a forced election, from a visible
 * online tab, shows the wedge. Anything that could be a healthy cache —
 * a fresh lease, no lease row, an unreadable one — is not evidence.
 */
export function wedgeEvidenceFrom(
  probe: PrimaryLeaseProbe,
  staleMs = STALE_PRIMARY_LEASE_MS,
): WedgeEvidence | undefined {
  if (probe.state === 'locked') return { reason: 'lease-locked' }
  if (probe.state === 'leased' && probe.ageMs >= staleMs) {
    return { reason: 'lease-stale', ownerId: probe.ownerId, ageMs: probe.ageMs }
  }
  return undefined
}

/**
 * This tab's fallback, or `undefined` when there is none, it has expired, or
 * it does not parse.
 */
export function readMemoryCacheFallback(
  storage: Pick<Storage, 'getItem'> | undefined,
  now: number,
  ttlMs = MEMORY_CACHE_FALLBACK_TTL_MS,
): MemoryCacheFallback | undefined {
  let raw: string | null
  try {
    raw = storage?.getItem(MEMORY_CACHE_FALLBACK_KEY) ?? null
  } catch {
    return undefined
  }
  if (raw === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Partial<MemoryCacheFallback>
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return undefined
  if (now - record.at >= ttlMs || record.at > now) return undefined
  return record as MemoryCacheFallback
}

const browserSessionStorage = (): Storage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage
  } catch {
    // Site data blocked: reading `window.sessionStorage` throws.
    return undefined
  }
}

/** Whether this browser tab is running on its memory-cache fallback. */
export function memoryCacheFallbackActive(now = Date.now()): boolean {
  return readMemoryCacheFallback(browserSessionStorage(), now) !== undefined
}

export interface WedgeEscalationDeps {
  /** Reads the lease. */
  probe: () => Promise<PrimaryLeaseProbe>
  /** Moves this tab off the shared cache. */
  fallBack: (evidence: WedgeEvidence) => void
  /** Whether this tab is already on the fallback — it then never escalates. */
  isFallbackActive?: () => boolean
  isOnline?: () => boolean
  isVisible?: () => boolean
  /** Waits `ms`; the settle before the lease read. */
  wait?: (ms: number) => Promise<void>
  settleMs?: number
}

const browserOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false

const documentVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

/**
 * The step `createStallRecovery` runs after its network cycle for a
 * multi-tab client. Resolves `true` when it has moved the tab to the fallback.
 * Never rejects.
 */
export function createWedgeEscalation(
  deps: WedgeEscalationDeps,
): () => Promise<boolean> {
  const {
    probe,
    fallBack,
    isFallbackActive = () => memoryCacheFallbackActive(),
    isOnline = browserOnline,
    isVisible = documentVisible,
    wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    settleMs = LEASE_SETTLE_MS,
  } = deps
  return async () => {
    try {
      if (isFallbackActive()) return false
      await wait(settleMs)
      // Both guards again: the reader may have gone, or the network with it.
      if (!isOnline() || !isVisible()) return false
      const evidence = wedgeEvidenceFrom(await probe())
      if (!evidence) return false
      fallBack(evidence)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Records the fallback for this tab and reloads it onto the memory cache.
 * When the record cannot be written it does not reload: without it, the
 * reloaded tab would open the same locked database and hang again.
 */
export function fallBackToMemoryCache(
  evidence: WedgeEvidence,
  {
    storage = browserSessionStorage(),
    reload = () => window.location.reload(),
    now = Date.now,
  }: {
    storage?: Pick<Storage, 'setItem'>
    reload?: () => void
    now?: () => number
  } = {},
): void {
  if (!storage) return
  const record: MemoryCacheFallback = { ...evidence, at: now() }
  try {
    storage.setItem(MEMORY_CACHE_FALLBACK_KEY, JSON.stringify(record))
  } catch {
    return
  }
  console.warn(
    '[firestore] The multi-tab cache is locked by another tab; reloading this tab on the memory cache (AGL-3428).',
    record,
  )
  reload()
}

/** The IndexedDB database of each client running the durable multi-tab cache. */
const multiTabDatabases = new WeakMap<Firestore, string>()

/**
 * Registers `firestore` as running the durable multi-tab cache under
 * `databaseName` (`<persistence prefix>main`). Only a registered client ever
 * escalates past the network cycle.
 */
export function markMultiTabFirestore(firestore: Firestore, databaseName: string): void {
  if (firestore && typeof firestore === 'object') {
    multiTabDatabases.set(firestore, databaseName)
  }
}

/**
 * The browser escalation for `firestore`, or `undefined` when it does not run
 * the durable multi-tab cache (the emulator configuration, an ephemeral
 * origin, a tab already on the fallback).
 */
export function browserWedgeEscalationFor(
  firestore: Firestore,
): (() => Promise<boolean>) | undefined {
  const databaseName = multiTabDatabases.get(firestore)
  if (databaseName === undefined) return undefined
  return createWedgeEscalation({
    probe: () => {
      let factory: IDBFactory | undefined
      try {
        factory = typeof window === 'undefined' ? undefined : window.indexedDB
      } catch {
        factory = undefined
      }
      return probePrimaryLease(factory, databaseName)
    },
    fallBack: (evidence) => fallBackToMemoryCache(evidence),
  })
}
