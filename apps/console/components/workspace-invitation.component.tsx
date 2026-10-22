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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useEffect } from 'react'
import { useInviteResponse } from '../hooks/use-invite-response'
import { useInviteReview, type PendingInvite } from '../hooks/use-pending-invites'
import { inviteSentence } from './org-invites-banner.component'

/**
 * A workspace page for a person invited to the workspace whose automatic join
 * was refused (AGL-4023): the invitation itself, in place of the 404 a
 * non-member gets, with the refusal already shown in a snackbar. Accepting
 * here is the same request, so it succeeds once whatever refused it (a full
 * seat quota, say) is resolved.
 *
 * The shell banner steps aside while this is mounted, so the invitation is
 * asked about once.
 */
export function WorkspaceInvitation({ invite }: { invite: PendingInvite }) {
  const { claimInline, review } = useInviteReview()
  const { respond, busyId } = useInviteResponse()
  useEffect(() => claimInline(), [claimInline])
  const busy = busyId === invite.$id
  const name = invite.orgName ?? 'this workspace'

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', px: 2, py: { xs: 3, md: 6 } }}>
      <CardDisplay
        header={`Join ${name}`}
        subheader={inviteSentence(invite)}
        HeaderProps={{
          action: (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() =>
                  invite.orgId &&
                  review({ orgId: invite.orgId, inviteId: invite.$id, decline: true })
                }
              >
                {'Decline'}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={busy}
                onClick={() => void respond(invite, 'accept')}
              >
                {busy ? 'Joining…' : 'Accept'}
              </Button>
            </Stack>
          ),
        }}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Joining did not finish on its own. Accept to try again.'}
        </Typography>
      </CardDisplay>
    </Box>
  )
}
WorkspaceInvitation.displayName = 'WorkspaceInvitation'

export default WorkspaceInvitation
