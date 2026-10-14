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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REVIEW_SIGN_IN_HREF,
  reviewFormMode,
  reviewTokenFromLocation,
} from './product-reviews'
import {
  hiddenStatusFor,
  moderationUpdate,
} from './console/reviews-moderation-card.component'

/**
 * The storefront form and the moderation card (AGL-3736): which form a
 * visitor sees, the link the email brings them in with, and the exact fields
 * a moderation decision writes — the ones the Firestore rules allow.
 */

describe('reviewFormMode', () => {
  it('draws the form for a visitor who may review', () => {
    expect(reviewFormMode({ enabled: true, canReview: true, verifiedVia: 'token' })).toBe('form')
    expect(reviewFormMode({ enabled: true, canReview: true, verifiedVia: null, needsEmail: true })).toBe('form')
  })

  it('asks anyone else to sign in, instead of a form a typed email would pass', () => {
    expect(reviewFormMode({ enabled: true, canReview: false, policy: 'verified' })).toBe('sign-in')
  })

  it('draws nothing until the answer comes, or when the plan has no reviews', () => {
    expect(reviewFormMode(null)).toBe('none')
    expect(reviewFormMode({ enabled: false, canReview: false })).toBe('none')
  })

  it('says "Only customers who bought this can review" and links to sign in', () => {
    const source = readFileSync(join(__dirname, 'product-reviews.tsx'), 'utf8')
    expect(source).toContain('Only customers who bought this can review. ')
    expect(source).toContain('href={REVIEW_SIGN_IN_HREF}')
    expect(REVIEW_SIGN_IN_HREF).toBe('/account')
    // The typed email is no longer offered as proof of purchase.
    expect(source).not.toContain('verifies your purchase')
  })
})

describe('reviewTokenFromLocation', () => {
  it('reads the email’s link token, and ignores anything not shaped like one', () => {
    const token = 'a'.repeat(32)
    expect(reviewTokenFromLocation(`?review=${token}`)).toBe(token)
    expect(reviewTokenFromLocation(`?utm=x&review=${token}`)).toBe(token)
    expect(reviewTokenFromLocation('?review=short')).toBe('')
    expect(reviewTokenFromLocation('')).toBe('')
  })
})

describe('moderation writes', () => {
  it('hides a published review and rejects a pending one', () => {
    expect(hiddenStatusFor({ status: 'approved' })).toBe('hidden')
    expect(hiddenStatusFor({ status: 'pending' })).toBe('rejected')
  })

  it('records the reason when hiding, clears it when approving, and writes nothing else', () => {
    expect(moderationUpdate('hidden', 'spam', 5)).toEqual({
      status: 'hidden',
      moderationReason: 'spam',
      moderatedAtMs: 5,
    })
    expect(moderationUpdate('approved', 'spam', 6)).toEqual({
      status: 'approved',
      moderationReason: null,
      moderatedAtMs: 6,
    })
    // Exactly the keys the rules' `affectedKeys().hasOnly([...])` admits.
    const rules = readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.rules'), 'utf8')
    expect(rules).toContain(".hasOnly(['status', 'reply', 'moderationReason', 'moderatedAtMs'])")
    for (const key of Object.keys(moderationUpdate('rejected', 'abusive', 1))) {
      expect(['status', 'reply', 'moderationReason', 'moderatedAtMs']).toContain(key)
    }
  })
})
