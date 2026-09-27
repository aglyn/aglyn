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

import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT A SITE'S A/B TESTING LIST ASKS FIRESTORE (AGL-3321).
 *
 * Every clause the list's Filters panel offers, and its search box, is a
 * predicate on ONE query over `hosts/{hostId}/experiments`, ordered by name,
 * paged by that query — never a match over the experiments a read happened
 * to hold. Each field is here because a query can serve it:
 *
 *   name    `contains` a word (the `nameTokens` array) or `equals` the whole
 *           name (`nameLower`). Every writer of an experiment stamps both
 *           through `nameSearchFields` — the console's editor, the besigner's
 *           "test this section" shortcut and the seeds — and
 *           `tools/scripts/backfill-experiments-name-search.mjs` stamps the
 *           ones saved before;
 *   target  what the test splits (screen, section, email), which every
 *           writer sets;
 *   status  draft, running, paused or done, which every writer sets.
 *
 * The one order is `name` ascending, as the list has always read. No range
 * is offered: a range orders the list by the field it ranges over, and would
 * cost one composite per field above under that order (four), for a list a
 * site keeps a handful of tests in.
 */

/** The array `contains` and the search box read: every word's prefixes. */
export const EXPERIMENT_NAME_TOKENS = 'nameTokens'
/** The lower-cased whole name `equals` reads. */
export const EXPERIMENT_NAME_LOWER = 'nameLower'

export const EXPERIMENT_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'name',
      kind: 'text',
      path: 'name',
      lowerPath: EXPERIMENT_NAME_LOWER,
      tokensPath: EXPERIMENT_NAME_TOKENS,
      operators: ['contains', 'equals'],
    },
    { column: 'target', kind: 'exact', path: 'target', presence: 'always', operators: ['equals', 'isAnyOf'] },
    { column: 'status', kind: 'exact', path: 'status', presence: 'always', operators: ['equals', 'isAnyOf'] },
  ],
  sorts: [{ path: 'name', direction: 'asc' }],
  search: { tokensPath: EXPERIMENT_NAME_TOKENS },
}
