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
 * Both staff audit lists' filters and search are on their query, and every
 * shape that query can take has its index (AGL-3321).
 *
 * The Audit log page and an account's two audit tables plan every clause and
 * the search word through `planListQuery` (`utils/admin-audit-list-query.ts`).
 * Each is pinned here against the index file the project deploys: a clause
 * the plan puts on a query with no composite behind it throws
 * FAILED_PRECONDITION for every reader, so it fails here instead.
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
  ADMIN_AUDIT_LIST_QUERY,
  USER_AUDIT_HALF_PATHS,
  USER_AUDIT_LIST_QUERY,
  userAuditKindBase,
} from '../utils/admin-audit-list-query'
import { userAuditHalves } from '../utils/server/user-audit'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const shapes = (needed: ReturnType<typeof listQueryIndexes>) =>
  needed
    .map((index) =>
      index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
    )
    .sort()

const USER_BASE = [...USER_AUDIT_HALF_PATHS, 'kind'].map((path) => ({ path }))

describe('every audit list has the composites its query shapes need', () => {
  it('the Audit log page: one (field, at DESC) composite per filter and the search', () => {
    const needed = listQueryIndexes(ADMIN_AUDIT_LIST_QUERY)
    expect(missingListQueryIndexes(INDEX_FILE, 'adminAudit', needed)).toEqual([])
    expect(shapes(needed)).toEqual([
      'action:ASCENDING,at:DESCENDING',
      'actionGroup:ASCENDING,at:DESCENDING',
      'actorUid:ASCENDING,at:DESCENDING',
      'scope:ASCENDING,at:DESCENDING',
      'searchTokens:CONTAINS,at:DESCENDING',
      'target:ASCENDING,at:DESCENDING',
      'targetHostId:ASCENDING,at:DESCENDING',
      'targetKind:ASCENDING,at:DESCENDING',
    ])
  })

  it('an account’s audit tables: each half’s own field and `kind`, merged with the filters', () => {
    const needed = listQueryIndexes(USER_AUDIT_LIST_QUERY, USER_BASE)
    expect(missingListQueryIndexes(INDEX_FILE, 'adminAudit', needed)).toEqual([])
    expect(shapes(needed)).toEqual([
      'action:ASCENDING,at:DESCENDING',
      'actionGroup:ASCENDING,at:DESCENDING',
      'actorUid:ASCENDING,at:DESCENDING',
      'kind:ASCENDING,at:DESCENDING',
      'searchTokens:CONTAINS,at:DESCENDING',
      'subjectAddressKey:ASCENDING,at:DESCENDING',
      'subjectUid:ASCENDING,at:DESCENDING',
      'target:ASCENDING,at:DESCENDING',
    ])
  })

  it('the halves carry exactly the base the index enumeration assumes', () => {
    const halves = userAuditHalves({ uid: 'u1', addressKeys: ['k1', 'k2'], kind: 'access' })
    const paths = new Set(halves.flat().map((filter) => filter.path))
    expect([...paths].sort()).toEqual(USER_BASE.map((entry) => entry.path).sort())
    for (const half of halves) expect(half).toContainEqual(userAuditKindBase('access'))
  })
})

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(ADMIN_AUDIT_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

describe('every clause and the search word land on the audit page’s query', () => {
  it('every filter the panel offers, and the search, on one query in the log’s order', () => {
    const answer = plan(
      [
        { field: 'action', op: 'isAnyOf', value: 'org.override,org.refund' },
        { field: 'actionGroup', op: 'equals', value: 'org' },
        { field: 'actorUid', op: 'equals', value: 'staff-1' },
        { field: 'target', op: 'equals', value: 'orgs/o1' },
        { field: 'targetKind', op: 'equals', value: 'orgs' },
        { field: 'targetHostId', op: 'equals', value: 'h1' },
        { field: 'scope', op: 'equals', value: 'org' },
        { field: 'at', op: 'onOrAfter', value: '2026-09-01' },
      ],
      ['Refund'],
    )
    expect(answer.refused).toEqual([])
    expect(answer.searched).toBe('refund')
    expect(answer.orderBy).toMatchObject({ path: 'at', direction: 'desc' })
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'searchTokens array-contains',
      'action in',
      'actionGroup ==',
      'actorUid ==',
      'target ==',
      'targetKind ==',
      'targetHostId ==',
      'scope ==',
      'at >=',
    ])
  })

  it('refuses by name what one query cannot hold, and never applies it', () => {
    const many = Array.from({ length: 6 }, (_unused, at) => `a${at}`).join(',')
    const answer = plan([
      { field: 'action', op: 'isAnyOf', value: many },
      { field: 'scope', op: 'isAnyOf', value: 'org,host,user,feature,platform,tenant' },
    ])
    // 6 × 6 disjunctions is past Firestore's thirty.
    expect(answer.refused).toEqual([
      {
        clause: { field: 'scope', op: 'isAnyOf', value: 'org,host,user,feature,platform,tenant' },
        reason: 'too many values at once (the limit is 30)',
      },
    ])
    expect(answer.filters.some((filter) => filter.path === 'scope')).toBe(false)
  })

  it('offers no operator Firestore cannot serve under the date order', () => {
    const answer = plan([
      { field: 'target', op: 'startsWith', value: 'orgs/' },
      { field: 'at', op: 'is', value: '2026-09-01' },
    ])
    expect(answer.refused.map((entry) => (entry.clause === 'search' ? 'search' : entry.clause.field))).toEqual([
      'target',
      'at',
    ])
    expect(answer.filters).toEqual([])
  })
})
