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

import { createHash, randomBytes } from 'crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import * as CommerceModel from '../model'

/**
 * One-time review links (AGL-3736).
 *
 * The review-request email carries, per product, a link to the product page
 * with `?review=<token>`. The token is 24 random bytes; only its SHA-256 is
 * stored, as the document id of `hosts/{hostId}/reviewTokens/{hash}`, so a
 * leaked database row cannot be replayed as a link. The row binds the token
 * to one order, one product and the buyer's email, works once, and expires
 * 60 days after it was minted (a TTL policy on `expiresAt` clears old rows).
 *
 * The collection is closed to every client in the Firestore rules: a site
 * editor who could write a row could mint a "verified" review for any
 * product.
 */

export const REVIEW_TOKENS_COLLECTION = 'reviewTokens'

export interface ReviewTokenRecord {
  orderId: string
  productId: string
  email: string
  createdAtMs: number
  expiresAtMs: number
  usedAtMs: number | null
  reviewId?: string
}

/** The stored id for a presented token. */
export function hashReviewToken(token: string): string {
  return createHash('sha256').update(`review-token:${token}`).digest('hex')
}

/** A fresh token: URL-safe, 32 characters. */
export function newReviewToken(): string {
  return randomBytes(24).toString('base64url')
}

/** A presented token's shape, before any read. */
export function plausibleReviewToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token)
}

function tokensRef(firestore: FirebaseFirestore.Firestore, hostId: string) {
  return firestore.collection('hosts').doc(hostId).collection(REVIEW_TOKENS_COLLECTION)
}

/**
 * Stages one token per product in the caller's batch and returns the raw
 * tokens (to put in the email), by product id.
 */
export function stageReviewTokens(
  firestore: FirebaseFirestore.Firestore,
  batch: FirebaseFirestore.WriteBatch,
  input: { hostId: string; orderId: string; email: string; productIds: string[]; nowMs: number },
): Record<string, string> {
  const tokens: Record<string, string> = {}
  const expiresAtMs = input.nowMs + CommerceModel.REVIEW_TOKEN_TTL_MS
  for (const productId of input.productIds) {
    const token = newReviewToken()
    tokens[productId] = token
    batch.set(tokensRef(firestore, input.hostId).doc(hashReviewToken(token)), {
      orderId: input.orderId,
      productId,
      email: input.email.toLowerCase(),
      createdAtMs: input.nowMs,
      expiresAtMs,
      // The TTL field (cloud/firebase-firestore.indexes.json).
      expiresAt: firebaseAdmin.firestore.Timestamp.fromMillis(expiresAtMs),
      usedAtMs: null,
    })
  }
  return tokens
}

export type ReviewTokenCheck =
  | { ok: true; record: ReviewTokenRecord; ref: FirebaseFirestore.DocumentReference }
  | { ok: false; code: CommerceModel.ReviewErrorCode }

/** The verdict on one stored row, for a product. Pure. */
export function reviewTokenVerdict(
  record: Partial<ReviewTokenRecord> | null | undefined,
  productId: string,
  nowMs: number,
): CommerceModel.ReviewErrorCode | null {
  const codes = CommerceModel.REVIEW_ERROR_CODES
  if (!record) return codes.tokenInvalid
  // A link for another product is not a link for this one.
  if (String(record.productId ?? '') !== productId) return codes.tokenInvalid
  if (record.usedAtMs) return codes.tokenUsed
  if (!(Number(record.expiresAtMs) > nowMs)) return codes.tokenExpired
  return null
}

/**
 * Reads and judges a presented token without spending it (the form's
 * eligibility check). The POST spends it with {@link redeemReviewTokenIn}.
 */
export async function inspectReviewToken(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  token: unknown,
  productId: string,
  nowMs = Date.now(),
): Promise<ReviewTokenCheck> {
  if (!plausibleReviewToken(token)) {
    return { ok: false, code: CommerceModel.REVIEW_ERROR_CODES.tokenInvalid }
  }
  const ref = tokensRef(firestore, hostId).doc(hashReviewToken(token))
  const snapshot = await ref.get()
  const record = snapshot.exists ? (snapshot.data() as ReviewTokenRecord) : null
  const problem = reviewTokenVerdict(record, productId, nowMs)
  if (problem || !record) {
    return { ok: false, code: problem ?? CommerceModel.REVIEW_ERROR_CODES.tokenInvalid }
  }
  return { ok: true, record, ref }
}

/**
 * Spends a token inside the caller's transaction: re-reads it, re-judges it,
 * and marks it used with the review it produced. Two submissions of one link
 * race on the same document, so exactly one wins.
 */
export async function redeemReviewTokenIn(
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  productId: string,
  reviewId: string,
  nowMs = Date.now(),
): Promise<CommerceModel.ReviewErrorCode | null> {
  const snapshot = await transaction.get(ref)
  const record = snapshot.exists ? (snapshot.data() as ReviewTokenRecord) : null
  const problem = reviewTokenVerdict(record, productId, nowMs)
  if (problem) return problem
  transaction.update(ref, { usedAtMs: nowMs, reviewId })
  return null
}
