'use client'

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

import {
  isOrgWideMember,
  memberScopeTokens,
  ORG_SCOPE_TOKEN,
  type AglynOrgMember,
} from '@aglyn/aglyn'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from './firebase/firebase-services'

export interface ScopeTokensState {
  /** The caller's read set, for `array-contains-any` (AGL-1037). */
  tokens: string[]
  /** Org-wide members read everything and need no query filter. */
  orgWide: boolean
  loaded: boolean
}

/**
 * The signed-in user's scope tokens in an org (AGL-1044/1045).
 *
 * This is NOT a UI-gating convenience — it is required for correctness.
 * Under AGL-1041/1042 the rules evaluate per document on a LIST, and
 * Firestore rejects the WHOLE query if any candidate would fail. So a
 * scoped collaborator's unfiltered `collection(...)` read comes back
 * `permission-denied`, not filtered: without the matching
 * `array-contains-any` constraint the page does not show less, it shows
 * an error.
 *
 * Org-wide members deliberately get `orgWide: true` and no filter. Adding
 * one would cost them a composite index for no benefit, and would silently
 * hide any doc whose `visibleTo` the backfill has not reached.
 *
 * Defaults to org-wide while loading: the rules are the enforcement point,
 * and guessing "scoped" before the member doc arrives would flash an empty
 * library at people who can see everything.
 *
 * `loaded` answers for the member and org ASKED ABOUT NOW. A caller whose org
 * id arrives after its first render — resolved from a site through the host
 * index — would otherwise read the previous pass's answer, org-wide and
 * loaded, while the member document it actually needs is still in flight,
 * and send the one unfiltered query this hook exists to prevent.
 */
export function useScopeTokens(orgId: string | undefined): ScopeTokensState {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const signedIn = (user as { uid?: string } | undefined)?.uid
  /** Whose reach the state holds: `uid/orgId`, or `null` for no org. */
  const asked = signedIn && orgId ? `${signedIn}/${orgId}` : null
  const [state, setState] = useState<ScopeTokensState & { for: string | null }>({
    tokens: [ORG_SCOPE_TOKEN],
    orgWide: true,
    loaded: false,
    for: null,
  })

  useEffect(() => {
    const uid = (user as { uid?: string } | undefined)?.uid
    if (!uid || !orgId) {
      setState({
        tokens: [ORG_SCOPE_TOKEN],
        orgWide: true,
        loaded: Boolean(uid),
        for: null,
      })
      return
    }
    const key = `${uid}/${orgId}`
    let cancelled = false
    getDoc(doc(firestore, 'orgs', orgId, 'members', uid))
      .then((snapshot) => {
        if (cancelled) return
        const member = snapshot.exists()
          ? ({ $id: uid, ...snapshot.data() } as Partial<AglynOrgMember>)
          : undefined
        // `memberScopeTokens` owns the "stored projection, else recompute"
        // rule so the client and every Admin-SDK gate answer it the same
        // way — a member doc the AGL-1040 backfill has not reached must
        // still resolve to what `grantHostAccess` would have stamped.
        setState({
          tokens: memberScopeTokens(member),
          orgWide: isOrgWideMember(member),
          loaded: true,
          for: key,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            tokens: [ORG_SCOPE_TOKEN],
            orgWide: true,
            loaded: true,
            for: key,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [firestore, orgId, user])

  const loaded = state.loaded && state.for === asked
  return useMemo(
    () => ({ tokens: state.tokens, orgWide: state.orgWide, loaded }),
    [state.tokens, state.orgWide, loaded],
  )
}

export default useScopeTokens
