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

// By their own modules rather than the barrel: the Inbox's specs replace
// `@aglyn/aglyn` with a closed world, and these are small.
import { utcMonthKey } from '@aglyn/aglyn/app-utils/utc-month'
import {
  pluginVisitorDoors,
  visitorDoorCaughtNotice,
  visitorDoorPausedNotice,
  type VisitorDoorPausedNotice,
} from '@aglyn/aglyn/plugin-manager/plugin-visitor-doors'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { Alert, AlertTitle, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { Fragment } from 'react'

/** The declared doors: compiled into the bundle, so the list never changes. */
const DOORS = pluginVisitorDoors()

/** One door's notices for a site: refusing now, and the month's catches. */
export interface VisitorDoorNoticeState {
  door: string
  paused: VisitorDoorPausedNotice | null
  caught: string | null
}

/**
 * Every declared public door's flood notices, for the site whose traffic
 * lands here (AGL-1666, AGL-1836, AGL-3080).
 *
 * A door is declared by the plugin that keeps it (`visitorDoors`), which names
 * the two site counters it keeps by month and the words; the Inbox names no
 * door. Each counter is a client-unwritable document host admins can already
 * read (AGL-1367), keyed by the SERVER's month through the shared
 * `utcMonthKey` — a key derived differently here would read zero refusals on
 * exactly the sites being refused.
 *
 * A hook, read by the page above its section guard, so the listens start with
 * the page rather than a frame later with a section. Two listens per door, in
 * the same order on every render: the list is compiled and never changes
 * length, which is what makes a hook per entry safe here.
 */
export function useVisitorDoorNotices(
  hostId: string | null | undefined,
): VisitorDoorNoticeState[] {
  const firestore = useFirestore()
  const notices: VisitorDoorNoticeState[] = []
  for (const door of DOORS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a compiled, fixed-length list
    const { data: refusedCounter } = useFirestoreDoc<any>(
      () => (hostId ? doc(firestore, 'hosts', hostId, 'counters', door.refusedCounter) : null),
      [firestore, hostId, door.refusedCounter],
    )
    // eslint-disable-next-line react-hooks/rules-of-hooks -- a compiled, fixed-length list
    const { data: caughtCounter } = useFirestoreDoc<any>(
      () => (hostId ? doc(firestore, 'hosts', hostId, 'counters', door.caughtCounter) : null),
      [firestore, hostId, door.caughtCounter],
    )
    notices.push({
      door: door.door,
      paused: visitorDoorPausedNotice(door, {
        refused: Number(refusedCounter?.[utcMonthKey()] ?? 0),
        ceiling: Number(refusedCounter?.['ceiling']) || undefined,
      }),
      caught: visitorDoorCaughtNotice(door, {
        caught: Number(caughtCounter?.[utcMonthKey()] ?? 0),
      }),
    })
  }
  return notices
}

/**
 * The notices themselves. The paused notice is a warning: until it, a
 * refusal existed in two places a site owner cannot see — a counters
 * document only Firestore's console renders, and one notification `system.`
 * bucket-muting can suppress at write time. The catch count is info rather
 * than warning on purpose: it reports protection WORKING — caught, dropped,
 * never stored or billed. Each renders nothing below one, because a counter
 * document persists from its first trip and a reassuring zero trains the
 * reader to ignore the row.
 */
export function VisitorDoorNotices({
  notices,
}: {
  notices: readonly VisitorDoorNoticeState[]
}) {
  return (
    <>
      {notices.map(({ door, paused, caught }) => (
        <Fragment key={door}>
          {paused ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle>{paused.title}</AlertTitle>
              <Typography component="div" variant="body2">
                {paused.message}
              </Typography>
              <Typography
                component="div"
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {paused.until}
              </Typography>
            </Alert>
          ) : null}
          {caught ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {caught}
            </Alert>
          ) : null}
        </Fragment>
      ))}
    </>
  )
}

export default VisitorDoorNotices
