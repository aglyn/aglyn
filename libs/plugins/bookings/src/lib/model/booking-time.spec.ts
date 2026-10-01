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
  bookingTimeZone,
  formatBookingWhen,
  storedBookingTimeZone,
} from './booking-time'

/** 2026-04-24T03:06:40Z — late evening of the 23rd in the Americas. */
const STARTS_AT = 1_777_000_000_000

describe('the zone a booking is told in (AGL-3432)', () => {
  it('takes the service zone first: the slot was offered in it', () => {
    expect(
      bookingTimeZone({
        service: { timezone: 'America/Chicago' },
        host: { timeZone: 'Europe/Berlin' },
        org: { timeZone: 'Asia/Tokyo' },
      }),
    ).toBe('America/Chicago')
  })

  it('falls back to the site, then the workspace, then UTC', () => {
    expect(
      bookingTimeZone({ service: {}, host: { timeZone: 'Europe/Berlin' } }),
    ).toBe('Europe/Berlin')
    expect(
      bookingTimeZone({ service: {}, host: {}, org: { timeZone: 'Asia/Tokyo' } }),
    ).toBe('Asia/Tokyo')
    expect(bookingTimeZone({ service: null })).toBe('UTC')
  })

  it('passes over a zone the runtime cannot format', () => {
    expect(
      bookingTimeZone({
        service: { timezone: 'Mars/Olympus' },
        host: { timeZone: 'Europe/Berlin' },
      }),
    ).toBe('Europe/Berlin')
  })

  it('reads a stored zone only when it is usable', () => {
    expect(storedBookingTimeZone({ timezone: 'America/Chicago' })).toBe(
      'America/Chicago',
    )
    expect(storedBookingTimeZone({})).toBeUndefined()
    expect(storedBookingTimeZone({ timezone: '' })).toBeUndefined()
    expect(storedBookingTimeZone({ timezone: 'Mars/Olympus' })).toBeUndefined()
  })
})

describe('a booking time as the guest reads it (AGL-3432)', () => {
  it('is the wall-clock time in the zone it is told in, not the server’s', () => {
    expect(formatBookingWhen(STARTS_AT, 'America/Chicago')).toBe(
      'Thursday, April 23, 2026 at 10:06 PM',
    )
    expect(formatBookingWhen(STARTS_AT, 'UTC')).toBe(
      'Friday, April 24, 2026 at 3:06 AM',
    )
  })

  it('formats in UTC rather than throwing on an unusable zone', () => {
    expect(formatBookingWhen(STARTS_AT, 'Mars/Olympus')).toBe(
      'Friday, April 24, 2026 at 3:06 AM',
    )
  })
})
