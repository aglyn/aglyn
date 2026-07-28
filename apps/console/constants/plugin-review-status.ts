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
