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
 * Composite-index coverage for the content entries table (AGL-2853,
 * AGL-3321).
 *
 * **The emulator does not enforce composite index requirements**, so
 * `content-entries-total-order.emulator.spec.ts` proves the walk is total and
 * cannot prove it RUNS in production: a predicate followed by an `orderBy` on
 * another field fails there with `FAILED_PRECONDITION` unless the pair is
 * indexed. That is the shape of every filtered, searched or sorted view the
 * table offers, so the coverage lives here as a static check against the
 * index file.
 *
 * The composites are DERIVED from the table's own declaration,
 * `ENTRY_LIST_QUERY`, by `listQueryIndexes`: one per predicate field per order
 * a narrowed list may take. A filter, a search or an order added to it fails
 * here until its index is in `cloud/firebase-firestore.indexes.json` — add it
 * and DEPLOY it before the code that queries it; a promotion does not deploy
 * indexes.
 *
 * Shapes the automatic single-field indexes serve are not listed: an
 * unfiltered sort, and the name-ordered scan behind the walk's second
 * segment, whose equality and `array-contains` predicates index merging
 * answers from each field's own index.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ENTRY_LIST_QUERY,
  ENTRY_LIST_SORT_FIELDS,
  entryListStoredSort,
  planEntryList,
} from '../components/content/entry-list-query'
import { ENTRY_LIST_FILTER_FIELDS } from '../utils/list-filters'

const INDEX_FILE = JSON.parse(
  readFileSync(
    join(__dirname, '../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const NEEDED = listQueryIndexes(ENTRY_LIST_QUERY)

const describeIndex = (index: (typeof NEEDED)[number]) =>
  index.fields
    .map((field) => `${field.fieldPath} ${field.order ?? field.arrayConfig}`)
    .join(', ')

/** A clause of every kind the panel offers, and the search. */
const NARROWINGS = [
  { clauses: [{ field: 'status', op: 'equals', value: 'draft' }], search: [] },
  { clauses: [{ field: 'status', op: 'isAnyOf', value: 'draft,scheduled' }], search: [] },
  { clauses: [{ field: 'categoryId', op: 'equals', value: 'guides' }], search: [] },
  { clauses: [{ field: 'authorId', op: 'equals', value: 'author-1' }], search: [] },
  { clauses: [{ field: 'title', op: 'contains', value: 'sourdough' }], search: [] },
  { clauses: [], search: ['sourdough'] },
  { clauses: [{ field: 'publishedAt', op: 'onOrAfter', value: '2026-09-01' }], search: [] },
  { clauses: [{ field: 'updatedAt', op: 'before', value: '2026-09-01' }], search: [] },
  {
    clauses: [
      { field: 'status', op: 'equals', value: 'published' },
      { field: 'categoryId', op: 'equals', value: 'guides' },
      { field: 'authorId', op: 'equals', value: 'author-1' },
      { field: 'publishedAt', op: 'after', value: '2026-01-01' },
    ],
    search: ['sourdough'],
  },
]

const COLUMN_SORTS = ENTRY_LIST_SORT_FIELDS.flatMap((field) =>
  (['asc', 'desc'] as const).map((direction) => ({ field, direction })),
)

describe('content entries composite indexes (AGL-2853, AGL-3321)', () => {
  it('THE CONTROL: the table declares predicates and orders to derive from', () => {
    // Otherwise the list below is empty and every case vacuously passes.
    expect(ENTRY_LIST_FILTER_FIELDS.length).toBeGreaterThan(0)
    expect(ENTRY_LIST_QUERY.sorts.length).toBe(3)
    // Four predicate fields — status, category, author, title tokens — times
    // three orders. The budget this list was designed to (AGL-3321).
    expect(NEEDED).toHaveLength(12)
  })

  it('walks the Published column on its stored sort key (AGL-3323)', () => {
    const stored = ENTRY_LIST_SORT_FIELDS.map(
      (field) => entryListStoredSort({ field, direction: 'asc' }).field,
    )
    expect(stored).toContain('publishSortAt')
    expect(stored).not.toContain('publishedAt')
    expect(ENTRY_LIST_QUERY.sorts[0]).toMatchObject({
      path: 'publishSortAt',
      direction: 'desc',
    })
  })

  it('holds every composite the declaration needs', () => {
    // Missing here means FAILED_PRECONDITION in production and a silent pass
    // against the emulator.
    expect(
      missingListQueryIndexes(INDEX_FILE, 'entries', NEEDED, 'COLLECTION').map(
        describeIndex,
      ),
    ).toEqual([])
  })

  it('never reads a narrowed list in an order the declaration does not index', () => {
    for (const narrowing of NARROWINGS) {
      for (const sort of COLUMN_SORTS) {
        const view = planEntryList({ ...narrowing, sort })
        expect({ narrowing, sort, filters: view.filters.length > 0 }).toEqual({
          narrowing,
          sort,
          filters: true,
        })
        expect(
          ENTRY_LIST_QUERY.sorts.some(
            (declared) =>
              declared.path === view.order.field &&
              declared.direction === view.order.direction,
          ),
        ).toBe(true)
      }
    }
  })
})
