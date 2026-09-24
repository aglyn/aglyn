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
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryRequest,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * What a site's collaborator roster (`hosts/{hostId}/members`) filters by,
 * and how its query serves it (AGL-3321).
 *
 * The roster is read `orderBy('email')` a page at a time, and every clause
 * the list takes goes on that one query through `planListQuery`, so every
 * page is a page of the answer:
 *
 *   Site access   an equality (one role) or an `in` (several) on `role`,
 *                 which every roster write stores. Beneath the email order
 *                 that is the `members: role ASC, email ASC` composite.
 *   Search        a PREFIX of the address: a `startsWith` clause on `email`,
 *                 which the plan serves as a range on the field the list
 *                 already sorts by, so it needs no index of its own (alone)
 *                 and the same composite (beside a role).
 *
 * ## Why the search is a prefix of the address, not a word token
 *
 * The plan's own search is `array-contains` over a token array, which the
 * roster does not carry. Writing one would buy mid-address words (a domain),
 * at the price of a new field on the roster's writer, a backfill, and a
 * composite. The roster is SORTED by address, so a prefix of the address is
 * a range the email order serves already — the one search this list can
 * answer exactly with what is stored, and the one it has always offered. The
 * route lower-cases the address before storing it, so the stored value is
 * its own normalized key (`lowerPath: 'email'`).
 *
 * ## What else a roster document stores, and why it is not offered
 *
 * `email`, `role`, `status`, `uid` (a linked account only), `addedBy` and
 * `createdAt` — `POST /api/hosts/members` is the only writer, and `PATCH`
 * changes `role` alone. `status` is NOT offered: it is written once, as
 * `invited` or `active`, and nothing moves an invited row to `active` when
 * the invitation is accepted, so "Status is Invited" would answer with people
 * who have long since joined. `createdAt` is not the list's sort, and a range
 * on it would cost a second order's worth of composites for every field.
 * `addedBy` and `uid` are ids nobody filters a roster by.
 */
export const HOST_MEMBER_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'role',
    kind: 'exact',
    path: 'role',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
]

/**
 * The address, which the quick search asks for by prefix. Declared for the
 * plan and not offered in the Filters panel: the search box is the control
 * that asks it, and a second control asking the same question would be two
 * places to clear it from.
 */
const HOST_MEMBER_EMAIL_FIELD: ListFilterField = {
  column: 'email',
  kind: 'text',
  path: 'email',
  lowerPath: 'email',
  presence: 'always',
  operators: ['startsWith'],
}

/** The roster's one query: its fields, and its one order, by address. */
export const HOST_MEMBER_LIST_QUERY: ListQueryDeclaration = {
  fields: [...HOST_MEMBER_FILTER_FIELDS, HOST_MEMBER_EMAIL_FIELD],
  sorts: [{ path: 'email', direction: 'asc' }],
}

export const HOST_MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  role: 'Site access',
  email: 'Address',
}

/**
 * What the roster asks its query for: the panel's clauses, and the quick
 * search's words as the address prefix they mean. The words are joined as
 * typed; an address holds no space, so two words match nothing, which is the
 * honest answer.
 */
export function hostMemberListRequest(
  clauses: readonly ListFilterClause[],
  words: readonly string[],
): ListQueryRequest {
  const prefix = words.join(' ').trim()
  return {
    clauses: [
      ...clauses.filter((clause) => clause.field !== HOST_MEMBER_EMAIL_FIELD.column),
      ...(prefix
        ? [{ field: HOST_MEMBER_EMAIL_FIELD.column, op: 'startsWith', value: prefix }]
        : []),
    ],
  }
}
