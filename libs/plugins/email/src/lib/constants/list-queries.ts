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

import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT EACH EMAILS LIST CAN BE ASKED, ON ITS FIRESTORE QUERY (AGL-3321).
 *
 * Every clause the Filters panel offers and every quick-search word is a
 * predicate on the list's query, planned by `planListQuery`, so each page is a
 * page of the answer. A question no query can answer is not offered. Each
 * list's spec holds `cloud/firebase-firestore.indexes.json` to
 * `listQueryIndexes` of its declaration.
 */

/*==========================================
 * SUPPRESSIONS — `hosts/{hostId}/suppressions`, newest first.
 *
 * `emailTokens` is `emailSearchTokens(email)`, stamped by every writer (the
 * unsubscribe link, the bounce and complaint webhook, the Add drawer, the
 * consent-group carry) and by `backfill-host-suppression-filters.mjs` on
 * the rows written before it. `reason` is written by every writer, and the
 * same backfill stamps `unsubscribe` on the pre-AGL-2408 rows that carry
 * none, which is what an absent reason has always meant.
 *
 * `Since` is `createdAt`, the list's own order, so a date range on it
 * keeps that order and needs no index of its own.
 *=========================================*/
export const SUPPRESSION_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'email',
      kind: 'text',
      path: 'email',
      tokensPath: 'emailTokens',
      operators: ['contains'],
    },
    { column: 'reason', kind: 'exact', path: 'reason', operators: ['equals', 'isAnyOf'] },
    { column: 'since', kind: 'date', path: 'createdAt', presence: 'always' },
  ],
  sorts: [{ path: 'createdAt', direction: 'desc', column: 'since' }],
  search: { tokensPath: 'emailTokens' },
}

export const SUPPRESSION_FILTER_HEADERS: Readonly<Record<string, string>> = {
  email: 'Address',
  reason: 'Reason',
  since: 'Since',
}

/*==========================================
 * EMAIL LISTS — `orgs/{orgId}/lists`, by name.
 *
 * `nameLower` and `nameTokens` travel with `name` (`nameSearchFields`) on
 * the two writers — the card's create and the edit page's rename — and
 * `backfill-email-list-filters.mjs` stamps the lists written before them.
 * `kind` is written on every create; the same backfill stamps `manual` on a
 * list that predates the field, which is what an absent kind has always
 * meant.
 *=========================================*/
export const EMAIL_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'name',
      kind: 'text',
      path: 'name',
      lowerPath: 'nameLower',
      tokensPath: 'nameTokens',
      operators: ['contains', 'equals'],
    },
    { column: 'kind', kind: 'exact', path: 'kind', operators: ['equals'] },
  ],
  sorts: [{ path: 'name', direction: 'asc', column: 'name' }],
  search: { tokensPath: 'nameTokens' },
}

export const EMAIL_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'List',
  kind: 'Membership',
}

export const EMAIL_LIST_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  kind: [
    { value: 'manual', label: 'Manual' },
    { value: 'dynamic', label: 'Rule' },
  ],
}

/*==========================================
 * A LIST'S MEMBERS — `orgs/{orgId}/lists/{listId}/members`, by document id.
 *
 * `__name__` is the order because it is the one key every row has (see the
 * panel), and under it equalities and one array clause merge on Firestore's
 * automatic single-field indexes: no composite at all.
 *
 * `searchTokens` is the name's word prefixes and the address's
 * (`listMemberSearchTokens`), stamped by `enrollListMember` — the
 * collection's only writer — and by `backfill-email-list-filters.mjs`.
 * `email` is normalized before every write, so `equals` asks for the
 * normalized address. `via` is written on every new row and stamped
 * `manual` where it is absent, which is what absent has always meant.
 *
 * ⛔ Consent is NOT filterable. It is read per viewing consent group
 * (`readMarketingBasis`), so no stored value answers it for every reader.
 *=========================================*/
export const LIST_MEMBER_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'email',
      kind: 'text',
      path: 'email',
      lowerPath: 'email',
      presence: 'always',
      operators: ['equals'],
    },
    { column: 'via', kind: 'exact', path: 'via', operators: ['equals'] },
  ],
  sorts: [{ path: '__name__', direction: 'asc' }],
  search: { tokensPath: 'searchTokens' },
}

export const LIST_MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  email: 'Address',
  via: 'How',
}

export const LIST_MEMBER_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  via: [
    { value: 'rule', label: 'Rule' },
    { value: 'manual', label: 'Added' },
  ],
}

/*==========================================
 * EMAIL TEMPLATES — `hosts/{hostId}/screens` where `kind == 'email'`, by
 * name.
 *
 * The screen search keys — `nameLower` and `nameTokens`, both from
 * `displayName` (`displayNameSearchFields`) — are what every screen writer
 * stamps on a create and a rename, and what the site artifacts backfill
 * stamps on the screens written before them. The order is `nameLower`, so a
 * screen without it is not listed: a deleted template clears its keys with
 * the delete (`emailTemplateSoftDelete`), which is how the list leaves
 * tombstones out without a clause no query could hold ("deletedAt is
 * absent").
 *
 * ⛔ Origin (yours or installed) is NOT filterable: "installed" is the
 * presence of the install provenance and "yours" its absence, and a query
 * cannot ask for a field to be absent.
 *=========================================*/
export const EMAIL_TEMPLATE_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'displayName',
      kind: 'text',
      path: 'displayName',
      lowerPath: 'nameLower',
      tokensPath: 'nameTokens',
      // `startsWith` ranges over `nameLower`, the list's own order. No
      // `endsWith`: it would range over `nameReversed` and reorder the list
      // by it, an order's worth of indexes for one operator.
      operators: ['contains', 'equals', 'startsWith'],
    },
  ],
  sorts: [{ path: 'nameLower', direction: 'asc', column: 'displayName' }],
  search: { tokensPath: 'nameTokens' },
}

/** The template list's scope: email screens only. */
export const EMAIL_TEMPLATE_BASE = [{ path: 'kind', op: '==' as const, value: 'email' }]

export const EMAIL_TEMPLATE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Template',
}
