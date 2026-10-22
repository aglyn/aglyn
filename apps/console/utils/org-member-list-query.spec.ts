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
 * The team roster's filters and search are ONE query over
 * `orgs/{orgId}/members`, and none of its shapes needs a composite index
 * (AGL-3321).
 */

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { ORG_MEMBER_LIST_QUERY } from './org-member-list-query'

const plan = (clauses: Array<{ field: string; op: string; value: string }>, search: string[] = []) =>
  planListQuery(ORG_MEMBER_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

describe('the team roster query (AGL-3321)', () => {
  it('puts Role, Access and the search on one query, in the roster\'s own order', () => {
    const all = plan(
      [
        { field: 'role', op: 'isAnyOf', value: 'admin,editor' },
        { field: 'access', op: 'equals', value: 'collaborator' },
      ],
      ['Lovelace'],
    )
    expect(all.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'lovelace' },
      { path: 'role', op: 'in', value: ['admin', 'editor'] },
      { path: 'consoleUserType', op: '==', value: 'collaborator' },
    ])
    expect(all.orderBy).toEqual({ path: '__name__', direction: 'asc' })
    expect(all.refused).toEqual([])
  })

  it('needs no composite index: equalities and one array clause over the document id', () => {
    // Firestore serves these by merging single-field indexes; a declaration
    // that grew a range or a second order would show up here first.
    expect(listQueryIndexes(ORG_MEMBER_LIST_QUERY)).toEqual([])
  })

  it('offers nothing it cannot serve, and says so by name', () => {
    const refused = plan([
      { field: 'member', op: 'contains', value: 'ada' },
      { field: 'role', op: 'startsWith', value: 'ad' },
    ])
    expect(refused.served).toEqual([])
    expect(refused.refused.map((entry) => (entry.clause as { field: string }).field)).toEqual([
      'member',
      'role',
    ])
  })
})
