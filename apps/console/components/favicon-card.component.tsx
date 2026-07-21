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

export interface FaviconCardProps {
  hostId: string
}

/**
 * Favicon picker (AGL-134): replaces pasting a bare URL — pick (or upload)
 * an .ico/.png in the media browser and the asset URL lands on
 * `seo.favicon`. The URL field in the SEO form still works for external
 * icons; this card just makes the common path one click.
 */
export function FaviconCard(props: FaviconCardProps) {
  const { hostId } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const favicon = data?.seo?.favicon

  return (
    <CardDisplay
      header={'Favicon'}
      help={docsHelp('media', {
        excerpt:
          'The small icon browsers show in tabs and bookmarks — pick an ' +
          '.ico or .png from your media library, or paste a URL in the ' +
          'SEO form.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {favicon ? (
          <Box
            component="img"
            src={favicon}
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
          color="secondary"
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
                .then(() =>
                  enqueueSnackbar('Favicon removed', {
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
          void setDoc({ seo: { favicon: media.url } }, { merge: true })
            .then(() =>
              enqueueSnackbar('Favicon saved', {
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
FaviconCard.displayName = 'FaviconCard'

export default FaviconCard
