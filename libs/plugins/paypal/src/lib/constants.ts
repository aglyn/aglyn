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

/** The plugin id: `plugins.config.json` and every registry. Client-safe. */
export const PAYPAL_PLUGIN_ID = 'paypal'

/** The id this plugin's provider registers under in core's payment-provider seam. */
export const PAYPAL_PROVIDER_ID = 'paypal'

/**
 * The plan entitlement every PayPal surface stands on: the plans that sell.
 * The same key the store's card checkout is gated on — no new price.
 */
export const PAYPAL_ENTITLEMENT = 'commerce'

/**
 * Every route this plugin answers, as the dispatchers key them (AGL-3630).
 * Under the `paypal` prefix `plugins.config.json` gives it. None names a
 * `hostId`: the plugin is infrastructure with no switchboard row, so a
 * site-named request would be refused by the dispatcher's enablement gate.
 * The console routes name the workspace (`?orgId=`); the buyer's routes
 * name the checkout (`?c=`), whose record names everything else.
 */
export const PAYPAL_API_ROUTES = {
  /** `GET ?orgId` — whether PayPal is offered and the workspace's seller account. Console. */
  seller: 'paypal/seller',
  /** `POST ?orgId` — start (or resume) PayPal's seller onboarding; answers its link. Console, owner only. */
  sellerOnboard: 'paypal/seller/onboard',
  /** `POST ?orgId` — re-read the seller's status from PayPal. Console. */
  sellerRefresh: 'paypal/seller/refresh',
  /** `POST ?orgId` — stop offering PayPal for the workspace. Console, owner only. */
  sellerDisconnect: 'paypal/seller/disconnect',
  /** `GET ?c` — the buyer's PayPal and Venmo page for one checkout. Both apps. */
  pay: 'paypal/pay',
  /** `POST ?c` — open the PayPal order for the funding source the buyer picked. Both apps. */
  payOrder: 'paypal/pay/order',
  /** `POST ?c` — a delivery option the buyer chose inside PayPal. Both apps. */
  payShipping: 'paypal/pay/shipping',
  /** `POST ?c` — an address the buyer chose inside PayPal: delivered to, or not. Both apps. */
  payAddress: 'paypal/pay/address',
  /** `POST ?c` — capture the approved order. Both apps. */
  payCapture: 'paypal/pay/capture',
  /** `POST` — PayPal's webhook; verified with PayPal before anything is read. Console. */
  webhook: 'paypal/webhook',
} as const

/**
 * Where this plugin keeps what it keeps. Every one is written and read by
 * the plugin's server half through the Admin SDK only; the Firestore rules
 * refuse every client, the owner and staff included.
 *
 * - `paypalSellers/{orgId}`: the workspace's PayPal seller account — the
 *   merchant id PayPal returned and whether it may take payments. An id,
 *   not a secret: in PayPal's third-party model the platform acts with its
 *   own credentials on the merchant's behalf, so nothing of the merchant's
 *   is held that could be sealed.
 * - `paypalCheckouts/{checkoutId}`: one buyer's checkout — what the owner
 *   priced, the PayPal orders opened for it, its capture and refunds.
 * - `paypalWebhookEvents/{eventId}`: the PayPal events already applied,
 *   kept thirty days so a redelivery is recognized.
 */
export const PAYPAL_COLLECTIONS = {
  sellers: 'paypalSellers',
  checkouts: 'paypalCheckouts',
  webhookEvents: 'paypalWebhookEvents',
} as const

/** The console cron that gives back what an unpaid checkout held. */
export const PAYPAL_EXPIRY_JOB_ID = 'paypal-checkout-expiry'

/** PayPal's REST hosts, one per environment. */
export const PAYPAL_API_BASES = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const

/** The JavaScript SDK's host: one for both environments, the client id decides which. */
export const PAYPAL_SDK_BASE = 'https://www.paypal.com'
