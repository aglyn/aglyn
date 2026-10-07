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

import { useInView } from '@aglyn/shared-ui-jsx/hooks/use-in-view'
import { Card, CardActionArea, Skeleton, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { previewStack, useFontPreview } from './font-preview'

export interface FontFamilyCardProps {
  /** The family's name, as Google serves it; absent for a font with nothing to load. */
  family: string | null
  /** The name shown on the card. */
  label: string
  /** The line under the name: category, styles. */
  detail: string
  /** The words the preview draws. */
  sample: string
  /** The CSS generic family the preview falls back to. */
  fallback: string
  /**
   * A stack to draw the preview with instead of loading one from Google: the
   * theme default's stack, an uploaded font the editor already loads.
   */
  stack?: string
  selected?: boolean
  onSelect: () => void
  /** Beside the name, at the card's top right. */
  badge?: ReactNode
}

/**
 * One family in the picker's list: its name and the site's own words drawn in
 * it. The preview loads when the card scrolls into view, and only the letters
 * it draws.
 */
export function FontFamilyCard(props: FontFamilyCardProps) {
  const { family, label, detail, sample, fallback, stack, selected = false, onSelect, badge } = props
  const [ref, inView] = useInView<HTMLDivElement>({ rootMargin: '120px' })
  const preview = useFontPreview(stack ? null : family, { text: `${label}${sample}`, enabled: inView })
  const loading = !stack && family && (preview.status === 'loading' || preview.status === 'idle')
  return (
    <Card
      ref={ref}
      variant="outlined"
      sx={{
        borderColor: selected ? 'primary.main' : undefined,
        boxShadow: selected ? (theme) => `inset 0 0 0 1px ${(theme.vars ?? theme).palette.primary.main}` : undefined,
      }}
    >
      <CardActionArea onClick={onSelect} aria-pressed={selected} aria-label={`${label}, ${detail}`} sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>
                {label}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {detail}
              </Typography>
            </Stack>
            {badge}
          </Stack>
          {loading ? (
            <Skeleton variant="text" sx={{ typography: 'h5' }} width="80%" />
          ) : (
            <Typography
              variant="h5"
              component="p"
              noWrap
              sx={{ fontFamily: stack ?? previewStack(preview, fallback) }}
            >
              {sample}
            </Typography>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  )
}
FontFamilyCard.displayName = 'FontFamilyCard'

export default FontFamilyCard
