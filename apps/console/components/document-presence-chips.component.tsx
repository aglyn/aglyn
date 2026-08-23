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

/**
 * WHAT THE CHIPS ARE COUNTING, which is not the same thing on both surfaces.
 *
 * A presence room is one VERSION of a document. A list row names a DOCUMENT,
 * so its chips are the summary's roll-up across every version — and the copy
 * has to say so, because "2 people are in this" beside a row whose Open button
 * goes to version 7 reads as "2 people are in version 7", which may be false.
 * The reader is about to make a decision on that sentence.
 *
 * A detail page subscribes to one real room, so it can say `version` and mean
 * it. The two never share wording by accident: the scope is required at every
 * call site that is not a plain list row.
 */
export type PresenceChipScope = 'document' | 'version'

/** The sentence the chips carry, in the only two scopes that exist. */
export function presenceChipTooltip(
  names: string[],
  scope: PresenceChipScope,
): string {
  const who =
    names.length === 1
      ? `${names[0]} is`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are`
  if (scope === 'version') return `${who} editing this version right now.`
  // Deliberately hedged. The roll-up cannot tell you WHICH version, and a row
  // that quietly implies "the one you are about to open" is the lie this
  // feature is most likely to tell.
  return `${who} in this document right now — possibly in a different version.`
}

export function DocumentPresenceChips({
  people,
  size = 20,
  scope = 'document',
}: {
  people: PresentPerson[]
  size?: number
  scope?: PresenceChipScope
}) {
  // Nothing at all when the document is empty. A list of fifty rows must not
  // grow fifty empty slots to say "nobody", and the sparse case IS the common
  // one — measured on production, 2 occupied rooms across the project.
  if (!people.length) return null
  const visible = people.slice(0, MAX_ROW_CHIPS)
  const overflow = people.length - visible.length
  const names = people.map((person) => person.displayName)

  return (
    <Tooltip title={presenceChipTooltip(names, scope)}>
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
