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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { APP_ICON_HINT } from '../constants/media-size-hints'
import MediaFieldSection from './media-field-section.component'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface AppIconCardProps {
  hostId: string
  /** Draw as a section inside the SEO card rather than a card of its own. */
  embedded?: boolean
}

/**
 * The square mark a visitor installs to their home screen — `seo.appIcon`,
 * the `icons` entry of the site's `/manifest.webmanifest`.
 *
 * A third picture on a tab that already has two, and the reason it is not one
 * of them is the shape:
 *
 * - the FAVICON is a 16–32px glyph in a browser tab. An installer will take
 *   it, and it has nothing like the resolution an app icon is drawn at;
 * - the SITE LOGO is the lockup — a wordmark on most sites, so a wide
 *   rectangle. The manifest fell back to it for want of anything else, and an
 *   installer that trusted a declared size painted a stretched tile.
 *
 * Unset, the manifest keeps using the logo, so nothing about an existing
 * site's install changes until somebody puts artwork here.
 */
export function AppIconCard(props: AppIconCardProps) {
  const { hostId, embedded } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const appIcon = data?.seo?.appIcon
  /**
   * Resolve before showing (AGL-1407). The stored value has the same three
   * generations every other media field does — a raw storage URL, a relative
   * CDN path and a `media:` reference — and only the resolver knows all three.
   */
  const preview = Aglyn.resolveMediaSrc(appIcon, { hostId })

  const save = (next: string, message: string) =>
    setDoc({ seo: { appIcon: next } }, { merge: true })
      .then(() =>
        enqueueSnackbar(message, { variant: 'success', persist: false }),
      )
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )

  return (
    <MediaFieldSection
      embedded={embedded}
      header={'App icon'}
      help={docsHelp('media', {
        excerpt:
          'The icon shown when someone installs this site to their phone or ' +
          'desktop — a square mark, separate from the tab favicon and the ' +
          'site logo.',
      })}
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt="App icon"
            sx={{
              width: 64,
              height: 64,
              objectFit: 'contain',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No app icon — installing this site uses the site logo, which is ' +
              'usually the wrong shape for a home screen.'}
          </Typography>
        )}
        <Button
          size="small"
          color="primary"
          onClick={() => setPickerOpen(true)}
        >
          {appIcon ? 'Replace from media' : 'Choose from media'}
        </Button>
        {appIcon ? (
          <Button
            size="small"
            color="error"
            // `''`, not a missing key: a merge write ignores absent fields, so
            // "no icon" has to be a value that is actually sent (AGL-1191).
            onClick={() => void save('', 'App icon removed')}
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
        {APP_ICON_HINT}
      </Typography>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          // `mediaNodeSrc`, the writer every other picker on this tab uses: it
          // mints a `media:` reference when the org is entitled to CDN
          // delivery and falls back to the raw URL when it is not, so the
          // entitlement gate keeps working and a folder move never 404s the
          // icon a site is installed with.
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          void save(src, 'App icon saved')
        }}
      />
    </MediaFieldSection>
  )
}
AppIconCard.displayName = 'AppIconCard'

export default AppIconCard
