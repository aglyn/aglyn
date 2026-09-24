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
 * The Site users list puts every clause and the search on one query beneath
 * its newest-first order, and every shape that query takes has its
 * composite (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { SITE_ACCOUNT_LIST_QUERY } from './site-account-query'

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(SITE_ACCOUNT_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

const NEWEST = { path: 'createdAt', direction: 'desc' }

describe('the Site users query (AGL-3321)', () => {
  it('reads newest first, unfiltered', () => {
    expect(plan([])).toMatchObject({ filters: [], orderBy: NEWEST, refused: [] })
  })

  it('serves Status, an address and a name together, with the search', () => {
    const all = plan(
      [
        { field: 'suspended', op: 'equals', value: 'false' },
        { field: 'email', op: 'equals', value: 'Ann@Example.test' },
        { field: 'displayName', op: 'equals', value: '  Ann  Lee ' },
      ],
      ['Rae'],
    )
    expect(all.filters).toEqual([
      { path: 'displayNameTokens', op: 'array-contains', value: 'rae' },
      { path: 'suspended', op: '==', value: false },
      { path: 'email', op: '==', value: 'ann@example.test' },
      { path: 'displayNameLower', op: '==', value: 'ann lee' },
    ])
    expect(all.orderBy).toEqual(NEWEST)
    expect(all.refused).toEqual([])
  })

  it('serves a Joined range on the sort field itself, beside Status', () => {
    const range = plan([
      { field: 'createdAt', op: 'onOrAfter', value: '2026-09-01' },
      { field: 'suspended', op: 'equals', value: 'true' },
    ])
    expect(range.filters.map((filter) => [filter.path, filter.op])).toEqual([
      ['createdAt', '>='],
      ['suspended', '=='],
    ])
    expect(range.orderBy).toEqual(NEWEST)
  })

  it('gives the search the one array clause and refuses a Name word beside it by name', () => {
    const both = plan([{ field: 'displayName', op: 'contains', value: 'lee' }], ['rae'])
    expect(both.searched).toBe('rae')
    expect(both.refused).toEqual([
      {
        clause: { field: 'displayName', op: 'contains', value: 'lee' },
        reason: expect.stringMatching(/search/),
      },
    ])
  })

  it('offers no prefix or ends-with on a list that never sorts by them', () => {
    const refused = plan([
      { field: 'email', op: 'startsWith', value: 'ann' },
      { field: 'displayName', op: 'startsWith', value: 'ann' },
      { field: 'displayName', op: 'isNotEmpty', value: '' },
    ])
    expect(refused.filters).toEqual([])
    expect(refused.refused).toHaveLength(3)
  })

  it('ignores a Status it cannot read rather than guessing', () => {
    const status = plan([{ field: 'suspended', op: 'equals', value: 'maybe' }])
    expect(status.filters).toEqual([])
    expect(status.refused[0].reason).toMatch(/true or false/)
  })
})

describe('the Site users query has its indexes', () => {
  it('every shape it takes is in the index file', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
    )
    const needed = listQueryIndexes(SITE_ACCOUNT_LIST_QUERY)
    // Name words, the address, the name, Status — each beneath newest first.
    expect(
      needed.map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
      ),
    ).toEqual([
      'displayNameTokens:CONTAINS,createdAt:DESCENDING',
      'email:ASCENDING,createdAt:DESCENDING',
      'displayNameLower:ASCENDING,createdAt:DESCENDING',
      'suspended:ASCENDING,createdAt:DESCENDING',
    ])
    expect(missingListQueryIndexes(file, 'siteMembers', needed, 'COLLECTION')).toEqual([])
  })
})
