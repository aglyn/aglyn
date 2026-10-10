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
 * (`@aglyn/aglyn/app-utils/site-list-query`): those are one row per member per site, so a
 * cross-organization list over them would list a site once per person who
 * can reach it. The site document carries the same three keys, stamped by
 * `syncHostProjectionForMembers` — `nameLower`, `searchTokens` and
 * `hasCustomDomain` (`hostSearchFields`) — and by
 * `tools/scripts/backfill-host-search-fields.mjs` on sites written before it.
 *
 * ## One order, merged indexes
 *
 * Created, newest first (`createdAt` DESC): the default order, and the one
 * the Created range imposes while it is in force. Each equality and the
 * search token has its `(field, createdAt DESC)` composite, pinned by
 * `specs/staff-site-list-query.spec.ts`. An `orderBy` drops every site that
 * lacks the field, so the field is on every site (see "The header sorts").
 *
 * ## Suspended
 *
 * An equality on the stored `suspended` flag (`utils/server/suspended-flag.ts`):
 * `claimHostForOrg` writes `false`, the lockdown core writes it beside the
 * staff takedown family, and a one-time backfill stamped the sites written
 * before either (`docs/SELF_HOSTING.md`). A timed takedown lapses with no
 * write, so the route clears the flag on every lapsed one before it runs a
 * query that asks about it — the answer, like the row's chip, is the one for
 * this moment.
 *
 * ## Not offered
 *
 *   Organization name  lives on the organization. Filter by Org ID; the
 *                      organization's own page lists its sites.
 *   Owner              the organization's `ownerUid`, not the site's.
 *   Status             Live, Draft and Maintenance are derived from the
 *                      publish map and the customer's own switch, which the
 *                      console's browser-side writers change without any
 *                      mirror — `@aglyn/aglyn/app-utils/site-list-query` gives the detail.
 *                      Suspended is the one part of it the list can answer.
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
  /*
   * Both picked from two named answers (`STAFF_SITE_LIST_FILTER_OPTIONS`),
   * so the panel's select sends `equals`; a select offers no operator for a
   * field that declares only `is`. Custom domain keeps `is` beside it for a
   * clause written before.
   */
  {
    column: 'hasCustomDomain',
    kind: 'boolean',
    path: 'hasCustomDomain',
    operators: ['equals', 'is'],
  },
  // A staff takedown in force — see "Suspended" above.
  { column: 'suspended', kind: 'boolean', path: 'suspended', operators: ['equals'] },
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
  suspended: 'Suspended',
  orgId: 'Org ID',
  $id: 'Site ID',
  createdAt: 'Created',
}

/** The picked filters' answers, by the words the row uses. */
export const STAFF_SITE_LIST_FILTER_OPTIONS = {
  hasCustomDomain: [
    { value: 'true', label: 'Connected' },
    { value: 'false', label: 'None' },
  ],
  suspended: [
    { value: 'true', label: 'Suspended' },
    { value: 'false', label: 'Not suspended' },
  ],
}

/*
 * ## The header sorts (AGL-3680)
 *
 * NEWEST CREATED FIRST BY DEFAULT. The first order is the one the query reads
 * in while no header is asked, and the Created header shows its arrow. It
 * used to be the document id ascending, which no header names: the list read
 * in id order (random for every site since push ids) while the grid looked
 * date-ordered. Every site carries `createdAt` — `provision-host.ts` stamps
 * it at creation, and the one legacy site without it was stamped 2026-10-08
 * — so ordering by it drops nothing.
 *
 * Created newest first is a full order: it is the order the Created range
 * already imposes, so every equality already has its `(field, createdAt
 * DESC)` composite. Site (`nameLower`, stamped on every site — see above)
 * and Last updated (`updatedAt`, stamped at creation and by the writers
 * since) order the QUERY too, `alone` — served only with no filter or search
 * on, falling back to Created newest first with a notice — so on this
 * top-level collection they need no composite at all. Organization, Owner,
 * Custom domain and Status are joined or derived by the route, and sort the
 * page on screen.
 */
export const STAFF_SITE_LIST_COLUMN_SORTS: readonly ListQuerySort[] = [
  { path: 'createdAt', direction: 'desc', column: 'createdAt', label: 'Created' },
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'Created', alone: true },
  { path: 'nameLower', direction: 'asc', column: 'displayName', label: 'Site', alone: true },
  { path: 'nameLower', direction: 'desc', column: 'displayName', label: 'Site', alone: true },
  { path: 'updatedAt', direction: 'desc', column: 'updatedAt', label: 'Last updated', alone: true },
  { path: 'updatedAt', direction: 'asc', column: 'updatedAt', label: 'Last updated', alone: true },
]

/** The list's order while no header is asked: Created, newest first. */
export const STAFF_SITE_LIST_SORT: ListQuerySort = STAFF_SITE_LIST_COLUMN_SORTS[0]

/** The staff Sites list's query: every field above, and the search. */
export const STAFF_SITE_LIST_QUERY: ListQueryDeclaration = {
  fields: STAFF_SITE_LIST_FILTER_FIELDS,
  sorts: STAFF_SITE_LIST_COLUMN_SORTS,
  search: { tokensPath: 'searchTokens' },
}
