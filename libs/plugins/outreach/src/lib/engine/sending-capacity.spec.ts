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
  OutreachMailbox,
  OutreachSendWindow,
  OutreachTaskStep,
} from '../model/outreach.types'
import {
  OUTREACH_DAILY_CAP_MAX,
  outreachDailyCap,
  outreachRampCap,
  outreachSentToday,
  outreachTickAllowance,
  type OutreachDueCandidate,
  selectDueOutreachEnrollments,
} from './sending-capacity'

const CHICAGO = 'America/Chicago'
const at = (iso: string) => Date.parse(iso)
const OFFICE: OutreachSendWindow = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 }

type TickMailbox = Pick<
  OutreachMailbox,
  'id' | 'status' | 'dailyCap' | 'rampStartedAtMs' | 'timezone' | 'window' | 'health'
>

const mailbox = (overrides: Partial<TickMailbox> = {}): TickMailbox => ({
  id: 'mailbox-1',
  status: 'connected',
  dailyCap: 30,
  rampStartedAtMs: null,
  timezone: CHICAGO,
  window: OFFICE,
  health: {
    sentToday: 0,
    sentOnDay: null,
    bounces: 0,
    replies: 0,
    lastSentAtMs: null,
    lastErrorAtMs: null,
    lastErrorCode: null,
  },
  ...overrides,
})

describe('the warm-up ramp', () => {
  // The ramp began Monday 2026-09-07 at 16:00 CDT.
  const rampStart = at('2026-09-07T21:00:00Z')

  it('allows 10 a day in week one, 20 in week two, 30 from week three on', () => {
    expect(outreachRampCap(rampStart, rampStart, CHICAGO)).toBe(10)
    // Sunday 2026-09-13, day seven of week one, late evening.
    expect(outreachRampCap(rampStart, at('2026-09-14T04:30:00Z'), CHICAGO)).toBe(10)
    // Monday 2026-09-14, the first day of week two — however few hours in.
    expect(outreachRampCap(rampStart, at('2026-09-14T05:30:00Z'), CHICAGO)).toBe(20)
    expect(outreachRampCap(rampStart, at('2026-09-21T15:00:00Z'), CHICAGO)).toBe(30)
    expect(outreachRampCap(rampStart, at('2027-01-01T15:00:00Z'), CHICAGO)).toBe(30)
  })

  it('counts days on the mailbox calendar, so a week stays seven days across a clock change', () => {
    // Started Monday 2026-10-26; the clocks fall back on Sunday 11-01.
    const autumn = at('2026-10-26T14:00:00Z')
    expect(outreachRampCap(autumn, at('2026-11-02T05:30:00Z'), CHICAGO)).toBe(10)
    expect(outreachRampCap(autumn, at('2026-11-02T06:30:00Z'), CHICAGO)).toBe(20)
  })

  it('is not running without a start, and reads a start in the future as week one', () => {
    expect(outreachRampCap(null, rampStart, CHICAGO)).toBeNull()
    expect(outreachRampCap(undefined, rampStart, CHICAGO)).toBeNull()
    expect(outreachRampCap(rampStart + 30 * 86_400_000, rampStart, CHICAGO)).toBe(10)
  })
})

describe('the daily cap', () => {
  const now = at('2026-09-15T15:00:00Z')

  it('is the least of the configured cap, the ramp and the ceiling', () => {
    const rampStartedAtMs = at('2026-09-14T15:00:00Z')
    expect(outreachDailyCap({ configuredCap: 30, rampStartedAtMs, nowMs: now, timeZone: CHICAGO })).toBe(10)
    expect(outreachDailyCap({ configuredCap: 5, rampStartedAtMs, nowMs: now, timeZone: CHICAGO })).toBe(5)
    expect(outreachDailyCap({ configuredCap: 40, rampStartedAtMs: null, nowMs: now, timeZone: CHICAGO })).toBe(40)
  })

  it(`never exceeds ${OUTREACH_DAILY_CAP_MAX}, whatever is configured`, () => {
    expect(outreachDailyCap({ configuredCap: 500, rampStartedAtMs: null, nowMs: now, timeZone: CHICAGO })).toBe(50)
  })

  it('reads a cap that is not a count as nothing', () => {
    expect(outreachDailyCap({ configuredCap: Number.NaN, rampStartedAtMs: null, nowMs: now, timeZone: CHICAGO })).toBe(0)
    expect(outreachDailyCap({ configuredCap: -4, rampStartedAtMs: null, nowMs: now, timeZone: CHICAGO })).toBe(0)
    expect(outreachDailyCap({ configuredCap: 12.9, rampStartedAtMs: null, nowMs: now, timeZone: CHICAGO })).toBe(12)
  })
})

describe('sent today', () => {
  it("counts only a counter that belongs to today in the mailbox's zone", () => {
    const now = at('2026-09-15T03:00:00Z') // Monday 22:00 in Chicago.
    expect(outreachSentToday({ sentToday: 7, sentOnDay: '2026-09-14' }, now, CHICAGO)).toBe(7)
    expect(outreachSentToday({ sentToday: 7, sentOnDay: '2026-09-15' }, now, CHICAGO)).toBe(0)
    expect(outreachSentToday({ sentToday: 7, sentOnDay: null }, now, CHICAGO)).toBe(0)
    expect(outreachSentToday(null, now, CHICAGO)).toBe(0)
  })
})

describe('the per-run allowance', () => {
  // Tuesday 2026-09-15 at 09:00 CDT: eight hours, 32 runs, left in the window.
  const opening = at('2026-09-15T14:00:00Z')

  it('spreads the day across the runs left in the window', () => {
    expect(outreachTickAllowance({ mailbox: mailbox(), nowMs: opening })).toEqual({
      allowance: 1,
      dailyCap: 30,
      sentToday: 0,
      remainingToday: 30,
      hold: null,
    })
    // 16:00 with 30 left: four runs remain, so eight a run, held to five.
    expect(outreachTickAllowance({ mailbox: mailbox(), nowMs: at('2026-09-15T21:00:00Z') }).allowance).toBe(5)
    // 16:00 with 6 left: two a run.
    expect(
      outreachTickAllowance({
        mailbox: mailbox({ health: { ...mailbox().health, sentToday: 24, sentOnDay: '2026-09-15' } }),
        nowMs: at('2026-09-15T21:00:00Z'),
      }),
    ).toMatchObject({ allowance: 2, sentToday: 24, remainingToday: 6 })
  })

  it('holds a mailbox that reached its cap, or cannot send at all', () => {
    const spent = mailbox({ health: { ...mailbox().health, sentToday: 30, sentOnDay: '2026-09-15' } })
    expect(outreachTickAllowance({ mailbox: spent, nowMs: opening })).toMatchObject({
      allowance: 0,
      hold: 'daily_cap_reached',
    })
    for (const status of ['paused', 'reconnect_required', 'disconnected'] as const) {
      expect(outreachTickAllowance({ mailbox: mailbox({ status }), nowMs: opening })).toMatchObject({
        allowance: 0,
        hold: 'mailbox_not_connected',
      })
    }
    expect(outreachTickAllowance({ mailbox: mailbox({ timezone: 'Nowhere/Special' }), nowMs: opening })).toMatchObject({
      allowance: 0,
      hold: 'invalid_timezone',
    })
  })

  it('applies the ramp', () => {
    const young = mailbox({
      rampStartedAtMs: at('2026-09-14T15:00:00Z'),
      health: { ...mailbox().health, sentToday: 10, sentOnDay: '2026-09-15' },
    })
    expect(outreachTickAllowance({ mailbox: young, nowMs: opening })).toMatchObject({
      allowance: 0,
      dailyCap: 10,
      hold: 'daily_cap_reached',
    })
  })

  it("is paced only by the per-run maximum while the mailbox's own window is closed", () => {
    // Saturday: a sequence with a weekend window of its own may still be due.
    expect(outreachTickAllowance({ mailbox: mailbox(), nowMs: at('2026-09-19T15:00:00Z') }).allowance).toBe(5)
    expect(
      outreachTickAllowance({ mailbox: mailbox(), nowMs: opening, perTickMax: 2, paceWindow: null }).allowance,
    ).toBe(2)
  })
})

describe('which due enrollments run', () => {
  const now = at('2026-09-15T15:00:00Z') // Tuesday 10:00 CDT.
  const firstEmail: OutreachEmailStep = {
    id: 's1',
    kind: 'email',
    delayBusinessDays: 0,
    subject: 'Hello',
    replyInThread: false,
    body: 'Hi',
    templateId: null,
  }
  const followUp: OutreachEmailStep = { ...firstEmail, id: 's2', subject: '', replyInThread: true, delayBusinessDays: 3 }
  const linkedIn: OutreachTaskStep = { id: 's3', kind: 'task', taskKind: 'linkedin', title: 'Connect', delayBusinessDays: 0 }
  const steps = [firstEmail, followUp, linkedIn, { ...followUp, id: 's4' }]

  const sequence = (overrides: Partial<OutreachDueCandidate['sequence']> = {}): OutreachDueCandidate['sequence'] => ({
    id: 'sequence-1',
    status: 'active',
    steps,
    settings: { window: null, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, listUnsubscribe: false },
    ...overrides,
  })

  const candidate = (
    id: string,
    stepIndex: number,
    nextDueAtMs: number | null,
    overrides: Partial<OutreachDueCandidate['enrollment']> = {},
    sequenceOverrides: Partial<OutreachDueCandidate['sequence']> = {},
  ): OutreachDueCandidate => ({
    enrollment: {
      id,
      status: 'active',
      nextDueAtMs,
      stepIndex,
      email: `${id}@example.com`,
      mailboxId: 'mailbox-1',
      sequenceId: 'sequence-1',
      ...overrides,
    },
    sequence: sequence(sequenceOverrides),
  })

  const ids = (list: OutreachDueCandidate[]) => list.map((entry) => entry.enrollment.id)
  const select = (candidates: OutreachDueCandidate[], allowance = 10, nowMs = now) =>
    selectDueOutreachEnrollments({ candidates, mailbox: mailbox(), nowMs, allowance })

  it('sends follow-ups before first emails, then the longest-waiting, then by id', () => {
    const result = select([
      candidate('first-new', 0, now - 60_000),
      candidate('first-old', 0, now - 3_600_000),
      candidate('follow-b', 1, now - 60_000),
      candidate('follow-a', 1, now - 60_000),
      candidate('follow-old', 3, now - 7_200_000),
    ])
    expect(ids(result.emails)).toEqual(['follow-old', 'follow-a', 'follow-b', 'first-old', 'first-new'])
  })

  it('stops at the allowance and defers the rest', () => {
    const result = select(
      [candidate('a', 0, now - 3), candidate('b', 0, now - 2), candidate('c', 0, now - 1)],
      2,
    )
    expect(ids(result.emails)).toEqual(['a', 'b'])
    expect(ids(result.deferred)).toEqual(['c'])
  })

  it('never emails one address twice in a run', () => {
    const result = select([
      candidate('a', 1, now - 5, { email: 'casey@example.com' }),
      candidate('b', 0, now - 9, { email: ' CASEY@example.com' }),
    ])
    expect(ids(result.emails)).toEqual(['a'])
    expect(ids(result.deferred)).toEqual(['b'])
  })

  it('runs due tasks without spending the allowance', () => {
    const result = select([candidate('task-late', 2, now - 10), candidate('email', 0, now - 5)], 0)
    expect(ids(result.tasks)).toEqual(['task-late'])
    expect(ids(result.emails)).toEqual([])
    expect(ids(result.deferred)).toEqual(['email'])
  })

  it('skips what is not due, not active, not this mailbox, or outside its window', () => {
    const result = select([
      candidate('future', 0, now + 60_000),
      candidate('no-time', 0, null),
      candidate('paused', 0, now - 1, { status: 'paused' }),
      candidate('other-mailbox', 0, now - 1, { mailboxId: 'mailbox-2' }),
      candidate('sequence-paused', 0, now - 1, {}, { status: 'paused' }),
      candidate('mismatched', 0, now - 1, { sequenceId: 'sequence-2' }),
      candidate('past-last-step', 9, now - 1),
      candidate('weekend-only', 0, now - 1, {}, { settings: { window: { days: [0, 6], startMinute: 540, endMinute: 1020 }, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, listUnsubscribe: false } }),
      candidate('due', 0, now - 1),
    ])
    expect(ids(result.emails)).toEqual(['due'])
    expect(result.tasks).toEqual([])
    expect(result.deferred).toEqual([])
  })

  it("sends a sequence's own window when the mailbox's is closed", () => {
    const saturday = at('2026-09-19T15:00:00Z')
    const weekend = { window: { days: [6], startMinute: 540, endMinute: 1020 }, allowedCountries: ['US'], allowCustomers: false, trackClicks: false, listUnsubscribe: false }
    const result = select(
      [candidate('weekend', 0, saturday - 1, {}, { settings: weekend }), candidate('weekday', 0, saturday - 1)],
      10,
      saturday,
    )
    expect(ids(result.emails)).toEqual(['weekend'])
  })
})
