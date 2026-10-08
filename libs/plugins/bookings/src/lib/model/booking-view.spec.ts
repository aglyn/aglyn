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

import { bookingEventKey, BOOKING_EVENT_DECLARATIONS } from './booking-events'
import { bookingInstant, bookingViewFromData } from './booking-view'
import { cancelRefusal } from './booking-manage'

const NOW = Date.UTC(2026, 9, 7, 12)

describe('the published booking (AGL-3643)', () => {
  it('reads a held checkout as pendingPayment, and as expired once its hold ran out', () => {
    const held = { status: 'pendingPayment', expiresAtMs: NOW + 60_000 }
    expect(bookingViewFromData('b', held, NOW).status).toBe('pendingPayment')
    expect(bookingViewFromData('b', held, NOW + 120_000).status).toBe('expired')
    expect(bookingViewFromData('b', { status: 'canceled' }, NOW).status).toBe('canceled')
    expect(bookingViewFromData('b', {}, NOW).status).toBe('confirmed')
  })

  it('turns every stored time into ISO 8601 and never invents one', () => {
    expect(bookingInstant(NOW)).toBe('2026-10-07T12:00:00.000Z')
    expect(bookingInstant({ toMillis: () => NOW })).toBe('2026-10-07T12:00:00.000Z')
    expect(bookingInstant({ toDate: () => new Date(NOW) })).toBe('2026-10-07T12:00:00.000Z')
    expect(bookingInstant(0)).toBeNull()
    expect(bookingInstant(undefined)).toBeNull()
    // The server timestamp sentinel a write carries before it lands.
    expect(bookingInstant({ isEqual: () => false })).toBeNull()
  })

  it('carries money as non-negative integer cents, and the check-in and move', () => {
    const view = bookingViewFromData(
      'b',
      {
        paidAmountCents: 1999.6,
        refundedCents: -5,
        checkedInAtMs: NOW,
        rescheduledFromMs: NOW - 3_600_000,
        address: { line1: '1 Main St', city: 'Austin' },
      },
      NOW,
    )
    expect(view).toMatchObject({
      paidCents: 2000,
      refundedCents: 0,
      taxCents: 0,
      checkedIn: true,
      checkedInAt: '2026-10-07T12:00:00.000Z',
      rescheduledFrom: '2026-10-07T11:00:00.000Z',
      address: { line1: '1 Main St', city: 'Austin' },
    })
  })

  it('keys each event to its occurrence: once per booking, once per new time', () => {
    expect(bookingEventKey('booking.created', 'b1')).toBe('b1')
    expect(bookingEventKey('booking.canceled', 'b1')).toBe('b1')
    expect(bookingEventKey('booking.rescheduled', 'b1', 123)).toBe('b1@123')
    expect(BOOKING_EVENT_DECLARATIONS.map((one) => (one.event as { id: string }).id)).toEqual([
      'booking.created',
      'booking.rescheduled',
      'booking.canceled',
    ])
  })
})

describe('cancelRefusal (AGL-3643)', () => {
  it('cancels a free or fully refunded booking, refuses money still paid and a checked-in guest', () => {
    expect(cancelRefusal({ status: 'confirmed' }, NOW)).toBeNull()
    expect(cancelRefusal({ status: 'canceled', paidAmountCents: 500 }, NOW)).toBeNull()
    expect(cancelRefusal({ status: 'confirmed', paidAmountCents: 500, refundedCents: 500 }, NOW)).toBeNull()
    expect(cancelRefusal({ status: 'confirmed', paidAmountCents: 500, refundedCents: 100 }, NOW)).toMatch(/refund/)
    expect(cancelRefusal({ status: 'confirmed', checkedInAtMs: NOW }, NOW)).toMatch(/checked in/)
  })
})
