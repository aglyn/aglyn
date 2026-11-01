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
// The stored preview may be a `media:` reference (AGL-1424), which is not a
// URL. Resolved where it is DISPLAYED, never in `values`.
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { inheritedMediaAlt } from '@aglyn/aglyn/app-utils/media-metadata'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
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
import { LISTING_LOGO_HINT } from '../constants/listing-media'
import { formatMediaRef, pluginDocsHelp, useMediaPicker } from '@aglyn/aglyn'
import {
  MarkdownField,
  type MarkdownFieldHandle,
} from '@aglyn/aglyn-markdown-editor'
import {
  PublisherAgreementCheckbox,
  usePublisherAgreementConsent,
} from './publisher-agreement-checkbox.component'

// The plugin taxonomy the server validates `categories` against, from the one
// list it is defined in (the editor lives in the plugin it belongs to now).
import { LISTING_CATEGORIES } from '../model/marketplace-catalog'
import { listingArtifactType } from '../model/listing-visibility'
import { siteStarterCategoryOptions } from '../model/starter-category'
import { SITE_STARTER_ARTIFACT_TYPE } from '@aglyn/aglyn/app-utils/site-starter'

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
  // The publisher agreement, agreed to on this save (AGL-4105).
  const agreement = usePublisherAgreementConsent()

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
  /*
   * A site starter is filed under the kind of site it is (AGL-4049), in its
   * own `category`, from the style names; every other listing under the
   * plugin taxonomy, in `categories`. The menu keeps a starter's stored
   * category when it is not a kind, so it never opens on a value it lacks.
   */
  const isStarter = listingArtifactType(listing ?? {}) === SITE_STARTER_ARTIFACT_TYPE
  const categoryOptions: readonly string[] = isStarter
    ? siteStarterCategoryOptions(listing?.category)
    : LISTING_CATEGORIES

  useEffect(() => {
    setValues({
      displayName: listing?.displayName ?? '',
      description: listing?.description ?? '',
      previewImageUrl: listing?.previewImageUrl ?? '',
      logoUrl: listing?.logoUrl ?? '',
      homepageUrl: listing?.homepageUrl ?? '',
      repositoryUrl: listing?.repositoryUrl ?? '',
      license: listing?.license ?? '',
      category:
        listingArtifactType(listing ?? {}) === SITE_STARTER_ARTIFACT_TYPE
          ? String(listing?.category ?? '').trim()
          : (listing?.categories?.[0] ?? listing?.category ?? ''),
    })
    setReadme(listing?.readme ?? '')
    setScreenshots(
      Array.isArray(listing?.screenshots) ? listing.screenshots : [],
    )
    originalPreview.current = listing?.previewImageUrl ?? ''
  }, [listing?.$id])

  const set = (key: keyof typeof values) => (event: any) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  /*
   * The console's media library, opened through the picker context rather
   * than by mounting its dialog (AGL-3080). The library is coupled to the
   * org and the session, which a plugin has no way to reach, and the console
   * provides `pickMedia` around every plugin page for exactly this — so the
   * `pickTarget` state that only existed to keep one dialog open for four
   * buttons goes with it: the target is now the argument.
   *
   * The URL comes back already resolved (CDN path over the raw download URL,
   * AGL-1215), which is what `mediaSrc` was doing here.
   */
  const { pickMedia } = useMediaPicker()
  const onPickMedia = async (target: Exclude<PickTarget, null>) => {
    const media = await pickMedia?.({ kind: 'image' })
    if (!media) return
    const url = media.url
    if (!url) return
    if (target === 'preview') setValues((c) => ({ ...c, previewImageUrl: url }))
    else if (target === 'logo') setValues((c) => ({ ...c, logoUrl: url }))
    else if (target === 'body') {
      // The README BODY takes a reference; the three image FIELDS above keep
      // `mediaSrc` (AGL-1705). Not an inconsistency — a field is one string
      // with known readers and its own AGL-1701 validator, while the body is
      // markdown that AGL-1686 taught every renderer to resolve.
      //
      // The absolute form was justified by `mediaSrc`'s own docstring — it
      // prefixes the origin because the markdown "renders elsewhere". That
      // was checked rather than assumed, and it is not true. The renderer
      // `MarketplaceListingContent` is registered through
      // `registerConsoleExtension`; its `marketplaceListing` slot has exactly
      // one render site, the console's `/[orgSlug]/marketplace/[listingId]`
      // route; and `apps/tenant` never imports the marketplace plugin at all.
      // The body reaches no other origin by another door either — the social
      // card builds `og:image` from `previewImageUrl`/`logoUrl`, never from
      // the README.
      //
      // So a site-relative resolve lands on the console origin, which serves
      // `/api/media/cdn/[...path]` — the very route the absolute URL pointed
      // at. Same bytes over the same route, minus a baked-in origin and a
      // baked-in route shape that cannot be changed without a migration.
      const src = formatMediaRef(media.mediaScope, media.mediaId) ?? url
      // The alt was a hardcoded '' (AGL-1896). This surface offers no alt
      // prompt at all, so the asset's own alt was the only description that
      // could ever have reached the row — and a markdown-lite image row's
      // alt cannot be edited after insertion, so '' was permanent. Still ''
      // for an asset nobody has described; never a fabricated one.
      editorRef.current?.insertImage(
        inheritedMediaAlt({ assetAlt: media.alt }) ?? '',
        src,
      )
    } else if (target === 'screenshot')
      setScreenshots((current) =>
        current.length >= MAX_SCREENSHOTS || current.includes(url)
          ? current
          : [...current, url],
      )
  }

  const save = async () => {
    if (!agreement.consent) return
    setBusy(true)
    try {
      const headers = { 'Content-Type': 'application/json' }
      // Preview image isn't a content field, so it has its own endpoint
      // (AGL-863). Only touch it when it actually changed. Both requests carry
      // the one agreement this save was made with (AGL-4105), and a refused
      // preview stops the save rather than saving the rest without it.
      if (values.previewImageUrl !== originalPreview.current) {
        const preview = await authorizedFetch(user, '/api/marketplace/preview-image', {
          method: values.previewImageUrl ? 'POST' : 'DELETE',
          headers,
          body: JSON.stringify({
            listingId,
            ...(values.previewImageUrl ? { url: values.previewImageUrl } : {}),
            agreement: agreement.consent,
          }),
        })
        if (!preview.ok) {
          const refused = await preview.json().catch(() => ({}))
          return void enqueueSnackbar(refused?.error ?? 'Update failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        originalPreview.current = values.previewImageUrl
      }
      const response = await authorizedFetch(
        user,
        '/api/marketplace/publish-plugin',
        {
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
            ...(isStarter
              ? { category: values.category }
              : { categories: values.category ? [values.category] : [] }),
            screenshots,
            agreement: agreement.consent,
          }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Listing updated', { variant: 'success', persist: false })
      // Each save is its own agreement: the next one ticks the box again.
      agreement.reset()
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
      help={pluginDocsHelp('publisherHandbook', { anchor: '#edit-listing' })}
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
          {/* Resolved for DISPLAY only (AGL-1424). `values.previewImageUrl`
              stays the stored form — it is what the save POSTs, and writing
              the resolved URL back would undo the reference. */}
          {resolveMediaSrc(values.previewImageUrl) ? (
            <Box
              component="img"
              src={resolveMediaSrc(values.previewImageUrl)}
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
            <Button size="small" onClick={() => onPickMedia('preview')}>
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
          onPickImageFromMedia={() => onPickMedia('body')}
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
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
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
              <Button size="small" onClick={() => onPickMedia('screenshot')}>
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
            helperText={LISTING_LOGO_HINT}
          />
          <Button
            size="small"
            onClick={() => onPickMedia('logo')}
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
            {categoryOptions.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {entry}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {/* Directly above Save listing (AGL-4105), which waits for it. */}
        <PublisherAgreementCheckbox
          checked={agreement.agreed}
          onChange={agreement.setAgreed}
          disabled={busy}
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color="primary"
            disabled={busy || !values.displayName.trim() || !agreement.agreed}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save listing'}
          </Button>
          <Button disabled={busy} onClick={onDone}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>

    </CardDisplay>
  )
}

ListingDetailEditor.displayName = 'ListingDetailEditor'

export default ListingDetailEditor
