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

'use strict'

const { apiUrl, decimalAmount, rowsOf, seg } = require('../lib/api')
const { hookTrigger } = require('../lib/hook-trigger')

/**
 * Booking triggers (AGL-3643), on the bookings plugin's events. Each row is
 * the booking as `GET /v1/sites/{siteId}/bookings/{bookingId}` returns it,
 * with what was paid as decimal money. Needs `bookings:read` and bookings on
 * the plan.
 */

const UPDATE_CHOICES = {
  'booking.rescheduled': 'Rescheduled',
  'booking.canceled': 'Canceled',
}

function bookingRecord(booking, extra) {
  return {
    ...booking,
    paidAmount: decimalAmount(booking.paidCents, booking.currency || 'usd'),
    refundedAmount: decimalAmount(booking.refundedCents, booking.currency || 'usd'),
    ...extra,
  }
}

async function listBookings(z, bundle, params) {
  const response = await z.request({
    url: apiUrl(`/v1/sites/${seg(bundle.inputData.siteId)}/bookings`),
    params: { limit: 3, ...params },
  })
  return rowsOf(response)
}

const BOOKING_SAMPLE = {
  id: 'b7Qn2kV0xP',
  object: 'booking',
  serviceId: 'svc_consult',
  serviceName: '30-minute consultation',
  status: 'confirmed',
  name: 'Avery Chen',
  email: 'avery@example.com',
  phone: '+15125550123',
  address: null,
  startsAt: '2026-10-14T15:00:00.000Z',
  endsAt: '2026-10-14T15:30:00.000Z',
  timeZone: 'America/Chicago',
  currency: 'usd',
  paidCents: 5413,
  taxCents: 413,
  refundedCents: 0,
  checkedIn: false,
  checkedInAt: null,
  rescheduledFrom: null,
  created: '2026-10-07T18:22:10.000Z',
  paidAmount: '54.13',
  refundedAmount: '0.00',
  event: 'booking.created',
  eventId: 'evt_sample',
}

const BOOKING_OUTPUT_FIELDS = [
  { key: 'id', label: 'Booking ID' },
  { key: 'serviceName', label: 'Service' },
  { key: 'status', label: 'Status' },
  { key: 'name', label: 'Guest Name' },
  { key: 'email', label: 'Guest Email' },
  { key: 'phone', label: 'Guest Phone' },
  { key: 'startsAt', label: 'Starts', type: 'datetime' },
  { key: 'endsAt', label: 'Ends', type: 'datetime' },
  { key: 'timeZone', label: 'Time Zone' },
  { key: 'paidAmount', label: 'Paid' },
  { key: 'event', label: 'Event' },
]

const newBooking = hookTrigger({
  key: 'new_booking',
  noun: 'Booking',
  label: 'New Booking',
  description: 'Triggers when a booking is confirmed: a free one when it is made, a paid one when its payment lands.',
  important: true,
  events: ['booking.created'],
  toRecords: async (z, bundle, body) => [bookingRecord(body.data.booking, { event: body.type, eventId: body.id })],
  list: async (z, bundle) =>
    (await listBookings(z, bundle, { status: 'confirmed' })).map((booking) =>
      bookingRecord(booking, { event: 'booking.created', eventId: null }),
    ),
  sample: BOOKING_SAMPLE,
  outputFields: BOOKING_OUTPUT_FIELDS,
})

const updatedBooking = hookTrigger({
  key: 'updated_booking',
  noun: 'Booking',
  label: 'Updated Booking',
  description: 'Triggers when a booking is rescheduled or canceled.',
  events: Object.keys(UPDATE_CHOICES),
  choices: UPDATE_CHOICES,
  toRecords: async (z, bundle, body) => [bookingRecord(body.data.booking, { event: body.type, eventId: body.id })],
  list: async (z, bundle) =>
    (await listBookings(z, bundle, {})).map((booking) =>
      bookingRecord(booking, {
        event: booking.status === 'canceled' ? 'booking.canceled' : 'booking.rescheduled',
        eventId: null,
      }),
    ),
  sample: {
    ...BOOKING_SAMPLE,
    startsAt: '2026-10-15T16:00:00.000Z',
    endsAt: '2026-10-15T16:30:00.000Z',
    rescheduledFrom: '2026-10-14T15:00:00.000Z',
    event: 'booking.rescheduled',
  },
  outputFields: [...BOOKING_OUTPUT_FIELDS, { key: 'rescheduledFrom', label: 'Previously Starting', type: 'datetime' }],
})

module.exports = { newBooking, updatedBooking, bookingRecord }
