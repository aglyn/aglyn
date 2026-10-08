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
export const DELIVERY_APPS_PLUGIN_ID = 'delivery-apps'

/** The plugin whose orders and products this one reaches, only ever through core's seams. */
export const SELLER_PLUGIN_ID = 'commerce'

/** The console API prefix every route of this plugin sits under. */
export const DELIVERY_APPS_API_PREFIX = 'delivery-apps'

export const DELIVERY_APPS_API_ROUTES = {
  /** `GET ?hostId` — what the deployment offers, and the site's connected stores. */
  stores: `${DELIVERY_APPS_API_PREFIX}/stores`,
  /** `POST` — connect or update a store; `DELETE` — disconnect it. */
  store: `${DELIVERY_APPS_API_PREFIX}/store`,
  /** `POST` — send the store's menu, built from the catalog, to the service. */
  menu: `${DELIVERY_APPS_API_PREFIX}/menu`,
  /** `GET ?hostId&service` — the service's items and the product each is matched to; `POST` — match one. */
  items: `${DELIVERY_APPS_API_PREFIX}/items`,
  /** `GET ?hostId&q` — catalog offers to match an item to. */
  catalog: `${DELIVERY_APPS_API_PREFIX}/catalog`,
  /** `GET ?hostId` — the register's queue: open delivery orders and the latest finished ones. */
  queue: `${DELIVERY_APPS_API_PREFIX}/queue`,
  /** `POST { hostId, orderId, action }` — accept, reject, ready, picked up, retry. */
  orderAction: `${DELIVERY_APPS_API_PREFIX}/order-action`,
  /** `POST` — each service's webhook; verified by the service's own signature, no session. */
  webhookDoordash: `${DELIVERY_APPS_API_PREFIX}/webhooks/doordash`,
  webhookUberEats: `${DELIVERY_APPS_API_PREFIX}/webhooks/uber-eats`,
  webhookGrubhub: `${DELIVERY_APPS_API_PREFIX}/webhooks/grubhub`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. None is public. Each service
 * needs a partner (integration provider) account Aglyn holds with it, and is
 * offered only when every variable it names is set; with none set, the
 * plugin draws nothing, page or docs, and every route answers 404.
 *
 * `…_ENVIRONMENT=sandbox` marks that service's orders as test orders (and
 * points Grubhub at its pre-production host).
 */
export const DELIVERY_APPS_ENV = {
  doordashDeveloperId: 'DELIVERY_APPS_DOORDASH_DEVELOPER_ID',
  doordashKeyId: 'DELIVERY_APPS_DOORDASH_KEY_ID',
  doordashSigningSecret: 'DELIVERY_APPS_DOORDASH_SIGNING_SECRET',
  doordashWebhookSecret: 'DELIVERY_APPS_DOORDASH_WEBHOOK_SECRET',
  doordashProviderType: 'DELIVERY_APPS_DOORDASH_PROVIDER_TYPE',
  doordashEnvironment: 'DELIVERY_APPS_DOORDASH_ENVIRONMENT',
  uberEatsClientId: 'DELIVERY_APPS_UBER_EATS_CLIENT_ID',
  uberEatsClientSecret: 'DELIVERY_APPS_UBER_EATS_CLIENT_SECRET',
  uberEatsEnvironment: 'DELIVERY_APPS_UBER_EATS_ENVIRONMENT',
  grubhubClientId: 'DELIVERY_APPS_GRUBHUB_CLIENT_ID',
  grubhubSecretKey: 'DELIVERY_APPS_GRUBHUB_SECRET_KEY',
  grubhubPartnerKey: 'DELIVERY_APPS_GRUBHUB_PARTNER_KEY',
  grubhubEnvironment: 'DELIVERY_APPS_GRUBHUB_ENVIRONMENT',
} as const

/**
 * `deliveryAppStores/{service}_{hash}`: one site's store on one service —
 * the service's store id, the merchant's settings, the item matches and the
 * menu's last send. Keyed by the service's store id, so a webhook finds its
 * site in one read and one service store belongs to one site. Top level and
 * closed to every client.
 */
export const DELIVERY_APP_STORES_COLLECTION = 'deliveryAppStores'

/**
 * `deliveryAppOrders/{service}_{hash}`: one service order and the store
 * order it became, with where it stands with the service. Top level and
 * closed to every client.
 */
export const DELIVERY_APP_ORDERS_COLLECTION = 'deliveryAppOrders'

/** The plan entitlement: the plans with the register. No price of its own. */
export const DELIVERY_APPS_ENTITLEMENT = 'pos'

/** The console cron that retries service calls and closes orders long since collected. */
export const DELIVERY_APPS_JOB_ID = 'delivery-apps-orders'

/** The store-settings card's widget id. */
export const DELIVERY_APPS_SETTINGS_WIDGET_ID = 'delivery-apps-stores'

/** The register queue's widget id. */
export const DELIVERY_APPS_QUEUE_WIDGET_ID = 'delivery-apps-queue'

/** The register asks for its queue this often. */
export const QUEUE_POLL_MS = 10_000

/** A ready order the courier has surely taken by now is closed as picked up. */
export const AUTO_COMPLETE_MS = 2 * 60 * 60 * 1000

/** First retry of a failed service call; doubles per attempt. */
export const RETRY_BASE_MS = 30 * 1000

/** The longest a failing call waits between attempts. */
export const RETRY_MAX_MS = 15 * 60 * 1000

/** Failed attempts after which a call stops and waits for staff. */
export const MAX_ATTEMPTS = 6

/** A worker's hold on one order while it talks to the service. */
export const LEASE_MS = 60 * 1000

/** Orders one tick of the job works through. */
export const ORDERS_PER_TICK = 50

/** Finished orders the register lists beneath the open ones. */
export const RECENT_ORDERS = 10

/** Open orders the register lists at most. */
export const OPEN_ORDERS = 50

/** Unmatched service items kept per store for the merchant to match. */
export const UNMATCHED_KEPT = 200

/** The most offers a menu or an item search reads from the catalog. */
export const CATALOG_MAX_OFFERS = 2_000

/** How far a signed request's time may stray from ours before it is refused as a replay. */
export const SIGNATURE_SKEW_MS = 5 * 60 * 1000

/** Prep time a store starts with, in minutes. */
export const DEFAULT_PREP_MINUTES = 15
