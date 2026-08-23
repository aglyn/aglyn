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

import { Box, Stack, Tooltip } from '@mui/material'
import MemberAvatar from './member-avatar.component'
import type { PresentPerson } from '../hooks/use-presence-summary'

/**
 * Who is already in this document, small enough for a list row (AGL-2486).
 *
 * Zach: "add the presence avatars indicators to the detail page and list rows
 * as well to easily identify who is currently in the document already before
 * joining."
 *
 * ## Not a second avatar
 *
 * `MemberAvatar` does the work — the same photo-then-initials resolution, the
 * same seeded colour, the same `referrerPolicy`. Only the SIZE and the cap
 * differ, because a table row has less space than an app bar and no room for
 * a self badge. Everything this file adds is layout.
 *
 * ## Why the colour is seeded per PERSON here, not per session
 *
 * In a room, colour distinguishes SESSIONS so a chip can be matched to the
 * cursor it draws. A list has no cursors and no sessions — it answers "who",
 * not "where" — so it seeds on the uid and a person keeps one colour down the
 * whole list. The summary deliberately carries no colour for this reason: it
 * would be a room's answer to a question the list is not asking.
 */

/** Enough to read at a glance; past this a row says how many more. */
const MAX_ROW_CHIPS = 3

export function DocumentPresenceChips({
  people,
  size = 20,
}: {
  people: PresentPerson[]
  size?: number
}) {
  // Nothing at all when the document is empty. A list of fifty rows must not
  // grow fifty empty slots to say "nobody", and the sparse case IS the common
  // one — measured on production, 2 occupied rooms across the project.
  if (!people.length) return null
  const visible = people.slice(0, MAX_ROW_CHIPS)
  const overflow = people.length - visible.length
  const names = people.map((person) => person.displayName)

  return (
    <Tooltip
      title={
        people.length === 1
          ? `${names[0]} is editing this right now.`
          : `${names.slice(0, -1).join(', ')} and ${
              names[names.length - 1]
            } are editing this right now.`
      }
    >
      <Stack
        direction="row"
        data-aglyn-document-presence={String(people.length)}
        // Overlapped like the app-bar stack, and for the same reason: a row
        // of faces reads as a group rather than a list of separate things.
        sx={{ alignItems: 'center', pl: 0.5 }}
      >
        {visible.map((person, index) => (
          <Box
            key={person.uid}
            sx={{
              display: 'inline-flex',
              ml: index === 0 ? 0 : `-${Math.round(size / 4)}px`,
              // EARLIER chip on top, so each ring is drawn over its
              // neighbour rather than under it.
              zIndex: visible.length - index,
            }}
          >
            <MemberAvatar
              name={person.displayName}
              photoURL={person.photoURL}
              colourSeed={person.uid}
              size={size}
            />
          </Box>
        ))}
        {overflow > 0 ? (
          <Box
            data-aglyn-document-presence-overflow={String(overflow)}
            sx={{
              ml: 0.5,
              fontSize: 11,
              fontWeight: 600,
              color: 'text.secondary',
            }}
          >
            {`+${overflow}`}
          </Box>
        ) : null}
      </Stack>
    </Tooltip>
  )
}

DocumentPresenceChips.displayName = 'DocumentPresenceChips'

export default DocumentPresenceChips
