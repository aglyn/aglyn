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
  addDays,
  monthGridDays,
  stepAnchor,
  viewRange,
  viewTitle,
  weekDays,
} from './calendar-grid'
import {
  EMPTY_REPEAT,
  recurrenceOfDraft,
  repeatDraftOf,
  repeatDraftProblem,
  ticketDraftOf,
  ticketOfDraft,
} from './event-editor-draft'
import { eventHref, normalizeEventsPath } from '../plugin-config'

describe('calendar days', () => {
  it('lays a month out in whole Sunday-first weeks', () => {
    const days = monthGridDays('2026-11-17')
    expect(days[0]).toBe('2026-11-01')
    expect(days[days.length - 1]).toBe('2026-12-05')
    expect(days).toHaveLength(35)
    expect(monthGridDays('2027-05-01')).toHaveLength(42)
  })

  it('reads ranges and steps per view', () => {
    expect(viewRange('month', '2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-12-06' })
    expect(viewRange('week', '2026-11-18')).toEqual({ from: '2026-11-15', to: '2026-11-22' })
    expect(viewRange('list', '2026-11-18', 14)).toEqual({ from: '2026-11-18', to: '2026-12-02' })
    expect(stepAnchor('month', '2026-12-15', 1)).toBe('2027-01-01')
    expect(stepAnchor('week', '2026-11-18', -1)).toBe('2026-11-08')
    expect(weekDays('2026-11-18')).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ])
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('titles each view', () => {
    expect(viewTitle('month', '2026-11-17')).toBe('November 2026')
    expect(viewTitle('week', '2026-11-18')).toBe('Nov 15 – Nov 21, 2026')
  })
})

describe('the editor’s repeat and ticket boxes', () => {
  it('round-trips a weekly rule with an end date', () => {
    const draft = {
      ...EMPTY_REPEAT,
      freq: 'weekly' as const,
      interval: '2',
      weekdays: [4],
      ends: 'on' as const,
      untilDayKey: '2027-03-01',
      exceptDayKeys: ['2026-11-26'],
    }
    const rule = recurrenceOfDraft(draft)
    expect(rule).toEqual({
      freq: 'weekly',
      interval: 2,
      weekdays: [4],
      untilDayKey: '2027-03-01',
      exceptDayKeys: ['2026-11-26'],
    })
    expect(repeatDraftOf(rule)).toEqual({ ...draft, count: '' })
    expect(recurrenceOfDraft(EMPTY_REPEAT)).toBeNull()
  })

  it('says what stops a save', () => {
    expect(repeatDraftProblem({ ...EMPTY_REPEAT, freq: 'daily', interval: '0' }, null)).toBe('Repeat every 1 to 52.')
    expect(repeatDraftProblem({ ...EMPTY_REPEAT, freq: 'daily', ends: 'on' }, null)).toBe('Choose the day it ends.')
    expect(
      repeatDraftProblem({ ...EMPTY_REPEAT, freq: 'daily', ends: 'on', untilDayKey: '2026-01-01' }, '2026-02-01'),
    ).toBe('It ends before it starts.')
    expect(repeatDraftProblem({ ...EMPTY_REPEAT, freq: 'daily', ends: 'after', count: '' }, null)).toBe(
      'Repeat 1 to 500 times.',
    )
    expect(repeatDraftProblem(EMPTY_REPEAT, null)).toBeNull()
  })

  it('round-trips a ticket link, and none', () => {
    expect(ticketOfDraft(ticketDraftOf({ kind: 'service', id: 's1', label: 'Book a spot' }))).toEqual({
      kind: 'service',
      id: 's1',
      label: 'Book a spot',
    })
    expect(ticketOfDraft({ kind: '', id: 'x', label: '' })).toBeNull()
  })
})

describe('where an event link opens', () => {
  it('opens the details page when there is one, else the calendar', () => {
    expect(eventHref({ calendarPath: 'events/', eventPagePath: '' }, 'e1', '2026-11-12')).toBe(
      '/events?event=e1&on=2026-11-12',
    )
    expect(eventHref({ calendarPath: '/events', eventPagePath: '/event' }, 'e1')).toBe('/event?event=e1')
    expect(normalizeEventsPath('//evil', '/events')).toBe('/events')
  })
})
