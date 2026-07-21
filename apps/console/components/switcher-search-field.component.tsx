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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, InputAdornment, InputBase } from '@mui/material'

export interface SwitcherSearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

/**
 * The filter field at the top of the org/site switcher menus (AGL-629,
 * Vercel-style). A magnifier, a placeholder, and an `Esc` key hint. It lives
 * inside a MUI Menu, so character keys must be kept local — otherwise the
 * MenuList treats them as type-ahead and steals focus. Escape / arrows / Enter
 * are allowed to bubble so the menu still closes and the list is navigable.
 */
export function SwitcherSearchField(props: SwitcherSearchFieldProps) {
  const { value, onChange, placeholder } = props
  return (
    <Box sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
      <InputBase
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus
        fullWidth
        onKeyDown={(event) => {
          if (['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            return
          }
          event.stopPropagation()
        }}
        startAdornment={
          <InputAdornment position="start" sx={{ mr: 1 }}>
            <MdiIcon
              path={ICON_VARIANT_SEARCH.path}
              fontSize="small"
              sx={{ color: 'text.disabled' }}
            />
          </InputAdornment>
        }
        endAdornment={
          <Box
            component="span"
            sx={(theme) => ({
              flexShrink: 0,
              px: 0.75,
              py: 0.15,
              fontSize: 11,
              lineHeight: 1.6,
              color: 'text.secondary',
              border: `1px solid ${(theme.vars || theme).palette.divider}`,
              borderRadius: 1,
              bgcolor: 'action.hover',
            })}
          >
            {'Esc'}
          </Box>
        }
        sx={{ fontSize: 14, py: 0.5 }}
      />
    </Box>
  )
}
SwitcherSearchField.displayName = 'SwitcherSearchField'

export default SwitcherSearchField
