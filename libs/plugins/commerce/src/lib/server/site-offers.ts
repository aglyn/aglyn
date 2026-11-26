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

import type {
  PluginSiteOffer,
  PluginSiteOfferSource,
} from '@aglyn/aglyn/plugin-manager/plugin-site-offers'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { CART_UPDATED_EVENT } from '../constants/cart-events'
import * as CommerceModel from '../model'
import { productCard } from './product-card'

/**
 * A STORE PRODUCT AS ANOTHER PLUGIN'S BUTTON SELLS IT (AGL-4252): core's
 * `core.site-offers` for the `product` kind — an events calendar's "Get
 * tickets", today.
 *
 * A product with one variant and no add-on the shopper must pick goes
 * straight into the cart through the cart's own door, with the event's day
 * as its use day when the product asks for one (a dated pass), so the cart's
 * own rules (sold online, a day that has not passed) decide. Anything that
 * needs a choice opens the product's page instead. A product the storefront
 * does not list offers nothing.
 */
export function productSiteOffer(
  hostId: string,
  productId: string,
  data: Record<string, any>,
  dayKey?: string,
): PluginSiteOffer | null {
  if (!CommerceModel.productListedOnline(data)) return null
  if (CommerceModel.productIsSample(data)) return null
  const card = productCard(productId, data)
  const product = CommerceModel.liftLegacyProduct(
    data as CommerceModel.HostProduct,
  )
  const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
  const caption = CommerceModel.productPriceText(product, minPrice, maxPrice)
  const variants = product.variants ?? []
  const variantId = variants[0]?.id
  const needsChoice =
    variants.length > 1 ||
    (product.modifierGroups ?? []).some((group) => (group?.min ?? 0) > 0)
  const base = {
    title: card.title,
    ...(caption ? { caption } : {}),
    ...(card.imageUrl ? { imageUrl: String(card.imageUrl) } : {}),
  }
  if (needsChoice) {
    return card.path
      ? { ...base, action: { kind: 'link', href: card.path } }
      : null
  }
  const asksDay = CommerceModel.productAsksUseDate(product, variantId)
  return {
    ...base,
    action: {
      kind: 'post',
      endpoint: '/api/commerce/cart',
      body: {
        hostId,
        action: 'add',
        productId,
        ...(variantId ? { variantId } : {}),
        quantity: 1,
        ...(asksDay && dayKey ? { useDayKey: dayKey } : {}),
      },
      notify: CART_UPDATED_EVENT,
      done: 'Added to your cart',
    },
  }
}

export const commerceProductSiteOffer: PluginSiteOfferSource = {
  async resolve({ hostId, id, dayKey }) {
    if (!hostId || !id || id.includes('/') || hostId.includes('/')) return null
    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('products')
      .doc(id)
      .get()
    return snapshot.exists
      ? productSiteOffer(
          hostId,
          id,
          snapshot.data() as Record<string, any>,
          dayKey,
        )
      : null
  },
}
