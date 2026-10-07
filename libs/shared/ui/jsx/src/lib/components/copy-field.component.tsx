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

import { mdiContentCopy } from '@aglyn/shared-data-mdi'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import { useState, type ReactNode } from 'react'
import { MdiIcon } from './mdi-icon/mdi-icon'

export interface CopyFieldProps {
  label: string
  value: string
  helperText?: ReactNode
  /** Called once the value is on the clipboard, e.g. to show a snackbar. */
  onCopied?: () => void
  /** Called when the browser refused the clipboard. */
  onCopyFailed?: (error: unknown) => void
  /** The copy button's accessible name; `Copy {label}` by default. */
  copyLabel?: string
  size?: 'small' | 'medium'
  fullWidth?: boolean
}

/**
 * A value a reader copies somewhere else — a feed address, an API key's
 * public half, a webhook URL — shown read-only with a copy button inside the
 * field (AGL-3637). Focusing the field selects the whole value, so copying by
 * hand works too.
 */
export function CopyField(props: CopyFieldProps) {
  const { label, value, helperText, onCopied, onCopyFailed, size = 'small', fullWidth = true } = props
  const [copied, setCopied] = useState(false)
  const copyLabel = props.copyLabel ?? `Copy ${label.toLowerCase()}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopied?.()
    } catch (error) {
      onCopyFailed?.(error)
    }
  }
  return (
    <TextField
      label={label}
      value={value}
      size={size}
      fullWidth={fullWidth}
      helperText={helperText}
      onFocus={(event) => event.target.select()}
      slotProps={{
        input: {
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? 'Copied' : copyLabel}>
                <IconButton aria-label={copyLabel} edge="end" onClick={() => void copy()} onMouseLeave={() => setCopied(false)}>
                  <MdiIcon path={mdiContentCopy} fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
CopyField.displayName = 'CopyField'

export default CopyField
