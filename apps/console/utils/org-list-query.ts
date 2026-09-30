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
 * THE STAFF ORGANIZATION LISTS' QUERIES (AGL-3321).
 *
 * Two staff surfaces read `orgs`, and both plan every clause and the search
 * word onto their Firestore query through `planListQuery`; nothing is matched
 * over rows a read already fetched:
 *
 *   list                          reads                     declaration
 *   Organizations (/admin/orgs)   /api/admin/orgs           ORG_LIST_QUERY
 *   Margin & utilization          /api/admin/margin-        ORG_MARGIN_QUERY
 *                                 utilization
 *
 * Both are read by Admin-SDK routes (`runStaffListQuery`), so the security
 * rules never see these queries.
 *
 * ## The orders, merged indexes
 *
 * With no order asked for, the order is the DOCUMENT ID, as it always was —
 * the staff pickers' page walk and the margin scan rely on it. Equalities and
 * the search token merge against the built-in single-field indexes in that
 * order, so they need no composite at all.
 *
 * The Organizations grid sorts by its column headers (`ORG_LIST_COLUMN_SORTS`):
 * Organization A to Z and back (`nameLower`) and Created either way. An
 * `orderBy` on a data field drops every organization that lacks it, so only
 * fields EVERY organization carries are offered — `nameLower` and `createdAt`
 * are stamped by `createOrganization`. The stored plan and the billing status
 * are absent on an org that never had one, so their columns do not sort: the
 * sort would hide exactly those orgs. Each order costs one
 * `(field, order)` composite per equality and for the search token
 * (`listQueryIndexes`), pinned by `specs/org-list-query.spec.ts`.
 *
 * The one range is Created, which then leads the order — in the direction the
 * header asked for when that is Created, `createdAt` DESC otherwise. A
 * second range — Updated, a name that starts or ends with, a slug or an id
 * that starts with, `is not empty` on the plan — would each need its own
 * order and a further set of composites for every equality, so none is
 * offered; one range per table.
 *
 * ## The search
 *
 * `nameTokens`: every prefix of every word of the name, stamped by the two
 * writers of an organization's `name` (`createOrganization` and the rename in
 * `/api/orgs/settings`, both through `nameSearchTokens`) and by
 * `tools/scripts/backfill-org-name-search.mjs` on any organization written
 * without them. The rules deny all three keys to every client write.
 */

/**
 * Organizations (`orgs/{orgId}`) — what the staff list's Filters panel
 * offers.
 *
 * ⛔ Three things a reader might reasonably expect are absent, and each for the
 * same reason — the query has nothing to filter on:
 *
 *   Stripe customer   lives at `orgs/{orgId}/billing/stripe`, a subcollection
 *                     document. A parent cannot be filtered by a child's
 *                     field; a collection-group query over `billing` returns
 *                     billing documents, not organizations, so it can neither
 *                     page nor sort this list.
 *   Member counts     not stored on the org at all — seats are counted by
 *                     reading members. Filtering needs a maintained counter,
 *                     and a counter that can drift is worse than no filter.
 *   Site limit        derived from plan and entitlements when the row renders;
 *                     `entitlements` holds feature flags, not a number.
 *
 * `enterprise` is likewise absent: it is written only on the organizations
 * that have it, so `is false` would return nothing rather than everyone else —
 * a filter that lies in exactly one direction.
 */
export const ORG_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    // Word-prefix `contains` over `nameTokens`, and `equals` over the
    // normalized `nameLower`; both are equalities, so both compose with
    // everything else.
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    presence: 'always',
    operators: ['contains', 'equals'],
  },
  {
    // Slugs are lower-case by construction (`generateOrgSlug`), so the stored
    // value is its own normalized key and needs no `slugLower` twin.
    column: 'slug',
    kind: 'text',
    path: 'slug',
    lowerPath: 'slug',
    presence: 'always',
    operators: ['equals'],
  },
  { column: '$id', kind: 'id', path: LIST_QUERY_ID_PATH, operators: ['equals', 'isAnyOf'] },
  {
    column: 'ownerUid',
    kind: 'exact',
    path: 'ownerUid',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  { column: 'plan', kind: 'exact', path: 'plan', operators: ['equals', 'isAnyOf'] },
  {
    /*
     * The DENORMALIZED billing status, not the live subscription.
     *
     * The subscription itself moved to `orgs/{orgId}/billing/stripe`
     * (AGL-1028) and the row merges it in after the query has run, so it is
     * not something the query can narrow by. `billingStatus` is the mirror
     * `writeOrgBilling` keeps on the org document for the dunning banner, and
     * it is the only status a predicate can reach.
     */
    column: 'subscription',
    kind: 'exact',
    path: 'billingStatus',
    operators: ['equals', 'isAnyOf'],
  },
  {
    /*
     * Suspended or not: an equality on the stored `suspended` flag, which
     * every organization carries (`createOrganization` writes `false`, the
     * lockdown core writes it beside the `suspended*` family, and
     * `tools/scripts/backfill-suspended-flag.mjs` stamps the older ones).
     * Not `suspendedAt`: `!= null` would be a second range, and a timed
     * suspension lapses with no write at all. The route clears the flag on
     * every lapsed lock before it runs a query that asks about it
     * (`settleLapsedSuspensions`), so the answer is the one for this moment.
     */
    column: 'suspended',
    kind: 'boolean',
    path: 'suspended',
    // Picked from two named answers, so the panel's select sends `equals`.
    operators: ['equals'],
  },
  {
    // The one range, which orders the list by itself while it is in force.
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    presence: 'always',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/**
 * How each field above reads — as a hidden column's header, and on the chip
 * over the grid. `plan` and `subscription` name what the query matches, the
 * STORED values, which is not always what the row shows beside them.
 */
export const ORG_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Organization',
  plan: 'Stored plan',
  subscription: 'Billing status',
  suspended: 'Suspended',
  createdAt: 'Created',
  $id: 'Org ID',
  slug: 'Org slug',
  ownerUid: 'Owner UID',
}

/** The Suspended filter's two answers, by the word the row's chip uses. */
export const ORG_SUSPENDED_FILTER_OPTIONS = [
  { value: 'true', label: 'Suspended' },
  { value: 'false', label: 'Not suspended' },
] as const

/** The order both organization lists keep while no order is asked for. */
export const ORG_LIST_SORT: ListQuerySort = { path: LIST_QUERY_ID_PATH, direction: 'asc' }

/**
 * The orders the Organizations grid's headers ask for, the page's default
 * (newest first) FIRST. Only fields every organization carries — see "The
 * orders" above.
 */
export const ORG_LIST_COLUMN_SORTS: readonly ListQuerySort[] = [
  { path: 'createdAt', direction: 'desc', column: 'createdAt' },
  { path: 'createdAt', direction: 'asc', column: 'createdAt' },
  { path: 'nameLower', direction: 'asc', column: 'name' },
  { path: 'nameLower', direction: 'desc', column: 'name' },
]

/** Where an organization's search tokens are stored. */
export const ORG_NAME_TOKENS_PATH = 'nameTokens'

/** The staff Organizations list's query: every field above, and the search. */
export const ORG_LIST_QUERY: ListQueryDeclaration = {
  fields: ORG_LIST_FILTER_FIELDS,
  sorts: [ORG_LIST_SORT, ...ORG_LIST_COLUMN_SORTS],
  search: { tokensPath: ORG_NAME_TOKENS_PATH },
}

/**
 * What the margin page's per-organization table offers: the two of its
 * columns that are STORED on the organization. Month, net revenue, margin
 * and every band are computed from the organization's usage rollup after the
 * query has run, so no query can narrow by them and they are not offered.
 */
export const ORG_MARGIN_FILTER_FIELDS: readonly ListFilterField[] = ORG_LIST_FILTER_FIELDS.filter(
  (field) => field.column === 'name' || field.column === 'plan',
)

export const ORG_MARGIN_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Organization',
  plan: 'Stored plan',
}

/**
 * The margin scan's query: Organization, Stored plan and the search, in
 * document-id order. Equalities only, so it needs no composite.
 */
export const ORG_MARGIN_QUERY: ListQueryDeclaration = {
  fields: ORG_MARGIN_FILTER_FIELDS,
  sorts: [ORG_LIST_SORT],
  search: { tokensPath: ORG_NAME_TOKENS_PATH },
}
