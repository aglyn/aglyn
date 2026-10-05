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
 * Index coverage for the per-service availability reads (AGL-3483).
 *
 * `slotsHandler` lists a service's open times and `bookHandler` re-checks the
 * chosen slot inside its transaction. Both read one host's bookings the same
 * way:
 *
 *     hosts/{hostId}/bookings
 *       .where('serviceId','==',serviceId)
 *       .where('startsAtMs','>=',…)
 *
 * An equality on one field and a range on ANOTHER is a composite, at
 * COLLECTION scope. The single-field `startsAtMs` overrides cannot serve it:
 * Firestore merges indexes only for equalities, never for a range beside one.
 * Measured against `aglyn-main` before this change, verbatim:
 *
 *     9 FAILED_PRECONDITION: The query requires an index.
 *
 * The emulator does not enforce composite indexes, so every spec and the
 * seeded stack showed the widget working. In production the slot listing
 * 500'd for every service on every site, and the widget, reading that as an
 * empty list, told each visitor "No open times in the next 60 days". No
 * booking could be taken anywhere.
 *
 * **If you add or change a filter on either read, add its shape here.**
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}
interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: IndexField[]
}

const CONFIG: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const collectionShapes = CONFIG.indexes
  .filter(
    (index) =>
      index.collectionGroup === 'bookings' &&
      index.queryScope === 'COLLECTION',
  )
  .map((index) =>
    index.fields
      .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
      .join(' > '),
  )

describe('per-service booking reads (AGL-3483)', () => {
  it('declares the COLLECTION composite on serviceId then startsAtMs', () => {
    // Equality field first: a composite serves an equality-plus-range query
    // only when the equality field leads and the range field follows it.
    expect(collectionShapes).toContain(
      'serviceId:ASCENDING > startsAtMs:ASCENDING',
    )
  })

  it('declares it at COLLECTION scope, where both handlers read', () => {
    // A COLLECTION_GROUP index of the same shape would not serve a query on
    // one host's `bookings` subcollection.
    const groupOnly = CONFIG.indexes.filter(
      (index) =>
        index.collectionGroup === 'bookings' &&
        index.queryScope === 'COLLECTION_GROUP' &&
        index.fields[0]?.fieldPath === 'serviceId',
    )
    expect(groupOnly).toHaveLength(0)
  })
})
