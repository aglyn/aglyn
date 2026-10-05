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

import {
  pluginVisitorDoors,
  type VisitorDoorCounts,
  visitorDoorStaffFlags,
} from '@aglyn/aglyn/plugin-manager/plugin-visitor-doors'
import { Chip, Tooltip } from '@mui/material'
import { Fragment } from 'react'

/**
 * A site's counts for every public door, as `/api/admin/hosts?orgId=…` joins
 * them (AGL-1681): by door, `null` where the row was not joined.
 */
export type StaffSiteDoorCounts = Readonly<Record<string, VisitorDoorCounts>>

/**
 * The at-a-glance door-abuse flags on the staff org detail page's Sites card
 * (AGL-1681) — so "my form stopped working" is answered by the page instead
 * of a raw Firestore query. One pair per door a plugin declares
 * (`visitorDoors`): a door refusing now, and the month's honeypot catches
 * (AGL-1831), the catches reporting the honeypot WORKING in the owner's own
 * sentence, so the two surfaces cannot drift into telling different stories
 * about one number.
 *
 * Same render-nothing discipline as the owner's notice: below one hit of
 * either counter there is NOTHING, because the counter documents persist
 * from their first trip forever and a "0 refused" chip on every healthy site
 * trains staff to ignore the chip that will one day be real. `doors == null`
 * also renders nothing — that is "not joined" (the picker projection, a
 * failed read), not a healthy zero.
 *
 * The chips are terse on purpose (the owner's wording is for owners); the
 * ceiling and the reset date live in the tooltip, rendered at the UTC
 * boundary the `YYYY-MM` key rolls over on.
 */
const StaffSiteDoorFlags = ({ doors }: { doors?: StaffSiteDoorCounts | null }) => {
  if (!doors) return null
  const flagged = pluginVisitorDoors()
    .map((door) => ({ door: door.door, ...visitorDoorStaffFlags(door, doors[door.door]) }))
    .filter((one) => one.refused || one.caught)
  if (!flagged.length) return null
  return (
    <>
      {flagged.map(({ door, refused, caught }) => (
        <Fragment key={door}>
          {refused ? (
            <Tooltip title={refused.detail}>
              <Chip
                size="small"
                color="error"
                variant="outlined"
                aria-label={refused.detail}
                label={refused.label}
              />
            </Tooltip>
          ) : null}
          {caught ? (
            <Tooltip title={caught.detail}>
              <Chip
                size="small"
                variant="outlined"
                aria-label={caught.detail}
                label={caught.label}
              />
            </Tooltip>
          ) : null}
        </Fragment>
      ))}
    </>
  )
}
StaffSiteDoorFlags.displayName = 'StaffSiteDoorFlags'

export default StaffSiteDoorFlags
