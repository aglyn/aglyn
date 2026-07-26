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
  collection,
  type Firestore,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 8

export interface HostResolution {
  /** The resolved host doc id for the current org, or null (spinner/404/redirect). */
  hostId: string | null
  /** Resolution has settled (true off host routes). */
  ready: boolean
  /** Resolution gave up after retries — show retry, never a false 404 (AGL-813). */
  error: boolean
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
 */
export function useHostResolution(
  firestore: Firestore,
  subdomain: string | null,
  uid: string | undefined,
  orgId: string | undefined,
): HostResolution {
  const [state, setState] = useState<HostResolution>({
    hostId: null,
    ready: false,
    error: false,
  })

  useEffect(() => {
    // Off a host route there is nothing to resolve.
    if (!subdomain) {
      setState({ hostId: null, ready: true, error: false })
      return
    }
    // Hold (spinner) until we know the user and their current org.
    if (!uid || !orgId) {
      setState({ hostId: null, ready: false, error: false })
      return
    }

    let cancelled = false
    let attempt = 0
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
          setState({ hostId: projected.id, ready: true, error: false })
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
          where(`memberRoles.${uid}`, 'in', ['admin', 'editor', 'viewer']),
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
          setState({ hostId: host.id, ready: true, error: false })
          return
        }
        setState({ hostId: null, ready: true, error: false })
      } catch {
        if (cancelled) return
        if (attempt < MAX_RETRIES) {
          attempt += 1
          timer = setTimeout(resolve, RETRY_DELAY_MS)
        } else {
          setState({ hostId: null, ready: true, error: true })
        }
      }
    }
    setState({ hostId: null, ready: false, error: false })
    void resolve()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [firestore, subdomain, uid, orgId])

  return state
}

export default useHostResolution
