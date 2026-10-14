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

import type { HostOrder } from './commerce-orders'
import { orderEntitlesProduct } from './commerce-orders'

/**
 * Storefront product reviews, verified buyers by default (AGL-3736).
 *
 * The industry standard (the Shopify review apps, Squarespace, Etsy): a review
 * carries "Verified buyer" only when the platform KNOWS the reviewer bought
 * the product — a signed-in customer whose orders hold it, or a one-time link
 * from the review-request email. A typed email proves nothing (anybody can
 * type anybody's address), so it no longer verifies anything.
 *
 * Pure: read by the storefront block, the console and the server.
 */

/** Who may review a product on this store. */
export type ReviewPolicy = 'verified' | 'anyone'

/** Every status a review document can hold. */
export type ReviewStatus = 'pending' | 'approved' | 'hidden' | 'rejected'

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'pending',
  'approved',
  'hidden',
  'rejected',
]

/**
 * Why a merchant hid or rejected a review. Content reasons only: the FTC's
 * 2024 rule on fake reviews bars suppressing an honest review for being
 * negative, so "I don't like it" is not on the list.
 */
export const REVIEW_MODERATION_REASONS = [
  'spam',
  'abusive',
  'off_topic',
  'private_information',
] as const

export type ReviewModerationReason = (typeof REVIEW_MODERATION_REASONS)[number]

export const REVIEW_MODERATION_REASON_LABELS: Readonly<
  Record<ReviewModerationReason, string>
> = {
  spam: 'Spam or advertising',
  abusive: 'Abusive or hateful',
  off_topic: 'Not about the product',
  private_information: 'Shares private information',
}

export function isReviewModerationReason(value: unknown): value is ReviewModerationReason {
  return (REVIEW_MODERATION_REASONS as readonly string[]).includes(String(value))
}

/** The review-request email's delay, in days after fulfilment. */
export const REVIEW_REQUEST_DELAY_DEFAULT_DAYS = 7
export const REVIEW_REQUEST_DELAY_MIN_DAYS = 3
export const REVIEW_REQUEST_DELAY_MAX_DAYS = 30

/** How long a review link from the email works. */
export const REVIEW_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** A store's review settings, typed and bounded. */
export interface ReviewSettings {
  policy: ReviewPolicy
  /** Whether the review-request email goes out. On unless switched off. */
  requestEmail: boolean
  /** Days after fulfilment, 3–30. */
  requestDelayDays: number
}

/**
 * Reads `hosts/{hostId}/settings/store.reviews`. Defensive in the safe
 * direction: anything but an explicit `'anyone'` is `verified`, so every
 * existing store (no map at all) is verified-only, and only an explicit
 * `false` turns the email off — the transaction-email convention (AGL-3600).
 */
export function reviewSettingsFrom(storeSettings: unknown): ReviewSettings {
  const raw =
    storeSettings && typeof storeSettings === 'object'
      ? ((storeSettings as Record<string, unknown>)['reviews'] as
          | Record<string, unknown>
          | undefined)
      : undefined
  const days = Math.round(Number(raw?.['requestDelayDays']))
  return {
    policy: raw?.['policy'] === 'anyone' ? 'anyone' : 'verified',
    requestEmail: raw?.['requestEmail'] !== false,
    requestDelayDays: Number.isFinite(days)
      ? Math.min(
          REVIEW_REQUEST_DELAY_MAX_DAYS,
          Math.max(REVIEW_REQUEST_DELAY_MIN_DAYS, days),
        )
      : REVIEW_REQUEST_DELAY_DEFAULT_DAYS,
  }
}

/**
 * When an order fulfilled at `fulfilledAtMs` is owed its review request.
 * The scheduler stamps the EARLIEST possible moment (the 3-day minimum) and
 * the sweep re-reads the store's current delay, so a setting changed after
 * fulfilment still applies.
 */
export function reviewRequestDueAtMs(fulfilledAtMs: number, delayDays: number): number {
  return fulfilledAtMs + delayDays * DAY_MS
}

export function reviewRequestEarliestDueAtMs(fulfilledAtMs: number): number {
  return reviewRequestDueAtMs(fulfilledAtMs, REVIEW_REQUEST_DELAY_MIN_DAYS)
}

/**
 * Whether an order's buyer is asked for a review at all. A register sale is
 * not (the address was given for a receipt at the counter), nor is an order
 * sold on an outside marketplace (its reviews belong there).
 */
export function orderTakesReviewRequest(
  order: Pick<HostOrder, 'channel' | 'status'>,
): boolean {
  if (order.channel === 'pos' || order.channel === 'marketplace') return false
  return !['pending', 'cancelled', 'refunded'].includes(String(order.status))
}

/**
 * The products a review request lists: each distinct product on the order
 * that the order still entitles — a line refunded by name is never asked
 * about, and neither is a fully refunded or cancelled order.
 */
export function reviewableProductIds(order: Partial<HostOrder>): string[] {
  const ids: string[] = []
  for (const line of order.lineItems ?? []) {
    const productId = String(line?.productId ?? '')
    if (!productId || ids.includes(productId)) continue
    if (orderEntitlesProduct(order, productId)) ids.push(productId)
  }
  return ids
}

/** Error codes the reviews route answers with, for the storefront to word. */
export const REVIEW_ERROR_CODES = {
  verifiedPurchaseRequired: 'verified_purchase_required',
  tokenInvalid: 'review_token_invalid',
  tokenUsed: 'review_token_used',
  tokenExpired: 'review_token_expired',
  rateLimited: 'review_rate_limited',
  notEnabled: 'reviews_not_enabled',
  memberSuspended: 'member_suspended',
  alreadyReviewed: 'already_reviewed',
} as const

export type ReviewErrorCode =
  (typeof REVIEW_ERROR_CODES)[keyof typeof REVIEW_ERROR_CODES]

/** What the storefront form is told before it draws itself. */
export interface ReviewEligibility {
  /** The store's plan includes reviews. */
  enabled?: boolean
  policy: ReviewPolicy
  /** A site member is signed in on this store. */
  signedIn: boolean
  /** The review would carry "Verified buyer", and through what. */
  verifiedVia: 'member' | 'token' | null
  /** The form may be submitted at all. */
  canReview: boolean
  /** The form must ask for a name and an email (an unverified visitor). */
  needsEmail: boolean
  /** Why a presented review link does not work, when it does not. */
  tokenProblem?: ReviewErrorCode
}

/**
 * The eligibility answer from what the server established. Pure, so the
 * storefront's three states are specified in one place.
 */
export function reviewEligibility(input: {
  policy: ReviewPolicy
  signedIn: boolean
  memberVerified: boolean
  tokenVerified: boolean
  tokenProblem?: ReviewErrorCode
}): ReviewEligibility {
  const verifiedVia = input.tokenVerified
    ? 'token'
    : input.memberVerified
      ? 'member'
      : null
  const canReview = verifiedVia !== null || input.policy === 'anyone'
  return {
    policy: input.policy,
    signedIn: input.signedIn,
    verifiedVia,
    canReview,
    // A signed-in member is never asked for an email: the account has one.
    needsEmail: canReview && verifiedVia === null && !input.signedIn,
    ...(input.tokenProblem ? { tokenProblem: input.tokenProblem } : {}),
  }
}

/** The status a new review is saved with. */
export function initialReviewStatus(verified: boolean): ReviewStatus {
  // Verified reviews publish at once (the FTC's 2024 rule); unverified ones,
  // possible only under 'anyone', wait for the merchant.
  return verified ? 'approved' : 'pending'
}
