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

import { mdiTrayArrowUp } from '@mdi/js'
import { Box, Link, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { FileDropZone } from './file-drop-zone.component'

/** What a picture is previewed on: the ground it will be seen on. */
export type ImageFileFieldGround = 'light' | 'dark'

export interface ImageFileFieldProps {
  label: string
  /** The file held, or `null`. Nothing is uploaded here. */
  file: File | null
  /** Called with the file chosen, or `null` when it is removed. */
  onChange: (file: File | null) => void
  /** The file chooser's `accept`; a dropped file is held to it too. */
  accept?: string
  /** Called with a file `accept` refused, so the caller can say why. */
  onRejected?: (file: File) => void
  /** Draws the field on this ground. Without one it sits on the surface it is on. */
  ground?: ImageFileFieldGround
  /** One line under the field, while no file is held. */
  helperText?: ReactNode
  /** Why the last file was refused. Shown over the helper text and the file's name. */
  error?: ReactNode
  disabled?: boolean
  sx?: SxProps<Theme>
}

/** The tile's colors on a ground, read from the theme's own greys. */
const GROUND_SX: Readonly<Record<ImageFileFieldGround, Record<string, unknown>>> = {
  light: {
    bgcolor: 'common.white',
    color: 'grey.600',
    '&:hover, &.Mui-focusVisible': { color: 'grey.900' },
  },
  dark: {
    bgcolor: 'grey.900',
    color: 'grey.400',
    '&:hover, &.Mui-focusVisible': { color: 'common.white' },
  },
}

/**
 * A URL for a file held in memory, for as long as it is held. Empty outside a
 * browser, and released when the file changes or the field goes away.
 */
function useFilePreview(file: File | null): string | null {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') return void setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return preview
}

/**
 * Pick one image, see it, and take it away again (AGL-4119). A compact tile on
 * {@link FileDropZone}, for a form that holds a file until there is somewhere
 * to put it. It hands back the file and nothing else: what a form accepts,
 * what it refuses and where the file goes are the form's.
 */
export function ImageFileField(props: ImageFileFieldProps) {
  const { label, file, onChange, accept, onRejected, ground, helperText, error, disabled, sx } = props
  const preview = useFilePreview(file)
  const below = error ?? (file ? file.name : helperText)
  return (
    <Stack spacing={0.5} sx={[{ minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', columnGap: 1 }}>
        <Typography variant="body2" noWrap title={label}>
          {label}
        </Typography>
        {file ? (
          <Link
            component="button"
            type="button"
            variant="caption"
            color="text.secondary"
            disabled={disabled}
            aria-label={`Remove ${label}`}
            onClick={() => onChange(null)}
          >
            {'Remove'}
          </Link>
        ) : null}
      </Stack>
      <FileDropZone
        accept={accept}
        multiple={false}
        disabled={disabled}
        ariaLabel={file ? `Replace ${label}` : `Choose ${label}`}
        icon={file ? null : mdiTrayArrowUp}
        label={
          file && preview ? (
            <Box
              component="img"
              src={preview}
              alt=""
              sx={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: (theme) => theme.spacing(8),
                objectFit: 'contain',
              }}
            />
          ) : file ? (
            file.name
          ) : (
            'Choose file'
          )
        }
        onFiles={([chosen]) => onChange(chosen ?? null)}
        onRejected={([refused]) => (refused ? onRejected?.(refused) : undefined)}
        sx={[
          {
            height: (theme) => theme.spacing(9),
            flexDirection: file ? 'row' : 'column',
            gap: 0,
            px: 1,
            py: 0.5,
            overflow: 'hidden',
          },
          ground ? GROUND_SX[ground] : {},
        ]}
      />
      {below ? (
        <Typography
          variant="caption"
          color={error ? 'error' : 'text.secondary'}
          noWrap={!error && Boolean(file)}
          role={error ? 'alert' : undefined}
          title={!error && file ? file.name : undefined}
        >
          {below}
        </Typography>
      ) : null}
    </Stack>
  )
}

export default ImageFileField
