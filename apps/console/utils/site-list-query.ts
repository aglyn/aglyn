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

/*
 * WHAT THE SITES LIST ASKS, AND OF WHICH COLLECTION (AGL-3321).
 *
 * The list is a paged query over the reader's own site memberships,
 * `users/{uid}/hostMemberships` — `where(orgId ==)` for the workspace, the
 * Filters panel's clauses and the quick search's word, in ONE order — and each
 * page's rows are joined by id to the host documents `useOrgHosts` already
 * holds, for display only. Nothing is matched over rows already loaded.
 *
 * Not `hosts`: the rules serve a non-staff LIST of `hosts` only under a
 * `memberRoles.{uid}` clause, a composite index on that per-user map path can
 * exist for no order but the document id, and a predicated listen over the
 * mutable `memberRoles`/`orgId` tombstoned host documents for every other
 * reader (AGL-1190). The membership rows are owner-readable with no
 * `resource.data` term, so any `where` is allowed on them.
 *
 * So the list offers exactly what a row carries (`membershipRow` in
 * `@aglyn/tenant-data-admin`), and nothing it would have to guess:
 *
 *   - Site: `equals` and `starts with` on `nameLower`, which the list sorts by;
 *   - Created: the day ranges, on the host's own `createdAt`, which the list
 *     can sort by too (a range orders by the field it ranges over);
 *   - search: `searchTokens`, a word of the name, the subdomain or the custom
 *     domain.
 *
 * NOT offered, each because a row cannot answer it honestly:
 *
 *   - Status is derived from `suspendedAt`, `suspendedUntilMs`, `maintenance`
 *     and the `screens` publish map. A timed suspension ENDS with no write at
 *     all, so a stored status is wrong the moment it lapses; and the four
 *     fields are written from the console's publish and error-screen saves,
 *     the tenant's scheduled-publish runtime and the staff lockdown routes,
 *     none of which re-syncs a mirror.
 *   - Custom domain status reads the attach/detach pending flags, which the
 *     staff re-attach and the domain-completer sweep also flip.
 *   - Updated is the host's `updatedAt`, which nearly every write to a site
 *     moves; the row's own `updatedAt` is when the row was synced, a
 *     different fact.
 *   - The platform and custom domains as filters: the search finds a site by
 *     either, and a column filter would spend composites to repeat it.
 */

/** The collection group the list queries, and that its indexes are declared on. */
export const SITE_LIST_COLLECTION_GROUP = 'hostMemberships'

export const SITE_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    lowerPath: 'nameLower',
    // Every row carries `nameLower` ('' for a nameless site).
    presence: 'always',
    operators: ['equals', 'startsWith'],
  },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    // A site with no recorded date carries `null`, which no range matches.
    presence: 'nullable',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/** The Site column's own order, and the default. */
export const SITE_LIST_NAME_SORT: ListQuerySort = {
  path: 'nameLower',
  direction: 'asc',
  column: 'displayName',
}

export const SITE_LIST_DECLARATION: ListQueryDeclaration = {
  fields: SITE_FILTER_FIELDS,
  sorts: [
    SITE_LIST_NAME_SORT,
    { path: 'createdAt', direction: 'desc', column: 'createdAt' },
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
