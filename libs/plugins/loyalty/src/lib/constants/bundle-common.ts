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
export const LOYALTY_PLUGIN_ID = 'loyalty'

/**
 * The plugin whose sales this one rewards, by id only — a plugin never
 * imports another. Loyalty runs only on a site where it is on.
 */
export const SELLER_PLUGIN_ID = 'commerce'

/**
 * The entitlement every surface stands on: the plans that sell (AGL-3640).
 * Loyalty is part of selling, not a priced add-on, so it rides the key the
 * store itself does.
 */
export const LOYALTY_ENTITLEMENT = 'commerce'

/** The checkout credit this plugin registers: `loyalty.rewards`. */
export const LOYALTY_CREDIT_KEY = 'rewards'
export const LOYALTY_CREDIT_PROVIDER_ID = `${LOYALTY_PLUGIN_ID}.${LOYALTY_CREDIT_KEY}`

/**
 * Where this plugin keeps what it keeps (AGL-3640), under `orgs/{orgId}`.
 * Written and read by the plugin's server half only; the Firestore rules
 * refuse every client, staff and the owner included.
 *
 * - `loyaltyPrograms/{hostId}`: one store's program — the earn and redeem
 *   rates, referrals, emails.
 * - `loyaltyMembers/{hostId}__{memberKey}`: one customer's points, store
 *   credit, live checkout holds and codes. `memberKey` is a hash of the email.
 * - `loyaltyCodes/{hostId}__{CODE}`: a rewards or referral code to the
 *   member it belongs to.
 * - `loyaltyLedger/{hostId}__{entryKey}`: every movement, keyed by what
 *   caused it so a retried cause writes the same row.
 * - `loyaltyRedemptions/{hostId}__{orderId}__{memberKey}`: what one sale took
 *   from one member, and what refunds have given back.
 * - `loyaltyReferralClaims/{hostId}__{memberKey}`: a friend's one referral
 *   discount — held while they pay, closed once their order is written.
 * - `loyaltyConnections/{hostId}`: the merchant's own Smile.io or Yotpo
 *   account, its API key sealed (AGL-3677).
 * - `loyaltySync/{hostId}__{entryKey}`: one points movement on its way to that
 *   account, keyed by the ledger row it mirrors, so a retried cause sends once.
 */
export const LOYALTY_COLLECTIONS = {
  programs: 'loyaltyPrograms',
  members: 'loyaltyMembers',
  codes: 'loyaltyCodes',
  ledger: 'loyaltyLedger',
  redemptions: 'loyaltyRedemptions',
  referralClaims: 'loyaltyReferralClaims',
  connections: 'loyaltyConnections',
  sync: 'loyaltySync',
} as const

/** The emails this plugin sends a store's customers: catalog keys in `tenant-emails.ts`. */
export const LOYALTY_EMAIL_KEYS = {
  pointsEarned: 'loyalty-points-earned',
  storeCredit: 'loyalty-store-credit',
  referralReward: 'loyalty-referral-reward',
} as const
