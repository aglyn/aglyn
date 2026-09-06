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
  buildMemberDigests,
  composeCrmDigestEmailText,
  composeCrmDigestSubject,
  composeCrmDigestSummary,
  CRM_DIGEST_LEAD_AGE_MS,
  CRM_DIGEST_LIST_MAX,
  crmDigestEntitled,
  crmDigestTaskState,
  crmDigestWindow,
  type CrmDigestLead,
  type CrmDigestTask,
  isUnworkedLead,
  leadIsForMember,
  startOfDayInZone,
  startOfNextDayInZone,
  utcDayKey,
} from './crm-digest'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('calendar days in a named zone (AGL-2619)', () => {
  it('draws the Chicago day that 13:00 UTC falls in', () => {
    // 2026-09-05 13:00Z is 08:00 CDT (UTC-5): the day runs 05:00Z..05:00Z.
    const now = Date.parse('2026-09-05T13:00:00.000Z')
    expect(new Date(startOfDayInZone(now, 'America/Chicago')).toISOString()).toBe(
      '2026-09-05T05:00:00.000Z',
    )
    expect(
      new Date(startOfNextDayInZone(now, 'America/Chicago')).toISOString(),
    ).toBe('2026-09-06T05:00:00.000Z')
  })

  it('reads the calendar date in the zone, not in UTC', () => {
    // 03:00Z on the 6th is still the evening of the 5th in Chicago.
    const lateEvening = Date.parse('2026-09-06T03:00:00.000Z')
    expect(
      new Date(startOfDayInZone(lateEvening, 'America/Chicago')).toISOString(),
    ).toBe('2026-09-05T05:00:00.000Z')
  })

  it('survives the day a clock change falls in', () => {
    // 2026-11-01 is the CDT→CST change: the day is 25 hours long, so the
    // next midnight is 25 hours after this one, not 24.
    const changeDay = Date.parse('2026-11-01T13:00:00.000Z')
    const start = startOfDayInZone(changeDay, 'America/Chicago')
    const next = startOfNextDayInZone(changeDay, 'America/Chicago')
    expect(new Date(start).toISOString()).toBe('2026-11-01T05:00:00.000Z')
    expect(next - start).toBe(25 * HOUR)
    expect(new Date(next).toISOString()).toBe('2026-11-02T06:00:00.000Z')
  })

  it('works east of Greenwich too', () => {
    const now = Date.parse('2026-09-05T13:00:00.000Z')
    const window = crmDigestWindow(now, 'Europe/London')
    expect(new Date(window.startMs).toISOString()).toBe('2026-09-04T23:00:00.000Z')
    expect(window.endMs - window.startMs).toBe(DAY)
  })

  it('keys idempotence on the UTC day', () => {
    expect(utcDayKey(Date.parse('2026-09-05T13:00:00.000Z'))).toBe('2026-09-05')
    expect(utcDayKey(Date.parse('2026-09-05T23:59:59.000Z'))).toBe('2026-09-05')
    expect(utcDayKey(Date.parse('2026-09-06T00:00:00.000Z'))).toBe('2026-09-06')
  })
})

describe('what a digest counts', () => {
  const now = Date.parse('2026-09-05T13:00:00.000Z')
  const window = crmDigestWindow(now, 'America/Chicago')

  it('reads overdue as before today and today as inside the window', () => {
    expect(crmDigestTaskState(window.startMs - 1, window)).toBe('overdue')
    expect(crmDigestTaskState(window.startMs, window)).toBe('today')
    expect(crmDigestTaskState(now + HOUR, window)).toBe('today')
    expect(crmDigestTaskState(window.endMs - 1, window)).toBe('today')
    expect(crmDigestTaskState(window.endMs, window)).toBe('later')
  })

  it('names a lead that is new and at least two days old', () => {
    const old = now - CRM_DIGEST_LEAD_AGE_MS
    expect(isUnworkedLead({ firstSeenAtMs: old }, now)).toBe(true)
    // An absent status IS new: the capture door stamps none.
    expect(isUnworkedLead({ status: 'new', firstSeenAtMs: old - DAY }, now)).toBe(true)
    expect(isUnworkedLead({ firstSeenAtMs: old + 1 }, now)).toBe(false)
    expect(isUnworkedLead({ status: 'working', firstSeenAtMs: old }, now)).toBe(false)
    expect(isUnworkedLead({ status: 'qualified', firstSeenAtMs: old }, now)).toBe(false)
    // A lead with no sighting at all is not "older than two days".
    expect(isUnworkedLead({}, now)).toBe(false)
  })

  it('gives an owned lead to its owner and an unowned one to whoever reaches the site', () => {
    const me = { uid: 'me', reachesHost: (hostId: string) => hostId === 'site-a' }
    expect(leadIsForMember({ ownerUid: 'me', hostId: 'site-b' }, me)).toBe(true)
    expect(leadIsForMember({ ownerUid: 'you', hostId: 'site-a' }, me)).toBe(false)
    expect(leadIsForMember({ hostId: 'site-a' }, me)).toBe(true)
    expect(leadIsForMember({ hostId: 'site-b' }, me)).toBe(false)
  })

  it('reads the CRM entitlement by key and refuses an undeclared one', () => {
    expect(crmDigestEntitled({ crm: true })).toBe(true)
    expect(crmDigestEntitled({ crm: false })).toBe(false)
    expect(crmDigestEntitled({ commerce: true })).toBe(false)
    expect(crmDigestEntitled(null)).toBe(false)
  })
})

describe('buildMemberDigests', () => {
  const now = Date.parse('2026-09-05T13:00:00.000Z')
  const window = crmDigestWindow(now, 'America/Chicago')
  const task = (
    id: string,
    dueAtMs: number,
    assigneeUid: string,
    hostId = 'site-a',
  ): CrmDigestTask => ({ id, title: id, kind: 'call', dueAtMs, assigneeUid, hostId })
  const lead = (id: string, hostId: string, ownerUid?: string): CrmDigestLead => ({
    id,
    hostId,
    email: `${id}@example.com`,
    firstSeenAtMs: now - 3 * DAY,
    ...(ownerUid ? { ownerUid } : {}),
  })
  const members = [
    { uid: 'ann', reachesHost: () => true },
    { uid: 'bob', reachesHost: (hostId: string) => hostId === 'site-b' },
  ]

  it('buckets each member’s tasks by state and leads by reach, soonest first', () => {
    const digests = buildMemberDigests({
      window,
      members,
      tasks: [
        task('t-today-late', now + 2 * HOUR, 'ann'),
        task('t-overdue', window.startMs - DAY, 'ann'),
        task('t-today', now + HOUR, 'ann'),
        task('t-bob', window.startMs - 1, 'bob'),
        task('t-later', window.endMs + HOUR, 'ann'),
        task('t-nobody', now, ''),
        task('t-gone', now, 'departed'),
      ],
      leads: [lead('l-open', 'site-a'), lead('l-bobs', 'site-b'), lead('l-anns', 'site-b', 'ann')],
    })
    expect([...digests.keys()].sort()).toEqual(['ann', 'bob'])
    const ann = digests.get('ann')
    expect(ann?.overdue.map((row) => row.id)).toEqual(['t-overdue'])
    expect(ann?.today.map((row) => row.id)).toEqual(['t-today', 't-today-late'])
    // Ann reaches every site: the unowned leads on both, plus her own.
    expect(ann?.leads.map((row) => row.id)).toEqual(['l-open', 'l-bobs', 'l-anns'])
    const bob = digests.get('bob')
    expect(bob?.overdue.map((row) => row.id)).toEqual(['t-bob'])
    expect(bob?.today).toEqual([])
    // Bob reaches site-b only, and Ann's lead there is Ann's.
    expect(bob?.leads.map((row) => row.id)).toEqual(['l-bobs'])
  })

  it('has no entry for a member with nothing owed', () => {
    const digests = buildMemberDigests({
      window,
      members,
      tasks: [task('t', now, 'ann')],
      leads: [],
    })
    expect(digests.has('bob')).toBe(false)
  })
})

describe('what the digest says', () => {
  it('leaves out what is not owed and pluralizes what is', () => {
    expect(composeCrmDigestSummary({ today: 3, overdue: 2, leads: 0 })).toBe(
      '3 tasks due today, 2 overdue',
    )
    expect(composeCrmDigestSummary({ today: 1, overdue: 0, leads: 1 })).toBe(
      '1 task due today, 1 unworked lead',
    )
    expect(composeCrmDigestSummary({ today: 0, overdue: 1, leads: 4 })).toBe(
      '1 task overdue, 4 unworked leads',
    )
    expect(composeCrmDigestSubject({ today: 0, overdue: 0, leads: 2 })).toBe(
      'Your CRM today: 2 unworked leads',
    )
  })

  it('writes the email with every section, its links and the way out', () => {
    const now = Date.parse('2026-09-05T13:00:00.000Z')
    const text = composeCrmDigestEmailText({
      nowMs: now,
      timeZone: 'America/Chicago',
      productName: 'Aglyn',
      tasksUrl: 'https://app.example/acme/hosts/main/crm/tasks',
      leadsUrl: (hostId) => `https://app.example/acme/hosts/${hostId}/crm/leads`,
      settingsUrl: 'https://app.example/manage/notifications',
      hostName: (hostId) => `Site ${hostId}`,
      supportLine: '\n\nNeed help? https://help.example',
      digest: {
        overdue: [
          {
            id: 't1',
            title: 'Call Jane',
            kind: 'call',
            dueAtMs: Date.parse('2026-09-01T14:00:00.000Z'),
            assigneeUid: 'ann',
            hostId: 'main',
          },
        ],
        today: [
          {
            id: 't2',
            title: 'Send proposal',
            kind: 'email',
            dueAtMs: Date.parse('2026-09-05T20:30:00.000Z'),
            assigneeUid: 'ann',
            hostId: 'main',
          },
        ],
        leads: [
          {
            id: 'l1',
            hostId: 'main',
            email: 'jane@acme.com',
            name: 'Jane Doe',
            firstSeenAtMs: Date.parse('2026-09-02T12:00:00.000Z'),
          },
        ],
      },
    })
    expect(text).toContain(
      'Here is your Aglyn CRM for Saturday, September 5: 1 task due today, 1 overdue, 1 unworked lead.',
    )
    expect(text).toContain('Overdue (1)\n- Call Jane · Tue, Sep 1, 9:00 AM')
    expect(text).toContain('Due today (1)\n- Send proposal · Sat, Sep 5, 3:30 PM')
    expect(text).toContain(
      'Unworked leads (1)\n- Jane Doe <jane@acme.com> · Site main · first seen Sep 2',
    )
    expect(text).toContain('Open your tasks: https://app.example/acme/hosts/main/crm/tasks')
    expect(text).toContain('Leads on Site main: https://app.example/acme/hosts/main/crm/leads')
    expect(text).toContain('https://app.example/manage/notifications')
    expect(text.endsWith('Need help? https://help.example')).toBe(true)
  })

  it('caps each section and says how many it left out', () => {
    const now = Date.parse('2026-09-05T13:00:00.000Z')
    const overdue = Array.from({ length: CRM_DIGEST_LIST_MAX + 5 }, (_, index) => ({
      id: `t${index}`,
      title: `Task ${index}`,
      kind: 'todo' as const,
      dueAtMs: now - DAY - index,
      assigneeUid: 'ann',
      hostId: 'main',
    }))
    const text = composeCrmDigestEmailText({
      nowMs: now,
      timeZone: 'America/Chicago',
      productName: 'Aglyn',
      tasksUrl: 'https://app.example/tasks',
      leadsUrl: () => '',
      settingsUrl: 'https://app.example/manage/notifications',
      hostName: (hostId) => hostId,
      digest: { overdue, today: [], leads: [] },
    })
    expect(text).toContain(`Overdue (${CRM_DIGEST_LIST_MAX + 5})`)
    expect(text).toContain('  and 5 more')
    expect(text).not.toContain('Due today')
    expect(text).not.toContain('Leads on')
  })
})
