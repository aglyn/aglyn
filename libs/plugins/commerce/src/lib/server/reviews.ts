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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'

export interface PublicProductReview {
  id: string
  rating: number
  body: string
  authorName: string
  verified: boolean
  reply: string | null
  createdAtMs: number
}

export interface ProductReviewAggregate {
  count: number
  /** Mean rating, one decimal. */
  average: number
}

/**
 * Approved reviews for a product, newest first, plus their aggregate.
 *
 * Extracted from the handler (AGL-686) so the site-page resolver can nest
 * `aggregateRating` inside the server-rendered `Product` node. Schema.org
 * wants it as a PROPERTY of the product; the reviews block was emitting a
 * free-standing `AggregateRating` node alongside it, which is orphaned and
 * ignored. One reader means the rating in the structured data and the rating
 * on the page cannot disagree.
 */
export async function readProductReviews(
  hostId: string,
  productId: string,
): Promise<{
  reviews: PublicProductReview[]
  aggregate: ProductReviewAggregate
}> {
  const hostRef = firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
  const reviewsSnapshot = await hostRef
    .collection('reviews')
    .where('productId', '==', productId)
    .where('status', '==', 'approved')
    .limit(100)
    .get()
  const reviews = reviewsSnapshot.docs
    .map((docSnapshot) => ({
      id: docSnapshot.id,
      rating: Number(docSnapshot.get('rating') ?? 0),
      body: String(docSnapshot.get('body') ?? ''),
      authorName: String(docSnapshot.get('authorName') ?? 'Anonymous'),
      verified: Boolean(docSnapshot.get('verified')),
      reply: (docSnapshot.get('reply') as string | undefined) ?? null,
      createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
  const count = reviews.length
  const average = count
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / count
    : 0
  return {
    reviews,
    aggregate: { count, average: Math.round(average * 10) / 10 },
  }
}

/**
 * Product reviews (AGL-324). GET returns approved reviews + aggregate;
 * POST submits into the moderation queue, marking `verified` when the
 * email has a paid order containing the product. Pro-plan gated.
 */
export const reviewsHandler: PluginApiHandler = async (req, res) => {
  const isPost = req.method === 'POST'
  const hostId = String((isPost ? req.body?.hostId : req.query.hostId) ?? '')
  const productId = String(
    (isPost ? req.body?.productId : req.query.productId) ?? '',
  )
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    if (isPost) {
      const org = await getOrgForHost(hostId)
      if (!Aglyn.checkEntitlement(org?.org as any, 'productReviews')) {
        return res.status(403).json({ error: 'Reviews are not enabled' })
      }
      const rating = Math.min(5, Math.max(1, Math.round(Number(req.body?.rating ?? 0))))
      const body = String(req.body?.body ?? '').trim().slice(0, 2000)
      const authorName = String(req.body?.authorName ?? '').trim().slice(0, 80)
      const authorEmail = String(req.body?.authorEmail ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 120)
      if (!rating || !body || !authorEmail) {
        return res.status(400).json({ error: 'Rating, review, and email required' })
      }
      // Verified buyer: a paid order with the product under this email.
      let verified = false
      const orders = await hostRef
        .collection('orders')
        .where('customerEmail', '==', authorEmail)
        .limit(25)
        .get()
      for (const docSnapshot of orders.docs) {
        const order = CommerceModel.liftLegacyOrder(docSnapshot.data() as any)
        if (['pending', 'cancelled', 'refunded'].includes(order.status)) continue
        if (
          (order.lineItems ?? []).some((line) => line.productId === productId) ||
          order.productId === productId
        ) {
          verified = true
          break
        }
      }
      await hostRef.collection('reviews').add({
        productId,
        rating,
        body,
        authorName: authorName || 'Anonymous',
        authorEmail,
        verified,
        status: 'pending',
        createdAtMs: Date.now(),
      })
      return res.status(200).json({ ok: true, pending: true })
    }

    const { reviews, aggregate } = await readProductReviews(hostId, productId)
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=120, stale-while-revalidate=300',
    )
    return res.status(200).json({ reviews, aggregate })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Reviews unavailable' })
  }
}
