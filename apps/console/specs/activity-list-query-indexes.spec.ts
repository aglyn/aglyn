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
 * Every activity log's filters and search are on its query, and every shape
 * that query can take has its index (AGL-3321).
 *
 * Six lists read the `activity` collections (`utils/activity-list-query.ts`
 * names them). Each is pinned here against the index file the project
 * deploys: a clause the plan puts on a query with no composite behind it
 * throws FAILED_PRECONDITION for every reader, so it fails here instead.
 * The per-subject queries are COLLECTION scope; the staff feed across every
 * organization is the one COLLECTION_GROUP query.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
  type ListQueryDeclaration,
  type ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ACTIVITY_LIST_QUERY,
  ORG_ACTIVITY_QUERY,
  activityActorBase,
  activityTargetBase,
  splitWhereClause,
} from '../utils/activity-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const shapes = (declaration: ListQueryDeclaration, base: { path: string }[] = []) =>
  listQueryIndexes(declaration, base).map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
  )

const LISTS: Array<{
  list: string
  declaration: ListQueryDeclaration
  base: { path: string }[]
  scope: 'COLLECTION' | 'COLLECTION_GROUP'
}> = [
  { list: 'a site’s log (hosts/{hostId}/activity)', declaration: ACTIVITY_LIST_QUERY, base: [], scope: 'COLLECTION' },
  { list: 'the organization’s own feed', declaration: ACTIVITY_LIST_QUERY, base: [], scope: 'COLLECTION' },
  {
    list: 'changes to one member (target.id)',
    declaration: ACTIVITY_LIST_QUERY,
    base: [{ path: 'target.id' }],
    scope: 'COLLECTION',
  },
  { list: 'the org-wide log, per subject', declaration: ORG_ACTIVITY_QUERY, base: [], scope: 'COLLECTION' },
  {
    list: 'one member in this organization, per subject',
    declaration: ACTIVITY_LIST_QUERY,
    base: [{ path: 'actorId' }],
    scope: 'COLLECTION',
  },
  {
    list: 'one account everywhere (staff)',
    declaration: ACTIVITY_LIST_QUERY,
    base: [{ path: 'actorId' }],
    scope: 'COLLECTION_GROUP',
  },
]

describe('every activity list has the composites its query shapes need', () => {
  it.each(LISTS.map((entry) => [entry.list, entry] as const))('%s', (_list, entry) => {
    const needed = listQueryIndexes(entry.declaration, entry.base)
    expect(missingListQueryIndexes(INDEX_FILE, 'activity', needed, entry.scope)).toEqual([])
    // The budget: one (field, createdAt DESC) composite per equality, merged.
    expect(needed.length).toBeLessThanOrEqual(12)
  })

  it('names exactly the merged composites, all ordered by createdAt DESC', () => {
    expect(shapes(ORG_ACTIVITY_QUERY).sort()).toEqual([
      'action:ASCENDING,createdAt:DESCENDING',
      'actorId:ASCENDING,createdAt:DESCENDING',
      'searchTokens:CONTAINS,createdAt:DESCENDING',
    ])
    expect(shapes(ACTIVITY_LIST_QUERY, [{ path: 'target.id' }]).sort()).toEqual([
      'action:ASCENDING,createdAt:DESCENDING',
      'searchTokens:CONTAINS,createdAt:DESCENDING',
      'target.id:ASCENDING,createdAt:DESCENDING',
    ])
  })
})

const plan = (
  declaration: ListQueryDeclaration,
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
  base: ListQueryFilter[] = [],
) => planListQuery(declaration, { clauses, search, base }, nameSearchNormalizers)

describe('every clause and the search word land on the query', () => {
  it('Action, Who, When and the search, on one query in the feed’s own order', () => {
    const answer = plan(
      ORG_ACTIVITY_QUERY,
      [
        { field: 'action', op: 'isAnyOf', value: 'ai.job.output,ai.overage.cap' },
        { field: 'actorId', op: 'equals', value: 'u1' },
        { field: 'createdAt', op: 'onOrAfter', value: '2026-09-01' },
      ],
      ['Ada'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.served).toHaveLength(3)
    expect(answer.searched).toBe('ada')
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'searchTokens array-contains',
      'action in',
      'actorId ==',
      'createdAt >=',
    ])
    expect(answer.orderBy).toEqual({ path: 'createdAt', direction: 'desc', column: 'createdAt' })
  })

  it('a whole day is two bounds under the same order, not a cursor', () => {
    const answer = plan(ACTIVITY_LIST_QUERY, [{ field: 'createdAt', op: 'is', value: '2026-09-17' }])
    expect(answer.filters.map((filter) => filter.op)).toEqual(['>=', '<'])
    expect(answer.orderBy.path).toBe('createdAt')
  })

  it('searches beside a person’s or a target’s base, which are equalities', () => {
    for (const base of [activityActorBase('u1'), activityTargetBase('m1')]) {
      const answer = plan(ACTIVITY_LIST_QUERY, [], ['home'], base)
      expect(answer.searched).toBe('home')
      expect(answer.refused).toEqual([])
    }
  })

  it('refuses by name what the log does not filter by, and applies none of it', () => {
    const answer = plan(ACTIVITY_LIST_QUERY, [
      { field: 'target', op: 'equals', value: 'Home' },
      { field: 'action', op: 'startsWith', value: 'Saved' },
    ])
    expect(answer.served).toEqual([])
    expect(answer.refused.map((entry) => entry.clause)).toEqual([
      { field: 'target', op: 'equals', value: 'Home' },
      { field: 'action', op: 'startsWith', value: 'Saved' },
    ])
    expect(answer.filters).toEqual([])
  })
})

describe('Where picks the subjects the org-wide log reads', () => {
  it('takes the site off the clauses the plan sees', () => {
    const split = splitWhereClause([
      { field: 'scopeId', op: 'equals', value: 'h1' },
      { field: 'action', op: 'equals', value: 'Saved the screen' },
    ])
    expect(split.where).toBe('h1')
    expect(split.rest).toEqual([{ field: 'action', op: 'equals', value: 'Saved the screen' }])
    expect(split.refused).toEqual([])
  })

  it('refuses a Where it cannot read, rather than reading everywhere under its chip', () => {
    const split = splitWhereClause([{ field: 'scopeId', op: 'isAnyOf', value: 'h1,h2' }])
    expect(split.where).toBeNull()
    expect(split.refused).toHaveLength(1)
  })
})
