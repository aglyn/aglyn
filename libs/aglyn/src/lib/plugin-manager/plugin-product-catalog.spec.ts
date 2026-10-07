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
  pluginCatalogFeed,
  pluginProductCatalog,
  registerPluginCatalogFeed,
  registerPluginProductCatalog,
  type PluginCatalogFeed,
  type PluginProductCatalog,
} from './plugin-product-catalog'
import { resetPluginServicesForTests } from './plugin-services'

/** The store catalog and its feed publisher, one owner each (AGL-3637). */
describe('core.product-catalog and core.catalog-feed', () => {
  beforeEach(() => resetPluginServicesForTests())

  const catalog = (): PluginProductCatalog => ({
    store: async () => null,
    page: async () => ({ offers: [], nextCursor: null }),
  })
  const feed = (): PluginCatalogFeed => ({ serveLegacyFeed: async () => new Response(null, { status: 404 }) })

  it('answers undefined with nobody registered', () => {
    expect(pluginProductCatalog()).toBeUndefined()
    expect(pluginCatalogFeed()).toBeUndefined()
  })

  it('keeps the first owner and refuses a second plugin', () => {
    const first = catalog()
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginProductCatalog(first, { pluginId: 'commerce' })
    try {
      registerPluginProductCatalog(catalog(), { pluginId: 'other' })
    } catch {
      // A refusal may throw or log; either way the incumbent keeps serving.
    }
    expect(pluginProductCatalog()).toBe(first)
    const publisher = feed()
    registerPluginCatalogFeed(publisher, { pluginId: 'sales-channels' })
    try {
      registerPluginCatalogFeed(feed(), { pluginId: 'other' })
    } catch {
      // As above.
    }
    expect(pluginCatalogFeed()).toBe(publisher)
    errors.mockRestore()
  })
})
