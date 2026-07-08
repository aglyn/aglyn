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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { useUser } from 'reactfire'

/**
 * Save-as-template (AGL-137): publishes this host's published screens +
 * theme to the community library as a site template (free or paid). The
 * API applies the same sanitizer and gates as component publishing;
 * preview images attach afterwards from Manage → Community.
 */
export function SiteTemplateCard(props: { hostId: string }) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('0')
  const [busy, setBusy] = useState(false)

  const handlePublish = useCallback(async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/publish-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          displayName: name.trim(),
          description: description.trim(),
          category: category.trim(),
          priceUsd: Number(price) || 0,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      setOpen(false)
      enqueueSnackbar(
        `Template published (v${payload.version}) — add a preview image ` +
          'from Manage → Community',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [name, description, category, price, busy, user, hostId, enqueueSnackbar])

  return (
    <CardDisplay header={'Site template'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Publish this site — every published screen plus the theme — ' +
            'as a template others can start from. Re-publishing bumps the ' +
            'version.'}
        </Typography>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => setOpen(true)}
        >
          {'Publish as template'}
        </Button>
      </Stack>
      <Dialog
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Publish as template'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Template name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Category"
              placeholder="Portfolio, Restaurant…"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Price (USD, 0 = free)"
              value={price}
              onChange={(event) =>
                setPrice(event.target.value.replace(/[^0-9]/g, ''))
              }
              size="small"
              sx={{ width: 150 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!name.trim() || busy}
            onClick={handlePublish}
          >
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
SiteTemplateCard.displayName = 'SiteTemplateCard'

export default SiteTemplateCard
