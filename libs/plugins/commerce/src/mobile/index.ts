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

/*
 * The commerce plugin's surface in the Aglyn app (AGL-3621): orders,
 * products and stock, the barcode scanner, and sales. Reached only through
 * the app's generated mobile manifest — never re-exported from `src/index.ts`
 * or any web entry, so no byte of it reaches a web bundle — and every screen
 * is loaded the first time it is opened.
 */

import {
  registerMobileDashboardWidget,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
  registerMobileTab,
} from '@aglyn/mobile-plugin-host'
import {
  COMMERCE_NEW_PRODUCT_ACTION,
  COMMERCE_ORDER_SCREEN,
  COMMERCE_ORDERS_ACTION,
  COMMERCE_ORDERS_LINK,
  COMMERCE_ORDERS_SCREEN,
  COMMERCE_ORDERS_TAB,
  COMMERCE_PRODUCT_SCREEN,
  COMMERCE_PRODUCTS_LINK,
  COMMERCE_PRODUCTS_SCREEN,
  COMMERCE_PRODUCTS_TAB,
  COMMERCE_SALES_SCREEN,
  COMMERCE_SALES_WIDGET,
  COMMERCE_SCAN_ACTION,
  COMMERCE_SCAN_SCREEN,
  COMMERCE_TODAY_WIDGET,
  NEW_PRODUCT_ID,
} from './screen-ids'

export * from './screen-ids'

const pluginId = 'commerce'

export function registerCommerceMobile(): void {
  registerMobileScreen({
    pluginId,
    id: COMMERCE_ORDERS_SCREEN,
    title: 'Orders',
    requiresSite: true,
    load: () => import('./orders/orders-screen'),
  })
  registerMobileScreen({
    pluginId,
    id: COMMERCE_ORDER_SCREEN,
    title: 'Order',
    requiresSite: true,
    load: () => import('./orders/order-detail'),
  })
  registerMobileScreen({
    pluginId,
    id: COMMERCE_PRODUCTS_SCREEN,
    title: 'Products',
    requiresSite: true,
    load: () => import('./products/products-screen'),
  })
  registerMobileScreen({
    pluginId,
    id: COMMERCE_PRODUCT_SCREEN,
    title: 'Product',
    requiresSite: true,
    load: () => import('./products/product-editor'),
  })
  registerMobileScreen({
    pluginId,
    id: COMMERCE_SCAN_SCREEN,
    title: 'Scan',
    requiresSite: true,
    load: () => import('./products/scan-screen'),
  })
  registerMobileScreen({
    pluginId,
    id: COMMERCE_SALES_SCREEN,
    title: 'Sales',
    requiresSite: true,
    load: () => import('./sales/sales-screen'),
  })

  registerMobileTab({ pluginId, id: COMMERCE_ORDERS_TAB, title: 'Orders', icon: 'receipt-outline', screen: COMMERCE_ORDERS_SCREEN, order: 100 })
  registerMobileTab({ pluginId, id: COMMERCE_PRODUCTS_TAB, title: 'Products', icon: 'pricetags-outline', screen: COMMERCE_PRODUCTS_SCREEN, order: 110 })

  registerMobileDashboardWidget({
    pluginId,
    id: COMMERCE_TODAY_WIDGET,
    title: 'Today',
    order: 100,
    size: 'half',
    requiresSite: true,
    load: () => import('./sales/widgets').then((module) => ({ default: module.TodayWidget })),
  })
  registerMobileDashboardWidget({
    pluginId,
    id: COMMERCE_SALES_WIDGET,
    title: 'Last 7 days',
    order: 110,
    size: 'half',
    requiresSite: true,
    load: () => import('./sales/widgets').then((module) => ({ default: module.SalesTrendWidget })),
  })

  registerMobileQuickAction({
    pluginId,
    id: COMMERCE_ORDERS_ACTION,
    title: 'Ship orders',
    icon: 'cube-outline',
    order: 100,
    requiresSite: true,
    screen: COMMERCE_ORDERS_SCREEN,
    params: { filter: 'unfulfilled' },
  })
  registerMobileQuickAction({
    pluginId,
    id: COMMERCE_NEW_PRODUCT_ACTION,
    title: 'New product',
    icon: 'add-circle-outline',
    order: 110,
    requiresSite: true,
    screen: COMMERCE_PRODUCT_SCREEN,
    params: { productId: NEW_PRODUCT_ID },
  })
  registerMobileQuickAction({
    pluginId,
    id: COMMERCE_SCAN_ACTION,
    title: 'Scan stock',
    icon: 'barcode-outline',
    order: 120,
    requiresSite: true,
    screen: COMMERCE_SCAN_SCREEN,
  })

  // The console's commerce pages open natively from a link or a notification.
  registerMobileDeepLink({ pluginId, id: COMMERCE_ORDERS_LINK, path: '/products/orders', screen: COMMERCE_ORDERS_SCREEN })
  registerMobileDeepLink({ pluginId, id: COMMERCE_PRODUCTS_LINK, path: '/products', screen: COMMERCE_PRODUCTS_SCREEN })
}
