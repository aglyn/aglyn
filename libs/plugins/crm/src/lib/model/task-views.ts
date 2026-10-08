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
  type CrmTask,
  type CrmTaskKind,
  type CrmTaskPriority,
  type TaskDueState,
  taskDueState,
} from '@aglyn/aglyn'
import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQuerySort,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'
import { CRM_LIST_SEARCH, crmSelectField } from './crm-list-query'
import type { CrmRoutes } from './crm-routes'

/**
 * The tasks section's views and the query each one is (AGL-2599).
 *
 * Pure: what a view MEANS is written here once, as a plan the hook turns into
 * Firestore constraints and a spec can read back without Firestore. "Overdue"
 * and "today" are not stored on the task — nothing runs at midnight to stamp
 * them — so each view is a window over `dueAtMs` computed at read time from
 * the reader's own clock, and the same day boundaries {@link taskDueState}
 * paints a row with.
 */

export type CrmTaskView =
  | 'mine'
  | 'overdue'
  | 'today'
  | 'upcoming'
  | 'open'
  | 'done'

export const CRM_TASK_VIEWS: ReadonlyArray<{ id: CrmTaskView; label: string }> =
  [
    { id: 'mine', label: 'My tasks' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'today', label: 'Today' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'open', label: 'All open' },
    { id: 'done', label: 'Done' },
  ]

export const CRM_TASK_KINDS: readonly CrmTaskKind[] = [
  'call',
  'email',
  'meeting',
  'todo',
]

export const CRM_TASK_KIND_LABELS: Record<CrmTaskKind, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  todo: 'To-do',
}

export const CRM_TASK_PRIORITIES: readonly CrmTaskPriority[] = [
  'low',
  'normal',
  'high',
]

export const CRM_TASK_PRIORITY_LABELS: Record<CrmTaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}


/** Midnight at the START of the local calendar day `nowMs` falls in. */
export function startOfLocalDay(nowMs: number): number {
  const date = new Date(nowMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Midnight at the start of the NEXT local day — built from the calendar
 * rather than by adding 24 hours, because a day that a clock change falls in
 * is 23 or 25 hours long and a task due at 00:30 on that morning belongs to
 * it either way.
 */
export function startOfNextLocalDay(nowMs: number): number {
  const date = new Date(nowMs)
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime()
}

/**
 * One view as constraints, in the vocabulary of the `crmTasks` indexes.
 *
 * `assigneeUid` narrows to the reader and rides the
 * `(visibleTo, assigneeUid, status, dueAtMs)` index; every other view rides
 * `(visibleTo, status, dueAtMs)`. `dueFrom` is inclusive and `dueBefore`
 * exclusive so that two adjacent windows share a boundary and no task falls
 * between "today" and "upcoming". A task with no due date has `dueAtMs:
 * null`, which a range excludes and a bare order sorts first, so it appears
 * in "My tasks" and "All open" and in none of the dated views.
 */
export interface CrmTaskViewPlan {
  status: 'open' | 'done'
  assigneeUid?: string
  dueFrom?: number
  dueBefore?: number
  direction: 'asc' | 'desc'
}

export function crmTaskViewPlan(
  view: CrmTaskView,
  options: { nowMs: number; uid: string | null | undefined },
): CrmTaskViewPlan {
  const { nowMs, uid } = options
  const today = startOfLocalDay(nowMs)
  const tomorrow = startOfNextLocalDay(nowMs)
  switch (view) {
    case 'mine':
      return { status: 'open', assigneeUid: uid ?? '', direction: 'asc' }
    case 'overdue':
      return { status: 'open', dueBefore: today, direction: 'asc' }
    case 'today':
      return { status: 'open', dueFrom: today, dueBefore: tomorrow, direction: 'asc' }
    case 'upcoming':
      return { status: 'open', dueFrom: tomorrow, direction: 'asc' }
    case 'open':
      return { status: 'open', direction: 'asc' }
    case 'done':
      // Most recently due first: what was finished lately is what a reader
      // scrolls the Done view for, and the oldest completed task is the one
      // nobody comes back to.
      return { status: 'done', direction: 'desc' }
  }
}

/*==========================================
 * THE TASKS LIST'S QUERY (AGL-3321).
 *
 * The view is the query's base — its status, the reader as assignee for
 * "My tasks", and the `dueAtMs` window for Overdue, Today and Upcoming —
 * and Kind, Priority, Assignee and the search word are predicates on the
 * same query, paged by it. Every equality rides one `(field, dueAtMs)`
 * composite per direction: ascending for the working views, descending for
 * Done.
 *=========================================*/

/**
 * The orders the list takes: soonest first, and Done's most recently due
 * first — the Due header either way — then each header the query can order
 * by (AGL-3680): the title (`titleLower`) and the priority by its rank
 * (`priorityRank`), each stored on every task. Each
 * is `alone`: served with no filter or search on beyond the view, beside the
 * view's base by one `(status, field)`, `(assigneeUid, field)` and
 * `(visibleTo, field)` composite per direction — and under a dated view
 * (Overdue, Today, Upcoming), whose window orders the list by Due, not at
 * all, which the list says. Type and Status (picklists, in the org's
 * order), Assignee and For sort the page.
 */
export const TASK_LIST_SORTS: readonly ListQuerySort[] = [
  { path: 'dueAtMs', direction: 'asc', column: 'dueAtMs', label: 'Due' },
  { path: 'dueAtMs', direction: 'desc', column: 'dueAtMs', label: 'Due' },
  { path: 'titleLower', direction: 'asc', column: 'title', label: 'Task', alone: true },
  { path: 'titleLower', direction: 'desc', column: 'title', label: 'Task', alone: true },
  { path: 'priorityRank', direction: 'asc', column: 'priority', label: 'Priority', alone: true },
  { path: 'priorityRank', direction: 'desc', column: 'priority', label: 'Priority', alone: true },
]

/** The view's own order: the Due header, the way the view reads it. */
export function crmTaskViewSort(plan: Pick<CrmTaskViewPlan, 'direction'>): ListQuerySort {
  return TASK_LIST_SORTS.find(
    (sort) => sort.path === 'dueAtMs' && sort.direction === plan.direction,
  ) as ListQuerySort
}

/** What the Filters panel may name on a task, besides the view. */
export const TASK_LIST_QUERY_FIELDS: readonly ListFilterField[] = [
  crmSelectField('kind'),
  crmSelectField('priority'),
  crmSelectField('assigneeUid'),
]

export const TASK_LIST_DECLARATION: ListQueryDeclaration = {
  fields: TASK_LIST_QUERY_FIELDS,
  sorts: TASK_LIST_SORTS,
  search: CRM_LIST_SEARCH,
}

/** The view's own predicates, which the plan takes as its base beside the scope. */
export function crmTaskViewBase(plan: CrmTaskViewPlan): ListQueryFilter[] {
  return [
    { path: 'status', op: '==', value: plan.status },
    ...(plan.assigneeUid ? [{ path: 'assigneeUid', op: '==' as const, value: plan.assigneeUid }] : []),
    ...(plan.dueFrom !== undefined ? [{ path: 'dueAtMs', op: '>=' as const, value: plan.dueFrom }] : []),
    ...(plan.dueBefore !== undefined ? [{ path: 'dueAtMs', op: '<' as const, value: plan.dueBefore }] : []),
  ]
}

/** The base's shape for `listQueryIndexes`: the view's two equalities. */
export const TASK_LIST_VIEW_BASE_INDEX = [{ path: 'status' }, { path: 'assigneeUid' }] as const

/**
 * Rows in the order a view should paint them.
 *
 * Firestore sorts `null` before every number, so an ascending order by
 * `dueAtMs` puts the undated tasks at the TOP of "All open" — above the one
 * due in an hour. The query stays as it is (the index decides that); the
 * undated rows are moved to the end here, in a stable pass that leaves the
 * dated order the server chose alone.
 */
export function orderTaskRows<T extends Pick<CrmTask, 'dueAtMs'>>(
  rows: readonly T[],
): T[] {
  const dated: T[] = []
  const undated: T[] = []
  for (const row of rows) {
    ;(typeof row.dueAtMs === 'number' ? dated : undated).push(row)
  }
  return [...dated, ...undated]
}

/** The MUI palette key a due date is painted with, by its state. */
export const TASK_DUE_COLORS: Record<TaskDueState, string> = {
  overdue: 'error.main',
  today: 'warning.main',
  upcoming: 'text.primary',
  none: 'text.secondary',
  done: 'text.secondary',
}

/**
 * The due date as a person reads it: "Overdue · Tue, Sep 1, 9:00 AM",
 * "Today, 3:30 PM", "No due date". The state word comes first because it is
 * the part a reader scans a column for; the timestamp is what they read once
 * a row has their attention.
 */
export function describeTaskDue(
  task: Pick<CrmTask, 'status' | 'dueAtMs'>,
  nowMs: number,
  locale?: string,
): { state: TaskDueState; label: string } {
  const state = taskDueState(task, nowMs)
  const dueAtMs = task.dueAtMs
  if (typeof dueAtMs !== 'number' || !Number.isFinite(dueAtMs)) {
    return { state, label: 'No due date' }
  }
  const due = new Date(dueAtMs)
  const time = due.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  })
  switch (state) {
    case 'today':
      return { state, label: `Today, ${time}` }
    case 'overdue':
      return {
        state,
        label: `Overdue · ${due.toLocaleDateString(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}, ${time}`,
      }
    default:
      return {
        state,
        label: `${due.toLocaleDateString(locale, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}, ${time}`,
      }
  }
}

/**
 * `datetime-local` ↔ epoch milliseconds, in the reader's own zone.
 *
 * The input's value is a wall-clock string with no zone; `new Date(string)`
 * reads such a string as LOCAL time, which is what a person typing "9:00"
 * into a due-date field means. Built by hand in the other direction because
 * `toISOString()` would render the UTC clock, and a task due at nine would
 * reopen in the drawer at whatever nine is in Greenwich.
 */
export function dueAtToLocalInput(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export function localInputToDueAt(value: string): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * The two snoozes a row and the drawer offer by name (AGL-2619), in the
 * order a person reaches for them; "Pick a date" is the third and takes a
 * date rather than an option.
 */
export type CrmTaskSnoozeOption = 'tomorrow' | 'nextWeek'

export const CRM_TASK_SNOOZE_OPTIONS: ReadonlyArray<{
  id: CrmTaskSnoozeOption
  label: string
}> = [
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'nextWeek', label: 'Next week' },
]

/** The hour a snoozed task lands on when it had no time of day of its own. */
export const CRM_TASK_SNOOZE_DEFAULT_HOUR = 9

/**
 * Where a snoozed task is due next.
 *
 * Counted from NOW, not from the old due date: a task a week overdue
 * snoozed to "tomorrow" is due tomorrow, which is what the word means to the
 * person pressing it, and not due six days ago. The time of day is kept —
 * a nine o'clock call stays a nine o'clock call — and a task that had no
 * time lands at {@link CRM_TASK_SNOOZE_DEFAULT_HOUR}, a working hour rather
 * than midnight. Built from the calendar for the reason
 * {@link startOfNextLocalDay} gives.
 */
export function snoozeDueAt(
  option: CrmTaskSnoozeOption,
  dueAtMs: number | null | undefined,
  nowMs: number,
): number {
  const had = typeof dueAtMs === 'number' && Number.isFinite(dueAtMs) ? new Date(dueAtMs) : null
  const hours = had ? had.getHours() : CRM_TASK_SNOOZE_DEFAULT_HOUR
  const minutes = had ? had.getMinutes() : 0
  const now = new Date(nowMs)
  const days = option === 'tomorrow' ? 1 : 7
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
    hours,
    minutes,
  ).getTime()
}

/**
 * The record a task hangs off, as a link into the hub — or `null` for a
 * task that is nobody's in particular.
 *
 * One record per task on screen even when the document names more than one:
 * the contact wins, then the deal, then the company, because that is the
 * order of how specific each is about WHO the work is for. All three ids
 * stay on the document for the record pages' own queries.
 */
export function taskRecordLink(
  task: Pick<CrmTask, 'contactId' | 'companyId' | 'dealId'>,
  routes: CrmRoutes,
): { kind: 'contact' | 'deal' | 'company'; id: string; href: string } | null {
  if (task.contactId) {
    return { kind: 'contact', id: task.contactId, href: routes.contact(task.contactId) }
  }
  if (task.dealId) {
    return { kind: 'deal', id: task.dealId, href: routes.deal(task.dealId) }
  }
  if (task.companyId) {
    return { kind: 'company', id: task.companyId, href: routes.company(task.companyId) }
  }
  return null
}
