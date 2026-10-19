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
  type NativeNavContribution,
  type NativeNavCreateContribution,
  type NativeNavElsewhere,
  nativeNavHubSection,
  nativeNavIcon,
  nativeNavRef,
} from '@aglyn/aglyn/app-utils/native-nav'

/**
 * Orders and Products in the native apps' navigation (AGL-3943): the rows this plugin
 * adds to the manifest the shells draw, placed into the core's lists by
 * `order` (`assembleNativeNav`, `generate:native-contracts`). Labels are the
 * console's words, held by `apps/console/specs/native-nav-manifest.spec.ts`.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */

export const NATIVE_NAV_ROWS: readonly NativeNavContribution[] = [
  {
    list: 'site',
    group: 'sell',
    row: {
      id: 'orders',
      label: 'Orders',
      icon: nativeNavIcon('bag', 'shopping_bag'),
      screen: 'commerce.orders',
      pluginId: 'commerce',
      order: 10,
      sections: [
        nativeNavHubSection('host', '/products', 'orders', 'Orders', 'commerce.orders'),
        nativeNavHubSection('host', '/products', 'returns', 'Returns', 'commerce.returns'),
        nativeNavHubSection('host', '/products', 'reservations', 'Reservations', 'commerce.reservations'),
      ],
      docs: '/commerce-and-bookings/commerce/overview',
      console: nativeNavRef('hostPluginSection', '/products/orders'),
    },
  },
  {
    list: 'site',
    group: 'sell',
    row: {
      id: 'products',
      label: 'Products',
      icon: nativeNavIcon('tag', 'sell'),
      screen: 'commerce.products',
      pluginId: 'commerce',
      order: 20,
      keywords: ['catalog', 'stock', 'inventory'],
      sections: [
        nativeNavHubSection('host', '/products', 'catalog', 'Catalog', 'commerce.products'),
        nativeNavHubSection('host', '/products', 'promotions', 'Promotions', 'commerce.promotions'),
        nativeNavHubSection('host', '/products', 'analytics', 'Analytics', 'commerce.sales'),
      ],
      actions: [
        {
          id: 'scan',
          label: 'Scan stock',
          icon: nativeNavIcon('barcode.viewfinder', 'qr_code_scanner'),
          screen: 'commerce.scan',
        },
        {
          id: 'newProduct',
          label: 'New product',
          icon: nativeNavIcon('plus', 'add'),
          screen: 'commerce.product',
          params: { new: '1' },
        },
      ],
      docs: '/commerce-and-bookings/commerce/overview',
      console: nativeNavRef('hostPluginTab', '/products'),
    },
  },
]

/** The console's POS tab is the register app's, not a row of this one. */
export const NATIVE_NAV_ELSEWHERE: readonly NativeNavElsewhere[] = [
  { console: nativeNavRef('hostPluginTab', '/pos'), where: 'The POS app' },
]

/** A product ("Add product" on Catalog) and a draft order ("Draft order" on Orders). */
export const NATIVE_NAV_CREATE: readonly NativeNavCreateContribution[] = [
  {
    scope: 'site',
    item: {
      id: 'product',
      label: 'Product',
      icon: nativeNavIcon('tag', 'sell'),
      screen: 'commerce.product',
      params: { new: '1' },
      pluginId: 'commerce',
      planFeature: 'commerce',
      order: 20,
      console: nativeNavRef('hostPluginSection', '/products/catalog'),
    },
  },
  {
    scope: 'site',
    item: {
      id: 'draftOrder',
      label: 'Draft order',
      icon: nativeNavIcon('link.badge.plus', 'link'),
      screen: 'commerce.orders',
      params: { new: '1' },
      pluginId: 'commerce',
      planFeature: 'commerce',
      order: 30,
      console: nativeNavRef('hostPluginSection', '/products/orders'),
    },
  },
]
