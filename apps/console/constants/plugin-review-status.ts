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
 * What each review status actually means for customers (AGL-966).
 *
 * The raw values are the wrong thing to put in front of a reviewer:
 * "listed" and "verified" sound like a soft ranking, when in fact **listed
 * is the consequential one** — `isListingBrowsable` turns true, so the
 * plugin becomes installable by every workspace. Verified adds a badge on
 * top of that and ships nothing new. Anyone reading the queue needs to know
 * which of the two put executable code in front of customers.
 */
export interface ReviewStatusMeaning {
  /** Human label for the chip. */
  label: string
  /** One line: what this state means for customers, not for us. */
  meaning: string
  /** Installable by any workspace in this state? */
  live: boolean
  color: 'default' | 'success' | 'warning' | 'error' | 'info'
}

export const REVIEW_STATUS_MEANINGS: Record<string, ReviewStatusMeaning> = {
  submitted: {
    label: 'Submitted',
    meaning: 'Waiting for a reviewer. Not in the marketplace, not installable.',
    live: false,
    color: 'default',
  },
  in_review: {
    label: 'In review',
    meaning:
      'Someone is looking at it. Not in the marketplace, not installable.',
    live: false,
    color: 'info',
  },
  listed: {
    label: 'Listed',
    meaning:
      'LIVE — browsable in the marketplace and installable by every workspace. This is the state that puts the code in front of customers.',
    live: true,
    color: 'warning',
  },
  verified: {
    label: 'Verified',
    meaning:
      'LIVE, and carries the verified badge on its listing page — our own claim that a human reviewed it. Installability is identical to listed.',
    live: true,
    color: 'success',
  },
  rejected: {
    label: 'Rejected',
    meaning:
      'Turned down with a reason the publisher was notified of. Not in the marketplace, not installable.',
    live: false,
    color: 'error',
  },
}

/**
 * Does this takedown strip the Verified badge? (AGL-1121, decided 2026-08-03.)
 *
 * Verified is our claim that a human vouched for the PUBLISHER. A listing-wide
 * takedown is us saying the opposite, so the two cannot both stand.
 *
 * Lives here, beside the status meanings, because it is a statement about what
 * the statuses mean rather than request handling — and it is extracted from the
 * route so the policy is reachable from a test. The three conditions each rule
 * out a real case:
 *
 * - `hide` only. A restore must NOT re-grant; regranting is `verify`, which
 *   re-checks the checklist server-side. Getting the badge back is meant to
 *   cost a re-review.
 * - Listing target only. The same endpoint hides individual user REVIEWS
 *   (`reviewUid`), which say nothing about the publisher.
 * - Already `verified` only, so a takedown never rewrites some other verdict —
 *   demoting a `rejected` listing to `listed` would be a promotion.
 *
 * Per-version revocation deliberately does not qualify: that withdraws the
 * claim about THOSE BYTES, which the separate per-version "Reviewed" chip
 * already carries.
 */
export function shouldStripVerifiedOnTakedown(options: {
  action: string
  reviewStatus: string | undefined
  /** False when the target is an individual user review, not the listing. */
  isListingTarget: boolean
}): boolean {
  return (
    options.action === 'hide' &&
    options.isListingTarget &&
    options.reviewStatus === 'verified'
  )
}

/** What a stripped listing becomes. Not `rejected` — see the note above. */
export const VERIFIED_STRIPPED_STATUS = 'listed'

export function reviewStatusMeaning(status: string): ReviewStatusMeaning {
  return (
    REVIEW_STATUS_MEANINGS[status] ?? {
      label: status || 'Unknown',
      meaning: 'Unrecognised review state.',
      live: false,
      color: 'default',
    }
  )
}
