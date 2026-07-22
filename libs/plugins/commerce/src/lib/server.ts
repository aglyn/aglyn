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
  registerSitePageEnricher,
  registerSitePageResolver,
  registerPluginPermissions,
} from '@aglyn/aglyn/server'
import { commerceBillingWebhookHandler } from './server/billing-webhook'
import { COMMERCE_PERMISSIONS } from './model/plugin-permissions'
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
import { draftOrderHandler } from './server/draft-order'
import { memberPostHandler } from './server/member-post'
import { posOrderHandler } from './server/pos-order'
import { processAbandonedHandler } from './server/process-abandoned'
import { processRestockHandler } from './server/process-restock'
import { refundHandler } from './server/refund'
import { supplierUpdateHandler } from './server/supplier-update'

/** Registers the commerce plugin's storefront API routes. */
export function registerCommerceApi(): void {
  registerPluginPermissions(COMMERCE_PERMISSIONS)
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
 * orders, member posts) and the scheduler-driven jobs (abandoned-cart,
 * restock alerts, dropship supplier updates).
 */
export function registerCommerceConsoleApi(): void {
  // Stripe webhook sections (AGL-418): orders/carts/drafts/reservations/
  // subscriptions ride the platform webhook via the hook registry.
  registerBillingWebhookHandler(commerceBillingWebhookHandler)
  registerPluginApiRoute('commerce/connect', connectHandler)
  registerPluginApiRoute('commerce/draft-order', draftOrderHandler)
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
