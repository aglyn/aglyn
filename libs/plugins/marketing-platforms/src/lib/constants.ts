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
export const MARKETING_PLATFORMS_PLUGIN_ID = 'marketing-platforms'

/** The console API prefix every route of this plugin sits under. */
export const MARKETING_PLATFORMS_API_PREFIX = 'marketing-platforms'

export const MARKETING_PLATFORMS_API_ROUTES = {
  /** GET a site's connections; POST connect with an API key. */
  connections: `${MARKETING_PLATFORMS_API_PREFIX}/connections`,
  /** PATCH settings, DELETE disconnect. */
  connection: `${MARKETING_PLATFORMS_API_PREFIX}/connection`,
  /** POST: run a connection's sync on the next tick. */
  syncNow: `${MARKETING_PLATFORMS_API_PREFIX}/sync-now`,
  /** GET a connection's recent runs and errors. */
  log: `${MARKETING_PLATFORMS_API_PREFIX}/log`,
  /** POST: start an OAuth connect (env-gated per provider); answers the consent page address. */
  oauthStart: `${MARKETING_PLATFORMS_API_PREFIX}/oauth/start`,
  /** GET: the provider's redirect back. */
  oauthCallback: `${MARKETING_PLATFORMS_API_PREFIX}/oauth/callback`,
} as const

/**
 * Env the plugin reads, all on the CONSOLE only. None is public.
 *
 * - `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the
 *   first seals, the rest only open). Seals every merchant API key and OAuth
 *   token at rest. Without it nothing can be connected and the page says so.
 * - Mailchimp and Klaviyo OAuth — the app registrations. Without them a
 *   merchant connects with their own API key, which needs no app.
 * - Attentive — the partner app. Without it Attentive is not offered at all.
 * - Constant Contact — the app registered on Constant Contact's developer
 *   portal (AGL-3696). Its v3 API takes no merchant key, so without it
 *   Constant Contact is not offered at all, and the other providers are
 *   unaffected either way.
 */
export const MARKETING_PLATFORMS_ENV = {
  tokenKey: 'MARKETING_PLATFORMS_TOKEN_KEY',
  mailchimpClientId: 'MAILCHIMP_CLIENT_ID',
  mailchimpClientSecret: 'MAILCHIMP_CLIENT_SECRET',
  klaviyoClientId: 'KLAVIYO_CLIENT_ID',
  klaviyoClientSecret: 'KLAVIYO_CLIENT_SECRET',
  attentiveClientId: 'ATTENTIVE_CLIENT_ID',
  attentiveClientSecret: 'ATTENTIVE_CLIENT_SECRET',
  constantContactClientId: 'CONSTANT_CONTACT_CLIENT_ID',
  constantContactClientSecret: 'CONSTANT_CONTACT_CLIENT_SECRET',
} as const

/**
 * `marketingPlatformConnections/{hostId}_{provider}`: one site's connection
 * to one platform — settings, status, cursors and the sealed credential.
 * Top-level and closed to every client; org-keyed for the workspace erasure.
 */
export const MARKETING_PLATFORM_CONNECTIONS_COLLECTION = 'marketingPlatformConnections'

/** `…/{connectionId}/log/{runId}`: the connection's recent runs and errors. */
export const MARKETING_PLATFORM_LOG_SUBCOLLECTION = 'log'

/**
 * `marketingPlatformEvents/{connectionId}_{eventId}`: commerce events owed to
 * one connection, written by the event subscriber (no credential needed) and
 * delivered by the console job (which holds it).
 */
export const MARKETING_PLATFORM_EVENTS_COLLECTION = 'marketingPlatformEvents'

/** Contacts read per page of a sync. */
export const SYNC_PAGE_SIZE = 100

/** Pages a single run may take before it yields to the next tick. */
export const SYNC_MAX_PAGES_PER_RUN = 20

/** Events delivered per connection per run. */
export const EVENTS_PER_RUN = 200

/** Attempts before an event is given up and logged. */
export const EVENT_MAX_ATTEMPTS = 8

/** How often a healthy connection syncs. The console job ticks every 15 minutes. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000

/** First retry after a failed run; doubles per consecutive failure. */
export const SYNC_BACKOFF_BASE_MS = 5 * 60 * 1000

/** The longest a failing connection waits between attempts. */
export const SYNC_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000

/** Consecutive failures after which a connection is paused with an error the page shows. */
export const SYNC_MAX_CONSECUTIVE_FAILURES = 12

/** A run's lease: another tick will not start the same connection inside it. */
export const SYNC_LEASE_MS = 10 * 60 * 1000

/** Connections a tick starts. */
export const SYNC_CONNECTIONS_PER_TICK = 25

/** Log rows kept per connection. */
export const LOG_ROWS_KEPT = 50

/** How long a merchant has to finish a provider's consent screen. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/**
 * The plan entitlement a site's connection needs: the CRM's. A connection
 * copies the site's contacts and their consent, which only a plan with the
 * CRM keeps — so it is sold where the contacts are, at no price of its own.
 */
export const MARKETING_PLATFORMS_ENTITLEMENT = 'crm'

/** The console cron that runs every connection's sync, as `/api/health/crons` lists it. */
export const MARKETING_PLATFORMS_SYNC_JOB_ID = 'marketing-platforms-sync'

/** The setup-page widget the connections card is drawn in. */
export const MARKETING_PLATFORMS_WIDGET_ID = 'marketing-platforms-connections'

/** Pages a "Sync now" runs inside the request; the rest continues on the next tick. */
export const SYNC_NOW_MAX_PAGES = 2

/** Log rows one read of the log route answers: every row kept, so the card's table pages them itself. */
export const LOG_PAGE_LIMIT = 50

/** An owed event older than this is dropped rather than delivered: no flow acts on a week-old checkout. */
export const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
