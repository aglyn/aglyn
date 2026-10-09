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
export const REVIEW_PLATFORMS_PLUGIN_ID = 'review-platforms'

/**
 * The plugin whose orders this one follows, by id only — a plugin never
 * imports another. Review platforms runs only on a site where it is on.
 */
export const SELLER_PLUGIN_ID = 'commerce'

/** The entitlement every surface stands on: the plans that sell. */
export const REVIEW_PLATFORMS_ENTITLEMENT = 'commerce'

/** The review services this plugin sends a store's buyers to (AGL-3699). */
export const REVIEW_PLATFORMS = ['trustpilot', 'yotpo'] as const
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number]

export const REVIEW_PLATFORM_LABELS: Record<ReviewPlatform, string> = {
  trustpilot: 'Trustpilot',
  yotpo: 'Yotpo Reviews',
}

/**
 * Where this plugin keeps what it keeps (AGL-3699). Written and read by the
 * plugin's server half only; the Firestore rules refuse every client.
 *
 * - `orgs/{orgId}/reviewPlatformsHostSettings/{hostId}`: one site's
 *   Trustpilot and Yotpo settings, with any API credential sealed.
 * - `orgs/{orgId}/reviewPlatformsInvitations/{hostId}__{recordId}`: whether
 *   each service was asked to invite the buyer of one order, so an order is
 *   invited once however often its events and emails repeat. No address,
 *   name or other personal detail: the order holds those.
 */
export const REVIEW_PLATFORMS_COLLECTIONS = {
  hostSettings: 'reviewPlatformsHostSettings',
  invitations: 'reviewPlatformsInvitations',
} as const
