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

import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'

import { CRM_NEXT_ACTIVITY_FILTER_FIELD } from '../model/crm-next-activity'
import type { ListQueryDeclaration, ListQuerySort } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { CRM_LIST_SEARCH } from '../model/crm-list-query'

/*
 * Companies (`orgs/{orgId}/companies`, read scoped to a host) — every clause
 * and the search word on the list's one query, newest change first
 * (AGL-3321).
 *
 * The search box reads `searchTokens`, the word prefixes of the name and
 * the domain every company writer stamps (`crmCompanyListFields`). Under a
 * site the scope clause (`visibleTo array-contains-any`) is the query's one
 * array clause, and the search folds into it (`scopedSearchTokens`) for a
 * reader who may drop it.
 *
 * The name is also an exact match and a PREFIX range over `nameLower` — the
 * list's one range, which then orders the list by name. The owner is a
 * choice from the roster, and "No next activity" asks `nextTaskAtMs ==
 * null`. Each equality rides one `(field, updatedAt DESC)` composite, and
 * one `(field, nameLower ASC)` beside it for the prefix.
 *
 * Type, Industry and Rating (AGL-3514) are choices from the org's lists,
 * asked of the KEY each writer stores beside the label (`typeKey`,
 * `industryKey`, `ratingKey` — see `crmCompanyListFields`): a choice's
 * value is the key, its caption the label, so the query compares what
 * the record keyed rather than how the label happens to be cased.
 */
export const COMPANY_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    presence: 'always',
    operators: ['equals', 'startsWith'],
  },
  {
    column: 'ownerUid',
    kind: 'exact',
    path: 'ownerUid',
    operators: ['equals', 'isAnyOf'],
  },
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  { column: 'type', kind: 'exact', path: 'typeKey', operators: ['equals', 'isAnyOf'] },
  { column: 'industry', kind: 'exact', path: 'industryKey', operators: ['equals', 'isAnyOf'] },
  { column: 'rating', kind: 'exact', path: 'ratingKey', operators: ['equals', 'isAnyOf'] },
]

/** The picklist columns the list filters by, each with the list its choices come from. */
export const COMPANY_PICKLIST_FILTERS = [
  { column: 'type', picklistId: 'accountType', header: 'Type' },
  { column: 'industry', picklistId: 'industry', header: 'Industry' },
  { column: 'rating', picklistId: 'rating', header: 'Rating' },
] as const

/**
 * A collaborator's search (see `prefixSearch` in `useCrmListQuery`): the
 * start of the name, beside the scope clause — the prefix range the
 * `(field, nameLower)` composites already serve.
 */
export const COMPANY_PREFIX_SEARCH = {
  field: COMPANY_LIST_FILTER_FIELDS[0],
  notice: 'Search matches the start of a company’s name for access limited to specific sites.',
}

/** The list's orders: newest change first, and by name under a prefix. */
export const COMPANY_LIST_SORTS: readonly ListQuerySort[] = [
  { path: 'updatedAt', direction: 'desc' },
  { path: 'nameLower', direction: 'asc' },
]

export const COMPANY_LIST_DECLARATION: ListQueryDeclaration = {
  fields: COMPANY_LIST_FILTER_FIELDS,
  sorts: COMPANY_LIST_SORTS,
  search: CRM_LIST_SEARCH,
}
