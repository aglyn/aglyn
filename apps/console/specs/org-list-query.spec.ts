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
 * The staff organization lists' filters and search are on their query, and
 * every shape that query can take has its index (AGL-3321).
 *
 * Two staff surfaces read `orgs` (`utils/org-list-query.ts` names them). Each
 * is pinned here against the index file the project deploys: a clause the
 * plan puts on a query with no composite behind it throws
 * FAILED_PRECONDITION for every reader, so it fails here instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { listFilterOperators } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
  type ListQueryDeclaration,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ORG_LIST_FILTER_FIELDS,
  ORG_LIST_QUERY,
  ORG_MARGIN_FILTER_FIELDS,
  ORG_MARGIN_QUERY,
} from '../utils/org-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const shapes = (declaration: ListQueryDeclaration) =>
  listQueryIndexes(declaration).map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
  )

describe('every organization list has the composites its query shapes need', () => {
  it.each([
    ['the staff Organizations list', ORG_LIST_QUERY],
    ['the margin scan', ORG_MARGIN_QUERY],
  ] as const)('%s', (_list, declaration) => {
    expect(missingListQueryIndexes(INDEX_FILE, 'orgs', listQueryIndexes(declaration))).toEqual([])
  })

  it('names exactly the merged composites: one per equality, under the one range', () => {
    // In document-id order an equality or the search token merges against
    // the built-in single-field indexes, so only Created's order needs any.
    expect(shapes(ORG_LIST_QUERY).sort()).toEqual([
      'billingStatus:ASCENDING,createdAt:DESCENDING',
      'nameLower:ASCENDING,createdAt:DESCENDING',
      'nameTokens:CONTAINS,createdAt:DESCENDING',
      'ownerUid:ASCENDING,createdAt:DESCENDING',
      'plan:ASCENDING,createdAt:DESCENDING',
      'slug:ASCENDING,createdAt:DESCENDING',
    ])
  })

  it('the margin scan is equalities in id order, and needs no composite at all', () => {
    expect(shapes(ORG_MARGIN_QUERY)).toEqual([])
    expect(ORG_MARGIN_FILTER_FIELDS.map((field) => field.column)).toEqual(['name', 'plan'])
  })

  it('offers ONE range per table: Created, and no other inequality', () => {
    const RANGES = ['startsWith', 'endsWith', 'isNotEmpty', '!=', '>', '>=', '<', '<=']
    const ranged = ORG_LIST_FILTER_FIELDS.filter(
      (field) =>
        field.kind === 'date' ||
        listFilterOperators(field).some((op) => RANGES.includes(op)),
    ).map((field) => field.column)
    expect(ranged).toEqual(['createdAt'])
  })
})

const plan = (
  declaration: ListQueryDeclaration,
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(declaration, { clauses, search }, nameSearchNormalizers)

describe('every clause and the search word land on one query', () => {
  it('stored plan, billing status, owner and the search, in document-id order', () => {
    const answer = plan(
      ORG_LIST_QUERY,
      [
        { field: 'plan', op: 'isAnyOf', value: 'pro,business' },
        { field: 'subscription', op: 'equals', value: 'past_due' },
        { field: 'ownerUid', op: 'equals', value: 'u1' },
      ],
      ['Coffee'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.served).toHaveLength(3)
    expect(answer.searched).toBe('coffee')
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'nameTokens array-contains',
      'plan in',
      'billingStatus ==',
      'ownerUid ==',
    ])
    expect(answer.orderBy).toEqual({ path: '__name__', direction: 'asc' })
  })

  it('Created leads the order while it is ranged over, beside every equality', () => {
    const answer = plan(
      ORG_LIST_QUERY,
      [
        { field: 'createdAt', op: 'onOrAfter', value: '2026-09-01' },
        { field: 'plan', op: 'equals', value: 'pro' },
        { field: 'name', op: 'equals', value: '  Acme  Coffee ' },
        { field: 'slug', op: 'equals', value: 'Acme-Coffee' },
      ],
      ['acme'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
    expect(answer.filters).toEqual(
      expect.arrayContaining([
        { path: 'nameLower', op: '==', value: 'acme coffee' },
        { path: 'slug', op: '==', value: 'acme-coffee' },
      ]),
    )
  })

  it('an org id or several is the document id, and composes with the rest', () => {
    const answer = plan(ORG_LIST_QUERY, [
      { field: '$id', op: 'isAnyOf', value: 'org-a, org-b' },
      { field: 'plan', op: 'equals', value: 'free' },
    ])
    expect(answer.refused).toEqual([])
    expect(answer.filters[0]).toEqual({ path: '__name__', op: 'in', value: ['org-a', 'org-b'] })
  })

  it('refuses by name what one query cannot hold, and applies none of it', () => {
    // Name "contains" is the query's one array clause, which the search took.
    const answer = plan(
      ORG_LIST_QUERY,
      [
        { field: 'name', op: 'contains', value: 'coffee' },
        { field: 'updatedAt', op: 'after', value: '2026-09-01' },
        { field: 'name', op: 'startsWith', value: 'Acme' },
        { field: 'plan', op: 'isNotEmpty', value: '' },
      ],
      ['acme'],
    )
    expect(answer.served).toEqual([])
    expect(answer.refused.map((entry) => (entry.clause === 'search' ? 'search' : entry.clause.field))).toEqual([
      'name',
      'updatedAt',
      'name',
      'plan',
    ])
    expect(answer.filters.map((filter) => filter.path)).toEqual(['nameTokens'])
  })

  it('the margin scan refuses a computed column rather than matching the rows it read', () => {
    const answer = plan(ORG_MARGIN_QUERY, [
      { field: 'marginPct', op: '<', value: '0.2' },
      { field: 'plan', op: 'equals', value: 'pro' },
    ])
    expect(answer.served).toEqual([{ field: 'plan', op: 'equals', value: 'pro' }])
    expect(answer.refused).toEqual([
      { clause: { field: 'marginPct', op: '<', value: '0.2' }, reason: 'this list does not filter by that' },
    ])
  })
})
