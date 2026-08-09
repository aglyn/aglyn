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

import type { HostAccessRole } from '@aglyn/aglyn'
import {
  collection,
  type Firestore,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'

/**
 * Every host role, as a value (AGL-1145).
 *
 * `/hosts/{hostId}` is gated per document on `memberRoles.{uid}` and Firestore
 * refuses to run a LIST that could return a denied document, so this filter is
 * mandatory — and it must name ALL the roles, or a member silently cannot see
 * a site they hold.
 *
 * Declared here rather than imported as a value: the `@aglyn/aglyn` barrel
 * pulls the whole library in, which these hooks do not otherwise need. The
 * `Record` keeps it honest anyway — adding a role to `HostAccessRole` fails to
 * compile here, exactly as it does at the shared `HOST_ACCESS_ROLES`.
 */
const HOST_ACCESS_ROLE_KEYS: Record<HostAccessRole, true> = {
  admin: true,
  editor: true,
  viewer: true,
}
const HOST_ACCESS_ROLES = Object.keys(HOST_ACCESS_ROLE_KEYS) as HostAccessRole[]

/**
 * Retry schedule (AGL-1200). Doubling, capped — NOT a flat delay.
 *
 * A flat 400 ms × 8 spent every attempt inside the first 3.2 s of page load,
 * which is precisely the window this read is most likely to fail in: on a cold
 * load the Firestore connection is not up yet, so the `getDocsFromServer`
 * confirmation below throws `unavailable` until it is. The heavier the route,
 * the longer that takes — which is why a cold hit on the besigner failed while
 * the same URL reached in-app worked, and why the light `(app)` pages usually
 * got away with it.
 *
 * Doubling to a 3.2 s cap spans ~12.4 s in SEVEN requests, where the flat
 * schedule spanned 3.2 s in nine. A wider window and less hammering, because
 * the thing being waited on is a warm-up, not a coin flip.
 */
const RETRY_BASE_DELAY_MS = 400
const RETRY_MAX_DELAY_MS = 3200
/**
 * Exported because the org-membership listen shares the budget (AGL-1260):
 * it fails in the same cold-load window for the same reason, so the schedule
 * that was tuned here is the schedule, not a coincidence to keep in sync.
 */
export const MAX_RETRIES = 6

/** 400, 800, 1600, 3200, 3200, 3200 — see {@link RETRY_BASE_DELAY_MS}. */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS)
}

export interface HostResolution {
  /** The resolved host doc id for the current org, or null (spinner/404/redirect). */
  hostId: string | null
  /** Resolution has settled (true off host routes). */
  ready: boolean
  /** Resolution gave up after retries — show retry, never a false 404 (AGL-813). */
  error: boolean
  /**
   * Re-runs resolution from scratch (AGL-1200).
   *
   * `error` is otherwise terminal: the effect's deps do not change after it
   * latches, so nothing retries. The guard's "Try again" used to call
   * `window.location.reload()`, which re-entered the same cold-load window and
   * failed identically every time — a recovery action that recreates the
   * conditions it is recovering from is not a recovery action.
   */
  retry: () => void
}

/**
 * Resolution state tagged with the subdomain it was computed for (AGL-894).
 *
 * `retry` is deliberately NOT part of the state: it is a stable callback the
 * hook derives, not something a read can produce, and putting it in state
 * would mean every `setState` had to carry it around.
 */
interface ResolutionState extends Omit<HostResolution, 'retry'> {
  /** The `subdomain` argument this state describes; null off host routes. */
  for: string | null
}

/**
 * Resolve a URL subdomain to a host doc id within the current org (AGL-844),
 * replacing the whole-`hosts`-list scan the provider used to do. Two bounded
 * reads instead of the org's entire site list:
 *
 * 1. The user's own projection: `users/{uid}/hostMemberships where subdomain==…
 *    and orgId==…` — one doc for the sites they can reach in this org.
 * 2. Fallback for legacy hosts whose projection wasn't backfilled: the
 *    authoritative membership-scoped `hosts` query (today's mechanism), so a
 *    pre-projection site never false-404s.
 *
 * A miss (neither finds it) settles `ready` with `hostId: null`; the provider's
 * cross-org redirect + the HostGuard's 404 handle it exactly as before. Errors
 * retry with backoff and only then set `error`, preserving the AGL-813/827
 * "never 404 an unconfirmed empty" contract.
 *
 * `ready` is derived DURING RENDER from the subdomain the state was computed
 * for, never left standing across a subdomain change (AGL-894). Effects run
 * after paint, so a plain `ready` boolean in state stayed true for one render
 * after a client-side navigation onto a host route — and `hostId` was still
 * null — which is exactly the `ready && !hostId` shape HostGuard 404s on. That
 * one render is why picking a site in the switcher landed on "This page isn't
 * here" while a hard refresh of the same URL worked.
 */
export function useHostResolution(
  firestore: Firestore,
  subdomain: string | null,
  uid: string | undefined,
  orgId: string | undefined,
): HostResolution {
  const [state, setState] = useState<ResolutionState>({
    for: null,
    hostId: null,
    ready: false,
    error: false,
  })
  // Bumping this re-runs the effect below, which is the whole mechanism
  // behind `retry` (AGL-1200).
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    // Off a host route there is nothing to resolve.
    if (!subdomain) {
      setState({ for: null, hostId: null, ready: true, error: false })
      return
    }
    // Hold (spinner) until we know the user and their current org.
    if (!uid || !orgId) {
      setState({ for: subdomain, hostId: null, ready: false, error: false })
      return
    }

    let cancelled = false
    let retried = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const resolve = async () => {
      // The projection is a fast-path optimization, not the source of truth —
      // if it is unavailable (rules/index still rolling out, or a transient
      // error) fall through to the authoritative query rather than erroring.
      // Only the authoritative read (which the rules always allow, no special
      // index) drives retry/error, so routing never breaks on the projection.
      try {
        const projection = await getDocs(
          query(
            collection(firestore, 'users', uid, 'hostMemberships'),
            where('subdomain', '==', subdomain),
            where('orgId', '==', orgId),
            limit(1),
          ),
        )
        if (cancelled) return
        const projected = projection.docs[0]
        if (projected) {
          setState({
            for: subdomain,
            hostId: projected.id,
            ready: true,
            error: false,
          })
          return
        }
      } catch {
        if (cancelled) return
        // fall through to the authoritative query below
      }

      try {
        // Legacy / not-yet-backfilled / projection-unavailable: the
        // authoritative membership query (today's mechanism).
        const authoritativeQuery = query(
          collection(firestore, 'hosts'),
          where(`memberRoles.${uid}`, 'in', HOST_ACCESS_ROLES),
          where('subdomain', '==', subdomain),
          limit(1),
        )
        let authoritative = await getDocs(authoritativeQuery)
        if (cancelled) return
        // A cached-empty is NOT a confirmed miss (AGL-813/827): multi-tab
        // IndexedDB persistence can serve a stale `noDocument` tombstone a
        // resumed listen never re-sends, so a valid host would false-404 on a
        // cold load. Re-read from the server before treating "not found" as
        // real; a server error falls through to the retry/error path below.
        if (authoritative.empty) {
          authoritative = await getDocsFromServer(authoritativeQuery)
          if (cancelled) return
        }
        const host = authoritative.docs[0]
        // Only resolve if it belongs to the CURRENT org; a match in another
        // org is left for the provider's cross-org redirect (hostId stays null).
        if (host && host.get('orgId') === orgId) {
          setState({
            for: subdomain,
            hostId: host.id,
            ready: true,
            error: false,
          })
          return
        }
        setState({ for: subdomain, hostId: null, ready: true, error: false })
      } catch {
        if (cancelled) return
        if (retried < MAX_RETRIES) {
          timer = setTimeout(resolve, retryDelayMs(retried))
          retried += 1
        } else {
          setState({ for: subdomain, hostId: null, ready: true, error: true })
        }
      }
    }
    setState({ for: subdomain, hostId: null, ready: false, error: false })
    void resolve()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [firestore, subdomain, uid, orgId, attempt])

  // State from a previous subdomain describes a different route, so it cannot
  // stand in for this one: until the effect re-runs, the honest answer is "not
  // ready" (a spinner), never a settled miss the guard would 404 (AGL-894).
  if (state.for !== subdomain) {
    return { hostId: null, ready: !subdomain, error: false, retry }
  }
  return {
    hostId: state.hostId,
    ready: state.ready,
    error: state.error,
    retry,
  }
}

export default useHostResolution
