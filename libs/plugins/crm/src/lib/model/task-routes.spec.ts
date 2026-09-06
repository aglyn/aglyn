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

import type { CrmTask } from '@aglyn/aglyn'
import {
  CRM_TASK_NOTES_MAX,
  CRM_TASK_ROUTES,
  CRM_TASK_TITLE_MAX,
  crmTaskFieldsOf,
  crmTaskRouteUrl,
  readCrmTaskFields,
} from './task-routes'

/**
 * The request body a browser sends the task routes, as the server reads it
 * (AGL-2599). The reader is the one place a task's editable fields are
 * validated — the drawer trusts it — so what it refuses and what it coerces
 * are pinned here, and the drawer's own form shape (`crmTaskFieldsOf`) is
 * proven to survive the trip unchanged.
 */

describe('readCrmTaskFields', () => {
  const valid = {
    title: '  Call back about the quote  ',
    kind: 'call',
    priority: 'high',
    dueAtMs: '1757062800000',
    assigneeUid: ' u-2 ',
    notes: 'left a voicemail',
    contactId: 'c-1',
  }

  it('trims and coerces where the meaning is not in doubt', () => {
    const read = readCrmTaskFields(valid)
    expect(read).toEqual({
      ok: true,
      fields: {
        title: 'Call back about the quote',
        kind: 'call',
        priority: 'high',
        dueAtMs: 1757062800000,
        assigneeUid: 'u-2',
        notes: 'left a voicemail',
        contactId: 'c-1',
        companyId: null,
        dealId: null,
      },
    })
  })

  it('defaults the kind and priority and leaves the rest empty', () => {
    expect(readCrmTaskFields({ title: 'Follow up' })).toEqual({
      ok: true,
      fields: {
        title: 'Follow up',
        kind: 'todo',
        priority: 'normal',
        dueAtMs: null,
        assigneeUid: null,
        notes: '',
        contactId: null,
        companyId: null,
        dealId: null,
      },
    })
  })

  it('refuses a task with no title, or one that is too long', () => {
    expect(readCrmTaskFields({ title: '   ' })).toEqual({
      ok: false,
      error: 'A task needs a title.',
    })
    expect(readCrmTaskFields(undefined)).toEqual({
      ok: false,
      error: 'A task needs a title.',
    })
    const long = readCrmTaskFields({ title: 'x'.repeat(CRM_TASK_TITLE_MAX + 1) })
    expect(long.ok).toBe(false)
    expect(long.ok === false && long.error).toMatch(/at most 200 characters/)
  })

  it('refuses a kind or priority the list cannot draw', () => {
    expect(readCrmTaskFields({ title: 'x', kind: 'fax' })).toEqual({
      ok: false,
      error: '"fax" is not a kind of task.',
    })
    expect(readCrmTaskFields({ title: 'x', priority: 'urgent' })).toEqual({
      ok: false,
      error: '"urgent" is not a priority.',
    })
  })

  it('refuses an unreadable due date but accepts an empty one', () => {
    expect(readCrmTaskFields({ title: 'x', dueAtMs: 'tomorrow' })).toEqual({
      ok: false,
      error: 'The due date could not be read.',
    })
    expect(readCrmTaskFields({ title: 'x', dueAtMs: -5 }).ok).toBe(false)
    const empty = readCrmTaskFields({ title: 'x', dueAtMs: '' })
    expect(empty.ok && empty.fields.dueAtMs).toBeNull()
    // A fractional millisecond is rounded rather than stored as a float.
    const fractional = readCrmTaskFields({ title: 'x', dueAtMs: 1000.4 })
    expect(fractional.ok && fractional.fields.dueAtMs).toBe(1000)
  })

  it('refuses a record id that could not be a Firestore id', () => {
    expect(readCrmTaskFields({ title: 'x', contactId: 'a/b' })).toEqual({
      ok: false,
      error: 'The linked contact could not be read.',
    })
    expect(readCrmTaskFields({ title: 'x', dealId: 'x'.repeat(201) }).ok).toBe(false)
    // Empty and null both mean "not linked", never a refusal.
    const unlinked = readCrmTaskFields({ title: 'x', contactId: '', dealId: null })
    expect(unlinked.ok && unlinked.fields.contactId).toBeNull()
    expect(unlinked.ok && unlinked.fields.dealId).toBeNull()
  })

  it('caps notes rather than refusing them', () => {
    const read = readCrmTaskFields({ title: 'x', notes: 'n'.repeat(CRM_TASK_NOTES_MAX + 50) })
    expect(read.ok && read.fields.notes.length).toBe(CRM_TASK_NOTES_MAX)
  })
})

describe('crmTaskFieldsOf', () => {
  it('reads a stored task into the form and back without a change', () => {
    const stored: Partial<CrmTask> = {
      title: 'Send the deck',
      kind: 'email',
      priority: 'low',
      dueAtMs: 1757062800000,
      assigneeUid: 'u-9',
      notes: 'v2 with pricing',
      dealId: 'd-4',
      status: 'open',
      createdByUid: 'u-1',
    }
    const fields = crmTaskFieldsOf(stored)
    expect(fields).toEqual({
      title: 'Send the deck',
      kind: 'email',
      priority: 'low',
      dueAtMs: 1757062800000,
      assigneeUid: 'u-9',
      notes: 'v2 with pricing',
      contactId: null,
      companyId: null,
      dealId: 'd-4',
    })
    // What the drawer sends back is what the server reads: a no-op save
    // changes no field the form owns.
    expect(readCrmTaskFields(fields)).toEqual({ ok: true, fields })
  })

  it('treats an empty document as a blank form', () => {
    expect(crmTaskFieldsOf({})).toEqual({
      title: '',
      kind: 'todo',
      priority: 'normal',
      dueAtMs: null,
      assigneeUid: null,
      notes: '',
      contactId: null,
      companyId: null,
      dealId: null,
    })
  })
})

describe('the route addresses', () => {
  it('registers under the crm prefix and is called under /api', () => {
    expect(CRM_TASK_ROUTES.save).toBe('crm/task-save')
    expect(CRM_TASK_ROUTES.complete).toBe('crm/task-complete')
    expect(crmTaskRouteUrl(CRM_TASK_ROUTES.complete)).toBe('/api/crm/task-complete')
  })
})
