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
 * Index coverage for the booking reminder scan (AGL-1793).
 *
 * `remindersHandler` in `server.ts` asks for every booking starting in a
 * 23–25h window:
 *
 *     collectionGroup('bookings')
 *       .where('startsAtMs','>=',windowStart)
 *       .where('startsAtMs','<=',windowEnd)
 *
 * Two filters, but on ONE field, so this is a single-field range and not a
 * composite — and single-field is precisely where the trap is. Firestore's
 * automatic single-field indexes exist at **COLLECTION scope only**, so the
 * collection-group form needs an index asked for by name. Measured against
 * `aglyn-main` before this change, verbatim:
 *
 *     9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
 *     for collection bookings and field startsAtMs.
 *
 * The `bookings` collection group already had a COLLECTION_GROUP composite for
 * `status + expiresAtMs`, which is why this looked covered and was not: that
 * index cannot serve a query whose only field is `startsAtMs`, because
 * `startsAtMs` is not a prefix of it. **The presence of an index on a
 * collection group says nothing about the query beside it.**
 *
 * The consequence was a scheduled job that 500s on every beat: no 24-hour
 * reminder email was ever sent for any booking on any site, and the only trace
 * was a stack in the function log. This one was not in the original filing —
 * it came out of sweeping every `collectionGroup` call site in the repo against
 * the live index set, which is the habit worth keeping.
 *
 * **If you add or change a filter on the reminder scan, add its shape here.**
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
  indexes: Array<{ queryScope: string; order?: string; arrayConfig?: string }>
}

const CONFIG: { indexes: CompositeIndex[]; fieldOverrides: FieldOverride[] } =
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../../cloud/firebase-firestore.indexes.json',
      ),
      'utf8',
    ),
  )

const startsAtMs = CONFIG.fieldOverrides.find(
  (entry) =>
    entry.collectionGroup === 'bookings' && entry.fieldPath === 'startsAtMs',
)
const scopes = (entry?: FieldOverride) =>
  (entry?.indexes ?? []).map(
    (index) => `${index.queryScope}:${index.order ?? index.arrayConfig}`,
  )

describe('booking reminder collection-group scan (AGL-1793)', () => {
  it('declares the COLLECTION_GROUP index on bookings.startsAtMs', () => {
    expect(scopes(startsAtMs)).toContain('COLLECTION_GROUP:ASCENDING')
  })

  it('keeps the COLLECTION-scope indexes a fieldOverride would otherwise drop', () => {
    // A `fieldOverrides` entry REPLACES automatic single-field indexing rather
    // than adding to it. `startsAtMs` is read per-host by the slot and booking
    // list views, so dropping the COLLECTION scopes to fix the cron would
    // break the console in exchange.
    expect(scopes(startsAtMs)).toContain('COLLECTION:ASCENDING')
    expect(scopes(startsAtMs)).toContain('COLLECTION:DESCENDING')
  })

  it('still declares the separate composite the hold-expiry job needs', () => {
    // `expire-stale-holds`: .where('status','==',…).where('expiresAtMs','<',…)
    // A different job on the same collection group, and it does NOT cover the
    // reminder query — asserted here so a future cleanup cannot "consolidate"
    // the two and quietly restore the bug.
    const shapes = CONFIG.indexes
      .filter(
        (index) =>
          index.collectionGroup === 'bookings' &&
          index.queryScope === 'COLLECTION_GROUP',
      )
      .map((index) =>
        index.fields
          .map((field) => `${field.fieldPath}:${field.order}`)
          .join(' > '),
      )
    expect(shapes).toContain('status:ASCENDING > expiresAtMs:ASCENDING')
  })
})
