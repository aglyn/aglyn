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
  computeOpenSlots,
  type HostBookingService,
  isSlotOpen,
} from './bookings'

// Monday 2026-07-13 00:00 UTC.
const MONDAY_UTC = Date.UTC(2026, 6, 13)

const consult: HostBookingService = {
  name: 'Consultation',
  durationMinutes: 30,
  timezone: 'UTC',
  // Mondays 09:00–11:00 UTC.
  windows: { 1: [{ start: 9 * 60, end: 11 * 60 }] },
}

describe('computeOpenSlots', () => {
  it('quantizes a window into duration-sized slots', () => {
    const slots = computeOpenSlots(
      consult,
      MONDAY_UTC,
      MONDAY_UTC + 24 * 60 * 60_000,
    )
    // 09:00–11:00 with 30-minute slots on a 15-minute lattice:
    // 09:00, 09:15, 09:30 … 10:30 all fit.
    expect(slots[0].startsAtMs).toBe(MONDAY_UTC + 9 * 60 * 60_000)
    expect(slots.at(-1)?.startsAtMs).toBe(
      MONDAY_UTC + (10 * 60 + 30) * 60_000,
    )
    expect(slots.every((slot) => slot.endsAtMs - slot.startsAtMs === 30 * 60_000)).toBe(
      true,
    )
  })

  it('drops slots that collide with existing bookings', () => {
    const booked = [
      {
        startsAtMs: MONDAY_UTC + 9 * 60 * 60_000,
        endsAtMs: MONDAY_UTC + (9 * 60 + 30) * 60_000,
      },
    ]
    const slots = computeOpenSlots(
      consult,
      MONDAY_UTC,
      MONDAY_UTC + 24 * 60 * 60_000,
      booked,
    )
    expect(
      slots.some((slot) => slot.startsAtMs < booked[0].endsAtMs),
    ).toBe(false)
  })

  it('returns nothing outside availability windows', () => {
    // Tuesday has no windows.
    const tuesday = MONDAY_UTC + 24 * 60 * 60_000
    expect(
      computeOpenSlots(consult, tuesday, tuesday + 24 * 60 * 60_000),
    ).toEqual([])
  })

  it('respects non-UTC timezones', () => {
    const chicago: HostBookingService = {
      ...consult,
      timezone: 'America/Chicago',
    }
    const slots = computeOpenSlots(
      chicago,
      MONDAY_UTC,
      MONDAY_UTC + 24 * 60 * 60_000,
    )
    // 09:00 America/Chicago in July is 14:00 UTC.
    expect(slots[0].startsAtMs).toBe(MONDAY_UTC + 14 * 60 * 60_000)
  })
})

describe('isSlotOpen', () => {
  it('accepts an exact open slot and rejects taken or off-window starts', () => {
    const nine = MONDAY_UTC + 9 * 60 * 60_000
    expect(isSlotOpen(consult, nine)).toBe(true)
    expect(isSlotOpen(consult, nine + 5 * 60_000)).toBe(false)
    expect(
      isSlotOpen(consult, nine, [
        { startsAtMs: nine, endsAtMs: nine + 30 * 60_000 },
      ]),
    ).toBe(false)
  })
})
