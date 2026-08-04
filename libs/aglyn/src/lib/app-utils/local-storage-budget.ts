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
 * `localStorage` is ~5 MB per origin and a besigner node map is not small —
 * a 222-node screen is a substantial fraction of that on its own. Every
 * writer of a node-map-sized value therefore has to answer "and what happens
 * when it is full?", and until AGL-1256 none of them did: `writePreviewState`
 * called `setItem` bare, so a full origin threw a `QuotaExceededError` up
 * through a click handler.
 *
 * The answer here is: drop the least recently written value belonging to the
 * *same feature* and try again. Scoping eviction to explicit prefixes is the
 * whole point — a snapshot store must never be able to evict somebody else's
 * keys (auth markers, the selected org, notification preferences) to make
 * room for itself.
 */

/** How the caller decides which keys may be sacrificed, and in what order. */
export interface LocalStorageBudgetOptions {
  key: string
  value: string
  /**
   * Only keys starting with one of these may be evicted, and the order is
   * the sacrifice order: everything under the first prefix goes (oldest
   * first) before anything under the second is touched. That is what lets a
   * draft write reclaim regenerable preview snapshots without ever costing
   * somebody another document's unsaved work. The key being written is never
   * evicted, even when it matches.
   */
  evictPrefixes: string[]
  /** Defaults to `window.localStorage`; injectable for tests. */
  storage?: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
  >
}

export interface LocalStorageBudgetResult {
  /** False when the value could not be stored even after evicting. */
  ok: boolean
  /** Keys dropped to make room, oldest first. */
  evicted: string[]
}

/**
 * Browsers disagree about how a full quota surfaces: a `QuotaExceededError`
 * by name, Firefox's `NS_ERROR_DOM_QUOTA_REACHED`, or the legacy numeric
 * codes. Anything else (a `SecurityError` from a blocked origin, say) is not
 * something eviction can fix and is reported rather than retried.
 */
function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, code } = error as { name?: string; code?: number }
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  )
}

/**
 * The sort key for eviction. Values written by this module's callers are
 * JSON objects carrying `updatedAt`; anything unparseable or missing it
 * sorts as oldest, because a value we cannot date is a value we cannot
 * justify keeping ahead of one we can.
 */
function writtenAt(raw: string | null): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown }
    return typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0
  } catch {
    return 0
  }
}

function resolveStorage(
  storage: LocalStorageBudgetOptions['storage'],
): LocalStorageBudgetOptions['storage'] | null {
  if (storage) return storage
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Storage access can throw outright when cookies are blocked.
    return null
  }
}

/**
 * Writes `value` at `key`, evicting oldest-first within `evictPrefixes` if
 * the origin is full.
 *
 * Never throws: a caller storing a crash-recovery snapshot must not be able
 * to break the edit that triggered it. A failed write leaves any existing
 * value at `key` in place — an older snapshot that is honest about its own
 * age beats no snapshot at all.
 */
export function writeLocalStorageWithBudget(
  options: LocalStorageBudgetOptions,
): LocalStorageBudgetResult {
  const { key, value, evictPrefixes } = options
  const storage = resolveStorage(options.storage)
  const evicted: string[] = []
  if (!storage) return { ok: false, evicted }

  const attempt = (): boolean | 'retry' => {
    try {
      storage.setItem(key, value)
      return true
    } catch (error) {
      return isQuotaExceeded(error) ? 'retry' : false
    }
  }

  let outcome = attempt()
  if (outcome !== 'retry') return { ok: outcome === true, evicted }

  // Snapshot the candidates once: `key()` indices shift as we remove, and
  // re-scanning per eviction is O(n²) on the one path already under stress.
  const candidates: Array<{ key: string; rank: number; writtenAt: number }> =
    []
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index)
    if (!candidate || candidate === key) continue
    const rank = evictPrefixes.findIndex((prefix) =>
      candidate.startsWith(prefix),
    )
    if (rank < 0) continue
    candidates.push({
      key: candidate,
      rank,
      writtenAt: writtenAt(storage.getItem(candidate)),
    })
  }
  candidates.sort((a, b) => a.rank - b.rank || a.writtenAt - b.writtenAt)

  for (const candidate of candidates) {
    try {
      storage.removeItem(candidate.key)
    } catch {
      continue
    }
    evicted.push(candidate.key)
    outcome = attempt()
    if (outcome !== 'retry') return { ok: outcome === true, evicted }
  }

  return { ok: false, evicted }
}

/**
 * Removes every key under `prefix` whose `updatedAt` is older than `maxAge`.
 *
 * Snapshot stores are caches, and a cache with no expiry silently becomes an
 * archive — see the note in `besigner-draft-store` about why an unbounded
 * pile of dated snapshots is the wrong shape for this feature specifically.
 */
export function pruneLocalStorageByAge(options: {
  prefix: string
  maxAgeMs: number
  now: number
  storage?: LocalStorageBudgetOptions['storage']
}): string[] {
  const storage = resolveStorage(options.storage)
  const pruned: string[] = []
  if (!storage) return pruned

  const stale: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index)
    if (!candidate?.startsWith(options.prefix)) continue
    const age = options.now - writtenAt(storage.getItem(candidate))
    if (age > options.maxAgeMs) stale.push(candidate)
  }
  for (const candidate of stale) {
    try {
      storage.removeItem(candidate)
      pruned.push(candidate)
    } catch {
      // A storage that refuses removal will refuse the write too; the
      // caller's write path reports that.
    }
  }
  return pruned
}
