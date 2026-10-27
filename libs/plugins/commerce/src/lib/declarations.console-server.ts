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
import { registerPluginOrgEraser } from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { registerPluginUserEraser } from '@aglyn/aglyn/plugin-manager/plugin-user-erasure'
import { registerPluginService } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerPluginSearchSources } from '@aglyn/aglyn/plugin-manager/plugin-search-sources'
import { COMMERCE_SERVER_SEARCH_SOURCES } from './model/commerce-server-search-sources'
import { BUNDLE_ID } from './constants/bundle-common'
import { ORDER_HISTORY_CONTRACT } from './model/order-history'
import { registerCommerceTransferResources } from './transfer/register-transfer-resources'

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
  // Commerce's share of a person erasure (AGL-2623, AGL-3080): every order the
  // person placed keeps its amounts, with the buyer taken off it. Required,
  // and loaded with the first erasure.
  registerPluginPersonEraser(
    async (request) => (await import('./server/person-eraser')).commercePersonEraser(request),
    { pluginId: BUNDLE_ID },
  )
  // Commerce's share of an ACCOUNT erasure (AGL-4038): every POS hardware
  // order the person placed that has not shipped is canceled and refunded in
  // full, then every one keeps its amounts and its tax region, with the
  // buyer taken off it. Loaded with the first erasure.
  registerPluginUserEraser(
    async (request) => (await import('./server/pos-hardware-user-eraser')).posHardwareUserEraser(request),
    { pluginId: BUNDLE_ID },
  )
  // Commerce's share of a WORKSPACE erasure (AGL-4038): every hardware order
  // the workspace bought that has not shipped is canceled and refunded in
  // full before the erasure deletes it, and the buyer and staff are told.
  // Never fails the erasure. Loaded with the first erasure.
  registerPluginOrgEraser(
    async (request) => (await import('./server/pos-hardware-closure')).posHardwareOrgEraser(request),
    { pluginId: BUNDLE_ID },
  )
  // A site's earlier orders, for a plugin that reads history behind the
  // order events (AGL-3614); the reader is loaded with the first page asked.
  registerPluginService(
    ORDER_HISTORY_CONTRACT,
    { listOrders: async (request) => (await import('./server/order-history')).listOrderHistory(request) },
    { pluginId: BUNDLE_ID },
  )
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
  // Products, categories, orders, discounts, coupons and gift cards on the
  // import wizard and the export dialog (AGL-3531): the transfer routes are
  // the console's alone, so they register here.
  registerCommerceTransferResources()
  // What the native apps' one box finds in a store (AGL-3943): products and
  // orders, each under its own plan flag and, for orders, the site role that
  // reads them.
  registerPluginSearchSources(COMMERCE_SERVER_SEARCH_SOURCES, { pluginId: BUNDLE_ID })
}
