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

import {
  CONSOLE_USER_TYPE_LABELS,
  ORG_ROLES,
} from '@aglyn/aglyn/app-utils/organizations'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT THE TEAM ROSTER FILTERS AND SEARCHES BY, AND HOW ITS QUERY SERVES IT
 * (AGL-3321).
 *
 * The organization's Members card lists `orgs/{orgId}/members` through
 * `GET /api/orgs/members`. Unfiltered it holds the whole roster, which the
 * seat counts above it need anyway. With a Filters clause or a search word,
 * the route plans them onto ONE Admin-SDK query over the collection
 * (`planListQuery` → `applyListQuery`) and the card lists what that query
 * answers — every match, never the roster it already holds narrowed.
 *
 *   Role     `role`, an equality (one) or an `in` (several).
 *   Access   `consoleUserType` — `manager` or `collaborator`, the verdict
 *            `consoleUserType` reads from the member's reach, stamped on every
 *            member by the membership writes (`orgMemberListFields` in
 *            `@aglyn/tenant-data-admin`).
 *   Search   `searchTokens`: the start of a word of the member's name,
 *            address or job title.
 *
 * Ordered by document id, the order the roster has always come back in, so
 * every shape is equalities and one array clause over that order — which
 * Firestore serves by merging its single-field indexes. No composite index
 * is needed, and `org-member-list-query.spec.ts` holds it to that.
 */
export const ORG_MEMBER_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'role',
    kind: 'exact',
    path: 'role',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'access',
    kind: 'exact',
    path: 'consoleUserType',
    presence: 'always',
    operators: ['equals'],
  },
]

export const ORG_MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  role: 'Role',
  access: 'Access',
}

export const ORG_MEMBER_FILTER_OPTIONS = {
  role: ORG_ROLES.map((value) => ({ value, label: value })),
  // An org member is one or the other; a site member is never on this roster.
  access: (['manager', 'collaborator'] as const).map((value) => ({
    value,
    label: CONSOLE_USER_TYPE_LABELS[value],
  })),
}

/** Fields whose values are picked from a list rather than typed. */
export const ORG_MEMBER_SELECT_FIELDS: readonly string[] = ['role', 'access']

export const ORG_MEMBER_LIST_QUERY: ListQueryDeclaration = {
  fields: ORG_MEMBER_FILTER_FIELDS,
  sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
  search: { tokensPath: 'searchTokens' },
}

/** How many matches one request answers; the card follows the cursor. */
export const ORG_MEMBER_LIST_PAGE = 100
