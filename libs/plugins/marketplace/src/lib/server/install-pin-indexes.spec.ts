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
 * Index coverage for the derived install counts (AGL-1419).
 *
 * **The emulator does not enforce index requirements**, and it does not have
 * to be a composite index to bite: Firestore auto-creates single-field indexes
 * at COLLECTION scope ONLY, so a collection-group `where` on a field that
 * works perfectly in every local run fails in production with
 * `FAILED_PRECONDITION`. Verbatim, from `aglyn-main` before this change:
 *
 *     9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index
 *     for collection installs and field listingId.
 *
 * So the coverage is a static assertion against the deployed index file, the
 * same shape as `media-scope-indexes.spec.ts` and for the same reason: the
 * alternative is finding out from a listing page that quietly stopped
 * deriving anything.
 *
 * `install-pin-counts.ts` degrades safely — it reports "not counted" rather
 * than zero, and the page falls back to AGL-1418's reconciliation — but
 * degrading safely is not the same as working, and a fallback nobody notices
 * is how the counters drifted in the first place. **If you add or change a
 * filter in `countLivePins` / `countLivePinsByVersion`, add its shape here.**
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
      join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
      'utf8',
    ),
  )

const signature = (fields: IndexField[]) =>
  fields
    .map((field) => `${field.fieldPath}:${field.arrayConfig ? 'ARRAY' : field.order}`)
    .join(' > ')

describe('install pin count indexes (AGL-1419)', () => {
  it('declares the COLLECTION_GROUP index on installs.listingId', () => {
    // `countLivePins`: collectionGroup('installs').where('listingId','==',id).count()
    //
    // A single-field query, and still not free: COLLECTION_GROUP scope has to
    // be asked for by name in `fieldOverrides`. Without this entry the whole
    // feature silently reverts to the stored accumulators.
    const override = CONFIG.fieldOverrides.find(
      (entry) =>
        entry.collectionGroup === 'installs' && entry.fieldPath === 'listingId',
    )
    expect(override).toBeDefined()
    expect(
      override?.indexes.some(
        (index) =>
          index.queryScope === 'COLLECTION_GROUP' && index.order === 'ASCENDING',
      ),
    ).toBe(true)
  })

  it('keeps the COLLECTION-scope indexes a fieldOverride would otherwise drop', () => {
    // A `fieldOverrides` entry REPLACES Firestore's automatic single-field
    // indexing for that field rather than adding to it. Declaring only the
    // collection-group scope would delete the ordinary per-org/per-host
    // indexes on `installs.listingId` as a side effect of adding a feature.
    const override = CONFIG.fieldOverrides.find(
      (entry) =>
        entry.collectionGroup === 'installs' && entry.fieldPath === 'listingId',
    )
    const scopes = (override?.indexes ?? []).map(
      (index) => `${index.queryScope}:${index.order ?? index.arrayConfig}`,
    )
    expect(scopes).toContain('COLLECTION:ASCENDING')
    expect(scopes).toContain('COLLECTION:DESCENDING')
  })

  it('declares the composite index behind the per-version split', () => {
    // `countLivePinsByVersion`:
    //   .where('listingId','==',id).where('version','==',v).count()
    const shapes = new Set(
      CONFIG.indexes
        .filter(
          (index) =>
            index.collectionGroup === 'installs' &&
            index.queryScope === 'COLLECTION_GROUP',
        )
        .map((index) => signature(index.fields)),
    )
    expect(shapes).toContain('listingId:ASCENDING > version:ASCENDING')
  })
})
