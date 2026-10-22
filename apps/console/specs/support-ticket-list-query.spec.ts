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
 * The staff support queue's Status filter is on its query, with the index
 * behind it (AGL-3321). See `utils/support-ticket-list-query.ts`.
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
  SUPPORT_TICKETS_COLLECTION,
  SUPPORT_TICKET_LIST_QUERY,
} from '../utils/support-ticket-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'), 'utf8'),
)

describe('the support queue has the composite its query needs', () => {
  it('names exactly (status, updatedAt DESC), and the index file holds it', () => {
    const needed = listQueryIndexes(SUPPORT_TICKET_LIST_QUERY)
    expect(
      needed.map((index) =>
        index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`).join(','),
      ),
    ).toEqual(['status:ASCENDING,updatedAt:DESCENDING'])
    expect(missingListQueryIndexes(INDEX_FILE, SUPPORT_TICKETS_COLLECTION, needed)).toEqual([])
  })
})

describe('Status lands on the query', () => {
  const plan = (clauses: Array<{ field: string; op: string; value: string }>, search: string[] = []) =>
    planListQuery(SUPPORT_TICKET_LIST_QUERY, { clauses, search }, nameSearchNormalizers)

  it('open or closed, newest update first', () => {
    const answer = plan([{ field: 'status', op: 'equals', value: 'closed' }])
    expect(answer.refused).toEqual([])
    expect(answer.filters).toEqual([{ path: 'status', op: '==', value: 'closed' }])
    expect(answer.orderBy).toEqual({ path: 'updatedAt', direction: 'desc' })
  })

  it('refuses what it cannot serve rather than reading the whole queue under it', () => {
    const answer = plan([{ field: 'subject', op: 'contains', value: 'invoice' }], ['refund'])
    expect(answer.filters).toEqual([])
    expect(answer.refused.map((entry) => entry.clause)).toEqual([
      'search',
      { field: 'subject', op: 'contains', value: 'invoice' },
    ])
  })
})
