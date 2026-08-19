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
 *
 * @jest-environment node
 */

/**
 * Index coverage for the reservation availability read (AGL-2159).
 *
 * `reserve.ts` narrowed its availability query from "500 documents of this
 * resource's entire history, in `__name__` order" to "the stays that could
 * still overlap, nearest first":
 *
 *     .where('resourceId', '==', resourceId)
 *     .where('checkOutDayMs', '>', checkInDayMs)
 *     .orderBy('checkOutDayMs')
 *     .limit(500)
 *
 * An equality plus an inequality/`orderBy` on a SECOND field needs a composite
 * index — Firestore's automatic single-field indexes do not answer it — and
 * this is the same trap AGL-1793 measured against `aglyn-main`: a query that
 * runs in every local test and every emulator and then throws
 * `9 FAILED_PRECONDITION` in production.
 *
 * The consequence of a missing index differs from AGL-1793's crons, and is
 * worth naming: the handler's `catch` turns it into a 500 the guest sees, so
 * reservations stop rather than silently misbehaving. That is the better
 * failure, but it is still every reservation on the site.
 *
 * A static assertion against the deployed index file, the same shape as
 * `cron-scan-indexes.spec.ts`. **If the filters on that query change, change
 * this.** The pairing is the point.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
}

const CONFIG: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

describe('reservation availability composite index (AGL-2159)', () => {
  const matching = CONFIG.indexes.filter(
    (index) => index.collectionGroup === 'reservations',
  )

  it('declares reservations (resourceId ASC, checkOutDayMs ASC) at COLLECTION scope', () => {
    const declared = matching.find(
      (index) =>
        index.queryScope === 'COLLECTION' &&
        index.fields.length === 2 &&
        index.fields[0].fieldPath === 'resourceId' &&
        index.fields[0].order === 'ASCENDING' &&
        index.fields[1].fieldPath === 'checkOutDayMs' &&
        index.fields[1].order === 'ASCENDING',
    )
    expect(declared).toBeDefined()
  })

  /**
   * FIELD ORDER IS NOT COSMETIC. Firestore requires the equality field first
   * and the inequality/`orderBy` field last; `(checkOutDayMs, resourceId)`
   * would be a different index that does not answer this query, and the file
   * would still look as though the query were covered.
   */
  it('puts the equality field first', () => {
    for (const index of matching) {
      if (
        index.fields.some((field) => field.fieldPath === 'checkOutDayMs') &&
        index.fields.some((field) => field.fieldPath === 'resourceId')
      ) {
        expect(index.fields[0].fieldPath).toBe('resourceId')
      }
    }
  })

  /**
   * The reservations query is COLLECTION-scoped — it is always rooted at one
   * host — so a COLLECTION_GROUP-only declaration would not answer it. Named
   * explicitly because AGL-1793's two indexes are the opposite case, and
   * copying that file's shape is the obvious way to get this wrong.
   */
  it('is not declared only at collection-group scope', () => {
    expect(matching.some((index) => index.queryScope === 'COLLECTION')).toBe(
      true,
    )
  })
})
