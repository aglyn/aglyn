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
import {
  MEDIA_ALT_MAX_LENGTH,
  inheritedMediaAlt,
} from '@aglyn/aglyn/app-utils/media-metadata'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { SOCIAL_IMAGE_HINT } from '../constants/media-size-hints'
import { useState } from 'react'
import MediaPickerDialog from './media/media-picker-dialog.component'
import type { ScreenSocialImageDraft } from '../constants/screen-seo'

/**
 * Re-exported for the surfaces that already import the draft type from here.
 * It is DECLARED beside `buildScreenSeoUpdate` (AGL-1437) because the staging
 * contract and the rules for turning a draft into stored keys are one
 * decision, and splitting them is how the two SEO panels drifted.
 */
export type { ScreenSocialImageDraft }

export interface ScreenSocialImageFieldProps {
  /** Media-library scope, and the scope the preview src resolves against. */
  hostId: string
  /** What the screen doc currently holds at `seo.image`. */
  saved?: string | null
  /** What the screen doc currently holds at `seo.imageAlt` (AGL-2417). */
  savedAlt?: string | null
  /**
   * The stored dimensions, needed because editing the ALT alone still has to
   * restage the whole group — `buildScreenSeoUpdate` writes `image`,
   * `imageWidth`, `imageHeight` and `imageAlt` together on purpose, so a
   * draft carrying the alt and zeroes would silently drop the card's size.
   */
  savedWidth?: number | null
  savedHeight?: number | null
  /** The staged edit; `null` means the author has not touched it. */
  value: ScreenSocialImageDraft | null
  onChange: (draft: ScreenSocialImageDraft) => void
}

/**
 * The per-screen social/OG image field (AGL-1337), shared by the besigner's
 * Screen Properties ▸ SEO panel and the screen detail page's SEO card
 * (AGL-1368).
 *
 * It is one component because it was very nearly two. The control shipped
 * inline in the besigner, the docs told everyone to use the detail page, and
 * the field there did not exist — so the fix is to put the SAME field on both
 * surfaces rather than to write a second one that drifts. The staging
 * contract is the subtle part and belongs here, not copied: `null` means
 * untouched, `''` means an author cleared it on purpose, and a pending `''`
 * must beat the saved value or a clear appears to do nothing until reload.
 *
 * A media PICK, never a URL field — a typed URL is how you end up with a card
 * that 404s the moment someone moves the asset into a folder. The dialog is
 * the one canonical media browser (AGL-821), so the site library and the
 * org's shared library are both reachable and a restricted asset stays
 * invisible to sites that may not render it. It portals to the document, so
 * mounting it here is safe inside a drawer or a dialog.
 */
export function ScreenSocialImageField(props: ScreenSocialImageFieldProps) {
  const { hostId, saved, savedAlt, savedWidth, savedHeight, value, onChange } =
    props
  const [pickerOpen, setPickerOpen] = useState(false)

  // The draft if the author has touched it, otherwise what the doc holds. A
  // staged `''` is a pending CLEAR and must win over the saved value, which
  // is why this reads the draft's PRESENCE rather than its truthiness.
  const current = value != null ? value.image : (saved ?? '')
  // Same PRESENCE rule as the image: a staged `''` is a pending clear of the
  // description and must beat what the doc holds, or clearing it appears to
  // do nothing until reload.
  const currentAlt =
    value != null ? (value.imageAlt ?? '') : (savedAlt ?? '')
  // Stored as a `media:` reference; the preview needs the CDN path. Relative
  // is right here — the console is same-origin. Only the tenant head has to
  // absolutise it.
  const preview = Aglyn.resolveMediaSrc(current, { hostId })

  return (
    <>
      <Typography variant="caption" color="text.secondary">
        {'Social image — the picture shown when this screen is shared. ' +
          'Leave it unset to use the site default from Site setup ▸ SEO.'}
      </Typography>
      {preview ? (
        <Box
          component="img"
          src={preview}
          alt="Social image"
          sx={{
            width: '100%',
            aspectRatio: '1200 / 630',
            objectFit: 'cover',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
          }}
        />
      ) : null}
      {/* What to bring, said before the upload (AGL-2486). */}
      <Typography variant="caption" color="text.secondary" component="div">
        {SOCIAL_IMAGE_HINT}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setPickerOpen(true)}
        >
          {current ? 'Replace image' : 'Choose image'}
        </Button>
        {current ? (
          <Button
            size="small"
            color="error"
            onClick={() =>
              onChange({
                image: '',
                imageWidth: 0,
                imageHeight: 0,
                imageAlt: '',
              })
            }
          >
            {'Clear'}
          </Button>
        ) : null}
      </Stack>
      {/*
        `og:image:alt` (AGL-2417). Shown only beside an image, because a
        description with nothing to describe is a field nobody can answer.
        Pre-filled from the chosen asset's own alt at pick time and editable
        here — the asset's generic sentence is the default, and the sentence
        about THIS card is the one worth having.
      */}
      {current ? (
        <TextField
          label="Image description"
          placeholder="What the picture shows"
          value={currentAlt}
          onChange={(event) =>
            onChange({
              image: current,
              imageWidth:
                value != null ? value.imageWidth : (savedWidth ?? 0),
              imageHeight:
                value != null ? value.imageHeight : (savedHeight ?? 0),
              imageAlt: event.target.value.slice(0, MEDIA_ALT_MAX_LENGTH),
            })
          }
          size="small"
          fullWidth
          helperText={
            'Read aloud by screen readers in a social preview. Describe the ' +
            'picture, not the page.'
          }
        />
      ) : null}
      <MediaPickerDialog
        hostId={hostId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(media) => {
          const src = Aglyn.mediaNodeSrc(media)
          if (!src) return
          // Dimensions read off the media record (captured at upload,
          // AGL-173) and staged WITH the reference, never separately.
          onChange({
            image: src,
            imageWidth: media.width ?? 0,
            imageHeight: media.height ?? 0,
            // The asset's own alt, through the ONE shared rule (AGL-1896).
            // Never the file name: "IMG_4021.jpg" read aloud in a share
            // preview is worse than the silence it replaced, and an asset
            // with no alt leaves the field empty and honest.
            imageAlt:
              inheritedMediaAlt({
                placementAlt: currentAlt,
                assetAlt: (media as { alt?: unknown }).alt,
              }) ?? currentAlt,
          })
        }}
      />
    </>
  )
}

export default ScreenSocialImageField
