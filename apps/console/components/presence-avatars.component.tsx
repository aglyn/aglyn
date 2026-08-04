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

import { mdiMonitorMultiple } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Avatar, AvatarGroup, Stack, Tooltip } from '@mui/material'
import type { PresenceState } from '../hooks/use-presence'

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
export function PresenceAvatars({ presence }: { presence: PresenceState }) {
  const { entries, ownOtherSessions } = presence
  if (!entries.length && !ownOtherSessions) return null

  return (
    <Stack direction="row" sx={{ alignItems: 'center' }}>
      {ownOtherSessions ? <OwnSessionsBadge count={ownOtherSessions} /> : null}
      {entries.length ? <RoomAvatars entries={entries} /> : null}
    </Stack>
  )
}

/**
 * You, somewhere else (AGL-675).
 *
 * The avatar stack filters your own uid out of the room, so without this
 * the most dangerous case in the whole feature is the one nobody is shown:
 * the same person editing one document in two tabs. Two tabs are two
 * `CanvasManager`s, so the second save quietly replaces the first — and the
 * concurrent-edit guard does not fire, because the stamp moved on *your*
 * write, not a colleague's. They also share one local draft key
 * (AGL-1256), last writer wins.
 *
 * Warning-coloured because it is a hazard rather than company.
 */
function OwnSessionsBadge({ count }: { count: number }) {
  return (
    <Tooltip
      title={
        `You have this open in ${count === 1 ? 'one other place' : `${count} other places`} — ` +
        'another tab, or this account signed in elsewhere. Nothing merges ' +
        'between them: whichever one saves last wins, and it will not warn ' +
        'you, because both are you.'
      }
    >
      <Avatar
        sx={{
          width: 28,
          height: 28,
          mr: 1,
          bgcolor: 'warning.main',
          color: 'warning.contrastText',
        }}
      >
        <MdiIcon path={mdiMonitorMultiple.path} size={0.7} />
      </Avatar>
    </Tooltip>
  )
}

function RoomAvatars({ entries }: { entries: PresenceState['entries'] }) {
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
          title={
            `${entry.displayName} is editing this too — saves are not merged` +
            ((entry.sessions ?? 1) > 1
              ? ` (in ${entry.sessions} places)`
              : '')
          }
        >
          <Avatar
            src={entry.photoURL}
            alt={entry.displayName}
            sx={{ bgcolor: entry.colour ?? 'primary.main' }}
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
