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
import { hostCollectionKind } from '@aglyn/aglyn/server'
import composeScreenNodes, {
  composeNodesWithChrome,
} from '@aglyn/tenant-runtime/compose-screen-nodes'
import { resolveBuiltInPageLayoutId } from '@aglyn/tenant-runtime/built-in-page-layout'
import * as Aglyn from '@aglyn/aglyn/server'
import { ORDER_STATUS_PATH } from './order-status-token'
import { ORDER_STATUS_COMPONENT_ID } from '../constants/order-status'
import { RETURN_REQUEST_COMPONENT_ID, RETURN_REQUEST_PATH } from '../constants/return-request'
import getScreen from '@aglyn/tenant-runtime/get-screen'
import { collectSocialImageFacts } from '@aglyn/tenant-runtime/social-image-facts'
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
  // The guest order-status page (AGL-3610), at /order-status — reached only
  // when the site has no page of its own there. The site's header and footer
  // around the order-status block, which reads the signed `?o=&t=` link after
  // hydration, so this page holds no order and is safe to cache. UNLISTED, so
  // the head says noindex: it is a private page, not a landing page.
  if (pdpSegments.length === 1 && pdpSegments[0] === ORDER_STATUS_PATH) {
    return composeOrderStatusPage(hostId, host)
  }
  // The buyer's return form (AGL-3611), at /order-return, under the same
  // terms: no page of the site's own there, the order read after hydration
  // from the link's `?o=&t=` (or the member's session), UNLISTED.
  if (pdpSegments.length === 1 && pdpSegments[0] === RETURN_REQUEST_PATH) {
    return composeReturnRequestPage(hostId, host)
  }
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
        // A PDP template renders against a routed PRODUCT, never at an address
        // of its own, so it is served here and 404s everywhere else (AGL-1400).
        allowTemplate: true,
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
        // The head shares this page as the template's image, then the site
        // default, so their documents are read in the template's own batch
        // (AGL-2850).
        const card = collectSocialImageFacts([
          (templateRes.screen as any).seo?.image,
          hostRes.host?.seo?.image,
        ])
        const templateNodes = await composeScreenNodes({
          hostId,
          screenId: pdpScreenId,
          screen: templateRes.screen,
          socialImages: card.socialImages,
          // The template's host variables, and its layout's, fill in from
          // this site as they do on every other page (AGL-2883).
          host: hostRes.host,
          tokens: {
            'product.name': product.name,
            'product.description': product.description ?? '',
            'product.price': productPriceText(product, minPrice, maxPrice),
            'product.image':
              product.mediaUrls?.[0] ?? product.imageUrl ?? '',
            'product.slug': product.slug,
          },
          // Named as the product template it is if the page review holds it
          // (AGL-3374); without it the route has no page.
          page: {
            template: {
              role: 'entry',
              route: '/products/:slug',
              collectionName: 'Products',
              entryPath: `/products/${product.slug}`,
              fallback: 'not-found',
            },
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
                      // The product NAMES this page; the template's own name
                      // ("Product detail") describes none of the products it
                      // renders. Kept distinct from the SEO title because the
                      // head treats an authored title as verbatim and a name
                      // as the side the site title joins (AGL-1341) — so a
                      // product with its own SEO title gets exactly that, and
                      // one without gets "Blue Widget – Acme Store".
                      displayName: product.name,
                      seo: {
                        ...((templateRes.screen as any).seo ?? {}),
                        // Only when the PRODUCT authored one: inheriting the
                        // template screen's title would give every product
                        // page in the store the same `<title>`.
                        title: product.seo?.title ?? undefined,
                        description:
                          product.seo?.description ??
                          product.description ??
                          undefined,
                      },
                    },
                  },
                },
                nodes: templateNodes,
                ...card.collected(),
              }),
            ),
            revalidate: 60,
          }
        }
      }
    }
    // No product template designated, or none that renders: the store's
    // built-in product page (AGL-3676), in the site's own header and footer,
    // rather than a 404 behind every card the product grid links. A store a
    // guided start built has no template of its own, and its grid links each
    // product here.
    if (productRaw && !productRaw.deletedAt && productRaw.status === 'active') {
      return composeBuiltInProductPage(
        hostId,
        host,
        productSnapshot.docs[0].id,
        CommerceModel.liftLegacyProduct(productRaw),
      )
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
        .limit(5)
        .get(),
    ])
    const collectionScreenId = storeSettings.get('collectionScreenId')
    // Content collections share this path and a slug is only unique within a
    // kind (AGL-954), so take the first CATALOG match rather than the first
    // doc — otherwise a blog with the same slug renders as a product page.
    const shopCollection = collectionSnapshot.docs
      .find((docSnapshot) => hostCollectionKind(docSnapshot.data()) === 'catalog')
      ?.data() as CommerceModel.HostCollection | undefined
    if (collectionScreenId && shopCollection) {
      const templateRes = await getScreen({
        hostId,
        screenId: collectionScreenId,
        allowTemplate: true,
      })
      if (templateRes.screen) {
        // As on the PDP above: the template's image, then the site default
        // (AGL-2850).
        const card = collectSocialImageFacts([
          (templateRes.screen as any).seo?.image,
          hostRes.host?.seo?.image,
        ])
        const templateNodes = await composeScreenNodes({
          hostId,
          screenId: collectionScreenId,
          screen: templateRes.screen,
          socialImages: card.socialImages,
          // As on the PDP above (AGL-2883).
          host: hostRes.host,
          tokens: {
            'collection.name': shopCollection.name,
            'collection.description': shopCollection.description ?? '',
            'collection.image': shopCollection.imageUrl ?? '',
            'collection.slug': shopCollection.slug,
          },
          // As on the PDP above (AGL-3374).
          page: {
            template: {
              role: 'entry',
              route: '/collections/:slug',
              collectionName: 'Store collections',
              entryPath: `/collections/${shopCollection.slug}`,
              fallback: 'not-found',
            },
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
                      // As on the PDP above: the catalog collection names the
                      // page, and a name takes the site title after it while
                      // an authored SEO title would not (AGL-1341). A shop
                      // collection has no SEO title field of its own, so the
                      // template's must not stand in for one.
                      displayName: shopCollection.name,
                      seo: {
                        ...((templateRes.screen as any).seo ?? {}),
                        title: undefined,
                        description:
                          shopCollection.description ?? undefined,
                      },
                    },
                  },
                },
                nodes: templateNodes,
                ...card.collected(),
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

/**
 * What `{{product.price}}` says: the price, "From" the lowest where variants
 * differ, or "Price coming soon" for a product listed before any variant has
 * one (AGL-3676) — never "$0".
 */
export function productPriceText(
  product: Pick<CommerceModel.HostProduct, 'variants'>,
  minPrice: number,
  maxPrice: number,
): string {
  if (!(product.variants ?? []).some((variant) => CommerceModel.variantHasPrice(variant))) {
    return 'Price coming soon'
  }
  return minPrice === maxPrice ? `$${minPrice}` : `From $${minPrice}`
}

const PRODUCT_PAGE_NODE = 'pdp__detail'
const PRODUCT_PAGE_RELATED_NODE = 'pdp__related'

/**
 * The store's built-in product page (AGL-3676), root first, for the layout's
 * slot: the product block for the routed slug and the related products under
 * it — the two blocks a product template is made of.
 */
export function buildProductPageNodes(slug: string): Record<string, Aglyn.AglynNodeSchema> {
  return {
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['pdp__container'],
    } as Aglyn.AglynNodeSchema,
    pdp__container: {
      $id: 'pdp__container',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: 'muiContainer',
      pluginId: 'mui',
      props: { maxWidth: 'lg', sx: { paddingTop: 6, paddingBottom: 10 } },
      nodes: [PRODUCT_PAGE_NODE, PRODUCT_PAGE_RELATED_NODE],
    } as Aglyn.AglynNodeSchema,
    [PRODUCT_PAGE_NODE]: {
      $id: PRODUCT_PAGE_NODE,
      parentId: 'pdp__container',
      componentId: 'product-detail',
      pluginId: 'commerce',
      props: { slug },
    } as Aglyn.AglynNodeSchema,
    [PRODUCT_PAGE_RELATED_NODE]: {
      $id: PRODUCT_PAGE_RELATED_NODE,
      parentId: 'pdp__container',
      componentId: 'related-products',
      pluginId: 'commerce',
      props: { heading: 'You may also like', maxItems: 4, sx: { marginTop: 8 } },
    } as Aglyn.AglynNodeSchema,
  }
}

async function composeBuiltInProductPage(
  hostId: string,
  host: unknown,
  productId: string,
  product: ReturnType<typeof CommerceModel.liftLegacyProduct>,
) {
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host: host as never })
    const productReviews = await readProductReviews(hostId, productId).catch((error) => {
      console.error('product review aggregate failed', error)
      return { reviews: [], aggregate: { count: 0, average: 0 } }
    })
    const card = collectSocialImageFacts([
      product.mediaUrls?.[0] ?? product.imageUrl,
      (host as { seo?: { image?: string } } | null)?.seo?.image,
    ])
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildProductPageNodes(product.slug),
      socialImages: card.socialImages,
      host: host as Aglyn.HostTokenSource,
    })
    if (!nodes) return undefined
    return {
      props: JSON.parse(
        JSON.stringify({
          // Seeded, so the product renders server-side and the head writes
          // its Product structured data, as on a template page (AGL-659).
          pageData: {
            commerce: {
              product: toPublicProductDetail(productId, product),
              ...(productReviews.aggregate.count ? { reviews: productReviews } : {}),
            },
          },
          data: {
            host,
            screen: {
              data: {
                displayName: product.name,
                seo: {
                  title: product.seo?.title ?? undefined,
                  description: product.seo?.description ?? product.description ?? undefined,
                },
              },
            },
          },
          nodes,
          ...card.collected(),
        }),
      ),
      revalidate: 60,
    }
  } catch (error) {
    console.error('built-in product page composition failed', error)
    return undefined
  }
}

const ORDER_STATUS_NODE = 'order-status__block'

/** The order-status page's node tree, root first, for the layout's slot. */
export function buildOrderStatusNodes(): Record<string, Aglyn.AglynNodeSchema> {
  return {
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['order-status__container'],
    } as Aglyn.AglynNodeSchema,
    'order-status__container': {
      $id: 'order-status__container',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: 'muiContainer',
      pluginId: 'mui',
      props: { maxWidth: 'md', sx: { paddingTop: 6, paddingBottom: 8 } },
      nodes: [ORDER_STATUS_NODE],
    } as Aglyn.AglynNodeSchema,
    [ORDER_STATUS_NODE]: {
      $id: ORDER_STATUS_NODE,
      parentId: 'order-status__container',
      componentId: ORDER_STATUS_COMPONENT_ID,
      pluginId: 'commerce',
      props: {},
    } as Aglyn.AglynNodeSchema,
  }
}

async function composeOrderStatusPage(hostId: string, host: unknown) {
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host: host as never })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildOrderStatusNodes(),
      host: host as Aglyn.HostTokenSource,
    })
    if (!nodes) return undefined
    return {
      props: JSON.parse(
        JSON.stringify({
          data: {
            host,
            screen: {
              data: {
                displayName: 'Order status',
                visibility: Aglyn.HostScreenVisibility.UNLISTED,
              },
            },
          },
          nodes,
        }),
      ),
      revalidate: 3600,
    }
  } catch (error) {
    console.error('order status page composition failed', error)
    return undefined
  }
}

const RETURN_REQUEST_NODE = 'ret__block'

/** The return form's node tree, root first, for the layout's slot. */
export function buildReturnRequestNodes(): Record<string, Aglyn.AglynNodeSchema> {
  return {
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['ret__container'],
    } as Aglyn.AglynNodeSchema,
    ret__container: {
      $id: 'ret__container',
      parentId: Aglyn.NODE_ROOT_ID,
      componentId: 'muiContainer',
      pluginId: 'mui',
      props: { maxWidth: 'md', sx: { paddingTop: 6, paddingBottom: 8 } },
      nodes: [RETURN_REQUEST_NODE],
    } as Aglyn.AglynNodeSchema,
    [RETURN_REQUEST_NODE]: {
      $id: RETURN_REQUEST_NODE,
      parentId: 'ret__container',
      componentId: RETURN_REQUEST_COMPONENT_ID,
      pluginId: 'commerce',
      props: {},
    } as Aglyn.AglynNodeSchema,
  }
}

async function composeReturnRequestPage(hostId: string, host: unknown) {
  try {
    const layoutId = await resolveBuiltInPageLayoutId({ hostId, host: host as never })
    const nodes = await composeNodesWithChrome({
      hostId,
      layoutId,
      screenNodes: buildReturnRequestNodes(),
      host: host as Aglyn.HostTokenSource,
    })
    if (!nodes) return undefined
    return {
      props: JSON.parse(
        JSON.stringify({
          data: {
            host,
            screen: {
              data: {
                displayName: 'Request a return',
                visibility: Aglyn.HostScreenVisibility.UNLISTED,
              },
            },
          },
          nodes,
        }),
      ),
      revalidate: 3600,
    }
  } catch (error) {
    console.error('return request page composition failed', error)
    return undefined
  }
}
