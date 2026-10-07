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
export const POST_PURCHASE_PLUGIN_ID = 'post-purchase'

/**
 * The plugin whose orders this one follows, by id only — a plugin never
 * imports another. Post-purchase runs only on a site where it is on.
 */
export const SELLER_PLUGIN_ID = 'commerce'

/** The entitlement every surface stands on: the plans that sell. */
export const POST_PURCHASE_ENTITLEMENT = 'commerce'

/** The services this plugin connects a store to (AGL-3635). */
export const POST_PURCHASE_VENDORS = ['aftership', 'route', 'narvar'] as const
export type PostPurchaseVendor = (typeof POST_PURCHASE_VENDORS)[number]

export const POST_PURCHASE_VENDOR_LABELS: Record<PostPurchaseVendor, string> = {
  aftership: 'AfterShip',
  route: 'Route',
  narvar: 'Narvar',
}

/** The checkout extra Route's package protection is offered as: `post-purchase.package-protection`. */
export const PACKAGE_PROTECTION_KEY = 'package-protection'

/**
 * Where this plugin keeps what it keeps (AGL-3635). Written and read by the
 * plugin's server half only; the Firestore rules refuse every client.
 *
 * - `orgs/{orgId}/postPurchaseHostSettings/{hostId}`: one site's switches
 *   and its sealed vendor credentials.
 * - `orgs/{orgId}/postPurchaseOrders/{hostId}__{recordId}`: what each
 *   vendor was told about one order — the protection policy, the parcels
 *   followed — so a retried event does not tell it twice.
 */
export const POST_PURCHASE_COLLECTIONS = {
  hostSettings: 'postPurchaseHostSettings',
  orders: 'postPurchaseOrders',
} as const
