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
import { useEffect, useMemo, useRef } from 'react'
import DocumentPresenceChips from './document-presence-chips.component'
import usePresence from '../hooks/use-presence'
import usePresenceSummary from '../hooks/use-presence-summary'
import type { PresentPerson } from '../hooks/use-presence-summary'

/**
 * Who is in this document, on the page that decides whether to open it
 * (AGL-2486).
 *
 * It is what lets a reader see who is in a document before opening it.
 *
 * ## A detail page WATCHES the room; it does not join it
 *
 * `observeOnly` — the whole point of the affordance is to report who is in a
 * document *before* you join, and a viewer who is announced by arriving has
 * already changed the answer they came to read. Every write is suppressed;
 * the subscription is not. The RTDB rules split exactly there, so this needs
 * no rules change.
 *
 * ## LIVE here, a snapshot on a list, and the difference is not arbitrary
 *
 * A list cannot subscribe: the rules admit one room at a time, so fifty rows
 * would be fifty listeners and ~97% of them would report an empty room. A
 * detail page is ONE document, so the objection does not apply and the better
 * answer is available — no polling interval, no window in which the page is
 * confidently wrong.
 *
 * ## Why it ALSO reads the summary
 *
 * A room is one VERSION. The list row that brought the reader here counted the
 * whole document, so a page that showed only its own room would contradict the
 * row they just clicked — "2 people in this" on the list, nobody here — which
 * reads as a bug in the feature rather than as two different questions. The
 * room is drawn precisely and live; anyone the roll-up knows about who is NOT
 * in this room is reported separately, as what they are: someone in another
 * version.
 *
 * The two disagree for up to one poll (the summary lags, the room does not),
 * so a membership change in the room refreshes the summary rather than waiting
 * the interval out. That narrows the skew to a round trip instead of 30s.
 */
export function DocumentPresenceLive({
  hostId,
  docType,
  docId,
  versionId,
  size = 24,
}: {
  hostId: string | undefined
  docType: 'screen' | 'layout' | 'component' | 'template' | 'email'
  docId: string | undefined
  /**
   * The version this page is ABOUT — the one its open action would take you
   * to. `undefined` is meaningful, not missing: a template has no versions
   * and shares the room key's `'current'` sentinel.
   */
  versionId: string | undefined
  size?: number
}) {
  const { people } = usePresence({
    hostId,
    docType,
    docId,
    versionId,
    observeOnly: true,
  })
  const { peopleIn, refresh } = usePresenceSummary(hostId)

  const inRoom = useMemo<PresentPerson[]>(
    () =>
      people.map((person) => ({
        uid: person.uid,
        displayName: person.displayName,
        ...(person.photoURL ? { photoURL: person.photoURL } : {}),
      })),
    [people],
  )

  // A stable description of WHO is in the room, so the refresh below fires on
  // a membership change and not on every heartbeat re-projection.
  const roomKey = inRoom
    .map((person) => person.uid)
    .sort()
    .join(',')
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    refreshRef.current()
  }, [roomKey])

  const elsewhere = useMemo(() => {
    const here = new Set(inRoom.map((person) => person.uid))
    return peopleIn(docType, docId ?? '').filter(
      (person) => !here.has(person.uid),
    )
  }, [inRoom, peopleIn, docType, docId])

  // Nothing at all when nobody is anywhere near this document — the common
  // case, and a reserved gap for it would cost every page a hole.
  if (!inRoom.length && !elsewhere.length) return null

  return (
    <Stack
      direction="row"
      data-aglyn-document-presence-live={String(inRoom.length)}
      sx={{ alignItems: 'center', gap: 0.75 }}
    >
      <DocumentPresenceChips people={inRoom} scope="version" size={size} />
      {elsewhere.length ? (
        <Tooltip
          title={
            `${elsewhere
              .map((person) => person.displayName)
              .join(', ')} ${elsewhere.length === 1 ? 'is' : 'are'} in a ` +
            `different version of this document, so opening this one would ` +
            `not put you alongside them.`
          }
        >
          <Box
            data-aglyn-document-presence-other-versions={String(
              elsewhere.length,
            )}
            sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}
          >
            {elsewhere.length === 1
              ? '1 in another version'
              : `${elsewhere.length} in other versions`}
          </Box>
        </Tooltip>
      ) : null}
    </Stack>
  )
}

DocumentPresenceLive.displayName = 'DocumentPresenceLive'

export default DocumentPresenceLive
