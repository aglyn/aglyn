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
 * The idempotency-claims list's filters are on its query, and every shape
 * that query can take has its composite index (AGL-3321).
 *
 * `/api/admin/idempotency-claims` reads `apiIdempotency` through
 * `runStaffListQuery`: `status == 'pending'` always, oldest claim first,
 * every Operation, Scope and Org clause an equality merged with that order,
 * and Age and State ranges over the claim time itself. Pinned here against
 * the index file the project deploys.
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
  CLAIM_LIST_QUERY,
  CLAIM_PENDING_BASE,
  CLAIM_COLUMN_SORTS,
  STRANDED_AFTER_MS,
  claimQuerySort,
  splitClaimTimeClauses,
} from '../utils/idempotency-claims-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const NOW = 1_770_000_000_000
const BASE = [{ path: 'status' }]

describe('the claims list has the composites its query shapes need', () => {
  it('holds every composite the declaration and its base can ask for', () => {
    const needed = listQueryIndexes(CLAIM_LIST_QUERY, BASE)
    expect(missingListQueryIndexes(INDEX_FILE, 'apiIdempotency', needed)).toEqual([])
  })

  it('names exactly the merged composites, and one per header order beside the base', () => {
    expect(
      listQueryIndexes(CLAIM_LIST_QUERY, BASE)
        .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','))
        .sort(),
    ).toEqual([
      'kind:ASCENDING,createdAtMs:ASCENDING',
      'orgId:ASCENDING,createdAtMs:ASCENDING',
      'scopeId:ASCENDING,createdAtMs:ASCENDING',
      'status:ASCENDING,createdAtMs:ASCENDING',
      // The header sorts (AGL-3680): `alone`, so paired with the base only.
      'status:ASCENDING,createdAtMs:DESCENDING',
      'status:ASCENDING,kind:ASCENDING',
      'status:ASCENDING,kind:DESCENDING',
      'status:ASCENDING,orgId:ASCENDING',
      'status:ASCENDING,orgId:DESCENDING',
      'status:ASCENDING,scopeId:ASCENDING',
      'status:ASCENDING,scopeId:DESCENDING',
    ])
  })
})

const plan = (clauses: Array<{ field: string; op: string; value: string }>) => {
  const split = splitClaimTimeClauses(clauses, NOW)
  return {
    split,
    answer: planListQuery(
      CLAIM_LIST_QUERY,
      { clauses: split.rest, base: [...CLAIM_PENDING_BASE, ...split.base] },
      nameSearchNormalizers,
    ),
  }
}

describe('every clause lands on one query', () => {
  it('Operation, Scope, Org, Age and State together, oldest claim first', () => {
    const { split, answer } = plan([
      { field: 'kind', op: 'isAnyOf', value: 'checkout,refund' },
      { field: 'scopeId', op: 'equals', value: 'host-1' },
      { field: 'orgId', op: 'equals', value: 'org-1' },
      { field: 'ageMs', op: '>', value: '60000' },
      { field: 'stranded', op: 'equals', value: 'stranded' },
    ])
    expect(split.refused).toEqual([])
    expect(answer.refused).toEqual([])
    expect(answer.filters).toEqual([
      { path: 'status', op: '==', value: 'pending' },
      { path: 'createdAtMs', op: '<', value: NOW - 60_000 },
      { path: 'createdAtMs', op: '<=', value: NOW - STRANDED_AFTER_MS },
      { path: 'kind', op: 'in', value: ['checkout', 'refund'] },
      { path: 'scopeId', op: '==', value: 'host-1' },
      { path: 'orgId', op: '==', value: 'org-1' },
    ])
    expect(answer.orderBy).toMatchObject({ path: 'createdAtMs', direction: 'asc' })
  })

  it('in flight is the claims younger than the stranded threshold', () => {
    const { answer } = plan([{ field: 'stranded', op: 'equals', value: 'inFlight' }])
    expect(answer.filters[1]).toEqual({ path: 'createdAtMs', op: '>', value: NOW - STRANDED_AFTER_MS })
  })

  it.each([
    ['>=', '<='],
    ['<', '>'],
    ['<=', '>='],
  ])('an age %s is a claim time %s', (ageOp, timeOp) => {
    const { answer } = plan([{ field: 'ageMs', op: ageOp, value: '1000' }])
    expect(answer.filters[1]).toEqual({ path: 'createdAtMs', op: timeOp, value: NOW - 1000 })
  })

  it.each([
    ['a state it does not know', { field: 'stranded', op: 'equals', value: 'maybe' }],
    ['an age that is not a number', { field: 'ageMs', op: '>', value: 'soon' }],
    ['an age compared for equality', { field: 'ageMs', op: '=', value: '1000' }],
  ])('refuses %s by name, and applies none of it', (_label, clause) => {
    const { split, answer } = plan([clause])
    expect(split.refused.map((entry) => entry.clause)).toEqual([clause])
    expect(answer.filters).toEqual([{ path: 'status', op: '==', value: 'pending' }])
  })

  it('refuses what the list does not filter by', () => {
    const { answer } = plan([{ field: 'id', op: 'equals', value: 'x' }])
    expect(answer.refused).toHaveLength(1)
    expect(answer.served).toEqual([])
  })

  it('has no search to offer, and says so rather than ignoring one', () => {
    const answer = planListQuery(CLAIM_LIST_QUERY, { clauses: [], search: ['acme'] }, nameSearchNormalizers)
    expect(answer.refused.map((entry) => entry.clause)).toEqual(['search'])
  })
})

describe('the header sorts (AGL-3680)', () => {
  it('Age and State are the claim time read the other way round', () => {
    expect(claimQuerySort({ path: 'ageMs', direction: 'asc' })).toMatchObject({
      path: 'createdAtMs',
      direction: 'desc',
    })
    expect(claimQuerySort({ path: 'ageMs', direction: 'desc' })).toMatchObject({
      path: 'createdAtMs',
      direction: 'asc',
    })
    expect(claimQuerySort({ path: 'stranded', direction: 'asc' })).toMatchObject({
      path: 'createdAtMs',
      direction: 'desc',
    })
    expect(claimQuerySort({ path: 'kind', direction: 'asc' })).toEqual({ path: 'kind', direction: 'asc' })
  })

  it('every header order the card asks for is one the plan serves', () => {
    for (const sort of CLAIM_COLUMN_SORTS) {
      const asked = claimQuerySort(sort)
      const answer = planListQuery(
        CLAIM_LIST_QUERY,
        { clauses: [], sort: asked, base: CLAIM_PENDING_BASE },
        nameSearchNormalizers,
      )
      expect(answer.orderBy).toMatchObject({ path: asked?.path, direction: asked?.direction })
      expect(answer.sortFallback).toBeUndefined()
    }
  })

  it('an Operation sort falls back to the claim time under a filter, and says so', () => {
    const answer = planListQuery(
      CLAIM_LIST_QUERY,
      {
        clauses: [{ field: 'orgId', op: 'equals', value: 'org-1' }],
        sort: { path: 'kind', direction: 'asc' },
        base: CLAIM_PENDING_BASE,
      },
      nameSearchNormalizers,
    )
    expect(answer.orderBy).toMatchObject({ path: 'createdAtMs', direction: 'asc' })
    expect(answer.notices).toHaveLength(1)
  })
})
