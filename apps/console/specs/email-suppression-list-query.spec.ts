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
 * The staff platform-suppression list's filters and search are on its query,
 * and every shape that query can take has its composite index (AGL-3321).
 *
 * `emailSuppressions` is read by `/api/admin/emails/suppressions` through
 * `runStaffListQuery`: every clause and the search word planned onto one
 * query in `suppressedAt` DESC order. Pinned here against the index file the
 * project deploys, because a clause planned onto a query with no composite
 * behind it throws FAILED_PRECONDITION for every reader.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { PLATFORM_SUPPRESSION_REASONS } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  SUPPRESSION_FILTER_OPTIONS,
  SUPPRESSION_LIST_QUERY,
  SUPPRESSION_REASON_LABELS,
} from '../utils/email-suppression-filters'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const shape = (fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>) =>
  fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(',')

const plan = (
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(SUPPRESSION_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

describe('the suppression list has the composites its query shapes need', () => {
  it('holds every composite the declaration can ask for', () => {
    const needed = listQueryIndexes(SUPPRESSION_LIST_QUERY)
    expect(missingListQueryIndexes(INDEX_FILE, 'emailSuppressions', needed)).toEqual([])
  })

  it('names exactly the merged composites, all ordered by suppressedAt DESC', () => {
    expect(listQueryIndexes(SUPPRESSION_LIST_QUERY).map((index) => shape(index.fields)).sort()).toEqual([
      'context:ASCENDING,suppressedAt:DESCENDING',
      'emailTokens:CONTAINS,suppressedAt:DESCENDING',
      'hostId:ASCENDING,suppressedAt:DESCENDING',
      'reason:ASCENDING,suppressedAt:DESCENDING',
      'released:ASCENDING,suppressedAt:DESCENDING',
    ])
  })

  /**
   * The (released, field, suppressedAt) triples the list asked for before
   * its clauses merged. The console that is live until the next promotion
   * still queries them, so they stay deployed (and in the file, or the
   * drift check reads them as live-only) until that promotion ships; then
   * they are removed from both, and from this set.
   */
  const RETIRING_AFTER_PROMOTION = new Set([
    'released:ASCENDING,reason:ASCENDING,suppressedAt:DESCENDING',
    'released:ASCENDING,context:ASCENDING,suppressedAt:DESCENDING',
    'released:ASCENDING,hostId:ASCENDING,suppressedAt:DESCENDING',
  ])

  it('carries no composite for the list that no query of it asks for', () => {
    const needed = new Set(listQueryIndexes(SUPPRESSION_LIST_QUERY).map((index) => shape(index.fields)))
    const held = (INDEX_FILE.indexes as Array<{ collectionGroup: string; queryScope: string; fields: [] }>)
      .filter((index) => index.collectionGroup === 'emailSuppressions' && index.queryScope === 'COLLECTION')
      .map((index) => shape(index.fields))
    expect(
      held.filter((entry) => !needed.has(entry) && !RETIRING_AFTER_PROMOTION.has(entry)),
    ).toEqual([])
  })
})

describe('every clause and the search word land on one query', () => {
  it('Status, Reason, Learned from, Site ID, Last reported and the search, together', () => {
    const answer = plan(
      [
        { field: 'status', op: 'equals', value: 'false' },
        { field: 'reason', op: 'isAnyOf', value: 'bounce,complaint' },
        { field: 'context', op: 'equals', value: 'invite' },
        { field: 'hostId', op: 'equals', value: 'h1' },
        { field: 'suppressedAt', op: 'onOrAfter', value: '2026-09-01' },
      ],
      ['  Jane.Doe@Example '],
    )
    expect(answer.refused).toEqual([])
    expect(answer.served).toHaveLength(5)
    // Lower-cased and capped at the stored token length.
    expect(answer.searched).toBe('jane.doe@exa')
    expect(answer.filters.map((filter) => `${filter.path} ${filter.op}`)).toEqual([
      'emailTokens array-contains',
      'released ==',
      'reason in',
      'context ==',
      'hostId ==',
      'suppressedAt >=',
    ])
    expect(answer.filters[1].value).toBe(false)
    expect(answer.orderBy).toEqual({ path: 'suppressedAt', direction: 'desc' })
  })

  it('a whole day is two bounds under the list’s own order', () => {
    const answer = plan([{ field: 'suppressedAt', op: 'is', value: '2026-09-17' }])
    expect(answer.filters.map((filter) => filter.op)).toEqual(['>=', '<'])
    expect(answer.orderBy.path).toBe('suppressedAt')
  })

  it('a search that normalizes to nothing is no search', () => {
    const answer = plan([], ['   '])
    expect(answer.searched).toBeNull()
    expect(answer.filters).toEqual([])
  })

  it.each([
    ['a field the list does not filter by', { field: 'email', op: 'contains', value: 'x' }],
    ['an operator a field does not offer', { field: 'context', op: 'startsWith', value: 'inv' }],
    ['a value a field cannot take', { field: 'status', op: 'equals', value: 'maybe' }],
    ['a clause with no value', { field: 'context', op: 'equals', value: '' }],
  ])('refuses %s by name, and applies none of it', (_label, clause) => {
    const answer = plan([clause])
    expect(answer.served).toEqual([])
    expect(answer.refused.map((entry) => entry.clause)).toEqual([clause])
    expect(answer.filters).toEqual([])
  })

  it('refuses more values than one query can hold', () => {
    const many = Array.from({ length: 31 }, (_unused, at) => `r${at}`).join(',')
    const answer = plan([{ field: 'reason', op: 'isAnyOf', value: many }])
    expect(answer.refused).toHaveLength(1)
    expect(answer.filters).toEqual([])
  })
})

describe('the Reason choices are the reasons a platform suppression can carry', () => {
  it('labels every platform reason, and offers no other', () => {
    expect(Object.keys(SUPPRESSION_REASON_LABELS).sort()).toEqual([...PLATFORM_SUPPRESSION_REASONS].sort())
    expect(SUPPRESSION_FILTER_OPTIONS['reason'].map((option) => option.value).sort()).toEqual(
      [...PLATFORM_SUPPRESSION_REASONS].sort(),
    )
  })
})
