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

import { bookingFigureReader } from './booking-figures'

/**
 * A site's bookings as a figure table (AGL-2915): counted by service in the
 * window they were made, a lapsed payment hold not counted as a booking, and
 * nothing of a guest in the table.
 */

const NOW = new Date('2026-09-16T15:00:00.000Z')
const at = (daysAgo: number) => new Date(Date.UTC(2026, 8, 16) - daysAgo * 86_400_000 + 3_600_000)

type Booking = { createdAt: Date; serviceName: string; status: string; name: string; email: string }

function firestoreOf(bookings: Booking[]) {
  const query = (filters: Array<[string, Date]>): any => ({
    where: (_field: string, op: string, value: Date) => query([...filters, [op, value]]),
    orderBy: () => query(filters),
    limit: () => query(filters),
    get: async () => ({
      docs: bookings
        .filter((booking) =>
          filters.every(([op, value]) => (op === '>=' ? booking.createdAt >= value : booking.createdAt < value)),
        )
        .map((booking, index) => ({ id: `b${index}`, data: () => booking })),
    }),
  })
  return { collection: () => ({ doc: () => ({ collection: () => query([]) }) }) } as unknown as FirebaseFirestore.Firestore
}

const booking = (daysAgo: number, serviceName: string, status = 'confirmed'): Booking => ({
  createdAt: at(daysAgo),
  serviceName,
  status,
  name: 'Avery Guest',
  email: 'avery@example.com',
})

describe('bookings by service', () => {
  it('counts booked and canceled in the window, with the change from the window before', async () => {
    const reader = bookingFigureReader(() =>
      firestoreOf([
        booking(0, 'Haircut'),
        booking(1, 'Haircut'),
        booking(2, 'Haircut', 'canceled'),
        booking(2, 'Color', 'pendingPayment'),
        booking(3, 'Color'),
        booking(9, 'Haircut'),
      ]),
    )
    const read = await reader.read({ orgId: 'org-1', hostId: 'host-1', days: 7, now: NOW, uid: null, params: {} })
    if (read.ok === false) throw new Error(read.error)
    expect(read.table.rows).toEqual([
      { service: 'All services', booked: 3, canceled: 1, change: 200 },
      { service: 'Haircut', booked: 2, canceled: 1, change: 100 },
      { service: 'Color', booked: 1, canceled: 0, change: null },
    ])
    expect(JSON.stringify(read.table)).not.toMatch(/Avery|example\.com/)
  })

  it('reads a site’s bookings only when a site is named, over a window it covers', async () => {
    const reader = bookingFigureReader(() => firestoreOf([]))
    expect(await reader.read({ orgId: 'org-1', hostId: null, days: 7, now: NOW, uid: null, params: {} })).toMatchObject({ ok: false })
    expect(await reader.read({ orgId: 'org-1', hostId: 'host-1', days: 5, now: NOW, uid: null, params: {} })).toMatchObject({ ok: false })
  })
})
