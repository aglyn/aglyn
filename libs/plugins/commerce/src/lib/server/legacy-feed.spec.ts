/**
 * @jest-environment node
 */
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

import { registerPluginCatalogFeed } from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { legacyFeedRoute } from './legacy-feed'

/**
 * `/api/commerce/feed?hostId=` (AGL-299 → AGL-3637): the Google Merchant
 * Center address merchants pasted before sales channels existed, answered by
 * whichever plugin publishes the catalog now.
 */
describe('legacyFeedRoute', () => {
  beforeEach(() => resetPluginServicesForTests())

  const request = (query = '?hostId=host-candles') => new Request(`https://candles.example.com/api/commerce/feed${query}`)

  it('hands the request and its site to the catalog’s feed publisher', async () => {
    const serveLegacyFeed = jest.fn(async () => new Response('<rss/>', { status: 200 }))
    registerPluginCatalogFeed({ serveLegacyFeed }, { pluginId: 'sales-channels' })
    const response = await legacyFeedRoute(request())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<rss/>')
    expect(serveLegacyFeed).toHaveBeenCalledWith(expect.any(Request), 'host-candles')
  })

  it('answers 404 with no publisher registered', async () => {
    expect((await legacyFeedRoute(request())).status).toBe(404)
  })

  it('answers 400 without a site', async () => {
    expect((await legacyFeedRoute(request(''))).status).toBe(400)
  })
})
