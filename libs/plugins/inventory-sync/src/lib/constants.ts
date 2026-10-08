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

/** The plugin id, as `plugins.config.json` names it. Persisted; never rename. */
export const INVENTORY_SYNC_PLUGIN_ID = 'inventory-sync'

/** The plugin whose stock, catalog and orders this one syncs: commerce, reached only through core's seams. */
export const SELLER_PLUGIN_ID = 'commerce'

/** The console API prefix every route of this plugin sits under. */
export const INVENTORY_SYNC_API_PREFIX = 'inventory-sync'

export const INVENTORY_SYNC_API_ROUTES = {
  /** `GET ?hostId` — what the deployment offers, and the site's connection. */
  connection: `${INVENTORY_SYNC_API_PREFIX}/connection`,
  /** `POST` — connect with the merchant's own API keys (Cin7 Core, inFlow). */
  connectKeys: `${INVENTORY_SYNC_API_PREFIX}/connect/keys`,
  /** `POST` — start connecting Brightpearl: answers its consent page address. */
  connectOAuth: `${INVENTORY_SYNC_API_PREFIX}/connect/oauth`,
  /** `GET` — Brightpearl's redirect back; carries no bearer token. */
  oauthCallback: `${INVENTORY_SYNC_API_PREFIX}/oauth/callback`,
  /** `PATCH` — save the connection's settings; `DELETE` — disconnect it. */
  settings: `${INVENTORY_SYNC_API_PREFIX}/settings`,
  /** `GET ?hostId` — the system's locations and, for Brightpearl, warehouses. */
  locations: `${INVENTORY_SYNC_API_PREFIX}/locations`,
  /** `POST` — run the connection's stock, product and order work now. */
  syncNow: `${INVENTORY_SYNC_API_PREFIX}/sync-now`,
  /** `GET ?hostId` — the connection's recent activity, newest first. */
  log: `${INVENTORY_SYNC_API_PREFIX}/log`,
  /** `GET ?hostId&filter=attention` — orders that could not be sent. */
  orders: `${INVENTORY_SYNC_API_PREFIX}/orders`,
  /** `GET ?hostId&recordId` — where one order stands with the connected system. */
  order: `${INVENTORY_SYNC_API_PREFIX}/order`,
  /** `POST` — send one order now, or again after it failed. */
  orderSend: `${INVENTORY_SYNC_API_PREFIX}/order/send`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. Nothing is offered until the
 * token key is set; Brightpearl also needs the developer app Aglyn registers.
 *
 * - `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the
 *   first seals, the rest only open). Seals every stored key and grant.
 * - Brightpearl — the app's reference (its OAuth client id), the developer
 *   reference every call carries, and the client secret when the app has
 *   confidential OAuth on.
 */
export const INVENTORY_SYNC_ENV = {
  tokenKey: 'INVENTORY_SYNC_TOKEN_KEY',
  brightpearlAppRef: 'BRIGHTPEARL_APP_REF',
  brightpearlDevRef: 'BRIGHTPEARL_DEV_REF',
  brightpearlClientSecret: 'BRIGHTPEARL_CLIENT_SECRET',
} as const

/**
 * `inventorySyncConnections/{hostId}`: one site's connection — settings, the
 * sealed credential, the last stock count, cursors and leases. Top level and
 * closed to every client.
 */
export const INVENTORY_SYNC_CONNECTIONS_COLLECTION = 'inventorySyncConnections'

/** `…/{hostId}/log/{entryId}`: the connection's recent activity. */
export const INVENTORY_SYNC_LOG_SUBCOLLECTION = 'log'

/**
 * `inventorySyncOrders/{hostId}_{recordId}`: one paid order's hand-off to the
 * connected system — the lines sent, its id there, attempts. Top level and
 * closed to every client.
 */
export const INVENTORY_SYNC_ORDERS_COLLECTION = 'inventorySyncOrders'

/**
 * `inventorySyncProducts/{hostId}_{key}`: one product linked between the
 * store and the connected system — external id, the version last synced, the
 * store's product id. Top level and closed to every client.
 */
export const INVENTORY_SYNC_PRODUCTS_COLLECTION = 'inventorySyncProducts'

/** The plan entitlement: the plans that sell. No price of its own. */
export const INVENTORY_SYNC_ENTITLEMENT = 'commerce'

/** The console cron that syncs, as `/api/health/crons` lists it. */
export const INVENTORY_SYNC_JOB_ID = 'inventory-sync-sync'

/** The store-settings card's widget id. */
export const INVENTORY_SYNC_SETTINGS_WIDGET_ID = 'inventory-sync-connection'

/** The order dialog widget's id. */
export const INVENTORY_SYNC_ORDER_WIDGET_ID = 'inventory-sync-order'

/** How long a merchant has to finish Brightpearl's consent screen. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** How often stock is synced, either way. */
export const STOCK_INTERVAL_MS = 30 * 60 * 1000

/**
 * How often every count is set again, not only those that changed since the
 * last sync: a count the merchant edited by hand in the store drifts from the
 * system's until then.
 */
export const STOCK_FULL_INTERVAL_MS = 24 * 60 * 60 * 1000

/** How often products are synced. */
export const PRODUCTS_INTERVAL_MS = 6 * 60 * 60 * 1000

/** First retry after a failed call; doubles per consecutive failure. */
export const RETRY_BASE_MS = 5 * 60 * 1000

/** The longest a failing hand-off waits between attempts. */
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/** Failed sends after which an order stops and asks the merchant. */
export const SEND_MAX_ATTEMPTS = 6

/** A worker's lease on one order, or on one connection's stock or product run. */
export const LEASE_MS = 5 * 60 * 1000

/** Orders one tick works through. */
export const ORDERS_PER_TICK = 100

/** The most SKUs one stock run reads from a system. */
export const STOCK_MAX_SKUS = 5_000

/** The most products one product run creates or updates; the rest continue next run. */
export const PRODUCTS_PER_RUN = 50

/** Log rows kept per connection. */
export const LOG_ROWS_KEPT = 50
