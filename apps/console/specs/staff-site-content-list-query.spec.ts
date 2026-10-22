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
 * The staff site Content tabs' header orders (AGL-3680), and the composites
 * they need: a tab with a scope (email designs' `kind == email`) pairs every
 * order with it, so each needs its index in `cloud/firebase-firestore.indexes.json`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  LIST_QUERY_ID_PATH,
  listQueryIndexes,
  missingListQueryIndexes,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  STAFF_SITE_CONTENT_LISTS,
  type StaffSiteContentTab,
} from '../utils/staff-site-content-list-query'

const INDEX_FILE = JSON.parse(
  readFileSync(join(__dirname, '../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

const TABS = Object.entries(STAFF_SITE_CONTENT_LISTS) as Array<
  [StaffSiteContentTab, (typeof STAFF_SITE_CONTENT_LISTS)[StaffSiteContentTab]]
>

describe.each(TABS)('the staff %s tab', (_tab, list) => {
  it('walks the document id by default', () => {
    const plan = planListQuery(list.declaration, { clauses: [], base: list.base }, nameSearchNormalizers)
    expect(plan.orderBy).toEqual({ path: LIST_QUERY_ID_PATH, direction: 'asc' })
    expect(plan.filters).toEqual([...list.base])
  })

  it('orders the query by every header order it declares, both ways', () => {
    for (const sort of list.declaration.sorts.filter((entry) => entry.column)) {
      const plan = planListQuery(list.declaration, { clauses: [], sort, base: list.base }, nameSearchNormalizers)
      expect(plan.orderBy).toEqual(sort)
      expect(plan.notices).toEqual([])
      expect(
        list.declaration.sorts.some(
          (entry) => entry.column === sort.column && entry.path === sort.path && entry.direction !== sort.direction,
        ),
      ).toBe(true)
    }
  })

  it('holds every composite its orders need', () => {
    const needed = listQueryIndexes(
      list.declaration,
      list.base.map((filter) => ({ path: filter.path })),
    )
    expect(missingListQueryIndexes(INDEX_FILE, list.collection, needed, 'COLLECTION')).toEqual([])
  })
})

describe('which header orders the query', () => {
  const columns = (tab: StaffSiteContentTab) =>
    [...new Set(STAFF_SITE_CONTENT_LISTS[tab].declaration.sorts.map((sort) => sort.column).filter(Boolean))]

  it('never orders a tab that shows trashed screens by their cleared name keys', () => {
    expect(columns('screens')).not.toContain('displayName')
    expect(columns('emails')).not.toContain('displayName')
  })

  it('never orders templates by the starter name their rows do not show', () => {
    expect(columns('templates')).not.toContain('displayName')
  })

  it('orders components and templates by their stored kind', () => {
    expect(STAFF_SITE_CONTENT_LISTS.components.declaration.sorts).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'status', path: 'kind' })]),
    )
    expect(STAFF_SITE_CONTENT_LISTS.templates.declaration.sorts).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'status', path: 'kind' })]),
    )
  })
})
