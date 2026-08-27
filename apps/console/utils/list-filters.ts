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

/*
 * The staff ACCOUNT list is not a Firestore query (AGL-693).
 *
 * It is Firebase Auth, whose `listUsers` takes a page size and a cursor and
 * nothing else — no predicate, no ordering, no search — and there is no
 * Firestore mirror to filter instead: the `users` collection holds profile
 * details for a fraction of the accounts and carries neither email nor the
 * staff claim.
 *
 * So a filter here is answered by scanning the pools and matching in memory,
 * which makes this list MORE capable than a Firestore-backed one rather than
 * less: plain JavaScript does a mid-string `contains` and a `doesNotContain`
 * that no index can. Each field says so through `operators`.
 *
 * Exact email and exact uid never reach the scan — Firebase Auth answers
 * those in one call, and the route routes them there.
 */
const MEMORY_TEXT_OPERATORS = [
  'contains',
  'doesNotContain',
  'equals',
  'startsWith',
  'endsWith',
  'isAnyOf',
  'isEmpty',
  'isNotEmpty',
] as const

const MEMORY_DATE_OPERATORS = [
  'is',
  'after',
  'onOrAfter',
  'before',
  'onOrBefore',
  'isEmpty',
  'isNotEmpty',
] as const

/** Accounts, as `/api/admin/users` serializes them. */
export const USER_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'email', kind: 'text', path: 'email', operators: MEMORY_TEXT_OPERATORS },
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    operators: MEMORY_TEXT_OPERATORS,
  },
  { column: 'uid', kind: 'text', path: 'uid', operators: MEMORY_TEXT_OPERATORS },
  { column: 'disabled', kind: 'boolean', path: 'disabled' },
  { column: 'staff', kind: 'boolean', path: 'staff' },
  {
    column: 'staffRole',
    kind: 'exact',
    path: 'staffRole',
    operators: ['equals', 'isAnyOf', 'isEmpty', 'isNotEmpty'],
  },
  {
    /*
     * The GCIP pool. `null` is the project pool, which is why `isEmpty` is
     * the way to ask for "not an SSO account" — and why it is offered here
     * even though a Firestore-backed list could not answer it.
     */
    column: 'tenantId',
    kind: 'text',
    path: 'tenantId',
    operators: MEMORY_TEXT_OPERATORS,
  },
  {
    // Serialized as an array of provider ids; matched as its joined text, so
    // `contains 'google'` finds `google.com`.
    column: 'providers',
    kind: 'text',
    path: 'providers',
    operators: ['contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'],
  },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    operators: MEMORY_DATE_OPERATORS,
  },
  {
    // Absent until a first sign-in, so `isEmpty` here means "never signed in".
    column: 'lastSignInAt',
    kind: 'date',
    path: 'lastSignInAt',
    operators: MEMORY_DATE_OPERATORS,
  },
]

/** Headers for account fields that are filterable without being columns. */
export const USER_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  uid: 'UID',
  displayName: 'Display name',
  staff: 'Staff claim',
  staffRole: 'Staff role',
  tenantId: 'SSO pool (empty = none)',
  providers: 'Sign-in providers',
  lastSignInAt: 'Last sign-in',
  disabled: 'Disabled',
}

/*
 * The activity feeds (`activity` subcollections, read as a collection group).
 *
 * These are ordered `createdAt` DESC and their cursor is a document in that
 * ordering, so the sort is not the filter's to change: re-sorting to suit a
 * predicate would not narrow the feed, it would shuffle it and invalidate
 * every cursor already handed out. With the order pinned, Firestore allows
 * equality on any field (given a composite index) and a range over the sort
 * field itself — which is exactly what is declared here.
 *
 * ⛔ `scopeId` is not filterable and cannot be. It is not a stored field: the
 * reader derives it from the document's PATH (`doc.ref.parent.parent`), and a
 * query cannot filter on where a document lives. Filtering by site would mean
 * writing the scope onto each entry.
 */
export const ACTIVITY_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    // Equality and `in` only — a text range would need `action` to be the
    // first `orderBy`, which would unsort the feed.
    column: 'action',
    kind: 'exact',
    path: 'action',
    operators: ['equals', 'isAnyOf'],
  },
  {
    // The sort field, so a range over it is free: the existing
    // `actorId ASC, createdAt DESC` index already serves it.
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
]

/*
 * Site members (`hosts/{hostId}/siteMembers`) — the site's AUDIENCE.
 *
 * Not console users and not Firebase Auth accounts: a site member is a
 * Firestore document with its own scrypt hash and its own per-host session
 * cookie, which is why this list is a plain collection query while the staff
 * account list has to walk Auth pools.
 *
 * ⛔ `suspended` is not filterable. It is written only when a member IS
 * suspended, so `is false` would return nothing rather than everyone else — a
 * filter that lies in exactly one direction. Offering it needs the writers to
 * store `false` explicitly, and a backfill for the documents that predate it.
 */
export const SITE_MEMBER_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    // The register path lower-cases before storing, so the stored value IS
    // its own normalized key and needs no twin.
    column: 'email',
    kind: 'text',
    path: 'email',
    lowerPath: 'email',
    presence: 'always',
  },
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    lowerPath: 'displayNameLower',
    tokensPath: 'displayNameTokens',
  },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    presence: 'always',
  },
]

/** Headers for member fields that are filterable without being columns. */
export const SITE_MEMBER_LIST_FILTER_HEADERS: Readonly<Record<string, string>> =
  {
    displayName: 'Name',
    createdAt: 'Joined',
  }
