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
  doc,
  getDocFromServer,
  onSnapshot,
  type Firestore,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 8
const MAX_RETRY_DELAY_MS = 15_000

export interface ConfirmedDocState<T> {
  /** The doc's data (with `$id`), or undefined while loading / when absent. */
  data: T | undefined
  /**
   * True once an answer worth acting on has arrived: any snapshot that has
   * data, or a MISS the server itself has confirmed. Consumers must not
   * 404, fall back to a default, or otherwise treat "no doc" as real until
   * this is true.
   */
  ready: boolean
  /** True only when retries were exhausted — offer a retry, never a 404. */
  error: boolean
  /**
   * `data` is being served from the local cache and the server has not
   * confirmed it (AGL-1066). Never a reason to withhold the value — only a
   * reason not to let it decide something irreversible.
   */
  fromCache: boolean
}

export interface UseConfirmedDocOptions {
  /**
   * Also confirm a cache-served hit that EXISTS, not just a miss (AGL-1066).
   *
   * The base contract trusts any snapshot that exists, whatever its source.
   * That is right for ordinary content — the value was legitimately the
   * user's a moment ago, and blanking it costs more than it buys. It is NOT
   * right for the entitlement doc: `orgs/{orgId}` is the only plan source
   * (AGL-238), and a cached copy from before a plan change renders the org
   * at the wrong tier for as long as the session stays stale. AGL-887 closed
   * the tombstone direction of exactly this fault (a Business workspace
   * rendering as Free); this closes the stale-EXISTS direction.
   *
   * Opt-in because it can cost one extra server read, and only when the
   * listener has actually failed to reach the server — see the deferral in
   * the implementation. Enable it for entitlement-shaped documents only.
   */
  confirmCachedHit?: boolean
}

/**
 * How long a cached hit is allowed to stand before it is confirmed.
 *
 * Not zero, and this is the whole reason the option is affordable: on a
 * healthy load the first snapshot is routinely from cache and the server
 * snapshot follows within milliseconds. Confirming immediately would bill an
 * extra read on every mount for every user; waiting means the confirm fires
 * only when the server genuinely did not answer.
 */
const CONFIRM_CACHED_HIT_DELAY_MS = 1_500

/**
 * A doc listen that never presents an unconfirmed miss (AGL-928).
 *
 * This is the shared form of the contract four consumers learned the hard
 * way (AGL-813/827/875/886/887): the console's multi-tab IndexedDB
 * persistence can serve a stale `noDocument` tombstone for a LIVE doc, and
 * a resumed listen never re-sends the correction — so `exists() === false`
 * from cache looks confirmed while being wrong. Symptoms ranged from valid
 * hosts 404ing to a Business workspace rendering as Free.
 *
 * Contract implemented here:
 * - Subscribe with a raw `onSnapshot` + exponential-backoff resubscribe:
 *   right after sign-in (and on cold loads behind App Check) the first
 *   listen can sit in transient `permission-denied` before the ID token
 *   attaches (AGL-216); reactfire's cached Observable would replay that
 *   error forever.
 * - A snapshot that EXISTS is trusted immediately, whatever its source.
 * - A snapshot that is MISSING and came from cache is confirmed via
 *   `getDocFromServer` before it is believed; a failed confirm leaves
 *   `ready` false rather than lying.
 * - Exhausted retries set `error` (and `ready`) so consumers can offer
 *   "try again" — never a false 404 or a fallback default.
 *
 * For QUERY listens the same contract lives in `useOrgHosts` (empty →
 * `getDocsFromServer` confirm); extract it the same way if a third query
 * consumer appears.
 *
 * @param segments Doc path segments (`['orgs', orgId]`), or null to idle
 *   (state resets while null, matching "clear on scope change").
 */
export function useConfirmedDoc<T extends Record<string, unknown>>(
  firestore: Firestore,
  segments: readonly [string, ...string[]] | null,
  options: UseConfirmedDocOptions = {},
): ConfirmedDocState<T> {
  const [state, setState] = useState<ConfirmedDocState<T>>({
    data: undefined,
    ready: false,
    error: false,
    fromCache: true,
  })
  // Effect key: a new path must tear down and restart the listen.
  const pathKey = segments ? segments.join('/') : null
  const confirmCachedHit = options.confirmCachedHit

  useEffect(() => {
    setState({ data: undefined, ready: false, error: false, fromCache: true })
    if (!pathKey) return

    let cancelled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    // One confirm per mount, and never once the server has answered.
    let confirmTimer: ReturnType<typeof setTimeout> | null = null
    let confirmRequested = false
    const ref = doc(firestore, pathKey)

    const deliver = (
      exists: boolean,
      id: string,
      payload: Record<string, unknown> | undefined,
      fromCache: boolean,
    ) =>
      setState({
        data: exists ? ({ $id: id, ...payload } as unknown as T) : undefined,
        ready: true,
        error: false,
        fromCache,
      })

    const subscribe = () => {
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          if (cancelled) return
          attempt = 0
          const fromCache = snapshot.metadata.fromCache
          if (!fromCache && confirmTimer) {
            // The server answered on its own; nothing left to confirm.
            clearTimeout(confirmTimer)
            confirmTimer = null
          }
          if (!snapshot.exists() && fromCache) {
            // Unconfirmed miss: ask the server before believing it. On
            // failure stay un-ready — the listener remains subscribed and
            // the next (server) snapshot resolves it.
            void getDocFromServer(ref)
              .then((server) => {
                if (cancelled) return
                deliver(server.exists(), server.id, server.data(), false)
              })
              .catch(() => undefined)
            return
          }
          deliver(snapshot.exists(), snapshot.id, snapshot.data(), fromCache)

          /**
           * Unconfirmed HIT (AGL-1066), for entitlement-shaped docs only.
           *
           * The value is already delivered above and stays on screen
           * whatever happens here — this never blanks the page and never
           * holds `ready` false, because a transient blip must not become a
           * wrong tier OR a 404. It only replaces a cached answer with the
           * server's when the server can be reached.
           */
          if (
            confirmCachedHit &&
            fromCache &&
            snapshot.exists() &&
            !confirmRequested &&
            !confirmTimer
          ) {
            confirmTimer = setTimeout(() => {
              confirmTimer = null
              confirmRequested = true
              void getDocFromServer(ref)
                .then((server) => {
                  if (cancelled) return
                  deliver(server.exists(), server.id, server.data(), false)
                })
                // Could not reach the server: keep showing the cached value,
                // still flagged `fromCache`. Refusing to answer would be the
                // stale-`ready` false-404 this hook exists to prevent.
                .catch(() => undefined)
            }, CONFIRM_CACHED_HIT_DELAY_MS)
          }
        },
        () => {
          if (cancelled) return
          unsubscribe?.()
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(
              RETRY_DELAY_MS * 2 ** attempt,
              MAX_RETRY_DELAY_MS,
            )
            attempt += 1
            timer = setTimeout(subscribe, delay)
          } else {
            setState({
              data: undefined,
              ready: true,
              error: true,
              fromCache: true,
            })
          }
        },
      )
    }
    subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (confirmTimer) clearTimeout(confirmTimer)
      unsubscribe?.()
    }
  }, [firestore, pathKey, confirmCachedHit])

  return state
}

export default useConfirmedDoc
