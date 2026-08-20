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


/**
 * Server half of the commerce plugin (AGL-396): the site-facing storefront
 * API handlers, registered with the plugin API registry and served by the
 * tenant dispatcher at their unchanged `/api/commerce/*` URLs. This module
 * pulls in firebase-admin + Stripe, so it is NOT re-exported from the client
 * barrel — apps import `@aglyn/plugins-commerce/server` only from their
 * (server-only) API dispatcher registration.
 */

import {
  registerBillingWebhookHandler,
  registerPluginApiRoute,
  registerPluginJob,
  registerSitePageEnricher,
  registerSitePageResolver,
  registerPluginPermissions,
  registerPluginConfigSchema,
} from '@aglyn/aglyn/server'
import { isEmailConfigured } from '@aglyn/shared-util-email'
import { BUNDLE_ID } from './constants/bundle-common'
import { commerceBillingWebhookHandler } from './server/billing-webhook'
import { COMMERCE_PERMISSIONS } from './model/plugin-permissions'
import { COMMERCE_CONFIG_SCHEMA } from './plugin-config'
import { commerceSitePageEnricher } from './server/site-page-enricher'
import { commerceSitePageResolver } from './server/site-page-resolver'
import { cartCheckoutHandler } from './server/cart-checkout'
import { cartHandler } from './server/cart'
import { catalogHandler } from './server/catalog'
import { checkoutHandler } from './server/checkout'
import { downloadHandler } from './server/download'
import { feedHandler } from './server/feed'
import { newsletterHandler } from './server/newsletter'
import { notifyRestockHandler } from './server/notify-restock'
import { productHandler } from './server/product'
import { relatedHandler } from './server/related'
import { reservationAvailabilityHandler } from './server/reservation-availability'
import { gateHandler } from './server/gate'
import { memberFeedHandler } from './server/member-feed'
import { membershipAccountHandler } from './server/membership-account'
import { membershipAdminPasswordHandler } from './server/membership-admin-password'
import { membershipContentHandler } from './server/membership-content'
import { membershipLoginHandler } from './server/membership-login'
import { membershipLogoutHandler } from './server/membership-logout'
import { membershipRecoverHandler } from './server/membership-recover'
import { membershipRegisterHandler } from './server/membership-register'
import { membershipResetHandler } from './server/membership-reset'
import { membershipWishlistHandler } from './server/membership-wishlist'
import { reserveHandler } from './server/reserve'
import { streamHandler } from './server/stream'
import { subscriptionPortalHandler } from './server/subscription-portal'
import { reviewsHandler } from './server/reviews'
import { connectHandler } from './server/connect'
import { cancelOrderHandler } from './server/cancel-order'
import { draftOrderHandler } from './server/draft-order'
import { fulfillOrderHandler } from './server/fulfill-order'
import { giftCardsHandler } from './server/gift-cards'
import { memberPostHandler } from './server/member-post'
import { orderAnalyticsHandler } from './server/order-analytics'
import { posOrderHandler } from './server/pos-order'
import {
  processAbandonedHandler,
  scanAbandonedCheckouts,
} from './server/process-abandoned'
import { processRestockHandler, scanRestockAlerts } from './server/process-restock'
import { scanStockDecrements } from './server/reconcile-stock'
import { refundHandler } from './server/refund'
import { supplierUpdateHandler } from './server/supplier-update'

/**
 * The two commerce beats (AGL-2227).
 *
 * `commerce/process-abandoned` and `commerce/process-restock` have existed
 * since AGL-323/326 as `x-cron-secret` HTTP doors, and `registerCommerceConsoleApi`
 * below has called them "the scheduler-driven jobs" in a comment that whole
 * time. **Nothing scheduled them.** Not `scheduled-crons.yml` (its table names
 * 11 paths; neither of these), not `vercel.json` (no `crons` key at all), not
 * `registerPluginJob` — the only two registrations in the repo were scheduled
 * publishing and the bookings hold-expiry.
 *
 * The cost was a Pro-tier entitlement (`abandonedCart`) that had never sent an
 * email, and a storefront "notify me when it's back" form writing into a queue
 * with no drain. AGL-1793 had already added the collection-group indexes these
 * two scans need, which is the clearest evidence they were always meant to run.
 *
 * Module scope, like the bookings job beside it: the runner route reaches jobs
 * through `ensureAll(['tenantApi'])`, and a registration inside a `register*`
 * function would depend on which entry point happened to be loaded.
 *
 * 15 minutes, not 1: `process-abandoned` will not remind a checkout younger
 * than an hour and `process-restock` only mails alerts whose product already
 * has stock, so a tighter beat buys nothing and costs two collection-group
 * scans a minute. Both are bounded (200 docs) and idempotent — each pass
 * stamps what it sent — so an overlapping or repeated beat cannot double-send.
 */
const RECOVERY_JOB_INTERVAL_MINUTES = 15

registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'abandoned-checkout-recovery',
  intervalMinutes: RECOVERY_JOB_INTERVAL_MINUTES,
  description:
    'Email one recovery reminder per stalled checkout (abandonedCart plans).',
  handler: async () => {
    // Quietly, not as an error: email is optional per deployment, and a beat
    // that logs every minute on a self-host without Resend buries everything
    // else in the log.
    if (!isEmailConfigured()) return
    const { sent } = await scanAbandonedCheckouts()
    if (sent) console.info(`commerce: sent ${sent} abandoned-cart reminders`)
  },
})

registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'back-in-stock-alerts',
  intervalMinutes: RECOVERY_JOB_INTERVAL_MINUTES,
  description: 'Email shoppers whose requested product is in stock again.',
  handler: async () => {
    if (!isEmailConfigured()) return
    const { sent } = await scanRestockAlerts()
    if (sent) console.info(`commerce: sent ${sent} back-in-stock alerts`)
  },
})

/**
 * The missing-decrement detector (AGL-2358).
 *
 * HOURLY, not on the 15-minute recovery beat: it is a detector for a rare
 * process death, not a queue drain, and nothing it finds gets less true for
 * waiting an hour. The cost of the beat is what sets the interval — one
 * collection-group read of the platform's most recent orders, plus two
 * queries per host that has any — and an hour keeps that off the same tick as
 * the two scans above.
 *
 * NOT gated on `isEmailConfigured()`, unlike its two neighbours. Those send
 * mail; this writes a console notification and a log line, both of which work
 * on a self-host with no mail provider at all — and a stock count that is
 * silently wrong is exactly what a self-hoster least wants suppressed by a
 * setting about email.
 */
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'stock-decrement-reconciliation',
  intervalMinutes: 60,
  description:
    'Report paid orders whose stock decrement never landed (AGL-2358).',
  handler: async () => {
    const scan = await scanStockDecrements()
    if (scan.missingLines || scan.truncatedHosts) {
      console.warn(
        `commerce: ${scan.missingLines} order lines across ${scan.hosts} ` +
          `sites have no sale ledger row (${scan.reportedOrders} newly ` +
          `reported, ${scan.truncatedHosts} sites' ledger window truncated)`,
      )
    }
  },
})

/** Registers the commerce plugin's storefront API routes. */
export function registerCommerceApi(): void {
  registerPluginPermissions(COMMERCE_PERMISSIONS)
  // Merchant-settable register discount ceiling (AGL-2161). Registered on
  // BOTH surfaces, like the permissions above: the POS route reads it
  // server-side, and the settings card renders it from the same schema.
  registerPluginConfigSchema(COMMERCE_CONFIG_SCHEMA)
  // PDP/PLP template pages (AGL-418): /products/* + /collections/*.
  registerSitePageResolver(commerceSitePageResolver)
  // Seeds product grids on ordinary screens (AGL-659) — the resolver above
  // only covers /products/* and /collections/*, so /products itself, and any
  // designed page with a grid on it, needed this to render server-side.
  registerSitePageEnricher(commerceSitePageEnricher)
  registerPluginApiRoute('commerce/cart-checkout', cartCheckoutHandler)
  registerPluginApiRoute('commerce/cart', cartHandler)
  registerPluginApiRoute('commerce/catalog', catalogHandler)
  registerPluginApiRoute('commerce/checkout', checkoutHandler)
  registerPluginApiRoute('commerce/download', downloadHandler)
  registerPluginApiRoute('commerce/feed', feedHandler)
  registerPluginApiRoute('commerce/newsletter', newsletterHandler)
  registerPluginApiRoute('commerce/notify-restock', notifyRestockHandler)
  // GA-safe order projection for the storefront `purchase` (AGL-1641).
  registerPluginApiRoute('commerce/order-analytics', orderAnalyticsHandler)
  registerPluginApiRoute('commerce/product', productHandler)
  registerPluginApiRoute('commerce/related', relatedHandler)
  registerPluginApiRoute('commerce/reservation-availability', reservationAvailabilityHandler)
  registerPluginApiRoute('commerce/reserve', reserveHandler)
  registerPluginApiRoute('commerce/gate', gateHandler)
  registerPluginApiRoute('commerce/member-feed', memberFeedHandler)
  registerPluginApiRoute('commerce/stream', streamHandler)
  registerPluginApiRoute('commerce/subscription-portal', subscriptionPortalHandler)
  registerPluginApiRoute('commerce/reviews', reviewsHandler)
  registerPluginApiRoute('membership/account', membershipAccountHandler)
  // Console-driven password help for a member (AGL-914). Console-auth, not
  // the visitor cookie the neighbouring routes take.
  registerPluginApiRoute(
    'membership/admin-password',
    membershipAdminPasswordHandler,
  )
  registerPluginApiRoute('membership/content', membershipContentHandler)
  registerPluginApiRoute('membership/login', membershipLoginHandler)
  registerPluginApiRoute('membership/logout', membershipLogoutHandler)
  // Password recovery pair (AGL-552): request + complete.
  registerPluginApiRoute('membership/recover', membershipRecoverHandler)
  registerPluginApiRoute('membership/register', membershipRegisterHandler)
  registerPluginApiRoute('membership/reset', membershipResetHandler)
  registerPluginApiRoute('membership/wishlist', membershipWishlistHandler)
}

/**
 * Registers the commerce plugin's console-side API routes (AGL-396):
 * merchant/staff operations (Connect onboarding, refunds, draft & POS
 * orders, member posts), the supplier tracking callback, and the HTTP doors
 * for the abandoned-cart / restock passes.
 *
 * Those last two are NOT what schedules them — the `registerPluginJob` calls
 * above are (AGL-2227). This comment used to call them "the scheduler-driven
 * jobs", which is how they stayed dark for months: it asserted the wiring
 * instead of having it.
 */
export function registerCommerceConsoleApi(): void {
  // Stripe webhook sections (AGL-418): orders/carts/drafts/reservations/
  // subscriptions ride the platform webhook via the hook registry.
  registerBillingWebhookHandler(commerceBillingWebhookHandler)
  // Cancel + stock release in one transaction (AGL-1808). Server-side because
  // the release depends on the transition rule, and a client write could not
  // re-ask it under the same lock that flips the status.
  registerPluginApiRoute('commerce/cancel-order', cancelOrderHandler)
  registerPluginApiRoute('commerce/connect', connectHandler)
  registerPluginApiRoute('commerce/draft-order', draftOrderHandler)
  // Fulfil + mark-delivered with the transition re-asked under the write
  // (AGL-1819) — the same stale-dialog hole cancel-order closes, minus the
  // stock release those two transitions never had.
  registerPluginApiRoute('commerce/fulfill-order', fulfillOrderHandler)
  // Issue / void store credit (AGL-2226). Server-side because the host
  // catch-all in the Firestore rules would otherwise let a client write
  // its own `balanceCents`, which checkout applies as amount-off.
  registerPluginApiRoute('commerce/gift-cards', giftCardsHandler)
  registerPluginApiRoute('commerce/member-post', memberPostHandler)
  registerPluginApiRoute('commerce/pos-order', posOrderHandler)
  registerPluginApiRoute('commerce/process-abandoned', processAbandonedHandler)
  registerPluginApiRoute('commerce/process-restock', processRestockHandler)
  registerPluginApiRoute('commerce/refund', refundHandler)
  registerPluginApiRoute('commerce/supplier-update', supplierUpdateHandler)
}

// Shared with the (still app-side) membership/account route.
export { mintDownloadToken } from './server/download'

// Site-member session primitives, shared with the (still app-side)
// membership/* routes until those migrate too (AGL-396).
export * from './server/membership'
