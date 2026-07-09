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
import { Alert, Button, Stack } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useOrgWorkspace } from '../hooks/use-org-workspace'

interface PendingInvite {
  $id: string
  orgId: string | null
  orgName: string | null
  role: string | null
}

/**
 * Pending organization invites (AGL-234): surfaces invites addressed to
 * the signed-in user's verified email; accepting materializes the
 * membership server-side and the new org appears in the switcher via the
 * reverse-index subscription.
 */
export function OrgInvitesBanner() {
  const { data: user } = useUser()
  const { selectOrg } = useOrgWorkspace()
  const { enqueueSnackbar } = useSnackbar()
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    try {
      const response = await fetch('/api/orgs/invites?mine=1', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!response.ok) return
      const payload = await response.json()
      setInvites(
        (payload.invites ?? []).filter((invite: PendingInvite) => invite.orgId),
      )
    } catch {
      // banner is best-effort; the team page still lists invites
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const accept = async (invite: PendingInvite) => {
    setBusyId(invite.$id)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/invites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: invite.orgId,
          action: 'accept',
          inviteId: invite.$id,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Accepting the invite failed', {
          variant: 'warning',
        })
        return
      }
      enqueueSnackbar(`Joined ${invite.orgName ?? 'the organization'}`, {
        variant: 'success',
      })
      if (invite.orgId) selectOrg(invite.orgId)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  if (invites.length === 0) return null

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {invites.map((invite) => (
        <Alert
          key={invite.$id}
          severity="info"
          action={
            <Button
              size="small"
              disabled={busyId === invite.$id}
              onClick={() => void accept(invite)}
            >
              {busyId === invite.$id ? 'Joining…' : 'Accept'}
            </Button>
          }
        >
          {`You've been invited to ${invite.orgName ?? 'an organization'}` +
            (invite.role ? ` as ${invite.role}` : '') +
            '.'}
        </Alert>
      ))}
    </Stack>
  )
}
OrgInvitesBanner.displayName = 'OrgInvitesBanner'
OrgInvitesBanner.aglyn = true

export default OrgInvitesBanner
