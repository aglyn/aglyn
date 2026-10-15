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

/** The plugin id, as `plugins.config.json` names it. */
export const HELP_DESKS_PLUGIN_ID = 'help-desks'

/** The console API prefix every route of this plugin sits under. */
export const HELP_DESKS_API_PREFIX = 'help-desks'

export const HELP_DESKS_API_ROUTES = {
  /** GET a site's connections; POST connect with the merchant's own credential. */
  connections: `${HELP_DESKS_API_PREFIX}/connections`,
  /** PATCH settings, DELETE disconnect. */
  connection: `${HELP_DESKS_API_PREFIX}/connection`,
  /** POST: run a connection's sync now. */
  syncNow: `${HELP_DESKS_API_PREFIX}/sync-now`,
  /** GET a connection's recent runs and errors. */
  log: `${HELP_DESKS_API_PREFIX}/log`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. Not public.
 *
 * - `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the
 *   first seals, the rest only open). Seals every merchant's help desk
 *   credential at rest. Without it nothing can be connected, and the card
 *   draws nothing.
 */
export const HELP_DESKS_ENV = {
  tokenKey: 'HELP_DESKS_TOKEN_KEY',
} as const

/**
 * `helpDeskConnections/{hostId}_{provider}`: one site's connection to one
 * help desk — settings, status, cursors and the sealed credential.
 * Top-level and closed to every client; org-keyed for the workspace erasure.
 */
export const HELP_DESK_CONNECTIONS_COLLECTION = 'helpDeskConnections'

/** `…/{connectionId}/log/{runId}`: the connection's recent runs and errors. */
export const HELP_DESK_LOG_SUBCOLLECTION = 'log'

/**
 * `helpDeskOutbox/{connectionId}_{kind}_{key}`: an order or a contact form
 * message owed to one connection, written by the server declarations (which
 * hold no credential) and delivered by the console job (which does).
 */
export const HELP_DESK_OUTBOX_COLLECTION = 'helpDeskOutbox'

/**
 * `helpDeskCustomers/{connectionId}_{emailHash}`: what one connection knows
 * of one buyer — the help desk's id for them and their latest orders, so
 * each push carries the recent orders and not only the newest.
 */
export const HELP_DESK_CUSTOMERS_COLLECTION = 'helpDeskCustomers'

/** People read per page of the people walk. */
export const SYNC_PAGE_SIZE = 100

/** Orders read per page of the order backfill. */
export const ORDER_PAGE_SIZE = 100

/** Pages (people or orders) a single run may take before it yields to the next tick. */
export const SYNC_MAX_PAGES_PER_RUN = 10

/** Outbox items delivered per connection per run. */
export const OUTBOX_PER_RUN = 100

/** Attempts before an outbox item is given up and logged. */
export const OUTBOX_MAX_ATTEMPTS = 8

/** How far back the first sync reads a site's orders. */
export const ORDER_BACKFILL_DAYS = 90

/** Orders each buyer carries to the help desk: the newest first. */
export const RECENT_ORDERS_KEPT = 10

/** How often a healthy connection syncs. The console job ticks every 15 minutes. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000

/** First retry after a failed run; doubles per consecutive failure. */
export const SYNC_BACKOFF_BASE_MS = 5 * 60 * 1000

/** The longest a failing connection waits between attempts. */
export const SYNC_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000

/** Consecutive failures after which a connection is stopped with an error the card shows. */
export const SYNC_MAX_CONSECUTIVE_FAILURES = 12

/** A run's lease: another tick will not start the same connection inside it. */
export const SYNC_LEASE_MS = 10 * 60 * 1000

/** Connections a tick starts. */
export const SYNC_CONNECTIONS_PER_TICK = 25

/** Log rows kept per connection. */
export const LOG_ROWS_KEPT = 50

/** Log rows one read of the log route answers: every row kept, so the card pages them itself. */
export const LOG_PAGE_LIMIT = 50

/** Pages a "Sync now" runs inside the request; the rest continues on the next tick. */
export const SYNC_NOW_MAX_PAGES = 2

/** An owed order or message older than this is dropped rather than delivered. */
export const OUTBOX_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The plan entitlement a site's connection needs: the store's. A connection
 * carries buyers and their orders, which only a plan with the store keeps —
 * so it is sold where the orders are, at no price of its own.
 */
export const HELP_DESKS_ENTITLEMENT = 'commerce'

/** The console cron that runs every connection's sync, as `/api/health/crons` lists it. */
export const HELP_DESKS_SYNC_JOB_ID = 'help-desks-sync'

/** The setup-page widget the connections card is drawn in. */
export const HELP_DESKS_WIDGET_ID = 'help-desks-connections'
