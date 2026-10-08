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
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { ListPageSort } from '@aglyn/shared-util-tools/list-query/list-column-sort'

/**
 * What each console list can be filtered by (AGL-2501).
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

/*
 * Organizations are declared in `org-list-query.ts`, beside the query their
 * two staff lists plan from (AGL-3321).
 */

/*
 * The staff ACCOUNT list is not a Firestore query (AGL-2501).
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

/**
 * The staff roles a `staffRole` claim may hold — what the role picker offers,
 * what `/api/admin/users/manage` accepts, and the choices the list's Staff
 * role filter shows.
 */
export const STAFF_ROLES = ['support', 'billing', 'super'] as const

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
  {
    /*
     * Suspended: the Firebase Auth `disabled` flag, which is what suspends
     * an account — the staff Disable action and the user-scope lockdown
     * both set it, and it is what refuses the sign-in. This list is Auth,
     * not Firestore, so the clause is matched over the complete directory
     * read like every other clause here, and refused past the scan bound.
     */
    column: 'disabled',
    kind: 'boolean',
    path: 'disabled',
    // Picked from two named answers, so the panel's select sends `equals`;
    // `is` stays for a clause written while the panel offered a checkbox.
    operators: ['equals', 'is'],
  },
  { column: 'staff', kind: 'boolean', path: 'staff' },
  {
    /*
     * The claim as stored. A staff account with no role claim holds `null`
     * here although every enforcing check reads it as `support`, so
     * `is support` finds only the accounts granted the role explicitly.
     */
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

/*
 * THE ACCOUNT LIST'S HEADER SORTS (AGL-3680).
 *
 * Firebase Auth lists in its own order and cannot be asked for another, and
 * the `users/{uid}` profile documents are no mirror of it — not every account
 * has one, and none carries the sign-in times. So `/api/admin/users` sorts
 * the COMPLETE directory it already reads to answer a filter, when that read
 * fits its scan bound, and pages the sorted answer; past the bound it sorts
 * the page it walked and says so. Every column sorts. `path` is the
 * serialized row's field, and `USER_LIST_SORT_VALUES` reads it.
 */
export const USER_LIST_COLUMN_SORTS: readonly ListQuerySort[] = [
  { path: 'email', direction: 'asc', column: 'email', label: 'User' },
  { path: 'email', direction: 'desc', column: 'email', label: 'User' },
  { path: 'staffRole', direction: 'asc', column: 'staffRole', label: 'Status' },
  { path: 'staffRole', direction: 'desc', column: 'staffRole', label: 'Status' },
  { path: 'createdAt', direction: 'desc', column: 'createdAt', label: 'Created' },
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'Created' },
  { path: 'lastSignInAt', direction: 'desc', column: 'lastSignInAt', label: 'Last sign-in' },
  { path: 'lastSignInAt', direction: 'asc', column: 'lastSignInAt', label: 'Last sign-in' },
]

/** An account row as the route serializes it, for what the sorts read. */
interface UserSortRow {
  email: string | null
  displayName: string | null
  staff: boolean
  staffRole: string | null
  disabled: boolean
  createdAt: string | null
  lastSignInAt: string | null
}

const day = (value: string | null) => (value ? new Date(value) : null)

/** What each sort compares — what the column SHOWS, not the raw claim. */
export const USER_LIST_SORT_VALUES: Readonly<Record<string, ListPageSort<UserSortRow>>> = {
  email: (row) => row.email ?? row.displayName,
  // The Status column: a role-less staff account reads as `support`.
  staffRole: (row) =>
    row.staff ? (row.staffRole ?? 'support') : row.disabled ? 'disabled' : null,
  createdAt: (row) => day(row.createdAt),
  lastSignInAt: (row) => day(row.lastSignInAt),
}

/** How each account field reads — as a hidden column's header, and on a chip. */
export const USER_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  email: 'User',
  createdAt: 'Created',
  uid: 'UID',
  displayName: 'Display name',
  staff: 'Staff claim',
  staffRole: 'Staff role',
  tenantId: 'SSO pool (empty = none)',
  providers: 'Sign-in providers',
  lastSignInAt: 'Last sign-in',
  disabled: 'Suspended',
}

/** The choices of the account fields that are picked rather than typed. */
export const USER_LIST_FILTER_OPTIONS = {
  staffRole: STAFF_ROLES.map((role) => ({ value: role, label: role })),
  // The row's chip says "disabled", the Auth word, so the answer names both.
  disabled: [
    { value: 'true', label: 'Suspended (disabled)' },
    { value: 'false', label: 'Not suspended' },
  ],
}

/*
 * The activity logs (`hosts/{hostId}/activity`, `orgs/{orgId}/activity`, and
 * the person-centred feeds read across both as the `activity` group).
 *
 * EVERY CLAUSE AND THE SEARCH ARE ON THE QUERY (AGL-3321): these fields are
 * the Filters panel's half of `ACTIVITY_LIST_QUERY` in
 * `./activity-list-query`, which adds the one order and the search and is
 * what every activity feed plans its query from.
 *
 * One order, `createdAt` DESC — every feed's cursor is a position in it — so
 * the only range is over `createdAt` itself, and Action merges with it
 * through its own `(action, createdAt DESC)` composite.
 */
export const ACTIVITY_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    // Equality and `in` only — a text range would need `action` to lead the
    // order, which would unsort the feed.
    column: 'action',
    kind: 'exact',
    path: 'action',
    operators: ['equals', 'isAnyOf'],
  },
  {
    // The sort field, so every range over it keeps the feed's order: a whole
    // day (`is`) is two `where`s, not a cursor, and composes with the page's.
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    presence: 'always',
  },
]

/** How the activity fields read on a chip. */
export const ACTIVITY_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  action: 'Action',
  actorId: 'Who',
  scopeId: 'Where',
  createdAt: 'When',
}

/*
 * Site members (`hosts/{hostId}/siteMembers`) — the site's AUDIENCE.
 *
 * Not console users and not Firebase Auth accounts: a site member is a
 * Firestore document with its own scrypt hash and its own per-host session
 * cookie, which is why this list is a plain collection query while the staff
 * account list has to walk Auth pools.
 *
 * EVERY clause, and the quick search, is on the list's one query, newest
 * first (AGL-3321: `SITE_ACCOUNT_LIST_QUERY`). What each field offers is
 * what that query can serve beneath `createdAt DESC`, the list's only order:
 *
 *   email        `equals`, on the stored address (sign-up lower-cases it, so
 *                the value is its own key). No `starts with`: a prefix is a
 *                range on `email`, which would order the list by address — a
 *                second order, and a second set of composites for every
 *                field, for a list that never sorts by it.
 *   displayName  `contains` a word (`displayNameTokens`) and `equals`
 *                (`displayNameLower`). No `starts with` for the reason above,
 *                and no `is set`: `!= null` is a range too.
 *   createdAt    every day operator: a range on the field the list is
 *                already sorted by, which no extra index is needed for.
 *   suspended    `is`, an equality on the boolean every member carries
 *                (AGL-3321): sign-up stores `false`, the drawer's Suspend and
 *                Reactivate store `true` and `false`, and
 *                `tools/scripts/backfill-site-account-suspended.mjs` stamps
 *                `false` on the members that predate it — a query cannot find
 *                a document that LACKS a field, so `is Active` needs every
 *                active member to say so.
 *
 * The quick search reads `searchTokens`, a word of the name or of the
 * address (`memberSearchTokens`). The name fields and the search tokens are
 * stamped at both writers of a display name (sign-up and the member's own
 * account form), and `tools/scripts/backfill-site-member-search.mjs` stamps
 * the members written before those fields existed.
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
    operators: ['equals'],
  },
  {
    column: 'displayName',
    kind: 'text',
    path: 'displayName',
    lowerPath: 'displayNameLower',
    tokensPath: 'displayNameTokens',
    operators: ['contains', 'equals'],
  },
  {
    column: 'createdAt',
    kind: 'date',
    path: 'createdAt',
    presence: 'always',
  },
  { column: 'suspended', kind: 'boolean', path: 'suspended', operators: ['equals'] },
]

/** Headers for member fields that are filterable without being columns. */
export const SITE_MEMBER_LIST_FILTER_HEADERS: Readonly<Record<string, string>> =
  {
    email: 'Email',
    displayName: 'Name',
    createdAt: 'Joined',
    suspended: 'Status',
  }

/**
 * The Status filter's choices: the stored boolean, by the words the column
 * draws for it.
 */
export const SITE_MEMBER_LIST_FILTER_OPTIONS = {
  suspended: [
    { value: 'false', label: 'Active' },
    { value: 'true', label: 'Suspended' },
  ],
}

// Content entries' fields and headers live beside their list declaration in
// `@aglyn/aglyn/app-utils/entry-list-declaration` (AGL-3668), a pure module
// the native apps plan the same query from.
export {
  ENTRY_LIST_FILTER_FIELDS,
  ENTRY_LIST_FILTER_HEADERS,
} from '@aglyn/aglyn/app-utils/entry-list-declaration'

