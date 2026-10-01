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
 * Where a booking is read (AGL-3080): what this plugin publishes under
 * `booking`, for the surfaces that link to one — a contact's timeline, a
 * person's page listing the bookings their address holds.
 */

import {
  pluginRecordByEmailHref,
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerBookingsRecordRoutes } from './bookings-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerBookingsRecordRoutes()
})

describe('the bookings record route', () => {
  it('is this plugin’s', () => {
    expect(pluginRecordRoute('booking')?.pluginId).toBe('bookings')
  })

  it('lands a booking on the Bookings page, which lists them', () => {
    expect(pluginRecordListHref('booking', SITE)).toBe('/acme/hosts/shop/bookings')
    expect(pluginRecordHref('booking', SITE, 'b-1')).toBe('/acme/hosts/shop/bookings')
  })

  it('narrows the page to one booker (AGL-2660)', () => {
    expect(pluginRecordByEmailHref('booking', SITE, 'ada@example.test')).toBe(
      '/acme/hosts/shop/bookings?email=ada%40example.test',
    )
  })

  it('has no address at the organization, where no Bookings page is', () => {
    expect(pluginRecordListHref('booking', ORG)).toBeNull()
    expect(pluginRecordByEmailHref('booking', ORG, 'ada@example.test')).toBeNull()
  })
})
