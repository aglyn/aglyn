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
'use client'

import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { type DocumentData, getDocs, type Query } from 'firebase/firestore'
import { type DependencyList, useEffect, useMemo, useRef, useState } from 'react'

export type AggregateReadStatus = 'loading' | 'success' | 'error'

/**
 * A server aggregate as a card renders it: the value once it has arrived,
 * and `null` until then or when the server refused.
 *
 * `null` and not 0 for the same reason `Figure` draws a dash for it — "the
 * count has not arrived" and "the count is zero" are different facts and a
 * tile that showed 0 for the first would be read as the second.
 */
export interface AggregateRead<T> {
  value: T | null
  status: AggregateReadStatus
}

export interface AggregateReadOptions {
  /**
   * Remember the answer under this key for {@link AGGREGATE_READ_TTL_MS},
   * so the same question asked again — the section reopened, a card
   * remounted — is answered from memory rather than from the server. Omit
   * it and every change of `deps` reads.
   */
  cacheKey?: string
  ttlMs?: number
}

/**
 * How long a report answer is trusted (AGL-2614).
 *
 * A report is a snapshot, not a listener: nothing on the page moves while
 * it is open, and the reader who closes it and opens it again a moment
 * later is asking the same question. Sixty seconds is long enough to cover
 * that round trip and short enough that a deal closed over lunch is on the
 * page after it. The Refresh control is the way to ask sooner.
 */
export const AGGREGATE_READ_TTL_MS = 60_000

interface CacheEntry {
  value: unknown
  expiresAt: number
}

/**
 * The answers, for the life of the page load. Module state rather than
 * React state because the point is to outlive the card that asked: the
 * section unmounts when the reader leaves it, and everything a component
 * held goes with it.
 */
const cache = new Map<string, CacheEntry>()

/** A fresh cached answer under `key`, or undefined. Expired entries are dropped on the way. */
function readCache(key: string, nowMs: number): CacheEntry | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= nowMs) {
    cache.delete(key)
    return undefined
  }
  return entry
}

/**
 * Forgets every answer whose key starts with `prefix` — the section's
 * Refresh, which names its own scope so a refresh of one org's reports
 * does not throw away another's.
 */
export function invalidateAggregateReads(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/** Test seam: forget everything. */
export function resetAggregateReadCache(): void {
  cache.clear()
}

/**
 * One server-side read, run once per change of `deps` and never per render,
 * and — when keyed — once per {@link AGGREGATE_READ_TTL_MS} rather than once
 * per mount.
 *
 * The CRM reports are built from `getCountFromServer`,
 * `getAggregateFromServer` and bounded `getDocs` windows — a count is a
 * count, not the length of a capped listener — and each of those is a
 * promise rather than a subscription, so it needs the effect-with-an-active-
 * flag the contacts list already writes for its head-count. This is that
 * effect, once, so that five cards do not carry five copies of it and one of
 * them forgets the flag and sets state on an unmounted card.
 *
 * ## Why the answers are remembered
 *
 * The section reads up to 3,500 documents to draw its windows — the newest
 * thousand contacts, a thousand open deals, a thousand open tasks, five
 * hundred closed deals of each outcome — and it read them again every time
 * the reader arrived, including the arrival ten seconds after they left to
 * check a deal the report named. A report is a snapshot; the second arrival
 * is the same question. A keyed read is answered from memory while its
 * answer is fresh, and the key names the scope and the period so a different
 * org, a different site group or a different period is a different question.
 * Refusals are never remembered: a dash the server drew once should not be
 * drawn from memory for a minute after the rules change.
 *
 * `read` returning `null` means "not yet" — the org scope has not resolved,
 * the tokens are not known — and leaves the read pending rather than
 * counting against nothing. The latest `read` is always the one invoked, via
 * a ref, so the caller can close over fresh props without listing every one
 * of them in `deps`; what `deps` names is WHEN to read again.
 */
export function useAggregateRead<T>(
  read: () => Promise<T> | null,
  deps: DependencyList,
  options: AggregateReadOptions = {},
): AggregateRead<T> {
  const { cacheKey, ttlMs = AGGREGATE_READ_TTL_MS } = options
  const [state, setState] = useState<AggregateRead<T>>({
    value: null,
    status: 'loading',
  })
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    const remembered = cacheKey ? readCache(cacheKey, Date.now()) : undefined
    if (remembered) {
      setState({ value: remembered.value as T, status: 'success' })
      return undefined
    }
    const pending = readRef.current()
    setState({ value: null, status: 'loading' })
    if (!pending) return undefined
    let active = true
    pending
      .then((value) => {
        if (cacheKey) cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs })
        if (active) setState({ value, status: 'success' })
      })
      .catch(() => {
        // Denied or failed: the tile draws its dash. Nothing here substitutes
        // a zero, because a zero is a measurement and this is the absence of
        // one.
        if (active) setState({ value: null, status: 'error' })
      })
    return () => {
      active = false
    }
    // `deps` is the caller's dependency list, forwarded the way
    // `useFirestoreCollection` forwards its own; the key changes with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, cacheKey])

  return state
}

/** A bounded window of documents as a card draws it, and whether the bound bit. */
export interface WindowRead<T> {
  /** At most `ceiling` rows — the probe row is never among them. */
  rows: T[]
  /** The collection holds MORE than the ceiling. A fact from the probe, not a guess. */
  truncated: boolean
  status: AggregateReadStatus
}

/**
 * A bounded window, read once and remembered — the report's replacement
 * for a live listener over the same query.
 *
 * The cards used to hold their windows open as `onSnapshot` listeners,
 * which is the right shape for a list somebody edits and the wrong one for
 * a report: the listener re-delivered the whole window on every mount, and
 * a snapshot that updates under the reader while they compare it to the
 * tile above it is a page that contradicts itself. `getDocs` answers once,
 * `ceilingedWindow` drops the probe row the caller over-fetched by, and the
 * answer is remembered under `cacheKey` like every other report read.
 *
 * `build` returning `null` means "not yet", the way `read` does above.
 */
export function useWindowRead<T extends DocumentData>(
  build: () => Query | null,
  ceiling: number,
  deps: DependencyList,
  options: AggregateReadOptions = {},
): WindowRead<T> {
  const buildRef = useRef(build)
  buildRef.current = build
  const read = useAggregateRead<{ rows: T[]; truncated: boolean }>(
    () => {
      const query = buildRef.current()
      return query
        ? getDocs(query).then((snapshot) =>
            ceilingedWindow(
              snapshot.docs.map(
                (document) => ({ ...document.data(), $id: document.id }) as unknown as T,
              ),
              ceiling,
            ),
          )
        : null
    },
    deps,
    options,
  )
  return useMemo(
    () => ({
      rows: read.value?.rows ?? [],
      truncated: read.value?.truncated ?? false,
      status: read.status,
    }),
    [read],
  )
}
