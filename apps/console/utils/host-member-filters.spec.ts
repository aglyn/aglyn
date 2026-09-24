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
 * A site's collaborator roster filters by Site access and searches by
 * address, every clause on one query beneath the email order, and every
 * shape that query takes has its composite (AGL-3321).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { HOST_MEMBER_LIST_QUERY, hostMemberListRequest } from './host-member-filters'

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  words: string[] = [],
) =>
  planListQuery(HOST_MEMBER_LIST_QUERY, hostMemberListRequest(clauses, words), nameSearchNormalizers)

describe('the roster query (AGL-3321)', () => {
  it('reads by address, unfiltered', () => {
    expect(plan([])).toMatchObject({ filters: [], orderBy: { path: 'email', direction: 'asc' } })
  })

  it('serves one role as an equality and several as `in`, beneath the email order', () => {
    expect(plan([{ field: 'role', op: 'equals', value: 'author' }]).filters).toEqual([
      { path: 'role', op: '==', value: 'author' },
    ])
    const several = plan([{ field: 'role', op: 'isAnyOf', value: 'viewer, admin' }])
    expect(several.filters).toEqual([{ path: 'role', op: 'in', value: ['viewer', 'admin'] }])
    expect(several.orderBy).toEqual({ path: 'email', direction: 'asc' })
  })

  it('serves the search as a prefix of the stored, lower-cased address, beside a role', () => {
    const both = plan([{ field: 'role', op: 'isAnyOf', value: 'viewer,admin' }], ['Ann@'])
    expect(both.filters).toEqual([
      { path: 'role', op: 'in', value: ['viewer', 'admin'] },
      { path: 'email', op: '>=', value: 'ann@' },
      { path: 'email', op: '<=', value: 'ann@' },
    ])
    // The range is on the field the list sorts by, so the order stands.
    expect(both.orderBy).toEqual({ path: 'email', direction: 'asc' })
    expect(both.refused).toEqual([])
  })

  it('asks nothing for an empty search', () => {
    expect(plan([], []).filters).toEqual([])
    expect(plan([], ['  ']).filters).toEqual([])
  })

  it('refuses by name what it cannot serve, rather than guessing', () => {
    const refused = plan([
      { field: 'role', op: 'doesNotEqual', value: 'admin' },
      { field: 'status', op: 'equals', value: 'invited' },
    ])
    expect(refused.filters).toEqual([])
    expect(refused.refused.map((entry) => (entry.clause as { field: string }).field)).toEqual([
      'role',
      'status',
    ])
  })

  it('never takes an address clause from the panel, only from the search box', () => {
    expect(
      hostMemberListRequest([{ field: 'email', op: 'startsWith', value: 'x' }], []).clauses,
    ).toEqual([])
  })
})

describe('the roster query has its indexes', () => {
  it('every shape it takes is in the index file', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
    )
    const needed = listQueryIndexes(HOST_MEMBER_LIST_QUERY)
    // A role beneath the email order; the prefix is a range on the order itself.
    expect(needed).toHaveLength(1)
    expect(missingListQueryIndexes(file, 'members', needed, 'COLLECTION')).toEqual([])
  })
})
