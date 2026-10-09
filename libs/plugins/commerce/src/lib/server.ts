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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCommerceMediaPublishGuard } from './server/media-publish-guard'
import { registerCommerceRecurringCharges } from './server/recurring-charges'
import { registerProductCardReader } from './server/product-card'
import { registerProductAiCapability } from './server/product-ai-capability'
import { registerProductDraftWriter } from './server/product-drafts'
import { registerCommerceTaxProfile } from './server/tax-profile'
import { registerTaxReturnSource } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { commerceTaxReturnSource } from './server/tax-return-source'
import { taxSummaryHandler } from './server/tax-summary'
import { registerRevenueSource } from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import { commerceRevenueSource } from './server/revenue-source'
import { commerceBillingWebhookHandler } from './server/billing-webhook'
import { registerOrderFigureReaders } from './server/order-figures'
import { COMMERCE_PERMISSIONS } from './model/plugin-permissions'
import { COMMERCE_CONFIG_SCHEMA } from './plugin-config'
import { commerceSitePageEnricher } from './server/site-page-enricher'
import { commerceSitePageResolver } from './server/site-page-resolver'
import { cartCheckoutHandler } from './server/cart-checkout'
import { cartHandler } from './server/cart'
import { cartExtrasHandler } from './server/checkout-extras'
import { catalogHandler } from './server/catalog'
import { checkoutHandler } from './server/checkout'
import { downloadHandler } from './server/download'
import { newsletterHandler } from './server/newsletter'
import { notifyRestockHandler } from './server/notify-restock'
import { productHandler } from './server/product'
import { relatedHandler } from './server/related'
import { reservationAvailabilityHandler } from './server/reservation-availability'
import { gateHandler } from './server/gate'
import { memberFeedHandler } from './server/member-feed'
import { membershipAccountHandler } from './server/membership-account'
import { membershipAdminPasswordHandler } from './server/membership-admin-password'
import { membershipAdminRemoveHandler } from './server/membership-admin-remove'
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
import { carrierRatesAvailabilityHandler } from './server/carrier-rates-availability'
import { collectionMembershipHandler } from './server/collection-membership'
import { draftOrderHandler } from './server/draft-order'
import { fulfillOrderHandler } from './server/fulfill-order'
import { orderReceiptSendHandler } from './server/order-receipt-send'
import { orderStatusHandler, registerOrderStatusActions } from './server/order-status'
import { returnRequestStatusAction } from './server/return-status-action'
import { giftCardsHandler } from './server/gift-cards'
import { memberPostHandler } from './server/member-post'
import { orderAnalyticsHandler } from './server/order-analytics'
import { checkoutStatusHandler } from './server/checkout-status'
import { posOrderHandler } from './server/pos-order'
import { printersHandler } from './server/printers'
import { posPaymentHandler } from './server/pos-payment'
import { posReadersHandler } from './server/pos-readers'
import { posTerminalConnectionTokenHandler } from './server/pos-terminal-connection-token'
import { posDisplayHandler } from './server/pos-display'
import { posKioskHandler } from './server/pos-kiosk'
import { registerPosOpsRoutes } from './server/pos-ops-routes'
import {
  processAbandonedHandler,
  scanAbandonedCheckouts,
} from './server/process-abandoned'
import { processRestockHandler, scanRestockAlerts } from './server/process-restock'
import { scanStockDecrements } from './server/reconcile-stock'
import { refundHandler } from './server/refund'
import { orderWebhooksHandler } from './server/order-webhooks'
import { returnRequestHandler, returnsHandler } from './server/returns'
import { scanSupplierDeliveries } from './server/supplier-outbox'
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
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    // Quietly, not as an error: email is optional per deployment, and a beat
    // that logs every minute on a self-host without Resend buries everything
    // else in the log.
    if (!isEmailConfigured()) return
    const { sent } = await scanAbandonedCheckouts(gate)
    if (sent) console.info(`commerce: sent ${sent} abandoned-cart reminders`)
  },
})

registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'back-in-stock-alerts',
  intervalMinutes: RECOVERY_JOB_INTERVAL_MINUTES,
  description: 'Email shoppers whose requested product is in stock again.',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    if (!isEmailConfigured()) return
    const { sent } = await scanRestockAlerts(gate)
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
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    const scan = await scanStockDecrements(gate)
    if (scan.missingLines || scan.truncatedHosts) {
      console.warn(
        `commerce: ${scan.missingLines} order lines across ${scan.hosts} ` +
          `sites have no sale ledger row (${scan.reportedOrders} newly ` +
          `reported, ${scan.truncatedHosts} sites' ledger window truncated)`,
      )
    }
  },
})

/**
 * The dropship supplier outbox drain (AGL-2473).
 *
 * EVERY MINUTE, unlike the three above, and the interval is the point rather
 * than an oversight. This is the only one of the four that a BUYER is waiting
 * on: the row it drains is a paid order that has not been routed to whoever
 * ships it, and every minute it sits is a minute the parcel is not moving. The
 * first backoff step is also 60s, so a supplier that blipped is retried on the
 * next tick.
 *
 * The cost that set fifteen minutes for the recovery pair does not apply. Those
 * are collection-GROUP scans across every site on the platform; this is one
 * ordinary equality query against a top-level collection that is EMPTY in the
 * ordinary case — an empty result bills a single read, so the whole beat is
 * ~1,440 reads a day whether or not anyone is dropshipping.
 *
 * Not gated on `isEmailConfigured()`. The supplier notification is an HTTP POST
 * to the merchant's own supplier, and a self-host with no mail provider still
 * has dropship orders to route.
 */
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'supplier-webhook-delivery',
  intervalMinutes: 1,
  description:
    'Deliver queued dropship supplier notifications, with backoff and a ' +
    'dead letter that tells the merchant (AGL-2473).',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    const scan = await scanSupplierDeliveries(gate)
    if (scan.deadLettered) {
      console.warn(
        `commerce: ${scan.deadLettered} dropship orders could not be routed ` +
          `to their supplier and have been reported on the order`,
      )
    }
  },
})

/**
 * Stripe payment method domains for every connected custom domain (AGL-3629).
 *
 * The backfill for domains connected before registration existed, and the
 * repair for a connect whose event was lost, in one daily pass. A domain
 * already registered costs a document read and no Stripe call, so the beat is
 * cheap; a day's delay costs only the Apple Pay button on a domain connected
 * while Stripe was unreachable, and the first in-page checkout there registers
 * it anyway.
 */
registerPluginJob({
  pluginId: BUNDLE_ID,
  name: 'payment-method-domains',
  intervalMinutes: 24 * 60,
  description:
    'Register connected custom domains with Stripe so Apple Pay, Google Pay ' +
    'and Link show on them (AGL-3629).',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    if (!process.env.STRIPE_SECRET_KEY) return
    const { reconcileCustomDomains } = await import('./server/payment-method-domains')
    const result = await reconcileCustomDomains(gate)
    if (result.registered || result.failed) {
      console.info(
        `commerce: payment method domains — ${result.registered} registered, ` +
          `${result.failed} failed across ${result.hosts} sites`,
      )
    }
  },
})

/**
 * A visitor's payment door: it opens a Stripe Checkout Session for whoever
 * calls it, so the dispatcher holds it to the card-testing counters
 * (AGL-3363). Declared here, beside the registration, so the door cannot
 * exist without it.
 */
const CARD_PAYMENT_DOOR = { cardPayment: true } as const

/** Registers the commerce plugin's storefront API routes. */
export function registerCommerceApi(): void {
  registerProductCardReader()
  // The merchant's tax rule, for every plugin that prices a charge here.
  registerCommerceTaxProfile()
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
  registerPluginApiRoute('commerce/cart-checkout', cartCheckoutHandler, CARD_PAYMENT_DOOR)
  registerPluginApiRoute('commerce/cart', cartHandler)
  // What the cart offers besides shipping (AGL-3624): pickup locations, and
  // local delivery's fee, minimum and windows for a postal code.
  registerPluginApiRoute('commerce/local-fulfillment-options', async (req, res) =>
    (await import('./server/local-fulfillment')).localFulfillmentOptionsHandler(req, res),
  )
  // Optional lines another plugin offers at the cart (AGL-3635).
  registerPluginApiRoute('commerce/cart-extras', cartExtrasHandler)
  registerPluginApiRoute('commerce/catalog', catalogHandler)
  registerPluginApiRoute('commerce/checkout', checkoutHandler, CARD_PAYMENT_DOOR)
  registerPluginApiRoute('commerce/download', downloadHandler)
  // The pre-channels Google feed address (AGL-299), now written by the
  // catalog's feed publisher (AGL-3637); the module loads with a fetch.
  registerPluginApiRoute('commerce/feed', {
    web: async (request) => (await import('./server/legacy-feed')).legacyFeedRoute(request),
  })
  registerPluginApiRoute('commerce/newsletter', newsletterHandler)
  registerPluginApiRoute('commerce/notify-restock', notifyRestockHandler)
  // GA-safe order projection for the storefront `purchase` (AGL-1641).
  registerPluginApiRoute('commerce/order-analytics', orderAnalyticsHandler)
  // The guest order-status page's data (AGL-3610), behind the signed link in
  // every buyer email — a recipient link, so it outlives the site's gates.
  registerPluginApiRoute('commerce/order-status', orderStatusHandler, { recipientLink: true })
  // …and its "Request a return" button (AGL-3611), on an order that can
  // still send something back.
  registerOrderStatusActions(returnRequestStatusAction)
  // What became of a session the shopper was returned from (AGL-3606).
  registerPluginApiRoute('commerce/checkout-status', checkoutStatusHandler)
  registerPluginApiRoute('commerce/product', productHandler)
  registerPluginApiRoute('commerce/related', relatedHandler)
  registerPluginApiRoute('commerce/reservation-availability', reservationAvailabilityHandler)
  registerPluginApiRoute('commerce/reserve', reserveHandler, CARD_PAYMENT_DOOR)
  registerPluginApiRoute('commerce/gate', gateHandler)
  registerPluginApiRoute('commerce/member-feed', memberFeedHandler)
  registerPluginApiRoute('commerce/stream', streamHandler)
  registerPluginApiRoute('commerce/subscription-portal', subscriptionPortalHandler)
  registerPluginApiRoute('commerce/reviews', reviewsHandler)
  // A buyer's return request (AGL-3611), from their account or the signed
  // order-status link.
  registerPluginApiRoute('commerce/return-request', returnRequestHandler)
  registerPluginApiRoute('membership/account', membershipAccountHandler)
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
  // The register's gate (`managePos`) is resolved on THIS surface: every POS
  // route below runs in the console, and a key no surface registered here is
  // absent from the resolved map, which reads as refused — the site's own
  // owner was answered 403 at the register.
  registerPluginPermissions(COMMERCE_PERMISSIONS)
  // What a product looks like to a surface that is not this plugin's — a
  // campaign email that features one asks here rather than importing the model.
  registerProductCardReader()
  // …and a draft product another plugin asks for by name (AGL-3616): an AI
  // build setting a store up from a brief, unpriced unless the brief priced it.
  // The console runs AI jobs (AGL-3026).
  registerProductDraftWriter()
  // …and the operation an AI build plans for it, which that writer executes.
  registerProductAiCapability()
  // …and why a file somebody is SELLING may not be made public (AGL-3080).
  // The media library asks before it hands an asset its permanent CDN URL
  // back; what a product is, and which of its fields hold paid media, is
  // this plugin's to know.
  registerCommerceMediaPublishGuard()
  // …and which memberships a site sells, for a security lockdown to pause
  // (AGL-3364). The lockdown route runs on this surface.
  registerCommerceRecurringCharges()
  // …and the tax rule, for the webhook that confirms what they charged.
  registerCommerceTaxProfile()
  // …and its sales on the operator's own sales tax return (AGL-3080): the
  // tax a storefront checkout collected under the platform's registrations.
  // The staff return awaits this surface before it asks, and refuses to be
  // filed without this source — commerce declares `taxReturnSource`.
  registerTaxReturnSource(commerceTaxReturnSource, { pluginId: BUNDLE_ID })
  // …and the take its orders earn the operator, on the staff revenue report
  // (AGL-3080) — commerce declares `revenueSource`, so the report names this
  // source as unread rather than counting it as zero if it is missing.
  registerRevenueSource(commerceRevenueSource, { pluginId: BUNDLE_ID })
  // Stripe webhook sections (AGL-418): orders/carts/drafts/reservations/
  // subscriptions ride the platform webhook via the hook registry.
  registerBillingWebhookHandler(commerceBillingWebhookHandler)
  // Cancel + stock release in one transaction (AGL-1808). Server-side because
  // the release depends on the transition rule, and a client write could not
  // re-ask it under the same lock that flips the status.
  registerPluginApiRoute('commerce/cancel-order', cancelOrderHandler)
  // Whether live carrier rates can be offered on this site (AGL-3612).
  registerPluginApiRoute('commerce/shipping/carrier-rates', carrierRatesAvailabilityHandler)
  registerPluginApiRoute('commerce/connect', connectHandler)
  registerPluginApiRoute('commerce/draft-order', draftOrderHandler)
  // Fulfil + mark-delivered with the transition re-asked under the write
  // (AGL-1819) — the same stale-dialog hole cancel-order closes, minus the
  // stock release those two transitions never had. The customer REST API's
  // `PATCH /v1/sites/{id}/orders/{id}` records a shipment through the same
  // transaction (`server/api-v1/orders-and-products.ts`).
  registerPluginApiRoute('commerce/fulfill-order', fulfillOrderHandler)
  // Pickup and local delivery steps (AGL-3624) — ready, picked up, out for
  // delivery, delivered — from the console queue, the order dialog and the
  // native Aglyn app. Loaded on first call.
  registerPluginApiRoute('commerce/local-fulfillment', async (req, res) =>
    (await import('./server/local-fulfillment-status')).localFulfillmentHandler(req, res),
  )
  // "Resend receipt" from the order dialog (AGL-3610): by email, or by text
  // when the platform's SMS provider is configured. Rate-limited per member
  // and per order.
  registerPluginApiRoute('commerce/order-receipt-send', orderReceiptSendHandler)
  // The product editor's save and Adjust stock for the native apps (AGL-3652):
  // the console's own product-write computation under the rules' gate. Loaded
  // on first call.
  registerPluginApiRoute('commerce/products/save', async (req, res) =>
    (await import('./server/products-write')).productSaveHandler(req, res),
  )
  registerPluginApiRoute('commerce/products/stock', async (req, res) =>
    (await import('./server/products-write')).productStockHandler(req, res),
  )
  // The order dialog's note and restock answer for the native apps
  // (AGL-3651, AGL-3652): the console's own timeline computation, in one
  // transaction on the stored order. Loaded on first call.
  registerPluginApiRoute('commerce/order-note', async (req, res) =>
    (await import('./server/order-annotations')).orderNoteHandler(req, res),
  )
  registerPluginApiRoute('commerce/order-restock-answer', async (req, res) =>
    (await import('./server/order-annotations')).orderRestockAnswerHandler(req, res),
  )
  // Issue / void store credit (AGL-2226). Server-side because the host
  // catch-all in the Firestore rules would otherwise let a client write
  // its own `balanceCents`, which checkout applies as amount-off.
  registerPluginApiRoute('commerce/gift-cards', giftCardsHandler)
  // The merchant's own storefront sales tax, by who owes it (AGL-2440): the
  // same rows and classifier the operator's return reads, fenced to one site.
  registerPluginApiRoute('commerce/tax-summary', { web: taxSummaryHandler })
  // The payment methods card (AGL-3629): toggles, the platform's offer, the
  // payout account's capabilities and the site's wallet domains. Loaded with
  // the first request, so a console that never opens Settings never imports it.
  registerPluginApiRoute('commerce/payment-methods', {
    web: async (request) =>
      (await import('./server/payment-methods')).paymentMethodsHandler(request),
  })
  // A smart collection's rules changed or it was deleted: re-stamp which
  // products it holds (AGL-3321), the membership the storefront queries.
  registerPluginApiRoute('commerce/collection-membership', collectionMembershipHandler)
  // A site member's password help (AGL-914) and removal (AGL-3308), from the
  // Users page drawer and the Inbox. Console-auth, not the visitor cookie the
  // storefront's `membership/*` routes take, so they are served where the
  // console posts: the console's own dispatcher loads this surface only.
  registerPluginApiRoute(
    'membership/admin-password',
    membershipAdminPasswordHandler,
  )
  registerPluginApiRoute('membership/admin-remove', membershipAdminRemoveHandler)
  registerPluginApiRoute('commerce/member-post', memberPostHandler)
  registerPluginApiRoute('commerce/pos-order', posOrderHandler)
  // A register's cloud receipt printers and the jobs a manager sends them
  // (AGL-3619), and the two doors the printers themselves poll. The doors are
  // MACHINE routes: a printer is no member and names no site cookie, so it
  // authenticates with the per-printer secret in its URL and its own device id,
  // and the route asks the plan before it hands over a job. Loaded with the
  // first poll, so a console that has no printers never imports them.
  registerPluginApiRoute('commerce/printers', printersHandler)
  registerPluginApiRoute(
    'commerce/cloudprnt/:hostId/:printerId/:secret',
    {
      web: async (request, context) =>
        (await import('./server/printer-poll')).cloudPrntRoute(request, context),
    },
    { machine: true },
  )
  registerPluginApiRoute(
    'commerce/epson-sdp/:hostId/:printerId/:secret',
    {
      web: async (request, context) =>
        (await import('./server/printer-poll')).epsonServerDirectPrintRoute(request, context),
    },
    { machine: true },
  )
  // The register's tenders against an open sale, its Stripe Terminal card
  // readers, and the paired customer display (AGL-3607, AGL-3608). The
  // display's `pair`/`poll`/`respond` take a display token and no console
  // session; every other action is gated like a sale.
  registerPluginApiRoute('commerce/pos-payment', posPaymentHandler)
  registerPluginApiRoute('commerce/pos-readers', posReadersHandler)
  registerPluginApiRoute('commerce/pos-display', posDisplayHandler)
  // The self-service kiosk (AGL-3623): a register's paired screen where the
  // customer orders and pays. Its device token, never a staff session; the
  // register's queue of "pay at counter" orders is gated like a sale.
  registerPluginApiRoute('commerce/pos-kiosk', posKioskHandler)
  // Shifts, staff PINs, the customer lookup and returns (AGL-3609).
  registerPosOpsRoutes()
  // The offline register (AGL-3625): the kit a register caches to sell cash
  // while the connection is down, and the sync that records those sales once.
  // Gated like a sale; loaded with its first call.
  registerPluginApiRoute('commerce/pos-offline-sync', async (req, res) =>
    (await import('./server/pos-offline-sync')).posOfflineSyncHandler(req, res),
  )
  // The native Aglyn POS app's Stripe Terminal SDK: a connection token scoped
  // to the site's Location, and the Location itself (AGL-3618). Gated like a
  // sale.
  registerPluginApiRoute('commerce/pos-terminal-connection-token', posTerminalConnectionTokenHandler)
  registerPluginApiRoute('commerce/process-abandoned', processAbandonedHandler)
  registerPluginApiRoute('commerce/process-restock', processRestockHandler)
  registerPluginApiRoute('commerce/refund', refundHandler)
  // Returns (AGL-3611): approve, decline, receive with restock, refund
  // through the route above, a label from a shipping plugin.
  registerPluginApiRoute('commerce/returns', returnsHandler)
  // The merchant's outbound order webhooks (AGL-3611): endpoints, secrets,
  // a test ping and a resend from the delivery log.
  registerPluginApiRoute('commerce/order-webhooks', orderWebhooksHandler)
  registerPluginApiRoute('commerce/supplier-update', supplierUpdateHandler)
  // Stamps the open orders that predate the shipping fields, before an
  // export for shipping (AGL-3613).
  registerPluginApiRoute('commerce/orders-shipping-prepare', async (req, res) =>
    (await import('./server/orders-shipping-prepare')).ordersShippingPrepareHandler(req, res),
  )
  // ShipStation's Custom Store endpoint (AGL-3613): ShipStation's servers
  // pull the order feed and post shipments back with the site's own Basic
  // credentials, so it is a MACHINE's route and asks the site's commerce,
  // plan, release and lockdown gates itself once the credentials prove the
  // site. Loaded on its first call, never with the console API surface.
  registerPluginApiRoute(
    'commerce/shipstation/:hostId',
    {
      web: async (request, context) =>
        (await import('./server/shipstation')).shipStationRoute(request, context),
    },
    { machine: true },
  )
  // ShippingEasy's shipment callback (AGL-3633): ShippingEasy's servers post
  // each label bought for an order this store sent them, signed with the
  // merchant's own API secret, so it is a MACHINE's route like ShipStation's
  // above and asks the same gates once the signature proves the site.
  registerPluginApiRoute(
    'commerce/shippingeasy/:hostId',
    {
      web: async (request, context) =>
        (await import('./server/shippingeasy')).shippingEasyRoute(request, context),
    },
    { machine: true },
  )
  // The ShipStation and ShippingEasy cards' connect, show, new password,
  // send open orders and disconnect.
  registerPluginApiRoute('commerce/shipping-connectors', async (req, res) =>
    (await import('./server/shipping-connectors')).shippingConnectorsHandler(req, res),
  )
  // The store's sales as figure tables (AGL-2915), for the AI plugin's
  // insights to read by id rather than by reading orders. The console runs
  // insight jobs, so the console surface registers them.
  registerOrderFigureReaders(() => firebaseAdmin.app().firestore())
}

// Shared with the (still app-side) membership/account route.
export { mintDownloadToken } from './server/download'

// Site-member session primitives, shared with the (still app-side)
// membership/* routes until those migrate too (AGL-396).
export * from './server/membership'

// Type-only (AGL-3080): the plugin's entitlement keys, declared by module
// augmentation, for every program that loads this entry point.
export type { commercePlanEntitlements } from './plan-entitlements'
