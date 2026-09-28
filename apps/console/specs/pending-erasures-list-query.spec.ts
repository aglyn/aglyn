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
 * The erasure queue's filters and search are on its query, and every shape
 * that query can take has its composite index (AGL-3321).
 *
 * `GET /api/admin/run-erasures` reads `orgs` through `runStaffListQuery`,
 * ordered by `erasureRequestedAt` — which is what limits it to organizations
 * with a request — with State a range over that same field and the search
 * and the Organization filter one array clause over `nameTokens`. Pinned
 * here against the index file the project deploys.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ERASURE_LIST_QUERY,
  splitErasureStateClauses,
} from '../utils/pending-erasures-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const NOW = 1_770_000_000_000
const HOLD = 7 * 24 * 60 * 60 * 1000

const plan = (clauses: Array<{ field: string; op: string; value: string }>, search: string[] = []) => {
  const split = splitErasureStateClauses(clauses, NOW, HOLD)
  return {
    split,
    answer: planListQuery(
      ERASURE_LIST_QUERY,
      { clauses: split.rest, search, base: split.base },
      nameSearchNormalizers,
    ),
  }
}

describe('the erasure queue has the composites its query shapes need', () => {
  it('holds every composite the declaration can ask for', () => {
    const needed = listQueryIndexes(ERASURE_LIST_QUERY)
    expect(missingListQueryIndexes(INDEX_FILE, 'orgs', needed)).toEqual([])
  })

  it('is exactly one: the name tokens, merged with the request order', () => {
    expect(
      listQueryIndexes(ERASURE_LIST_QUERY).map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
      ),
    ).toEqual(['nameTokens:CONTAINS,erasureRequestedAt:ASCENDING'])
  })
})

describe('every clause and the search word land on one query', () => {
  it('State and the search together, oldest request first', () => {
    const { split, answer } = plan([{ field: 'due', op: 'equals', value: 'due' }], ['Acme'])
    expect(split.refused).toEqual([])
    expect(answer.refused).toEqual([])
    expect(answer.searched).toBe('acme')
    expect(answer.filters).toEqual([
      { path: 'erasureRequestedAt', op: '<=', value: new Date(NOW - HOLD) },
      { path: 'nameTokens', op: 'array-contains', value: 'acme' },
    ])
    expect(answer.orderBy).toEqual({ path: 'erasureRequestedAt', direction: 'asc' })
  })

  it('Holding is every request younger than the hold', () => {
    const { answer } = plan([{ field: 'due', op: 'equals', value: 'holding' }])
    expect(answer.filters).toEqual([
      { path: 'erasureRequestedAt', op: '>', value: new Date(NOW - HOLD) },
    ])
  })

  it('an Organization filter is served on the name tokens', () => {
    const { answer } = plan([{ field: 'name', op: 'contains', value: 'Coffee' }])
    expect(answer.filters).toEqual([{ path: 'nameTokens', op: 'array-contains', value: 'coffee' }])
  })

  it('refuses an Organization filter beside the search, by name, rather than dropping one', () => {
    const { answer } = plan([{ field: 'name', op: 'contains', value: 'Coffee' }], ['acme'])
    expect(answer.searched).toBe('acme')
    expect(answer.refused).toEqual([
      {
        clause: { field: 'name', op: 'contains', value: 'Coffee' },
        reason: 'cannot be combined with the search — clear the search to use it',
      },
    ])
  })

  it('refuses a State it does not know, and applies none of it', () => {
    const { split, answer } = plan([{ field: 'due', op: 'isAnyOf', value: 'due,holding' }])
    expect(split.refused).toHaveLength(1)
    expect(answer.filters).toEqual([])
  })
})
