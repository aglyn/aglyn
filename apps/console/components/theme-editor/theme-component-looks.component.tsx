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

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import { Box, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material'
import type { Dispatch, SetStateAction } from 'react'
import {
  inheritedThemeColor,
  readComponentLook,
  readThemeColor,
  THEME_COMPONENT_LOOK_FIELDS,
  THEME_COMPONENT_LOOK_GROUPS,
  THEME_LOOK_CUSTOM,
  THEME_LOOK_DEFAULT,
  type ThemeColorToken,
  type ThemeComponentLookField,
  writeComponentLook,
} from './theme-editor.constants'

export interface ThemeComponentLooksProps {
  draft: HostTheme
  updateDraft: Dispatch<SetStateAction<HostTheme>>
  /** The scheme in view, whose colors the swatches show. */
  scheme: HostThemeScheme
  /** The site the base theme resolves for. */
  siteKey: string | undefined
}

/** A small round sample of a theme color, or a checkerboard for none. */
function Swatch({ color }: { color: string | undefined }) {
  return (
    <Box
      aria-hidden
      component="span"
      sx={{
        display: 'inline-block',
        width: 14,
        height: 14,
        mr: 1,
        flexShrink: 0,
        borderRadius: '50%',
        border: '1px solid',
        borderColor: 'divider',
        verticalAlign: 'middle',
        backgroundColor: color ?? 'transparent',
        backgroundImage: color
          ? undefined
          : 'repeating-conic-gradient(rgba(128,128,128,0.35) 0% 25%, transparent 0% 50%)',
        backgroundSize: color ? undefined : '6px 6px',
      }}
    />
  )
}

/**
 * The Style components card's fields: the site-wide look of buttons, form
 * inputs and cards, each a choice from a list. Every choice writes the
 * theme's component overrides, the same place the Advanced overrides hold,
 * and "Theme default" clears what it wrote so the theme's own look returns.
 */
export function ThemeComponentLooks(props: ThemeComponentLooksProps) {
  const { draft, updateDraft, scheme, siteKey } = props

  const colorOf = (token: ThemeColorToken | undefined) =>
    token
      ? readThemeColor(draft, scheme, token) ?? inheritedThemeColor(scheme, token, siteKey)
      : undefined

  const renderField = (field: ThemeComponentLookField) => {
    const value = readComponentLook(draft, field)
    return (
      <Grid key={field.id} size={{ xs: 12, sm: 6 }}>
        <TextField
          select
          fullWidth
          size="small"
          label={field.label}
          value={value}
          // "Theme default" is the empty value, and is still shown by name.
          slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
          onChange={(event) =>
            updateDraft((prev) => writeComponentLook(prev, field, event.target.value))
          }
        >
          <MenuItem value={THEME_LOOK_DEFAULT}>{'Theme default'}</MenuItem>
          {value === THEME_LOOK_CUSTOM ? (
            <MenuItem value={THEME_LOOK_CUSTOM} disabled>
              {'Custom (set under Advanced)'}
            </MenuItem>
          ) : null}
          {field.options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {field.kind === 'color' ? <Swatch color={colorOf(option.token)} /> : null}
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
    )
  }

  return (
    <Stack spacing={2}>
      {THEME_COMPONENT_LOOK_GROUPS.map(({ group, label }) => (
        <Stack key={group} spacing={1.5}>
          <Typography variant="subtitle2">{label}</Typography>
          <Grid container spacing={2}>
            {THEME_COMPONENT_LOOK_FIELDS.filter((field) => field.group === group).map(
              renderField,
            )}
          </Grid>
        </Stack>
      ))}
    </Stack>
  )
}
ThemeComponentLooks.displayName = 'ThemeComponentLooks'

export default ThemeComponentLooks
