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

import { outreachClickCountLabel, outreachClickSummary } from './enrollment-engagement'
import {
  outreachActionHistoryRow,
  outreachClickHistoryRow,
  outreachHistoryEntryId,
  readOutreachHistoryEntry,
} from './enrollment-history'
import {
  outreachEnrollmentFigures,
  outreachEnrollmentTimeline,
  outreachStepName,
  type OutreachTimelineInput,
} from './enrollment-timeline'
import type {
  OutreachEnrollment,
  OutreachEnrollmentHistoryEntry,
  OutreachSequenceStep,
} from './outreach.types'

/**
 * ONE PERSON'S HISTORY (AGL-3332): what the detail view's timeline says,
 * built from the enrollment and its history rows — and what it refuses to
 * say, which is anything the stored record does not hold.
 */

const steps: OutreachSequenceStep[] = [
  { id: 'a', kind: 'email', delayBusinessDays: 0, subject: 'Hi', replyInThread: false, body: 'Hi', templateId: null },
  { id: 'b', kind: 'task', taskKind: 'call', title: 'Call them', delayBusinessDays: 1 },
  { id: 'c', kind: 'email', delayBusinessDays: 3, subject: '', replyInThread: true, body: 'Again', templateId: null },
]

const T = Date.parse('2026-09-24T15:30:00Z')
const MIN = 60_000

const enrollment = (overrides: Partial<OutreachEnrollment> = {}): OutreachEnrollment =>
  ({
    id: 'seq-1_c-1',
    sequenceId: 'seq-1',
    target: 'contact',
    contactId: 'c-1',
    leadId: null,
    contactName: 'Keith Example',
    email: 'keith@example.com',
    hostId: 'host-1',
    mailboxId: 'mbx-1',
    stepIndex: 1,
    nextDueAtMs: T + 86_400_000,
    status: 'active',
    stopReason: null,
    stopDetail: null,
    stoppedAtMs: null,
    stoppedByUid: null,
    personalLine: '',
    cold: false,
    attestations: {},
    enrolledByUid: 'uid-zach',
    gmailThreadId: 'thread-1',
    gmailThreadIds: ['thread-1'],
    threadSubject: 'Hi',
    messageIds: [],
    lastSentAtMs: T,
    createdAtMs: T - 60 * MIN,
    updatedAtMs: T,
    stepRecords: [
      { stepIndex: 0, stepId: 'a', kind: 'email', atMs: T, subject: 'Hi Keith', gmailThreadId: 'thread-1', links: ['https://calendar.example.com/book'] },
    ],
    ...overrides,
  }) as OutreachEnrollment

const build = (overrides: Partial<OutreachTimelineInput> = {}) =>
  outreachEnrollmentTimeline({
    enrollment: enrollment(),
    steps,
    history: [],
    memberName: (uid) => (uid === 'uid-zach' ? 'Zach' : uid === 'uid-lynn' ? 'Lynn' : 'a member'),
    formatTime: (ms) => `t+${Math.round((ms - T) / MIN)}m`,
    ...overrides,
  })

const click = (id: string, atMs: number, fields: Partial<OutreachEnrollmentHistoryEntry> = {}) =>
  ({ id, kind: 'click', atMs, url: 'https://calendar.example.com/book', stepIndex: 0, human: true, machineReason: null, ...fields }) as OutreachEnrollmentHistoryEntry

describe('the timeline: what happened, newest first', () => {
  it('lists the enrollment, and each send with its subject and the thread it started', () => {
    const entries = build()
    expect(entries.map((entry) => entry.kind)).toEqual(['sent', 'enrolled'])
    expect(entries[0]).toMatchObject({
      title: 'Email 1 · step 1 sent',
      detail: 'Subject: Hi Keith',
      facts: ['1 tracked link'],
      gmailThreadId: 'thread-1',
    })
    expect(entries[1]).toMatchObject({ title: 'Enrolled', facts: ['By Zach', 'As a contact'] })
  })

  it('names a curated send, and links only the email that started a thread', () => {
    const entries = build({
      enrollment: enrollment({
        stepRecords: [
          { stepIndex: 0, stepId: 'a', kind: 'email', atMs: T, gmailThreadId: 'thread-1' },
          { stepIndex: 1, stepId: 'b', kind: 'task', atMs: T + MIN, taskId: 't-1' },
          { stepIndex: 2, stepId: 'c', kind: 'email', atMs: T + 2 * MIN, gmailThreadId: 'thread-1', curated: 'ai' },
        ],
      }),
    })
    const [second, task, first] = entries
    expect(second).toMatchObject({ title: 'Email 2 · step 3 sent', gmailThreadId: null, facts: ['Curated copy — AI draft'] })
    expect(task).toMatchObject({ kind: 'task', title: 'Call task filed', detail: 'Call them' })
    expect(first).toMatchObject({ gmailThreadId: 'thread-1' })
  })

  it('lists each click from the history with its destination and step, a scanner’s with why', () => {
    const entries = build({
      enrollment: enrollment({
        engagement: { clicks: 1, firstClickAtMs: T + 5 * MIN, lastClickAtMs: T + 5 * MIN, lastClickUrl: 'https://calendar.example.com/book', machineClicks: 1, links: ['https://calendar.example.com/book'], loggedClicks: 1, loggedMachineClicks: 1 },
      }),
      history: [
        click('h2', T + 5 * MIN),
        click('h1', T + 10_000, { human: false, machineReason: 'too_soon' }),
      ],
    })
    expect(entries.slice(0, 2)).toMatchObject([
      { kind: 'click', title: 'Clicked a link', url: 'https://calendar.example.com/book', facts: ['From Email 1 · step 1'], tone: 'success' },
      { kind: 'scanner', title: 'A scanner followed a link — not counted', facts: ['From Email 1 · step 1', expect.stringMatching(/^Read as a scanner: it came within 30 seconds/)] },
    ])
    // Every click has its row, so nothing is summarized.
    expect(entries.some((entry) => entry.kind === 'earlier-clicks')).toBe(false)
  })

  it('says clicks from before the history as ONE honest line, never a row apiece', () => {
    // Keith's case: two clicks counted before each was recorded on its own.
    const entries = build({
      enrollment: enrollment({
        engagement: { clicks: 2, firstClickAtMs: T + MIN, lastClickAtMs: T + MIN, lastClickUrl: 'https://calendar.example.com/book', machineClicks: 0 },
      }),
    })
    const earlier = entries.filter((entry) => entry.kind === 'earlier-clicks')
    expect(earlier).toHaveLength(1)
    expect(earlier[0]).toMatchObject({
      atMs: T + MIN,
      title: '2 earlier clicks, kept as a total',
      url: 'https://calendar.example.com/book',
      urlLabel: 'Last link',
      facts: ['First and last at t+1m'],
    })
    expect(entries.some((entry) => entry.kind === 'click')).toBe(false)
  })

  it('claims no last link for the early clicks once later ones have rows of their own', () => {
    const entries = build({
      enrollment: enrollment({
        engagement: { clicks: 3, firstClickAtMs: T + MIN, lastClickAtMs: T + 9 * MIN, lastClickUrl: 'https://aglyn.com/pricing', machineClicks: 0, links: ['https://aglyn.com/pricing'], loggedClicks: 1, loggedMachineClicks: 0 },
      }),
      history: [click('h1', T + 9 * MIN, { url: 'https://aglyn.com/pricing' })],
    })
    const earlier = entries.find((entry) => entry.kind === 'earlier-clicks')
    expect(earlier).toMatchObject({ title: '2 earlier clicks, kept as a total', url: null, facts: ['First at t+1m'] })
  })

  it('shows a bounce with the whole diagnostic and the gateway in front of the domain', () => {
    const detail = 'The mail gateway at example.com blocked the email. The server said: 550 permanent failure'
    const entries = build({
      enrollment: enrollment({ status: 'bounced', stopReason: 'hard_bounce', stopDetail: detail, stoppedAtMs: T + 2 * MIN, nextDueAtMs: null }),
      gateway: 'barracuda',
    })
    expect(entries[0]).toMatchObject({
      kind: 'bounced',
      title: 'Bounced',
      detail,
      facts: ['Their mail gateway: Barracuda', 'The address is on the do-not-contact list'],
      tone: 'error',
    })
  })

  it('says a member stopped it, who, and the whole reason', () => {
    const entries = build({
      enrollment: enrollment({ status: 'stopped', stopReason: 'manual', stopDetail: 'Asked on a call to hold off until Q1', stoppedAtMs: T + 3 * MIN, stoppedByUid: 'uid-lynn', nextDueAtMs: null }),
    })
    expect(entries[0]).toMatchObject({
      kind: 'stopped',
      title: 'Stopped by a member',
      detail: 'Asked on a call to hold off until Q1',
      facts: ['By Lynn'],
    })
  })

  it('keeps a pause that was resumed, from the history, and never says a stop twice', () => {
    const history: OutreachEnrollmentHistoryEntry[] = [
      { id: 'a3', kind: 'action', atMs: T + 30 * MIN, action: 'stop', byUid: 'uid-lynn', detail: 'Not a fit' },
      { id: 'a2', kind: 'action', atMs: T + 20 * MIN, action: 'resume', byUid: 'uid-zach', detail: null },
      { id: 'a1', kind: 'action', atMs: T + 10 * MIN, action: 'pause', byUid: 'uid-zach', detail: 'Out of office' },
    ]
    const entries = build({
      enrollment: enrollment({ status: 'stopped', stopReason: 'manual', stopDetail: 'Not a fit', stoppedAtMs: T + 30 * MIN, stoppedByUid: 'uid-lynn', nextDueAtMs: null }),
      history,
    })
    expect(entries.slice(0, 3).map((entry) => [entry.title, entry.detail ?? null, entry.facts])).toEqual([
      ['Stopped by a member', 'Not a fit', ['By Lynn']],
      ['Resumed', null, ['By Zach']],
      ['Paused', 'Out of office', ['By Zach']],
    ])
    expect(entries.filter((entry) => entry.kind === 'stopped')).toHaveLength(1)
  })

  it('shows a gateway hold and the member who sent it anyway, once each', () => {
    const entries = build({
      enrollment: enrollment({
        gatewayHold: { gateway: 'barracuda', heldAtMs: T + 10 * MIN, releasedByUid: 'uid-zach', releasedAtMs: T + 20 * MIN },
      }),
      history: [{ id: 'a1', kind: 'action', atMs: T + 20 * MIN, action: 'resume', byUid: 'uid-zach', detail: null }],
    })
    expect(entries.slice(0, 2)).toMatchObject([
      { kind: 'released', title: 'Resumed past the Barracuda hold — sent anyway', facts: ['By Zach'] },
      { kind: 'held', title: 'Held — Barracuda refused this sender' },
    ])
    expect(entries.some((entry) => entry.kind === 'resumed')).toBe(false)
  })

  it('names a reply, with the thread to open', () => {
    const entries = build({
      enrollment: enrollment({ status: 'replied', stopReason: 'reply', stoppedAtMs: T + 40 * MIN, nextDueAtMs: null }),
    })
    expect(entries[0]).toMatchObject({ kind: 'replied', title: 'Replied', gmailThreadId: 'thread-1' })
  })
})

describe('the five figures', () => {
  it('counts sends, clicks, links, scanners and replies — and knows when nothing happened', () => {
    expect(outreachEnrollmentFigures(enrollment({ stepRecords: [], lastSentAtMs: null }))).toMatchObject({
      emailsSent: 0,
      clicks: 0,
      anything: false,
    })
    expect(
      outreachEnrollmentFigures(
        enrollment({
          status: 'replied',
          stopReason: 'reply',
          stoppedAtMs: T,
          engagement: { clicks: 2, firstClickAtMs: T, lastClickAtMs: T, lastClickUrl: 'https://a.example.com', machineClicks: 3 },
        }),
      ),
    ).toEqual({
      emailsSent: 1,
      clicks: 2,
      // Two clicks from before the history: one link at least, not a claim of one.
      linksFollowed: { count: 1, atLeast: true },
      scannerClicks: 3,
      replies: 1,
      anything: true,
    })
  })
})

describe('the Clicks cell', () => {
  it('counts clicks and distinct links when both are known, and the clicks alone when not', () => {
    expect(outreachClickCountLabel(outreachClickSummary(undefined))).toBe('—')
    expect(
      outreachClickCountLabel(
        outreachClickSummary({ clicks: 2, lastClickUrl: 'https://a.example.com', links: ['https://a.example.com'], loggedClicks: 2 }),
      ),
    ).toBe('2 · 1 link')
    expect(
      outreachClickCountLabel(outreachClickSummary({ clicks: 1, lastClickUrl: 'https://a.example.com' })),
    ).toBe('1 · 1 link')
    expect(
      outreachClickCountLabel(outreachClickSummary({ clicks: 4, lastClickUrl: 'https://a.example.com' })),
    ).toBe('4')
  })
})

describe('the history rows, as written and read back', () => {
  it('round-trips a click and a member’s act, and drops what it cannot place', () => {
    const clickRow = outreachClickHistoryRow({ atMs: T, url: 'https://a.example.com', stepIndex: 2, human: true, machineReason: 'agent' })
    expect(readOutreachHistoryEntry('h1', clickRow)).toEqual({
      id: 'h1',
      kind: 'click',
      atMs: T,
      url: 'https://a.example.com',
      stepIndex: 2,
      human: true,
      // A person's click carries no scanner reason, whatever it was handed.
      machineReason: null,
    })
    const actionRow = outreachActionHistoryRow({ atMs: T, action: 'pause', byUid: 'uid-zach', detail: '  Out  of office ' })
    expect(readOutreachHistoryEntry('h2', actionRow)).toMatchObject({ kind: 'action', action: 'pause', detail: 'Out of office' })
    expect(readOutreachHistoryEntry('h3', { kind: 'click' })).toBeNull()
    expect(readOutreachHistoryEntry('h4', { kind: 'action', atMs: T, action: 'delete' })).toBeNull()
    expect(readOutreachHistoryEntry('h5', undefined)).toBeNull()
  })

  it('mints ids that sort by time and differ within one millisecond', () => {
    const sequence = [0.1, 0.9]
    const a = outreachHistoryEntryId(T, () => sequence.shift() ?? 0)
    const b = outreachHistoryEntryId(T, () => sequence.shift() ?? 0)
    expect(a).not.toBe(b)
    expect(outreachHistoryEntryId(T - 1, () => 0.5) < a).toBe(true)
  })
})

describe('step names', () => {
  it('names an email by its place among the emails, a task by its kind, and a step the sequence lost by its number', () => {
    expect(outreachStepName(steps, 0)).toBe('Email 1 · step 1')
    expect(outreachStepName(steps, 1)).toBe('Step 2 · Call')
    expect(outreachStepName(steps, 2)).toBe('Email 2 · step 3')
    expect(outreachStepName(steps, 7)).toBe('Step 8')
  })
})
