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

/** The plugin's id, as `plugins.config.json` names it. */
export const POD_PLUGIN_ID = 'print-on-demand'

/**
 * The plan entitlement every surface is gated on: the plans that sell. A
 * print-on-demand service fills a store's orders, so a plan without commerce
 * has nothing for it to do. No price of its own, and no markup: the merchant
 * pays the service directly, at the service's own prices.
 */
export const POD_ENTITLEMENT = 'commerce'

/**
 * The plugin whose orders a service fills. Named as an id only: this plugin
 * never imports it, and a site with it off has nothing to fill.
 */
export const SELLER_PLUGIN_ID = 'commerce'

/** The console job that sends what is owed and asks after what was sent. */
export const POD_SYNC_JOB_ID = 'print-on-demand-sync'

/**
 * The plugin's top-level collections, each closed to every client by the
 * Firestore rules and erased with the workspace by `orgId`.
 */
export const POD_COLLECTIONS = {
  /** `{hostId}__{provider}`: a site's connection, the merchant's token sealed. */
  connections: 'podConnections',
  /** `{hostId}__{provider}__{sourceProductId}`: an imported product and its variants' costs. */
  links: 'podProductLinks',
  /** `{hostId}__{orderId}__{provider}`: the part of an order a service fills. */
  orders: 'podOrders',
} as const

/**
 * Where the services serve product photos from: the only hosts an imported
 * product's photos are fetched from, to be copied into the site's library.
 */
export const POD_IMAGE_ORIGINS = ['https://files.cdn.printful.com', 'https://images-api.printify.com'] as const
