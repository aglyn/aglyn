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
 * A resource that holds several identical units (AGL-4044): twelve RV
 * hookups sold as one resource, each night taking up to twelve stays.
 *
 * The first block is the regression the change has to carry: every resource
 * written before `units` existed has one unit, and on one unit the answer is
 * compared, case by case, with the overlap check this replaced.
 */

import {
  computeReservationQuote,
  DAY_MS,
  FEW_UNITS_LEFT,
  fewestUnitsLeft,
  isRangeAvailable,
  MAX_RESOURCE_UNITS,
  MAX_RESERVATION_GUESTS,
  PENDING_RESERVATION_HOLD_MS,
  readStayCheckInMode,
  reservationGuests,
  reservationGuestsProblem,
  resourceFewLeftAt,
  resourceGuestCeiling,
  stayChecksInPerGuest,
  resourceUnits,
  unitsLeftByNight,
  unitsTakenByNight,
  type HeldStay,
  type ReservationStatus,
} from './commerce-reservations'

const D0 = Date.UTC(2026, 9, 1)
const night = (n: number) => D0 + n * DAY_MS
const NOW = night(-10)

const stay = (
  from: number,
  to: number,
  status: ReservationStatus = 'confirmed',
  createdAtMs?: number,
): HeldStay => ({
  checkInDayMs: night(from),
  checkOutDayMs: night(to),
  status,
  ...(createdAtMs === undefined ? {} : { createdAtMs }),
})

/** The overlap check `isRangeAvailable` was before `units`, verbatim. */
function legacyIsRangeAvailable(
  blocks: Array<{ fromDayMs: number; toDayMs: number }>,
  reservations: HeldStay[],
  checkInDayMs: number,
  checkOutDayMs: number,
  nowMs: number,
): boolean {
  if (!(checkOutDayMs > checkInDayMs)) return false
  for (const reservation of reservations) {
    if (reservation.status === 'cancelled' || reservation.status === 'no_show') continue
    if (reservation.status === 'pending') {
      const createdAtMs = Number(reservation.createdAtMs ?? 0)
      if (!(createdAtMs > 0 && nowMs - createdAtMs < PENDING_RESERVATION_HOLD_MS)) continue
    }
    if (
      checkInDayMs < reservation.checkOutDayMs &&
      checkOutDayMs > reservation.checkInDayMs
    ) {
      return false
    }
  }
  for (const block of blocks) {
    if (checkInDayMs < block.toDayMs && checkOutDayMs > block.fromDayMs) {
      return false
    }
  }
  return true
}

describe('one unit behaves exactly as before (AGL-4044 regression)', () => {
  const stays: HeldStay[] = [
    stay(2, 4),
    stay(6, 7, 'checked_in'),
    stay(8, 10, 'cancelled'),
    stay(11, 12, 'no_show'),
    stay(13, 15, 'pending', NOW - 60_000),
    stay(16, 18, 'pending', NOW - PENDING_RESERVATION_HOLD_MS - 1),
    stay(19, 20, 'pending'),
    stay(21, 23, 'checked_out'),
  ]
  const blocks = [{ fromDayMs: night(25), toDayMs: night(27) }]

  it.each([undefined, 1, 0, -3, 1.4, Number.NaN, 'twelve'])(
    'answers every range the old way when units is %p',
    (units) => {
      const resource = { blocks, units: units as number | undefined }
      for (let from = 0; from < 30; from++) {
        for (let to = from; to < 31; to++) {
          expect([
            from,
            to,
            isRangeAvailable(resource, stays, night(from), night(to), NOW),
          ]).toEqual([
            from,
            to,
            legacyIsRangeAvailable(blocks, stays, night(from), night(to), NOW),
          ])
        }
      }
    },
  )

  it('still reads a non-midnight range the old way', () => {
    const offset = 3 * 60 * 60 * 1000
    expect(
      isRangeAvailable({}, [stay(2, 4)], night(3) + offset, night(5)),
    ).toBe(false)
    expect(
      isRangeAvailable({}, [stay(2, 4)], night(4) + offset, night(5)),
    ).toBe(true)
  })
})

describe('resourceUnits', () => {
  it('reads a whole number from 1 to the cap, and 1 for anything else', () => {
    expect(resourceUnits(undefined)).toBe(1)
    expect(resourceUnits({})).toBe(1)
    expect(resourceUnits({ units: 12 })).toBe(12)
    expect(resourceUnits({ units: 12.9 })).toBe(12)
    expect(resourceUnits({ units: 0 })).toBe(1)
    expect(resourceUnits({ units: -4 })).toBe(1)
    expect(resourceUnits({ units: Number.NaN })).toBe(1)
    expect(resourceUnits({ units: 10_000 })).toBe(MAX_RESOURCE_UNITS)
    expect(resourceUnits({ units: '7' as unknown as number })).toBe(7)
  })
})

describe('several units: a range is free while every night has one left', () => {
  const hookups = { units: 3 }

  it('takes a third overlapping stay and refuses a fourth', () => {
    const two = [stay(0, 3), stay(1, 4)]
    expect(isRangeAvailable(hookups, two, night(1), night(3), NOW)).toBe(true)
    const three = [...two, stay(1, 2)]
    expect(isRangeAvailable(hookups, three, night(1), night(3), NOW)).toBe(false)
    // The full night is the 1st only; the 2nd still has one unit.
    expect(isRangeAvailable(hookups, three, night(2), night(3), NOW)).toBe(true)
  })

  it('refuses on the ONE night at the limit inside a longer stay', () => {
    // Nights 0..4 hold 1, 2, 3, 2, 1 stays: only night 2 is full.
    const stays = [stay(0, 5), stay(1, 4), stay(2, 3)]
    expect(isRangeAvailable(hookups, stays, night(0), night(2), NOW)).toBe(true)
    expect(isRangeAvailable(hookups, stays, night(3), night(5), NOW)).toBe(true)
    expect(isRangeAvailable(hookups, stays, night(0), night(5), NOW)).toBe(false)
    expect(isRangeAvailable(hookups, stays, night(2), night(3), NOW)).toBe(false)
  })

  it('counts back-to-back stays as different nights', () => {
    const stays = [stay(0, 2), stay(0, 2), stay(0, 2)]
    expect(isRangeAvailable(hookups, stays, night(2), night(4), NOW)).toBe(true)
    expect(isRangeAvailable(hookups, stays, night(1), night(3), NOW)).toBe(false)
  })

  it('lets a block close every unit at once', () => {
    const resource = {
      units: 12,
      blocks: [{ fromDayMs: night(5), toDayMs: night(6) }],
    }
    expect(isRangeAvailable(resource, [], night(4), night(6), NOW)).toBe(false)
    expect(isRangeAvailable(resource, [], night(6), night(8), NOW)).toBe(true)
  })

  it('stops counting a pending hold once it lapses, and never counts a dead stay', () => {
    const fresh = NOW - 60_000
    const stale = NOW - PENDING_RESERVATION_HOLD_MS - 1
    const stays = [
      stay(0, 2),
      stay(0, 2),
      stay(0, 2, 'pending', fresh),
    ]
    expect(isRangeAvailable(hookups, stays, night(0), night(1), NOW)).toBe(false)
    // Thirty minutes later the same rows leave a unit.
    expect(
      isRangeAvailable(
        hookups,
        stays,
        night(0),
        night(1),
        NOW + PENDING_RESERVATION_HOLD_MS,
      ),
    ).toBe(true)
    expect(
      isRangeAvailable(
        hookups,
        [
          stay(0, 2),
          stay(0, 2),
          stay(0, 2, 'pending', stale),
          stay(0, 2, 'pending'),
          stay(0, 2, 'cancelled'),
          stay(0, 2, 'no_show'),
        ],
        night(0),
        night(2),
        NOW,
      ),
    ).toBe(true)
  })

  it('still refuses an empty range', () => {
    expect(isRangeAvailable(hookups, [], night(3), night(3), NOW)).toBe(false)
  })
})

describe('units left by night', () => {
  it('counts the stays on each night', () => {
    expect(
      unitsTakenByNight([stay(0, 5), stay(1, 4), stay(2, 3)], night(0), night(6), NOW),
    ).toEqual([1, 2, 3, 2, 1, 0])
  })

  it('gives the units left, and none on a blocked night', () => {
    const left = unitsLeftByNight(
      { units: 12, blocks: [{ fromDayMs: night(2), toDayMs: night(3) }] },
      [stay(0, 2), stay(1, 2), stay(1, 4, 'cancelled')],
      night(0),
      4,
      NOW,
    )
    expect(left).toEqual([
      { dayMs: night(0), units: 12, unitsLeft: 11 },
      { dayMs: night(1), units: 12, unitsLeft: 10 },
      { dayMs: night(2), units: 12, unitsLeft: 0 },
      { dayMs: night(3), units: 12, unitsLeft: 12 },
    ])
  })

  it('never goes below none when a resource was cut under its bookings', () => {
    expect(
      unitsLeftByNight({ units: 1 }, [stay(0, 1), stay(0, 1)], night(0), 1, NOW),
    ).toEqual([{ dayMs: night(0), units: 1, unitsLeft: 0 }])
  })
})

describe('fewestUnitsLeft, the widget’s "Only 2 left"', () => {
  const fewLeft = [
    { dayMs: night(1), unitsLeft: 3 },
    { dayMs: night(2), unitsLeft: 2 },
    { dayMs: night(5), unitsLeft: 1 },
  ]

  it('is the fewest left across the stay’s nights', () => {
    expect(fewestUnitsLeft(fewLeft, night(0), night(3))).toBe(2)
    expect(fewestUnitsLeft(fewLeft, night(1), night(2))).toBe(3)
    expect(fewestUnitsLeft(fewLeft, night(0), night(6))).toBe(1)
  })

  it('is null when no night of the stay is scarce, or nothing was sent', () => {
    expect(fewestUnitsLeft(fewLeft, night(3), night(5))).toBeNull()
    expect(fewestUnitsLeft(undefined, night(0), night(6))).toBeNull()
    expect(
      fewestUnitsLeft([{ dayMs: night(0), unitsLeft: 9 }], night(0), night(1)),
    ).toBeNull()
  })
})

describe('the store sets when "Only N left" shows (AGL-4044)', () => {
  it('reads as 3 until the store sets it, as every resource always has', () => {
    expect(resourceFewLeftAt({})).toBe(FEW_UNITS_LEFT)
    expect(resourceFewLeftAt(undefined)).toBe(3)
    expect(resourceFewLeftAt({ fewLeftAt: -2 })).toBe(3)
    expect(resourceFewLeftAt({ fewLeftAt: Number.NaN })).toBe(3)
    expect(resourceFewLeftAt({ fewLeftAt: 'x' as never })).toBe(3)
  })

  it('takes 0 (never) up to the most units a resource can hold, whole', () => {
    expect(resourceFewLeftAt({ fewLeftAt: 0 })).toBe(0)
    expect(resourceFewLeftAt({ fewLeftAt: 10.7 })).toBe(10)
    expect(resourceFewLeftAt({ fewLeftAt: 9_999 })).toBe(500)
  })

  it('follows the threshold it is given, and 0 never shows the line', () => {
    const fewLeft = [
      { dayMs: night(1), unitsLeft: 8 },
      { dayMs: night(2), unitsLeft: 5 },
    ]
    expect(fewestUnitsLeft(fewLeft, night(0), night(3), 10)).toBe(5)
    expect(fewestUnitsLeft(fewLeft, night(0), night(3), 6)).toBe(5)
    expect(fewestUnitsLeft(fewLeft, night(0), night(3))).toBeNull()
    expect(
      fewestUnitsLeft([{ dayMs: night(1), unitsLeft: 1 }], night(0), night(3), 0),
    ).toBeNull()
  })
})

describe('guests on a stay, and checking them in (AGL-4043)', () => {
  it('takes 1 up to what one unit sleeps, else up to 50, and reads none as 1', () => {
    expect(resourceGuestCeiling({ capacity: 6 })).toBe(6)
    expect(resourceGuestCeiling({})).toBe(MAX_RESERVATION_GUESTS)
    expect(resourceGuestCeiling({ capacity: 500 })).toBe(50)
    expect(reservationGuestsProblem(undefined, { capacity: 6 })).toBeNull()
    expect(reservationGuestsProblem('', { capacity: 6 })).toBeNull()
    expect(reservationGuestsProblem(6, { capacity: 6 })).toBeNull()
    expect(reservationGuestsProblem(7, { capacity: 6 })).toMatch(/1 to 6/)
    expect(reservationGuestsProblem(0, { capacity: 6 })).toMatch(/1 to 6/)
    expect(reservationGuestsProblem(2.5, {})).toMatch(/1 to 50/)
    expect(reservationGuestsProblem(2, { capacity: 1 })).toBe('This stay sleeps 1 guest')
    expect(reservationGuests({ guests: 4 })).toBe(4)
    expect(reservationGuests({})).toBe(1)
    expect(reservationGuests({ guests: -3 })).toBe(1)
  })

  it('checks in per guest where the resource says so, unless the store sets every stay', () => {
    expect(readStayCheckInMode(undefined)).toBe('resource')
    expect(readStayCheckInMode('nonsense')).toBe('resource')
    expect(readStayCheckInMode('guest')).toBe('guest')
    expect(stayChecksInPerGuest({ checkInPerGuest: true }, 'resource')).toBe(true)
    expect(stayChecksInPerGuest({}, 'resource')).toBe(false)
    expect(stayChecksInPerGuest({ checkInPerGuest: true }, 'stay')).toBe(false)
    expect(stayChecksInPerGuest({}, 'guest')).toBe(true)
  })
})

describe('the quote prices one unit, whatever the resource holds', () => {
  it('is the same quote with one unit or twelve', () => {
    const one = { name: 'Hookup', nightlyRateUsd: 60, depositPct: 100 }
    expect(
      computeReservationQuote({ ...one, units: 12 }, night(0), night(3)),
    ).toEqual(computeReservationQuote(one, night(0), night(3)))
    expect(
      computeReservationQuote({ ...one, units: 12 }, night(0), night(3))
        .totalCents,
    ).toBe(18000)
  })
})
