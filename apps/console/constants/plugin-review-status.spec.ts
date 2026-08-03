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
