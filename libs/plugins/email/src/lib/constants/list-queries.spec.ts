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
 * Every Emails list asks its QUERY, and the index file holds every shape it
 * can ask (AGL-3321).
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
  EMAIL_LIST_QUERY,
  EMAIL_TEMPLATE_BASE,
  EMAIL_TEMPLATE_QUERY,
  LIST_MEMBER_QUERY,
  SUPPRESSION_LIST_QUERY,
} from './list-queries'

const indexFile = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
    'utf8',
  ),
)

describe('every Emails list has the composites its queries need', () => {
  it.each([
    ['suppressions', SUPPRESSION_LIST_QUERY, []],
    ['lists', EMAIL_LIST_QUERY, []],
    // Ordered by document id: equalities and one array clause merge on the
    // automatic single-field indexes, so it needs none.
    ['members', LIST_MEMBER_QUERY, []],
    ['screens', EMAIL_TEMPLATE_QUERY, [{ path: 'kind' }]],
  ] as const)('%s', (group, declaration, base) => {
    const needed = listQueryIndexes(declaration, base)
    expect(missingListQueryIndexes(indexFile, group, needed, 'COLLECTION')).toEqual([])
  })

  it('stays inside the budget', () => {
    expect(listQueryIndexes(SUPPRESSION_LIST_QUERY)).toHaveLength(2)
    expect(listQueryIndexes(EMAIL_LIST_QUERY)).toHaveLength(3)
    expect(listQueryIndexes(LIST_MEMBER_QUERY)).toHaveLength(0)
    expect(listQueryIndexes(EMAIL_TEMPLATE_QUERY, [{ path: 'kind' }])).toHaveLength(2)
  })
})

describe('the suppression list', () => {
  const plan = (request: Parameters<typeof planListQuery>[1]) =>
    planListQuery(SUPPRESSION_LIST_QUERY, request, nameSearchNormalizers)

  it('serves the reason, a date range and the search on one query', () => {
    const planned = plan({
      clauses: [
        { field: 'reason', op: 'isAnyOf', value: 'bounce,complaint' },
        { field: 'since', op: 'onOrAfter', value: '2026-09-01' },
      ],
      search: ['Dana'],
    })
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'emailTokens', op: 'array-contains', value: 'dana' },
      { path: 'reason', op: 'in', value: ['bounce', 'complaint'] },
      { path: 'createdAt', op: '>=', value: new Date(2026, 8, 1) },
    ])
    expect(planned.orderBy).toEqual({ path: 'createdAt', direction: 'desc', column: 'since' })
  })

  it('refuses an Address filter beside the search, by name', () => {
    const planned = plan({
      clauses: [{ field: 'email', op: 'contains', value: 'example' }],
      search: ['dana'],
    })
    expect(planned.served).toEqual([])
    expect(planned.refused).toHaveLength(1)
    expect(planned.refused[0].reason).toMatch(/search/)
  })
})

describe('the email lists list', () => {
  it('serves membership and the search together, in name order', () => {
    const planned = planListQuery(
      EMAIL_LIST_QUERY,
      { clauses: [{ field: 'kind', op: 'equals', value: 'dynamic' }], search: ['news'] },
      nameSearchNormalizers,
    )
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'nameTokens', op: 'array-contains', value: 'news' },
      { path: 'kind', op: '==', value: 'dynamic' },
    ])
    expect(planned.orderBy.path).toBe('name')
  })
})

describe('a list’s members', () => {
  it('serves How, the address and the search together', () => {
    const planned = planListQuery(
      LIST_MEMBER_QUERY,
      {
        clauses: [
          { field: 'via', op: 'equals', value: 'rule' },
          { field: 'email', op: 'equals', value: ' Dana@Example.com ' },
        ],
        search: ['dana'],
      },
      nameSearchNormalizers,
    )
    expect(planned.refused).toEqual([])
    expect(planned.filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'dana' },
      { path: 'via', op: '==', value: 'rule' },
      { path: 'email', op: '==', value: 'dana@example.com' },
    ])
    expect(planned.orderBy.path).toBe('__name__')
  })
})

describe('the email templates', () => {
  it('keeps the email scope under every clause', () => {
    const planned = planListQuery(
      EMAIL_TEMPLATE_QUERY,
      {
        clauses: [{ field: 'displayName', op: 'startsWith', value: 'Welcome' }],
        search: [],
        base: EMAIL_TEMPLATE_BASE,
      },
      nameSearchNormalizers,
    )
    expect(planned.filters[0]).toEqual({ path: 'kind', op: '==', value: 'email' })
    expect(planned.orderBy.path).toBe('nameLower')
    expect(planned.refused).toEqual([])
  })
})
