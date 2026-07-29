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
 * The marketplace publisher agreement, and whether an org has accepted the
 * current one (AGL-1077).
 *
 * Deliberately NOT the per-version attestation (AGL-969). An attestation is
 * a statement about *specific bytes* and re-asks on every republish, because
 * the bytes changed. This is about the *relationship*: what we may do with a
 * listing, what the publisher warrants, indemnity, takedown, payouts, what
 * survives termination. It is accepted once, by an org, and re-asked only
 * when we change it.
 *
 * Shared like the attestation model is, and for the same reason: the publish
 * route enforces it, the profile page collects it, and the review page shows
 * staff which terms a publisher is actually under. Three copies of a version
 * string would drift, and a drifted version is one that either re-asks
 * forever or never re-asks at all.
 */

/**
 * The version of the agreement currently in force.
 *
 * Matches the `Agreement version` header of the document itself, which lives
 * in the legal-docs Drive folder rather than the repo (same practice as the
 * Terms of Service). Bump this **only** when the substance changes in a way
 * a publisher should re-read — a typo fix is not a bump. Bumping it stops
 * every publisher at their next publish until they accept again.
 */
export const PUBLISHER_AGREEMENT_VERSION = '2026-07-28.1'

export const PUBLISHER_AGREEMENT_TITLE = 'Marketplace Publisher Agreement'

/** Canonical document, on the marketing domain beside the other terms. */
export const PUBLISHER_AGREEMENT_URL =
  'https://aglyn.com/legal/marketplace-publisher-agreement'

/**
 * What the agreement actually commits a publisher to.
 *
 * Shown above the accept control. A link alone is the pattern that produces
 * agreements nobody has read; these are the terms most likely to surprise
 * someone later, in the words they would need at that moment. They summarise
 * the document — they are not it, and the copy says so.
 */
export const PUBLISHER_AGREEMENT_POINTS: readonly {
  id: string
  label: string
  detail: string
}[] = [
  {
    id: 'hosting-license',
    label: 'We may host, verify and distribute what you publish',
    detail:
      'Including keeping an immutable copy of every version, inspecting its code, and showing your listing content in the marketplace and console.',
  },
  {
    id: 'warranties',
    label: 'You warrant each version as you publish it',
    detail:
      'That you have the right to publish it, that its license is accurate and compatible, that it carries no malware or hidden telemetry, and that its documentation describes what it does with data.',
  },
  {
    id: 'immutable',
    label: 'You cannot recall code that is already installed',
    detail:
      'Installs pin an exact version and hash. A mistake ships until an installer chooses to upgrade — publishing a new version is the only remedy you have.',
  },
  {
    id: 'revocation',
    label: 'We can disable a version everywhere, without notice',
    detail:
      'If a version looks like a security, legal or privacy risk we stop it on every site running it, and tell you afterwards. Operating a platform that executes other people’s code requires this.',
  },
  {
    id: 'review',
    label: 'Review is a safety screen, not an endorsement',
    detail:
      'Approval is not an audit and not a guarantee your plugin works. We may decline, delist or unsign anything, for reasons that may have nothing to do with your code.',
  },
  {
    id: 'payouts',
    label: 'On paid listings you are the seller',
    detail:
      'Payments run through your own Stripe Connect account, we take a platform fee that may change, and refunds, chargebacks, taxes and support on your sales are yours.',
  },
  {
    id: 'indemnity',
    label: 'You indemnify us for claims arising from what you publish',
    detail:
      'Including infringement claims and disputes with the organizations that install it.',
  },
]

/** A recorded acceptance: which version, by whom, when. */
export interface PublisherAgreementAcceptance {
  version?: string
  acceptedBy?: string
  acceptedAt?: unknown
}

/**
 * Where an org stands with the agreement.
 *
 * `none` and `outdated` are deliberately different answers. "You have never
 * agreed to anything" and "the terms changed since you agreed" are different
 * situations with different copy, and collapsing them into a boolean is how
 * a re-acceptance ends up reading like a first-time setup step.
 */
export type PublisherAgreementState = 'none' | 'outdated' | 'current'

export function publisherAgreementState(
  acceptance: PublisherAgreementAcceptance | null | undefined,
  currentVersion: string = PUBLISHER_AGREEMENT_VERSION,
): PublisherAgreementState {
  const accepted = acceptance?.version
  if (typeof accepted !== 'string' || !accepted.trim()) return 'none'
  return accepted === currentVersion ? 'current' : 'outdated'
}

/**
 * Whether a publish may proceed.
 *
 * An older acceptance is NOT carried forward. Whoever publishes next reads
 * the changed agreement and accepts it, or does not publish — silently
 * inheriting an acceptance across a rewrite is precisely what makes the
 * record worthless.
 */
export function hasCurrentPublisherAgreement(
  acceptance: PublisherAgreementAcceptance | null | undefined,
  currentVersion: string = PUBLISHER_AGREEMENT_VERSION,
): boolean {
  return publisherAgreementState(acceptance, currentVersion) === 'current'
}

/** The refusal a publisher sees, saying which of the two problems it is. */
export function publisherAgreementRefusal(
  state: PublisherAgreementState,
): string {
  return state === 'outdated'
    ? `The ${PUBLISHER_AGREEMENT_TITLE} has changed since your organization ` +
        'accepted it. Review and accept the current version in Marketplace → ' +
        'Publisher Profile, then publish.'
    : `Your organization has not accepted the ${PUBLISHER_AGREEMENT_TITLE}. ` +
        'Accept it in Marketplace → Publisher Profile, then publish.'
}
