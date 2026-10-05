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
 * The phone and address a service may ask for (AGL-3493), as every half
 * reads them: the widget, the booking route, the console, the managers'
 * notice and the CRM meeting.
 */

import {
  bookingContactAsks,
  bookingContactLines,
  bookingFieldAsk,
  readBookingAddress,
  readBookingContactFields,
  readBookingPhone,
} from './booking-contact-fields'
import { bookingMeetingBody } from './booking-record'

describe('bookingFieldAsk', () => {
  it('asks only for the two real answers; absent and anything else is off', () => {
    expect(bookingFieldAsk('optional')).toBe('optional')
    expect(bookingFieldAsk('required')).toBe('required')
    for (const value of [undefined, null, '', 'off', 'yes', true, 1]) {
      expect(bookingFieldAsk(value)).toBe('off')
    }
    expect(bookingContactAsks(undefined)).toEqual({ phone: 'off', address: 'off' })
    expect(bookingContactAsks({ askPhone: 'required' })).toEqual({
      phone: 'required',
      address: 'off',
    })
  })
})

describe('readBookingPhone', () => {
  it('normalizes a North American number to E.164', () => {
    expect(readBookingPhone('(512) 555-0107')).toBe('+15125550107')
    expect(readBookingPhone('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('keeps a number written the local way abroad as typed', () => {
    expect(readBookingPhone(' 020  7946 0958 ')).toBe('020 7946 0958')
    expect(readBookingPhone('512-555-0107 x12')).toBe('512-555-0107 x12')
  })

  it('refuses what cannot be a phone', () => {
    for (const value of ['', 'call me', '12345', '555-CALL-NOW', '1'.repeat(41), null]) {
      expect(readBookingPhone(value)).toBeNull()
    }
  })
})

describe('readBookingAddress', () => {
  it('trims each line, drops empty ones and caps the length', () => {
    expect(readBookingAddress('  12   Oak St \r\n\n  Austin, TX  ')).toBe('12 Oak St\nAustin, TX')
    expect(readBookingAddress(' \n ')).toBeNull()
    expect(readBookingAddress('x'.repeat(500))).toHaveLength(300)
  })
})

describe('readBookingContactFields', () => {
  const both = { phone: 'required', address: 'required' } as const

  it('requires what is required, with the sentence the visitor reads', () => {
    expect(readBookingContactFields(both, { address: '12 Oak St' })).toEqual({
      ok: false,
      error: 'Enter your phone number',
    })
    expect(readBookingContactFields(both, { phone: '5125550107' })).toEqual({
      ok: false,
      error: 'Enter the address',
    })
  })

  it('refuses an unreadable phone even when it is optional', () => {
    expect(
      readBookingContactFields({ phone: 'optional', address: 'off' }, { phone: 'soon' }),
    ).toEqual({ ok: false, error: 'Enter a valid phone number' })
  })

  it('drops what the service does not ask for', () => {
    expect(
      readBookingContactFields(
        { phone: 'off', address: 'off' },
        { phone: '5125550107', address: '12 Oak St' },
      ),
    ).toEqual({ ok: true, fields: {} })
  })

  it('answers what was given, read', () => {
    expect(
      readBookingContactFields(both, { phone: '512.555.0107', address: '12 Oak St ' }),
    ).toEqual({ ok: true, fields: { phone: '+15125550107', address: '12 Oak St' } })
  })
})

describe('the lines a person reads', () => {
  it('names the phone and the address, the address on one line', () => {
    expect(
      bookingContactLines({ phone: '+15125550107', address: '12 Oak St\nAustin, TX' }),
    ).toEqual(['Phone: +15125550107', 'Address: 12 Oak St, Austin, TX'])
    expect(bookingContactLines({ phone: 7, address: '' })).toEqual([])
  })

  it('files them on the CRM meeting under the slot', () => {
    const startsAtMs = Date.UTC(2026, 9, 5, 15)
    const body = bookingMeetingBody({
      serviceName: 'Free on-site estimate',
      startsAtMs,
      timezone: 'America/Chicago',
      phone: '+15125550107',
      address: '12 Oak St\nAustin, TX',
    })
    expect(body.split('\n')).toEqual([
      expect.stringMatching(/^Free on-site estimate — .+ \(America\/Chicago\)$/),
      'Phone: +15125550107',
      'Address: 12 Oak St, Austin, TX',
    ])
    // A booking that carried neither reads exactly as it did.
    expect(
      bookingMeetingBody({ serviceName: 'Consult', startsAtMs, timezone: 'UTC' }),
    ).not.toContain('\n')
  })
})
