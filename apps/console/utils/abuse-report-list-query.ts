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
  ABUSE_REPORT_CATEGORIES,
  ABUSE_REPORT_STATUSES,
} from '@aglyn/aglyn/app-utils/abuse-report'
import {
  COUNTER_NOTICE_MAX_BUSINESS_DAYS,
  type CounterNoticeStatus,
} from '@aglyn/aglyn/app-utils/dmca-counter-notice'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * THE ABUSE QUEUE'S TWO LISTS, EACH ON ITS QUERY (AGL-3321).
 *
 * Read by BOTH `/admin/abuse-reports` and `/api/admin/abuse-reports`. The
 * route plans every clause onto one Firestore query through `planListQuery`
 * and pages it by a cursor in the list's own order; the page never narrows
 * the rows it is handed.
 *
 *   list              reads                  order                filters
 *   reports           `abuseReports`         updatedAt DESC       Status, Category
 *   counter-notices   `dmcaCounterNotices`   receivedAtMs ASC     —
 *
 * Status and Category are equalities, each merged with the order through
 * its own `(field, updatedAt DESC)` composite (index merging), so any
 * combination of the two is one query. Pinned against the index file by
 * `specs/abuse-report-list-query.spec.ts`.
 *
 * ## No search box
 *
 * A report's text is attacker-supplied — a URL and free prose from a public
 * form — and the queue is triaged by status and category, not looked up by
 * word. No writer stamps a search token, so the list offers none rather than
 * a box that matched the page on screen.
 *
 * ## The counts are served, not counted off a page
 *
 * The urgent backlog, the counter-notices awaiting forward and the overdue
 * restorations are each their own query (`view=summary`), so they describe
 * the whole queue whatever page the reader is on. The overdue count reads
 * only the awaiting counter-notices old enough to be overdue
 * (`counterNoticeOverdueBefore`) and checks each against its clock.
 */

/** The reports queue, newest update first. */
export const ABUSE_REPORT_LIST_SORT: ListQuerySort = {
  path: 'updatedAt',
  direction: 'desc',
}

/** Status and Category: what the reports queue can be narrowed by. */
export const ABUSE_REPORT_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'status',
    kind: 'exact',
    path: 'status',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: 'category',
    kind: 'exact',
    path: 'category',
    presence: 'always',
    operators: ['equals', 'isAnyOf'],
  },
]

export const ABUSE_REPORT_LIST_QUERY: ListQueryDeclaration = {
  fields: ABUSE_REPORT_FILTER_FIELDS,
  sorts: [ABUSE_REPORT_LIST_SORT],
}

export const ABUSE_REPORT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  category: 'Category',
}

export const ABUSE_REPORT_FILTER_OPTIONS: Readonly<
  Record<string, readonly ListFilterOption[]>
> = {
  status: ABUSE_REPORT_STATUSES.map((status) => ({ value: status, label: status })),
  category: ABUSE_REPORT_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.label,
  })),
}

/** The categories whose severity is `urgent` — the backlog the page leads with. */
export const URGENT_ABUSE_CATEGORIES: readonly string[] = ABUSE_REPORT_CATEGORIES.filter(
  (category) => category.severity === 'urgent',
).map((category) => category.id)

/** The counter-notice queue, oldest receipt first: the closest deadline leads. */
export const COUNTER_NOTICE_LIST_SORT: ListQuerySort = {
  path: 'receivedAtMs',
  direction: 'asc',
}

export const COUNTER_NOTICE_LIST_QUERY: ListQueryDeclaration = {
  fields: [],
  sorts: [COUNTER_NOTICE_LIST_SORT],
}

/** The statuses still heading for a put-back (`counterNoticeAwaitsRestoration`). */
export const COUNTER_NOTICE_AWAITING_STATUSES: readonly CounterNoticeStatus[] = [
  'received',
  'forwarded',
]

const DAY_MS = 86_400_000

/**
 * The latest receipt that could be overdue at `nowMs`.
 *
 * The statutory ceiling is `COUNTER_NOTICE_MAX_BUSINESS_DAYS` business days
 * after receipt, and every business day is at least one calendar day, so a
 * counter-notice received after this instant cannot be past its ceiling yet.
 * The overdue count reads the awaiting counter-notices received at or before
 * it — `(status, receivedAtMs)` — and checks each against its own clock.
 */
export function counterNoticeOverdueBefore(nowMs: number): number {
  return nowMs - COUNTER_NOTICE_MAX_BUSINESS_DAYS * DAY_MS
}

/** The most overdue candidates one summary reads before saying "at least". */
export const COUNTER_NOTICE_OVERDUE_READ_MAX = 500
