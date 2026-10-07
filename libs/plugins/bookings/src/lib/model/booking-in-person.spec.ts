/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  bookingDayRange,
  bookingInPersonAmountProblem,
  bookingInPersonState,
  bookingSuggestedCents,
} from './booking-in-person'

describe('bookingInPersonState', () => {
  const now = 1_000_000
  it.each([
    [{ status: 'confirmed' }, 'payable'],
    [{ status: 'confirmed', paidAmountCents: 5000 }, 'paid'],
    [{ status: 'confirmed', paymentIntentId: 'pi_1' }, 'paid'],
    [{ status: 'confirmed', inPersonPayment: { status: 'paid' as const } }, 'paid'],
    [{ status: 'confirmed', inPersonPayment: { status: 'pending' as const } }, 'collecting'],
    [{ status: 'confirmed', inPersonPayment: { status: 'canceled' as const } }, 'payable'],
    [{ status: 'canceled' }, 'canceled'],
    [{ status: 'pendingPayment', expiresAtMs: now + 1 }, 'awaiting-online'],
    [{ status: 'pendingPayment', expiresAtMs: now - 1 }, 'canceled'],
  ])('%j is %s', (booking, state) => {
    expect(bookingInPersonState(booking, now)).toBe(state)
  })

  it('a refunded booking stays paid: it is refunded in the console, not charged again', () => {
    expect(bookingInPersonState({ paidAmountCents: 5000, refundedCents: 5000, paymentIntentId: 'pi_1' }, now)).toBe('paid')
  })
})

describe('bookingInPersonAmountProblem', () => {
  it('takes whole cents between $0.50 and $10,000', () => {
    expect(bookingInPersonAmountProblem(50)).toBeNull()
    expect(bookingInPersonAmountProblem(1_000_000)).toBeNull()
    expect(bookingInPersonAmountProblem(49)).toMatch(/\$0\.50/)
    expect(bookingInPersonAmountProblem(1_000_001)).toMatch(/\$10,000/)
    expect(bookingInPersonAmountProblem(10.5)).toMatch(/Enter/)
    expect(bookingInPersonAmountProblem('5000')).toMatch(/Enter/)
    expect(bookingInPersonAmountProblem(Number.NaN)).toMatch(/Enter/)
  })
})

describe('bookingSuggestedCents', () => {
  it('suggests a fixed price and nothing for one that varies', () => {
    expect(bookingSuggestedCents({ priceUsd: 45 })).toBe(4500)
    expect(bookingSuggestedCents({ priceUsd: 45, priceDisplay: 'fixed' })).toBe(4500)
    expect(bookingSuggestedCents({ priceUsd: 45, priceDisplay: 'varies' })).toBeNull()
    expect(bookingSuggestedCents({ priceUsd: 0 })).toBeNull()
    expect(bookingSuggestedCents(null)).toBeNull()
  })
})

describe('bookingDayRange', () => {
  it('spans the local day that holds the moment', () => {
    // 2026-10-07 15:00 UTC, in UTC-5.
    const at = Date.UTC(2026, 9, 7, 15)
    const { startMs, endMs } = bookingDayRange(at, 300)
    expect(new Date(startMs).toISOString()).toBe('2026-10-07T05:00:00.000Z')
    expect(endMs - startMs).toBe(86_400_000)
    // 02:00 UTC on the 8th is still the 7th in UTC-5.
    expect(bookingDayRange(Date.UTC(2026, 9, 8, 2), 300).startMs).toBe(startMs)
  })
})
