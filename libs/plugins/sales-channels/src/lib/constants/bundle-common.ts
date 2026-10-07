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

/** Stable plugin id: persisted in org.enabledPlugins and site switches; never rename. */
export const BUNDLE_ID = 'sales-channels'

/**
 * The plan feature the channels are sold under: commerce's own. Sales
 * channels are part of selling, so no plan and no add-on of their own.
 */
export const SALES_CHANNELS_ENTITLEMENT = 'commerce'

/**
 * Where this plugin keeps a site's channel state: `hosts/{hostId}/salesChannels/{doc}`.
 * Every document is written by this plugin's routes on the Admin SDK and none
 * is readable by a client — a feed document holds the token that is the
 * feed's only lock, and a connection holds a sealed OAuth token.
 */
export const SALES_CHANNELS_COLLECTION = 'salesChannels'

/** The site's defaults for what a product leaves blank. */
export const SALES_CHANNELS_SETTINGS_DOC = 'settings'

/** A channel's feed document id. */
export const feedDocId = (channel: string): string => `feed-${channel}`

/** A provider connection's document id (phase 2, env-gated). */
export const connectionDocId = (provider: string): string => `connection-${provider}`

/** A provider's sync record: the lease that keeps two syncs apart, and the offer ids last sent. */
export const syncDocId = (provider: string): string => `sync-${provider}`

/** Every route this plugin serves, relative to `/api/`. */
export const SALES_CHANNELS_API_ROUTES = {
  /** The feed a channel fetches: `feed/{channel}/{token}.{ext}?hostId=`. */
  feed: 'sales-channels/feed/:channel/:file',
  /** The address Merchant Center was given before AGL-3637. */
  legacyGoogleFeed: 'commerce/feed',
  state: 'sales-channels/state',
  channel: 'sales-channels/channel',
  rotate: 'sales-channels/rotate',
  legacy: 'sales-channels/legacy',
  settings: 'sales-channels/settings',
  diagnostics: 'sales-channels/diagnostics',
  connectStart: 'sales-channels/connect/start',
  connectCallback: 'sales-channels/connect/callback',
  disconnect: 'sales-channels/connect/disconnect',
  /** Chooses which Merchant Center account or catalog a connection pushes to. */
  connectSelect: 'sales-channels/connect/select',
  sync: 'sales-channels/sync',
} as const
