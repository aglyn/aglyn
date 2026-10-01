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
import {
  registerPluginRecordRoute,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * Where a product and an order are read, published for every other surface
 * (AGL-3080).
 *
 * A surface elsewhere — the AI plugin's job drawer opening a product it
 * drafted, a contact's timeline opening the order it names, a person's page
 * listing their orders — asks the record-route registry for `product` or
 * `order` rather than spelling this plugin's console path, and gets `null`
 * (text instead of a link) where this plugin is not loaded.
 *
 * Both are a site's, so only a site has an address. The catalog has no page
 * per product — a product opens in the hub's editor — so the record answers
 * the catalog a caller would find it in. An order opens as a dialog over the
 * Orders list, which reads {@link ORDERS_ORDER_PARAM} on arrival; the list
 * narrowed to one buyer reads {@link ORDERS_CUSTOMER_PARAM}.
 */

/** The nav slug the shell resolves the catalog by. */
const PRODUCTS_SLUG = 'products'

/** The query key the Orders list opens one order's dialog by. */
export const ORDERS_ORDER_PARAM = 'order'

/**
 * The query key the Orders list narrows to one buyer by — the same word the
 * CRM's contacts list opens a person by, so a reader who edits one URL into
 * the other is not surprised.
 */
export const ORDERS_CUSTOMER_PARAM = 'email'

function catalog(context: PluginRecordRouteContext): string | null {
  return context.host
    ? buildRoute(Route.HOST_PLUGIN, {
        orgSlug: context.orgSlug,
        host: context.host,
        pluginSlug: PRODUCTS_SLUG,
      })
    : null
}

function orders(context: PluginRecordRouteContext, key?: string, value?: string): string | null {
  const list = catalog(context)
  if (!list) return null
  return key && value
    ? `${list}/orders?${new URLSearchParams({ [key]: value }).toString()}`
    : `${list}/orders`
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerCommerceRecordRoutes(): void {
  registerPluginRecordRoute(
    'product',
    { list: catalog, record: catalog },
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordRoute(
    'order',
    {
      list: (context) => orders(context),
      record: (context, id) => orders(context, ORDERS_ORDER_PARAM, id),
      byEmail: (context, email) => orders(context, ORDERS_CUSTOMER_PARAM, email),
    },
    { pluginId: BUNDLE_ID },
  )
}
