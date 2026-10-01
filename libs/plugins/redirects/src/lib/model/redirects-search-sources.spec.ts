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
 * AGL-3080: what the console's search finds among a site's redirects,
 * declared by the plugin rather than named by the console.
 */

import { REDIRECTS_SEARCH_SOURCES } from './redirects-search-sources'

describe('the redirects search source', () => {
  const [source] = REDIRECTS_SEARCH_SOURCES

  it('reads the site collection its writer stores, by the field it names rows with', () => {
    expect(REDIRECTS_SEARCH_SOURCES).toHaveLength(1)
    expect(source).toMatchObject({
      id: 'redirects',
      scope: 'host',
      collection: 'redirects',
      nameField: 'source',
      entitlementKey: 'redirectsPerHost',
    })
    // A redirect has no name: it is found by either of its paths.
    expect(source.extraFields).toEqual(['destination'])
  })

  it('opens on the site page that lists it, and nowhere off a site', () => {
    expect(source.href({ $id: 'x1' }, { orgSlug: 'acme', host: 'demo' })).toBe(
      '/acme/hosts/demo/redirects',
    )
    expect(source.href({ $id: 'x1' }, { orgSlug: 'acme', host: null })).toBeNull()
  })

  it("is listed after the site's building blocks", () => {
    expect(source.order).toBeGreaterThan(140)
  })
})
