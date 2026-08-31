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

import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useOrgScope } from './use-org-scope'

/**
 * The org roster, for the pickers that need to name a member.
 *
 * Owner-only surfaces read this — ownership transfer, and the delete flow's
 * "who else is here" line. They were panels sharing one page's `members`
 * state; as routes they would each grow their own copy of this fetch, and a
 * copy is where the `active` guard gets dropped and an unmounted section sets
 * state.
 *
 * `enabled` rather than an early return, so the hook order never changes
 * between renders. Failure leaves the list EMPTY and silent on purpose: the
 * surfaces that use it can still be operated afterwards, and an error toast
 * for a picker nobody has opened yet is noise.
 */
export function useOrgMemberOptions(enabled: boolean) {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const [members, setMembers] = useState<any[]>([])
  const orgId = currentOrg?.$id
  useEffect(() => {
    if (!enabled || !orgId) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
        )
        if (!response.ok) return
        const payload = await response.json()
        if (active) setMembers(payload.members ?? [])
      } catch {
        // The picker simply stays empty; the action is still possible later.
      }
    })()
    return () => {
      active = false
    }
  }, [enabled, orgId, user])
  return members
}

export default useOrgMemberOptions
