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

import { bookingLinkFor, normalizeBookingPath } from './bookings'

/**
 * THE LINK A REP DROPS INTO AN EMAIL (AGL-2660): the site's public origin,
 * the page the Booking block lives on, the service preselected, and the
 * record carried along when there is one.
 */

describe('bookingLinkFor', () => {
  const service = { id: 'service-1' }

  it('prefers the custom domain over the platform subdomain', () => {
    expect(bookingLinkFor({ site: { cname: 'book.acme.com', subdomain: 'acme' }, service })).toBe(
      'https://book.acme.com/?service=service-1',
    )
    expect(bookingLinkFor({ site: { subdomain: 'acme' }, service })).toBe(
      'https://acme.aglyn.app/?service=service-1',
    )
  })

  it('answers null for a site with no public origin yet', () => {
    expect(bookingLinkFor({ site: {}, service })).toBeNull()
    expect(bookingLinkFor({ site: null, service })).toBeNull()
  })

  it('opens the page the block lives on, as the setting names it', () => {
    expect(bookingLinkFor({ site: { subdomain: 'acme' }, service, path: '/book' })).toBe(
      'https://acme.aglyn.app/book?service=service-1',
    )
    expect(bookingLinkFor({ site: { subdomain: 'acme' }, service, path: 'book/' })).toBe(
      'https://acme.aglyn.app/book?service=service-1',
    )
  })

  it('carries the record the link was dropped from', () => {
    expect(
      bookingLinkFor({
        site: { subdomain: 'acme' },
        service,
        path: '/book',
        crmRef: { kind: 'contact', id: 'contact-1' },
      }),
    ).toBe('https://acme.aglyn.app/book?service=service-1&crm=contact%3Acontact-1')
  })

  it('encodes a service id that would otherwise read as further query', () => {
    expect(bookingLinkFor({ site: { subdomain: 'acme' }, service: { id: 'a&b=c' } })).toBe(
      'https://acme.aglyn.app/?service=a%26b%3Dc',
    )
  })
})

describe('normalizeBookingPath', () => {
  it('reads every spelling of a path as one path', () => {
    expect(normalizeBookingPath('/book')).toBe('/book')
    expect(normalizeBookingPath('book')).toBe('/book')
    expect(normalizeBookingPath(' /book/ ')).toBe('/book')
    expect(normalizeBookingPath('/book?x=1#top')).toBe('/book')
    expect(normalizeBookingPath('/a/b/')).toBe('/a/b')
  })

  it('falls back to the root for nothing at all', () => {
    expect(normalizeBookingPath('')).toBe('/')
    expect(normalizeBookingPath('/')).toBe('/')
    expect(normalizeBookingPath(undefined)).toBe('/')
    expect(normalizeBookingPath(null)).toBe('/')
    expect(normalizeBookingPath(42)).toBe('/42')
  })
})
