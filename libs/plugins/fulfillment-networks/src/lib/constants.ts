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
export const FULFILLMENT_NETWORKS_PLUGIN_ID = 'fulfillment-networks'

/** The plugin whose orders this one routes: commerce, reached only through core's seams. */
export const SELLER_PLUGIN_ID = 'commerce'

/** The console API prefix every route of this plugin sits under. */
export const FULFILLMENT_NETWORKS_API_PREFIX = 'fulfillment-networks'

export const FULFILLMENT_NETWORKS_API_ROUTES = {
  /** `GET ?hostId` — what the deployment offers, and the site's connections. */
  connections: `${FULFILLMENT_NETWORKS_API_PREFIX}/connections`,
  /** `PATCH` — save a connection's settings; `DELETE` — disconnect it. */
  connection: `${FULFILLMENT_NETWORKS_API_PREFIX}/connection`,
  /** `POST` — start connecting: answers the network's consent page address. */
  connect: `${FULFILLMENT_NETWORKS_API_PREFIX}/connect`,
  /** `GET` or `POST` — the network's redirect back; carries no bearer token. */
  oauthCallback: `${FULFILLMENT_NETWORKS_API_PREFIX}/oauth/callback`,
  /** `POST` — run a connection's work now: orders due, and a stock count. */
  syncNow: `${FULFILLMENT_NETWORKS_API_PREFIX}/sync-now`,
  /** `GET ?hostId&provider` — a connection's recent activity, newest first. */
  log: `${FULFILLMENT_NETWORKS_API_PREFIX}/log`,
  /** `GET ?hostId&recordId` — where one order stands with each network. */
  order: `${FULFILLMENT_NETWORKS_API_PREFIX}/order`,
  /** `POST` — send one order's lines to a network now. */
  orderSend: `${FULFILLMENT_NETWORKS_API_PREFIX}/order/send`,
  /** `POST` — ask a network to cancel what it holds of one order. */
  orderCancel: `${FULFILLMENT_NETWORKS_API_PREFIX}/order/cancel`,
  /** `POST` — ShipBob's webhook; verified by the token its address carries. */
  webhookShipbob: `${FULFILLMENT_NETWORKS_API_PREFIX}/webhooks/shipbob`,
  /** `POST` — connect a network that takes the merchant's own API key (ShipMonk). */
  connectKey: `${FULFILLMENT_NETWORKS_API_PREFIX}/connect-key`,
  /** `POST` — mint a new webhook signing secret for an API-key network, shown once. */
  webhookSecret: `${FULFILLMENT_NETWORKS_API_PREFIX}/webhook-secret`,
  /** `POST` — ShipMonk's webhook; verified by its `X-Sm-Signature` HMAC. */
  webhookShipmonk: `${FULFILLMENT_NETWORKS_API_PREFIX}/webhooks/shipmonk`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. None is public, and nothing is
 * offered until the token key and at least one network's app are set.
 *
 * - `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the
 *   first seals, the rest only open). Seals every grant at rest.
 * - ShipBob — the developer app's client id and secret, and `sandbox` to
 *   point everything at ShipBob's sandbox.
 * - Amazon — the selling-partner app's id and its Login with Amazon client,
 *   the region its sellers are in, and `sandbox` for Amazon's sandbox.
 * - ShipMonk (AGL-3697) — no app: each merchant pastes their own store's API
 *   key. `SHIPMONK_ENABLED=true` offers it (with the token key), and
 *   `sandbox` points everything at ShipMonk's sandbox.
 */
export const FULFILLMENT_NETWORKS_ENV = {
  tokenKey: 'FULFILLMENT_NETWORKS_TOKEN_KEY',
  shipbobClientId: 'SHIPBOB_CLIENT_ID',
  shipbobClientSecret: 'SHIPBOB_CLIENT_SECRET',
  shipbobEnvironment: 'SHIPBOB_ENVIRONMENT',
  amazonApplicationId: 'AMAZON_SP_API_APPLICATION_ID',
  amazonClientId: 'AMAZON_SP_API_LWA_CLIENT_ID',
  amazonClientSecret: 'AMAZON_SP_API_LWA_CLIENT_SECRET',
  amazonRegion: 'AMAZON_SP_API_REGION',
  amazonEnvironment: 'AMAZON_SP_API_ENVIRONMENT',
  amazonDraftApp: 'AMAZON_SP_API_DRAFT_APP',
  shipmonkEnabled: 'SHIPMONK_ENABLED',
  shipmonkEnvironment: 'SHIPMONK_ENVIRONMENT',
} as const

/**
 * `fulfillmentNetworkConnections/{hostId}_{provider}`: one site's connection
 * to one network — settings, the sealed grant, the webhook token's hash, the
 * last stock count. Top level and closed to every client.
 */
export const FULFILLMENT_NETWORK_CONNECTIONS_COLLECTION = 'fulfillmentNetworkConnections'

/** `…/{connectionId}/log/{entryId}`: the connection's recent activity. */
export const FULFILLMENT_NETWORK_LOG_SUBCOLLECTION = 'log'

/**
 * `fulfillmentNetworkOrders/{hostId}_{orderId}_{provider}`: one order's
 * hand-off to one network — the lines sent, the network's order, the
 * shipments read back. Top level and closed to every client.
 */
export const FULFILLMENT_NETWORK_ORDERS_COLLECTION = 'fulfillmentNetworkOrders'

/** The plan entitlement: the plans that sell. No price of its own. */
export const FULFILLMENT_NETWORKS_ENTITLEMENT = 'commerce'

/** The console cron that sends, reads back and counts, as `/api/health/crons` lists it. */
export const FULFILLMENT_NETWORKS_JOB_ID = 'fulfillment-networks-sync'

/** The store-settings card's widget id. */
export const FULFILLMENT_NETWORKS_SETTINGS_WIDGET_ID = 'fulfillment-networks-connections'

/** The order dialog widget's id. */
export const FULFILLMENT_NETWORKS_ORDER_WIDGET_ID = 'fulfillment-networks-order'

/** How long a merchant has to finish a network's consent screen. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** How often an order a network holds is read back while nothing has shipped. */
export const ORDER_POLL_MS = 15 * 60 * 1000

/** How often a shipped parcel's tracking is read until it arrives. */
export const TRACKING_POLL_MS = 2 * 60 * 60 * 1000

/** How long after its last shipment a parcel is followed before it is left alone. */
export const TRACKING_FOLLOW_MS = 30 * 24 * 60 * 60 * 1000

/** First retry after a failed call; doubles per consecutive failure. */
export const RETRY_BASE_MS = 5 * 60 * 1000

/** The longest a failing hand-off waits between attempts. */
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/** Failed sends after which a hand-off stops and asks the merchant. */
export const SEND_MAX_ATTEMPTS = 6

/** A worker's lease on one hand-off or one stock count. */
export const LEASE_MS = 5 * 60 * 1000

/** Hand-offs one tick works through. */
export const ORDERS_PER_TICK = 100

/** How often a connection's stock is counted. */
export const INVENTORY_INTERVAL_MS = 60 * 60 * 1000

/** The most SKUs one count reads from a network. */
export const INVENTORY_MAX_SKUS = 5_000

/** Log rows kept per connection. */
export const LOG_ROWS_KEPT = 50
