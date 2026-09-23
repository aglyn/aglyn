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
 *
 * @jest-environment node
 */

import type {
  OutreachEmailStep,
  OutreachSequence,
  OutreachSequenceStep,
  OutreachTaskStep,
} from '../model/outreach.types'
import {
  firstEmailStepIndex,
  hasOutreachValidationErrors,
  isInThreadEmailStep,
  normalizeOutreachAllowedCountries,
  OUTREACH_MERGE_FIELDS,
  outreachSubjectHasReplyPrefix,
  readOutreachSequenceSettings,
  validateOutreachOrgSettings,
  validateOutreachSendWindow,
  validateOutreachSequence,
  validateOutreachSequenceActivation,
  validateOutreachSteps,
} from './sequence-validation'

const email = (overrides: Partial<OutreachEmailStep> = {}): OutreachEmailStep => ({
  id: `email-${Math.random().toString(36).slice(2)}`,
  kind: 'email',
  delayBusinessDays: 3,
  subject: '',
  replyInThread: true,
  body: 'Following up.',
  templateId: null,
  ...overrides,
})

const task = (overrides: Partial<OutreachTaskStep> = {}): OutreachTaskStep => ({
  id: `task-${Math.random().toString(36).slice(2)}`,
  kind: 'task',
  taskKind: 'linkedin',
  title: 'Connect on LinkedIn',
  delayBusinessDays: 0,
  ...overrides,
})

const firstEmail = (overrides: Partial<OutreachEmailStep> = {}) =>
  email({
    delayBusinessDays: 0,
    subject: "{{contact.company}}'s client sites",
    replyInThread: false,
    body: 'Hi {{contact.firstName}},\n\n{{enrollment.personalLine}}\n\nWorth 20 minutes?',
    ...overrides,
  })

const sequence = (overrides: Partial<OutreachSequence> = {}) => ({
  name: 'Agencies, first touch',
  mailboxId: 'mailbox-1',
  steps: [firstEmail(), email(), email({ delayBusinessDays: 5 }), email({ delayBusinessDays: 7 })],
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, listUnsubscribe: false },
  ...overrides,
})

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code)

describe('a valid sequence', () => {
  it('has no issues at all', () => {
    expect(validateOutreachSequence(sequence())).toEqual([])
  })

  it('may mix tasks in, up to eight steps', () => {
    const steps: OutreachSequenceStep[] = [
      firstEmail(),
      task(),
      email(),
      task({ taskKind: 'call', title: 'Call the office', delayBusinessDays: 2 }),
      email(),
      task({ taskKind: 'todo', title: 'Check the pricing page' }),
      email(),
      task(),
    ]
    expect(validateOutreachSequence(sequence({ steps }))).toEqual([])
  })
})

describe('step counts', () => {
  it('refuses an empty sequence', () => {
    expect(codes(validateOutreachSteps([]))).toEqual(['steps_required'])
    expect(codes(validateOutreachSteps(undefined))).toEqual(['steps_required'])
  })

  it('refuses a ninth step', () => {
    const steps = [firstEmail(), ...Array.from({ length: 8 }, () => task())]
    expect(codes(validateOutreachSteps(steps))).toContain('too_many_steps')
  })

  it('refuses a fifth email', () => {
    const steps = [firstEmail(), email(), email(), email(), email()]
    const issues = validateOutreachSteps(steps)
    expect(codes(issues)).toEqual(['too_many_email_steps'])
    expect(issues[0].message).toBe('A sequence sends at most 4 emails to one person.')
  })

  it('refuses a missing or repeated step id', () => {
    const issues = validateOutreachSteps([firstEmail({ id: 'a' }), email({ id: 'a' }), email({ id: ' ' })])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['steps.1.id', 'duplicate_step_id'],
      ['steps.2.id', 'step_id_required'],
    ])
  })

  it('refuses a step of no known kind', () => {
    const issues = validateOutreachSteps([
      firstEmail(),
      { id: 'x', kind: 'sms', delayBusinessDays: 1 } as unknown as OutreachSequenceStep,
    ])
    expect(codes(issues)).toEqual(['unknown_step_kind'])
  })
})

describe('delays', () => {
  it('lets the first step go at the next opening and holds later emails to 1–30 business days', () => {
    expect(validateOutreachSteps([firstEmail({ delayBusinessDays: 0 })])).toEqual([])
    const issues = validateOutreachSteps([
      firstEmail(),
      email({ delayBusinessDays: 0 }),
      email({ delayBusinessDays: 31 }),
      email({ delayBusinessDays: 1.5 }),
    ])
    expect(issues.map((issue) => issue.path)).toEqual([
      'steps.1.delayBusinessDays',
      'steps.2.delayBusinessDays',
      'steps.3.delayBusinessDays',
    ])
    expect(issues[0].message).toBe('Wait 1–30 business days before this email.')
  })

  it('lets the first email share a day with a task before it', () => {
    expect(validateOutreachSteps([task(), firstEmail({ delayBusinessDays: 0 })])).toEqual([])
    // A later email still waits a day, even when a task carried the wait.
    expect(
      codes(validateOutreachSteps([firstEmail(), task({ delayBusinessDays: 2 }), email({ delayBusinessDays: 0 })])),
    ).toEqual(['delay_invalid'])
  })

  it('lets a task share a day with the step before it, within 30 days', () => {
    expect(validateOutreachSteps([firstEmail(), task({ delayBusinessDays: 0 })])).toEqual([])
    expect(codes(validateOutreachSteps([firstEmail(), task({ delayBusinessDays: 31 })]))).toEqual([
      'delay_invalid',
    ])
    expect(codes(validateOutreachSteps([firstEmail({ delayBusinessDays: -1 })]))).toContain(
      'delay_invalid',
    )
  })
})

describe('email steps', () => {
  it('needs a subject on the first email, and ignores the subject of an in-thread one', () => {
    const issues = validateOutreachSteps([firstEmail({ subject: '  ' }), email({ subject: '' })])
    expect(issues.map((issue) => [issue.path, issue.code, issue.message])).toEqual([
      ['steps.0.subject', 'subject_required', 'The first email needs a subject.'],
    ])
  })

  it('treats the first email as starting the thread whatever its flag says', () => {
    const steps = [task(), firstEmail({ replyInThread: true, subject: '' })]
    expect(firstEmailStepIndex(steps)).toBe(1)
    expect(isInThreadEmailStep(steps, 1)).toBe(false)
    expect(codes(validateOutreachSteps(steps))).toEqual(['subject_required'])
  })

  it('needs a subject on a later email that starts a new thread', () => {
    const steps = [firstEmail(), email({ replyInThread: false, subject: '' })]
    expect(isInThreadEmailStep(steps, 1)).toBe(false)
    expect(validateOutreachSteps(steps)[0]).toMatchObject({
      path: 'steps.1.subject',
      message: 'An email that starts a new thread needs a subject.',
    })
  })

  it('refuses "Re:" or "Fwd:" on an email that answers nothing', () => {
    for (const subject of ['Re: your client sites', 'RE : pricing', 'Fwd: intro', 'AW: Termin', 're[2]: hi']) {
      expect(outreachSubjectHasReplyPrefix(subject)).toBe(true)
      expect(codes(validateOutreachSteps([firstEmail({ subject })]))).toEqual(['subject_reply_prefix'])
    }
    expect(outreachSubjectHasReplyPrefix('Regarding your client sites')).toBe(false)
    expect(outreachSubjectHasReplyPrefix('Forward planning')).toBe(false)
  })

  it('takes the body from the step or from a CRM template, never both or neither', () => {
    expect(
      validateOutreachSteps([firstEmail(), email({ body: '', templateId: 'template-1' })]),
    ).toEqual([])
    expect(
      codes(validateOutreachSteps([firstEmail(), email({ body: 'Hi', templateId: 'template-1' })])),
    ).toEqual(['body_and_template'])
    expect(codes(validateOutreachSteps([firstEmail(), email({ body: ' \n', templateId: null })]))).toEqual([
      'body_required',
    ])
  })

  it('refuses a subject or body past the CRM limits', () => {
    const issues = validateOutreachSteps([
      firstEmail({ subject: 'x'.repeat(201) }),
      email({ body: 'y'.repeat(10_001) }),
    ])
    expect(codes(issues)).toEqual(['subject_too_long', 'body_too_long'])
  })

  it('warns, without refusing, about a merge field nobody fills', () => {
    const issues = validateOutreachSteps([
      firstEmail({ subject: 'For {{contact.shoeSize}}', body: '{{enrollment.personalLine}} {{deal.color}}' }),
    ])
    expect(issues.map((issue) => [issue.path, issue.code, issue.severity])).toEqual([
      ['steps.0.subject', 'unknown_merge_field', 'warning'],
      ['steps.0.body', 'unknown_merge_field', 'warning'],
    ])
    expect(hasOutreachValidationErrors(issues)).toBe(false)
  })

  it("warns when the first email never uses the rep's personal line", () => {
    const issues = validateOutreachSteps([firstEmail({ body: 'Hi {{contact.firstName}}, worth a call?' })])
    expect(issues).toEqual([
      expect.objectContaining({ code: 'personal_line_unused', severity: 'warning' }),
    ])
    // A template body cannot be read here, so it draws no warning.
    expect(validateOutreachSteps([firstEmail({ body: '', templateId: 't-1' })])).toEqual([])
  })

  it('offers the CRM fields and the personal line to the picker', () => {
    const keys = OUTREACH_MERGE_FIELDS.map((field) => field.key)
    expect(keys).toContain('contact.firstName')
    expect(keys).toContain('sender.name')
    expect(keys[keys.length - 1]).toBe('enrollment.personalLine')
  })
})

describe('task steps', () => {
  it('needs a known kind and a title', () => {
    const issues = validateOutreachSteps([
      firstEmail(),
      task({ taskKind: 'fax' as never }),
      task({ title: '' }),
      task({ title: 't'.repeat(201) }),
    ])
    expect(codes(issues)).toEqual(['task_kind_invalid', 'task_title_required', 'task_title_too_long'])
  })
})

describe('the sequence around the steps', () => {
  it('needs a name, within its limit', () => {
    expect(codes(validateOutreachSequence(sequence({ name: ' ' })))).toEqual(['name_required'])
    expect(codes(validateOutreachSequence(sequence({ name: 'n'.repeat(121) })))).toEqual(['name_too_long'])
  })

  it('needs a mailbox when it sends email, and none when it only holds tasks', () => {
    expect(codes(validateOutreachSequence(sequence({ mailboxId: '' })))).toEqual(['mailbox_required'])
    expect(validateOutreachSequence(sequence({ mailboxId: '', steps: [task()] }))).toEqual([])
  })
})

describe('settings', () => {
  it('reads a stored map with the defaults filled in', () => {
    expect(readOutreachSequenceSettings(null)).toEqual({
      window: null,
      allowedCountries: ['US'],
      allowCustomers: false,
      // Off unless it was stored on (AGL-3239): a sequence written before
      // the setting existed tracked nothing, and reads that way.
      trackClicks: false,
      // Off unless it was stored on (AGL-3296): no header is the default.
      listUnsubscribe: false,
    })
    expect(
      readOutreachSequenceSettings({
        allowedCountries: ['us', 'CA', 'ca', 'Canada'],
        allowCustomers: 'yes',
        trackClicks: 'yes',
        listUnsubscribe: 'yes',
      }),
    ).toEqual({ window: null, allowedCountries: ['US', 'CA'], allowCustomers: false, trackClicks: false, listUnsubscribe: false })
  })

  it('reads the unsubscribe header setting only when it was stored on (AGL-3296)', () => {
    expect(readOutreachSequenceSettings({ listUnsubscribe: true }).listUnsubscribe).toBe(true)
    expect(readOutreachSequenceSettings({ listUnsubscribe: false }).listUnsubscribe).toBe(false)
    expect(readOutreachSequenceSettings({}).listUnsubscribe).toBe(false)
  })

  it('normalizes typed country codes', () => {
    expect(normalizeOutreachAllowedCountries([' us', 'GB', 'gb', 7, 'USA'])).toEqual(['US', 'GB'])
    expect(normalizeOutreachAllowedCountries('US')).toEqual([])
  })

  it('refuses an empty country list and a code that is not two letters', () => {
    const issues = validateOutreachSequence(
      sequence({ settings: { window: null, allowedCountries: [], allowCustomers: false, trackClicks: false, listUnsubscribe: false } }),
    )
    expect(codes(issues)).toEqual(['countries_required'])
    const typed = validateOutreachSequence(
      sequence({ settings: { window: null, allowedCountries: ['US', 'usa'], allowCustomers: false, trackClicks: false, listUnsubscribe: false } }),
    )
    expect(typed.map((issue) => [issue.path, issue.code])).toEqual([
      ['settings.allowedCountries.1', 'country_invalid'],
    ])
  })

  it('holds a window override to at least one day and an opening before its close', () => {
    expect(validateOutreachSendWindow({ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 })).toEqual([])
    expect(codes(validateOutreachSendWindow({ days: [], startMinute: 540, endMinute: 1020 }))).toEqual([
      'window_days_invalid',
    ])
    expect(codes(validateOutreachSendWindow({ days: [1, 1], startMinute: 540, endMinute: 1020 }))).toEqual([
      'window_days_invalid',
    ])
    expect(codes(validateOutreachSendWindow({ days: [7], startMinute: 540, endMinute: 1020 }))).toEqual([
      'window_days_invalid',
    ])
    expect(codes(validateOutreachSendWindow({ days: [1], startMinute: 1020, endMinute: 540 }))).toEqual([
      'window_hours_invalid',
    ])
    expect(codes(validateOutreachSendWindow({ days: [1], startMinute: 0, endMinute: 1441 }))).toEqual([
      'window_hours_invalid',
    ])
    const issues = validateOutreachSequence(
      sequence({
        settings: { window: { days: [], startMinute: 9, endMinute: 5 }, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, listUnsubscribe: false },
      }),
    )
    expect(issues.map((issue) => issue.path)).toEqual(['settings.window.days', 'settings.window'])
  })
})

describe('activation', () => {
  const org = { legalName: 'Example Co LLC', postalAddress: 'PO Box 12345, Anytown, TX 75001' }

  it('passes a valid sequence for an organization whose footer can be written', () => {
    expect(validateOutreachSequenceActivation(sequence(), org)).toEqual([])
  })

  it('is refused while the postal address or the legal name is empty', () => {
    const issues = validateOutreachSequenceActivation(sequence(), { legalName: '', postalAddress: '  ' })
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['orgSettings.legalName', 'legal_name_required'],
      ['orgSettings.postalAddress', 'postal_address_required'],
    ])
    expect(hasOutreachValidationErrors(issues)).toBe(true)
    expect(codes(validateOutreachOrgSettings(null))).toEqual([
      'legal_name_required',
      'postal_address_required',
    ])
  })

  it("carries the sequence's own errors too", () => {
    expect(codes(validateOutreachSequenceActivation(sequence({ steps: [] }), org))).toEqual([
      'steps_required',
    ])
  })
})
