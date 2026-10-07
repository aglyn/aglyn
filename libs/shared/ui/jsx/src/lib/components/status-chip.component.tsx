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

import Chip, { type ChipProps } from '@mui/material/Chip'
import type { ReactElement } from 'react'

/**
 * What a status says about the thing it labels. The five tones are the
 * theme's own palette roles, so a status reads the same in every card.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const TONE_COLOR: Readonly<Record<StatusTone, ChipProps['color']>> = {
  neutral: 'default',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
}

export interface StatusChipProps {
  label: string
  tone?: StatusTone
  /** An icon before the label, such as an `MdiIcon`. */
  icon?: ReactElement
  /** Outlined for a quiet status beside other content; filled to stand out. */
  variant?: 'filled' | 'outlined'
  'data-testid'?: string
}

/**
 * A record's state as a small chip — On, Connected, Needs attention
 * (AGL-3637). Plugins mapped each status to a hand-picked MUI `Chip` color
 * per card, and the same state came out in different colors on different
 * cards; a tone names what the state means and the theme picks the color.
 */
export function StatusChip(props: StatusChipProps) {
  const { label, tone = 'neutral', icon, variant = 'filled' } = props
  return (
    <Chip
      size="small"
      label={label}
      color={TONE_COLOR[tone]}
      variant={variant}
      {...(icon ? { icon } : {})}
      data-testid={props['data-testid']}
    />
  )
}
StatusChip.displayName = 'StatusChip'

export default StatusChip
