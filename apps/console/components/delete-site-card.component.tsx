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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Stack, TextField, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useHost, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

/**
 * Delete site (AGL-488): site-admin-only. A single site is deleted
 * immediately (no hold) behind a type-the-name confirm plus a dialog; the
 * server route's `eraseHost` cleans up Storage, the routing index, the
 * org's hosts map, and the whole Firestore tree so nothing is orphaned.
 */
export function DeleteSiteCard(props: { hostId: string }) {
  const { hostId } = props
  const { data: user } = useUser()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const {
    doc: { data: host },
  } = useHost({ hostId })
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  const isAdmin =
    (host as any)?.memberRoles?.[(user as any)?.uid] === 'admin'
  const siteName = (host as any)?.displayName || hostId
  // Only site admins can delete; the tab still renders for others without it.
  if (!isAdmin) return null

  const handleDelete = async () => {
    if (busy) return
    const accepted = await confirm({
      title: 'Delete this site?',
      description:
        `"${siteName}" and all of its screens, media, and settings are ` +
        "permanently deleted. This can't be undone.",
      confirmationText: 'Delete site',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.error ?? 'Delete failed')
      }
      enqueueSnackbar(`"${siteName}" deleted`, { variant: 'success' })
      router.push('/hosts')
    } catch (error: any) {
      enqueueSnackbar(error?.message ?? 'Could not delete the site', {
        variant: 'error',
        allowDuplicate: true,
      })
      setBusy(false)
    }
  }

  return (
    <CardDisplay
      header={'Delete site'}
      help={docsHelp('downgradingAndCanceling', {
        anchor: '#deleting-a-single-site',
        excerpt:
          'Deleting a site is immediate and permanent — export a backup ' +
          'first if you might want it back.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Typography variant="body2" color="text.secondary">
          {'Permanently delete this site — its screens, media, and settings. ' +
            'This is immediate and cannot be undone. Export a backup first if ' +
            'you might want it back.'}
        </Typography>
        <TextField
          label={`Type "${siteName}" to confirm`}
          value={confirmText}
          disabled={busy}
          onChange={(event) => setConfirmText(event.target.value)}
          size="small"
        />
        <Button
          color="error"
          variant="contained"
          disabled={busy || confirmText.trim() !== siteName}
          onClick={() => void handleDelete()}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Delete site'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
DeleteSiteCard.displayName = 'DeleteSiteCard'

export default DeleteSiteCard
