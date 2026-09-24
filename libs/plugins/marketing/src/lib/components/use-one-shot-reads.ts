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

import {
  type DependencyList,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export type OneShotStatus = 'loading' | 'success' | 'error'

/** A read as a card renders it: the answer once it arrives, `null` until then. */
export interface OneShotRead<T> {
  value: T | null
  status: OneShotStatus
}

/**
 * One server read, run when `deps` change and never per render — and never
 * as a listener.
 *
 * For the figures and snapshots the Overview and the org lists draw: a
 * server aggregate is a promise, not a subscription, and an overlay's
 * lifetime counters move on every impression the beacon records, so a
 * listener over them would re-deliver a document per impression for as long
 * as the page stayed open. A snapshot answers once.
 *
 * `read` returning `null` means "not yet" — the org is not known — and
 * leaves the read pending rather than asking about nothing. The latest
 * `read` is the one invoked, through a ref, so it may close over fresh
 * props without listing each of them; `deps` names WHEN to read again.
 */
export function useOneShotRead<T>(
  read: () => Promise<T> | null,
  deps: DependencyList,
): OneShotRead<T> {
  const [state, setState] = useState<OneShotRead<T>>({
    value: null,
    status: 'loading',
  })
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    const pending = readRef.current()
    setState({ value: null, status: 'loading' })
    if (!pending) return undefined
    let active = true
    pending.then(
      (value) => {
        if (active) setState({ value, status: 'success' })
      },
      () => {
        if (active) setState({ value: null, status: 'error' })
      },
    )
    return () => {
      active = false
    }
    // `deps` is the caller's list, forwarded the way `useFirestoreCollection`
    // forwards its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/**
 * How many sites one page of an org list reads.
 *
 * The org hub's per-site lists are paged by SITE rather than by row, because
 * a site is what each read is made for: turning the page reads the next
 * sites and nothing else, so a section costs the same for an organization of
 * three sites or three hundred.
 */
export const ORG_SITES_PER_PAGE = 10

export interface OrgSiteReads<T> {
  /** Each site asked for so far, by host id. A site not yet asked is absent. */
  reads: ReadonlyMap<string, OneShotRead<T>>
  /**
   * Rewrites one site's answer in place — the card's own record of a write
   * it just made, so a switch it flipped does not flip back until the next
   * read.
   */
  patch: (hostId: string, update: (value: T) => T) => void
}

/**
 * One read PER SITE, for the sites a card is drawing — the org hub's
 * bounded fan-out.
 *
 * The caller decides which sites and how many: a page of them, or the first
 * N. Only those are read. A site answered once stays answered while the card
 * is mounted, so turning back to a page already seen costs nothing, and
 * changing `deps` forgets every answer and asks again.
 *
 * Each site is read on its own and fails on its own: one site whose read is
 * refused is one row that says so, not a card that draws nothing.
 */
export function useOrgSiteReads<T>(
  hostIds: readonly string[],
  read: (hostId: string) => Promise<T>,
  deps: DependencyList,
): OrgSiteReads<T> {
  const [answers, setAnswers] = useState<Record<string, OneShotRead<T>>>({})
  const readRef = useRef(read)
  readRef.current = read
  /** The sites asked for under the current `deps`, answered or not. */
  const asked = useRef(new Set<string>())
  /**
   * Bumped whenever the answers so far stop counting — `deps` changed, or
   * the card unmounted — so a read still in flight from before lands
   * nowhere.
   */
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    asked.current = new Set()
    setAnswers({})
    return () => {
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // A string, so the effect below re-runs when the SET changes and not when
  // the caller hands over a new array holding the same sites.
  const wantedKey = hostIds.join('\n')

  useEffect(() => {
    const wanted = wantedKey ? wantedKey.split('\n') : []
    const fresh = wanted.filter((hostId) => !asked.current.has(hostId))
    if (!fresh.length) return
    const current = generation.current
    for (const hostId of fresh) asked.current.add(hostId)
    setAnswers((previous) => {
      const next = { ...previous }
      for (const hostId of fresh) next[hostId] = { value: null, status: 'loading' }
      return next
    })
    for (const hostId of fresh) {
      readRef.current(hostId).then(
        (value) => {
          if (generation.current !== current) return
          setAnswers((previous) => ({
            ...previous,
            [hostId]: { value, status: 'success' },
          }))
        },
        () => {
          if (generation.current !== current) return
          setAnswers((previous) => ({
            ...previous,
            [hostId]: { value: null, status: 'error' },
          }))
        },
      )
    }
    // `deps` again, so a change reads the wanted sites afresh once the
    // effect above has forgotten them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, ...deps])

  const patch = useCallback(
    (hostId: string, update: (value: T) => T) =>
      setAnswers((previous) => {
        const answer = previous[hostId]
        if (!answer || answer.value === null) return previous
        return {
          ...previous,
          [hostId]: { value: update(answer.value), status: answer.status },
        }
      }),
    [],
  )

  const reads = useMemo(() => new Map(Object.entries(answers)), [answers])
  return { reads, patch }
}
