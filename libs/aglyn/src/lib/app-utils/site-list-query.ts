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

import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * WHAT THE SITES CARDS ASK, AND OF WHICH COLLECTION (AGL-3321).
 *
 * The Sites page is a grid of site CARDS, and stays one: the filters and the
 * search sit over the cards, and the cards are drawn exactly as before. What
 * changed is which sites the cards are drawn for. They are a paged query over
 * the reader's own site memberships, `users/{uid}/hostMemberships` —
 * `where(orgId ==)` for the workspace, the filters' clauses and the search
 * word, in ONE order — and each page's rows are joined by id to the host
 * documents `useOrgHosts` already holds, for display only. Nothing is matched
 * over the sites already loaded.
 *
 * Not `hosts`: the rules serve a non-staff LIST of `hosts` only under a
 * `memberRoles.{uid}` clause, a composite index on that per-user map path can
 * exist for no order but the document id, and a predicated listen over the
 * mutable `memberRoles`/`orgId` tombstoned host documents for every other
 * reader (AGL-1190). The membership rows are owner-readable with no
 * `resource.data` term, so any `where` is allowed on them.
 *
 * So the cards offer exactly what a row carries (`membershipRow` in
 * `@aglyn/tenant-data-admin`), each re-derived from the host on every
 * re-sync and stamped on older rows by
 * `tools/scripts/backfill-host-memberships-list-fields.mjs`:
 *
 *   - search: `searchTokens`, the start of a word of the name, the subdomain
 *     (the site's slug) or the custom domain;
 *   - Custom domain: `hasCustomDomain`, connected or none — an equality;
 *   - Created: the day ranges, on the host's own `createdAt`. A range orders
 *     the query by the field it ranges over, so under it the cards run
 *     newest first; otherwise they run by name, A to Z.
 *
 * NOT offered, each because a row cannot answer it honestly:
 *
 *   - Status (Live, Draft, Maintenance, Suspended) is derived from
 *     `suspendedAt`, `suspendedUntilMs`, `maintenance` and the `screens`
 *     publish map. A timed suspension ENDS with no write at all, so a stored
 *     status is wrong the moment it lapses; and those fields are written by
 *     the console's publish batches in the browser, the tenant's scheduled
 *     publish, the error-screen save and the staff lockdown routes, none of
 *     which re-syncs a mirror.
 *   - Updated is the host's `updatedAt`, which nearly every write to a site
 *     moves without a re-sync; and the list takes ONE range, Created.
 *   - Plan, owner (created by) and template: a site document stores none of
 *     them. The plan is the organization's, the same for every card here.
 */

/** The collection group the list queries, and that its indexes are declared on. */
export const SITE_LIST_COLLECTION_GROUP = 'hostMemberships'

export const SITE_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'hasCustomDomain',
    kind: 'boolean',
    path: 'hasCustomDomain',
    operators: ['is'],
  },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    // A site with no recorded date carries `null`, which no range matches;
    // `is empty` and `is not empty` are not offered, since `!= null` would be
    // a second range beside the day ones.
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/** How each filter reads on a chip, a notice and the Filters panel. */
export const SITE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  hasCustomDomain: 'Custom domain',
  createdAt: 'Created',
}

/** The Custom domain filter's two answers, by the words the card uses. */
export const SITE_FILTER_OPTIONS = {
  hasCustomDomain: [
    { value: 'true', label: 'Connected' },
    { value: 'false', label: 'None' },
  ],
}

/** The cards' own order, and the default: by name, A to Z. */
export const SITE_LIST_NAME_SORT: ListQuerySort = {
  path: 'nameLower',
  direction: 'asc',
}

export const SITE_LIST_DECLARATION: ListQueryDeclaration = {
  fields: SITE_FILTER_FIELDS,
  sorts: [
    SITE_LIST_NAME_SORT,
    // The order a Created range imposes: newest first.
    { path: 'createdAt', direction: 'desc' },
  ],
  search: { tokensPath: 'searchTokens' },
}

/**
 * The list's scope: the workspace's sites, or — for an account with no
 * workspace yet, which `useOrgHosts` lists unscoped too — every site.
 */
export function siteListBase(orgId: string | null): ListQueryFilter[] {
  return orgId ? [{ path: 'orgId', op: '==', value: orgId }] : []
}

/** The scope's shape, for the index enumeration. */
export const SITE_LIST_INDEX_BASE: ReadonlyArray<{ path: string }> = [{ path: 'orgId' }]

/**
 * How many cards a "Load more" adds: four rows of the three-across grid, so
 * a page never ends on a half-empty row.
 */
export const SITE_CARDS_PAGE_SIZE = 12
