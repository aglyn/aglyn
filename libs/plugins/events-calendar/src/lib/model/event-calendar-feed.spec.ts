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

import { zonedWallTimeToInstant } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  buildIcsCalendar,
  googleCalendarLink,
  occurrenceJsonLd,
  occurrenceMatches,
  recurrenceRrule,
  type CalendarOccurrence,
} from './event-calendar-feed'
import {
  eventCategoryColorOf,
  eventCategoryIdsOf,
  eventCategoryOf,
  eventTicketOf,
  sortEventCategories,
} from './event-categories'

const ZONE = 'America/Chicago'
const START = zonedWallTimeToInstant(
  { year: 2026, month: 11, day: 5, hour: 18 },
  ZONE,
)
const HOUR = 60 * 60 * 1000

const occurrence: CalendarOccurrence = {
  id: 'evt-1:2026-11-05',
  eventId: 'evt-1',
  title: 'Thursday night training',
  startsAtMs: START,
  endsAtMs: START + 3 * HOUR,
  dayKey: '2026-11-05',
  timeZone: ZONE,
  location: 'Main track',
  description: 'Lights on, all levels.',
  coverImage: 'https://cdn.example.com/night.jpg',
  categoryIds: ['mx'],
  repeatText: 'Every week on Thursday',
  ticket: null,
}

describe('occurrenceMatches', () => {
  it('matches every word against the event and its category names', () => {
    const categories = [{ $id: 'mx', name: 'MX Training' }]
    expect(occurrenceMatches(occurrence, 'night training', categories)).toBe(
      true,
    )
    expect(occurrenceMatches(occurrence, 'mx', categories)).toBe(true)
    expect(occurrenceMatches(occurrence, 'karts', categories)).toBe(false)
    expect(occurrenceMatches(occurrence, '  ', categories)).toBe(true)
  })
})

describe('googleCalendarLink', () => {
  it('carries the title, the UTC dates and the place', () => {
    const url = new URL(
      googleCalendarLink(occurrence, 'https://park.example/events'),
    )
    expect(url.hostname).toBe('calendar.google.com')
    expect(url.searchParams.get('text')).toBe('Thursday night training')
    expect(url.searchParams.get('dates')).toBe(
      '20261106T000000Z/20261106T030000Z',
    )
    expect(url.searchParams.get('location')).toBe('Main track')
    expect(url.searchParams.get('details')).toContain(
      'https://park.example/events',
    )
  })
})

describe('recurrenceRrule', () => {
  it('writes the rule iCalendar reads', () => {
    expect(recurrenceRrule({ freq: 'weekly', weekdays: [4] })).toBe(
      'FREQ=WEEKLY;BYDAY=TH',
    )
    expect(
      recurrenceRrule({
        freq: 'weekly',
        interval: 2,
        weekdays: [0, 6],
        count: 4,
      }),
    ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;WKST=SU;COUNT=4')
    expect(
      recurrenceRrule({ freq: 'daily', untilDayKey: '2026-11-10' }, START),
    ).toBe('FREQ=DAILY;UNTIL=20261106T000000Z')
    expect(recurrenceRrule(null)).toBe('')
  })
})

describe('buildIcsCalendar', () => {
  it('writes a series on its own clock, with its rule and skipped dates', () => {
    const skipped = zonedWallTimeToInstant(
      { year: 2026, month: 11, day: 26, hour: 18 },
      ZONE,
    )
    const ics = buildIcsCalendar({
      name: 'Park, events',
      timeZone: ZONE,
      nowMs: START,
      events: [
        {
          uid: 'evt-1@host.aglyn',
          title: 'Night; training',
          startsAtMs: START,
          endsAtMs: START + 3 * HOUR,
          timeZone: ZONE,
          recurrence: { freq: 'weekly', weekdays: [4] },
          exceptStartsAtMs: [skipped],
          description: 'Line one\nLine two',
        },
        {
          uid: 'evt-2@host.aglyn',
          title: 'Race day',
          startsAtMs: START,
          endsAtMs: START + HOUR,
        },
      ],
    })
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('X-WR-CALNAME:Park\\, events')
    expect(lines).toContain('DTSTART;TZID=America/Chicago:20261105T180000')
    expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH')
    expect(lines).toContain('EXDATE;TZID=America/Chicago:20261126T180000')
    expect(lines).toContain('SUMMARY:Night\\; training')
    expect(lines).toContain('DESCRIPTION:Line one\\nLine two')
    // A one-off is written in UTC.
    expect(lines).toContain('DTSTART:20261106T000000Z')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('folds a long line at 75 octets', () => {
    const ics = buildIcsCalendar({
      name: 'x',
      nowMs: START,
      events: [
        {
          uid: 'u',
          title: 'é'.repeat(80),
          startsAtMs: START,
          endsAtMs: START + HOUR,
        },
      ],
    })
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })
})

describe('occurrenceJsonLd', () => {
  it('describes that date, with an offer only beside a ticket', () => {
    const json = occurrenceJsonLd(occurrence, {
      url: 'https://park.example/events?event=evt-1',
    })
    expect(json).toMatchObject({
      '@type': 'Event',
      name: 'Thursday night training',
      startDate: '2026-11-06T00:00:00.000Z',
      location: { '@type': 'Place', name: 'Main track' },
      image: ['https://cdn.example.com/night.jpg'],
    })
    expect(json['offers']).toBeUndefined()
    const ticketed = occurrenceJsonLd(
      {
        ...occurrence,
        coverImage: '/relative.jpg',
        ticket: {
          label: 'Get tickets',
          action: { kind: 'link', href: '/products/pass' },
        },
      },
      { offerUrl: 'https://park.example/products/pass' },
    )
    expect(ticketed['image']).toBeUndefined()
    expect(ticketed['offers']).toMatchObject({
      '@type': 'Offer',
      url: 'https://park.example/products/pass',
    })
  })
})

describe('event categories and tickets', () => {
  it('reads categories tolerantly and sorts them for the chips', () => {
    expect(
      eventCategoryOf('a', {
        name: '  Kids Camp ',
        color: '#ff00aa',
        order: 2,
      }),
    ).toEqual({
      $id: 'a',
      name: 'Kids Camp',
      color: '#FF00AA',
      order: 2,
    })
    expect(eventCategoryOf('b', { name: '' })).toBeNull()
    expect(eventCategoryOf('c', { name: 'Gone', deletedAt: 1 })).toBeNull()
    expect(eventCategoryColorOf('red')).toBeNull()
    expect(
      sortEventCategories([
        { name: 'B', order: 1 },
        { name: 'A', order: 1 },
        { name: 'Z', order: 0 },
      ]).map((category) => category.name),
    ).toEqual(['Z', 'A', 'B'])
    expect(eventCategoryIdsOf(['a', 'a', '', 'x/y', 'b'])).toEqual(['a', 'b'])
  })

  it('reads a ticket link only for a known kind and a document id', () => {
    expect(
      eventTicketOf({ kind: 'product', id: 'p1', label: '  Buy   a pass ' }),
    ).toEqual({
      kind: 'product',
      id: 'p1',
      label: 'Buy a pass',
    })
    expect(eventTicketOf({ kind: 'membership', id: 'p1' })).toBeNull()
    expect(eventTicketOf({ kind: 'service', id: 'a/b' })).toBeNull()
    expect(eventTicketOf(null)).toBeNull()
  })
})
