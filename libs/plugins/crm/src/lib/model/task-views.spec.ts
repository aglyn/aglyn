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

import { crmRoutes } from './crm-routes'
import {
  crmTaskViewPlan,
  describeTaskDue,
  dueAtToLocalInput,
  localInputToDueAt,
  orderTaskRows,
  snoozeDueAt,
  startOfLocalDay,
  startOfNextLocalDay,
  taskRecordLink,
} from './task-views'

/**
 * The tasks section's views are windows over `dueAtMs` computed at read time
 * (AGL-2599): nothing stamps "overdue" on a document, so the meaning of each
 * view lives entirely in the plan. These pin the boundaries — where one view
 * ends is exactly where the next begins — because a gap or an overlap
 * between "today" and "upcoming" is a task that is listed twice or never.
 *
 * Every timestamp is built from local calendar parts, never from a literal
 * epoch, so the expectations hold in whatever zone the runner is in.
 */

// A Saturday morning at 10:30, local time.
const NOW = new Date(2026, 8, 5, 10, 30).getTime()
const TODAY = new Date(2026, 8, 5).getTime()
const TOMORROW = new Date(2026, 8, 6).getTime()

describe('crmTaskViewPlan', () => {
  it('cuts the day at local midnight, from the calendar', () => {
    expect(startOfLocalDay(NOW)).toBe(TODAY)
    expect(startOfNextLocalDay(NOW)).toBe(TOMORROW)
    // The next day across a month end is the first of the next month, not
    // "today + 24h" — a clock-change day is 23 or 25 hours long.
    expect(startOfNextLocalDay(new Date(2026, 8, 30, 23).getTime())).toBe(
      new Date(2026, 9, 1).getTime(),
    )
  })

  it('makes overdue, today and upcoming three adjacent windows', () => {
    const overdue = crmTaskViewPlan('overdue', { nowMs: NOW, uid: 'u1' })
    const today = crmTaskViewPlan('today', { nowMs: NOW, uid: 'u1' })
    const upcoming = crmTaskViewPlan('upcoming', { nowMs: NOW, uid: 'u1' })
    expect(overdue).toEqual({ status: 'open', dueBefore: TODAY, direction: 'asc' })
    expect(today).toEqual({
      status: 'open',
      dueFrom: TODAY,
      dueBefore: TOMORROW,
      direction: 'asc',
    })
    expect(upcoming).toEqual({ status: 'open', dueFrom: TOMORROW, direction: 'asc' })
    // Inclusive start, exclusive end: the boundaries meet and do not overlap.
    expect(overdue.dueBefore).toBe(today.dueFrom)
    expect(today.dueBefore).toBe(upcoming.dueFrom)
  })

  it('narrows "my tasks" to the reader, and to nobody when the reader is unknown', () => {
    expect(crmTaskViewPlan('mine', { nowMs: NOW, uid: 'u1' })).toEqual({
      status: 'open',
      assigneeUid: 'u1',
      direction: 'asc',
    })
    // An empty assignee is the hook's signal to open no listener at all.
    expect(crmTaskViewPlan('mine', { nowMs: NOW, uid: null }).assigneeUid).toBe('')
  })

  it('lists every open task undated, and done tasks most recently due first', () => {
    expect(crmTaskViewPlan('open', { nowMs: NOW, uid: 'u1' })).toEqual({
      status: 'open',
      direction: 'asc',
    })
    expect(crmTaskViewPlan('done', { nowMs: NOW, uid: 'u1' })).toEqual({
      status: 'done',
      direction: 'desc',
    })
  })
})

describe('orderTaskRows', () => {
  it('moves undated rows to the end without disturbing the dated order', () => {
    const rows = [
      { id: 'a', dueAtMs: null },
      { id: 'b', dueAtMs: 2 },
      { id: 'c', dueAtMs: undefined },
      { id: 'd', dueAtMs: 1 },
      { id: 'e', dueAtMs: 3 },
    ]
    // Firestore already sorted the dated ones; this only relocates the nulls,
    // so the dated relative order (b, d, e) is kept exactly as given.
    expect(orderTaskRows(rows).map((row) => row.id)).toEqual(['b', 'd', 'e', 'a', 'c'])
  })
})

describe('describeTaskDue', () => {
  it('names the state before the time, and says when there is no date', () => {
    expect(describeTaskDue({ status: 'open', dueAtMs: null }, NOW)).toEqual({
      state: 'none',
      label: 'No due date',
    })
    const today = describeTaskDue(
      { status: 'open', dueAtMs: new Date(2026, 8, 5, 15, 30).getTime() },
      NOW,
      'en-US',
    )
    expect(today.state).toBe('today')
    expect(today.label).toBe('Today, 3:30 PM')
    const overdue = describeTaskDue(
      { status: 'open', dueAtMs: new Date(2026, 8, 1, 9).getTime() },
      NOW,
      'en-US',
    )
    expect(overdue.state).toBe('overdue')
    expect(overdue.label).toMatch(/^Overdue · Tue, Sep 1, 9:00 AM$/)
    const upcoming = describeTaskDue(
      { status: 'open', dueAtMs: new Date(2026, 8, 8, 9).getTime() },
      NOW,
      'en-US',
    )
    expect(upcoming.state).toBe('upcoming')
    expect(upcoming.label).toBe('Tue, Sep 8, 9:00 AM')
    // Done wins over the clock: a task finished late is not overdue.
    expect(
      describeTaskDue(
        { status: 'done', dueAtMs: new Date(2026, 8, 1, 9).getTime() },
        NOW,
      ).state,
    ).toBe('done')
  })
})

describe('the datetime-local round trip', () => {
  it('renders local wall-clock time and reads it back to the same instant', () => {
    const ms = new Date(2026, 8, 5, 9, 5).getTime()
    expect(dueAtToLocalInput(ms)).toBe('2026-09-05T09:05')
    expect(localInputToDueAt('2026-09-05T09:05')).toBe(ms)
  })

  it('treats an empty or unreadable input as no due date', () => {
    expect(dueAtToLocalInput(null)).toBe('')
    expect(dueAtToLocalInput(undefined)).toBe('')
    expect(localInputToDueAt('')).toBeNull()
    expect(localInputToDueAt('   ')).toBeNull()
    expect(localInputToDueAt('not a date')).toBeNull()
  })
})

describe('taskRecordLink', () => {
  const routes = crmRoutes('/acme/hosts/coffee/crm')

  it('prefers the contact, then the deal, then the company', () => {
    expect(
      taskRecordLink({ contactId: 'c1', dealId: 'd1', companyId: 'k1' }, routes),
    ).toEqual({ kind: 'contact', id: 'c1', href: '/acme/hosts/coffee/crm/contacts/c1' })
    expect(taskRecordLink({ dealId: 'd1', companyId: 'k1' }, routes)).toEqual({
      kind: 'deal',
      id: 'd1',
      href: '/acme/hosts/coffee/crm/deals/d1',
    })
    expect(taskRecordLink({ companyId: 'k1' }, routes)).toEqual({
      kind: 'company',
      id: 'k1',
      href: '/acme/hosts/coffee/crm/companies/k1',
    })
  })

  it('is null for a task about nobody in particular', () => {
    expect(taskRecordLink({}, routes)).toBeNull()
    expect(taskRecordLink({ contactId: '', dealId: undefined }, routes)).toBeNull()
  })
})

describe('snoozeDueAt (AGL-2619)', () => {
  // A Wednesday evening, well past any working hour, from local parts.
  const now = new Date(2026, 8, 9, 18, 45).getTime()

  it('moves an overdue task to tomorrow and keeps its time of day', () => {
    const due = new Date(2026, 8, 1, 14, 30).getTime()
    expect(snoozeDueAt('tomorrow', due, now)).toBe(new Date(2026, 8, 10, 14, 30).getTime())
  })

  it('counts a week from today, not from the old due date', () => {
    const due = new Date(2026, 7, 20, 11, 0).getTime()
    expect(snoozeDueAt('nextWeek', due, now)).toBe(new Date(2026, 8, 16, 11, 0).getTime())
  })

  it('lands an undated task at nine in the morning', () => {
    expect(snoozeDueAt('tomorrow', null, now)).toBe(new Date(2026, 8, 10, 9, 0).getTime())
    expect(snoozeDueAt('nextWeek', undefined, now)).toBe(new Date(2026, 8, 16, 9, 0).getTime())
  })

  it('crosses a month boundary by the calendar', () => {
    const endOfMonth = new Date(2026, 8, 30, 10, 0).getTime()
    expect(snoozeDueAt('tomorrow', null, endOfMonth)).toBe(new Date(2026, 9, 1, 9, 0).getTime())
  })
})
