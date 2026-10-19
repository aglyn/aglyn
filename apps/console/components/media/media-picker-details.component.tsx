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

import type * as Aglyn from '@aglyn/aglyn'
import { mediaSrc, mediaThumbnailSrc } from '@aglyn/aglyn/app-utils/media-src'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import { mediaFileTypeIcon } from '../../utils/media-file-icon'
import { MediaFactRows } from './media-file-info.component'
import { mediaStoredFacts } from './media-file-info-copy'

export interface MediaPickerDetailsProps {
  media: Aglyn.AglynHostMedia
  /**
   * Why this file cannot be used where the picker was opened, said above its
   * details. The dialog disables its confirm button for the same reason.
   */
  blockedReason?: string | null
  /** Small screens, where the details replace the files: back to them. */
  onBack?: () => void
}

/** A caption over one piece of what the file carries. */
const Label = ({ children }: { children: string }) => (
  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
    {children}
  </Typography>
)

/**
 * The file a person clicked in the media picker, shown before it is used:
 * a preview, its name, its alt text and the facts the File info lists. The
 * picker places nothing until its confirm button is pressed, so a look-alike
 * thumbnail is checked here rather than discovered on the page.
 */
export function MediaPickerDetails(props: MediaPickerDetailsProps) {
  const { media, blockedReason, onBack } = props
  const contentType = String(media.contentType ?? '')
  const isImage = contentType.startsWith('image/')
  const isVideo = contentType.startsWith('video/')
  const fileName = media.fileName || media.$id
  const facts = useMemo(() => mediaStoredFacts(media), [media])
  const { Icon: FileTypeIcon, label: fileTypeLabel } = mediaFileTypeIcon(contentType)

  return (
    <Stack spacing={2} data-testid="media-picker-details">
      {onBack ? (
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={onBack}
          sx={{ alignSelf: 'flex-start' }}
        >
          {'Back to files'}
        </Button>
      ) : null}
      {isImage ? (
        <Box
          component="img"
          // The 640px variant: a 320px panel at 2x, as the Details drawer.
          src={mediaThumbnailSrc(media, 640)}
          alt={media.alt || fileName}
          sx={{
            width: '100%',
            maxHeight: 240,
            objectFit: 'contain',
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        />
      ) : isVideo ? (
        <Box
          component="video"
          src={mediaSrc(media)}
          controls
          muted
          sx={{ width: '100%', maxHeight: 240, borderRadius: 1, bgcolor: 'action.hover' }}
        />
      ) : (
        <Box
          role="img"
          aria-label={fileTypeLabel}
          sx={{
            height: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 1,
            bgcolor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          <FileTypeIcon sx={{ fontSize: 56 }} />
        </Box>
      )}
      <Typography variant="subtitle1" component="h3" sx={{ wordBreak: 'break-word' }}>
        {fileName}
      </Typography>
      {blockedReason ? <Alert severity="warning">{blockedReason}</Alert> : null}
      {isImage ? (
        <Box>
          <Label>{'Alt text'}</Label>
          <Typography
            variant="body2"
            color={media.alt ? 'text.primary' : 'text.secondary'}
            sx={{ wordBreak: 'break-word' }}
          >
            {media.alt || 'Not set. Add it in the media library to describe this image.'}
          </Typography>
        </Box>
      ) : null}
      {media.description ? (
        <Box>
          <Label>{'Description'}</Label>
          <Typography variant="body2" sx={{ wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
            {media.description}
          </Typography>
        </Box>
      ) : null}
      {media.tags?.length ? (
        <Box>
          <Label>{'Tags'}</Label>
          <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {media.tags.map((tag) => (
              <Chip key={tag} size="small" label={tag} />
            ))}
          </Stack>
        </Box>
      ) : null}
      {facts.length ? (
        <Box>
          <Label>{'File info'}</Label>
          <MediaFactRows facts={facts} />
        </Box>
      ) : null}
    </Stack>
  )
}
MediaPickerDetails.displayName = 'MediaPickerDetails'

export default MediaPickerDetails
