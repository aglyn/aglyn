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

import { mdiAlertCircleOutline, mdiMonitorMultiple } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Avatar, AvatarGroup, Box, Stack, Tooltip } from '@mui/material'
import type { PresencePerson, PresenceState } from '../hooks/use-presence'

/**
 * Initials for an identity that may have no picture at all.
 *
 * NOT a broken-image fallback (AGL-2486). Every SSO identity here has an
 * empty `photoURL` — `zach@aglyn.com`'s IdP asserts no picture and the
 * profile carries none — so for a whole class of account the initials ARE
 * the avatar, and they have to look deliberate rather than like a picture
 * that failed to load.
 *
 * Two initials where the name gives two, because a room of single letters
 * collides constantly and the colour alone is only six values wide.
 */
export function initialsFor(displayName: string): string {
  const words = String(displayName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

/**
 * Who else is in this document (AGL-675, AGL-2486).
 *
 * Renders nothing when you are alone AND presence is healthy — an empty slot
 * in the app bar of a single-player session is noise, and this must never
 * read as a status indicator that is "working" but showing zero.
 *
 * It does render when presence is BROKEN, which is the whole difference.
 * "Nobody else is here" and "presence never started" used to be the same
 * picture: an empty app bar. Zach opened two browsers, saw no sign of the
 * other, and had no way to tell which of those two things he was looking at.
 *
 * Deliberately NOT a lock, and the tooltip says so. Seeing a face makes
 * people coordinate socially, which avoids most collisions; but the thing
 * that actually protects their work is the concurrent-edit guard (AGL-674),
 * which shipped first for exactly this reason.
 */
export function PresenceAvatars({ presence }: { presence: PresenceState }) {
  const { people, status } = presence
  if (status === 'unauthorized' || status === 'error') {
    return <PresenceFaultBadge presence={presence} />
  }
  if (!people.length) return null

  return (
    <Stack direction="row" sx={{ alignItems: 'center' }}>
      <RoomAvatars people={people} />
    </Stack>
  )
}

/**
 * Presence is off, and says so (AGL-2486).
 *
 * The fault detail rides the `title` so it is one hover away rather than one
 * source-dive away — `stage` names the leg that failed (broker, sign-in,
 * announce, room) and `code` is the HTTP status or Firebase error code.
 */
function PresenceFaultBadge({ presence }: { presence: PresenceState }) {
  const { status, fault } = presence
  const reason =
    status === 'unauthorized'
      ? 'This account is not allowed in this document\u2019s presence room'
      : 'Presence could not start'
  return (
    <Tooltip
      title={
        `${reason}. Nobody will be shown here, and an empty stack does NOT ` +
        'mean you are alone. ' +
        (fault
          ? `Failed at: ${fault.stage} (${fault.code}) \u2014 ${fault.message}`
          : '')
      }
    >
      <Avatar
        data-aglyn-presence-fault={fault ? fault.stage : 'unknown'}
        aria-label="Live presence is unavailable"
        sx={{
          width: 28,
          height: 28,
          mr: 1,
          bgcolor: 'warning.main',
          color: 'warning.contrastText',
        }}
      >
        <MdiIcon path={mdiAlertCircleOutline.path} size={0.7} />
      </Avatar>
    </Tooltip>
  )
}

function RoomAvatars({ people }: { people: PresencePerson[] }) {
  return (
    <AvatarGroup
      max={4}
      sx={{
        mr: 1,
        '& .MuiAvatar-root': {
          width: 28,
          height: 28,
          fontSize: 12,
          fontWeight: 600,
          borderWidth: 2,
        },
      }}
    >
      {people.map((person) => (
        <Tooltip key={person.uid} title={describe(person)}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <Avatar
              // Undefined rather than an empty string: an empty `src` makes
              // the browser request the PAGE and then fail, which is how a
              // deliberate initials avatar starts logging 404s.
              src={person.photoURL || undefined}
              alt={person.displayName}
              data-aglyn-presence-self={person.isSelf ? '' : undefined}
              sx={{
                bgcolor: person.colour ?? 'primary.main',
                // YOU, elsewhere, must never be mistakable for a colleague.
                // A dashed ring in the warning colour is the same language
                // the old own-sessions badge used, kept on the avatar itself
                // now that your other tab has become a full participant.
                ...(person.isSelf && {
                  outline: '2px dashed',
                  outlineColor: 'warning.main',
                  outlineOffset: 1,
                }),
              }}
            >
              {initialsFor(person.displayName)}
            </Avatar>
            {person.isSelf ? (
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  right: -3,
                  bottom: -3,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'warning.main',
                  color: 'warning.contrastText',
                }}
              >
                <MdiIcon path={mdiMonitorMultiple.path} size={0.4} />
              </Box>
            ) : null}
          </Box>
        </Tooltip>
      ))}
    </AvatarGroup>
  )
}

/**
 * What the tooltip says, and why the two cases read so differently.
 *
 * Your own other session is a HAZARD, not company: two tabs are two
 * independent `CanvasManager`s, so the second save quietly replaces the
 * first and the concurrent-edit guard does not fire, because the stamp moved
 * on *your* write (AGL-674). They also share one local draft key (AGL-1256),
 * last writer wins. A colleague at least trips the guard.
 */
export function describe(person: PresencePerson): string {
  const places =
    person.sessions === 1 ? 'one other place' : `${person.sessions} other places`
  if (person.isSelf) {
    return (
      `This is YOU, in ${places} \u2014 another tab, or this account signed in ` +
      'elsewhere. Nothing merges between them: whichever one saves last wins, ' +
      'and it will not warn you, because both are you.'
    )
  }
  return (
    `${person.displayName} is editing this too` +
    (person.sessions > 1 ? ` (in ${person.sessions} places)` : '') +
    ' \u2014 saves are not merged.'
  )
}

PresenceAvatars.displayName = 'PresenceAvatars'

export default PresenceAvatars
