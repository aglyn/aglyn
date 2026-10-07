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

/**
 * The console routes, under the `print-on-demand` prefix. A widget reaches
 * them as `/api/<route>`; the server registers the same strings.
 */
export const POD_API_ROUTES = {
  /** GET: whether the deployment can hold a connection, and the site's connections. */
  connections: 'print-on-demand/connections',
  /** POST: test a token with the service, and store it only if it works. */
  connect: 'print-on-demand/connect',
  /** POST: the stores a token can reach, to choose one before connecting. */
  stores: 'print-on-demand/stores',
  /** POST: how paid orders are sent, and whether re-syncs rewrite prices. */
  settings: 'print-on-demand/settings',
  /** POST: forget a connection's token. */
  disconnect: 'print-on-demand/disconnect',
  /** GET: one page of the service's products, marked with what is already imported. */
  catalog: 'print-on-demand/catalog',
  /** POST: import or re-sync products into the store. */
  importProducts: 'print-on-demand/import',
  /** GET: one page of the site's imported products. */
  imported: 'print-on-demand/imported',
  /** POST: stop filling a product through the service; the product stays. */
  unlink: 'print-on-demand/unlink',
  /** GET: the service behind one product, and each variant's cost. */
  productLink: 'print-on-demand/product-link',
  /** GET: the parts of one order the services fill. */
  order: 'print-on-demand/order',
  /** GET: one page of the site's service orders, newest first. */
  orders: 'print-on-demand/orders',
  /** POST: send, confirm, refresh or cancel one order at the service. */
  orderAction: 'print-on-demand/order/action',
  /** POST: Printful's webhook; verified by its URL token. */
  webhookPrintful: 'print-on-demand/webhooks/printful',
  /** POST: Printify's webhook; verified by its URL token and signature. */
  webhookPrintify: 'print-on-demand/webhooks/printify',
} as const

export type PodRoute = (typeof POD_API_ROUTES)[keyof typeof POD_API_ROUTES]
