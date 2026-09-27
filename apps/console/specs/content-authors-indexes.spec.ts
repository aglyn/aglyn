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
 * The Authors table's query, and the composites it needs (AGL-3321).
 *
 * `hosts/{hostId}/authors` is filtered and searched ON its Firestore query —
 * `AUTHOR_LIST_QUERY`, planned by `planListQuery` — and each predicate beside
 * the table's one order is a composite the index file must hold, or the
 * query fails with `FAILED_PRECONDITION` in production and passes against
 * the emulator. The composites are derived from the declaration, so a field
 * added to it fails here until its index is in
 * `cloud/firebase-firestore.indexes.json`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { AUTHOR_LIST_QUERY } from '../components/content/author-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(
    join(__dirname, '../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const NEEDED = listQueryIndexes(AUTHOR_LIST_QUERY)

const plan = (request: Parameters<typeof planListQuery>[1]) =>
  planListQuery(AUTHOR_LIST_QUERY, request, nameSearchNormalizers)

describe('the Authors table query (AGL-3321)', () => {
  it('THE CONTROL: one order, and a composite per predicate field against it', () => {
    expect(AUTHOR_LIST_QUERY.sorts).toEqual([
      { path: 'name', direction: 'asc', column: 'name' },
    ])
    // nameTokens (the search and Name contains), nameLower (Name is),
    // schemaType (Type).
    expect(NEEDED).toHaveLength(3)
  })

  it('holds every composite the declaration needs', () => {
    expect(
      missingListQueryIndexes(INDEX_FILE, 'authors', NEEDED, 'COLLECTION'),
    ).toEqual([])
  })

  it('puts the type, the name and the search word on ONE query', () => {
    const served = plan({
      clauses: [
        { field: 'type', op: 'equals', value: 'Person' },
        { field: 'name', op: 'equals', value: '  Dana  SMITH ' },
      ],
      search: ['Dana'],
    })
    expect(served.filters).toEqual([
      { path: 'nameTokens', op: 'array-contains', value: 'dana' },
      { path: 'schemaType', op: '==', value: 'Person' },
      { path: 'nameLower', op: '==', value: 'dana smith' },
    ])
    expect(served.orderBy).toEqual({ path: 'name', direction: 'asc', column: 'name' })
    expect(served.refused).toEqual([])
  })

  it('refuses a Name contains beside the search, by name, rather than matching the page', () => {
    const served = plan({
      clauses: [{ field: 'name', op: 'contains', value: 'smith' }],
      search: ['dana'],
    })
    expect(served.searched).toBe('dana')
    expect(served.refused).toEqual([
      {
        clause: { field: 'name', op: 'contains', value: 'smith' },
        reason: expect.stringMatching(/search/),
      },
    ])
  })

  it('does not offer a name range, which would need the list ordered by nameLower', () => {
    const served = plan({
      clauses: [{ field: 'name', op: 'startsWith', value: 'da' }],
    })
    expect(served.filters).toEqual([])
    expect(served.refused).toHaveLength(1)
  })
})
