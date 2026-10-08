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
  type ApiV1ResourceDescription,
  booleanField as bool,
  integerField as int,
  isoField as iso,
  nullableField as nullable,
  objectKindField as OBJECT_FIELD,
  queryParam as q,
  stringField as str,
} from '@aglyn/tenant-data-admin/server/api-v1-description'

/**
 * A site's bookings as the customer API's OpenAPI document describes them
 * (AGL-3643), in the shape `apps/docs/api/resources/bookings.md` documents.
 */
export const BOOKINGS_API_V1_DESCRIPTION: ApiV1ResourceDescription = {
  tag: 'Bookings',
  description: 'A site’s bookings. Read-only over the API.',
  schemaName: 'Booking',
  required: ['id', 'object', 'status'],
  fields: {
    id: str('Booking id.'),
    object: OBJECT_FIELD('booking'),
    serviceId: nullable(str('The booked service.')),
    serviceName: nullable(str('The service’s name when it was booked.')),
    status: {
      type: 'string',
      enum: ['confirmed', 'pendingPayment', 'expired', 'canceled'],
      description:
        '`pendingPayment` is a paid booking whose checkout is still open; `expired` is one whose checkout ran out, and its slot was released.',
    },
    name: nullable(str('The guest’s name.')),
    email: nullable(str('The guest’s email address.')),
    phone: nullable(str('The guest’s phone number, when the service asked for one.')),
    address: {
      type: ['object', 'string', 'null'],
      description: 'The address the service is at, when the service asked for one: the guest’s address parts, or the line they typed.',
      additionalProperties: true,
    },
    startsAt: nullable(iso('When the booking starts, UTC.')),
    endsAt: nullable(iso('When the booking ends, UTC.')),
    timeZone: nullable(str('The IANA time zone the booking was made in.')),
    currency: str('Always `usd`.'),
    paidCents: int('What the guest paid, tax included; 0 for a free booking.'),
    taxCents: int('The tax inside `paidCents`.'),
    refundedCents: int('Refunded so far.'),
    checkedIn: bool('Whether the guest was checked in.'),
    checkedInAt: nullable(iso('When the guest was checked in.')),
    rescheduledFrom: nullable(iso('Where a moved booking started before its latest move.')),
    created: nullable(iso('When the booking was made.')),
  },
  ops: [
    {
      path: '/v1/sites/{siteId}/bookings',
      method: 'get',
      operationId: 'listBookings',
      summary: 'List bookings',
      list: true,
      returns: 'Booking',
      filters: [
        q('status', '`confirmed`, `pendingPayment` or `canceled`. An expired checkout is stored as `pendingPayment`.'),
        q('serviceId', 'Bookings of one service.'),
      ],
      pathParams: [{ name: 'siteId', description: 'Site id.' }],
    },
    {
      path: '/v1/sites/{siteId}/bookings/{bookingId}',
      method: 'get',
      operationId: 'getBooking',
      summary: 'Retrieve a booking',
      returns: 'Booking',
      pathParams: [
        { name: 'siteId', description: 'Site id.' },
        { name: 'bookingId', description: 'Booking id.' },
      ],
    },
  ],
}
