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
 * The site artifact lists' queries, and the composites they need (AGL-3321).
 *
 * The layouts page, the components card and the templates library put every
 * Filters-panel clause and the search word on their Firestore query
 * (`artifact-list-queries.ts`). Walking the document name, any mix of the
 * equalities and the one array clause is served by Firestore's automatic
 * single-field indexes; the one range each list offers, Updated, leads the
 * order it ranges over and so needs a composite per predicate field beside
 * it. A field added to a declaration fails here until its index is in
 * `cloud/firebase-firestore.indexes.json`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  COMPONENT_LIST_QUERY,
  LAYOUT_LIST_QUERY,
  TEMPLATE_LIST_BASE,
  TEMPLATE_LIST_QUERY,
} from '../utils/artifact-list-queries'

const INDEX_FILE = JSON.parse(
  readFileSync(
    join(__dirname, '../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const TEMPLATE_BASE = TEMPLATE_LIST_BASE.map((filter) => ({ path: filter.path }))

const LISTS: Array<{
  name: string
  collection: string
  declaration: ListQueryDeclaration
  base?: Array<{ path: string }>
  composites: number
}> = [
  // nameTokens, nameLower — each beside `updatedAt desc`.
  { name: 'layouts', collection: 'layouts', declaration: LAYOUT_LIST_QUERY, composites: 2 },
  // …and kind.
  { name: 'components', collection: 'components', declaration: COMPONENT_LIST_QUERY, composites: 3 },
  // …and kind, source.type and the library-row scope.
  {
    name: 'templates',
    collection: 'templates',
    declaration: TEMPLATE_LIST_QUERY,
    base: TEMPLATE_BASE,
    composites: 5,
  },
]

describe.each(LISTS)('the $name list query (AGL-3321)', (list) => {
  const needed = listQueryIndexes(list.declaration, list.base)
  const plan = (request: Parameters<typeof planListQuery>[1]) =>
    planListQuery(list.declaration, request, nameSearchNormalizers)

  it('THE CONTROL: walks the document name, with one composite per predicate beside the one range', () => {
    expect(list.declaration.sorts).toEqual([{ path: LIST_QUERY_ID_PATH, direction: 'asc' }])
    expect(needed).toHaveLength(list.composites)
    for (const index of needed) {
      expect(index.fields[1]).toEqual({ fieldPath: 'updatedAt', order: 'DESCENDING' })
    }
  })

  it('holds every composite the declaration needs', () => {
    expect(missingListQueryIndexes(INDEX_FILE, list.collection, needed, 'COLLECTION')).toEqual([])
  })

  it('puts the name, the Updated range and the search word on ONE query', () => {
    const served = plan({
      clauses: [
        { field: 'displayName', op: 'equals', value: '  Main  CHROME ' },
        { field: 'updatedAt', op: 'onOrAfter', value: '2026-09-01' },
      ],
      search: ['main'],
      base: list.base ? TEMPLATE_LIST_BASE : [],
    })
    expect(served.refused).toEqual([])
    expect(served.searched).toBe('main')
    expect(served.filters).toEqual(
      expect.arrayContaining([
        { path: 'nameTokens', op: 'array-contains', value: 'main' },
        { path: 'nameLower', op: '==', value: 'main chrome' },
        expect.objectContaining({ path: 'updatedAt', op: '>=' }),
      ]),
    )
    // The range leads the order it ranges over.
    expect(served.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
  })

  it('refuses a name "contains" beside the search, by name, rather than matching the page', () => {
    const served = plan({
      clauses: [{ field: 'displayName', op: 'contains', value: 'chrome' }],
      search: ['main'],
    })
    expect(served.refused).toEqual([
      {
        clause: { field: 'displayName', op: 'contains', value: 'chrome' },
        reason: expect.stringMatching(/search/),
      },
    ])
  })

  it('does not offer a name range, which would need the list ordered by the name', () => {
    const served = plan({ clauses: [{ field: 'displayName', op: 'startsWith', value: 'ma' }] })
    expect(served.refused).toHaveLength(1)
    expect(served.filters).toEqual([])
  })
})

describe('the templates library scope (AGL-3321)', () => {
  it('asks for library ROWS: one per starter, and no tombstones', () => {
    expect(TEMPLATE_LIST_BASE).toEqual([{ path: 'libraryRow', op: '==', value: true }])
  })

  it('filters Kind and Source on the stored values, together', () => {
    const served = planListQuery(
      TEMPLATE_LIST_QUERY,
      {
        clauses: [
          { field: 'kind', op: 'equals', value: 'layout' },
          { field: 'source', op: 'isAnyOf', value: 'marketplace,starter' },
        ],
        base: TEMPLATE_LIST_BASE,
      },
      nameSearchNormalizers,
    )
    expect(served.refused).toEqual([])
    expect(served.filters).toEqual([
      { path: 'libraryRow', op: '==', value: true },
      { path: 'kind', op: '==', value: 'layout' },
      { path: 'source.type', op: 'in', value: ['marketplace', 'starter'] },
    ])
    expect(served.orderBy).toEqual({ path: LIST_QUERY_ID_PATH, direction: 'asc' })
  })
})
