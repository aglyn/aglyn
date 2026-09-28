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
/**
 * @jest-environment node
 */

import type {
  OutreachMailbox,
  OutreachSendWindow,
  OutreachSequence,
  OutreachSequenceStep,
} from '../model/outreach.types'
import { outreachNextSendState, type OutreachNextSendInput } from './next-send'

const CHICAGO = 'America/Chicago'
const at = (iso: string) => Date.parse(iso)
const WINDOW: OutreachSendWindow = { days: [1, 2, 3, 4, 5], startMinute: 8 * 60, endMinute: 17 * 60 }

// Monday 2026-09-28, 09:10 CDT: the morning six first emails due 08:09–08:43
// were still waiting behind the day's pacing.
const NOW = at('2026-09-28T14:10:00Z')
const DUE = at('2026-09-28T13:09:00Z')

const steps: OutreachSequenceStep[] = [
  { id: 'a', kind: 'email', delayBusinessDays: 0, subject: 'Hi', replyInThread: false, body: 'Hi', templateId: null },
  { id: 'b', kind: 'task', taskKind: 'call', title: 'Call', delayBusinessDays: 1 },
]

type Mailbox = NonNullable<OutreachNextSendInput['mailbox']>
const mailbox = (overrides: Partial<Mailbox> = {}): Mailbox => ({
  status: 'connected',
  dailyCap: 30,
  rampStartedAtMs: null,
  timezone: CHICAGO,
  window: WINDOW,
  health: {
    sentToday: 10,
    sentOnDay: '2026-09-28',
    bounces: 0,
    replies: 0,
    lastSentAtMs: null,
    lastErrorAtMs: null,
    lastErrorCode: null,
  } as OutreachMailbox['health'],
  ...overrides,
})

const sequence = (
  overrides: Partial<Pick<OutreachSequence, 'status' | 'steps' | 'settings'>> = {},
) => ({ status: 'active', steps, settings: {}, ...overrides }) as Pick<OutreachSequence, 'status' | 'steps' | 'settings'>

const state = (overrides: Partial<OutreachNextSendInput> = {}, enrollment: Partial<OutreachNextSendInput['enrollment']> = {}) =>
  outreachNextSendState({
    enrollment: { status: 'active', nextDueAtMs: DUE, stopReason: null, stepIndex: 0, ...enrollment },
    sequence: sequence(),
    mailbox: mailbox(),
    nowMs: NOW,
    ...overrides,
  })

describe('an enrollment’s next send (AGL-3366)', () => {
  it('is its time while the time is still ahead, and for a paused one', () => {
    expect(state({}, { nextDueAtMs: at('2026-09-28T15:00:00Z') })).toEqual({
      kind: 'scheduled',
      dueAtMs: at('2026-09-28T15:00:00Z'),
    })
    expect(state({}, { status: 'paused' })).toEqual({ kind: 'scheduled', dueAtMs: DUE })
  })

  it('is nothing for a finished or stopped enrollment, or one with no time', () => {
    expect(state({}, { status: 'finished' })).toEqual({ kind: 'none' })
    expect(state({}, { status: 'stopped' })).toEqual({ kind: 'none' })
    expect(state({}, { nextDueAtMs: null })).toEqual({ kind: 'none' })
  })

  it('is queued behind pacing once due inside an open window, with the run’s allowance', () => {
    // 20 left over 32 runs to 17:00: one this run.
    expect(state()).toEqual({
      kind: 'queued',
      dueAtMs: DUE,
      reason: 'paced',
      opensAtMs: null,
      pacing: { allowance: 1, dailyCap: 30, sentToday: 10 },
    })
  })

  it('is queued without figures while the mailbox is still loading', () => {
    expect(state({ mailbox: undefined })).toMatchObject({ kind: 'queued', reason: 'paced', pacing: null })
  })

  it('is held, not queued, when the mailbox or the sequence is not sending', () => {
    expect(state({ mailbox: null })).toMatchObject({ reason: 'mailbox_not_sending' })
    expect(state({ mailbox: mailbox({ status: 'paused' }) })).toMatchObject({ reason: 'mailbox_not_sending' })
    expect(state({ sequence: sequence({ status: 'paused' }) })).toMatchObject({ reason: 'sequence_not_active' })
  })

  it('waits for the next run on a task step, which spends no allowance', () => {
    expect(state({}, { stepIndex: 1 })).toMatchObject({ reason: 'next_run', pacing: null })
  })

  it('waits for the window, and says when it opens', () => {
    // Monday 18:00 CDT: the window opens Tuesday 08:00 CDT.
    expect(state({ nowMs: at('2026-09-28T23:00:00Z') })).toMatchObject({
      reason: 'window_closed',
      opensAtMs: at('2026-09-29T13:00:00Z'),
    })
  })

  it('reads the sequence’s own window over the mailbox’s', () => {
    const evenings: OutreachSendWindow = { days: [1, 2, 3, 4, 5], startMinute: 17 * 60, endMinute: 20 * 60 }
    expect(
      state({ nowMs: at('2026-09-28T23:00:00Z'), sequence: sequence({ settings: { window: evenings } as OutreachSequence['settings'] }) }),
    ).toMatchObject({ reason: 'paced' })
  })

  it('waits for the next day’s window once today’s cap is spent — over a weekend too', () => {
    const spent = mailbox({ health: { ...mailbox().health, sentToday: 30 } })
    expect(state({ mailbox: spent })).toMatchObject({
      reason: 'daily_cap_reached',
      opensAtMs: at('2026-09-29T13:00:00Z'),
      pacing: { allowance: 0, dailyCap: 30, sentToday: 30 },
    })
    // Friday 2026-10-02, 09:10 CDT: sending resumes Monday 08:00 CDT.
    const friday = mailbox({ health: { ...mailbox().health, sentToday: 30, sentOnDay: '2026-10-02' } })
    expect(
      state({ mailbox: friday, nowMs: at('2026-10-02T14:10:00Z') }, { nextDueAtMs: at('2026-10-02T13:09:00Z') }),
    ).toMatchObject({ reason: 'daily_cap_reached', opensAtMs: at('2026-10-05T13:00:00Z') })
  })
})
