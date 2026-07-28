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

import { isOrgWideMembership } from '@aglyn/aglyn'
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useOrgScope } from './use-org-scope'

/**
 * Does the signed-in member reach the whole current org, or only their own
 * sites? (AGL-1032)
 *
 * Reads the `orgWide` mirror on the `users/{uid}/orgs` row `useOrgScope`
 * already loads — no extra read, and the answer arrives with the org list
 * rather than after it, which is what keeps the org chrome from flashing
 * before it is hidden. `useOrgPermissions` could answer this from the member
 * doc, but it is a second async read on every org route AND it defaults to
 * full access while loading, which is the one direction this must not guess.
 *
 * `ready` is the gate. `orgWide` reads true until the memberships resolve —
 * a deliberate fail-open, because the alternative is blanking the console for
 * every org owner on every cold load — so a caller that hides UI must consult
 * `ready` first (see `no-unguarded-loading-hook`, AGL-1067).
 */
export function useOrgReach(): { orgWide: boolean; ready: boolean } {
  const { currentOrg, loading } = useOrgScope()
  return { orgWide: isOrgWideMembership(currentOrg), ready: !loading }
}

/** One `users/{uid}/hostMemberships` row, as the landing decision needs it. */
export interface ReachableSite {
  $id: string
  subdomain?: string
  displayName?: string
}

/**
 * The current org's sites this user can reach, from the AGL-844 projection.
 *
 * Only ever queried for a SCOPED member (`enabled`): an org-wide member's
 * landing needs no site list, and this is a per-route read that would
 * otherwise run for everyone to answer a question only collaborators ask.
 *
 * Capped at two rows because the only question is "exactly one, or more" —
 * one means skip the list of one and go straight in. Loading a member's whole
 * roster to count to two is what the projection exists to avoid.
 */
export function useReachableSites(enabled: boolean): {
  sites: ReachableSite[]
  ready: boolean
} {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const uid = user?.uid
  const orgId = currentOrg?.$id
  const [state, setState] = useState<{
    sites: ReachableSite[]
    ready: boolean
    /** The (uid, orgId) this state describes — see AGL-894. */
    key: string | null
  }>({ sites: [], ready: false, key: null })

  useEffect(() => {
    if (!enabled || !uid || !orgId) {
      setState({ sites: [], ready: false, key: null })
      return undefined
    }
    return onSnapshot(
      query(
        collection(firestore, 'users', uid, 'hostMemberships'),
        where('orgId', '==', orgId),
        limit(2),
      ),
      (snapshot) => {
        setState({
          sites: snapshot.docs.map(
            (entry) => ({ $id: entry.id, ...entry.data() }) as ReachableSite,
          ),
          ready: true,
          key: `${uid}:${orgId}`,
        })
      },
      // A failed read leaves `ready` false — the caller holds rather than
      // acting on "no sites", which would be a redirect built on an error.
      () => setState({ sites: [], ready: false, key: null }),
    )
  }, [enabled, firestore, uid, orgId])

  // Derived during render, never left standing across an org change: an
  // effect runs after paint, so a plain flag stays true for one render with
  // the PREVIOUS org's sites in hand (AGL-894).
  const ready = state.ready && state.key === `${uid}:${orgId}`
  return { sites: ready ? state.sites : [], ready }
}

export default useOrgReach
