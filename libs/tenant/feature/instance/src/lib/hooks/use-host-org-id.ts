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

import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore } from './firebase/firebase-services'

export interface HostOrgIdState {
  /** The owning org, or null once we know there isn't one. */
  orgId: string | null
  /** False until the `hostIndex` lookup has settled. */
  loaded: boolean
}

/**
 * The org a host belongs to, plus whether we know yet (AGL-1061).
 *
 * `useHostOrgId` below returns `null` for THREE different situations —
 * still loading, no owning org, and lookup failed — and callers that
 * branch on truthiness take the no-org branch during the first render or
 * two of every mount, while the `hostIndex` `getDoc` is in flight.
 *
 * For a read that is a harmless flash of an empty list. For a WRITE it is
 * not: a `setDoc` resolving inside that window lands under
 * `hosts/{hostId}/…`, which AGL-1050 left with no readers — so the save
 * appears to succeed and the row is unreachable from anywhere afterwards.
 *
 * Anything that can write must therefore gate on `loaded` and hold rather
 * than guess.
 */
export function useHostOrgIdState(
  hostId: string | undefined,
): HostOrgIdState {
  const firestore = useFirestore()
  const [state, setState] = useState<HostOrgIdState>({
    orgId: null,
    loaded: false,
  })

  useEffect(() => {
    // No host to resolve is a SETTLED answer, not a pending one — the org
    // Data and Media pages pass no host and must not wait forever.
    if (!hostId) {
      setState({ orgId: null, loaded: true })
      return undefined
    }
    let active = true
    setState({ orgId: null, loaded: false })
    void getDoc(doc(firestore, 'hostIndex', hostId))
      .then((snapshot) => {
        if (active) {
          setState({
            orgId: (snapshot.data()?.['orgId'] as string) ?? null,
            loaded: true,
          })
        }
      })
      .catch(() => {
        // A failed lookup is also settled. Retrying forever would leave
        // the page permanently disabled; the host branch is the correct
        // (and, per AGL-1050, empty) fallback.
        if (active) setState({ orgId: null, loaded: true })
      })
    return () => {
      active = false
    }
  }, [firestore, hostId])

  return state
}

/**
 * The org a host belongs to, resolved from the `hostIndex` mirror
 * (AGL-237). Host-scoped pages use this — NOT the workspace context — so
 * org-shared data stays correct when a multi-org user deep-links into a
 * host outside their selected workspace.
 *
 * Null while loading AND for pre-org hosts, which callers cannot tell
 * apart. Fine for the many callers that only ever build an org path from
 * it and render nothing until it arrives; anything that FALLS BACK to a
 * host path — and especially anything that writes — wants
 * {@link useHostOrgIdState} instead (AGL-1061).
 */
export function useHostOrgId(hostId: string | undefined): string | null {
  return useHostOrgIdState(hostId).orgId
}

export interface OrgDataScope {
  /**
   * Firestore parent for org-shared data: `['orgs', orgId]`, or NULL when
   * there is no such path to build — the lookup is still in flight, or the
   * host has no owning org. Callers pass `null` straight through to their
   * query factory, which issues nothing.
   *
   * There is deliberately no `['hosts', hostId]` alternative (AGL-1050).
   */
  scope: readonly ['orgs', string] | null
  /** The owning org once known, else null. */
  orgId: string | null
  /**
   * Whether the lookup has SETTLED. Distinguishes the two reasons `scope`
   * is null: false means "not yet, keep the spinner", true means "there is
   * no org and none is coming" — render the empty state, leave saves off.
   */
  ready: boolean
}

/**
 * The `['orgs', orgId]` parent every host-scoped card builds, with an
 * honest `ready` flag (AGL-1061).
 *
 * This existed as a copy-pasted ternary in nine components:
 *
 * ```ts
 * const orgId = props.orgId ?? useHostOrgId(hostId)
 * const scope = orgId ? ['orgs', orgId] : ['hosts', hostId]
 * ```
 *
 * which silently resolves to the HOST branch for the first render or two
 * of every mount, because `useHostOrgId` cannot say "not yet". Centralising
 * it means the window is handled once, correctly, instead of nine times
 * from memory.
 *
 * ## Why there is no host fallback any more (AGL-1050)
 *
 * That `: ['hosts', hostId]` branch was the pre-AGL-237 storage location,
 * kept as a migration path. AGL-1061 counted what actually lives there in
 * production — `datasets`, `lists`, `contacts`, `contactSegments`, exact
 * count() per host, no truncation — and the answer was 0 across every
 * host. So it was not a migration path; it was a second address for
 * org-shared data that nothing had ever written and nothing read back.
 *
 * Keeping it ready-gated would have been enough to close the live defect.
 * It was removed instead because the branch could only ever be reached by
 * a bug — most sharply through the `hostIndex` lookup's `.catch()`, where
 * a transient failure used to hand back a confident host path and let the
 * card save a row nobody could reach afterwards. A null scope cannot do
 * that: the query is never issued and the save is never enabled.
 *
 * The rules now deny `hosts/{hostId}/datasets/**` outright, so the path is
 * closed on both sides rather than merely unused on one.
 */
export function useOrgDataScope(options: {
  hostId?: string | undefined
  /** An explicit org skips the lookup entirely and is ready immediately. */
  orgId?: string | undefined
}): OrgDataScope {
  const { hostId, orgId: explicitOrgId } = options
  const state = useHostOrgIdState(explicitOrgId ? undefined : hostId)
  const orgId = explicitOrgId ?? state.orgId
  const loaded = Boolean(explicitOrgId) || state.loaded
  // Memoised because `scope` is a QUERY DEPENDENCY. A fresh tuple every
  // render, passed to `useFirestoreCollection`, tears down and reopens the
  // listener (and clears its data) on every render — so hand out a stable
  // reference rather than trusting every caller to destructure primitives.
  return useMemo(
    () => ({
      orgId,
      ready: loaded,
      scope: orgId ? (['orgs', orgId] as const) : null,
    }),
    [orgId, loaded],
  )
}

export default useHostOrgId
