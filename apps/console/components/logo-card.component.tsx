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
import { useHost } from '@aglyn/tenant-feature-instance'
import { Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface LogoCardProps {
  hostId: string
}

/**
 * Site logo picker (AGL-594): pick (or upload) the site's brand mark in
 * the media browser and the asset URL lands on the host's `logoUrl`.
 * The tenant's navigation loader shows it (site name when unset);
 * distinct from `seo.entity.logo`, which is JSON-LD publisher data.
 */
export function LogoCard(props: LogoCardProps) {
  const { hostId } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const logoUrl = data?.logoUrl
  /**
   * The stored value has three generations — a raw storage URL, an AGL-175
   * CDN path, and a `media:` reference (AGL-1407) — and only the resolver
   * knows all three. Handing the raw string to `<img src>` worked for exactly
   * as long as no site's `logoUrl` held a reference; the tenant's three
   * readers all resolve, so this preview was the last one that would have
   * shown a broken image the moment the data was converted.
   */
  const preview = Aglyn.resolveMediaSrc(logoUrl, { hostId })

  return (
    <CardDisplay
      header={'Site logo'}
      help={docsHelp('media', {
        excerpt:
          "Your site's brand mark, picked from the media library — " +
          'shown while pages load on your live site.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Shown while pages load on your live site. Without a logo, the ' +
          'site name is shown instead.'}
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt="Site logo"
            sx={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain' }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No logo set'}
          </Typography>
        )}
        <Button
          size="small"
          color="primary"
          onClick={() => setPickerOpen(true)}
        >
          {logoUrl ? 'Replace from media' : 'Choose from media'}
        </Button>
        {logoUrl ? (
          <Button
            size="small"
            color="error"
            onClick={() =>
              setDoc({ logoUrl: '' }, { merge: true })
                .then(() =>
                  enqueueSnackbar('Logo removed', {
                    variant: 'success',
                    persist: false,
                  }),
                )
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
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          // `mediaNodeSrc`, not `media.url` — the same writer the besigner
          // picker and the social-image card use. It mints a `media:`
          // reference when the org is entitled to CDN delivery and falls back
          // to the raw URL when it is not, so the entitlement gate keeps
          // working and picking a logo stops undoing the AGL-1407 conversion
          // the next time someone opens this card.
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          void setDoc({ logoUrl: src }, { merge: true })
            .then(() =>
              enqueueSnackbar('Logo saved', {
                variant: 'success',
                persist: false,
              }),
            )
            .catch(() =>
              enqueueSnackbar('An error has occurred', { variant: 'error' }),
            )
        }}
      />
    </CardDisplay>
  )
}
LogoCard.displayName = 'LogoCard'

export default LogoCard
