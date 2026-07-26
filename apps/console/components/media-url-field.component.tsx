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

import { Button, Stack, TextField } from '@mui/material'
import { useState } from 'react'
import { MediaPickerDialog } from './media/media-picker-dialog.component'

export interface MediaUrlFieldProps {
  label: string
  value: string
  onChange: (url: string) => void
  /** Org whose media library backs the browser. When absent, only manual
   * URL entry is offered. */
  orgId?: string | null
  helperText?: string
  placeholder?: string
  fullWidth?: boolean
  size?: 'small' | 'medium'
}

/**
 * Image URL field with a media-library browser (AGL-393/821): a text field
 * for manual URLs (the escape hatch) plus a "Browse" button that opens the
 * shared org DAM picker — the same component used everywhere else, so logos
 * and avatars get folders, upload, and the polished grid for free.
 */
export function MediaUrlField(props: MediaUrlFieldProps) {
  const {
    label,
    value,
    onChange,
    orgId,
    helperText,
    placeholder = 'https://…',
    fullWidth = true,
    size = 'small',
  } = props
  const [browsing, setBrowsing] = useState(false)

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          helperText={helperText}
          size={size}
          fullWidth={fullWidth}
        />
        {orgId ? (
          <Button
            size="small"
            variant="outlined"
            sx={{ mt: 0.5, flexShrink: 0 }}
            onClick={() => setBrowsing(true)}
          >
            {'Browse'}
          </Button>
        ) : null}
      </Stack>
      {orgId ? (
        <MediaPickerDialog
          orgId={orgId}
          open={browsing}
          onClose={() => setBrowsing(false)}
          onPick={(media) => onChange(media.cdnPath ?? media.url)}
        />
      ) : null}
    </>
  )
}
MediaUrlField.displayName = 'MediaUrlField'

export default MediaUrlField
