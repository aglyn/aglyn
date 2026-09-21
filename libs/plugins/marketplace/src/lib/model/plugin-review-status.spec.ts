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

/**
 * AGL-1121 — the takedown/Verified interaction, decided 2026-08-03.
 *
 * Verified is our claim that a human vouched for the PUBLISHER. A takedown says
 * the opposite, so it strips the badge. Everything else must NOT, and each of
 * those cases fails differently and quietly:
 *
 * - a restore silently re-granting a badge nobody re-earned
 * - hiding one user review demoting the whole listing
 * - a takedown rewriting some other verdict into `listed`, which for a
 *   `rejected` listing is a PROMOTION
 *
 * None of these would throw, and none is visible without looking for it.
 */

import {
  REVOKED_VERSION_REVIEW_STATE,
  revocationWithdrawsReviewedClaim,
  shouldStripVerifiedOnTakedown,
  VERIFIED_STRIPPED_STATUS,
} from './plugin-review-status'

const strip = (
  action: string,
  reviewStatus: string | undefined,
  isListingTarget = true,
) => shouldStripVerifiedOnTakedown({ action, reviewStatus, isListingTarget })

describe('stripping Verified on takedown (AGL-1121)', () => {
  it('strips it when a verified LISTING is taken down', () => {
    expect(strip('hide', 'verified')).toBe(true)
  })

  it('does NOT re-grant it on restore', () => {
    // Regranting is `verify`, which re-checks the checklist server-side.
    // An automatic regrant would hand the badge back without anyone re-forming
    // the opinion behind it.
    expect(strip('unhide', 'verified')).toBe(false)
    expect(strip('restore', 'verified')).toBe(false)
  })

  it('does NOT touch the listing when an individual user REVIEW is hidden', () => {
    // Same endpoint, different target. A customer's written review says
    // nothing about whether we vouched for the publisher.
    expect(strip('hide', 'verified', false)).toBe(false)
  })

  it('leaves every other verdict alone', () => {
    // Demoting `rejected` to `listed` would be a promotion, and `listed` is the
    // state that makes a plugin installable by every workspace.
    for (const status of [
      'listed',
      'rejected',
      'submitted',
      'in_review',
      undefined,
    ]) {
      expect(strip('hide', status)).toBe(false)
    }
  })

  it('demotes to listed — never to rejected or submitted', () => {
    // The takedown itself is what makes it non-browsable (`hiddenAt`).
    // Rewriting the verdict would destroy the record of a review that happened.
    expect(VERIFIED_STRIPPED_STATUS).toBe('listed')
  })

  it('requires all three conditions, not any of them', () => {
    // Guards against the predicate being loosened to an OR, which would strip
    // on restore and on review-hides too.
    expect(strip('unhide', 'verified', false)).toBe(false)
    expect(strip('hide', 'listed', false)).toBe(false)
    expect(strip('unhide', 'listed', true)).toBe(false)
  })
})

/**
 * The other half of the same policy, and the reason keeping the publisher badge
 * through a per-version revocation is defensible at all.
 *
 * Before AGL-1121 this did not happen: `latestVersionReviewState` was written
 * only by approve/reject and on publish, so a version approved and later revoked
 * kept `'approved'`. A per-version revocation deliberately does not hide the
 * listing, so the marketplace went on telling customers a human had read the
 * exact bytes we had just stopped from executing.
 */
describe('withdrawing the Reviewed claim on revocation (AGL-1121)', () => {
  const withdraws = (revokedVersion: string, latestVersion?: string) =>
    revocationWithdrawsReviewedClaim({ revokedVersion, latestVersion })

  it('withdraws when the revoked version is the one on offer', () => {
    expect(withdraws('1.2.0', '1.2.0')).toBe(true)
  })

  it('leaves it alone when an older version is revoked', () => {
    // Both consumers describe `latestVersion`. Revoking 1.0.0 while 1.2.0 is on
    // offer says nothing about what a customer would install.
    expect(withdraws('1.0.0', '1.2.0')).toBe(false)
  })

  it('does not fire on a listing with no latest version', () => {
    // A listing mid-publish has no `latestVersion`; an empty-string match would
    // withdraw a claim about nothing.
    expect(withdraws('1.0.0', undefined)).toBe(false)
    expect(withdraws('', undefined)).toBe(false)
    expect(withdraws('', '')).toBe(false)
  })

  it('marks it revoked, not rejected', () => {
    // It was not turned down in review, it was killed afterwards, and the audit
    // trail should not blur those. Any non-approved value drops the chip, so
    // naming it honestly is free.
    expect(REVOKED_VERSION_REVIEW_STATE).toBe('revoked')
    expect(REVOKED_VERSION_REVIEW_STATE).not.toBe('approved')
    expect(REVOKED_VERSION_REVIEW_STATE).not.toBe('rejected')
  })
})
