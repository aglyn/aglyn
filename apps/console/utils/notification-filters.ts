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

import { NOTIFICATION_TYPE_LABELS } from '@aglyn/aglyn/app-utils/notifications'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListFilterClause,
  ListFilterOption,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  LIST_QUERY_DISJUNCTIONS,
  type ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * What the notifications feed filters by, and how the feed's query serves it
 * (AGL-3321).
 *
 * Both are EQUALITIES beneath the feed's `createdAt` DESC cursor, which is
 * what three composite indexes in `cloud/firebase-firestore.indexes.json`
 * answer: `type, createdAt`, `read, createdAt`, and `type, read, createdAt`
 * for the two together. So both clauses stand at once and every page of the
 * cursor is a page of the answer; nothing is matched over a loaded window.
 *
 * The Status column's filter reads `read`, the boolean every emitter stamps
 * (see `AglynNotification.read`), not the `readAt` the column draws: a
 * timestamp's "is set" is an inequality, and an inequality would have to
 * lead the sort.
 *
 * No quick search. A notification's title and body are free text no index
 * holds, so a search could only narrow the page on screen.
 */
export const NOTIFICATION_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'type', kind: 'exact', path: 'type', operators: ['equals', 'isAnyOf'] },
  { column: 'readAt', kind: 'exact', path: 'read', operators: ['equals'] },
]

export const NOTIFICATION_FILTER_HEADERS: Readonly<Record<string, string>> = {
  type: 'Type',
  readAt: 'Status',
}

export const NOTIFICATION_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  type: Object.entries(NOTIFICATION_TYPE_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
  readAt: [
    { value: 'false', label: 'New' },
    { value: 'true', label: 'Read' },
  ],
}

/** One `where` the feed's query applies: a path, an operator, a value. */
export type NotificationWhere = [path: string, op: '==' | 'in', value: unknown]

/** A clause the feed's query could not take, and why. */
export interface NotificationFilterRefusal {
  clause: ListFilterClause
  reason: string
}

export interface NotificationFilterPlan {
  wheres: NotificationWhere[]
  /** Shown above the feed by `ListQueryNotices`, beside the clause's chip. */
  refused: NotificationFilterRefusal[]
  /** The feed's one order: the header asked for, or newest first. */
  orderBy: ListQuerySort
  /** Said about the order, when the one asked could not be served. */
  notices: string[]
}

/*
 * EVERY HEADER SORTS ON THE FEED'S QUERY (AGL-3680).
 *
 * `users/{uid}/notifications` is one person's subcollection: the uid is the
 * PATH, not a predicate, so an order with no filter on is a single-field
 * index Firestore keeps anyway. Every emitter stamps `title`, `type` and
 * `read: false` on create (`notifyUsers`, `AglynNotification`), and
 * `tools/scripts/backfill-notification-read.mjs` stamped `read` on the
 * backlog, so an `orderBy` on any of them drops nothing.
 *
 * Newest first is the default and holds under every filter (its composites
 * are above). The others are `alone`: paired with Type or Status they would
 * cost a composite per (filter × order), so with a filter on the feed falls
 * back to newest first and says so — the contract `planListQuery` keeps.
 * Workspace is resolved per row from the reader's memberships and the host
 * index, so it sorts the page.
 */
export const NOTIFICATION_DEFAULT_SORT: ListQuerySort = {
  path: 'createdAt',
  direction: 'desc',
  column: 'createdAt',
  label: 'When',
}

export const NOTIFICATION_SORTS: readonly ListQuerySort[] = [
  NOTIFICATION_DEFAULT_SORT,
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'When, oldest first', alone: true },
  { path: 'title', direction: 'asc', column: 'title', label: 'Notification', alone: true },
  { path: 'title', direction: 'desc', column: 'title', label: 'Notification', alone: true },
  { path: 'type', direction: 'asc', column: 'type', label: 'Type', alone: true },
  { path: 'type', direction: 'desc', column: 'type', label: 'Type', alone: true },
  // `read` false first: New, then Read.
  { path: 'read', direction: 'asc', column: 'readAt', label: 'Status', alone: true },
  { path: 'read', direction: 'desc', column: 'readAt', label: 'Status', alone: true },
]

/**
 * The feed's `where`s for the clauses in force — every clause, since the
 * indexes serve both fields together. A clause on a field the feed does not
 * declare, or with no value, is ignored rather than guessed at.
 *
 * Type "is any of" is an `in`, which Firestore caps at thirty values. A pick
 * past that is refused whole, with the reason `planListQuery` gives, so
 * the feed never reads as the answer for types it did not ask about.
 */
export function planNotificationFilters(
  clauses: readonly ListFilterClause[],
  sort: ListQuerySort | null = null,
): NotificationFilterPlan {
  const wheres: NotificationWhere[] = []
  const refused: NotificationFilterRefusal[] = []
  for (const clause of clauses) {
    if (clause.field === 'type') {
      const values = clause.value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (!values.length) continue
      if (clause.op === 'isAnyOf') {
        if (values.length > LIST_QUERY_DISJUNCTIONS) {
          refused.push({ clause, reason: `at most ${LIST_QUERY_DISJUNCTIONS} values` })
          continue
        }
        wheres.push(['type', 'in', values])
      } else if (clause.op === 'equals') {
        wheres.push(['type', '==', values[0]])
      }
    } else if (clause.field === 'readAt' && clause.op === 'equals') {
      if (clause.value === 'true' || clause.value === 'false') {
        wheres.push(['read', '==', clause.value === 'true'])
      }
    }
  }
  const asked =
    (sort &&
      NOTIFICATION_SORTS.find(
        (entry) => entry.path === sort.path && entry.direction === sort.direction,
      )) ||
    NOTIFICATION_DEFAULT_SORT
  if (asked.alone && wheres.length) {
    return {
      wheres,
      refused,
      orderBy: NOTIFICATION_DEFAULT_SORT,
      notices: [
        `Sorted by ${NOTIFICATION_DEFAULT_SORT.label}: ${asked.label} sorts only with no filter on.`,
      ],
    }
  }
  return { wheres, refused, orderBy: asked, notices: [] }
}
