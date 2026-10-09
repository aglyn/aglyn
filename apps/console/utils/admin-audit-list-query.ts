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

import {
  ADMIN_AUDIT_GROUP_FIELD,
  ADMIN_AUDIT_KIND_FIELD,
  ADMIN_AUDIT_SEARCH_FIELD,
  ADMIN_AUDIT_SITE_FIELD,
  ADMIN_AUDIT_TARGET_KIND_FIELD,
  type AdminAuditKind,
} from '@aglyn/aglyn/app-utils/admin-audit-index'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE STAFF AUDIT LOG'S QUERIES (AGL-3321).
 *
 * Two surfaces read `adminAudit`, and both plan every clause and the search
 * word onto their Firestore query through `planListQuery`; nothing is matched
 * over rows a read already fetched:
 *
 *   list                             reads                              base
 *   the Audit log page               adminAudit (browser, staff rules)  —
 *   an account's audit tables        adminAudit (staff route), four     one of the four
 *                                    queries merged by date             "about this
 *                                                                        account" halves,
 *                                                                        and `kind`
 *
 * Every filter reads a field the writer stored for it: `action`, `actorUid`,
 * `target` and `scope` as written, and `actionGroup`, `targetKind`,
 * `targetHostId`, `kind` and `searchTokens` stamped by `withAdminAuditIndex`
 * on every write (and by `tools/scripts/backfill-admin-audit-index.mjs` on
 * the rows written before).
 *
 * ## One order, merged indexes
 *
 * `at` DESC is the default order — the page's cursor is a position in
 * whichever order is on — and the one range is When, over `at` itself. Each equality and the search token
 * merge with it through their own `(field, at DESC)` composite
 * (`listQueryIndexes`), pinned by `specs/admin-audit-list-query.spec.ts`. A
 * second range (on anything but `at`) could not keep that order, so it is
 * not offered.
 */

/** The default order both surfaces keep, and page by. */
export const ADMIN_AUDIT_SORT: ListQuerySort = {
  path: 'at',
  direction: 'desc',
  column: 'at',
  label: 'When',
}

/*
 * ## The audit page's header sorts (AGL-3680)
 *
 * When newest first is the default and full. Every other header is `alone`:
 * served with no filter or search on, falling back to When newest first with
 * a notice — so on this top-level collection none costs a composite. Each
 * reads a field EVERY row stores: `action`, `actorUid` and `target` are named
 * by every writer, and `scope` is stamped null by `withAdminAuditIndex` when
 * a writer has none (and by `tools/scripts/backfill-staff-list-sort-fields.mjs`
 * on the rows before). Why is free text — a reason and a note — and does not
 * sort. An account's audit tables keep the one order: four merged queries
 * cannot share another without a composite per half.
 */
const auditAlone = (path: string, column: string, label: string): ListQuerySort[] => [
  { path, direction: 'asc', column, label, alone: true },
  { path, direction: 'desc', column, label, alone: true },
]

export const ADMIN_AUDIT_COLUMN_SORTS: readonly ListQuerySort[] = [
  ADMIN_AUDIT_SORT,
  { path: 'at', direction: 'asc', column: 'at', label: 'When', alone: true },
  ...auditAlone('action', 'action', 'Action'),
  ...auditAlone('scope', 'scope', 'Scope'),
  ...auditAlone('target', 'target', 'Target'),
  ...auditAlone('actorUid', 'actorUid', 'Who'),
]

/** The date operators a feed pinned to its own date order serves. */
const DATE_RANGE_OPERATORS = ['after', 'onOrAfter', 'before', 'onOrBefore'] as const

/** Every field the audit page's Filters panel offers. */
export const ADMIN_AUDIT_LIST_FIELDS: readonly ListFilterField[] = [
  { column: 'action', kind: 'exact', path: 'action', operators: ['equals', 'isAnyOf'] },
  {
    column: 'actionGroup',
    kind: 'exact',
    path: ADMIN_AUDIT_GROUP_FIELD,
    operators: ['equals', 'isAnyOf'],
  },
  { column: 'actorUid', kind: 'exact', path: 'actorUid', operators: ['equals'] },
  { column: 'target', kind: 'exact', path: 'target', operators: ['equals'] },
  {
    column: 'targetKind',
    kind: 'exact',
    path: ADMIN_AUDIT_TARGET_KIND_FIELD,
    operators: ['equals', 'isAnyOf'],
  },
  { column: 'targetHostId', kind: 'exact', path: ADMIN_AUDIT_SITE_FIELD, operators: ['equals'] },
  { column: 'scope', kind: 'exact', path: 'scope', operators: ['equals', 'isAnyOf'] },
  { column: 'at', kind: 'date', path: 'at', operators: DATE_RANGE_OPERATORS },
]

export const ADMIN_AUDIT_LIST_HEADERS: Readonly<Record<string, string>> = {
  action: 'Action',
  actionGroup: 'Action group',
  actorUid: 'Who (uid)',
  target: 'Target',
  targetKind: 'Target type',
  targetHostId: 'Site',
  scope: 'Scope',
  at: 'When',
}

/** Fields whose values are picked from a list rather than typed. */
export const ADMIN_AUDIT_LIST_SELECT_FIELDS: readonly string[] = [
  'actionGroup',
  'targetKind',
  'scope',
]

/** The Audit log page's query: every field above, and the search. */
export const ADMIN_AUDIT_LIST_QUERY: ListQueryDeclaration = {
  fields: ADMIN_AUDIT_LIST_FIELDS,
  sorts: ADMIN_AUDIT_COLUMN_SORTS,
  search: { tokensPath: ADMIN_AUDIT_SEARCH_FIELD },
}

/**
 * The scopes the writers store (`lockdown`, `mediaQuarantine`, the flag and
 * tenant routes), offered before any row has shown one. A scope the log has
 * shown that is not here is offered as well, so a new writer's scope is
 * pickable the moment it appears.
 */
export const ADMIN_AUDIT_KNOWN_SCOPES: readonly string[] = [
  'asset',
  'domain',
  'feature',
  'host',
  'org',
  'platform',
  'tenant',
  'user',
]

/**
 * The kinds of record the writers act on — the first segment of their
 * targets — offered the same way as the scopes.
 */
export const ADMIN_AUDIT_KNOWN_TARGET_KINDS: readonly string[] = [
  'disputes',
  'emailDeliveries',
  'emailSuppressions',
  'hosts',
  'lockdowns',
  'marketplaceListings',
  'marketplaceReports',
  'orgs',
  'platform',
  'remoteConfig',
  'stripe',
  'systemEmailTemplates',
  'users',
]

/*==========================================
 * ONE ACCOUNT'S AUDIT TABLES
 *
 * The staff account page shows what was done BY or TO the account, as two
 * tables — changes, and reads of its data — and each is four queries merged
 * by date, one per way an entry can be about the account (the route's
 * `userAuditHalves`). Each half's base is its own equality plus `kind`, and
 * the clauses and the search go onto every half: the same plan on each, so a
 * half contributes only rows that match.
 *
 * `target` is not offered here — one half IS a target equality — and neither
 * is Who: the Actor column is this account or the staff member who acted on
 * it, and the audit page's Who filter answers "everything one person did".
 *=========================================*/

/** Every field an account's audit tables offer. */
export const USER_AUDIT_LIST_FIELDS: readonly ListFilterField[] = ADMIN_AUDIT_LIST_FIELDS.filter(
  (field) => ['action', 'actionGroup', 'at'].includes(field.column),
).map((field) =>
  // Equality only: an `in` on every half would multiply the halves' own
  // disjunction (the address half is itself an `in`).
  field.kind === 'exact' ? { ...field, operators: ['equals'] } : field,
)

export const USER_AUDIT_LIST_HEADERS: Readonly<Record<string, string>> = {
  action: 'Action',
  actionGroup: 'Action group',
  at: 'When',
}

export const USER_AUDIT_LIST_SELECT_FIELDS: readonly string[] = ['actionGroup']

/** An account's audit tables' query. */
export const USER_AUDIT_LIST_QUERY: ListQueryDeclaration = {
  fields: USER_AUDIT_LIST_FIELDS,
  sorts: [ADMIN_AUDIT_SORT],
  search: { tokensPath: ADMIN_AUDIT_SEARCH_FIELD },
}

/** One entry as an account's audit tables read it (`/api/admin/users/audit`). */
export interface UserAuditRow {
  id: string
  actorUid: string | null
  action: string | null
  actionGroup: string | null
  target: string | null
  subjectUid: string | null
  reason: string | null
  note: string | null
  at: string | null
  repeatCount: number
  lastAt: string | null
  kind: AdminAuditKind
}

/** The base every half carries: which of the two tables it fills. */
export const userAuditKindBase = (kind: AdminAuditKind): ListQueryFilter => ({
  path: ADMIN_AUDIT_KIND_FIELD,
  op: '==',
  value: kind,
})

/**
 * The four halves' own predicates, as index shapes: an entry this account
 * performed, one that targets it, one whose subject it is, and one about an
 * address it holds.
 */
export const USER_AUDIT_HALF_PATHS: readonly string[] = [
  'actorUid',
  'target',
  'subjectUid',
  'subjectAddressKey',
]
