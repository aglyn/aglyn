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

import { validateOutreachSequence } from '../engine/sequence-validation'
import {
  emptyOutreachSequenceDraft,
  newOutreachEmailStep,
  newOutreachStepId,
  newOutreachTaskStep,
  OUTREACH_DEFAULT_FOLLOW_UP_DAYS,
  outreachEnrolledSequenceIssues,
  readOutreachSequenceDraft,
} from './sequence-draft'

/**
 * A sequence as the editor holds it (AGL-2980): what the reader keeps of a
 * request, the steps a new sequence starts with, and what may not change
 * once people are enrolled.
 */

describe('readOutreachSequenceDraft (AGL-2980)', () => {
  it('keeps what the model names, coerced, and leaves everything else behind', () => {
    const draft = readOutreachSequenceDraft({
      name: '  Second   locations ',
      hostId: ' host-1 ',
      mailboxId: 'mbx-1',
      status: 'active',
      steps: [
        {
          id: 'a',
          kind: 'email',
          delayBusinessDays: '0',
          subject: 'Hello',
          body: 'Hi',
          templateId: '',
          sendNow: true,
        },
        { id: 'b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 1.5 },
        { id: 'c', kind: 'sms' },
      ],
      settings: { window: { days: [1, '2'], startMinute: 540, endMinute: 1020 }, allowCustomers: 'yes' },
    })
    expect(draft).toEqual({
      name: 'Second locations',
      hostId: 'host-1',
      mailboxId: 'mbx-1',
      steps: [
        {
          id: 'a',
          kind: 'email',
          delayBusinessDays: 0,
          subject: 'Hello',
          replyInThread: true,
          body: 'Hi',
          templateId: null,
        },
        { id: 'b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: Number.NaN },
        { id: 'c', kind: 'sms' },
      ],
      settings: {
        window: { days: [1, 2], startMinute: 540, endMinute: 1020 },
        allowedCountries: ['US'],
        allowCustomers: false,
      },
    })
    // What the reader could not make sense of is left for the validator to name.
    expect(validateOutreachSequence(draft).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['delay_invalid', 'unknown_step_kind']),
    )
  })
})

describe('new steps and sequences (AGL-2980)', () => {
  it('starts a sequence with one email that waits for the next opening', () => {
    const draft = emptyOutreachSequenceDraft({ hostId: 'host-1', allowedCountries: ['US'], random: () => 0.25 })
    expect(draft.steps).toEqual([
      {
        id: expect.stringMatching(/^step-/),
        kind: 'email',
        delayBusinessDays: 0,
        subject: '',
        replyInThread: true,
        body: '',
        templateId: null,
      },
    ])
    expect(draft.settings).toEqual({ window: null, allowedCountries: ['US'], allowCustomers: false })
  })

  it('makes a later email a follow-up in the thread, and titles a task for its kind', () => {
    const first = newOutreachEmailStep([])
    const second = newOutreachEmailStep([first])
    expect(second.delayBusinessDays).toBe(OUTREACH_DEFAULT_FOLLOW_UP_DAYS)
    expect(second.replyInThread).toBe(true)
    expect(newOutreachTaskStep([first], 'linkedin').title).toBe('Connect on LinkedIn')
    expect(newOutreachTaskStep([first], 'todo').title).toBe('')
  })

  it('never repeats an id, even from a source that keeps answering the same number', () => {
    const steps: Array<{ id: string }> = []
    for (let index = 0; index < 6; index += 1) steps.push({ id: newOutreachStepId(steps, () => 0.5) })
    expect(new Set(steps.map((step) => step.id)).size).toBe(6)
  })
})

describe('outreachEnrolledSequenceIssues (AGL-2980)', () => {
  const email = newOutreachEmailStep([], () => 0.1)
  const task = newOutreachTaskStep([email], 'call', () => 0.2)
  const stored = { hostId: 'host-1', mailboxId: 'mbx-1', steps: [email, task] }

  it('allows wording edits and steps added at the end', () => {
    expect(
      outreachEnrolledSequenceIssues(stored, {
        ...stored,
        steps: [{ ...email, body: 'New wording' }, task, newOutreachEmailStep([email, task], () => 0.3)],
      }),
    ).toEqual([])
  })

  it('refuses a removed, reordered or re-kinded step, and a new site or mailbox', () => {
    const codes = (next: Parameters<typeof outreachEnrolledSequenceIssues>[1]) =>
      outreachEnrolledSequenceIssues(stored, next).map((issue) => issue.code)
    expect(codes({ ...stored, steps: [email] })).toEqual(['steps_locked'])
    expect(codes({ ...stored, steps: [task, email] })).toEqual(['steps_locked'])
    expect(codes({ ...stored, steps: [email, { ...email, id: task.id }] })).toEqual(['steps_locked'])
    expect(codes({ ...stored, hostId: 'host-2' })).toEqual(['host_locked'])
    expect(codes({ ...stored, mailboxId: 'mbx-2' })).toEqual(['mailbox_locked'])
  })
})
