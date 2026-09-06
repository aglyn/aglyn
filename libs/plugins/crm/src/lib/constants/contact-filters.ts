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

/*
 * Contacts (`orgs/{orgId}/contacts`, read scoped to a host).
 *
 * The card's listener is `limit(1000)` and stays that way — nobody needs
 * forty thousand rows streamed into a table. What that cap must NOT do is
 * decide what a search can find, and it did: an org with 40,000 contacts
 * searched 1,000 of them and answered "no contacts match" for the rest. The
 * head-count already learned this lesson (AGL-1706, a server aggregate); the
 * search is the same mistake one field over.
 *
 * ⛔ `marketingConsent`, `ordersCount` and `ltvCents` are written only when
 * they apply, so a `false`/`0` filter would return nothing rather than
 * everyone else. `isNotEmpty` is exact on them and is what the menu offers.
 */
export const CONTACT_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    reversedPath: 'nameReversed',
  },
  {
    // `normalizeContactEmail` lower-cases before every write, so the stored
    // value IS its own normalized key.
    column: 'email',
    kind: 'text',
    path: 'email',
    lowerPath: 'email',
    presence: 'always',
  },
  {
    /*
     * Already an array of lower-cased tags, so `contains` is a plain
     * `array-contains` — the one place the word-level caveat does not apply,
     * because a tag is matched whole rather than by word prefix.
     */
    column: 'tags',
    kind: 'text',
    path: 'tags',
    tokensPath: 'tags',
    // Ordered by the timestamp the list already sorts on, not by the tag
    // array — `orderBy` on the same field an `array-contains` matches is a
    // composite index nobody wants to explain.
    containsOrderBy: 'updatedAt',
    operators: ['contains', 'isNotEmpty'],
  },
  {
    /*
     * The forms a person came in through — the top-level `formIds` mirror
     * of the interactions' `formId` (AGL-2612), matched whole and as typed
     * because a form id is minted with mixed case. The form's own page links
     * here with its id; nobody types one. Ordered by the list's own
     * timestamp for the reason `tags` is, served by the
     * `(formIds CONTAINS, updatedAt DESC)` index.
     *
     * ⚠️ An `array-contains` on the mirror cannot share a query with the
     * `visibleTo` scope clause, so the list drops that clause for this one
     * filter and the rules admit the read to an org-wide member only — the
     * caveat the company contacts card states, stated again on the list.
     */
    column: 'formIds',
    kind: 'text',
    path: 'formIds',
    tokensPath: 'formIds',
    verbatimTokens: true,
    containsOrderBy: 'updatedAt',
    operators: ['contains'],
  },
  { column: 'hostId', kind: 'exact', path: 'hostId', presence: 'always' },
  { column: 'ordersCount', kind: 'number', path: 'ordersCount' },
  { column: 'ltvCents', kind: 'number', path: 'ltvCents' },
  { column: 'createdAt', kind: 'date', path: 'createdAt', presence: 'always' },
  { column: 'updatedAt', kind: 'date', path: 'updatedAt', presence: 'always' },
]

/** Headers for contact fields that are filterable without being columns. */
export const CONTACT_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  formIds: 'Form ID',
  hostId: 'Site ID',
  ordersCount: 'Orders',
  ltvCents: 'Lifetime value (cents)',
  updatedAt: 'Updated',
}
