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
import { AggregateField } from 'firebase-admin/firestore'

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

/** One approved review as the store-wide list shows it. */
export interface PublicStoreReview {
  id: string
  rating: number
  body: string
  /** First name and last initial only ("Jane D."), never the full name. */
  authorName: string
  verified: boolean
  createdAtMs: number
  /** The reviewed product, when it is still on sale. */
  productName?: string
  productSlug?: string
}

/** The most reviews the store-wide list returns. */
export const STORE_REVIEWS_MAX = 12
/** What the store-wide list returns when the caller names no limit. */
export const STORE_REVIEWS_DEFAULT = 6

/** "Jane Doe" → "Jane D."; one word stays as it is. */
export function reviewerShortName(name: string): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'Anonymous'
  const [first, ...others] = words
  const last = others[others.length - 1]
  return last ? `${first} ${last[0].toUpperCase()}.` : first
}

/**
 * The store's latest APPROVED reviews across every product, newest first, with
 * the aggregate over all of them — the store-wide reviews band a storefront
 * home carries. Approved only: a pending or rejected review never reaches a
 * page, and nothing here is ever sample text (a published page shows real
 * reviews or none).
 *
 * The list is `status == approved` ordered by `createdAtMs desc`, served by
 * the COLLECTION composite `reviews (status ASC, createdAtMs DESC)` that the
 * moderation queue already declares; the aggregate is a count and an average
 * over the same equality, which the automatic single-field index serves.
 */
export async function readStoreReviews(
  hostId: string,
  limit: number = STORE_REVIEWS_DEFAULT,
): Promise<{ reviews: PublicStoreReview[]; aggregate: ProductReviewAggregate }> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const approved = hostRef.collection('reviews').where('status', '==', 'approved')
  const max = Math.min(STORE_REVIEWS_MAX, Math.max(1, Math.floor(Number(limit)) || STORE_REVIEWS_DEFAULT))
  const [listSnapshot, aggregateSnapshot] = await Promise.all([
    approved.orderBy('createdAtMs', 'desc').limit(max).get(),
    approved
      .aggregate({ count: AggregateField.count(), average: AggregateField.average('rating') })
      .get(),
  ])
  const rows = listSnapshot.docs.map((docSnapshot) => ({
    id: docSnapshot.id,
    productId: String(docSnapshot.get('productId') ?? ''),
    rating: Number(docSnapshot.get('rating') ?? 0),
    body: String(docSnapshot.get('body') ?? ''),
    authorName: reviewerShortName(String(docSnapshot.get('authorName') ?? '')),
    verified: Boolean(docSnapshot.get('verified')),
    createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
  }))
  // The reviewed products' names, in one batched read of at most `max` docs.
  const productIds = [...new Set(rows.map((row) => row.productId).filter(Boolean))]
  const products = new Map<string, { name: string; slug: string }>()
  if (productIds.length) {
    const snapshots = await firestore.getAll(
      ...productIds.map((id) => hostRef.collection('products').doc(id)),
    )
    for (const snapshot of snapshots) {
      const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
      if (!data || data['deletedAt'] || data['status'] !== 'active') continue
      products.set(snapshot.id, { name: String(data['name'] ?? ''), slug: String(data['slug'] ?? '') })
    }
  }
  const reviews = rows.map(({ productId, ...row }) => {
    const product = products.get(productId)
    return {
      ...row,
      ...(product?.name ? { productName: product.name } : {}),
      ...(product?.slug ? { productSlug: product.slug } : {}),
    }
  })
  const data = aggregateSnapshot.data() as { count?: number; average?: number | null }
  const count = Number(data.count ?? 0)
  const average = count ? Number(data.average ?? 0) : 0
  return { reviews, aggregate: { count, average: Math.round(average * 10) / 10 } }
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
  // Store-wide (`scope=store`, no productId): the latest approved reviews
  // across the store, for the storefront's reviews band. Read only, and only
  // where the store's plan has reviews — a store without the feature shows
  // no band rather than reviews it can no longer collect.
  if (!isPost && !productId && req.query.scope === 'store') {
    if (!hostId) return res.status(400).json({ error: 'Missing hostId' })
    try {
      const org = await getOrgForHost(hostId)
      if (!Aglyn.checkEntitlement(org?.org as any, 'productReviews')) {
        return res.status(200).json({ reviews: [], aggregate: { count: 0, average: 0 } })
      }
      const { reviews, aggregate } = await readStoreReviews(hostId, Number(req.query.limit))
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json({ reviews, aggregate })
    } catch (error) {
      console.error(error)
      return res.status(500).json({ error: 'Reviews unavailable' })
    }
  }
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
        // Through the shared entitlement test (AGL-2454). "Verified buyer" on a
        // purchase that was refunded line by line is a badge for goods the
        // buyer no longer has — and the inline status literal this replaced
        // only moved on a FULL refund.
        if (CommerceModel.orderEntitlesProduct(order, productId)) {
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
