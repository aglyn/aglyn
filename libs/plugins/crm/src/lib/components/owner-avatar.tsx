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

import { Avatar, Tooltip } from '@mui/material'
import { hueFor, initialsFor } from '../model/deal-board-model'

/**
 * The theme colors an owner's avatar is drawn in, chosen by hashing the
 * label so one person keeps one color everywhere. Palette tokens rather
 * than a computed hue: every one of these is a color the theme already
 * guarantees legible white text on.
 */
const OWNER_COLORS = [
  'primary.main',
  'secondary.main',
  'tertiary.main',
  'info.main',
  'success.main',
  'warning.main',
] as const

export interface OwnerAvatarProps {
  /** The owner's name, or their uid when the roster cannot name them. */
  label: string
  size?: number
}

/**
 * A deal owner as a small lettered circle, on a board card or a table row.
 *
 * No photo: the roster route hands back names and emails and not avatars,
 * and a card that fetched a photo per owner would be a request per card.
 * The tooltip carries the full name, so the initials are never the only
 * thing that identifies somebody.
 */
export function OwnerAvatar(props: OwnerAvatarProps) {
  const { label, size = 24 } = props
  if (!label) return null
  const color = OWNER_COLORS[hueFor(label) % OWNER_COLORS.length]
  return (
    <Tooltip title={label}>
      <Avatar
        sx={{
          width: size,
          height: size,
          typography: 'caption',
          fontWeight: 'medium',
          bgcolor: color,
        }}
      >
        {initialsFor(label)}
      </Avatar>
    </Tooltip>
  )
}
OwnerAvatar.displayName = 'OwnerAvatar'

export default OwnerAvatar
