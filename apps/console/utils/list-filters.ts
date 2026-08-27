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

/**
 * What each console list can be filtered by (AGL-693).
 *
 * These are imported by BOTH the route that queries and the page that renders,
 * so the operator menu and the predicate cannot disagree. Adding a field here
 * makes it filterable in both places at once; a field that is not here is not
 * offered, which is the point — see `@aglyn/shared-ui-jsx/const/list-filter`.
 *
 * Every entry names a path that exists ON THE LISTED DOCUMENT. A field held in
 * a subcollection or derived at read time cannot be a predicate, because
 * Firestore filters the collection it queries and nothing else.
 */

/**
 * Organizations (`orgs/{orgId}`).
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
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    reversedPath: 'nameReversed',
    presence: 'always',
  },
  {
    // Slugs are lower-case by construction (`generateOrgSlug`), so the stored
    // value is its own normalized key and needs no `slugLower` twin.
    column: 'slug',
    kind: 'text',
    path: 'slug',
    lowerPath: 'slug',
    presence: 'always',
  },
  { column: '$id', kind: 'id', path: '__name__' },
  { column: 'ownerUid', kind: 'exact', path: 'ownerUid', presence: 'always' },
  { column: 'plan', kind: 'exact', path: 'plan' },
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
  },
  { column: 'createdAt', kind: 'date', path: 'createdAt', presence: 'always' },
  { column: 'updatedAt', kind: 'date', path: 'updatedAt', presence: 'always' },
]

/** Headers for the fields above that are filterable without being columns. */
export const ORG_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  $id: 'Org ID',
  slug: 'Org slug',
  ownerUid: 'Owner UID',
  updatedAt: 'Updated',
}
