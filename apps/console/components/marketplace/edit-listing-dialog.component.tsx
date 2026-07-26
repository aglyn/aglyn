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
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import MediaPickerDialog from '../media/media-picker-dialog.component'

// Mirrors the server's fixed taxonomy (model/community.ts LISTING_CATEGORIES /
// LISTING_MAX_SCREENSHOTS). The console can't import the `aglyn:addons`-tagged
// community plugin — it reaches it only through widget slots and its HTTP API —
// so these are re-declared here. The server re-validates against its own copy,
// so any drift fails the save rather than corrupting a listing.
const LISTING_CATEGORIES = [
  'analytics',
  'automation',
  'commerce',
  'communication',
  'content',
  'design',
  'forms',
  'integrations',
  'marketing',
  'productivity',
  'seo',
  'security',
] as const
const MAX_SCREENSHOTS = 6

/** The DAM-picker target — which image field the media dialog is filling. */
type PickTarget = 'logo' | 'screenshot' | null

function mediaSrc(media: { url?: string; cdnPath?: string }): string {
  if (media.url) return media.url
  if (media.cdnPath)
    return typeof window === 'undefined'
      ? media.cdnPath
      : `${window.location.origin}${media.cdnPath}`
  return ''
}

export interface EditListingDialogProps {
  orgId: string
  /** The listing being edited (a `communityListings` doc with `$id`). */
  listing: Record<string, any> | null
  open: boolean
  onClose: () => void
  /** Firebase user, for the ID token on the update request. */
  user: unknown
}

/**
 * Full listing content editor (AGL-862), reachable from Your Listings so a
 * publisher can update a listing without hunting for it in Browse. Posts the
 * same `update-listing` action the detail-page editor uses, so both surfaces
 * share one server path. Images (logo, screenshots) pick from the shared DAM
 * (AGL-863); a plain https URL can still be pasted as a fallback.
 *
 * A merge update: cleared optional fields are ignored server-side rather than
 * removed (parity with the detail-page editor) — clearing is a separate follow
 * up, not silently lossy here.
 */
export function EditListingDialog(props: EditListingDialogProps) {
  const { orgId, listing, open, onClose, user } = props
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [pickTarget, setPickTarget] = useState<PickTarget>(null)
  const [values, setValues] = useState({
    displayName: '',
    description: '',
    readme: '',
    logoUrl: '',
    homepageUrl: '',
    repositoryUrl: '',
    license: '',
    category: '',
  })
  const [screenshots, setScreenshots] = useState<string[]>([])
  const [screenshotDraft, setScreenshotDraft] = useState('')

  useEffect(() => {
    setValues({
      displayName: listing?.displayName ?? '',
      description: listing?.description ?? '',
      readme: listing?.readme ?? '',
      logoUrl: listing?.logoUrl ?? '',
      homepageUrl: listing?.homepageUrl ?? '',
      repositoryUrl: listing?.repositoryUrl ?? '',
      license: listing?.license ?? '',
      category: listing?.categories?.[0] ?? listing?.category ?? '',
    })
    setScreenshots(Array.isArray(listing?.screenshots) ? listing.screenshots : [])
    setScreenshotDraft('')
  }, [listing?.$id, open])

  const set = (key: keyof typeof values) => (event: any) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  const onPickMedia = (media: { url?: string; cdnPath?: string }) => {
    const url = mediaSrc(media)
    const target = pickTarget
    setPickTarget(null)
    if (!url) return
    if (target === 'logo') {
      setValues((current) => ({ ...current, logoUrl: url }))
    } else if (target === 'screenshot') {
      setScreenshots((current) =>
        current.length >= MAX_SCREENSHOTS || current.includes(url)
          ? current
          : [...current, url],
      )
    }
  }

  const addScreenshotUrl = () => {
    const url = screenshotDraft.trim()
    if (!url) return
    setScreenshots((current) =>
      current.length >= MAX_SCREENSHOTS || current.includes(url)
        ? current
        : [...current, url],
    )
    setScreenshotDraft('')
  }

  const save = async () => {
    if (!listing?.$id) return
    setBusy(true)
    try {
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const response = await fetch('/api/community/publish-plugin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'update-listing',
          listingId: listing.$id,
          displayName: values.displayName,
          description: values.description,
          readme: values.readme,
          logoUrl: values.logoUrl,
          homepageUrl: values.homepageUrl,
          repositoryUrl: values.repositoryUrl,
          license: values.license,
          categories: values.category ? [values.category] : [],
          screenshots,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Listing updated', { variant: 'success', persist: false })
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
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Edit listing'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {'Shown on this listing’s marketplace page. Markdown is supported ' +
              'in the body (headings, lists, links, images).'}
          </Typography>
          <TextField
            label="Listing name"
            value={values.displayName}
            onChange={set('displayName')}
            size="small"
          />
          <TextField
            label="Description"
            helperText="One line, shown on every browse card"
            multiline
            minRows={2}
            value={values.description}
            onChange={set('description')}
            size="small"
          />
          <TextField
            label="Body (markdown)"
            multiline
            minRows={5}
            value={values.readme}
            onChange={set('readme')}
          />

          {/* Logo — DAM-backed, with a paste-a-URL fallback (AGL-862/863). */}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              label="Logo URL (https)"
              value={values.logoUrl}
              onChange={set('logoUrl')}
              size="small"
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              onClick={() => setPickTarget('logo')}
              sx={{ mt: 0.5 }}
            >
              {'Choose from library'}
            </Button>
          </Stack>

          {/* Screenshots — add from the DAM or by URL, up to the cap. */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {`Screenshots (${screenshots.length}/${MAX_SCREENSHOTS})`}
            </Typography>
            {screenshots.map((url, index) => (
              <Stack
                key={url}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center' }}
              >
                <Box
                  component="img"
                  src={url}
                  alt={`Screenshot ${index + 1}`}
                  sx={{
                    width: 56,
                    height: 40,
                    objectFit: 'cover',
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                />
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                  {url}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Remove screenshot"
                  onClick={() =>
                    setScreenshots((current) =>
                      current.filter((entry) => entry !== url),
                    )
                  }
                >
                  {'✕'}
                </IconButton>
              </Stack>
            ))}
            {screenshots.length < MAX_SCREENSHOTS ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  label="Screenshot URL (https)"
                  value={screenshotDraft}
                  onChange={(event) => setScreenshotDraft(event.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Button size="small" onClick={addScreenshotUrl}>
                  {'Add URL'}
                </Button>
                <Button size="small" onClick={() => setPickTarget('screenshot')}>
                  {'Library'}
                </Button>
              </Stack>
            ) : null}
          </Stack>

          <TextField
            label="Homepage (https)"
            value={values.homepageUrl}
            onChange={set('homepageUrl')}
            size="small"
          />
          <TextField
            label="Repository (https)"
            value={values.repositoryUrl}
            onChange={set('repositoryUrl')}
            size="small"
          />
          <TextField
            label="License"
            value={values.license}
            onChange={set('license')}
            size="small"
          />
          <TextField
            select
            label="Category"
            value={values.category}
            onChange={set('category')}
            size="small"
          >
            <MenuItem value="">{'None'}</MenuItem>
            {LISTING_CATEGORIES.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {entry}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => void save()}
          disabled={busy || !values.displayName.trim()}
        >
          {busy ? 'Saving…' : 'Save listing'}
        </Button>
      </DialogActions>

      {/* Nested media dialog for logo/screenshot picks. */}
      <MediaPickerDialog
        orgId={orgId}
        open={pickTarget !== null}
        onClose={() => setPickTarget(null)}
        onPick={onPickMedia}
      />
    </Dialog>
  )
}

EditListingDialog.displayName = 'EditListingDialog'

export default EditListingDialog
