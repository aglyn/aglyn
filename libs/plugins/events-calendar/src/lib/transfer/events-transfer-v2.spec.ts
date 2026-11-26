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

/** The calendar v2 columns of an events file (AGL-4252). */

import { eventFieldValues } from './events-transfer'
import {
  eventV2FieldValues,
  eventV2WriteFields,
  recurrenceForFile,
  recurrenceFromFile,
} from './events-transfer-v2'

const names = new Map([
  ['mx', 'MX Training'],
  ['kids', 'Kids Camp'],
])
const ids = new Map([
  ['mx training', 'mx'],
  ['kids camp', 'kids'],
])

describe('the Repeats column', () => {
  it('round-trips the rules the calendar keeps', () => {
    for (const rule of [
      { freq: 'weekly', weekdays: [4] },
      { freq: 'weekly', interval: 2, weekdays: [0, 6], count: 8 },
      { freq: 'daily', untilDayKey: '2027-03-01' },
      { freq: 'monthly' },
    ]) {
      expect(recurrenceFromFile(recurrenceForFile(rule))).toEqual(rule)
    }
  })

  it('reads a calendar app’s RRULE line, and refuses what it cannot keep', () => {
    expect(recurrenceFromFile('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270301T055959Z')).toEqual({
      freq: 'weekly',
      weekdays: [2, 4],
      untilDayKey: '2027-03-01',
    })
    expect(recurrenceFromFile('')).toBeNull()
    expect(recurrenceFromFile('FREQ=YEARLY')).toEqual({ problem: expect.stringContaining('daily, weekly or monthly') })
    expect(recurrenceFromFile('FREQ=MONTHLY;BYDAY=1MO')).toEqual({ problem: expect.stringContaining('"1MO"') })
  })
})

describe('an event’s v2 columns', () => {
  it('names categories and writes the rule, skipped dates, zone and ticket', () => {
    expect(
      eventV2FieldValues(
        {
          categoryIds: ['mx', 'gone'],
          recurrence: { freq: 'weekly', weekdays: [4], exceptDayKeys: ['2026-11-26'] },
          timeZone: 'America/Chicago',
          ticket: { kind: 'product', id: 'pass' },
        },
        names,
      ),
    ).toEqual({
      categories: 'MX Training',
      repeat: 'FREQ=WEEKLY;BYDAY=TH',
      skipDates: '2026-11-26',
      timeZone: 'America/Chicago',
      ticket: 'product:pass',
    })
    // An export row carries them beside the v1 columns.
    expect(eventFieldValues('e1', { title: 'x', ticket: { kind: 'service', id: 's' } }, names)).toMatchObject({
      title: 'x',
      ticket: 'service:s',
      repeat: null,
    })
  })

  it('reads them back, reporting a category the site does not have', () => {
    expect(
      eventV2WriteFields(
        {
          categories: 'mx training, Pit bikes',
          repeat: 'FREQ=WEEKLY;BYDAY=TH',
          skipDates: '2026-11-26',
          timeZone: 'America/Chicago',
          ticket: 'service:lesson',
        },
        ids,
      ),
    ).toEqual({
      categoryIds: ['mx'],
      unknownCategories: ['Pit bikes'],
      recurrence: { freq: 'weekly', weekdays: [4], exceptDayKeys: ['2026-11-26'] },
      timeZone: 'America/Chicago',
      ticket: { kind: 'service', id: 'lesson' },
    })
  })

  it('leaves out what the row does not carry, and refuses what it cannot read', () => {
    expect(eventV2WriteFields({ title: 'x' }, ids)).toEqual({ unknownCategories: [] })
    expect(eventV2WriteFields({ repeat: '', skipDates: '' }, ids)).toEqual({ unknownCategories: [], recurrence: null })
    expect(eventV2WriteFields({ timeZone: 'Mars/Base' }, ids)).toEqual({ problem: expect.stringContaining('Mars/Base') })
    expect(eventV2WriteFields({ ticket: 'coupon:1' }, ids)).toEqual({ problem: 'Tickets is product:ID or service:ID.' })
    expect(eventV2WriteFields({ repeat: 'FREQ=DAILY', skipDates: 'soon' }, ids)).toEqual({
      problem: expect.stringContaining('"soon"'),
    })
  })
})
