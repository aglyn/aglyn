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
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF SITES LIST'S QUERY (AGL-3378).
 *
 * Every site on the platform, read from `hosts` by `/api/admin/sites` with
 * the Admin SDK, every Filters-panel clause and the search planned onto one
 * Firestore query by `planListQuery` (the AGL-3321 contract). Nothing is
 * matched over a page already read.
 *
 * Not the members' `hostMemberships` rows the workspace Sites cards read
 * (`utils/site-list-query.ts`): those are one row per member per site, so a
 * cross-organization list over them would list a site once per person who
 * can reach it. The site document carries the same three keys, stamped by
 * `syncHostProjectionForMembers` — `nameLower`, `searchTokens` and
 * `hasCustomDomain` (`hostSearchFields`) — and by
 * `tools/scripts/backfill-host-search-fields.mjs` on sites written before it.
 *
 * ## One order, merged indexes
 *
 * The document id, as the organization list: an `orderBy` on a data field
 * drops every site that lacks it. Equalities and the search token merge
 * against the built-in single-field indexes in that order. The one range is
 * Created, which leads the order (`createdAt` DESC) while it is in force,
 * and each equality has its `(field, createdAt DESC)` composite, pinned by
 * `specs/staff-site-list-query.spec.ts`.
 *
 * ## Not offered
 *
 *   Organization name  lives on the organization. Filter by Org ID; the
 *                      organization's own page lists its sites.
 *   Owner              the organization's `ownerUid`, not the site's.
 *   Status             derived (publish map, suspension windows,
 *                      maintenance) and wrong the moment a timed suspension
 *                      lapses — `utils/site-list-query.ts` gives the detail.
 */
export const STAFF_SITE_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    lowerPath: 'nameLower',
    presence: 'always',
    operators: ['equals'],
  },
  {
    // Subdomains are lower-case by construction (`SUBDOMAIN_PATTERN`), so the
    // stored value is its own normalized key.
    column: 'subdomain',
    kind: 'text',
    path: 'subdomain',
    lowerPath: 'subdomain',
    presence: 'always',
    operators: ['equals'],
  },
  {
    // Custom domains are lower-cased by the attach route before they are
    // stored, for the same reason.
    column: 'cname',
    kind: 'text',
    path: 'cname',
    lowerPath: 'cname',
    operators: ['equals'],
  },
  { column: 'hasCustomDomain', kind: 'boolean', path: 'hasCustomDomain', operators: ['is'] },
  {
    column: 'orgId',
    kind: 'exact',
    path: 'orgId',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  { column: '$id', kind: 'id', path: LIST_QUERY_ID_PATH, operators: ['equals', 'isAnyOf'] },
  {
    // The one range, which orders the list by itself while it is in force.
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/** How each field reads, as a hidden column's header and on its chip. */
export const STAFF_SITE_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Site',
  subdomain: 'Subdomain',
  cname: 'Custom domain address',
  hasCustomDomain: 'Custom domain',
  orgId: 'Org ID',
  $id: 'Site ID',
  createdAt: 'Created',
}

/** The Custom domain filter's two answers, by the words the column uses. */
export const STAFF_SITE_LIST_FILTER_OPTIONS = {
  hasCustomDomain: [
    { value: 'true', label: 'Connected' },
    { value: 'false', label: 'None' },
  ],
}

/** The list's order while no range is in force. */
export const STAFF_SITE_LIST_SORT: ListQuerySort = { path: LIST_QUERY_ID_PATH, direction: 'asc' }

/** The staff Sites list's query: every field above, and the search. */
export const STAFF_SITE_LIST_QUERY: ListQueryDeclaration = {
  fields: STAFF_SITE_LIST_FILTER_FIELDS,
  sorts: [STAFF_SITE_LIST_SORT],
  search: { tokensPath: 'searchTokens' },
}
