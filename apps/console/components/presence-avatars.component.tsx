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

import { Avatar, AvatarGroup, Tooltip } from '@mui/material'
import type { PresenceEntry } from '../hooks/use-presence'

/**
 * Who else is in this document (AGL-675).
 *
 * Renders nothing when you are alone — an empty slot in the app bar of a
 * single-player session is noise, and this must never read as a status
 * indicator that is "working" but showing zero.
 *
 * Deliberately NOT a lock, and the tooltip says so. Seeing a face makes
 * people coordinate socially, which avoids most collisions; but the thing
 * that actually protects their work is the concurrent-edit guard
 * (AGL-674), which shipped first for exactly this reason.
 */
export function PresenceAvatars({ entries }: { entries: PresenceEntry[] }) {
  if (!entries.length) return null

  return (
    <AvatarGroup
      max={4}
      sx={{
        mr: 1,
        '& .MuiAvatar-root': {
          width: 28,
          height: 28,
          fontSize: 13,
          borderWidth: 2,
        },
      }}
    >
      {entries.map((entry) => (
        <Tooltip
          key={entry.uid}
          title={`${entry.displayName} is editing this too — saves are not merged`}
        >
          <Avatar
            src={entry.photoURL}
            alt={entry.displayName}
            sx={{ bgcolor: entry.colour ?? 'secondary.main' }}
          >
            {/* Initial as the fallback; Avatar's own default is a generic
                glyph, which makes everyone look identical. */}
            {entry.displayName?.trim()?.charAt(0)?.toUpperCase() ?? '?'}
          </Avatar>
        </Tooltip>
      ))}
    </AvatarGroup>
  )
}

PresenceAvatars.displayName = 'PresenceAvatars'

export default PresenceAvatars
