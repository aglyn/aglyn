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

import * as Aglyn from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost, useUser } from '@aglyn/tenant-feature-instance'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import MediaFieldSection from './media-field-section.component'
import { FAVICON_HINT } from '../constants/media-size-hints'
import { resyncHostMemberships } from '../utils/resync-host-memberships'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface FaviconCardProps {
  hostId: string
  /** Draw as a section inside the SEO card rather than a card of its own. */
  embedded?: boolean
}

/**
 * Favicon picker (AGL-134): replaces pasting a bare URL — pick (or upload)
 * an .ico/.png in the media browser and the asset URL lands on
 * `seo.favicon`. The URL field in the SEO form still works for external
 * icons; this card just makes the common path one click.
 */
export function FaviconCard(props: FaviconCardProps) {
  const { hostId, embedded } = props
  const { enqueueSnackbar } = useSnackbar()
  const { data: user } = useUser()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const favicon = data?.seo?.favicon
  /**
   * The URL escape hatch this card absorbed from the SEO form (AGL-2486).
   *
   * `seo.favicon` used to have two editors on one tab, and the other one was
   * a bare text box showing `media:org:…` — the stored reference, which is
   * not something anybody can read or type. That box is gone; an externally
   * hosted icon is still legitimate, so the capability lives here instead,
   * below the picker rather than beside it: the library is the common answer
   * and a URL is the exception.
   *
   * Seeded from the stored value only while editing, so it never fights the
   * picker: choosing from the library writes the field and this box reopens
   * from whatever that wrote.
   */
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  /**
   * Resolve before showing (AGL-1407). The stored value has three generations
   * — a raw storage URL, an AGL-175 CDN path, and a `media:` reference — and
   * only the resolver knows all three. This preview and `host-icon` were the
   * two readers that would have shown a broken image the moment the field was
   * converted, which is why `seo.favicon` was held out of the back-fill until
   * both resolved.
   */
  const preview = Aglyn.resolveMediaSrc(favicon, { hostId })

  return (
    <MediaFieldSection
      embedded={embedded}
      header={'Favicon'}
      help={docsHelp('media', {
        excerpt:
          'The small icon browsers show in tabs and bookmarks — pick an ' +
          '.ico or .png from your media library, or paste a URL below.',
      })}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt="Favicon"
            sx={{ width: 32, height: 32, objectFit: 'contain' }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No favicon set'}
          </Typography>
        )}
        <Button
          size="small"
          color="primary"
          onClick={() => setPickerOpen(true)}
        >
          {favicon ? 'Replace from media' : 'Choose from media'}
        </Button>
        {favicon ? (
          <Button
            size="small"
            color="error"
            onClick={() =>
              setDoc({ seo: { favicon: '' } }, { merge: true })
                .then(() => {
                  // Clearing must re-fan too (AGL-1071) — otherwise the
                  // switcher keeps showing the icon the user just removed.
                  resyncHostMemberships(hostId, user as never)
                  enqueueSnackbar('Favicon removed', {
                    variant: 'success',
                    persist: false,
                  })
                })
                .catch(() =>
                  enqueueSnackbar('An error has occurred', {
                    variant: 'error',
                  }),
                )
            }
          >
            {'Remove'}
          </Button>
        ) : null}
      </Stack>
      {/* Said BEFORE the upload, not about the file already chosen. */}
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1 }}
      >
        {FAVICON_HINT}
      </Typography>
      <TextField
        size="small"
        fullWidth
        label="Or paste an icon URL"
        value={urlDraft ?? (typeof favicon === 'string' ? favicon : '')}
        onChange={(event) => setUrlDraft(event.target.value)}
        onBlur={() => {
          if (urlDraft === null) return
          const next = urlDraft.trim()
          setUrlDraft(null)
          if (next === (favicon ?? '')) return
          // `''` and not a missing key: a cleared media value has to REACH
          // Firestore as an empty string or the form stack drops it and the
          // old icon survives the clear (AGL-1191).
          void setDoc({ seo: { favicon: next } }, { merge: true })
            .then(() => {
              resyncHostMemberships(hostId, user as never)
              enqueueSnackbar('Favicon updated', {
                variant: 'success',
                persist: false,
              })
            })
            .catch(() =>
              enqueueSnackbar('An error has occurred', { variant: 'error' }),
            )
        }}
        helperText="An external icon is a legitimate answer — most sites pick from the library above."
        sx={{ mt: 1.5 }}
      />
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          // `mediaNodeSrc`, not `media.url` — the writer the besigner picker,
          // the logo card and the cover picker all use. It mints a `media:`
          // reference when the org is entitled to CDN delivery and falls back
          // to the raw URL when it is not, so the entitlement gate keeps
          // working and picking a favicon stops undoing the AGL-1407
          // conversion the next time someone opens this card.
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          void setDoc({ seo: { favicon: src } }, { merge: true })
            .then(() => {
              // A client write to the host doc bypasses the membership
              // funnel, so the switcher's projection needs a nudge (AGL-1071).
              resyncHostMemberships(hostId, user as never)
              enqueueSnackbar('Favicon saved', {
                variant: 'success',
                persist: false,
              })
            })
            .catch(() =>
              enqueueSnackbar('An error has occurred', { variant: 'error' }),
            )
        }}
      />
    </MediaFieldSection>
  )
}
FaviconCard.displayName = 'FaviconCard'

export default FaviconCard
