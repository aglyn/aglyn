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
import { Box, Typography } from '@mui/material'
import type { PendingInvite } from '../hooks/use-pending-invites'

/**
 * A workspace page for a person invited to the workspace whose join could
 * not finish (AGL-4023), in place of the 404 a non-member gets.
 *
 * It says nothing about why and asks nothing of them: whatever stopped the
 * join (a seat removed after the invitation went out, say) is the sender's
 * to fix, and the sender has been told. Their next visit joins them.
 */
export function WorkspaceAccessPending({ invite }: { invite: PendingInvite }) {
  const name = invite.orgName ?? 'this workspace'
  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', px: 2, py: { xs: 3, md: 6 } }}>
      <CardDisplay
        header={`Your access to ${name} is almost ready`}
        subheader={'You have been invited, and nothing is needed from you.'}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {`${name}'s admins have been asked to finish setting up your access. ` +
            'This page opens the next time you visit once they have.'}
        </Typography>
      </CardDisplay>
    </Box>
  )
}
WorkspaceAccessPending.displayName = 'WorkspaceAccessPending'

export default WorkspaceAccessPending
