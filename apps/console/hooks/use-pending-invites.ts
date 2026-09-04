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

import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

export interface PendingInvite {
  $id: string
  orgId: string | null
  orgName: string | null
  role: string | null
}

/**
 * Pending organization invites (AGL-234) for the signed-in user, shared by
 * the invites banner and any surface that needs to react to their presence
 * (e.g. the sites zero-state, which steps aside when a user has an invite to
 * accept). Best-effort: a failed fetch resolves to an empty list rather than
 * throwing — the team page remains the authoritative invite list.
 */
export function usePendingInvites() {
  const { data: user } = useUser()
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const response = await authorizedFetch(user, '/api/orgs/invites?mine=1')
      // A refusal — the route's, or an unobtainable token — empties the list
      // rather than leaving somebody else's invitations on screen.
      if (!response.ok) return void setInvites([])
      const payload = await response.json()
      setInvites(
        (payload.invites ?? []).filter((invite: PendingInvite) => invite.orgId),
      )
    } catch {
      // best-effort; leave the last known list in place
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { invites, loading, refresh }
}

export default usePendingInvites
