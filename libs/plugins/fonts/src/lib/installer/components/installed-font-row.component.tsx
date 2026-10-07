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

import type { HostThemeFont, HostThemeFontCategory } from '@aglyn/shared-data-types'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { Box, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { faceWeightLabel, type FontRole } from '../theme-fonts'
import { FONT_CATEGORY_OPTIONS } from '../use-font-installer'

/** An installed family: drawn in itself, its faces, its roles and what can be done with it. */

const SAMPLE = 'The quick brown fox jumps over the lazy dog'

const ROLE_LABEL: Record<FontRole, string> = { body: 'Body text', headings: 'Headings' }

export interface InstalledFontRowProps {
  font: HostThemeFont
  roles: FontRole[]
  onRole: (role: FontRole) => void
  onCategory: (category: HostThemeFontCategory) => void
  onRemoveFace: (face: NonNullable<HostThemeFont['faces']>[number]) => void
  onRemove: () => void
}

export function InstalledFontRow(props: InstalledFontRowProps) {
  const { font, roles, onRole, onCategory, onRemoveFace, onRemove } = props
  const faces = font.faces ?? []
  const regular = faces.find((face) => face.style === 'normal') ?? faces[0]
  const family = `"${font.family.replace(/["\\]/g, '')}", ${font.category === 'serif' ? 'serif' : font.category === 'monospace' ? 'monospace' : 'sans-serif'}`
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" component="h4" sx={{ fontFamily: family }}>
              {font.family}
            </Typography>
            {roles.map((role) => (
              <Chip key={role} size="small" color="primary" label={ROLE_LABEL[role]} />
            ))}
          </Stack>
          <Typography
            variant="body1"
            sx={{
              mt: 0.5,
              fontFamily: family,
              fontWeight: regular?.weightMax ? 400 : (regular?.weight ?? 400),
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {SAMPLE}
          </Typography>
        </Box>
        <RowActionsMenu
          label={`${font.family} actions`}
          items={[
            { key: 'body', label: 'Use for body text', onClick: () => onRole('body'), disabled: roles.includes('body') },
            {
              key: 'headings',
              label: 'Use for headings',
              onClick: () => onRole('headings'),
              disabled: roles.includes('headings'),
            },
            { key: 'remove', label: 'Remove from theme', onClick: onRemove, destructive: true },
          ]}
        />
      </Stack>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        useFlexGap
        sx={{ mt: 1.5, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }} aria-label="Styles">
          {faces.map((face) => (
            <Chip
              key={`${face.weight}-${face.weightMax ?? ''}-${face.style}`}
              size="small"
              variant="outlined"
              label={`${faceWeightLabel(face)}${face.style === 'italic' ? ' italic' : ''}`}
              onDelete={() => onRemoveFace(face)}
              sx={{ fontFamily: family, fontWeight: face.weightMax ? 400 : face.weight, fontStyle: face.style }}
            />
          ))}
        </Stack>
        <TextField
          select
          size="small"
          label="Fallback style"
          value={font.category ?? 'sans-serif'}
          onChange={(event) => onCategory(event.target.value as HostThemeFontCategory)}
          sx={{ minWidth: 160 }}
          helperText="Drawn until the font loads"
        >
          {FONT_CATEGORY_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    </Paper>
  )
}
