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
 * The abuse queue's filters are on its query, and every shape that query can
 * take has its index (AGL-3321).
 *
 * Two lists read by `/api/admin/abuse-reports` (`utils/abuse-report-list-query.ts`)
 * and the summary's overdue read, pinned against the index file the project
 * deploys: a clause the plan puts on a query with no composite behind it
 * throws FAILED_PRECONDITION for every reader, so it fails here instead.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  counterNoticeClock,
  COUNTER_NOTICE_STATUSES,
  counterNoticeAwaitsRestoration,
} from '@aglyn/aglyn/app-utils/dmca-counter-notice'
import {
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
  type ListQueryDeclaration,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  ABUSE_REPORT_LIST_QUERY,
  COUNTER_NOTICE_AWAITING_STATUSES,
  COUNTER_NOTICE_LIST_QUERY,
  URGENT_ABUSE_CATEGORIES,
  counterNoticeOverdueBefore,
} from '../utils/abuse-report-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

const shapes = (declaration: ListQueryDeclaration) =>
  listQueryIndexes(declaration).map((index) =>
    index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
  )

const plan = (
  declaration: ListQueryDeclaration,
  clauses: Array<{ field: string; op: string; value: string }>,
  search: string[] = [],
) => planListQuery(declaration, { clauses, search }, nameSearchNormalizers)

describe('the reports list has the composites its query shapes need', () => {
  it('holds every merged composite in the index file', () => {
    const needed = listQueryIndexes(ABUSE_REPORT_LIST_QUERY)
    expect(missingListQueryIndexes(INDEX_FILE, 'abuseReports', needed)).toEqual([])
  })

  it('names exactly one (field, updatedAt DESC) composite per equality', () => {
    expect(shapes(ABUSE_REPORT_LIST_QUERY).sort()).toEqual([
      'category:ASCENDING,updatedAt:DESCENDING',
      'status:ASCENDING,updatedAt:DESCENDING',
    ])
  })

  it('pages the counter-notices by receipt alone, which needs no composite', () => {
    expect(listQueryIndexes(COUNTER_NOTICE_LIST_QUERY)).toEqual([])
  })

  it('holds the composite the overdue read runs on', () => {
    // `status in (awaiting) AND receivedAtMs <= t ORDER BY receivedAtMs`.
    expect(
      missingListQueryIndexes(INDEX_FILE, 'dmcaCounterNotices', [
        {
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'receivedAtMs', order: 'ASCENDING' },
          ],
        },
      ]),
    ).toEqual([])
  })
})

describe('Status and Category land on the query', () => {
  it('both, and any of several, on one query in the queue’s order', () => {
    const answer = plan(ABUSE_REPORT_LIST_QUERY, [
      { field: 'status', op: 'isAnyOf', value: 'open,reviewing' },
      { field: 'category', op: 'equals', value: 'phishing' },
    ])
    expect(answer.refused).toEqual([])
    expect(answer.filters).toEqual([
      { path: 'status', op: 'in', value: ['open', 'reviewing'] },
      { path: 'category', op: '==', value: 'phishing' },
    ])
    expect(answer.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
  })

  it('refuses by name what the queue does not filter by, and applies none of it', () => {
    const answer = plan(ABUSE_REPORT_LIST_QUERY, [
      { field: 'status', op: 'startsWith', value: 'op' },
      { field: 'url', op: 'contains', value: 'evil' },
    ])
    expect(answer.served).toEqual([])
    expect(answer.filters).toEqual([])
    expect(answer.refused).toHaveLength(2)
  })

  it('offers no search, and says so rather than matching a page', () => {
    const answer = plan(ABUSE_REPORT_LIST_QUERY, [], ['bank'])
    expect(answer.searched).toBeNull()
    expect(answer.refused).toEqual([{ clause: 'search', reason: 'this list has no search' }])
  })
})

describe('the counts the summary serves', () => {
  it('reads the urgent backlog by category, the same catalog the rows render', () => {
    expect([...URGENT_ABUSE_CATEGORIES].sort()).toEqual(['csam', 'malware', 'phishing'])
  })

  it('names exactly the statuses still heading for a put-back', () => {
    expect(COUNTER_NOTICE_STATUSES.filter(counterNoticeAwaitsRestoration)).toEqual([
      ...COUNTER_NOTICE_AWAITING_STATUSES,
    ])
  })

  it('never leaves an overdue counter-notice out of the candidates it reads', () => {
    // Every weekday and weekend start across a fortnight, at a few hours: a
    // notice received just after the bound is never already past its ceiling.
    const now = Date.UTC(2026, 8, 26, 15, 0)
    const bound = counterNoticeOverdueBefore(now)
    for (let offset = 0; offset < 14 * 24; offset += 5) {
      const receivedAtMs = bound + 1 + offset * 3_600_000
      expect(counterNoticeClock(receivedAtMs).latestMs).toBeGreaterThan(now)
    }
  })
})
