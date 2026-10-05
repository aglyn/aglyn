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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ListQueryDeclaration,
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { COMPANY_LIST_DECLARATION } from '../constants/company-filters'
import { contactIndexShapes } from '../constants/contact-filters'
import {
  DEAL_LIST_DECLARATION,
  DEAL_LIST_PIPELINE_BASE_INDEX,
  DEAL_PREFIX_SEARCH,
  DEAL_QUERY_FIELDS,
} from '../constants/deal-filters'
import { CRM_FIELD_LIST_QUERY } from '../constants/field-list-query'
import { CRM_LIST_BASE_INDEX } from './crm-list-query'
import { LEAD_LIST_DECLARATION, leadIndexShapes } from './lead-filters'
import { TASK_LIST_DECLARATION, TASK_LIST_VIEW_BASE_INDEX } from './task-views'

/**
 * EVERY SHAPE A CRM LIST ASKS HAS ITS COMPOSITE (AGL-3321).
 *
 * Each list's declaration names the fields its query may hold, its orders
 * and its search; `listQueryIndexes` enumerates the `(field, order)`
 * composites those shapes need under index merging, and this pins them
 * against `cloud/firebase-firestore.indexes.json`. A filter declared without
 * the index that serves it fails here, not as `FAILED_PRECONDITION` on
 * production.
 */

const INDEX_FILE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'cloud', 'firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const DEAL_BASE = [...CRM_LIST_BASE_INDEX, ...DEAL_LIST_PIPELINE_BASE_INDEX]

const LISTS: Array<{
  list: string
  collection: string
  declaration: ListQueryDeclaration
  base: ReadonlyArray<{ path: string; array?: boolean }>
}> = [
  { list: 'Leads', collection: 'leads', declaration: LEAD_LIST_DECLARATION, base: CRM_LIST_BASE_INDEX },
  ...leadIndexShapes().map((declaration, at) => ({
    list: `Leads (collaborator search #${at})`,
    collection: 'leads',
    declaration,
    base: CRM_LIST_BASE_INDEX,
  })),
  ...contactIndexShapes().map((declaration, at) => ({
    list: `Contacts (${['filters and search', 'a solo range'][at]})`,
    collection: 'contacts',
    declaration,
    base: CRM_LIST_BASE_INDEX,
  })),
  { list: 'Companies', collection: 'companies', declaration: COMPANY_LIST_DECLARATION, base: CRM_LIST_BASE_INDEX },
  {
    list: 'Deals',
    collection: 'deals',
    declaration: DEAL_LIST_DECLARATION,
    base: DEAL_BASE,
  },
  {
    list: 'Deals (collaborator search)',
    collection: 'deals',
    declaration: { fields: [DEAL_PREFIX_SEARCH.field, ...DEAL_QUERY_FIELDS], sorts: [] },
    base: DEAL_BASE,
  },
  {
    list: 'Tasks',
    collection: 'crmTasks',
    declaration: TASK_LIST_DECLARATION,
    base: [...CRM_LIST_BASE_INDEX, ...TASK_LIST_VIEW_BASE_INDEX],
  },
]

describe('the CRM lists’ composites', () => {
  it.each(LISTS.map((entry) => [entry.list, entry] as const))(
    '%s: every shape its query can take has its index',
    (_list, entry) => {
      const needed = listQueryIndexes(entry.declaration, entry.base)
      expect(needed.length).toBeGreaterThan(0)
      expect(missingListQueryIndexes(INDEX_FILE, entry.collection, needed)).toEqual([])
    },
  )
})

describe('the Fields table (AGL-3335)', () => {
  it('needs no composite: its clauses are equalities under the document-id order', () => {
    // Firestore merges the single-field indexes it keeps on its own for
    // equalities and one array clause under `__name__`, so the tab, the
    // type, the Required flag and the search spend nothing from the budget.
    expect(listQueryIndexes(CRM_FIELD_LIST_QUERY, [{ path: 'object' }])).toEqual([])
  })
})
