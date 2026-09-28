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

/**
 * A walk-in is checked against every stay of its room, not the page on
 * screen (AGL-3321).
 *
 * The Reservations card's walk-in dialog tested availability against the
 * rows the card had loaded — its current page, earliest check-in first — so
 * a stay on the next page did not block the dates and the front desk could
 * double-book the room. It now asks the query `reserve.ts` checks a booking
 * against, on the composite that query already has.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { missingListQueryIndexes } from '@aglyn/shared-ui-jsx/const/list-query-plan'

const source = readFileSync(join(__dirname, 'reservations-card.component.tsx'), 'utf8')
const walkIn = source.slice(
  source.indexOf('const handleWalkIn = useCallback('),
  source.indexOf('return (\n    <CardDisplay'),
)

describe('the walk-in availability check (AGL-3321)', () => {
  it('THE CONTROL: the handler was found', () => {
    expect(walkIn).toContain('isRangeAvailable')
  })

  it('reads the room’s stays that end after the arrival, by query', () => {
    expect(walkIn).toContain("where('resourceId', '==', walkIn.resourceId)")
    expect(walkIn).toContain("where('checkOutDayMs', '>', checkInDayMs)")
    expect(walkIn).toContain("orderBy('checkOutDayMs')")
  })

  it('never tests the loaded page', () => {
    expect(walkIn).not.toMatch(/\breservations\s*\.\s*filter\(/)
  })

  it('rides the composite the booking path declares', () => {
    const indexFile = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'),
        'utf8',
      ),
    )
    expect(
      missingListQueryIndexes(indexFile, 'reservations', [
        {
          fields: [
            { fieldPath: 'resourceId', order: 'ASCENDING' },
            { fieldPath: 'checkOutDayMs', order: 'ASCENDING' },
          ],
        },
      ]),
    ).toEqual([])
  })
})
