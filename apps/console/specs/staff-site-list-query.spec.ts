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
 * The staff Sites list's filters and search are on its query, and every
 * shape that query can take has its index (AGL-3378). A clause the plan puts
 * on a query with no composite behind it throws FAILED_PRECONDITION for every
 * reader, so it fails here instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { listFilterOperators } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  STAFF_SITE_LIST_FILTER_FIELDS,
  STAFF_SITE_LIST_QUERY,
} from '../utils/staff-site-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(STAFF_SITE_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

describe('the staff Sites list has the composites its query shapes need', () => {
  it('every shape is in the index file the project deploys', () => {
    expect(
      missingListQueryIndexes(INDEX_FILE, 'hosts', listQueryIndexes(STAFF_SITE_LIST_QUERY)),
    ).toEqual([])
  })

  it('names exactly one merged composite per equality, under the one range', () => {
    const shapes = listQueryIndexes(STAFF_SITE_LIST_QUERY).map((index) =>
      index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
    )
    expect(shapes.sort()).toEqual([
      'cname:ASCENDING,createdAt:DESCENDING',
      'hasCustomDomain:ASCENDING,createdAt:DESCENDING',
      'nameLower:ASCENDING,createdAt:DESCENDING',
      'orgId:ASCENDING,createdAt:DESCENDING',
      'searchTokens:CONTAINS,createdAt:DESCENDING',
      'subdomain:ASCENDING,createdAt:DESCENDING',
      'suspended:ASCENDING,createdAt:DESCENDING',
    ])
  })

  it('offers ONE range per table: Created, and no other inequality', () => {
    const RANGES = ['startsWith', 'endsWith', 'isNotEmpty', '!=', '>', '>=', '<', '<=']
    const ranged = STAFF_SITE_LIST_FILTER_FIELDS.filter(
      (field) =>
        field.kind === 'date' || listFilterOperators(field).some((op) => RANGES.includes(op)),
    ).map((field) => field.column)
    expect(ranged).toEqual(['createdAt'])
  })
})

describe('every clause and the search word land on one query', () => {
  it('organization, custom domain and the search, in document-id order', () => {
    const answer = plan(
      [
        { field: 'orgId', op: 'equals', value: 'org-1' },
        { field: 'hasCustomDomain', op: 'is', value: 'true' },
      ],
      ['Bakery'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.searched).toBe('bakery')
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'searchTokens array-contains',
      'orgId ==',
      'hasCustomDomain ==',
    ])
    expect(answer.orderBy).toEqual({ path: '__name__', direction: 'asc' })
  })

  it('Created leads the order while it is ranged over, beside every equality', () => {
    const answer = plan([
      { field: 'createdAt', op: 'onOrAfter', value: '2026-09-01' },
      { field: 'displayName', op: 'equals', value: '  Harbor  Bakery ' },
      { field: 'subdomain', op: 'equals', value: 'Harbor-Bakery' },
    ])
    expect(answer.refused).toEqual([])
    expect(answer.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(answer.filters).toEqual(
      expect.arrayContaining([
        { path: 'nameLower', op: '==', value: 'harbor bakery' },
        { path: 'subdomain', op: '==', value: 'harbor-bakery' },
      ]),
    )
  })

  it('Suspended and Custom domain are equalities, as the panel\'s select sends them', () => {
    const answer = plan([
      { field: 'suspended', op: 'equals', value: 'false' },
      { field: 'hasCustomDomain', op: 'equals', value: 'true' },
      { field: 'createdAt', op: 'before', value: '2026-09-01' },
    ])
    expect(answer.refused).toEqual([])
    expect(answer.filters).toEqual(
      expect.arrayContaining([
        { path: 'suspended', op: '==', value: false },
        { path: 'hasCustomDomain', op: '==', value: true },
      ]),
    )
    expect(answer.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
  })

  it('a site id or several is the document id', () => {
    const answer = plan([{ field: '$id', op: 'isAnyOf', value: 'h1, h2' }])
    expect(answer.refused).toEqual([])
    expect(answer.filters[0]).toEqual({ path: '__name__', op: 'in', value: ['h1', 'h2'] })
  })

  it('refuses by name what the site document cannot answer', () => {
    const answer = plan([{ field: 'status', op: 'equals', value: 'live' }])
    expect(answer.served).toEqual([])
    expect(answer.refused).toHaveLength(1)
  })
})

describe('every header sorts, at no new composite (AGL-3680)', () => {
  const sorted = (
    sort: { path: string; direction: 'asc' | 'desc' },
    clauses: Array<{ field: string; op: string; value: string }> = [],
    search: string[] = [],
  ) => planListQuery(STAFF_SITE_LIST_QUERY, { clauses, search, sort }, nameSearchNormalizers)

  it('orders by Site with nothing narrowing the list', () => {
    expect(sorted({ path: 'nameLower', direction: 'desc' }).orderBy).toMatchObject({
      path: 'nameLower',
      direction: 'desc',
    })
  })

  it('falls back to Created newest first under a filter or the search, and says so', () => {
    const answer = sorted({ path: 'nameLower', direction: 'asc' }, [
      { field: 'orgId', op: 'equals', value: 'o1' },
    ])
    expect(answer.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(answer.notices).toEqual(['Sorted by Created: Site sorts only with no filter or search on.'])
    expect(sorted({ path: 'createdAt', direction: 'asc' }, [], ['acme']).orderBy.direction).toBe('desc')
  })

  it("keeps Created newest first under every filter: its composites are the range's", () => {
    const answer = sorted({ path: 'createdAt', direction: 'desc' }, [
      { field: 'suspended', op: 'equals', value: 'true' },
    ])
    expect(answer.orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
    expect(answer.notices).toEqual([])
  })
})
