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
 * @jest-environment node
 */

/**
 * Index coverage for the bookings export's filtered reads
 * (`bookings-transfer.ts`), each on one site's `bookings`:
 *
 *     .where('serviceId','==',…).orderBy('startsAtMs').orderBy(__name__)
 *     .where('email','==',…).orderBy('startsAtMs').orderBy(__name__)
 *
 * An equality on one field ordered by ANOTHER is a composite at COLLECTION
 * scope; the emulator does not enforce composites, so only this file stands
 * between the export and a `FAILED_PRECONDITION` in production. The unfiltered
 * read (by `startsAtMs`) and the upcoming one (a range on `endsAtMs`, ordered
 * by it) ride single-field indexes, which no field override here exempts.
 *
 * **If you add or change a filter in the export, add its shape here.**
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
interface FieldOverride {
  collectionGroup: string
  fieldPath: string
  indexes: Array<{ queryScope: string; order?: string }>
}

const CONFIG: { indexes: CompositeIndex[]; fieldOverrides?: FieldOverride[] } =
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../../cloud/firebase-firestore.indexes.json',
      ),
      'utf8',
    ),
  )

const collectionShapes = CONFIG.indexes
  .filter(
    (index) =>
      index.collectionGroup === 'bookings' && index.queryScope === 'COLLECTION',
  )
  .map((index) =>
    index.fields
      .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`)
      .join(' > '),
  )

describe('the bookings export’s reads', () => {
  it('has the COLLECTION composite for one service’s bookings', () => {
    expect(collectionShapes).toContain(
      'serviceId:ASCENDING > startsAtMs:ASCENDING',
    )
  })

  it('has the COLLECTION composite for one booker’s bookings', () => {
    expect(collectionShapes).toContain('email:ASCENDING > startsAtMs:ASCENDING')
  })

  it('keeps the ascending single-field indexes the unfiltered and upcoming reads ride', () => {
    for (const fieldPath of ['startsAtMs', 'endsAtMs']) {
      const override = (CONFIG.fieldOverrides ?? []).find(
        (one) =>
          one.collectionGroup === 'bookings' && one.fieldPath === fieldPath,
      )
      // No override keeps Firestore's automatic indexes; one must keep this.
      if (override) {
        expect(override.indexes).toContainEqual(
          expect.objectContaining({
            queryScope: 'COLLECTION',
            order: 'ASCENDING',
          }),
        )
      }
    }
  })
})
