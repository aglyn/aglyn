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

import { type DependencyList, useEffect, useRef, useState } from 'react'

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

/**
 * One server-side read, run once per change of `deps` and never per render.
 *
 * The CRM reports are built from `getCountFromServer` and
 * `getAggregateFromServer` — a count is a count, not the length of a capped
 * listener — and each of those is a promise rather than a subscription, so
 * it needs the effect-with-an-active-flag the contacts list already writes
 * for its head-count. This is that effect, once, so that five cards do not
 * carry five copies of it and one of them forgets the flag and sets state on
 * an unmounted card.
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
): AggregateRead<T> {
  const [state, setState] = useState<AggregateRead<T>>({
    value: null,
    status: 'loading',
  })
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    const pending = readRef.current()
    setState({ value: null, status: 'loading' })
    if (!pending) return
    let active = true
    pending
      .then((value) => {
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
    // `useFirestoreCollection` forwards its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
