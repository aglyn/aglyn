/**
 * @jest-environment node
 *
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
 * The staff site page says whether the leaving notice is on for the site, and
 * until when (AGL-3452). The data half — `/api/admin/sites` reading the
 * window off the organization — is asserted in `admin-sites-list-route`;
 * this is the line staff read, and the page actually printing it.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { staffLeavingNoticeLabel } from '../utils/staff-leaving-notice'

describe('the leaving-notice line on the staff site page', () => {
  it('names the end of the window while it is on', () => {
    const until = Date.UTC(2026, 9, 15, 14, 30)
    expect(staffLeavingNoticeLabel(until, (ms) => new Date(ms).toISOString())).toBe(
      'Leaving notice: on until 2026-10-15T14:30:00.000Z — links to other domains open a “You’re leaving” page first',
    )
  })

  it('says it is off rather than saying nothing', () => {
    expect(staffLeavingNoticeLabel(null)).toBe(
      'Leaving notice: off — links to other domains open directly',
    )
    expect(staffLeavingNoticeLabel(undefined)).toMatch(/^Leaving notice: off/)
  })

  it('is printed on the page, from the site row the page already loads', () => {
    const page = readFileSync(
      join(__dirname, '../app/(app)/admin/sites/[hostId]/page.tsx'),
      'utf8',
    )
    expect(page).toMatch(/site\?\.org\?\.leavingNoticeUntil/)
    expect(page).toMatch(/staffLeavingNoticeLabel\(leavingNoticeUntil\)/)
  })
})
