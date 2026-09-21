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

import {
  isBelowMarketplacePriceFloor,
  marketplacePriceCostNote,
  marketplacePriceFloorHint,
} from '@aglyn/aglyn'
import type {
  ConsoleArtifactPublishZoneProps,
  ConsolePublishableArtifact,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
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
import { useCallback, useEffect, useMemo, useState } from 'react'

/** One kind's publish route, and the words a person reads about it. */
interface PublishRequest {
  /** Plugin API path, e.g. `marketplace/publish-layout`. */
  endpoint: string
  /** Extra body fields identifying what is being published. */
  payload: Record<string, unknown>
  /** Noun used in copy: "layout", "component", … */
  noun: string
  categoryPlaceholder?: string
}

/**
 * WHERE EACH KIND GOES, which is the knowledge that used to sit in the app
 * (AGL-3080).
 *
 * A console page hands over what it has — a kind, the scope holding it, the
 * document — and this is the only place that turns it into a request. The
 * pages that offer publishing named the endpoint, the payload key and the
 * noun themselves, which made them files that could not compile without a
 * marketplace and could not be right without being kept in step with one.
 *
 * ⚠️ A KIND THIS DOES NOT KNOW IS SAID OUT LOUD, not drawn as nothing. It
 * means a console offering to publish something this marketplace does not
 * sell — the two lists have gone out of step — and the person has already
 * clicked. Drawing nothing would make the control look broken with no way to
 * tell what happened, and guessing an endpoint from the kind would post to a
 * route that does not exist and report the 404 to the publisher.
 *
 * The control itself is a separate matter: a page only offers the publish
 * when this zone has a widget at all, so a workspace with no marketplace
 * never gets here.
 */
function publishRequestFor(
  artifact: ConsolePublishableArtifact,
): PublishRequest | null {
  const hostId = artifact.hostId ?? ''
  const orgId = artifact.orgId ?? ''
  const artifactId = artifact.artifactId ?? ''
  switch (artifact.kind) {
    case 'layout':
      return {
        endpoint: 'marketplace/publish-layout',
        payload: { hostId, layoutId: artifactId },
        noun: 'layout',
        categoryPlaceholder: 'e.g. Marketing, Docs, Storefront',
      }
    case 'component':
      return {
        endpoint: 'marketplace/publish',
        payload: { hostId, componentId: artifactId },
        noun: 'component',
      }
    case 'site':
      return {
        endpoint: 'marketplace/publish-template',
        payload: { hostId },
        noun: 'site template',
      }
    case 'theme':
      return {
        endpoint: 'marketplace/publish-theme',
        payload: { hostId },
        noun: 'theme',
      }
    // Datasets are org-scoped, so this route takes orgId rather than hostId.
    case 'datasetSchema':
      return {
        endpoint: 'marketplace/publish-dataset-schema',
        payload: { orgId, datasetId: artifactId },
        noun: 'dataset schema',
      }
    case 'emailTemplate':
      return {
        endpoint: 'marketplace/publish-email-template',
        payload: { hostId, templateKey: artifactId },
        noun: 'email template',
      }
    case 'emailStarter':
      return {
        endpoint: 'marketplace/publish-email-starter',
        payload: { hostId, screenId: artifactId },
        noun: 'email starter',
      }
    default:
      return null
  }
}

/**
 * Publish an artifact to the marketplace (AGL-672, moved out of the console
 * app by AGL-3080).
 *
 * The publish form is identical across artifact types — name, description,
 * category, price — and only the endpoint and identifying fields differ, so
 * this takes both rather than being copied per type. Every gate that
 * matters (plan, publisher profile, payouts, host role) lives on the server;
 * this surfaces the server's message rather than trying to predict it.
 *
 * Drawn through the `hostArtifactPublish` zone, so the page that offers the
 * publish keeps the control that opens it and never imports this. A page
 * with no widget on that zone leaves the offer out entirely, which is why
 * this may safely draw nothing for a kind it does not sell.
 */
export function PublishArtifactDialog({
  artifact,
  onClose,
}: ConsoleArtifactPublishZoneProps) {
  // Memoized because it is a dependency of the publish callback: rebuilt
  // every render, it would rebuild that callback every render too.
  const target = useMemo(
    () => (artifact ? publishRequestFor(artifact) : null),
    [artifact],
  )
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!artifact) return
    setName(artifact.displayName ?? '')
    setDescription(artifact.description ?? '')
    setCategory('')
    setPrice('')
  }, [artifact])

  const handlePublish = useCallback(async () => {
    if (!target || !name.trim() || busy) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, `/api/${target.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    onClose,
  ])

  if (artifact && !target) {
    return (
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>{'Nothing publishes this'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {`This marketplace does not publish a ${artifact.kind}, so there ` +
              'is nowhere to send it. Nothing was changed.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={onClose}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

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
            // The minimum price (AGL-2343). Marketplace checkout is a
            // destination charge, so Stripe's fee comes out of the PLATFORM's
            // balance while the seller is transferred a fixed share — at $1 the
            // fee is larger than the whole platform cut. The publish route
            // refuses anything under the floor, so the field says so before the
            // publisher gets there and the button holds.
            error={isBelowMarketplacePriceFloor(price)}
            helperText={
              marketplacePriceCostNote(price) ??
              marketplacePriceFloorHint(
                'Paid listings need payouts set up on your marketplace profile.',
              )
            }
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
          disabled={busy || !name.trim() || isBelowMarketplacePriceFloor(price)}
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
