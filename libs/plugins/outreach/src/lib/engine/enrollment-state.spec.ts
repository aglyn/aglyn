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

import {
  OUTREACH_ENROLLMENT_STATUSES,
  OUTREACH_STOP_REASONS,
  OUTREACH_STOP_REASONS_BY_STATUS,
  type OutreachEmailStep,
  type OutreachEnrollmentStatus,
  type OutreachSendWindow,
  type OutreachTaskStep,
} from '../model/outreach.types'
import {
  applyOutreachEnrollmentEvent,
  buildOutreachEnrollment,
  canTransitionOutreachEnrollment,
  OUTREACH_ENROLLMENT_TRANSITIONS,
  outreachAttestationsFrom,
  planOutreachFirstDue,
  planOutreachStepCompletion,
} from './enrollment-state'

const CHICAGO = 'America/Chicago'
const at = (iso: string) => Date.parse(iso)
const OFFICE: OutreachSendWindow = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 }
const mailbox = { timezone: CHICAGO, window: OFFICE }
const middle = () => 0.5

const first: OutreachEmailStep = {
  id: 'email-1',
  kind: 'email',
  delayBusinessDays: 0,
  subject: 'Your client sites',
  replyInThread: false,
  body: 'Hi',
  templateId: null,
}
const second: OutreachEmailStep = { ...first, id: 'email-2', subject: '', replyInThread: true, delayBusinessDays: 3 }
const linkedIn: OutreachTaskStep = { id: 'task-1', kind: 'task', taskKind: 'linkedin', title: 'Connect', delayBusinessDays: 1 }
const newThread: OutreachEmailStep = { ...first, id: 'email-3', subject: 'Closing the loop', delayBusinessDays: 7 }

const sequence = {
  id: 'sequence-1',
  hostId: 'host-1',
  mailboxId: 'mailbox-1',
  steps: [first, second, linkedIn, newThread],
  settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false },
}

describe('the enrollment state machine', () => {
  it('names a transition list for every status', () => {
    expect(Object.keys(OUTREACH_ENROLLMENT_TRANSITIONS).sort()).toEqual([...OUTREACH_ENROLLMENT_STATUSES].sort())
  })

  it('sends only from active, and pauses and resumes', () => {
    expect(canTransitionOutreachEnrollment('active', 'paused')).toBe(true)
    expect(canTransitionOutreachEnrollment('paused', 'active')).toBe(true)
    expect(canTransitionOutreachEnrollment('active', 'finished')).toBe(true)
    expect(canTransitionOutreachEnrollment('paused', 'finished')).toBe(false)
    expect(canTransitionOutreachEnrollment('paused', 'failed')).toBe(false)
  })

  it('still records what the thread says after the sending ended', () => {
    for (const ended of ['finished', 'stopped', 'failed'] as OutreachEnrollmentStatus[]) {
      expect(canTransitionOutreachEnrollment(ended, 'replied')).toBe(true)
      expect(canTransitionOutreachEnrollment(ended, 'bounced')).toBe(true)
      expect(canTransitionOutreachEnrollment(ended, 'opted_out')).toBe(true)
      expect(canTransitionOutreachEnrollment(ended, 'active')).toBe(false)
    }
    expect(canTransitionOutreachEnrollment('replied', 'opted_out')).toBe(true)
    expect(canTransitionOutreachEnrollment('replied', 'active')).toBe(false)
  })

  it('keeps bounced and opted_out final', () => {
    for (const status of OUTREACH_ENROLLMENT_STATUSES) {
      expect(canTransitionOutreachEnrollment('bounced', status)).toBe(false)
      expect(canTransitionOutreachEnrollment('opted_out', status)).toBe(false)
    }
  })

  it('gives every stop reason a status to be recorded with', () => {
    const recorded = new Set(Object.values(OUTREACH_STOP_REASONS_BY_STATUS).flat())
    expect([...OUTREACH_STOP_REASONS].filter((reason) => !recorded.has(reason))).toEqual([])
  })
})

describe('applyOutreachEnrollmentEvent', () => {
  const active = { status: 'active' as const, nextDueAtMs: at('2026-09-18T15:00:00Z') }
  const atMs = at('2026-09-15T15:00:00Z')

  it('pauses with the member who did it, keeping the place in the sequence', () => {
    expect(applyOutreachEnrollmentEvent(active, { type: 'pause', atMs, byUid: 'u-avery', detail: 'On hold\nfor now' })).toEqual({
      patch: {
        status: 'paused',
        stopReason: 'manual',
        stopDetail: 'On hold for now',
        stoppedAtMs: atMs,
        stoppedByUid: 'u-avery',
        nextDueAtMs: active.nextDueAtMs,
      },
      error: null,
    })
  })

  it('resumes by clearing the stop record', () => {
    const paused = { status: 'paused' as const, nextDueAtMs: active.nextDueAtMs }
    expect(applyOutreachEnrollmentEvent(paused, { type: 'resume', atMs, byUid: 'u-avery' }).patch).toEqual({
      status: 'active',
      stopReason: null,
      stopDetail: null,
      stoppedAtMs: null,
      stoppedByUid: null,
      nextDueAtMs: active.nextDueAtMs,
    })
  })

  it('ends the sending with the reason each outcome carries', () => {
    const cases = [
      [{ type: 'reply', atMs }, 'replied', 'reply'],
      [{ type: 'bounce', atMs, detail: '550 5.1.1 no such user' }, 'bounced', 'hard_bounce'],
      [{ type: 'opt_out', atMs, reason: 'opt_out_reply' }, 'opted_out', 'opt_out_reply'],
      [{ type: 'opt_out', atMs, reason: 'unsubscribe' }, 'opted_out', 'unsubscribe'],
      [{ type: 'stop', atMs, byUid: 'u-avery' }, 'stopped', 'manual'],
      [{ type: 'stop', atMs, byUid: null, reason: 'gate', detail: 'This contact is a customer.' }, 'stopped', 'gate'],
      [{ type: 'send_failed', atMs, detail: 'invalid_grant' }, 'failed', 'send_failed'],
    ] as const
    for (const [event, status, reason] of cases) {
      const { patch, error } = applyOutreachEnrollmentEvent(active, event)
      expect(error).toBeNull()
      expect(patch).toMatchObject({ status, stopReason: reason, stoppedAtMs: atMs, nextDueAtMs: null })
    }
  })

  it('records the engine, not a member, when no uid is given', () => {
    expect(applyOutreachEnrollmentEvent(active, { type: 'reply', atMs }).patch?.stoppedByUid).toBeNull()
  })

  it('writes nothing when the enrollment is already there', () => {
    expect(applyOutreachEnrollmentEvent({ status: 'replied', nextDueAtMs: null }, { type: 'reply', atMs })).toEqual({
      patch: null,
      error: null,
    })
  })

  it('refuses a transition the machine does not allow, and says why', () => {
    expect(applyOutreachEnrollmentEvent({ status: 'bounced', nextDueAtMs: null }, { type: 'reply', atMs })).toEqual({
      patch: null,
      error: "This enrollment bounced, so it can't be marked as one that got a reply.",
    })
    expect(
      applyOutreachEnrollmentEvent({ status: 'finished', nextDueAtMs: null }, { type: 'resume', atMs, byUid: 'u-avery' })
        .error,
    ).toBe("This enrollment finished, so it can't be marked as one that is active.")
  })

  it('refuses a stop reason its status does not allow', () => {
    const result = applyOutreachEnrollmentEvent(active, {
      type: 'stop',
      atMs,
      byUid: null,
      reason: 'hard_bounce' as never,
    })
    expect(result.patch).toBeNull()
    expect(result.error).toBe('"hard_bounce" isn\'t a reason an enrollment was stopped.')
  })
})

describe('enrolling', () => {
  // Monday 2026-09-14 at 15:12 CDT.
  const nowMs = at('2026-09-14T20:12:00Z')

  it('schedules the first step from the moment of enrollment', () => {
    expect(planOutreachFirstDue({ sequence, mailbox, enrolledAtMs: nowMs, random: middle })).toBe(nowMs)
    const saturday = at('2026-09-19T16:00:00Z')
    expect(new Date(planOutreachFirstDue({ sequence, mailbox, enrolledAtMs: saturday, random: () => 0 }) as number).toISOString()).toBe(
      '2026-09-21T14:00:00.000Z',
    )
    expect(planOutreachFirstDue({ sequence: { ...sequence, steps: [] }, mailbox, enrolledAtMs: nowMs, random: middle })).toBeNull()
  })

  it("follows the sequence's own window", () => {
    const tuesdays = { ...sequence, settings: { ...sequence.settings, window: { days: [2], startMinute: 600, endMinute: 660 } } }
    expect(
      new Date(planOutreachFirstDue({ sequence: tuesdays, mailbox, enrolledAtMs: nowMs, random: () => 0 }) as number).toISOString(),
    ).toBe('2026-09-15T15:00:00.000Z')
  })

  it('stamps the attestations a rep ticked, dropping any it does not know', () => {
    expect(outreachAttestationsFrom(['us_business_address', 'verified_deliverable', 'looks_legit', 7], 'u-avery', nowMs)).toEqual({
      us_business_address: { uid: 'u-avery', atMs: nowMs },
      verified_deliverable: { uid: 'u-avery', atMs: nowMs },
    })
  })

  it('builds the whole document, first step scheduled', () => {
    const attestations = outreachAttestationsFrom(['us_business_address', 'published_or_given', 'verified_deliverable'], 'u-avery', nowMs)
    expect(
      buildOutreachEnrollment({
        id: 'enrollment-1',
        sequence,
        mailbox,
        contactId: 'contact-1',
        contactName: '  Casey\n Morgan ',
        email: ' Casey@Example.com ',
        cold: true,
        personalLine: '  Saw the\nportfolio launch. ',
        attestations,
        enrolledByUid: 'u-avery',
        nowMs,
        random: middle,
      }),
    ).toEqual({
      id: 'enrollment-1',
      sequenceId: 'sequence-1',
      target: 'contact',
      contactId: 'contact-1',
      leadId: null,
      contactName: 'Casey Morgan',
      email: 'casey@example.com',
      hostId: 'host-1',
      mailboxId: 'mailbox-1',
      stepIndex: 0,
      nextDueAtMs: nowMs,
      status: 'active',
      stopReason: null,
      stopDetail: null,
      stoppedAtMs: null,
      stoppedByUid: null,
      personalLine: 'Saw the portfolio launch.',
      cold: true,
      attestations,
      enrolledByUid: 'u-avery',
      gmailThreadId: null,
      gmailThreadIds: [],
      threadSubject: null,
      messageIds: [],
      lastSentAtMs: null,
      campaignIds: [],
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    })
  })

  it('stamps the sequence’s campaigns as they stand at enrollment (AGL-3254)', () => {
    const enrollment = buildOutreachEnrollment({
      id: 'enrollment-2',
      sequence: { ...sequence, campaignIds: [' founder-icp2 ', 'founder-icp2', 'founder-icp1'] },
      mailbox,
      contactId: 'contact-1',
      email: 'casey@example.com',
      cold: false,
      personalLine: '',
      attestations: {},
      enrolledByUid: 'u-avery',
      nowMs,
      random: middle,
    })
    expect(enrollment.campaignIds).toEqual(['founder-icp2', 'founder-icp1'])
  })
})

describe('planOutreachStepCompletion', () => {
  // Monday 2026-09-14 at 10:00 CDT.
  const sentAtMs = at('2026-09-14T15:00:00Z')
  const fresh = {
    status: 'active' as const,
    stepIndex: 0,
    gmailThreadId: null,
    gmailThreadIds: [],
    messageIds: [],
    threadSubject: null,
  }

  it('starts the thread on the first email and schedules the follow-up', () => {
    const { patch, error } = planOutreachStepCompletion({
      enrollment: fresh,
      sequence,
      mailbox,
      completedAtMs: sentAtMs,
      sent: { messageId: '<step-1@example.org>', threadId: 'thread-1', subject: 'Your client sites' },
      random: middle,
    })
    expect(error).toBeNull()
    expect(patch).toEqual({
      status: 'active',
      stepIndex: 1,
      // +3 business days: Thursday 10:00.
      nextDueAtMs: at('2026-09-17T15:00:00Z'),
      lastSentAtMs: sentAtMs,
      gmailThreadId: 'thread-1',
      gmailThreadIds: ['thread-1'],
      threadSubject: 'Your client sites',
      messageIds: ['<step-1@example.org>'],
    })
  })

  it('adds a reply to the thread without restarting it', () => {
    const { patch } = planOutreachStepCompletion({
      enrollment: {
        ...fresh,
        stepIndex: 1,
        gmailThreadId: 'thread-1',
        gmailThreadIds: ['thread-1'],
        messageIds: ['<step-1@example.org>'],
        threadSubject: 'Your client sites',
      },
      sequence,
      mailbox,
      completedAtMs: sentAtMs,
      sent: { messageId: '<step-2@example.org>', threadId: 'thread-1', subject: 'Re: Your client sites' },
      random: middle,
    })
    expect(patch).toMatchObject({
      stepIndex: 2,
      messageIds: ['<step-1@example.org>', '<step-2@example.org>'],
      gmailThreadIds: ['thread-1'],
    })
    expect(patch).not.toHaveProperty('threadSubject')
  })

  it('advances past a task without touching the thread', () => {
    const { patch } = planOutreachStepCompletion({
      enrollment: { ...fresh, stepIndex: 2, gmailThreadId: 'thread-1', gmailThreadIds: ['thread-1'], messageIds: ['<a@example.org>'], threadSubject: 'Hi' },
      sequence,
      mailbox,
      completedAtMs: sentAtMs,
      random: middle,
    })
    expect(patch).toEqual({
      status: 'active',
      stepIndex: 3,
      nextDueAtMs: at('2026-09-23T15:00:00Z'),
      lastSentAtMs: sentAtMs,
    })
  })

  it('starts a new thread for a step that asks for one, remembering the old thread for reply sync', () => {
    const { patch } = planOutreachStepCompletion({
      enrollment: { ...fresh, stepIndex: 3, gmailThreadId: 'thread-1', gmailThreadIds: ['thread-1'], messageIds: ['<a@example.org>', '<b@example.org>'], threadSubject: 'Your client sites' },
      sequence,
      mailbox,
      completedAtMs: sentAtMs,
      sent: { messageId: '<step-4@example.org>', threadId: 'thread-2', subject: 'Closing the loop' },
      random: middle,
    })
    expect(patch).toEqual({
      status: 'finished',
      stepIndex: 4,
      nextDueAtMs: null,
      lastSentAtMs: sentAtMs,
      gmailThreadId: 'thread-2',
      gmailThreadIds: ['thread-1', 'thread-2'],
      threadSubject: 'Closing the loop',
      messageIds: ['<step-4@example.org>'],
    })
  })

  it('refuses what cannot be recorded', () => {
    expect(
      planOutreachStepCompletion({ enrollment: { ...fresh, status: 'paused' }, sequence, mailbox, completedAtMs: sentAtMs, random: middle }).error,
    ).toBe('Only an active enrollment runs its steps.')
    expect(
      planOutreachStepCompletion({ enrollment: { ...fresh, stepIndex: 9 }, sequence, mailbox, completedAtMs: sentAtMs, random: middle }).error,
    ).toBe('This enrollment has no step at its position.')
    expect(
      planOutreachStepCompletion({ enrollment: fresh, sequence, mailbox, completedAtMs: sentAtMs, sent: null, random: middle }).error,
    ).toBe('An email step needs the sent message and thread ids.')
  })

  it('records the send but says so when the next step cannot be placed', () => {
    const { patch, error } = planOutreachStepCompletion({
      enrollment: fresh,
      sequence,
      mailbox: { timezone: CHICAGO, window: { days: [], startMinute: 540, endMinute: 1020 } },
      completedAtMs: sentAtMs,
      sent: { messageId: '<step-1@example.org>', threadId: 'thread-1', subject: 'Your client sites' },
      random: middle,
    })
    expect(patch).toMatchObject({ stepIndex: 1, nextDueAtMs: null, messageIds: ['<step-1@example.org>'] })
    expect(error).toBe("The next step couldn't be scheduled: check the sending window and the mailbox's timezone.")
  })
})
