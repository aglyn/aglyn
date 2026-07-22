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

import type { SitePageResolver } from '@aglyn/aglyn/server'
import composeScreenNodes from '@aglyn/tenant-runtime/compose-screen-nodes'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'
import { toPublicProductDetail } from './product'
import { readProductReviews } from './reviews'

/**
 * Commerce page resolver (AGL-292/298/418), relocated verbatim from the
 * tenant loader: /products/{slug} renders the host's designated PDP
 * template with product tokens, /collections/{slug} the collection
 * template — both compose server-side and return complete page props.
 * Runs only for paths that didn't match a published screen; returns
 * undefined for everything else so the loader falls through.
 */
export const commerceSitePageResolver: SitePageResolver = async ({
  hostId,
  host,
  path,
}) => {
  const hostRes = { host }
  // Product detail routes (AGL-292): /products/{slug} renders the
  // host's designated PDP template screen (settings/store
  // `pdpScreenId`, AGL-295) with product tokens; the product-detail
  // block hydrates variants client-side from the same slug. Same
  // mechanism as entry-template screens below.
  const pdpSegments = path.split('/').filter(Boolean)
  if (pdpSegments.length === 2 && pdpSegments[0] === 'products') {
    const adminFirestore = firebaseAdmin.app().firestore()
    const hostDocRef = adminFirestore.collection('hosts').doc(hostId)
    const [storeSettings, productSnapshot] = await Promise.all([
      hostDocRef.collection('settings').doc('store').get(),
      hostDocRef
        .collection('products')
        .where('slug', '==', pdpSegments[1])
        .limit(1)
        .get(),
    ])
    const pdpScreenId = storeSettings.get('pdpScreenId')
    const productRaw = productSnapshot.docs[0]?.data() as any
    if (
      pdpScreenId &&
      productRaw &&
      !productRaw.deletedAt &&
      productRaw.status === 'active'
    ) {
      const product = CommerceModel.liftLegacyProduct(productRaw)
      const templateRes = await getScreen({
        hostId,
        screenId: pdpScreenId,
      })
      if (templateRes.screen) {
        const [minPrice, maxPrice] = CommerceModel.productPriceRange(product)
        // Best-effort: a reviews read that fails costs the page its rating
        // snippet, not the page.
        const productReviews = await readProductReviews(
          hostId,
          productSnapshot.docs[0].id,
        ).catch((error) => {
          console.error('product review aggregate failed', error)
          return { reviews: [], aggregate: { count: 0, average: 0 } }
        })
        const templateNodes = await composeScreenNodes({
          hostId,
          screenId: pdpScreenId,
          screen: templateRes.screen,
          tokens: {
            'product.name': product.name,
            'product.description': product.description ?? '',
            'product.price':
              minPrice === maxPrice
                ? `$${minPrice}`
                : `From $${minPrice}`,
            'product.image':
              product.mediaUrls?.[0] ?? product.imageUrl ?? '',
            'product.slug': product.slug,
          },
        })
        if (templateNodes) {
          return {
            props: JSON.parse(
              JSON.stringify({
                // The PDP block used to fetch this in an effect, so the
                // server rendered a skeleton and crawlers saw a product page
                // with no product in it (AGL-659). The product is already
                // loaded here — hand it down so it renders server-side.
                pageData: {
                  commerce: {
                    product: toPublicProductDetail(
                      productSnapshot.docs[0].id,
                      product,
                    ),
                    // Rating aggregate (AGL-686): needed HERE because
                    // `aggregateRating` belongs nested inside the Product
                    // structured data, and that is emitted server-side.
                    // The reviews block used to publish a free-standing
                    // AggregateRating node, which schema.org ignores.
                    ...(productReviews.aggregate.count
                      ? { reviews: productReviews }
                      : {}),
                  },
                },
                data: {
                  host: hostRes.host,
                  screen: {
                    data: {
                      ...templateRes.screen,
                      seo: {
                        ...((templateRes.screen as any).seo ?? {}),
                        title: product.seo?.title ?? product.name,
                        description:
                          product.seo?.description ??
                          product.description ??
                          undefined,
                      },
                    },
                  },
                },
                nodes: templateNodes,
              }),
            ),
            revalidate: 60,
          }
        }
      }
    }
  }
  // Commerce collection routes (AGL-298): /collections/{slug} renders
  // the designated collection template with collection tokens; the
  // product-grid block derives the same slug from the URL.
  if (pdpSegments.length === 2 && pdpSegments[0] === 'collections') {
    const adminFirestore = firebaseAdmin.app().firestore()
    const hostDocRef = adminFirestore.collection('hosts').doc(hostId)
    const [storeSettings, collectionSnapshot] = await Promise.all([
      hostDocRef.collection('settings').doc('store').get(),
      hostDocRef
        .collection('collections')
        .where('slug', '==', pdpSegments[1])
        .limit(1)
        .get(),
    ])
    const collectionScreenId = storeSettings.get('collectionScreenId')
    const shopCollection = collectionSnapshot.docs[0]?.data() as
      | CommerceModel.HostCollection
      | undefined
    if (collectionScreenId && shopCollection) {
      const templateRes = await getScreen({
        hostId,
        screenId: collectionScreenId,
      })
      if (templateRes.screen) {
        const templateNodes = await composeScreenNodes({
          hostId,
          screenId: collectionScreenId,
          screen: templateRes.screen,
          tokens: {
            'collection.name': shopCollection.name,
            'collection.description': shopCollection.description ?? '',
            'collection.image': shopCollection.imageUrl ?? '',
            'collection.slug': shopCollection.slug,
          },
        })
        if (templateNodes) {
          return {
            props: JSON.parse(
              JSON.stringify({
                data: {
                  host: hostRes.host,
                  screen: {
                    data: {
                      ...templateRes.screen,
                      seo: {
                        ...((templateRes.screen as any).seo ?? {}),
                        title: shopCollection.name,
                        description:
                          shopCollection.description ?? undefined,
                      },
                    },
                  },
                },
                nodes: templateNodes,
              }),
            ),
            revalidate: 60,
          }
        }
      }
    }
  }
  return undefined
}
