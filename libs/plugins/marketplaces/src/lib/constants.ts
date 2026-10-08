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
export const MARKETPLACES_PLUGIN_ID = 'marketplaces'

/** The plugin whose orders and products this one reaches, only ever through core's seams. */
export const SELLER_PLUGIN_ID = 'commerce'

/** The console API prefix every route of this plugin sits under. */
export const MARKETPLACES_API_PREFIX = 'marketplaces'

export const MARKETPLACES_API_ROUTES = {
  /** `GET ?hostId` — what the deployment offers, and the site's connections. */
  connections: `${MARKETPLACES_API_PREFIX}/connections`,
  /** `PATCH` — save a connection's settings; `DELETE` — disconnect it. */
  connection: `${MARKETPLACES_API_PREFIX}/connection`,
  /** `POST` — start connecting: answers the marketplace's consent page address. */
  connect: `${MARKETPLACES_API_PREFIX}/connect`,
  /** `GET` or `POST` — the marketplace's redirect back; carries no bearer token. */
  oauthCallback: `${MARKETPLACES_API_PREFIX}/oauth/callback`,
  /** `POST` — run a connection now: orders, shipments and listings. */
  syncNow: `${MARKETPLACES_API_PREFIX}/sync-now`,
  /** `GET ?hostId&marketplace` — the connection's recent activity and the listings to look at. */
  activity: `${MARKETPLACES_API_PREFIX}/activity`,
  /** `GET ?hostId&recordId` — where one order stands with the marketplace it came from. */
  order: `${MARKETPLACES_API_PREFIX}/order`,
  /** `POST` — send an order's shipments to its marketplace again. */
  orderRetry: `${MARKETPLACES_API_PREFIX}/order/retry`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. None is public, and nothing is
 * offered until the token key and at least one marketplace's app are set.
 *
 * - `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the
 *   first seals, the rest only open). Seals every grant at rest.
 * - Per marketplace, the app the deployment registered there, and
 *   `…_ENVIRONMENT=sandbox` to point that marketplace's connections at its
 *   sandbox where it has one.
 */
export const MARKETPLACES_ENV = {
  tokenKey: 'MARKETPLACES_TOKEN_KEY',
  amazonApplicationId: 'MARKETPLACES_AMAZON_APPLICATION_ID',
  amazonClientId: 'MARKETPLACES_AMAZON_LWA_CLIENT_ID',
  amazonClientSecret: 'MARKETPLACES_AMAZON_LWA_CLIENT_SECRET',
  amazonRegion: 'MARKETPLACES_AMAZON_REGION',
  amazonEnvironment: 'MARKETPLACES_AMAZON_ENVIRONMENT',
  amazonDraftApp: 'MARKETPLACES_AMAZON_DRAFT_APP',
  ebayClientId: 'MARKETPLACES_EBAY_CLIENT_ID',
  ebayClientSecret: 'MARKETPLACES_EBAY_CLIENT_SECRET',
  ebayRuName: 'MARKETPLACES_EBAY_RU_NAME',
  ebayEnvironment: 'MARKETPLACES_EBAY_ENVIRONMENT',
  ebayMarketplaceId: 'MARKETPLACES_EBAY_MARKETPLACE_ID',
  etsyKeystring: 'MARKETPLACES_ETSY_KEYSTRING',
  etsySharedSecret: 'MARKETPLACES_ETSY_SHARED_SECRET',
  tiktokAppKey: 'MARKETPLACES_TIKTOK_APP_KEY',
  tiktokAppSecret: 'MARKETPLACES_TIKTOK_APP_SECRET',
  tiktokServiceId: 'MARKETPLACES_TIKTOK_SERVICE_ID',
  tiktokRegion: 'MARKETPLACES_TIKTOK_REGION',
  walmartClientId: 'MARKETPLACES_WALMART_CLIENT_ID',
  walmartClientSecret: 'MARKETPLACES_WALMART_CLIENT_SECRET',
  walmartEnvironment: 'MARKETPLACES_WALMART_ENVIRONMENT',
  walmartChannelType: 'MARKETPLACES_WALMART_CHANNEL_TYPE',
  faireApplicationId: 'MARKETPLACES_FAIRE_APPLICATION_ID',
  faireApplicationSecret: 'MARKETPLACES_FAIRE_APPLICATION_SECRET',
} as const

/**
 * `marketplaceConnections/{hostId}_{marketplace}`: one site's connection to
 * one marketplace — settings, the sealed grant, the order cursor, the last
 * sync's counts. Top level and closed to every client.
 */
export const MARKETPLACE_CONNECTIONS_COLLECTION = 'marketplaceConnections'

/** `…/{connectionId}/log/{entryId}`: the connection's recent activity. */
export const MARKETPLACE_LOG_SUBCOLLECTION = 'log'

/**
 * `…/{connectionId}/listingState/{chunk}`: what each listing was last sent
 * and what the marketplace answered, a few hundred listings per document so
 * a sync reads a handful of documents however large the catalog.
 */
export const MARKETPLACE_LISTING_STATE_SUBCOLLECTION = 'listingState'

/**
 * `marketplaceOrders/{hostId}_{marketplace}_{key}`: one marketplace order
 * and the Aglyn order it became, with the shipments to confirm back. Top
 * level and closed to every client.
 */
export const MARKETPLACE_ORDERS_COLLECTION = 'marketplaceOrders'

/** The plan entitlement: the plans that sell. No price of its own. */
export const MARKETPLACES_ENTITLEMENT = 'commerce'

/** The console cron that imports, confirms and syncs, as `/api/health/crons` lists it. */
export const MARKETPLACES_JOB_ID = 'marketplaces-sync'

/** The store-settings card's widget id. */
export const MARKETPLACES_SETTINGS_WIDGET_ID = 'marketplaces-connections'

/** The order dialog widget's id. */
export const MARKETPLACES_ORDER_WIDGET_ID = 'marketplaces-order'

/** How long a merchant has to finish a marketplace's consent screen. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** How often a connection reads its marketplace's new orders. */
export const ORDERS_POLL_MS = 10 * 60 * 1000

/** How far back each order read reaches past the last one, for an order the marketplace dated late. */
export const ORDERS_OVERLAP_MS = 30 * 60 * 1000

/** How far back a fresh connection reads, so an order placed just before connecting comes in. */
export const ORDERS_FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000

/** Order pages one run reads before handing the rest to the next. */
export const ORDER_PAGES_PER_RUN = 5

/** How often listings are brought in line when nothing sold. */
export const LISTINGS_POLL_MS = 30 * 60 * 1000

/** The most products one listing sync offers a marketplace. */
export const LISTINGS_MAX_OFFERS = 5_000

/** Listings handed to an adapter at once. */
export const LISTINGS_BATCH = 50

/** Listing state documents per connection: each holds a slice of the catalog. */
export const LISTING_STATE_CHUNKS = 16

/** How long after a refusal a listing is tried again unchanged. */
export const LISTING_RETRY_MS = 6 * 60 * 60 * 1000

/** First retry after a failed run; doubles per consecutive failure. */
export const RETRY_BASE_MS = 5 * 60 * 1000

/** The longest a failing connection or shipment waits between attempts. */
export const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/** Failed confirmations after which a shipment stops and asks the merchant. */
export const SHIPMENT_MAX_ATTEMPTS = 6

/** How often a marketplace is asked for an order's fees until it says. */
export const FEES_POLL_MS = 12 * 60 * 60 * 1000

/** How long after an order its fees are asked for before giving up. */
export const FEES_FOLLOW_MS = 30 * 24 * 60 * 60 * 1000

/** A worker's lease on one connection or one order. */
export const LEASE_MS = 5 * 60 * 1000

/** Connections one tick works through. */
export const CONNECTIONS_PER_TICK = 25

/** Orders with work due one tick works through. */
export const ORDERS_PER_TICK = 100

/** Log rows kept per connection. */
export const LOG_ROWS_KEPT = 50
