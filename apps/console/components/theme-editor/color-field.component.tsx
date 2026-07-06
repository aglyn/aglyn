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

import { ColorPicker } from '@aglyn/shared-ui-color-picker'
import {
  Box,
  ButtonBase,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { type MouseEvent, useCallback, useState } from 'react'

export interface ColorFieldProps {
  label: string
  /** Current hex value; undefined renders the "unset" checkerboard swatch. */
  value?: string
  onChange: (hex: string | undefined) => void
}

/**
 * Compact labeled swatch that opens a color picker popover. Clearing resets
 * the value to unset so the theme falls back to derived/default colors.
 */
export function ColorField(props: ColorFieldProps) {
  const { label, value, onChange } = props
  const [anchorEl, setAnchorEl] = useState<Element | null>(null)

  const handleOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }, [])
  const handleClose = useCallback(() => setAnchorEl(null), [])
  const handleChange = useCallback(
    (color: { hex: string }) => {
      onChange(color.hex)
    },
    [onChange],
  )
  const handleClear = useCallback(() => {
    onChange(undefined)
  }, [onChange])

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <ButtonBase
        aria-label={`pick ${label} color`}
        onClick={handleOpen}
        sx={{
          width: 32,
          height: 32,
          borderRadius: 1,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: 'divider',
          backgroundColor: value ?? 'transparent',
          backgroundImage: value
            ? undefined
            : // checkerboard for unset values
              'repeating-conic-gradient(rgba(128,128,128,0.35) 0% 25%, transparent 0% 50%)',
          backgroundSize: value ? undefined : '12px 12px',
        }}
      />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {value ?? 'Default'}
        </Typography>
      </Box>
      {value ? (
        <Tooltip title="Reset to default">
          <IconButton
            aria-label={`reset ${label} color`}
            size="small"
            onClick={handleClear}
          >
            {'×'}
          </IconButton>
        </Tooltip>
      ) : null}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <ColorPicker color={value ?? '#ffffff'} onChange={handleChange} />
      </Popover>
    </Stack>
  )
}
ColorField.displayName = 'ColorField'

export default ColorField
