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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A SITE'S LEADS BY FIRST SIGHTING HAVE BOTH DIRECTIONS (AGL-3443).
 *
 * Two readers select one site's share of `orgs/{orgId}/leads` with
 * `visibleTo array-contains-any scopeTokensForHost(hostId)` and a range on
 * `firstSeenAtMs`:
 *
 *   - the daily digest (`server/daily-digest-route.ts`), `firstSeenAtMs <=`
 *     the age cutoff, ordered `firstSeenAtMs desc`;
 *   - the lead funnel under a site (`components/reports/lead-funnel-card.tsx`),
 *     a window ordered `firstSeenAtMs desc` and two `count()`s over the range.
 *
 * The counts name no `orderBy`, so Firestore orders them by the range field
 * ASCENDING, and a composite serves one direction only: the window and the
 * counts over identical fields need two indexes. Neither was declared when
 * leads moved to the org collection (AGL-3275), and production answered
 * every one of these reads `9 FAILED_PRECONDITION` — the digest skipped every
 * workspace with an old unworked lead, and the site funnel never loaded.
 *
 * The organization-level funnel passes no tokens and adds no `visibleTo`
 * clause, so its single-field range needs nothing declared.
 */

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}

const INDEX_FILE: {
  indexes: Array<{ collectionGroup: string; queryScope: string; fields: IndexField[] }>
} = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const leadShapes = INDEX_FILE.indexes
  .filter((index) => index.collectionGroup === 'leads' && index.queryScope === 'COLLECTION')
  .map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.arrayConfig ?? field.order}`).join(' > '),
  )

describe('a site’s leads by first sighting (AGL-3443)', () => {
  it('declares the descending composite the digest and the funnel window order by', () => {
    expect(leadShapes).toContain('visibleTo:CONTAINS > firstSeenAtMs:DESCENDING')
  })

  it('declares the ascending composite the funnel’s unordered counts are served by', () => {
    expect(leadShapes).toContain('visibleTo:CONTAINS > firstSeenAtMs:ASCENDING')
  })
})
