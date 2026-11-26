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
import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import {
  registerSiteBuiltInPage,
  registerSitePathKind,
} from '@aglyn/aglyn/plugin-manager/site-path-kinds'
import { QUOTE_PAGE_PATH } from '../constants/quote-page'
import { RETURN_REQUEST_PATH } from '../constants/return-request'
import { BUNDLE_ID } from '../constants/bundle-common'
import { COMMERCE_SETTINGS_PAGE_ZONES } from '../components/commerce-console-sections'

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
 * the Catalog with {@link PRODUCTS_PRODUCT_PARAM}, which opens that product's
 * editor on arrival. An order opens as a dialog over the
 * Orders list, which reads {@link ORDERS_ORDER_PARAM} on arrival; the list
 * narrowed to one buyer reads {@link ORDERS_CUSTOMER_PARAM}.
 */

/** The nav slug the shell resolves the catalog by. */
export const PRODUCTS_SLUG = 'products'

/** The Catalog section of the products hub, where the product editor opens. */
export const PRODUCTS_CATALOG_SECTION = 'catalog'

/** The query key the Catalog opens one product's editor by. */
export const PRODUCTS_PRODUCT_PARAM = 'product'

/**
 * One product's editor, as a path under the site's console dashboard: the
 * form the admin edit bar takes a record's address in (it prefixes the
 * console origin and org path itself), so the tenant server can link a
 * product page to its product without building console routes.
 */
export function productEditPath(productId: string): string {
  return `/${PRODUCTS_SLUG}/${PRODUCTS_CATALOG_SECTION}?${new URLSearchParams({
    [PRODUCTS_PRODUCT_PARAM]: productId,
  }).toString()}`
}

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

/** One product's address: the Catalog, opening that product's editor. */
function product(context: PluginRecordRouteContext, id: string): string | null {
  const list = catalog(context)
  if (!list || !id) return list
  return `${list}/${PRODUCTS_CATALOG_SECTION}?${new URLSearchParams({
    [PRODUCTS_PRODUCT_PARAM]: id,
  }).toString()}`
}

/**
 * One order's address: the Orders list, opening that order's dialog. The
 * same answer the `order` record route gives, for a caller that holds the
 * id but not the registry (the one-box search, AGL-3943).
 */
export function orderRecordHref(context: PluginRecordRouteContext, id: string): string | null {
  return id ? orders(context, ORDERS_ORDER_PARAM, id) : null
}

/**
 * The store's settings — payments (Stripe), shipping, tax and returns — under
 * `store-settings` (AGL-3676): where an AI-built store's "Finish your store"
 * list sends its owner, without spelling this plugin's console path.
 *
 * A page each since AGL-3713: the list is Payments, the first of them, and a
 * record is the settings page of that id (`shipping`, `taxes` …). An id that
 * is not a settings page opens the list rather than a 404.
 */
function settings(context: PluginRecordRouteContext, page?: string): string | null {
  const list = catalog(context)
  if (!list) return null
  const id = page && Object.hasOwn(COMMERCE_SETTINGS_PAGE_ZONES, page) ? page : 'payments'
  return `${list}/${id}`
}

/**
 * Called from the console registrar. The owner is named rather than read off
 * the loader's marker, so the route registers the same way under a spec that
 * calls the registrar directly.
 */
export function registerCommerceRecordRoutes(): void {
  registerPluginRecordRoute(
    'product',
    { list: catalog, record: product },
    { pluginId: BUNDLE_ID },
  )
  registerPluginRecordRoute(
    'store-settings',
    { list: (context) => settings(context), record: settings },
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
  /*
   * The addresses this plugin composes, for the site's Analytics page
   * (AGL-4253): `/products/{slug}` and `/collections/{slug}` each render
   * through ONE template screen, so without these every product counted as
   * one `cr-product` row. Declared, so the page names each visited product
   * and store collection itself without naming this plugin.
   */
  registerSitePathKind(
    {
      segment: 'products',
      groupLabel: 'Products',
      noun: 'product',
      collection: 'products',
      editHref: product,
    },
    { pluginId: BUNDLE_ID },
  )
  registerSitePathKind(
    {
      segment: 'collections',
      groupLabel: 'Collections',
      noun: 'collection',
      collection: 'collections',
      // Content collections share the collection and a slug is unique only
      // within a kind (AGL-954), as the storefront resolver reads it.
      accepts: (data) => hostCollectionKind(data) === 'catalog',
      // Store collections are organized on the catalog page; there is no
      // page of one collection's own to open.
      editHref: (context) => catalog(context),
    },
    { pluginId: BUNDLE_ID },
  )
  /*
   * The fixed pages the storefront resolver serves (AGL-4253), so Analytics
   * names a visit there instead of filing it under "Other addresses". The
   * order status address is `ORDER_STATUS_PATH`, which lives with its server
   * token code; spelled here so the console bundle does not pull that in.
   */
  registerSiteBuiltInPage({ path: 'order-status', title: 'Order status' }, { pluginId: BUNDLE_ID })
  registerSiteBuiltInPage({ path: RETURN_REQUEST_PATH, title: 'Start a return' }, { pluginId: BUNDLE_ID })
  registerSiteBuiltInPage({ path: QUOTE_PAGE_PATH, title: 'Pay a quote' }, { pluginId: BUNDLE_ID })
}
