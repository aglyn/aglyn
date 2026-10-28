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
import { consumeRateLimit, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { AggregateField } from 'firebase-admin/firestore'
import {
  MEMBER_SUSPENDED_ERROR,
  readActiveMemberSession,
  type MemberSessionCheck,
} from './membership'
import { inspectReviewToken, redeemReviewTokenIn } from './review-tokens'

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
  /** Its page, when it is sold online; a product sold in person only has none. */
  productSlug?: string
  /**
   * The product is sold in person only and the store shows its reviews
   * (AGL-4060): the band marks it "Sold in store" and links nowhere.
   */
  soldInStore?: true
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

/** The most products a store may keep its in-store reviews off the site for, read at once. */
export const HIDDEN_REVIEW_PRODUCTS_MAX = 500
/** How many pages of the newest reviews the band reads to fill itself past hidden ones. */
const STORE_REVIEWS_PAGES = 4
/** Firestore's ceiling on the values of one `in` filter. */
const IN_FILTER_MAX = 30

/**
 * The products sold in person only whose reviews the store keeps off the site
 * (AGL-4060, `inStoreReviews: 'hide'`). Two equalities, which Firestore
 * serves from its automatic single-field indexes.
 */
export async function readHiddenReviewProductIds(
  hostRef: FirebaseFirestore.DocumentReference,
): Promise<Set<string>> {
  const snapshot = await hostRef
    .collection('products')
    .where('sellOnline', '==', false)
    .where('inStoreReviews', '==', 'hide')
    .limit(HIDDEN_REVIEW_PRODUCTS_MAX)
    .get()
  return new Set(snapshot.docs.map((doc) => doc.id))
}

/**
 * The store's latest APPROVED reviews across every product, newest first, with
 * the aggregate over all of them — the store-wide reviews band a storefront
 * home carries. Approved only: a pending or rejected review never reaches a
 * page, and nothing here is ever sample text (a published page shows real
 * reviews or none).
 *
 * A product sold in person only (AGL-4060) shows its reviews here by default,
 * named, marked `soldInStore` and never linked, since it has no page; one
 * whose store chose to hide them (`inStoreReviews: 'hide'`) is in neither the
 * list nor the aggregate.
 *
 * The list is `status == approved` ordered by `createdAtMs desc`, served by
 * the COLLECTION composite `reviews (status ASC, createdAtMs DESC)` that the
 * moderation queue already declares, read a page at a time past hidden ones;
 * the aggregate is a count and a sum over the same equality, less the hidden
 * products' (`productId in …`, at most 30 at a time).
 */
export async function readStoreReviews(
  hostId: string,
  limit: number = STORE_REVIEWS_DEFAULT,
): Promise<{ reviews: PublicStoreReview[]; aggregate: ProductReviewAggregate }> {
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const approved = hostRef.collection('reviews').where('status', '==', 'approved')
  const max = Math.min(STORE_REVIEWS_MAX, Math.max(1, Math.floor(Number(limit)) || STORE_REVIEWS_DEFAULT))
  const hidden = await readHiddenReviewProductIds(hostRef)
  const hiddenIds = [...hidden]
  const tally = { count: AggregateField.count(), sum: AggregateField.sum('rating') }
  const aggregates = Promise.all([
    approved.aggregate(tally).get(),
    ...Array.from({ length: Math.ceil(hiddenIds.length / IN_FILTER_MAX) }, (_, chunk) =>
      approved
        .where('productId', 'in', hiddenIds.slice(chunk * IN_FILTER_MAX, (chunk + 1) * IN_FILTER_MAX))
        .aggregate(tally)
        .get(),
    ),
  ])

  // The newest approved reviews, a page at a time, past any the store hides.
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = []
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (let page = 0; page < STORE_REVIEWS_PAGES && docs.length < max; page += 1) {
    let query = approved.orderBy('createdAtMs', 'desc')
    if (after) query = query.startAfter(after)
    const snapshot = await query.limit(max).get()
    docs.push(...snapshot.docs.filter((doc) => !hidden.has(String(doc.get('productId') ?? ''))))
    if (snapshot.docs.length < max || !hidden.size) break
    after = snapshot.docs[snapshot.docs.length - 1]
  }
  const rows = docs.slice(0, max).map((docSnapshot) => ({
    id: docSnapshot.id,
    productId: String(docSnapshot.get('productId') ?? ''),
    rating: Number(docSnapshot.get('rating') ?? 0),
    body: String(docSnapshot.get('body') ?? ''),
    authorName: reviewerShortName(String(docSnapshot.get('authorName') ?? '')),
    verified: Boolean(docSnapshot.get('verified')),
    createdAtMs: Number(docSnapshot.get('createdAtMs') ?? 0),
  }))
  // The reviewed products, in one batched read of at most `max` docs.
  const productIds = [...new Set(rows.map((row) => row.productId).filter(Boolean))]
  const products = new Map<string, { name: string; slug: string | null; online: CommerceModel.ProductReviewsOnline }>()
  if (productIds.length) {
    const snapshots = await firestore.getAll(
      ...productIds.map((id) => hostRef.collection('products').doc(id)),
    )
    for (const snapshot of snapshots) {
      const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
      const online = CommerceModel.productReviewsOnline(data)
      // A draft or a deleted product is named nowhere, as before.
      if (!online) continue
      products.set(snapshot.id, {
        name: String(data['name'] ?? ''),
        // Sold in person only: no page to link to.
        slug: online === 'listed' ? String(data['slug'] ?? '') : null,
        online,
      })
    }
  }
  const reviews = rows
    // A product hidden since the list was read is still never shown.
    .filter((row) => products.get(row.productId)?.online !== 'hidden')
    .map(({ productId, ...row }) => {
      const product = products.get(productId)
      return {
        ...row,
        ...(product?.name ? { productName: product.name } : {}),
        ...(product?.slug ? { productSlug: product.slug } : {}),
        ...(product?.online === 'sold-in-store' ? { soldInStore: true as const } : {}),
      }
    })
  const [all, ...hiddenTallies] = await aggregates
  const counted = (snapshot: { data: () => unknown }) => {
    const data = snapshot.data() as { count?: number; sum?: number | null }
    return { count: Number(data.count ?? 0), sum: Number(data.sum ?? 0) }
  }
  const total = counted(all)
  for (const tallied of hiddenTallies.map(counted)) {
    total.count -= tallied.count
    total.sum -= tallied.sum
  }
  const count = Math.max(0, total.count)
  const average = count ? total.sum / count : 0
  return { reviews, aggregate: { count, average: Math.round(average * 10) / 10 } }
}

/** Reviews one address may submit per site, per hour (AGL-3736). */
export const REVIEW_POSTS_PER_IP_PER_HOUR = 10
/** Reviews one signed-in member may submit per site, per day. */
export const REVIEW_POSTS_PER_MEMBER_PER_DAY = 10
const HOUR_MS = 60 * 60 * 1000

/**
 * The address a signed-in member has PROVEN they own, or `''`.
 *
 * A site member signs up by typing an email nobody checks, so the address on
 * the member document alone would let anyone register with a buyer's address
 * and collect a "Verified buyer" badge on their purchases. Only a member
 * whose inbox has answered — `emailVerifiedAtMs`, stamped when they complete
 * a password reset from the emailed link or redeem a review link while signed
 * in — counts.
 */
export function memberProvenEmail(
  member: FirebaseFirestore.DocumentSnapshot | null | undefined,
): string {
  if (!member?.exists) return ''
  if (!Number(member.get('emailVerifiedAtMs') ?? 0)) return ''
  return String(member.get('email') ?? '').trim().toLowerCase()
}

/** The first order under `email` that still entitles `productId`, or null. */
export async function entitlingOrderId(
  hostRef: FirebaseFirestore.DocumentReference,
  email: string,
  productId: string,
): Promise<string | null> {
  if (!email) return null
  // By the member's email, as the account page matches order history.
  const orders = await hostRef
    .collection('orders')
    .where('customerEmail', '==', email)
    .limit(25)
    .get()
  for (const docSnapshot of orders.docs) {
    const order = CommerceModel.liftLegacyOrder(docSnapshot.data() as any)
    // The shared entitlement test (AGL-2454): a line refunded by name is
    // goods the buyer no longer has.
    if (CommerceModel.orderEntitlesProduct(order, productId)) return docSnapshot.id
  }
  return null
}

/** A store's review settings, from `settings/store`. */
async function readReviewSettings(
  hostRef: FirebaseFirestore.DocumentReference,
): Promise<CommerceModel.ReviewSettings> {
  const snapshot = await hostRef
    .collection('settings')
    .doc('store')
    .get()
    .catch(() => null)
  return CommerceModel.reviewSettingsFrom(snapshot?.data?.() ?? null)
}

type ReviewsRequest = Parameters<PluginApiHandler>[0]
type ReviewsResponse = Parameters<PluginApiHandler>[1]

function clientIp(req: ReviewsRequest): string {
  return (
    readClientIp(req.headers, { remoteAddress: req.socket?.remoteAddress }) ??
    'no-address'
  )
}

/** What the server established about who is reviewing. */
interface ReviewerIdentity {
  signedIn: boolean
  suspended: boolean
  memberId: string | null
  memberEmail: string
  memberName: string
  /** The member's proven email holds an order that entitles the product. */
  memberOrderId: string | null
}

const ANONYMOUS_REVIEWER: ReviewerIdentity = {
  signedIn: false,
  suspended: false,
  memberId: null,
  memberEmail: '',
  memberName: '',
  memberOrderId: null,
}

async function identifyReviewer(
  req: ReviewsRequest,
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  productId: string,
): Promise<ReviewerIdentity> {
  const session: MemberSessionCheck = await readActiveMemberSession(req, hostId).catch(
    () => ({ status: 'anonymous' }) as MemberSessionCheck,
  )
  if (session.status === 'suspended') {
    return { ...ANONYMOUS_REVIEWER, signedIn: true, suspended: true, memberId: session.memberId }
  }
  if (session.status !== 'active') return ANONYMOUS_REVIEWER
  const proven = memberProvenEmail(session.member)
  return {
    signedIn: true,
    suspended: false,
    memberId: session.memberId,
    memberEmail: String(session.member.get('email') ?? '').trim().toLowerCase(),
    memberName: String(session.member.get('displayName') ?? '').trim(),
    memberOrderId: proven ? await entitlingOrderId(hostRef, proven, productId) : null,
  }
}

/**
 * The storefront form's question (AGL-3736): may this visitor review this
 * product, and would the review be verified? `GET ?mode=eligibility`, never
 * cached — the answer depends on the visitor's cookie and link.
 */
async function eligibilityHandler(
  req: ReviewsRequest,
  res: ReviewsResponse,
  hostId: string,
  productId: string,
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const org = await getOrgForHost(hostId)
  const enabled = Aglyn.checkEntitlement(org?.org as any, 'productReviews')
  const settings = await readReviewSettings(hostRef)
  const reviewer = await identifyReviewer(req, hostRef, hostId, productId)
  const presented = req.query.review
  let tokenVerified = false
  let tokenProblem: CommerceModel.ReviewErrorCode | undefined
  if (presented) {
    const check = await inspectReviewToken(firestore, hostId, presented, productId)
    if (check.ok) tokenVerified = true
    else tokenProblem = check.code ?? CommerceModel.REVIEW_ERROR_CODES.tokenInvalid
  }
  const eligibility = CommerceModel.reviewEligibility({
    policy: settings.policy,
    signedIn: reviewer.signedIn && !reviewer.suspended,
    memberVerified: Boolean(reviewer.memberOrderId),
    tokenVerified,
    tokenProblem,
  })
  return res.status(200).json({
    ...eligibility,
    enabled,
    canReview: enabled && !reviewer.suspended && eligibility.canReview,
  })
}

/**
 * Product reviews (AGL-324, AGL-3736).
 *
 * GET returns approved reviews + aggregate (`scope=store`: store-wide;
 * `mode=eligibility`: what the form may do). POST submits one review:
 *
 *  - VERIFIED when the reviewer presents an unspent, unexpired review link
 *    for this product, or is a signed-in member whose proven email has an
 *    order that still entitles it. Published at once (`approved`): the FTC's
 *    2024 rule bars suppressing honest negative reviews; the merchant may
 *    still hide or reject one for a content reason.
 *  - Otherwise, under the store's `verified` policy (the default), 403
 *    `verified_purchase_required`; under `anyone`, saved `pending` with the
 *    name and email given — the email is never shown and verifies nothing.
 *
 * Rate-limited per address and per member, durably. Plan-gated
 * (`productReviews`).
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
    if (isPost) return await submitReview(req, res, hostId, productId)
    if (req.query.mode === 'eligibility') {
      return await eligibilityHandler(req, res, hostId, productId)
    }
    // A product sold in person only whose store hides its reviews from the
    // site (AGL-4060) answers none, here as on every other online surface.
    const product = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .collection('products')
      .doc(productId)
      .get()
    const hiddenOnline =
      CommerceModel.productReviewsOnline(product?.exists ? (product.data() as Record<string, unknown>) : null) ===
      'hidden'
    const { reviews, aggregate } = hiddenOnline
      ? { reviews: [], aggregate: { count: 0, average: 0 } }
      : await readProductReviews(hostId, productId)
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function submitReview(
  req: ReviewsRequest,
  res: ReviewsResponse,
  hostId: string,
  productId: string,
) {
  const codes = CommerceModel.REVIEW_ERROR_CODES
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const org = await getOrgForHost(hostId)
  if (!Aglyn.checkEntitlement(org?.org as any, 'productReviews')) {
    return res.status(403).json({ error: 'Reviews are not enabled', code: codes.notEnabled })
  }
  const refuseRate = (resetMs: number) => {
    res.setHeader(
      'Retry-After',
      String(Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))),
    )
    return res.status(429).json({
      error: 'Too many reviews from here. Try again later.',
      code: codes.rateLimited,
    })
  }
  // Per address, before anything else is read.
  const perIp = await consumeRateLimit(`commerce-review:ip:${hostId}:${clientIp(req)}`, {
    limit: REVIEW_POSTS_PER_IP_PER_HOUR,
    windowMs: HOUR_MS,
  })
  if (!perIp.allowed) return refuseRate(perIp.resetMs)

  const rating = Math.min(5, Math.max(1, Math.round(Number(req.body?.rating ?? 0))))
  const body = String(req.body?.body ?? '').trim().slice(0, 2000)
  const typedName = String(req.body?.authorName ?? '').trim().slice(0, 80)
  if (!rating || !body) {
    return res.status(400).json({ error: 'A rating and a review are required' })
  }

  const settings = await readReviewSettings(hostRef)
  const reviewer = await identifyReviewer(req, hostRef, hostId, productId)
  if (reviewer.suspended) {
    return res.status(403).json({ error: MEMBER_SUSPENDED_ERROR, code: codes.memberSuspended })
  }
  if (reviewer.memberId) {
    const perMember = await consumeRateLimit(
      `commerce-review:member:${hostId}:${reviewer.memberId}`,
      { limit: REVIEW_POSTS_PER_MEMBER_PER_DAY, windowMs: 24 * HOUR_MS },
    )
    if (!perMember.allowed) return refuseRate(perMember.resetMs)
  }

  // 1. A review link from the email. A link that does not work is an error,
  //    never a silent fall back to an unverified review.
  const presented = req.body?.reviewToken
  if (presented) {
    const check = await inspectReviewToken(firestore, hostId, presented, productId)
    if (!check.ok || !check.record || !check.ref) {
      const code = check.code ?? codes.tokenInvalid
      return res.status(403).json({ error: tokenProblemMessage(code), code })
    }
    const reviewRef = hostRef.collection('reviews').doc(createResourceUid())
    const nowMs = Date.now()
    const problem = await firestore.runTransaction(async (transaction) => {
      const spent = await redeemReviewTokenIn(transaction, check.ref, productId, reviewRef.id, nowMs)
      if (spent) return spent
      transaction.create(reviewRef, {
        productId,
        rating,
        body,
        authorName: typedName || reviewer.memberName || 'Anonymous',
        authorEmail: check.record.email,
        ...(reviewer.memberId ? { memberId: reviewer.memberId } : {}),
        verified: true,
        verifiedVia: 'token',
        orderId: check.record.orderId,
        status: CommerceModel.initialReviewStatus(true),
        createdAtMs: nowMs,
      })
      return null
    })
    if (problem) {
      return res.status(403).json({ error: tokenProblemMessage(problem), code: problem })
    }
    // The link came through the inbox, so a member signed in with the same
    // address has now proven it.
    if (reviewer.memberId && reviewer.memberEmail === check.record.email) {
      await hostRef
        .collection('siteMembers')
        .doc(reviewer.memberId)
        .set({ emailVerifiedAtMs: nowMs }, { merge: true })
        .catch(() => undefined)
    }
    return res.status(200).json({ ok: true, pending: false, verified: true })
  }

  // 2. A signed-in member whose proven email bought it. One verified review
  //    per member per product.
  if (reviewer.memberOrderId) {
    const already = await hostRef
      .collection('reviews')
      .where('productId', '==', productId)
      .where('memberId', '==', reviewer.memberId)
      .limit(1)
      .get()
    if (!already.empty) {
      return res.status(409).json({
        error: 'You have already reviewed this product.',
        code: codes.alreadyReviewed,
      })
    }
    await hostRef.collection('reviews').doc(createResourceUid()).set({
      productId,
      rating,
      body,
      authorName: typedName || reviewer.memberName || 'Anonymous',
      authorEmail: reviewer.memberEmail,
      memberId: reviewer.memberId,
      verified: true,
      verifiedVia: 'member',
      orderId: reviewer.memberOrderId,
      status: CommerceModel.initialReviewStatus(true),
      createdAtMs: Date.now(),
    })
    return res.status(200).json({ ok: true, pending: false, verified: true })
  }

  // 3. Nobody the store can verify.
  if (settings.policy !== 'anyone') {
    return res.status(403).json({
      error: 'Only customers who bought this can review it.',
      code: codes.verifiedPurchaseRequired,
    })
  }
  const authorEmail = reviewer.signedIn
    ? reviewer.memberEmail
    : String(req.body?.authorEmail ?? '').trim().toLowerCase().slice(0, 120)
  const authorName = typedName || reviewer.memberName
  if (!authorName || !EMAIL_PATTERN.test(authorEmail)) {
    return res.status(400).json({ error: 'Your name and email are required' })
  }
  await hostRef.collection('reviews').doc(createResourceUid()).set({
    productId,
    rating,
    body,
    authorName,
    // Kept for the merchant; never shown, and it verifies nothing.
    authorEmail,
    ...(reviewer.memberId ? { memberId: reviewer.memberId } : {}),
    verified: false,
    status: CommerceModel.initialReviewStatus(false),
    createdAtMs: Date.now(),
  })
  return res.status(200).json({ ok: true, pending: true, verified: false })
}

/** The words for a review link that does not work. */
export function tokenProblemMessage(code: CommerceModel.ReviewErrorCode): string {
  switch (code) {
    case CommerceModel.REVIEW_ERROR_CODES.tokenUsed:
      return 'This review link has already been used.'
    case CommerceModel.REVIEW_ERROR_CODES.tokenExpired:
      return 'This review link has expired.'
    default:
      return 'This review link is not valid for this product.'
  }
}
