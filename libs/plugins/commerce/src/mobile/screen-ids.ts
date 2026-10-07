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
 * The commerce plugin's mobile contribution ids (AGL-3621). Named here, apart
 * from the registrar, so a screen can open another without importing the
 * registrar that lazily imports it.
 */

export const COMMERCE_ORDERS_SCREEN = 'commerce.orders'
export const COMMERCE_ORDER_SCREEN = 'commerce.order'
export const COMMERCE_PRODUCTS_SCREEN = 'commerce.products'
export const COMMERCE_PRODUCT_SCREEN = 'commerce.product'
export const COMMERCE_SCAN_SCREEN = 'commerce.scan'
export const COMMERCE_SALES_SCREEN = 'commerce.sales'

export const COMMERCE_ORDERS_TAB = 'commerce.orders-tab'
export const COMMERCE_PRODUCTS_TAB = 'commerce.products-tab'

export const COMMERCE_TODAY_WIDGET = 'commerce.today'
export const COMMERCE_SALES_WIDGET = 'commerce.sales-trend'

export const COMMERCE_NEW_PRODUCT_ACTION = 'commerce.new-product'
export const COMMERCE_SCAN_ACTION = 'commerce.scan'
export const COMMERCE_ORDERS_ACTION = 'commerce.orders-to-ship'

export const COMMERCE_ORDERS_LINK = 'commerce.orders-page'
export const COMMERCE_PRODUCTS_LINK = 'commerce.products-page'

/** The param a product screen reads for a product being created rather than edited. */
export const NEW_PRODUCT_ID = 'new'
