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

import { Alert, Button, Stack } from '@mui/material'
import { useEffect } from 'react'
import { useInviteResponse } from '../hooks/use-invite-response'
import {
  useInviteReview,
  usePendingInvites,
  type PendingInvite,
} from '../hooks/use-pending-invites'

export interface OrgInvitesBannerProps {
  /**
   * `shell` is the copy the console layout mounts above every page
   * (AGL-3402); it steps aside while an `inline` copy is mounted, so a page
   * that makes the invitation its content does not show it twice.
   */
  placement?: 'shell' | 'inline'
}

/** "You've been invited to Acme as admin." */
export function inviteSentence(invite: PendingInvite): string {
  return (
    `You've been invited to ${invite.orgName ?? 'an organization'}` +
    (invite.role ? ` as ${invite.role}` : '') +
    '.'
  )
}

/**
 * Pending organization invites (AGL-234): invites addressed to any confirmed
 * address on the signed-in account, each with Accept and Decline.
 *
 * The console shell mounts it on every page (AGL-3402). It used to render
 * only on the workspace chooser and the sites list, and nothing inside a
 * workspace links back to the chooser — so a person already working in one
 * workspace could not reach an invitation to another without typing the URL.
 *
 * Decline opens the dialog on its confirmation step rather than answering at
 * once: a declined invitation is gone, and only the org can send another.
 */
export function OrgInvitesBanner({ placement = 'inline' }: OrgInvitesBannerProps) {
  const { invites } = usePendingInvites()
  const { review, claimInline, inlineClaims } = useInviteReview()
  const { respond, busyId } = useInviteResponse()

  useEffect(
    () => (placement === 'inline' ? claimInline() : undefined),
    [placement, claimInline],
  )

  if (invites.length === 0) return null
  if (placement === 'shell' && inlineClaims > 0) return null

  return (
    <Stack spacing={placement === 'shell' ? 0 : 1} sx={placement === 'shell' ? undefined : { mb: 2 }}>
      {invites.map((invite) => (
        <Alert
          key={invite.$id}
          severity="info"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                color="inherit"
                disabled={busyId === invite.$id}
                onClick={() =>
                  invite.orgId &&
                  review({
                    orgId: invite.orgId,
                    inviteId: invite.$id,
                    decline: true,
                  })
                }
              >
                {'Decline'}
              </Button>
              <Button
                size="small"
                disabled={busyId === invite.$id}
                onClick={() => void respond(invite, 'accept')}
              >
                {busyId === invite.$id ? 'Joining…' : 'Accept'}
              </Button>
            </Stack>
          }
        >
          {inviteSentence(invite)}
        </Alert>
      ))}
    </Stack>
  )
}
OrgInvitesBanner.displayName = 'OrgInvitesBanner'
OrgInvitesBanner.aglyn = true

export default OrgInvitesBanner
