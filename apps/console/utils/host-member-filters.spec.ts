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
import {
  HOST_MEMBER_LIST_COLUMN_SORTS,
  HOST_MEMBER_LIST_QUERY,
  hostMemberListRequest,
} from './host-member-filters'

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  words: string[] = [],
  sort: (typeof HOST_MEMBER_LIST_COLUMN_SORTS)[number] | null = null,
) =>
  planListQuery(
    HOST_MEMBER_LIST_QUERY,
    hostMemberListRequest(clauses, words, sort),
    nameSearchNormalizers,
  )

const sortBy = (column: string, direction: 'asc' | 'desc') => {
  const found = HOST_MEMBER_LIST_COLUMN_SORTS.find(
    (sort) => sort.column === column && sort.direction === direction,
  )
  if (!found) throw new Error(`no ${column} ${direction}`)
  return found
}

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
    expect(several.orderBy).toMatchObject({ path: 'email', direction: 'asc' })
  })

  it('serves the search as a prefix of the stored, lower-cased address, beside a role', () => {
    const both = plan([{ field: 'role', op: 'isAnyOf', value: 'viewer,admin' }], ['Ann@'])
    expect(both.filters).toEqual([
      { path: 'role', op: 'in', value: ['viewer', 'admin'] },
      { path: 'email', op: '>=', value: 'ann@' },
      { path: 'email', op: '<=', value: 'ann@' },
    ])
    // The range is on the field the list sorts by, so the order stands.
    expect(both.orderBy).toMatchObject({ path: 'email', direction: 'asc' })
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

describe('every roster header sorts the whole roster (AGL-3680)', () => {
  it('orders the query by address either way and by Site access either way', () => {
    expect(plan([], [], sortBy('email', 'desc')).orderBy).toMatchObject({ path: 'email', direction: 'desc' })
    expect(plan([], [], sortBy('role', 'asc')).orderBy).toMatchObject({ path: 'role', direction: 'asc' })
    expect(plan([], [], sortBy('role', 'desc')).orderBy).toMatchObject({ path: 'role', direction: 'desc' })
  })

  it('falls back to A to Z, and says so, while searching or filtering', () => {
    for (const asked of [
      plan([], ['ann'], sortBy('role', 'asc')),
      plan([{ field: 'role', op: 'equals', value: 'admin' }], [], sortBy('email', 'desc')),
    ]) {
      expect(asked.orderBy).toMatchObject({ path: 'email', direction: 'asc' })
      expect(asked.sortFallback?.reason).toBe('alone')
      expect(asked.notices.join(' ')).toMatch(/sorts only with no filter or search on/)
    }
  })

  it('keeps A to Z under the search, which is a range on the address', () => {
    const searched = plan([], ['ann'], sortBy('email', 'asc'))
    expect(searched.orderBy).toMatchObject({ path: 'email', direction: 'asc' })
    expect(searched.sortFallback).toBeUndefined()
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
