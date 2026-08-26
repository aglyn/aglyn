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
import { MEDIA_ALT_MAX_LENGTH } from '@aglyn/aglyn/app-utils/media-metadata'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { mdiImageOutline } from '@aglyn/shared-data-mdi'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { COVER_IMAGE_HINT } from '../../constants/media-size-hints'

export interface EntryCoverImageFieldProps {
  /** Media-library scope, and the scope the preview src resolves against. */
  hostId: string
  /** The stored reference — a `media:` id, or a pasted absolute URL. */
  value: string
  /** `og:image:alt` for the entry's share card. */
  alt: string
  onValueChange: (value: string) => void
  onAltChange: (alt: string) => void
  /** Opens the page's ONE media picker, targeted at the cover. */
  onChoose: () => void
}

/**
 * The entry's cover image, WITH the picture on screen (AGL-2498).
 *
 * `media:DXnRbPH4CQ/4sY9JMK9fV` beside a "Choose" button — an opaque
 * reference an author cannot check, on the surface they share most
 * deliberately. Every other image field in the console (the screen's social
 * image, the site logo, the favicon, an author's portrait) renders what it
 * points at; this one did not, so the only way to find out you had picked the
 * wrong asset was to publish and look.
 *
 * ## What is DELIBERATELY kept from the old field
 *
 * The text input stays. `ScreenSocialImageField` — the field this one is
 * modelled on — is pick-only, and for a screen's OG image that is right: a
 * typed URL is how you end up with a share card that 404s the moment somebody
 * moves the asset. But an entry cover has always accepted a pasted absolute
 * URL, migrated archives are full of them, and taking the input away would
 * make every one of those entries uneditable rather than merely unpreviewed.
 * So the input is the escape hatch and the picker is the path of least
 * resistance, which is the same arrangement `MediaUrlField` settled on.
 *
 * ## Why it does not own the picker dialog
 *
 * The page mounts exactly one {@link MediaPickerDialog} and routes it by
 * target, because the pick handler is where a real decision lives:
 * `mediaNodeSrc` stores the asset by IDENTITY rather than by its current
 * location (a folder move rewrites the location and 404s a stored URL —
 * AGL-1215), and `inheritedMediaAlt` fills the description from the asset's
 * own alt without inventing one from a file name. Mounting a second dialog
 * here would mean a second copy of that handler, and a second copy is how one
 * of them ends up storing a raw URL again.
 *
 * ## The aspect ratio is 1200 × 630, and it is not decoration
 *
 * That is the OG card ratio every social reader crops to, so previewing at it
 * is what makes a "the logo is cut off" problem visible here instead of on
 * someone else's timeline. `objectFit: cover` reproduces the same crop the
 * reader will apply.
 */
export function EntryCoverImageField(props: EntryCoverImageFieldProps) {
  const { hostId, value, alt, onValueChange, onAltChange, onChoose } = props
  const trimmed = value.trim()
  // Stored as a `media:` reference; the preview needs the CDN path. Relative
  // is right here — the console is same-origin. Only the tenant head has to
  // absolutise it. A pasted absolute URL passes through unchanged.
  const preview = Aglyn.resolveMediaSrc(trimmed, { hostId })

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        {'The picture shown at the top of the entry and on its share card. ' +
          'Leave it unset and the entry publishes without one.'}
      </Typography>
      {preview ? (
        <Box
          component="img"
          src={preview}
          // The author's own description when there is one. NOT the file name
          // and NOT a fabricated label: this element is the preview of an
          // image whose alt is the very field below it, and announcing
          // something different here would describe the control rather than
          // the picture (AGL-1896).
          alt={alt.trim() || 'Cover image preview'}
          sx={{
            width: '100%',
            aspectRatio: '1200 / 630',
            objectFit: 'cover',
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        />
      ) : (
        /*
          An EMPTY state rather than nothing at all. A field that renders a
          picture when it has one and collapses to a text box when it does not
          reads as two different controls; a placeholder at the same ratio
          keeps the card's height honest and says what the slot is for.
        */
        <Stack
          spacing={0.5}
          sx={{
            width: '100%',
            aspectRatio: '1200 / 630',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 1,
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            color: 'text.secondary',
          }}
        >
          <MdiIcon path={mdiImageOutline.path} size={1.4} />
          <Typography variant="caption">{'No cover image'}</Typography>
        </Stack>
      )}
      {/* What to bring, said before the upload (AGL-2486). */}
      <Typography variant="caption" color="text.secondary" component="div">
        {COVER_IMAGE_HINT}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" onClick={onChoose}>
          {trimmed ? 'Replace image' : 'Choose image'}
        </Button>
        {trimmed ? (
          <Button
            size="small"
            color="error"
            onClick={() => {
              onValueChange('')
              // The description goes with the picture. An alt left behind
              // describes an image that is no longer there, and the save
              // would store it beside nothing — which is what
              // `coverImageAlt: deleteField()` exists to prevent (AGL-2417).
              onAltChange('')
            }}
          >
            {'Clear'}
          </Button>
        ) : null}
      </Stack>
      <TextField
        label="Cover image URL"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        size="small"
        helperText={
          'Picked from the media library, or paste a URL. A picked asset is ' +
          'stored by identity, so moving it between folders never breaks it.'
        }
      />
      {/*
        `og:image:alt` (AGL-2417). Shown only beside a cover, because a
        description with nothing to describe is a field nobody can answer.
        Pre-filled from the chosen asset's own alt and editable — this is the
        surface a customer shares most deliberately.
      */}
      {trimmed ? (
        <TextField
          label="Cover image description"
          placeholder="What the picture shows"
          value={alt}
          onChange={(event) =>
            onAltChange(event.target.value.slice(0, MEDIA_ALT_MAX_LENGTH))
          }
          size="small"
          helperText={'Read aloud by screen readers when this entry is shared.'}
        />
      ) : null}
    </Stack>
  )
}
EntryCoverImageField.displayName = 'EntryCoverImageField'

export default EntryCoverImageField
