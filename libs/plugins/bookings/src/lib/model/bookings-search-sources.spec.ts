/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * AGL-3080: what the console's search finds in a site's bookings,
 * declared by the plugin rather than named by the console.
 */

import { BOOKINGS_SEARCH_SOURCES } from './bookings-search-sources'

describe('the bookings search source', () => {
  const [source] = BOOKINGS_SEARCH_SOURCES

  it('reads the site collection its writer stores, by the field it names rows with', () => {
    expect(BOOKINGS_SEARCH_SOURCES).toHaveLength(1)
    expect(source).toMatchObject({
      id: 'services',
      scope: 'host',
      collection: 'services',
      nameField: 'name',
      entitlementKey: 'servicesPerHost',
    })
  })

  it('opens on the site page that lists it, and nowhere off a site', () => {
    expect(source.href({ $id: 'x1' }, { orgSlug: 'acme', host: 'demo' })).toBe(
      '/acme/hosts/demo/bookings',
    )
    expect(source.href({ $id: 'x1' }, { orgSlug: 'acme', host: null })).toBeNull()
  })

  it("is listed after the site's building blocks", () => {
    expect(source.order).toBeGreaterThan(140)
  })
})
