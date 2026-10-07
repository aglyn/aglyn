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
  bookingActions,
  bookingDurationMs,
  bookingOutstandingCents,
  bookingState,
  checkInRefusal,
  rescheduleRefusal,
} from './booking-manage'

const NOW = 1_000_000_000
const HOUR = 3_600_000
const upcoming = { status: 'confirmed', startsAtMs: NOW + HOUR, endsAtMs: NOW + 2 * HOUR }

describe('booking-manage (AGL-3621)', () => {
  it('reads a lapsed payment hold as expired, not pending', () => {
    expect(bookingState({ status: 'pendingPayment', expiresAtMs: NOW - 1 }, NOW)).toBe('expired')
    expect(bookingState({ status: 'pendingPayment', expiresAtMs: NOW + 1 }, NOW)).toBe('pendingPayment')
    expect(bookingState({ status: 'canceled' }, NOW)).toBe('canceled')
    expect(bookingState({}, NOW)).toBe('confirmed')
  })

  it('offers check-in, move and cancel on an upcoming confirmed booking', () => {
    expect(bookingActions(upcoming, NOW)).toEqual({
      checkIn: true,
      undoCheckIn: false,
      reschedule: true,
      cancel: true,
      refundCents: 0,
    })
  })

  it('offers only the undo once the guest is in', () => {
    expect(bookingActions({ ...upcoming, checkedInAtMs: NOW }, NOW)).toMatchObject({
      checkIn: false,
      undoCheckIn: true,
      reschedule: false,
      cancel: false,
    })
  })

  it('offers nothing on a canceled booking and no move once it has ended', () => {
    expect(bookingActions({ ...upcoming, status: 'canceled' }, NOW)).toMatchObject({
      checkIn: false,
      reschedule: false,
      cancel: false,
    })
    expect(bookingActions({ ...upcoming, endsAtMs: NOW }, NOW).reschedule).toBe(false)
  })

  it('names what is left to refund', () => {
    expect(bookingOutstandingCents({ paidAmountCents: 9500, refundedCents: 2000 })).toBe(7500)
    expect(bookingOutstandingCents({ paidAmountCents: 100, refundedCents: 500 })).toBe(0)
    expect(bookingActions({ ...upcoming, paidAmountCents: 9500 }, NOW).refundCents).toBe(9500)
  })

  it('refuses what the routes refuse', () => {
    expect(checkInRefusal(upcoming, true, NOW)).toBeNull()
    expect(checkInRefusal(upcoming, false, NOW)).toBe('This guest is not checked in')
    expect(checkInRefusal({ status: 'canceled' }, true, NOW)).toBe('This booking was canceled')
    expect(rescheduleRefusal(upcoming, NOW + 5 * HOUR, NOW)).toBeNull()
    expect(rescheduleRefusal(upcoming, NOW - 1, NOW)).toBe('Pick a time that has not passed')
    expect(rescheduleRefusal({ ...upcoming, checkedInAtMs: 1 }, NOW + 5 * HOUR, NOW)).toBe(
      'This guest is already checked in',
    )
  })

  it('keeps the booked length when it moves', () => {
    expect(bookingDurationMs(upcoming, 30)).toBe(HOUR)
    expect(bookingDurationMs({}, 45)).toBe(45 * 60_000)
  })
})
