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
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { docsHelp } from '../../constants/docs-links'
import MarkdownField, {
  type MarkdownFieldHandle,
} from '../markdown-field.component'
import MediaPickerDialog from '../media/media-picker-dialog.component'
import mediaSrc from '../../utils/media-src'

// Mirrors the server's fixed taxonomy (marketplace plugin model), which the
// console can't import across the aglyn:addons boundary. The server
// re-validates, so drift fails the save rather than corrupting a listing.
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

/** Which image field / target the DAM picker is currently filling. */
type PickTarget = 'preview' | 'logo' | 'screenshot' | 'body' | null

export interface ListingDetailEditorProps {
  orgId: string
  listingId: string
  listing: Record<string, any>
  /** Firebase user, for the ID token on the update requests. */
  user: unknown
  /** Leave edit mode (Cancel or after a successful save). */
  onDone: () => void
}

/**
 * Full-page listing editor (AGL-869): the owner edits the whole detail page,
 * not a cramped sidebar card. The body uses the same WYSIWYG markdown editor
 * as blog content (`MarkdownVisualEditor`), and every image — preview, logo,
 * screenshots, and inline body images — picks from the shared DAM.
 *
 * Content saves through the marketplace plugin's HTTP API (`update-listing`);
 * the preview image goes through its dedicated endpoint since it isn't a
 * content field. Both are merges, so an unchanged field is left untouched.
 */
export function ListingDetailEditor(props: ListingDetailEditorProps) {
  const { orgId, listingId, listing, user, onDone } = props
  const { enqueueSnackbar } = useSnackbar()
  const editorRef = useRef<MarkdownFieldHandle | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickTarget, setPickTarget] = useState<PickTarget>(null)

  const [values, setValues] = useState({
    displayName: '',
    description: '',
    previewImageUrl: '',
    logoUrl: '',
    homepageUrl: '',
    repositoryUrl: '',
    license: '',
    category: '',
  })
  const [readme, setReadme] = useState('')
  const [screenshots, setScreenshots] = useState<string[]>([])
  const originalPreview = useRef<string>('')

  useEffect(() => {
    setValues({
      displayName: listing?.displayName ?? '',
      description: listing?.description ?? '',
      previewImageUrl: listing?.previewImageUrl ?? '',
      logoUrl: listing?.logoUrl ?? '',
      homepageUrl: listing?.homepageUrl ?? '',
      repositoryUrl: listing?.repositoryUrl ?? '',
      license: listing?.license ?? '',
      category: listing?.categories?.[0] ?? listing?.category ?? '',
    })
    setReadme(listing?.readme ?? '')
    setScreenshots(
      Array.isArray(listing?.screenshots) ? listing.screenshots : [],
    )
    originalPreview.current = listing?.previewImageUrl ?? ''
  }, [listing?.$id])

  const set = (key: keyof typeof values) => (event: any) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  const onPickMedia = (media: { url?: string; cdnPath?: string }) => {
    const url = mediaSrc(media)
    const target = pickTarget
    setPickTarget(null)
    if (!url) return
    if (target === 'preview') setValues((c) => ({ ...c, previewImageUrl: url }))
    else if (target === 'logo') setValues((c) => ({ ...c, logoUrl: url }))
    else if (target === 'body') editorRef.current?.insertImage('', url)
    else if (target === 'screenshot')
      setScreenshots((current) =>
        current.length >= MAX_SCREENSHOTS || current.includes(url)
          ? current
          : [...current, url],
      )
  }

  const idToken = async () =>
    (user as { getIdToken?: () => Promise<string> })?.getIdToken?.()

  const save = async () => {
    setBusy(true)
    try {
      const token = await idToken()
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }
      // Preview image isn't a content field, so it has its own endpoint
      // (AGL-863). Only touch it when it actually changed.
      if (values.previewImageUrl !== originalPreview.current) {
        await fetch('/api/marketplace/preview-image', {
          method: values.previewImageUrl ? 'POST' : 'DELETE',
          headers,
          body: JSON.stringify({
            listingId,
            ...(values.previewImageUrl ? { url: values.previewImageUrl } : {}),
          }),
        })
      }
      const response = await fetch('/api/marketplace/publish-plugin', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update-listing',
          listingId,
          displayName: values.displayName,
          description: values.description,
          readme,
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
      onDone()
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
    <CardDisplay
      header={'Edit listing'}
      help={docsHelp('publisherHandbook', {
        anchor: '#authoring-your-listing',
        excerpt:
          'What buyers see on the public listing page — name, summary, ' +
          'rich-text body, and media.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Everything here shows on the public listing page. The body is ' +
            'rich text — use the toolbar, and add images from your media ' +
            'library.'}
        </Typography>

        <TextField
          label="Listing name"
          value={values.displayName}
          onChange={set('displayName')}
          size="small"
          fullWidth
        />
        <TextField
          label="Description"
          helperText="One line, shown on every browse card"
          value={values.description}
          onChange={set('description')}
          size="small"
          multiline
          minRows={2}
          fullWidth
        />

        {/* Preview image — the hero shown on cards and at the top of detail. */}
        <Stack spacing={1}>
          <Typography variant="subtitle2">{'Preview image'}</Typography>
          {values.previewImageUrl ? (
            <Box
              component="img"
              src={values.previewImageUrl}
              alt="Preview"
              sx={{
                width: '100%',
                maxHeight: 220,
                objectFit: 'cover',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
              }}
            />
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => setPickTarget('preview')}>
              {values.previewImageUrl ? 'Replace' : 'Choose from library'}
            </Button>
            {values.previewImageUrl ? (
              <Button
                size="small"
                color="error"
                onClick={() =>
                  setValues((c) => ({ ...c, previewImageUrl: '' }))
                }
              >
                {'Remove'}
              </Button>
            ) : null}
          </Stack>
        </Stack>

        <Divider />

        {/* Body — the WYSIWYG markdown editor, same as blog content, and
            since AGL-1080 the same component the publish form uses. */}
        <MarkdownField
          label="About"
          value={readme}
          onChange={setReadme}
          onPickImageFromMedia={() => setPickTarget('body')}
          editorRef={(handle) => {
            editorRef.current = handle
          }}
        />

        <Divider />

        {/* Screenshots gallery. */}
        <Stack spacing={1}>
          <Typography variant="subtitle2">
            {`Screenshots (${screenshots.length}/${MAX_SCREENSHOTS})`}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {screenshots.map((url, index) => (
              <Box key={url} sx={{ position: 'relative' }}>
                <Box
                  component="img"
                  src={url}
                  alt={`Screenshot ${index + 1}`}
                  sx={{
                    height: 72,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                />
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    setScreenshots((current) =>
                      current.filter((entry) => entry !== url),
                    )
                  }
                >
                  {'Remove'}
                </Button>
              </Box>
            ))}
          </Stack>
          {screenshots.length < MAX_SCREENSHOTS ? (
            <Box>
              <Button size="small" onClick={() => setPickTarget('screenshot')}>
                {'Add from library'}
              </Button>
            </Box>
          ) : null}
        </Stack>

        <Divider />

        {/* Logo + metadata. */}
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
            {'Library'}
          </Button>
        </Stack>
        <TextField
          label="Homepage (https)"
          value={values.homepageUrl}
          onChange={set('homepageUrl')}
          size="small"
          fullWidth
        />
        <TextField
          label="Repository (https)"
          value={values.repositoryUrl}
          onChange={set('repositoryUrl')}
          size="small"
          fullWidth
        />
        <Stack direction="row" spacing={1}>
          <TextField
            label="License"
            value={values.license}
            onChange={set('license')}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            select
            label="Category"
            value={values.category}
            onChange={set('category')}
            size="small"
            sx={{ flex: 1 }}
          >
            <MenuItem value="">{'None'}</MenuItem>
            {LISTING_CATEGORIES.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {entry}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
          <Button
            variant="contained"
            color="secondary"
            disabled={busy || !values.displayName.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save listing'}
          </Button>
          <Button disabled={busy} onClick={onDone}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>

      {/* One DAM dialog for every image target; onPickMedia routes the pick
          to the right field (or inserts it into the body editor). */}
      <MediaPickerDialog
        orgId={orgId}
        open={pickTarget !== null}
        onClose={() => setPickTarget(null)}
        onPick={onPickMedia}
      />
    </CardDisplay>
  )
}

ListingDetailEditor.displayName = 'ListingDetailEditor'

export default ListingDetailEditor
