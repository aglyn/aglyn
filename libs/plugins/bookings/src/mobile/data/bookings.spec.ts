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
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import {
  bookingRow,
  bookingsRangeQuery,
  bookingsSiteQuery,
  cancelBooking,
  openSlotsQuery,
  rescheduleBooking,
  serviceBookingLink,
  setCheckedIn,
} from './bookings'
import type { BookingsMobileContext } from './context'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

const HOUR = 60 * 60_000
// Monday 2026-06-01 00:00 UTC.
const MONDAY = Date.UTC(2026, 5, 1)
const NOW = MONDAY + 8 * HOUR

function contextWith(api = createApiDouble()): BookingsMobileContext & { api: ReturnType<typeof createApiDouble>['client'] } {
  return { firestore: double.db, hostId: 'h1', orgId: 'o1', api: api.client, now: () => NOW }
}

const stored = (startsAtMs: number, extra: Record<string, unknown> = {}) => ({
  serviceId: 's1',
  serviceName: 'Haircut',
  name: 'Alex',
  email: 'alex@example.com',
  status: 'confirmed',
  startsAtMs,
  endsAtMs: startsAtMs + HOUR,
  ...extra,
})

beforeEach(() => double.reset())

describe('the Bookings app data layer (AGL-3621)', () => {
  it('reads a range on the start-time index, narrowed to one service on its composite index', async () => {
    double.setCollection('hosts/h1/bookings', [{ id: 'b1', data: stored(MONDAY + 10 * HOUR) }])
    const range = await bookingsRangeQuery(contextWith(), { fromMs: MONDAY, toMs: MONDAY + 24 * HOUR }).queryFn()
    expect(range.rows.map((row) => row.id)).toEqual(['b1'])
    expect(range.truncated).toBe(false)
    expect(double.queries[0]).toEqual({
      path: 'hosts/h1/bookings',
      constraints: [
        { type: 'where', path: 'startsAtMs', op: '>=', value: MONDAY },
        { type: 'where', path: 'startsAtMs', op: '<', value: MONDAY + 24 * HOUR },
        { type: 'orderBy', path: 'startsAtMs', direction: 'asc' },
        { type: 'limit', count: 500 },
      ],
    })
    await bookingsRangeQuery(contextWith(), { fromMs: MONDAY, toMs: MONDAY + HOUR, serviceId: 's1' }).queryFn()
    expect(double.queries[1].constraints[0]).toEqual({ type: 'where', path: 'serviceId', op: '==', value: 's1' })
  })

  it('reads a row’s state, payment and what may be done to it', () => {
    const row = bookingRow('b1', stored(MONDAY + 10 * HOUR, { paidAmountCents: 9500, refundedCents: 500, phone: '+1 555 0100' }), NOW)
    expect(row).toMatchObject({
      name: 'Alex',
      state: 'confirmed',
      stateLabel: 'Confirmed',
      paidCents: 9500,
      refundedCents: 500,
      phone: '+1 555 0100',
      checkedInAtMs: null,
    })
    expect(row.actions).toEqual({ checkIn: true, undoCheckIn: false, reschedule: true, cancel: true, refundCents: 9000 })
    expect(bookingRow('b2', stored(MONDAY, { status: 'pendingPayment', expiresAtMs: NOW - 1 }), NOW).stateLabel).toBe(
      'Payment not finished',
    )
  })

  it('resolves the site zone and the booking page as the console does', async () => {
    double.setDoc('hosts/h1', { timeZone: 'America/Denver', subdomain: 'shop' })
    double.setDoc('orgs/o1/pluginSettings/bookings', { bookingPath: 'book/' })
    const site = await bookingsSiteQuery(contextWith()).queryFn()
    expect(site).toMatchObject({ timeZone: 'America/Denver', bookingPath: 'book/' })
    expect(serviceBookingLink(site, 's1')).toMatch(/^https:\/\/shop\.[^/]+\/book\?service=s1$/)
  })

  it('offers move times around every other live booking, its own counted free', async () => {
    double.setCollection('hosts/h1/bookings', [
      { id: 'b1', data: stored(MONDAY + 10 * HOUR) },
      { id: 'b2', data: stored(MONDAY + 11 * HOUR) },
      { id: 'b3', data: stored(MONDAY + 12 * HOUR, { status: 'canceled' }) },
    ])
    const service = { name: 'Haircut', durationMinutes: 60, timezone: 'UTC', windows: { 1: [{ start: 9 * 60, end: 14 * 60 }] } }
    const page = await openSlotsQuery(contextWith(), { booking: { id: 'b1', serviceId: 's1' }, service, fromMs: 0 }).queryFn()
    const hours = page.slots.filter((slot) => slot.startsAtMs < MONDAY + 24 * HOUR).map((slot) => (slot.startsAtMs - MONDAY) / HOUR)
    expect(hours).toContain(10)
    expect(hours).toContain(12)
    expect(hours).not.toContain(11)
    expect(hours.every((hour) => hour >= 9 && hour <= 13)).toBe(true)
    expect(double.queries[0].constraints[0]).toEqual({ type: 'where', path: 'serviceId', op: '==', value: 's1' })
  })

  it('checks in and moves through the member routes', async () => {
    const api = createApiDouble()
    const context = contextWith(api)
    await setCheckedIn(context, 'b1', true)
    await rescheduleBooking(context, 'b1', MONDAY + 13 * HOUR)
    expect(api.calls).toEqual([
      { path: '/api/bookings/check-in', init: { method: 'POST', body: { hostId: 'h1', bookingId: 'b1', checkedIn: true } } },
      { path: '/api/bookings/reschedule', init: { method: 'POST', body: { hostId: 'h1', bookingId: 'b1', startsAtMs: MONDAY + 13 * HOUR } } },
    ])
  })

  it('cancels a paid booking only through the refund route, keyed for a retry', async () => {
    const api = createApiDouble()
    const row = bookingRow('b1', stored(MONDAY + 10 * HOUR, { paidAmountCents: 5000 }), NOW)
    await expect(cancelBooking(contextWith(api), row, 'attempt-1')).resolves.toEqual({ refundedCents: 5000 })
    expect(api.calls).toEqual([
      {
        path: '/api/bookings/refund',
        init: { method: 'POST', body: { hostId: 'h1', bookingId: 'b1' }, idempotencyKey: 'attempt-1' },
      },
    ])
    expect(double.writes).toEqual([])
  })

  it('cancels a free booking as the console does, and leaves a failed refund standing', async () => {
    const free = bookingRow('b1', stored(MONDAY + 10 * HOUR), NOW)
    await cancelBooking(contextWith(), free)
    expect(double.writes).toEqual([{ kind: 'update', path: 'hosts/h1/bookings/b1', data: { status: 'canceled' } }])

    double.reset()
    const failing = createApiDouble(() => {
      throw Object.assign(new Error('Refund failed'), { status: 502 })
    })
    const paid = bookingRow('b2', stored(MONDAY + 10 * HOUR, { paidAmountCents: 100 }), NOW)
    await expect(cancelBooking(contextWith(failing), paid)).rejects.toThrow('Refund failed')
    expect(double.writes).toEqual([])
  })
})
