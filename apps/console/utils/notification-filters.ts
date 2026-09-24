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

/** Firestore caps `in` at thirty values. */
const IN_LIMIT = 30

/** One `where` the feed's query applies: a path, an operator, a value. */
export type NotificationWhere = [path: string, op: '==' | 'in', value: unknown]

/**
 * The feed's `where`s for the clauses in force — every clause, since the
 * indexes serve both fields together. A clause on a field the feed does not
 * declare, or with no value, is ignored rather than guessed at.
 */
export function notificationFilterWheres(
  clauses: readonly ListFilterClause[],
): NotificationWhere[] {
  const wheres: NotificationWhere[] = []
  for (const clause of clauses) {
    if (clause.field === 'type') {
      const values = clause.value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
      if (!values.length) continue
      if (clause.op === 'isAnyOf') {
        wheres.push(['type', 'in', values.slice(0, IN_LIMIT)])
      } else if (clause.op === 'equals') {
        wheres.push(['type', '==', values[0]])
      }
    } else if (clause.field === 'readAt' && clause.op === 'equals') {
      if (clause.value === 'true' || clause.value === 'false') {
        wheres.push(['read', '==', clause.value === 'true'])
      }
    }
  }
  return wheres
}
