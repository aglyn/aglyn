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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export interface PublicProductDetail {
  id: string
  name: string
  slug: string
  description?: string
  type: CommerceModel.ProductType
  mediaUrls: string[]
  options: CommerceModel.ProductOption[]
  variants: Array<{
    id: string
    options?: Record<string, string>
    priceUsd: number
    compareAtPriceUsd?: number
    soldOut: boolean
    imageUrl?: string
  }>
  tags?: string[]
  /** Recurring billing (AGL-303) so the PDP frames the price. */
  subscription?: { interval: 'month' | 'year'; trialDays?: number }
  /** Buyer may choose one-time OR subscribe (AGL-545). */
  subscriptionOptional?: boolean
}

/**
 * Public product detail by slug (AGL-292): everything the PDP block
 * needs — variants with per-option prices and stock booleans, never raw
 * counts. Display-only; the charge still prices server-side.
 */
export const productHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const slug = String(req.query.slug ?? '')
  if (!hostId || !slug) {
    return res.status(400).json({ error: 'Missing hostId or slug' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('products')
      .where('slug', '==', slug)
      .limit(1)
      .get()
    const docSnapshot = snapshot.docs[0]
    const raw = docSnapshot?.data() as any
    if (!raw || raw.deletedAt || raw.status !== 'active') {
      return res.status(404).json({ error: 'Unknown product' })
    }
    const product = CommerceModel.liftLegacyProduct(raw)
    const detail: PublicProductDetail = {
      id: docSnapshot.id,
      name: product.name,
      slug: product.slug,
      ...(product.description ? { description: product.description } : {}),
      type: product.type,
      mediaUrls:
        product.mediaUrls ?? (product.imageUrl ? [product.imageUrl] : []),
      options: product.options ?? [],
      variants: product.variants.map((variant) => ({
        id: variant.id,
        ...(variant.options ? { options: variant.options } : {}),
        priceUsd: variant.priceUsd,
        ...(variant.compareAtPriceUsd
          ? { compareAtPriceUsd: variant.compareAtPriceUsd }
          : {}),
        soldOut:
          variant.inventory != null &&
          Number(variant.inventory) <= 0 &&
          product.oversellPolicy !== 'backorder',
        ...(variant.imageUrl ? { imageUrl: variant.imageUrl } : {}),
      })),
      ...(product.tags?.length ? { tags: product.tags } : {}),
      ...(product.subscription ? { subscription: product.subscription } : {}),
      ...(product.subscription && product.subscriptionOptional
        ? { subscriptionOptional: true }
        : {}),
    }
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300',
    )
    return res.status(200).json({ product: detail })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Product unavailable' })
  }
}
