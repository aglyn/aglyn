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

import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListGridFilterCodec } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { crmPicklistKey, type CrmViewFilterClause } from '@aglyn/aglyn/app-utils/crm'
import { CRM_NEXT_ACTIVITY_FILTER_FIELD } from '../components/crm-next-activity-column'
import {
  CRM_LIST_SEARCH,
  crmAnyOf,
  type CrmClauseAsked,
  crmClauseValues,
  crmSelectField,
} from '../model/crm-list-query'
import { LEAD_SOURCE_CODEC, LEAD_SOURCE_FILTER_NONE } from '../model/lead-filters'

/*
 * THE DEALS TABLE'S QUERY (AGL-3321).
 *
 * `orgs/{orgId}/deals` in the chosen pipeline — the pipeline is the query's
 * base beside the scope clause — newest change first, paged by that query.
 * The status, "No next activity" (`nextTaskAtMs == null`, which every deal
 * is created carrying) and the search word are predicates on the same
 * query. The search reads `searchTokens`, the word prefixes of the title
 * every deal writer stamps (`crmDealListFields`), so "renewal" finds "Acme
 * renewal" on any page. Under a site the scope clause is the query's one
 * array clause and the search folds into it for a reader who may drop it.
 *
 * The board is not this: it draws a pipeline's open deals whole, bounded,
 * and filters nothing.
 *
 * Type and Lead source (AGL-3516) are asked through the keys every deal
 * writer stores beside the labels (`typeKey`, `leadSourceKey` in
 * `crmDealListFields`) — `null` for none, so "No type" is `== null` — the
 * way the Leads list asks its lead source (`dealQueryClause`).
 */

/** The table's one order: newest change first. */
export const DEAL_LIST_SORTS: readonly ListQuerySort[] = [
  { path: 'updatedAt', direction: 'desc' },
]

/**
 * The Type and Lead source controls' "none" choice (AGL-3516). Held in the
 * saved view as an `isEmpty` clause, never as this string.
 */
export const DEAL_PICKLIST_FILTER_NONE = LEAD_SOURCE_FILTER_NONE

/**
 * The Type and Lead source clauses' codec: "none" is an `isEmpty` clause,
 * shown as a choice of the select — the Leads list's own.
 */
export const DEAL_FILTER_CODECS: Readonly<Record<string, ListGridFilterCodec>> = {
  type: LEAD_SOURCE_CODEC,
  leadSource: LEAD_SOURCE_CODEC,
}

/** What the deals table's Filters panel offers — every one asked of the query. */
export const DEAL_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  crmSelectField('status'),
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  crmSelectField('type'),
  crmSelectField('leadSource'),
]

/** A picklist key the query asks: `null` for none, as every deal writer stores it. */
const keyField = (column: string): ListFilterField => ({
  column,
  kind: 'exact',
  path: column,
  presence: 'nullable',
  operators: ['equals', 'isAnyOf', 'isEmpty'],
})

/** The fields the Deals query asks — each a stored field, as named. */
export const DEAL_QUERY_FIELDS: readonly ListFilterField[] = [
  crmSelectField('status'),
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  keyField('typeKey'),
  keyField('leadSourceKey'),
]

export const DEAL_LIST_DECLARATION: ListQueryDeclaration = {
  fields: DEAL_QUERY_FIELDS,
  sorts: DEAL_LIST_SORTS,
  search: CRM_LIST_SEARCH,
}

/** The picklist fields the panel shows by label and the query asks by key. */
const DEAL_KEYED_FIELDS: Readonly<Record<string, string>> = {
  type: 'typeKey',
  leadSource: 'leadSourceKey',
}

/**
 * One grid clause as the clause the Deals query asks (AGL-3516): a Type or
 * a Lead source by its key — "none" as `isEmpty` — and every other clause
 * as it is stored.
 */
export function dealQueryClause(clause: CrmViewFilterClause | ListFilterRequest): CrmClauseAsked {
  const key = DEAL_KEYED_FIELDS[clause.field]
  if (!key) return clause
  const values = crmClauseValues(clause)
  if (clause.op === 'isEmpty' || (values.length === 1 && values[0] === DEAL_PICKLIST_FILTER_NONE)) {
    return { field: key, op: 'isEmpty', value: '' }
  }
  if (values.includes(DEAL_PICKLIST_FILTER_NONE)) {
    return { refused: '"None" cannot be picked beside a value' }
  }
  return crmAnyOf(
    key,
    values.map((value) => crmPicklistKey(value)).filter((entry): entry is string => Boolean(entry)),
  )
}

/**
 * A collaborator's search (see `prefixSearch` in `useCrmListQuery`): the
 * start of the title, `titleLower`, beside the scope clause.
 */
export const DEAL_PREFIX_SEARCH = {
  field: {
    column: 'title',
    kind: 'text',
    path: 'title',
    lowerPath: 'titleLower',
    presence: 'always',
    operators: ['startsWith'],
  } satisfies ListFilterField,
  notice: 'Search matches the start of a deal’s title for access limited to specific sites.',
}

/** The chosen pipeline, as the query's base beside the scope clause. */
export function dealPipelineBase(pipelineId: string | null): ListQueryFilter[] {
  return pipelineId ? [{ path: 'pipelineId', op: '==', value: pipelineId }] : []
}

/** The base's shape for `listQueryIndexes`: the pipeline, an equality. */
export const DEAL_LIST_PIPELINE_BASE_INDEX = [{ path: 'pipelineId' }] as const
