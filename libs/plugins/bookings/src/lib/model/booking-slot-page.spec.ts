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
 * A slot listing is bounded in whole DAYS, not in slots (AGL-3492).
 *
 * The listing used to stop at a flat 120 slots. At 15-minute steps a 60-minute
 * service open 8 to 5 has 33 starts a weekday, so the cap ran out on the
 * fourth day at 1 PM and the widget drew three and a half days as the whole
 * calendar. These pin the replacement: a page is the widget's strip of days,
 * each one whole, and the page after it starts exactly where it stopped.
 */

import { zonedDayKey } from '@aglyn/shared-util-timestamp/zoned-time'
import {
  BOOKING_MAX_DAYS_AHEAD,
  BOOKING_MAX_SLOTS_PER_DAY,
  BOOKING_SLOT_PAGE_DAYS,
  BOOKING_SLOT_PAGE_MAX_SLOTS,
  type BookingSlot,
  computeOpenSlotPage,
  computeOpenSlots,
  type HostBookingService,
} from './bookings'

const DAY_MS = 24 * 60 * 60_000
const ZONE = 'America/Chicago'

/** Monday 2026-10-05 00:00 in Chicago (CDT, UTC−5). */
const MONDAY = Date.UTC(2026, 9, 5, 5)

/** The live shape the defect was found on: an on-site estimate. */
const estimate: HostBookingService = {
  name: 'Free on-site estimate',
  durationMinutes: 60,
  timezone: ZONE,
  windows: {
    1: [{ start: 8 * 60, end: 17 * 60 }],
    2: [{ start: 8 * 60, end: 17 * 60 }],
    3: [{ start: 8 * 60, end: 17 * 60 }],
    4: [{ start: 8 * 60, end: 17 * 60 }],
    5: [{ start: 8 * 60, end: 17 * 60 }],
    6: [{ start: 8 * 60, end: 12 * 60 }],
  },
}

function countByDay(slots: BookingSlot[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const slot of slots) {
    const key = zonedDayKey(slot.startsAtMs, ZONE)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

describe('computeOpenSlotPage', () => {
  it('answers the strip of days, each with every open time it has', () => {
    const page = computeOpenSlotPage(
      estimate,
      MONDAY,
      MONDAY + BOOKING_MAX_DAYS_AHEAD * DAY_MS,
    )
    const counts = countByDay(page.slots)
    expect(counts.size).toBe(BOOKING_SLOT_PAGE_DAYS)
    // Eight to five at 15-minute steps, the last start at 4 PM: 33. Saturday
    // eight to noon: 13. Far past the 120 the listing used to stop at.
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([
      13, 13, ...Array(12).fill(33),
    ])
    expect(page.slots.length).toBeGreaterThan(120)
    // Monday's last start is 4 PM — the time the widget used to hide.
    const monday = page.slots.filter(
      (slot) => zonedDayKey(slot.startsAtMs, ZONE) === '2026-10-05',
    )
    expect(monday.at(-1)?.startsAtMs).toBe(MONDAY + 16 * 60 * 60_000)
  })

  it('names the next page at the first slot it left out', () => {
    const toMs = MONDAY + BOOKING_MAX_DAYS_AHEAD * DAY_MS
    const page = computeOpenSlotPage(estimate, MONDAY, toMs)
    const every = computeOpenSlots(estimate, MONDAY, toMs, [], 10_000)
    expect(page.nextFromMs).toBe(every[page.slots.length].startsAtMs)
    expect(page.slots).toEqual(every.slice(0, page.slots.length))
  })

  it('pages through the whole horizon without a gap or a repeat', () => {
    const toMs = MONDAY + BOOKING_MAX_DAYS_AHEAD * DAY_MS
    const every = computeOpenSlots(estimate, MONDAY, toMs, [], 10_000)
    const paged: BookingSlot[] = []
    let fromMs: number | null = MONDAY
    let pages = 0
    while (fromMs !== null && pages < 20) {
      const page = computeOpenSlotPage(estimate, fromMs, toMs)
      paged.push(...page.slots)
      fromMs = page.nextFromMs
      pages += 1
    }
    expect(fromMs).toBeNull()
    // The horizon crosses the November clock change; days stay whole there.
    expect(paged).toEqual(every)
    expect(pages).toBeGreaterThan(1)
  })

  it('stops at the ceiling for a service open around the clock', () => {
    const allDay: HostBookingService = {
      name: 'Hotline',
      durationMinutes: 15,
      timezone: 'UTC',
      windows: Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((day) => [day, [{ start: 0, end: 24 * 60 }]]),
      ),
    }
    const fromMs = Date.UTC(2026, 9, 5)
    const page = computeOpenSlotPage(allDay, fromMs, fromMs + 30 * DAY_MS)
    expect(page.slots).toHaveLength(BOOKING_SLOT_PAGE_MAX_SLOTS)
    expect(BOOKING_SLOT_PAGE_MAX_SLOTS).toBe(
      BOOKING_SLOT_PAGE_DAYS * BOOKING_MAX_SLOTS_PER_DAY,
    )
    // A tighter ceiling ends the page early and says where it stopped.
    const capped = computeOpenSlotPage(allDay, fromMs, fromMs + 30 * DAY_MS, [], {
      maxSlots: 50,
    })
    expect(capped.slots).toHaveLength(50)
    expect(capped.nextFromMs).toBe(fromMs + 50 * 15 * 60_000)
  })

  it('answers no next page once it reaches the horizon', () => {
    const toMs = MONDAY + 3 * DAY_MS
    const page = computeOpenSlotPage(estimate, MONDAY, toMs)
    expect(countByDay(page.slots).size).toBe(3)
    expect(page.nextFromMs).toBeNull()
  })

  it('walks a horizon past the per-walk cap a page at a time, losing no slot at the seam', () => {
    // The per-walk cap falls at 22:30 on day 60, inside the evening window:
    // the 22:00 and 22:15 starts begin before it and end after. The next
    // page has to start early enough to offer them.
    const late: HostBookingService = {
      name: 'Night shift',
      durationMinutes: 60,
      timezone: 'UTC',
      windows: Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((day) => [day, [{ start: 22 * 60, end: 24 * 60 }]]),
      ),
    }
    const fromMs = Date.UTC(2026, 9, 5, 22, 30)
    const toMs = fromMs + 90 * DAY_MS
    const first = computeOpenSlotPage(late, fromMs, toMs, [], { days: 1_000 })
    expect(first.nextFromMs).not.toBeNull()
    const second = computeOpenSlotPage(late, first.nextFromMs as number, toMs, [], {
      days: 1_000,
    })
    const both = [...first.slots, ...second.slots]
    const starts = both.map((slot) => slot.startsAtMs)
    expect(new Set(starts).size).toBe(starts.length)
    // Every day of the 90 has its 22:00, 22:15 … 23:00 starts (the first
    // day only from 22:30): nothing fell between the two walks.
    expect(both).toHaveLength(3 + 89 * 5)
  })
})
