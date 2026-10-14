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

import {
  REVIEW_MODERATION_REASONS,
  REVIEW_REQUEST_DELAY_DEFAULT_DAYS,
  REVIEW_TOKEN_TTL_MS,
  initialReviewStatus,
  isReviewModerationReason,
  orderTakesReviewRequest,
  reviewEligibility,
  reviewRequestDueAtMs,
  reviewRequestEarliestDueAtMs,
  reviewSettingsFrom,
  reviewableProductIds,
} from './product-reviews'

/**
 * Verified-buyer reviews, the pure half (AGL-3736): the store's settings and
 * their defaults, who may review, what a new review is saved as, and which
 * orders and lines are ever asked for one.
 */

const DAY = 24 * 60 * 60 * 1000

describe('reviewSettingsFrom', () => {
  it('defaults every existing store to verified buyers, the email on, 7 days', () => {
    expect(reviewSettingsFrom(undefined)).toEqual({
      policy: 'verified',
      requestEmail: true,
      requestDelayDays: REVIEW_REQUEST_DELAY_DEFAULT_DAYS,
    })
    expect(reviewSettingsFrom({ currency: 'usd' })).toEqual(reviewSettingsFrom(null))
    expect(REVIEW_REQUEST_DELAY_DEFAULT_DAYS).toBe(7)
  })

  it('opens to anyone ONLY on an explicit "anyone"', () => {
    expect(reviewSettingsFrom({ reviews: { policy: 'anyone' } }).policy).toBe('anyone')
    for (const policy of ['Anyone', 'all', '', true, null]) {
      expect(reviewSettingsFrom({ reviews: { policy } }).policy).toBe('verified')
    }
  })

  it('turns the email off only on an explicit false', () => {
    expect(reviewSettingsFrom({ reviews: { requestEmail: false } }).requestEmail).toBe(false)
    expect(reviewSettingsFrom({ reviews: { requestEmail: 0 } }).requestEmail).toBe(true)
  })

  it('bounds the delay to 3–30 days', () => {
    expect(reviewSettingsFrom({ reviews: { requestDelayDays: 1 } }).requestDelayDays).toBe(3)
    expect(reviewSettingsFrom({ reviews: { requestDelayDays: 90 } }).requestDelayDays).toBe(30)
    expect(reviewSettingsFrom({ reviews: { requestDelayDays: '14' } }).requestDelayDays).toBe(14)
    expect(reviewSettingsFrom({ reviews: { requestDelayDays: 'x' } }).requestDelayDays).toBe(7)
  })
})

describe('the request schedule', () => {
  it('is due N days after fulfillment, and stamped at the 3-day minimum', () => {
    expect(reviewRequestDueAtMs(1_000, 7)).toBe(1_000 + 7 * DAY)
    expect(reviewRequestEarliestDueAtMs(1_000)).toBe(1_000 + 3 * DAY)
  })

  it('links work for 60 days', () => {
    expect(REVIEW_TOKEN_TTL_MS).toBe(60 * DAY)
  })
})

describe('reviewEligibility', () => {
  it('lets a verified buyer review under either policy, and says how', () => {
    for (const policy of ['verified', 'anyone'] as const) {
      expect(
        reviewEligibility({ policy, signedIn: true, memberVerified: true, tokenVerified: false }),
      ).toMatchObject({ canReview: true, verifiedVia: 'member', needsEmail: false })
      expect(
        reviewEligibility({ policy, signedIn: false, memberVerified: false, tokenVerified: true }),
      ).toMatchObject({ canReview: true, verifiedVia: 'token', needsEmail: false })
    }
  })

  it('refuses an unverified visitor under verified, signed in or not', () => {
    for (const signedIn of [true, false]) {
      expect(
        reviewEligibility({ policy: 'verified', signedIn, memberVerified: false, tokenVerified: false }),
      ).toMatchObject({ canReview: false, verifiedVia: null })
    }
  })

  it('asks an anonymous visitor for an email only under anyone', () => {
    expect(
      reviewEligibility({ policy: 'anyone', signedIn: false, memberVerified: false, tokenVerified: false }),
    ).toMatchObject({ canReview: true, verifiedVia: null, needsEmail: true })
    expect(
      reviewEligibility({ policy: 'anyone', signedIn: true, memberVerified: false, tokenVerified: false }),
    ).toMatchObject({ canReview: true, needsEmail: false })
  })

  it('passes a broken link’s reason through', () => {
    expect(
      reviewEligibility({
        policy: 'verified',
        signedIn: false,
        memberVerified: false,
        tokenVerified: false,
        tokenProblem: 'review_token_used',
      }).tokenProblem,
    ).toBe('review_token_used')
  })
})

describe('initialReviewStatus', () => {
  it('publishes a verified review at once and holds an unverified one', () => {
    expect(initialReviewStatus(true)).toBe('approved')
    expect(initialReviewStatus(false)).toBe('pending')
  })
})

describe('moderation reasons', () => {
  it('are content reasons only — never "negative"', () => {
    expect([...REVIEW_MODERATION_REASONS]).toEqual([
      'spam',
      'abusive',
      'off_topic',
      'private_information',
    ])
    expect(isReviewModerationReason('spam')).toBe(true)
    expect(isReviewModerationReason('negative')).toBe(false)
    expect(isReviewModerationReason(undefined)).toBe(false)
  })
})

describe('which orders and lines are asked', () => {
  it('asks a paid web order, never a register sale, a marketplace order or a withdrawn one', () => {
    expect(orderTakesReviewRequest({ channel: 'web', status: 'paid' } as never)).toBe(true)
    expect(orderTakesReviewRequest({ status: 'fulfilled' } as never)).toBe(true)
    expect(orderTakesReviewRequest({ channel: 'pos', status: 'paid' } as never)).toBe(false)
    expect(orderTakesReviewRequest({ channel: 'marketplace', status: 'paid' } as never)).toBe(false)
    for (const status of ['pending', 'cancelled', 'refunded']) {
      expect(orderTakesReviewRequest({ status } as never)).toBe(false)
    }
  })

  it('lists each product once, and never a line refunded by name', () => {
    const order = {
      status: 'paid',
      lineItems: [
        { productId: 'mug' },
        { productId: 'tee' },
        { productId: 'mug' },
        { productId: '' },
      ],
      refundedLineItemIds: [1],
    }
    expect(reviewableProductIds(order as never)).toEqual(['mug'])
    expect(reviewableProductIds({ ...order, status: 'refunded' } as never)).toEqual([])
  })
})
