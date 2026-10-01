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

// The registry's own module, not the data layer's barrel: boot needs the
// registry, not the whole server surface.
import { registerApiV1SiteResource } from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The commerce plugin's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot. The tenant runtime registers none of it.
 *
 * It serves a site's products and orders on the customer REST API,
 * `/v1/sites/{siteId}/products/…` and `/v1/sites/{siteId}/orders/…`: the
 * console's router owns the pipeline in front — the key, the plan's API
 * access, the quota, the rate limit, the error envelope — and the site's
 * ownership, and hands every request under each resource here.
 *
 * No plan feature is named on the registrations, though both need
 * `commerce`: the handlers ask the key's scope FIRST and the plan second
 * (AGL-900, AGL-1928), so a key without the scope is told about the scope
 * whatever plan its organization is on, and the router would ask in the
 * opposite order.
 *
 * Light at boot: the handlers are imported with their first request and the
 * descriptions when the document is first built. Registering again replaces
 * this plugin's own entries.
 */
export function registerCommerceConsoleServerDeclarations(): void {
  registerApiV1SiteResource(
    'products',
    {
      handle: async (...args) =>
        (await import('./server/api-v1/orders-and-products')).handleProducts(...args),
      describe: async () =>
        (await import('./server/api-v1/openapi')).PRODUCTS_API_V1_DESCRIPTION,
    },
    { pluginId: BUNDLE_ID },
  )
  registerApiV1SiteResource(
    'orders',
    {
      handle: async (...args) =>
        (await import('./server/api-v1/orders-and-products')).handleOrders(...args),
      describe: async () =>
        (await import('./server/api-v1/openapi')).ORDERS_API_V1_DESCRIPTION,
    },
    { pluginId: BUNDLE_ID },
  )
}
