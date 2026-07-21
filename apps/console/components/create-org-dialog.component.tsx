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

import { generateOrgSlug } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

export interface CreateOrgDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Create-an-organization dialog (AGL-621), shared by the org switcher and
 * the org jump page. Posts to /api/orgs/create, then lands in the new
 * workspace by URL — `/[orgSlug]/hosts` on the apex, or the org's own
 * subdomain when workspace subdomains are live.
 */
export function CreateOrgDialog(props: CreateOrgDialogProps) {
  const { open, onClose } = props
  const { data: user } = useUser()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setSlug('')
    setSlugTouched(false)
  }

  const handleCreate = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.orgId) {
        enqueueSnackbar(payload?.error ?? 'Creating the organization failed', {
          variant: response.status === 409 ? 'warning' : 'error',
        })
        return
      }
      enqueueSnackbar(`Created "${name.trim()}"`, { variant: 'success' })
      reset()
      onClose()
      // The server returns the reserved slug — land in the new workspace.
      const createdSlug = payload.slug ?? slug.trim()
      router.push(buildRoute(Route.HOST_LIST, { orgSlug: createdSlug }))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Creating the organization failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{'Create an organization'}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {'Organizations own sites and share media, data, plugins and ' +
            'billing across them. You become the owner.'}
        </Typography>
        <TextField
          label="Organization name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (!slugTouched) setSlug(generateOrgSlug(event.target.value))
          }}
          autoFocus
        />
        <TextField
          label="Workspace URL"
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value.toLowerCase())
            setSlugTouched(true)
          }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">{`.${WORKSPACE_DOMAIN}`}</InputAdornment>
              ),
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !name.trim()}
          onClick={() => void handleCreate()}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CreateOrgDialog.displayName = 'CreateOrgDialog'

export default CreateOrgDialog
