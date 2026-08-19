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
  hostRoleCanPublish,
  hostRoleFor,
  type AglynOrgMember,
  type HostAccessRole,
} from '@aglyn/aglyn'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import useHostOrgId from './use-host-org-id'
import firestoreOneShotRetry from '../utils/firestore-one-shot-retry'

export interface HostRoleState {
  /** The member's effective role on this site, or null for no access. */
  hostRole: HostAccessRole | null
  /** May they make content live? `author` may not — that IS the role. */
  canPublish: boolean
  /** False until the member doc has been read; see the note on gating. */
  loaded: boolean
}

/**
 * The signed-in member's role on ONE site, for the console (AGL-2334).
 *
 * The `author` host role edits content and cannot publish it. That is
 * enforced where it must be — `canPublishHostContent()` in the Firestore
 * rules, with the publish-pointer and `publishSchedule` field freezes beside
 * it — and it was enforced *only* there. The console rendered every publish
 * control unconditionally, so an author's Publish button worked exactly like
 * an editor's right up to a raw `permission-denied` toast.
 *
 * `canPublishHost` and `hostRoleCanPublish` were written for this and, until
 * this hook, had no caller in any UI: the comment beside them says they exist
 * "so the console can say no with a message instead of surfacing a bare
 * permission-denied". There was no `useHostRole` for them to be called from.
 *
 * ## Why the answer comes from the member doc, not the host projection
 *
 * `hosts/{hostId}.memberRoles` is a PROJECTION, written by the membership
 * APIs for the rules' benefit, and an org owner or admin is frequently never
 * added to an individual site — they reach it by org role. Reading the
 * projection would tell the owner of the workspace they may not publish their
 * own page. `hostRoleFor` is the predicate that resolves both populations,
 * and it is the same one the rules projection, the org gate and the
 * revalidate route use.
 *
 * ## `loaded`, and which way to fail
 *
 * This is a DISPLAY gate in front of an enforced boundary, so the two failure
 * modes are not symmetric. Hiding a control from someone entitled to it is a
 * support ticket; showing one that the database will refuse is the defect
 * being fixed, and it is merely the status quo. So `canPublish` is false
 * until the read lands, and callers should disable rather than hide — a
 * control that vanishes and reappears is worse than one that is briefly
 * inert, and `loaded` is exposed so a caller can tell "no" from "not yet".
 */
export function useHostRole(hostId: string | undefined): HostRoleState {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const orgId = useHostOrgId(hostId)
  const [state, setState] = useState<HostRoleState>({
    hostRole: null,
    canPublish: false,
    loaded: false,
  })

  useEffect(() => {
    const uid = (user as { uid?: string } | undefined)?.uid
    if (!uid || !orgId || !hostId) return
    let active = true
    void (async () => {
      try {
        // A member reading their OWN member doc is always allowed, so a
        // denial surviving the retries is a session fault, not an
        // authorization one (AGL-1063) — same read and same reasoning as
        // `use-org-permissions`.
        const snapshot = await firestoreOneShotRetry(
          () => getDoc(doc(firestore, 'orgs', orgId, 'members', uid)),
          'orgs/members',
        )
        if (!active) return
        const member = (snapshot.data() ?? {}) as Partial<AglynOrgMember>
        const hostRole = hostRoleFor(member, hostId as never)
        setState({
          hostRole,
          canPublish: hostRoleCanPublish(hostRole),
          loaded: true,
        })
      } catch {
        // Fail closed on the display gate: `loaded` stays true so the caller
        // stops showing a spinner, and `canPublish` stays false so nothing
        // invites a click the rules will refuse.
        if (active) setState({ hostRole: null, canPublish: false, loaded: true })
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, user, orgId, hostId])

  return state
}

export default useHostRole
