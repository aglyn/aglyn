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
import { useUser } from '@aglyn/tenant-feature-instance'
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
import { useCallback, useEffect, useState } from 'react'

export interface PublishArtifactTarget {
  /** Plugin API path, e.g. `marketplace/publish-layout`. */
  endpoint: string
  /** Extra body fields identifying what is being published. */
  payload: Record<string, unknown>
  /** Seeds the name field. */
  displayName?: string
  description?: string
  /** Noun used in copy: "layout", "component", … */
  noun: string
  categoryPlaceholder?: string
}

/**
 * Publish an artifact to the marketplace (AGL-672).
 *
 * The publish form is identical across artifact types — name, description,
 * category, price — and only the endpoint and identifying fields differ, so
 * this takes both rather than being copied per type. Every gate that
 * matters (plan, publisher profile, payouts, host role) lives on the server;
 * this surfaces the server's message rather than trying to predict it.
 */
export function PublishArtifactDialog({
  target,
  onClose,
  onPublished,
}: {
  /** Null closes the dialog. */
  target: PublishArtifactTarget | null
  onClose: () => void
  onPublished?: (result: { listingId: string; version: number }) => void
}) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) return
    setName(target.displayName ?? '')
    setDescription(target.description ?? '')
    setCategory('')
    setPrice('')
  }, [target])

  const handlePublish = useCallback(async () => {
    if (!target || !name.trim() || busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(`/api/${target.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          ...target.payload,
          displayName: name.trim(),
          description: description.trim(),
          category: category.trim(),
          priceUsd: Number(price) || 0,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // 412 means a setup step is missing (publisher profile, payouts) —
        // actionable, so it reads as a warning rather than an error.
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 412 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(`Published v${payload.version} to the marketplace`, {
        variant: 'success',
        persist: false,
      })
      onPublished?.(payload)
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    target,
    name,
    description,
    category,
    price,
    busy,
    user,
    enqueueSnackbar,
    onPublished,
    onClose,
  ])

  return (
    <Dialog
      open={!!target}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{`Publish ${target?.noun ?? 'artifact'}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {`Publishes the current published version of this ` +
              `${target?.noun ?? 'artifact'} so other organizations can ` +
              'install it. Your site is unaffected.'}
          </Typography>
          <TextField
            autoFocus
            size="small"
            label="Listing name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            fullWidth
          />
          <TextField
            size="small"
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            size="small"
            label="Category"
            placeholder={target?.categoryPlaceholder ?? 'e.g. Marketing, Docs'}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={busy}
            fullWidth
          />
          <TextField
            size="small"
            label="Price (USD)"
            placeholder="0 = free"
            helperText="Paid listings need payouts set up on your marketplace profile"
            value={price}
            onChange={(event) =>
              setPrice(event.target.value.replace(/[^0-9]/g, ''))
            }
            disabled={busy}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color="primary"
          disabled={busy || !name.trim()}
          onClick={() => void handlePublish()}
        >
          {busy ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

PublishArtifactDialog.displayName = 'PublishArtifactDialog'

export default PublishArtifactDialog
