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
  crmBookingFollowUpDueMs,
  crmBookingFollowUpTitle,
  crmBookingMeetingBody,
  formatCrmBookingRef,
  parseCrmBookingRef,
} from './crm-booking'

/**
 * The booking door's shared vocabulary (AGL-2660): the reference a link
 * carries survives the round trip and nothing else is taken for one, and
 * the follow-up lands on a working day.
 */

describe('the record reference a booking link carries', () => {
  it('formats and parses the three record kinds', () => {
    for (const kind of ['contact', 'lead', 'deal'] as const) {
      const wire = formatCrmBookingRef({ kind, id: 'abc_DEF-123' })
      expect(wire).toBe(`${kind}:abc_DEF-123`)
      expect(parseCrmBookingRef(wire)).toEqual({ kind, id: 'abc_DEF-123' })
    }
  })

  it('refuses an unknown kind, a malformed id, and a non-string', () => {
    expect(parseCrmBookingRef('company:abc')).toBeNull()
    expect(parseCrmBookingRef('contact:')).toBeNull()
    expect(parseCrmBookingRef('contact:a/b')).toBeNull()
    expect(parseCrmBookingRef('contact:a b')).toBeNull()
    expect(parseCrmBookingRef(':abc')).toBeNull()
    expect(parseCrmBookingRef('contact')).toBeNull()
    expect(parseCrmBookingRef(42)).toBeNull()
    expect(parseCrmBookingRef(undefined)).toBeNull()
  })
})

describe('what a booking files on the record', () => {
  // Tuesday, September 15, 2026 at 10:00 AM in Chicago (15:00Z).
  const TUESDAY_10AM_CHICAGO = Date.UTC(2026, 8, 15, 15, 0)

  it('names the service and the slot in the service timezone', () => {
    expect(
      crmBookingMeetingBody({
        serviceName: 'Intro call',
        startsAtMs: TUESDAY_10AM_CHICAGO,
        timezone: 'America/Chicago',
      }),
    ).toBe('Intro call — Tuesday, September 15, 2026 at 10:00 AM (America/Chicago)')
  })

  it('falls back to UTC for a service with no timezone', () => {
    expect(
      crmBookingMeetingBody({ serviceName: 'Intro call', startsAtMs: TUESDAY_10AM_CHICAGO }),
    ).toBe('Intro call — Tuesday, September 15, 2026 at 3:00 PM (UTC)')
  })

  it('titles the follow-up after the service', () => {
    expect(crmBookingFollowUpTitle('Intro call')).toBe('Follow up after Intro call')
    expect(crmBookingFollowUpTitle('')).toBe('Follow up after the booking')
  })
})

describe('when the follow-up falls due', () => {
  const DAY = 24 * 60 * 60 * 1000
  // Slot ends at 11:00 AM Chicago on each weekday of that week.
  const at = (dayOfMonth: number) => Date.UTC(2026, 8, dayOfMonth, 16, 0)

  it('is the next day after a Monday-to-Thursday slot', () => {
    // September 14, 2026 is a Monday.
    expect(crmBookingFollowUpDueMs(at(14), 'America/Chicago')).toBe(at(14) + DAY)
    expect(crmBookingFollowUpDueMs(at(17), 'America/Chicago')).toBe(at(17) + DAY)
  })

  it('skips the weekend after a Friday slot', () => {
    expect(crmBookingFollowUpDueMs(at(18), 'America/Chicago')).toBe(at(18) + 3 * DAY)
  })

  it('reaches Monday from a Saturday or a Sunday slot', () => {
    expect(crmBookingFollowUpDueMs(at(19), 'America/Chicago')).toBe(at(19) + 2 * DAY)
    expect(crmBookingFollowUpDueMs(at(20), 'America/Chicago')).toBe(at(20) + DAY)
  })

  it('reads the weekday in the service timezone, not the server clock', () => {
    // 11:30 PM Friday in Los Angeles is already Saturday in UTC: the slot is
    // still a Friday one and is followed up on Monday, three days on.
    const fridayLateLa = Date.UTC(2026, 8, 19, 6, 30)
    expect(crmBookingFollowUpDueMs(fridayLateLa, 'America/Los_Angeles')).toBe(
      fridayLateLa + 3 * DAY,
    )
    expect(crmBookingFollowUpDueMs(fridayLateLa, 'UTC')).toBe(fridayLateLa + 2 * DAY)
  })
})
