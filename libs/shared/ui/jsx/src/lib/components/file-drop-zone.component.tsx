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
import { Box, ButtonBase, Typography, type SxProps, type Theme } from '@mui/material'
import { useCallback, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { MdiIcon } from './mdi-icon'

/**
 * A place to drop files, which is also the button that opens the file
 * chooser (AGL-3656). Keyboard and screen reader reachable as one button;
 * the drag states are drawn from theme tokens, so it follows light and dark.
 *
 * It hands back the files and nothing else: what is accepted, how each one
 * is checked and where it goes are the caller's, which is what lets a font
 * installer, an importer and a media library share it.
 */
export interface FileDropZoneProps {
  /** Called with the files dropped or chosen, in order. */
  onFiles: (files: File[]) => void
  /** The file input's `accept`; dropped files are filtered by it too. */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  /** The headline, e.g. "Drop font files here". */
  label: ReactNode
  /** One line under it, e.g. the formats and the size limit. */
  hint?: ReactNode
  /** An mdi path for the icon above the label. */
  icon?: string
  /** Called with the files `accept` refused, so the caller can say why. */
  onRejected?: (files: File[]) => void
  sx?: SxProps<Theme>
}

/** Whether a file matches an `accept` list of types, wildcards and extensions. */
export function fileMatchesAccept(file: Pick<File, 'name' | 'type'>, accept: string | undefined): boolean {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry.startsWith('.')) return name.endsWith(entry)
      if (entry.endsWith('/*')) return type.startsWith(entry.slice(0, -1))
      return type === entry
    })
}

export function FileDropZone(props: FileDropZoneProps) {
  const { onFiles, accept, multiple = true, disabled, label, hint, icon = mdiTrayArrowUp, onRejected, sx } = props
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [dragging, setDragging] = useState(false)
  // Child elements fire their own enter/leave; counting keeps the highlight
  // steady while the pointer crosses them.
  const depth = useRef(0)

  const deliver = useCallback(
    (list: FileList | null) => {
      const files = Array.from(list ?? [])
      if (!files.length) return
      const accepted = files.filter((file) => fileMatchesAccept(file, accept))
      const rejected = files.filter((file) => !accepted.includes(file))
      if (rejected.length) onRejected?.(rejected)
      const chosen = multiple ? accepted : accepted.slice(0, 1)
      if (chosen.length) onFiles(chosen)
    },
    [accept, multiple, onFiles, onRejected],
  )

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault()
    if (disabled) return
    depth.current += 1
    setDragging(true)
  }
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (!depth.current) setDragging(false)
  }
  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (!disabled) event.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    depth.current = 0
    setDragging(false)
    if (!disabled) deliver(event.dataTransfer.files)
  }

  return (
    <ButtonBase
      component="div"
      role="button"
      aria-describedby={hint ? hintId : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-dragging={dragging || undefined}
      sx={[
        (theme) => {
          const tokens = theme.vars ?? theme
          return {
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            px: 2,
            py: 3,
            textAlign: 'center',
            borderRadius: `${tokens.shape.borderRadius}px`,
            border: `1px dashed ${tokens.palette.divider}`,
            backgroundColor: 'transparent',
            color: tokens.palette.text.secondary,
            transition: theme.transitions.create(['border-color', 'background-color', 'color'], {
              duration: theme.transitions.duration.shortest,
            }),
            '&:hover, &.Mui-focusVisible': {
              borderColor: tokens.palette.primary.main,
              color: tokens.palette.text.primary,
            },
            '&[data-dragging]': {
              borderStyle: 'solid',
              borderColor: tokens.palette.primary.main,
              backgroundColor: theme.alpha(tokens.palette.primary.main, tokens.palette.action.hoverOpacity),
              color: tokens.palette.primary.main,
            },
            '&.Mui-disabled': { opacity: tokens.palette.action.disabledOpacity },
          }
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <MdiIcon path={icon} fontSize="medium" color="inherit" />
      <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium', color: 'inherit' }}>
        {label}
      </Typography>
      {hint ? (
        <Typography id={hintId} variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
      <Box
        component="input"
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          deliver((event.target as HTMLInputElement).files)
          ;(event.target as HTMLInputElement).value = ''
        }}
      />
    </ButtonBase>
  )
}

export default FileDropZone
