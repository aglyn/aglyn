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


import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Where a product is read, published for every other surface (AGL-3080).
 *
 * A surface elsewhere — the AI plugin's job drawer opening a product it
 * drafted — asks the record-route registry for `product` rather than
 * spelling this plugin's console path, and gets `null` (text instead of a
 * link) where this plugin is not loaded.
 *
 * Products are a site's, so only a site has an address; and the catalog has
 * no page per product — a product opens in the hub's editor — so the record
 * answers the catalog a caller would find it in.
 */

/** The nav slug the shell resolves the catalog by. */
const PRODUCTS_SLUG = 'products'

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerCommerceRecordRoutes(): void {
  registerPluginRecordRoute(
    'product',
    {
      list: (context) =>
        context.host
          ? buildRoute(Route.HOST_PLUGIN, {
              orgSlug: context.orgSlug,
              host: context.host,
              pluginSlug: PRODUCTS_SLUG,
            })
          : null,
      record: (context) =>
        context.host
          ? buildRoute(Route.HOST_PLUGIN, {
              orgSlug: context.orgSlug,
              host: context.host,
              pluginSlug: PRODUCTS_SLUG,
            })
          : null,
    },
    { pluginId: BUNDLE_ID },
  )
}
