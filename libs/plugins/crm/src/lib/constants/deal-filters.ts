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

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { CRM_NEXT_ACTIVITY_FILTER_FIELD } from '../components/crm-next-activity-column'
import { CRM_LIST_SEARCH, crmSelectField } from '../model/crm-list-query'

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
 */

/** The table's one order: newest change first. */
export const DEAL_LIST_SORTS: readonly ListQuerySort[] = [
  { path: 'updatedAt', direction: 'desc' },
]

/** What the deals table's Filters panel offers — every one asked of the query. */
export const DEAL_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  crmSelectField('status'),
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
]

export const DEAL_LIST_DECLARATION: ListQueryDeclaration = {
  fields: DEAL_LIST_FILTER_FIELDS,
  sorts: DEAL_LIST_SORTS,
  search: CRM_LIST_SEARCH,
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
