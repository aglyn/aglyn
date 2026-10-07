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

/** The plugin id: `plugins.config.json`, `org.enabledPlugins`, every registry. */
export const SHIPPING_PLUGIN_ID = 'shipping'

/**
 * The plugin whose orders and checkouts this one ships, by id only — a
 * plugin never imports another. Shipping runs only on a site where it is on.
 */
export const SELLER_PLUGIN_ID = 'commerce'

/**
 * Where this plugin keeps what it keeps (AGL-3612). Every one is written by
 * the plugin's server half only; the Firestore rules refuse every client.
 *
 * - `orgs/{orgId}/shippingAccounts/{provider}`: the workspace's account at
 *   the carrier platform, its ids sealed, and the member's consent to label
 *   charges being taken from the Stripe balance.
 * - `orgs/{orgId}/shippingHostSettings/{hostId}`: one site's packages,
 *   ship-from, label format and checkout services.
 * - `orgs/{orgId}/shippingLabels/{labelId}`: every label bought, its cost and
 *   how that cost was recovered.
 * - `shippingTrackers/{trackerId}` (top level): a tracking number's org,
 *   site and record, so a carrier's webhook finds what it is about.
 * - `shippingQuoteCache/{key}` (top level): checkout quotes, ten minutes.
 */
export const SHIPPING_COLLECTIONS = {
  accounts: 'shippingAccounts',
  hostSettings: 'shippingHostSettings',
  labels: 'shippingLabels',
  trackers: 'shippingTrackers',
  quoteCache: 'shippingQuoteCache',
} as const

/** The entitlement every shipping surface stands on: the plans that sell. */
export const SHIPPING_ENTITLEMENT = 'commerce'
