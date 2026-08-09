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

export interface SocialImageCardProps {
  hostId: string
}

/**
 * The site-wide default social card image (AGL-1337).
 *
 * A card rather than a field in the SEO form above it, for the same two
 * reasons the favicon and the indexing switch are cards:
 *
 * 1. **It is a media pick, not a string.** Reusing `MediaPickerDialog` — the
 *    one canonical picker (AGL-821) — means folders, upload and the org's
 *    shared library come for free, and the value written is what every other
 *    surface writes (`mediaNodeSrc`), so it survives a folder move.
 * 2. **`''` cannot survive the attributes form stack.** Two layers map an
 *    empty string to `undefined` (AGL-1191), which for a form that saves by
 *    patch means a cleared field is simply dropped and the OLD image stays.
 *    Writing straight to the host doc is what makes "Remove" actually remove.
 *
 * The pixel dimensions are copied off the media record at pick time so the
 * head can emit `og:image:width`/`height` without a per-render lookup — see
 * `resolveSocialImage`.
 */
export function SocialImageCard(props: SocialImageCardProps) {
  const { hostId } = props
  const { enqueueSnackbar } = useSnackbar()
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const [pickerOpen, setPickerOpen] = useState(false)
  const image = data?.seo?.image
  const width = data?.seo?.imageWidth
  const height = data?.seo?.imageHeight
  const preview = Aglyn.resolveMediaSrc(image, { hostId })

  const save = (
    seo: { image: string; imageWidth?: number; imageHeight?: number },
    message: string,
  ) =>
    setDoc({ seo }, { merge: true })
      .then(() =>
        enqueueSnackbar(message, { variant: 'success', persist: false }),
      )
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )

  return (
    <CardDisplay
      header={'Social image'}
      help={docsHelp('seo', {
        anchor: '#social-cards',
        excerpt:
          'The picture shown when any page of this site is shared to ' +
          'social media or chat. Screens can override it in their own SEO ' +
          'panel. 1200×630 is the size every network crops well.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {preview ? (
          <Box
            component="img"
            src={preview}
            alt="Default social image"
            sx={{
              width: '100%',
              maxWidth: 400,
              aspectRatio: '1200 / 630',
              objectFit: 'cover',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No default set — pages without an image of their own share as ' +
              'a small, image-less card.'}
          </Typography>
        )}
        {preview && width && height ? (
          <Typography variant="caption" color="text.secondary">
            {`${width}×${height}`}
            {width === 1200 && height === 630
              ? ''
              : ' — 1200×630 is the size every network crops well'}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button size="small" color="primary" onClick={() => setPickerOpen(true)}>
            {image ? 'Replace from media' : 'Choose from media'}
          </Button>
          {image ? (
            <Button
              size="small"
              color="error"
              onClick={() =>
                void save(
                  // `''`, not a missing key: a merge write ignores absent
                  // fields, so "no image" has to be a value that is actually
                  // sent. It reads as falsy everywhere downstream.
                  { image: '', imageWidth: 0, imageHeight: 0 },
                  'Social image removed',
                )
              }
            >
              {'Remove'}
            </Button>
          ) : null}
        </Stack>
      </Stack>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          void save(
            {
              image: src,
              // From the media record (AGL-173 captures these at upload), not
              // hardcoded — a site is free to use a different aspect ratio,
              // and a card that lies about its proportions is worse than one
              // that declares none.
              imageWidth: media.width ?? 0,
              imageHeight: media.height ?? 0,
            },
            'Social image saved',
          )
        }}
      />
    </CardDisplay>
  )
}
SocialImageCard.displayName = 'SocialImageCard'

export default SocialImageCard
