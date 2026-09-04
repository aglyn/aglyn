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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import { useOrgScope } from '../../hooks/use-org-scope'
import useOrgMemberOptions from '../../hooks/use-org-member-options'
import useOrgSettingsRequest from '../../hooks/use-org-settings-request'

/**
 * Ownership transfer — owner-only, and irreversible by the person doing it.
 *
 * Extracted from the settings page when its sections became routes (AGL-2501).
 */
export function OrgOwnershipCard() {
  const { currentOrg } = useOrgScope()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const settingsRequest = useOrgSettingsRequest()
  const [busy, setBusy] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')
  const members = useOrgMemberOptions(currentOrg?.role === 'owner')
  const handleTransfer = async () => {
    if (!currentOrg || !transferTarget || busy) return
    const target = members.find((member) => member.$id === transferTarget)
    const accepted = await confirm({
      title: 'Transfer ownership?',
      description:
        `${target?.email ?? transferTarget} becomes the organization ` +
        'owner (billing, workspace URL, and ownership transfers). You ' +
        'step down to admin. This cannot be undone by you afterwards.',
      confirmationText: 'Transfer ownership',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      await settingsRequest({
        action: 'transfer-ownership',
        targetUid: transferTarget,
      })
      enqueueSnackbar('Ownership transferred — you are now an admin', {
        variant: 'success',
      })
      setTransferTarget('')
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Transfer failed', {
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
<CardDisplay
  header={'Transfer ownership'}
  help={docsHelp('team', {
    anchor: '#team-roles',
    excerpt:
      'Only the owner can transfer ownership. The new owner ' +
      'gains billing, workspace-URL, and transfer powers; you ' +
      'step down to admin.',
  })}
  contentGutterX
  contentGutterY
>
  <Stack spacing={2} sx={{ maxWidth: 480 }}>
    <Typography variant="body2" color="text.secondary">
      {'Hand the organization to another member. They gain ' +
        'billing, workspace-URL and transfer powers; you step ' +
        'down to admin.'}
    </Typography>
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start' }}
    >
      <TextField
        select
        label="New owner"
        value={transferTarget}
        disabled={busy}
        onChange={(event) =>
          setTransferTarget(event.target.value)
        }
        sx={{ flexGrow: 1 }}
        helperText={
          members.length <= 1
            ? 'Invite a member from the Team page first.'
            : ''
        }
      >
        {members
          .filter((member) => member.$id !== (user as any)?.uid)
          .map((member) => (
            <MenuItem key={member.$id} value={member.$id}>
              {member.email ?? member.displayName ?? member.$id}
            </MenuItem>
          ))}
      </TextField>
      <Button
        color="error"
        variant="outlined"
        disabled={busy || !transferTarget}
        onClick={() => void handleTransfer()}
        sx={{ mt: 1 }}
      >
        {'Transfer'}
      </Button>
    </Stack>
  </Stack>
</CardDisplay>
  )
}
OrgOwnershipCard.displayName = 'OrgOwnershipCard'

export default OrgOwnershipCard
