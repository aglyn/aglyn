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
 * Who may ask for the Verified badge, and when (AGL-1217).
 *
 * In core rather than beside the rest of the marketplace model for the same
 * reason `marketplace-provenance` is (AGL-1016): the console's staff review
 * route needs this policy, and `scope:app` may not depend on `aglyn:addons`.
 * The marketplace model re-exports everything here, so publishing code keeps
 * importing it from one place.
 *
 * A leaf module with no imports — it is reached from the browser, from React
 * Server Components and from API routes, and every barrel that could carry it
 * is illegal in at least one of those.
 */

export type VerificationRequestState =
  | 'pending'
  | 'granted'
  | 'declined'
  | 'withdrawn'

/**
 * Firestore timestamps arrive in two shapes: an SDK `Timestamp` carrying
 * `toMillis()`, and the plain `{seconds}` object a serialized doc decays into.
 * Policy has to read both or it silently scores a real date as absent.
 */
export type TimestampLike =
  | { toMillis?: () => number; seconds?: number }
  | null
  | undefined

/** Milliseconds for either timestamp shape; `null` when there is no date. */
export function timestampMs(value: TimestampLike): number | null {
  if (!value) return null
  if (typeof value.toMillis === 'function') {
    const ms = value.toMillis()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

/**
 * A publisher's ask for the Verified badge.
 *
 * Deliberately NOT a member of `ListingReviewStatus`. That union's
 * consequential axis is live vs. not live — `listed` is what makes a plugin
 * installable by every workspace — and a listing can be live *and* awaiting a
 * verification decision at the same time. A `verification_requested` member
 * would have to answer "is this live?" and both answers are wrong.
 *
 * A record rather than a `verificationRequestedAt` timestamp because
 * verification may become a paid offering. A timestamp has to be rewritten the
 * day that lands; this absorbs an order reference without a migration.
 */
export interface ListingVerificationRequest {
  requestedAt?: TimestampLike
  /** Publisher uid — a person asked, not "the org asked". */
  requestedBy?: string
  state: VerificationRequestState
  decidedAt?: TimestampLike
  /** Staff uid, or the publisher's own on a withdrawal. */
  decidedBy?: string
  declineReason?: string
  /** Room for a payment reference when verification becomes purchasable. */
  orderRef?: string
}

/**
 * How long a publisher waits after a decline before asking again.
 *
 * Queue hygiene, not punishment: without it a publisher can re-request in a
 * loop and staff lose the signal that a request means something changed.
 */
export const VERIFICATION_DECLINE_COOLDOWN_DAYS = 30

/** Why a publisher may not ask right now — `null` when they may. */
export type VerificationRequestBlock =
  | 'not-publisher'
  | 'already-verified'
  | 'not-listed'
  | 'already-pending'
  | 'cooling-down'

/** The listing fields this policy reads, structurally — core cannot see the
 * marketplace model's `MarketplaceListing`. */
export interface VerifiableListing {
  profileId?: string
  reviewStatus?: string
  verificationRequest?: ListingVerificationRequest
}

/**
 * A reason rather than a boolean, so the UI can say which and so the server
 * and the button cannot drift into disagreeing about the rule. Both call this.
 */
export function verificationRequestBlock(options: {
  listing: VerifiableListing | null | undefined
  /** The org the viewer is acting as. */
  viewerOrgId: string | null | undefined
  /** `Date.now()` on the client; server time on the server. */
  nowMs: number
}): VerificationRequestBlock | null {
  const { listing, viewerOrgId, nowMs } = options
  if (!listing || !viewerOrgId || listing.profileId !== viewerOrgId) {
    return 'not-publisher'
  }
  if (listing.reviewStatus === 'verified') return 'already-verified'
  // Only a LIVE listing can be verified. Asking while `submitted`, `in_review`
  // or `rejected` is asking for a badge on something customers cannot install,
  // and it would put verification requests into a queue that already has a
  // different reason to look at the listing.
  //
  // A legacy listing with NO status is treated as `listed` elsewhere, but not
  // here: verification is a deliberate act, and an absent field is not enough
  // to hang a badge request on.
  if (listing.reviewStatus !== 'listed') return 'not-listed'

  const request = listing.verificationRequest
  if (request?.state === 'pending') return 'already-pending'
  if (request?.state === 'declined') {
    const decidedAt = timestampMs(request.decidedAt)
    // Fail closed on an undated decline. Assuming it is old enough turns a
    // missing field into a free retry, which is what the cooldown prevents.
    if (decidedAt === null) return 'cooling-down'
    const elapsedDays = (nowMs - decidedAt) / 86_400_000
    if (elapsedDays < VERIFICATION_DECLINE_COOLDOWN_DAYS) return 'cooling-down'
  }
  return null
}

/** What to tell the publisher for each block reason. */
export const VERIFICATION_BLOCK_MESSAGES: Record<
  VerificationRequestBlock,
  string
> = {
  'not-publisher': 'Only the publishing organization can request verification.',
  'already-verified': 'This listing is already verified.',
  'not-listed':
    'Only a listed plugin can be verified. This one is still going through review.',
  'already-pending': 'A verification request is already waiting for a decision.',
  'cooling-down': `Verification was declined recently. You can ask again ${VERIFICATION_DECLINE_COOLDOWN_DAYS} days after the decision.`,
}
