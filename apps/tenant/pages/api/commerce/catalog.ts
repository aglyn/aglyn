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

import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

export interface PublicCatalogItem {
  id: string
  name: string
  slug: string
  type: Aglyn.ProductType
  priceUsd: number
  maxPriceUsd: number
  compareAtPriceUsd?: number
  imageUrl?: string
  soldOut: boolean
  tags?: string[]
}

/**
 * Public catalog listing (AGL-291): active products for storefront
 * blocks — filterable by collection/category slug or tag, sortable,
 * capped at 100 items per request. Read-only public data; prices here
 * are display-only (charges always come from the docs server-side).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const hostId = String(req.query.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
  const collectionSlug = String(req.query.collection ?? '')
  const categorySlug = String(req.query.category ?? '')
  const tag = String(req.query.tag ?? '')
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 100)
  const sort = String(req.query.sort ?? 'name')
  const max = Math.min(100, Math.max(1, Number(req.query.limit ?? 24)))

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [productsSnapshot, collectionsSnapshot, categoriesSnapshot] =
      await Promise.all([
        hostRef.collection('products').limit(500).get(),
        collectionSlug
          ? hostRef
              .collection('collections')
              .where('slug', '==', collectionSlug)
              .limit(1)
              .get()
          : null,
        categorySlug
          ? hostRef
              .collection('productCategories')
              .where('slug', '==', categorySlug)
              .limit(1)
              .get()
          : null,
      ])
    const collection = collectionsSnapshot?.docs[0]
    const categoryId = categoriesSnapshot?.docs[0]?.id

    let products = productsSnapshot.docs
      .map((docSnapshot) => ({
        ...Aglyn.liftLegacyProduct(docSnapshot.data() as any),
        $id: docSnapshot.id,
      }))
      .filter((product) => !product.deletedAt && product.status === 'active')
    if (collection) {
      const shaped = collection.data() as Aglyn.HostCollection
      products = products.filter((product) =>
        Aglyn.matchesCollection(product, shaped, product.$id),
      )
      if (shaped.mode === 'manual') {
        const order = new Map(
          (shaped.productIds ?? []).map((id, index) => [id, index]),
        )
        products.sort(
          (a, b) => (order.get(a.$id) ?? 999) - (order.get(b.$id) ?? 999),
        )
      }
    }
    if (categoryId) {
      products = products.filter((product) =>
        (product.categoryIds ?? []).includes(categoryId),
      )
    }
    if (tag) {
      products = products.filter((product) =>
        (product.tags ?? []).includes(tag),
      )
    }
    // Wishlist rendering (AGL-297): explicit id list, given order.
    if (ids.length) {
      const order = new Map(ids.map((id, index) => [id, index]))
      products = products
        .filter((product) => order.has(product.$id))
        .sort((a, b) => (order.get(a.$id) ?? 0) - (order.get(b.$id) ?? 0))
    }
    if (sort === 'price-asc' || sort === 'price-desc') {
      products.sort((a, b) => {
        const [minA] = Aglyn.productPriceRange(a)
        const [minB] = Aglyn.productPriceRange(b)
        return sort === 'price-asc' ? minA - minB : minB - minA
      })
    } else if (sort === 'newest') {
      products.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
    } else if (
      !ids.length &&
      (!collection || (collection.data() as any).mode !== 'manual')
    ) {
      products.sort((a, b) => a.name.localeCompare(b.name))
    }

    const items: PublicCatalogItem[] = products.slice(0, max).map((product) => {
      const [minPrice, maxPrice] = Aglyn.productPriceRange(product)
      const primary = product.variants[0]
      const inventory = Aglyn.productInventory(product)
      return {
        id: product.$id,
        name: product.name,
        slug: product.slug,
        type: product.type,
        priceUsd: minPrice,
        maxPriceUsd: maxPrice,
        ...(primary?.compareAtPriceUsd
          ? { compareAtPriceUsd: primary.compareAtPriceUsd }
          : {}),
        ...(product.mediaUrls?.[0] || product.imageUrl
          ? { imageUrl: product.mediaUrls?.[0] ?? product.imageUrl }
          : {}),
        soldOut:
          inventory != null &&
          inventory <= 0 &&
          product.oversellPolicy !== 'backorder',
        ...(product.tags?.length ? { tags: product.tags } : {}),
      }
    })
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300',
    )
    return res.status(200).json({ items })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Catalog unavailable' })
  }
}
