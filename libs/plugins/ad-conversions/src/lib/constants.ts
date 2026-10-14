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
export const AD_CONVERSIONS_PLUGIN_ID = 'ad-conversions'

/** The console API prefix every route of this plugin sits under. */
export const AD_CONVERSIONS_API_PREFIX = 'ad-conversions'

export const AD_CONVERSIONS_API_ROUTES = {
  /** GET a site's connections and setup state; POST connect with an access token. */
  connections: `${AD_CONVERSIONS_API_PREFIX}/connections`,
  /** PATCH settings, DELETE disconnect. */
  connection: `${AD_CONVERSIONS_API_PREFIX}/connection`,
  /** POST: send one test event now, marked as a test. */
  testEvent: `${AD_CONVERSIONS_API_PREFIX}/test-event`,
} as const

/**
 * Env the plugin reads, on the CONSOLE only. Not public.
 *
 * `tokenKey` — 32 random bytes, base64 (comma-separated to rotate: the first
 * seals, the rest only open). Seals every merchant access token at rest.
 * Without it nothing can be connected and the card says so.
 */
export const AD_CONVERSIONS_ENV = {
  tokenKey: 'AD_CONVERSIONS_TOKEN_KEY',
} as const

/**
 * `adConversionConnections/{hostId}_{provider}`: one site's Conversions API
 * connection to one vendor — the sealed access token, its settings and what
 * it last sent. Top-level, closed to every client, org-keyed for erasure.
 */
export const AD_CONVERSION_CONNECTIONS_COLLECTION = 'adConversionConnections'

/**
 * `adConversionConsents/{hostId}_{orderKey}`: a checkout's advertising consent,
 * kept until its order is paid or the record expires. Written only for a
 * visitor whose consent granted advertising, on a site with a connection.
 */
export const AD_CONVERSION_CONSENTS_COLLECTION = 'adConversionConsents'

/**
 * `adConversionEvents/{connectionId}_{eventId}`: one conversion owed to one
 * connection, hashed at intake, delivered by the console job. The document id
 * is the de-duplication: a redelivered order event is owed once.
 */
export const AD_CONVERSION_EVENTS_COLLECTION = 'adConversionEvents'

/** How long a checkout's consent waits for its order to be paid. */
export const CONSENT_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** How long an owed event is kept, sent or not. */
export const EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The oldest event a vendor accepts. All three refuse events older than a
 * week, so one past it is given up rather than retried into a refusal.
 */
export const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Attempts before an event is given up. */
export const EVENT_MAX_ATTEMPTS = 8

/** Events one tick of the console job delivers. */
export const EVENTS_PER_TICK = 300

/** The console cron that delivers owed events, as `/api/health/crons` lists it. */
export const AD_CONVERSIONS_DELIVERY_JOB_ID = 'ad-conversions-delivery'

/** The setup-page widget the card is drawn in. */
export const AD_CONVERSIONS_WIDGET_ID = 'ad-conversions-connections'
