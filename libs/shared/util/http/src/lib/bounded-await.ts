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
 * A server render never waits on outside I/O past a deadline (AGL-3565).
 *
 * ## Why an abort signal is not a deadline
 *
 * A request's `AbortSignal` bounds the REQUEST, and only when whatever is
 * answering honors it. Next's patched `fetch` on Vercel handed back a promise
 * that never settled — with `AbortSignal.timeout(2500)` on it, on cold
 * instances as well as warm ones — and the site layout awaited it. Every
 * uncached page render on the tenant then sat until the platform's 60 s limit.
 *
 * So the bound here is a timer the awaiting code owns: the work races a
 * `setTimeout`, and the timer wins whatever the work does or fails to do. The
 * signal handed to the work is still aborted at the deadline, so a request
 * that CAN be canceled is; but nothing depends on that happening.
 *
 * ## Why a settled-value cache sits beside it
 *
 * The same incident's second half: the module cached the in-flight PROMISE
 * for a day, so every later render on the instance awaited the one that never
 * settled — each with its own fresh deadline in front of nothing. A process
 * cache that outlives a request holds what a request LEARNED, never the work
 * still being done. {@link createSettledValueCache} refuses a thenable.
 */

/** What a bounded await is handed: the work, or a function that starts it. */
export type BoundedWork<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>)

/** The structured line a deadline writes when it wins. */
export interface BoundedAwaitTimeout {
  event: 'bounded-await-timeout'
  /** Names the await, `area.what` — the line is searched for by it. */
  label: string
  /** The deadline that passed. */
  ms: number
  /** Deadlines of this label that passed since the last line, unwritten. */
  suppressed: number
}

/**
 * One line per label per window. A dependency that is down misses its
 * deadline on every render that asks it; a line per render would bury the
 * logs in the one fact, so the rest are counted onto the next line.
 */
const WARN_WINDOW_MS = 60_000
const lastWarned = new Map<string, { atMs: number; suppressed: number }>()

function warnTimeout(label: string, ms: number): void {
  const nowMs = Date.now()
  const held = lastWarned.get(label)
  if (held && nowMs - held.atMs < WARN_WINDOW_MS) {
    held.suppressed += 1
    return
  }
  const line: BoundedAwaitTimeout = {
    event: 'bounded-await-timeout',
    label,
    ms,
    suppressed: held?.suppressed ?? 0,
  }
  lastWarned.set(label, { atMs: nowMs, suppressed: 0 })
  console.warn('[bounded-await] deadline passed; using the fallback', line)
}

/** Test seam: forget which labels have warned. */
export function resetBoundedAwaitWarningsForTests(): void {
  lastWarned.clear()
}

/**
 * `work`'s answer, or `fallback` once `ms` has passed without one.
 *
 * - The deadline is a real timer, cleared as soon as either side settles, so
 *   a fast answer leaves nothing scheduled behind it.
 * - Given a function, the work is started with an `AbortSignal` that aborts
 *   at the deadline — pass it to `fetch` so the request is canceled too.
 * - A rejection before the deadline is the caller's, unchanged: this bounds
 *   time, it does not swallow errors. A rejection after it is ignored.
 * - The deadline winning writes a `console.warn` carrying a
 *   {@link BoundedAwaitTimeout}, so a stalled dependency is visible in the
 *   logs rather than only as pages that are a little plainer — at most one
 *   per label a minute, the rest counted onto the next.
 *
 * @example
 * ```ts
 * const faces = await boundedAwait(
 *   (signal) => fetch(url, { signal }).then(parse).catch(() => null),
 *   2_500,
 *   null,
 *   'self-hosted-fonts.stylesheet',
 * )
 * ```
 */
export function boundedAwait<T, F>(
  work: BoundedWork<T>,
  ms: number,
  fallback: F,
  label: string,
): Promise<T | F> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let started: Promise<T>
  try {
    started = typeof work === 'function' ? work(controller.signal) : work
  } catch (error) {
    return Promise.reject(error)
  }
  const deadline = new Promise<F>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`${label} passed its ${ms} ms deadline`))
      warnTimeout(label, ms)
      resolve(fallback)
    }, ms)
  })
  return Promise.race([started, deadline]).finally(() => clearTimeout(timer))
}

/** A process cache whose entries are answers, never work in progress. */
export interface SettledValueCache<K, V> {
  /** The held answer while it is fresh, as `{ value }`, else undefined. */
  lookup(key: K, nowMs?: number): { value: V } | undefined
  /** Hold `value` for `ttlMs`. A promise or other thenable is refused. */
  set(key: K, value: V, ttlMs: number, nowMs?: number): void
  /**
   * The held answer, or `load`'s once it settles — and only then is it held,
   * for `ttlFor(value)`. Concurrent misses each run `load`; none of them
   * waits on another's work, which is the point.
   */
  readThrough(
    key: K,
    load: () => Promise<V>,
    ttlFor: (value: V) => number,
  ): Promise<V>
  delete(key: K): void
  clear(): void
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * A process-lifetime cache for values a render learned — see the module
 * note for why it will not hold a promise.
 */
export function createSettledValueCache<K, V>(): SettledValueCache<K, V> {
  const entries = new Map<K, { value: V; expires: number }>()
  const cache: SettledValueCache<K, V> = {
    lookup(key, nowMs = Date.now()) {
      const held = entries.get(key)
      if (!held) return undefined
      if (held.expires <= nowMs) {
        entries.delete(key)
        return undefined
      }
      return { value: held.value }
    },
    set(key, value, ttlMs, nowMs = Date.now()) {
      if (isThenable(value)) {
        throw new TypeError(
          'A settled-value cache holds answers, not work in progress: await it first (AGL-3565)',
        )
      }
      entries.set(key, { value, expires: nowMs + ttlMs })
    },
    async readThrough(key, load, ttlFor) {
      const held = cache.lookup(key)
      if (held) return held.value
      const value = await load()
      cache.set(key, value, ttlFor(value))
      return value
    },
    delete(key) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
  }
  return cache
}
