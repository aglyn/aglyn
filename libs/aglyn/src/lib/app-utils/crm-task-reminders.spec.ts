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
  composeCrmTaskReminderBody,
  composeCrmTaskReminderEmailText,
  composeCrmTaskReminderSubject,
  type CrmReminderTask,
  crmTaskReminderAfterEdit,
  crmTaskReminderDue,
  crmTaskReminderLink,
  crmTaskReminderPending,
} from './crm-task-reminders'

/**
 * The reminder rule (AGL-2659), pinned once for the three writers that
 * apply it — the task routes, the REST resource and the drawer — and the
 * words the runner says.
 */

const DUE = Date.parse('2026-09-10T15:00:00.000Z')
const LATER = Date.parse('2026-09-12T15:00:00.000Z')
const HOUR = 60 * 60 * 1000

describe('crmTaskReminderAfterEdit', () => {
  it('gives a caller what it said, on create and on edit', () => {
    expect(crmTaskReminderAfterEdit({ dueAtMs: DUE, remindAtMs: DUE - HOUR, previous: null })).toBe(
      DUE - HOUR,
    )
    expect(crmTaskReminderAfterEdit({ dueAtMs: DUE, remindAtMs: null, previous: null })).toBeNull()
    expect(
      crmTaskReminderAfterEdit({
        dueAtMs: LATER,
        remindAtMs: null,
        previous: { dueAtMs: DUE, remindAtMs: DUE },
      }),
    ).toBeNull()
  })

  it('defaults a new task to its due time, and to none when it has no due time', () => {
    expect(crmTaskReminderAfterEdit({ dueAtMs: DUE, previous: null })).toBe(DUE)
    expect(crmTaskReminderAfterEdit({ dueAtMs: null, previous: null })).toBeNull()
  })

  it('moves a reminder that sat on the old due time when the due time moves', () => {
    expect(
      crmTaskReminderAfterEdit({ dueAtMs: LATER, previous: { dueAtMs: DUE, remindAtMs: DUE } }),
    ).toBe(LATER)
    // Clearing the due date clears a reminder that followed it.
    expect(
      crmTaskReminderAfterEdit({ dueAtMs: null, previous: { dueAtMs: DUE, remindAtMs: DUE } }),
    ).toBeNull()
  })

  it('leaves a reminder somebody set to a time of their own where they put it', () => {
    expect(
      crmTaskReminderAfterEdit({
        dueAtMs: LATER,
        previous: { dueAtMs: DUE, remindAtMs: DUE - HOUR },
      }),
    ).toBe(DUE - HOUR)
    // And an unchanged due date moves nothing either way.
    expect(
      crmTaskReminderAfterEdit({ dueAtMs: DUE, previous: { dueAtMs: DUE, remindAtMs: DUE } }),
    ).toBe(DUE)
  })

  it('never invents a reminder for a task that has none', () => {
    expect(
      crmTaskReminderAfterEdit({ dueAtMs: LATER, previous: { dueAtMs: DUE, remindAtMs: null } }),
    ).toBeNull()
    // A task from before reminders existed reads as having none.
    expect(
      crmTaskReminderAfterEdit({
        dueAtMs: LATER,
        previous: { dueAtMs: DUE, remindAtMs: undefined as unknown as null },
      }),
    ).toBeNull()
  })
})

describe('what the runner owes', () => {
  it('is an open task with a reminder set, unhandled, whose time has come', () => {
    const owed = { status: 'open' as const, remindAtMs: DUE }
    expect(crmTaskReminderPending(owed)).toBe(true)
    expect(crmTaskReminderDue(owed, DUE)).toBe(true)
    expect(crmTaskReminderDue(owed, DUE - 1)).toBe(false)
    expect(crmTaskReminderDue({ ...owed, status: 'done' }, DUE + HOUR)).toBe(false)
    expect(crmTaskReminderDue({ ...owed, reminderSentAtMs: DUE + 1 }, DUE + HOUR)).toBe(false)
    expect(crmTaskReminderPending({ remindAtMs: null })).toBe(false)
    expect(crmTaskReminderPending({})).toBe(false)
  })
})

describe('the words', () => {
  const task: CrmReminderTask = {
    id: 't-1',
    title: 'Call Jane',
    kind: 'call',
    dueAtMs: DUE,
    remindAtMs: DUE,
    assigneeUid: 'ann',
    hostId: 'site-a',
    contactId: 'c-1',
  }

  it('opens the record the task is for, on its site or on the organization hub', () => {
    expect(crmTaskReminderLink('site-a', task)).toBe('/site-a/crm/contacts/c-1')
    expect(crmTaskReminderLink('site-a', { dealId: 'd/1' })).toBe('/site-a/crm/deals/d%2F1')
    expect(crmTaskReminderLink('site-a', { companyId: 'co-1' })).toBe('/site-a/crm/companies/co-1')
    expect(crmTaskReminderLink(null, {})).toBe('/org/crm/tasks')
  })

  it('says the title and the due time, in the zone it is given', () => {
    expect(composeCrmTaskReminderBody(task, 'America/Chicago')).toBe(
      'Call Jane · due Thu, Sep 10, 10:00 AM',
    )
    expect(composeCrmTaskReminderBody({ ...task, dueAtMs: null }, 'UTC')).toBe('Call Jane')
    expect(composeCrmTaskReminderSubject([task])).toBe('Reminder: Call Jane')
    expect(composeCrmTaskReminderSubject([task, task])).toBe('Reminder: 2 tasks are due')
  })

  it('writes one mail for every task due, soonest first, with the way out last', () => {
    const later: CrmReminderTask = {
      ...task,
      id: 't-2',
      title: 'Send the deck',
      dueAtMs: LATER,
      remindAtMs: LATER,
      contactId: undefined,
      dealId: 'd-1',
    }
    const text = composeCrmTaskReminderEmailText({
      tasks: [later, task],
      timeZone: 'America/Chicago',
      productName: 'Aglyn',
      taskUrl: (each) => `https://app.aglyn.com/acme/hosts/main/crm/tasks#${each.id}`,
      settingsUrl: 'https://app.aglyn.com/manage/notifications',
      supportLine: '\n\nSupport: help@aglyn.com',
    })
    expect(text).toBe(
      [
        'A reminder from Aglyn: 2 tasks are due.',
        '',
        '- Call Jane · due Thu, Sep 10, 10:00 AM',
        '  https://app.aglyn.com/acme/hosts/main/crm/tasks#t-1',
        '- Send the deck · due Sat, Sep 12, 10:00 AM',
        '  https://app.aglyn.com/acme/hosts/main/crm/tasks#t-2',
        '',
        'You get task reminders because the Forms & bookings category is on in ' +
          'your notification settings: https://app.aglyn.com/manage/notifications',
      ].join('\n') + '\n\nSupport: help@aglyn.com',
    )
    expect(
      composeCrmTaskReminderEmailText({
        tasks: [task],
        timeZone: 'UTC',
        productName: 'Acme',
        taskUrl: () => 'https://x',
        settingsUrl: 'https://s',
      }),
    ).toMatch(/^A reminder from Acme: this task is due\./)
  })
})
