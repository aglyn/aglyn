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
export const COURIERS_PLUGIN_ID = 'couriers'

/** The plugin whose local deliveries a courier takes: commerce, reached only through core's seams. */
export const SELLER_PLUGIN_ID = 'commerce'

/** The plan entitlement: the plans that sell. No price of its own. */
export const COURIERS_ENTITLEMENT = 'commerce'

/** The console API prefix every route of this plugin sits under. */
export const COURIERS_API_PREFIX = 'couriers'

export const COURIERS_API_ROUTES = {
  /** `GET ?hostId` — whether the deployment offers couriers, and the site's connection. */
  connection: `${COURIERS_API_PREFIX}/connection`,
  /** `POST` — save a provider's keys (live, test or both), test them, connect. */
  connect: `${COURIERS_API_PREFIX}/connect`,
  /** `POST` — test the stored keys again. */
  test: `${COURIERS_API_PREFIX}/test`,
  /** `POST` — the pickup phone and the note every courier gets. */
  settings: `${COURIERS_API_PREFIX}/settings`,
  /** `POST` — a new webhook token, shown once. */
  webhookToken: `${COURIERS_API_PREFIX}/webhook-token`,
  /** `POST` — forget the keys. */
  disconnect: `${COURIERS_API_PREFIX}/disconnect`,
  /** `GET ?hostId&orderId` — the courier on one order, and its last quote. */
  order: `${COURIERS_API_PREFIX}/order`,
  /** `POST` — a courier's price and arrival estimate for one order. */
  quote: `${COURIERS_API_PREFIX}/quote`,
  /** `POST` — book the quoted courier. Keyed: a retry never books a second. */
  dispatch: `${COURIERS_API_PREFIX}/dispatch`,
  /** `POST` — call the courier off. */
  cancel: `${COURIERS_API_PREFIX}/cancel`,
  /** `POST` — ask the courier where the run stands now. */
  refresh: `${COURIERS_API_PREFIX}/refresh`,
  /** `POST ?site` — DoorDash Drive's webhook; verified by the Authorization it carries. */
  webhookDoordash: `${COURIERS_API_PREFIX}/webhooks/doordash`,
} as const

export type CouriersRoute = (typeof COURIERS_API_ROUTES)[keyof typeof COURIERS_API_ROUTES]

/**
 * Env the plugin reads, on the CONSOLE only. Not public. Nothing is offered
 * until it is set: there is no vendor account of Aglyn's, only the key each
 * merchant's own keys are sealed under.
 *
 * - `tokenKey` — 32 random bytes, base64 (`NEW,OLD` to rotate: the first
 *   seals, every key listed opens).
 */
export const COURIERS_ENV = {
  tokenKey: 'COURIERS_TOKEN_KEY',
} as const

/**
 * `courierConnections/{hostId}_{provider}`: one site's connection to the
 * merchant's own courier account — the sealed keys (live and test), the
 * webhook token's hash, the pickup phone. Top level and closed to every client.
 */
export const COURIER_CONNECTIONS_COLLECTION = 'courierConnections'

/**
 * `courierDeliveries/{hostId}_{orderId}`: one order's courier — the quote
 * offered, the run booked (one at a time), and the runs before it. Top level
 * and closed to every client.
 */
export const COURIER_DELIVERIES_COLLECTION = 'courierDeliveries'

/** The store-settings card's widget id. */
export const COURIERS_SETTINGS_WIDGET_ID = 'couriers-connection'

/** The order dialog widget's id. */
export const COURIERS_ORDER_WIDGET_ID = 'couriers-order'

/** The Pickup & delivery queue row widget's id. */
export const COURIERS_ROW_WIDGET_ID = 'couriers-row'

/** The console cron that follows open runs and calls off the ones a refund or cancel ended. */
export const COURIERS_JOB_ID = 'couriers-sync'

/**
 * How long a quote is held when the courier names no expiry. DoorDash Drive
 * honours a quote for five minutes; the console refuses to book on one older.
 */
export const QUOTE_TTL_MS = 5 * 60 * 1000

/** How long an open run goes unread before the job asks the courier where it stands. */
export const RUN_POLL_MS = 10 * 60 * 1000

/** How long a run whose booking answer was lost is left before the job reconciles it. */
export const RECONCILE_AFTER_MS = 60 * 1000

/** Webhook event keys remembered per order, so a redelivered event is a no-op. */
export const SEEN_EVENTS_KEPT = 40

/** Earlier runs kept on an order's record. */
export const HISTORY_KEPT = 10

/** Open runs one tick works through. */
export const RUNS_PER_TICK = 100
