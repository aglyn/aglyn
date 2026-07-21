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
        {logoUrl ? (
          <Box
            component="img"
            src={logoUrl}
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
          color="secondary"
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
          if (!media.url) return
          void setDoc({ logoUrl: media.url }, { merge: true })
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
