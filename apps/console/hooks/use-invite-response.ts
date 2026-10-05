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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgScope } from './use-org-scope'
import { usePendingInvites, type PendingInvite } from './use-pending-invites'

export type InviteAnswer = 'accept' | 'decline'

/**
 * Answers a pending invitation (AGL-234, AGL-3402) — the one path the banner
 * and the accept/decline dialog both take, so they cannot drift on what an
 * answer does. Accepting materializes the membership server-side, selects the
 * workspace and opens it; declining removes the invitation. Either way the
 * shared list is re-read, which is what clears the banner everywhere.
 *
 * Resolves true when the answer was recorded.
 */
export function useInviteResponse() {
  const { data: user } = useUser()
  const { selectOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { refresh } = usePendingInvites()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  const respond = useCallback(
    async (invite: PendingInvite, answer: InviteAnswer): Promise<boolean> => {
      setBusyId(invite.$id)
      try {
        const response = await authorizedFetch(user, '/api/orgs/invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: invite.orgId,
            action: answer,
            inviteId: invite.$id,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(
            payload?.error ??
              (answer === 'accept'
                ? 'Accepting the invite failed'
                : 'Declining the invite failed'),
            { variant: 'warning' },
          )
          return false
        }
        const name = invite.orgName ?? 'the organization'
        if (answer === 'accept') {
          // A handoff lands on the org home like any join (AGL-3466): the
          // new owner looks around first, and is asked to upgrade later.
          enqueueSnackbar(
            payload?.owner === true ? `You now own ${name}` : `Joined ${name}`,
            { variant: 'success' },
          )
          if (invite.orgId) selectOrg(invite.orgId)
          if (invite.orgSlug) {
            void router.push(
              buildRoute(Route.ORG_HOME, { orgSlug: invite.orgSlug }),
            )
          }
        } else {
          enqueueSnackbar(`Declined the invitation to ${name}`, {
            variant: 'info',
          })
        }
        await refresh()
        return true
      } catch {
        enqueueSnackbar('Could not reach the server — try again', {
          variant: 'warning',
        })
        return false
      } finally {
        setBusyId(null)
      }
    },
    [user, selectOrg, enqueueSnackbar, refresh, router],
  )

  return { respond, busyId }
}

export default useInviteResponse
