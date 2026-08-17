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
 * Index coverage for the commerce cron scans (AGL-1793).
 *
 * Both of these are `collectionGroup` scans with a SINGLE equality filter and
 * no `orderBy`, which is exactly the shape that reads as "surely this is free".
 * It is not. Firestore's automatic single-field indexes are created at
 * **COLLECTION scope only**, so a collection-group `where` on a field that runs
 * fine in every local run and in every emulator fails in production. Measured
 * against `aglyn-main` before this change, verbatim:
 *
 *     9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
 *     for collection checkouts and field status.
 *
 *     9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
 *     for collection restockAlerts and field notifiedAtMs.
 *
 * **A cron is the worst possible host for this bug.** Both handlers wrap the
 * scan in `try/catch` and return a 500, so there is no user staring at an error
 * — abandoned-cart recovery email and back-in-stock email simply never happen,
 * on every beat, forever, with nothing written to any document to say why. The
 * restock path had already been dead once for a different reason (AGL-1774);
 * this is the second, independent way the same feature produced silence.
 *
 * The coverage is a static assertion against the deployed index file, the same
 * shape as `install-pin-indexes.spec.ts` and `media-scope-indexes.spec.ts`.
 * **If you add or change a filter on either scan, add its shape here** — the
 * pairing is the point, because the alternative is a feature that reports
 * success while doing nothing.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface FieldOverride {
  collectionGroup: string
  fieldPath: string
  indexes: Array<{ queryScope: string; order?: string; arrayConfig?: string }>
}

const CONFIG: { fieldOverrides: FieldOverride[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const override = (collectionGroup: string, fieldPath: string) =>
  CONFIG.fieldOverrides.find(
    (entry) =>
      entry.collectionGroup === collectionGroup &&
      entry.fieldPath === fieldPath,
  )

const scopes = (entry?: FieldOverride) =>
  (entry?.indexes ?? []).map(
    (index) => `${index.queryScope}:${index.order ?? index.arrayConfig}`,
  )

describe('commerce cron collection-group scans (AGL-1793)', () => {
  // `process-abandoned.ts`:
  //   collectionGroup('checkouts').where('status','==','open').limit(200)
  it('declares the COLLECTION_GROUP index on checkouts.status', () => {
    expect(scopes(override('checkouts', 'status'))).toContain(
      'COLLECTION_GROUP:ASCENDING',
    )
  })

  // `process-restock.ts`:
  //   collectionGroup('restockAlerts').where('notifiedAtMs','==',null).limit(200)
  //
  // The `null` is load-bearing and deliberate: `notify-restock.ts` writes
  // `notifiedAtMs: null` EXPLICITLY when the alert is created, and a document
  // that merely omitted the field would not be indexed and would match nothing
  // — the index would be present and the scan would still return empty.
  it('declares the COLLECTION_GROUP index on restockAlerts.notifiedAtMs', () => {
    expect(scopes(override('restockAlerts', 'notifiedAtMs'))).toContain(
      'COLLECTION_GROUP:ASCENDING',
    )
  })

  it.each([
    ['checkouts', 'status'],
    ['restockAlerts', 'notifiedAtMs'],
  ])(
    'keeps the COLLECTION-scope indexes a fieldOverride would otherwise drop: %s.%s',
    (collectionGroup, fieldPath) => {
      // A `fieldOverrides` entry REPLACES Firestore's automatic single-field
      // indexing for that field rather than adding to it. Declaring only the
      // collection-group scope would delete the ordinary per-host indexes as a
      // side effect of fixing a cron — and `status` in particular is read
      // per-host on the storefront.
      const declared = scopes(override(collectionGroup, fieldPath))
      expect(declared).toContain('COLLECTION:ASCENDING')
      expect(declared).toContain('COLLECTION:DESCENDING')
    },
  )
})
