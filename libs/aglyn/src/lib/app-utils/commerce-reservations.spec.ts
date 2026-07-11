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
  canCancelReservation,
  computeReservationQuote,
  DAY_MS,
  isRangeAvailable,
  nightlyRateCents,
  toDayMs,
  type HostResource,
} from './commerce-reservations'

// 2026-07-06 is a Monday; UTC-midnight day values keep math exact.
const MONDAY = Date.UTC(2026, 6, 6)
const FRIDAY = MONDAY + 4 * DAY_MS

const cabin: HostResource = {
  name: 'Lakeside cabin',
  nightlyRateUsd: 100,
  weekendMultiplier: 1.5,
  seasons: [{ from: '12-15', to: '01-05', multiplier: 2, label: 'Holidays' }],
  minNights: 2,
  depositPct: 30,
  cancellationHours: 48,
}

describe('nightlyRateCents', () => {
  it('applies weekend and wrapping-season multipliers', () => {
    expect(nightlyRateCents(cabin, MONDAY)).toBe(10000)
    expect(nightlyRateCents(cabin, FRIDAY)).toBe(15000)
    const newYearsEve = Date.UTC(2026, 11, 31) // Thursday in season
    expect(nightlyRateCents(cabin, newYearsEve)).toBe(20000)
  })
})

describe('computeReservationQuote', () => {
  it('prices per night with a deposit percentage', () => {
    const quote = computeReservationQuote(cabin, MONDAY, MONDAY + 3 * DAY_MS)
    expect(quote.nights).toBe(3)
    expect(quote.subtotalCents).toBe(30000)
    expect(quote.depositCents).toBe(9000)
    expect(quote.problem).toBeUndefined()
  })
  it('rejects empty ranges and short stays', () => {
    expect(computeReservationQuote(cabin, MONDAY, MONDAY).problem).toMatch(
      /at least one/,
    )
    expect(
      computeReservationQuote(cabin, MONDAY, MONDAY + DAY_MS).problem,
    ).toMatch(/Minimum stay/)
  })
})

describe('isRangeAvailable', () => {
  const existing = [
    {
      checkInDayMs: MONDAY + 2 * DAY_MS,
      checkOutDayMs: MONDAY + 4 * DAY_MS,
      status: 'confirmed' as const,
    },
  ]
  it('detects overlaps but allows back-to-back stays', () => {
    expect(isRangeAvailable(cabin, existing, MONDAY, MONDAY + 2 * DAY_MS)).toBe(
      true,
    )
    expect(isRangeAvailable(cabin, existing, MONDAY, MONDAY + 3 * DAY_MS)).toBe(
      false,
    )
    expect(
      isRangeAvailable(cabin, existing, MONDAY + 4 * DAY_MS, MONDAY + 6 * DAY_MS),
    ).toBe(true)
  })
  it('ignores cancelled reservations and honors blocks', () => {
    expect(
      isRangeAvailable(
        cabin,
        [{ ...existing[0], status: 'cancelled' }],
        MONDAY,
        MONDAY + 5 * DAY_MS,
      ),
    ).toBe(true)
    expect(
      isRangeAvailable(
        {
          blocks: [
            { fromDayMs: MONDAY + DAY_MS, toDayMs: MONDAY + 2 * DAY_MS },
          ],
        },
        [],
        MONDAY,
        MONDAY + 3 * DAY_MS,
      ),
    ).toBe(false)
  })
})

describe('canCancelReservation / toDayMs', () => {
  it('respects the cancellation window and live statuses', () => {
    const reservation = {
      checkInDayMs: MONDAY,
      status: 'confirmed' as const,
    }
    expect(
      canCancelReservation(cabin, reservation, MONDAY - 3 * DAY_MS),
    ).toBe(true)
    expect(
      canCancelReservation(cabin, reservation, MONDAY - DAY_MS),
    ).toBe(false)
    expect(
      canCancelReservation(
        cabin,
        { ...reservation, status: 'checked_in' },
        MONDAY - 3 * DAY_MS,
      ),
    ).toBe(false)
  })
  it('floors instants to UTC midnight', () => {
    expect(toDayMs(MONDAY + 5000)).toBe(MONDAY)
  })
})
