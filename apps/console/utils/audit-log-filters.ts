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
  inMemoryListField,
  type ListFilterClause,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * What the staff audit log filters by. Imported by the page that queries it
 * and by the spec that pins the composite indexes each servable combination
 * needs, so the menu, the query and the index file cannot drift apart. (The
 * organization's activity logs plan every clause onto their queries now, from
 * `./activity-list-query`, AGL-3321.)
 *
 * The log is ordered newest first and paged by a cursor into that order,
 * so a clause is added beneath the pinned sort and never reorders it: an
 * equality (or `in`), or a range over the sort field itself. A date `is` is
 * not offered — `after` and `before` reach the same rows, and a whole-day
 * bound pair has nothing to add under a pinned sort.
 */

/** The date operators a feed pinned to its own date sort serves. */
const DATE_RANGE_OPERATORS = ['after', 'onOrAfter', 'before', 'onOrBefore'] as const

/** A composite index a query shape needs, as the index file spells it. */
export interface AuditIndexShape {
  collectionGroup: string
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP'
  /** `fieldPath:ORDER`, in index order. */
  fields: string[]
}

/*==========================================
 * THE STAFF AUDIT LOG (`adminAudit`)
 *
 * Ordered by `at` DESC. Three fields are equalities a composite serves, one
 * at a time — `actorUid` and `target` on indexes the staff user page already
 * needed, `action` on its own — and the date is a range over the sort field.
 *
 * The action GROUP and the scope are matched as the log is read: a group is
 * a namespace prefix or a plugin's list of codes, which no equality can ask
 * for under the date sort, and `scope` has no composite (the project is at
 * its index ceiling). The search is matched the same way, over fields no
 * writer stores lower-cased.
 *=========================================*/

export const ADMIN_AUDIT_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'action', kind: 'exact', path: 'action', operators: ['equals', 'isAnyOf'] },
  { column: 'actorUid', kind: 'exact', path: 'actorUid', operators: ['equals'] },
  { column: 'target', kind: 'exact', path: 'target', operators: ['equals'] },
  { column: 'at', kind: 'date', path: 'at', operators: DATE_RANGE_OPERATORS },
  { ...inMemoryListField('actionGroup', 'select'), windowOnly: true },
  { ...inMemoryListField('scope', 'select'), windowOnly: true },
]

/** The equalities the query serves, ONE at a time — each has its own composite. */
export const ADMIN_AUDIT_SINGLE_FIELDS: readonly string[] = ['action', 'actorUid', 'target']

export const ADMIN_AUDIT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  action: 'Action',
  actorUid: 'Who (uid)',
  target: 'Target',
  at: 'When',
  actionGroup: 'Action group',
  scope: 'Scope',
}

export const ADMIN_AUDIT_SELECT_FIELDS: readonly string[] = ['actionGroup', 'scope']

export const ADMIN_AUDIT_SEARCH_PATHS: readonly string[] = [
  'actorUid',
  'actorEmail',
  'action',
  'scope',
  'target',
  'reason',
  'note',
]

/** How many entries one page of the staff audit log may read while matching. */
export const ADMIN_AUDIT_SCAN = 500

/** A clause the grid keeps beside the served equality: the date, and the matched fields. */
export const adminAuditClauseStandsAlongside = (clause: ListFilterClause): boolean =>
  !ADMIN_AUDIT_SINGLE_FIELDS.includes(clause.field)

/**
 * Which clauses go onto the query and which are matched as it is read. At
 * most one equality is served; the grid keeps it that way (`single`), and a
 * second one arriving some other way is matched rather than sent to a query
 * no index serves.
 */
export function adminAuditPlan(clauses: readonly ListFilterClause[]): {
  served: ListFilterClause[]
  matched: ListFilterClause[]
} {
  const served: ListFilterClause[] = []
  const matched: ListFilterClause[] = []
  let equality = false
  for (const clause of clauses) {
    const field = ADMIN_AUDIT_FILTER_FIELDS.find((entry) => entry.column === clause.field)
    if (!field) continue
    if (field.windowOnly) matched.push(clause)
    else if (field.kind === 'date') served.push(clause)
    else if (!equality) {
      equality = true
      served.push(clause)
    } else matched.push(clause)
  }
  return { served, matched }
}

/** The composite a set of served staff-audit clauses needs, or `null`. */
export function adminAuditIndexFor(
  served: readonly ListFilterClause[],
): AuditIndexShape | null {
  const equality = served.find((clause) => ADMIN_AUDIT_SINGLE_FIELDS.includes(clause.field))
  return equality
    ? {
        collectionGroup: 'adminAudit',
        queryScope: 'COLLECTION',
        fields: [`${equality.field}:ASCENDING`, 'at:DESCENDING'],
      }
    : null
}
