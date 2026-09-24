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
 * Composite-index coverage for the content entries table (AGL-2853).
 *
 * **The emulator does not enforce composite index requirements**, so
 * `content-entries-total-order.emulator.spec.ts` proves the walk is total and
 * cannot prove it RUNS in production: an equality filter followed by an
 * `orderBy` on another field fails there with `FAILED_PRECONDITION` unless the
 * pair is indexed. That is the shape of every filtered, sorted view the table
 * offers, so the coverage lives here as a static check against the index file.
 *
 * The shapes are DERIVED from the table's own declarations — every filter
 * field against every sort field, both directions — so a sortable column or a
 * filter added to `entry-list-query.ts` or `ENTRY_LIST_FILTER_FIELDS` fails
 * here until its index is added. Add it to
 * `cloud/firebase-firestore.indexes.json` and DEPLOY it before the code that
 * queries it; a promotion does not deploy indexes.
 *
 * Shapes the automatic single-field indexes serve are not listed: an
 * unfiltered sort, the name-ordered scan, and a filter on the very field the
 * table is sorted by, which the walk orders by name alone.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENTRY_LIST_SORT_FIELDS,
  entryListStoredSort,
} from '../components/content/entry-list-query'
import { ENTRY_LIST_FILTER_FIELDS } from '../utils/list-filters'

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}

const INDEXES: Array<{
  collectionGroup: string
  queryScope: string
  fields: IndexField[]
}> = JSON.parse(
  readFileSync(
    join(__dirname, '../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
).indexes

const signature = (fields: IndexField[]) =>
  fields.map((field) => `${field.fieldPath}:${field.order}`).join(' > ')

const ENTRY_SIGNATURES = new Set(
  INDEXES.filter(
    (index) =>
      index.collectionGroup === 'entries' && index.queryScope === 'COLLECTION',
  ).map((index) => signature(index.fields)),
)

/*
 * The STORED field each column walks, not the column's name: the Published
 * column is `publishedAt` to the grid and `publishSortAt` to the query
 * (AGL-3323), and an index on the name would be one no read ever uses.
 */
const STORED_SORT_FIELDS = ENTRY_LIST_SORT_FIELDS.map(
  (field) => entryListStoredSort({ field, direction: 'asc' }).field,
)

const REQUIRED = ENTRY_LIST_FILTER_FIELDS.flatMap((filter) =>
  STORED_SORT_FIELDS.filter((sort) => sort !== filter.path).flatMap(
    (sort) =>
      (['ASCENDING', 'DESCENDING'] as const).map((order) => ({
        what: `${filter.column} filter, sorted by ${sort} ${order.toLowerCase()}`,
        index: signature([
          { fieldPath: filter.path, order: 'ASCENDING' },
          { fieldPath: sort, order },
        ]),
      })),
  ),
)

describe('content entries composite indexes (AGL-2853)', () => {
  it('THE CONTROL: the table declares filters and sorts to derive from', () => {
    // Otherwise the table below is empty and every case vacuously passes.
    expect(ENTRY_LIST_FILTER_FIELDS.length).toBeGreaterThan(0)
    expect(ENTRY_LIST_SORT_FIELDS.length).toBeGreaterThan(0)
    expect(REQUIRED.length).toBe(14)
  })

  it('walks the Published column on its stored sort key (AGL-3323)', () => {
    expect(STORED_SORT_FIELDS).toContain('publishSortAt')
    expect(STORED_SORT_FIELDS).not.toContain('publishedAt')
  })

  it.each(REQUIRED)('covers $what', ({ index }) => {
    // Missing here means FAILED_PRECONDITION in production and a silent pass
    // against the emulator.
    expect(ENTRY_SIGNATURES.has(index)).toBe(true)
  })
})
