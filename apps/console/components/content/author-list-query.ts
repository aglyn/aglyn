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

import { AUTHOR_SCHEMA_TYPE_FIELD } from '@aglyn/aglyn/app-utils/content-query-fields'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * What the Authors tab's table can be filtered and searched by (AGL-2486,
 * AGL-3321) — `hosts/{hostId}/authors`, every clause and the search word on
 * ONE Firestore query, paged by it.
 *
 * The content scope still reads every author (`AUTHORS_MAX_PER_HOST`), because
 * the entry editor's byline picker and the entries table's Author filter
 * choose from all of them. The TABLE does not narrow that read: it is its own
 * query, so a clause answers for every author on the site and a page is a
 * page of matches.
 *
 * Both fields read what `contentAuthorQueryFields` writes on every author
 * write, and `tools/scripts/backfill-authors-search-fields.mjs` on the older
 * ones:
 *
 *   `name`   word-level `contains` over `nameTokens`, the same array the quick
 *            search reads (so the two do not combine), and `equals` over
 *            `nameLower`. No `startsWith`: it is a range over `nameLower`,
 *            which would need the list ordered by it.
 *   `type`   the schema type as the word the row shows — `schemaType`, never
 *            the numeric `type`, which older records spell three ways.
 *
 * The list is ordered by `name`, not `nameLower`: every author carries a name,
 * so the table lists a record the backfill has not reached yet rather than
 * dropping it out of the order. Three composites: one per predicate field,
 * against that one order.
 */
export const AUTHOR_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    presence: 'always',
    operators: ['contains', 'equals'],
  },
  {
    column: 'type',
    kind: 'exact',
    path: AUTHOR_SCHEMA_TYPE_FIELD,
    presence: 'always',
    operators: ['equals'],
  },
]

/** The Authors table's query: its fields, its one order and its search. */
export const AUTHOR_LIST_QUERY: ListQueryDeclaration = {
  fields: AUTHOR_LIST_FILTER_FIELDS,
  sorts: [{ path: 'name', direction: 'asc', column: 'name' }],
  search: { tokensPath: 'nameTokens' },
}

/** How each author field reads on a chip. */
export const AUTHOR_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Author',
  type: 'Type',
}

/** The Type filter's choices: the stored word, which is also what it shows. */
export const AUTHOR_LIST_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  type: (['Person', 'Organization'] as const).map((type) => ({
    value: type,
    label: type,
  })),
}
