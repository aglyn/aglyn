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

import {
  buildAddToCartParams,
  trackEvent,
  type AnalyticsItem,
} from '@aglyn/aglyn/app-utils/analytics-events'
import { recordSiteJourneyStep } from '@aglyn/aglyn/app-utils/site-journey'
import { CART_UPDATED_EVENT } from '../constants/cart-events'

export interface AddToCartRequest {
  hostId: string
  /** The site's fetch (`Aglyn.useSiteFetch()`), which carries the cart cookie. */
  siteFetch: typeof fetch
  productId: string
  variantId: string
  quantity: number
  /** The GA4 line: product id (never the variant's), name, price, quantity. */
  item: AnalyticsItem
}

/**
 * Put one line in the shopper's cart. The product page's Add to cart and the
 * product grid's quick add both go through this one path, so both record the
 * same funnel step (AGL-3605), report the same priced `add_to_cart`
 * (AGL-1591) and refresh every cart badge on the page. Resolves whether the
 * server took the line; the server prices it, never the caller.
 */
export async function addToCart(request: AddToCartRequest): Promise<boolean> {
  const { hostId, siteFetch, productId, variantId, quantity, item } = request
  const response = await siteFetch('/api/commerce/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, action: 'add', productId, variantId, quantity }),
  }).catch(() => null)
  if (!response?.ok) return false
  recordSiteJourneyStep('cart', productId)
  // `value` describes what was JUST ADDED, not the cart's new total — see
  // `buildAddToCartParams`.
  trackEvent('add_to_cart', buildAddToCartParams({ items: [item] }))
  window.dispatchEvent(new Event(CART_UPDATED_EVENT))
  return true
}
