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

import { registerPluginApiRoute } from '@aglyn/aglyn'
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
import { membershipLogoutHandler } from './server/membership-logout'
import { membershipWishlistHandler } from './server/membership-wishlist'
import { reserveHandler } from './server/reserve'
import { streamHandler } from './server/stream'
import { subscriptionPortalHandler } from './server/subscription-portal'
import { reviewsHandler } from './server/reviews'

/** Registers the commerce plugin's storefront API routes. */
export function registerCommerceApi(): void {
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
  registerPluginApiRoute('membership/logout', membershipLogoutHandler)
  registerPluginApiRoute('membership/wishlist', membershipWishlistHandler)
}

// Shared with the (still app-side) membership/account route.
export { mintDownloadToken } from './server/download'

// Site-member session primitives, shared with the (still app-side)
// membership/* routes until those migrate too (AGL-396).
export * from './server/membership'
