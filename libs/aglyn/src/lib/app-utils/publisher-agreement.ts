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

import { isPublishedLegalUrl } from './published-legal-pages'

/**
 * The version of the agreement currently in force.
 *
 * Matches the `Agreement version` header of the document itself, which is now
 * besigner content at {@link PUBLISHER_AGREEMENT_URL} rather than a repo file
 * (same practice as the Terms of Service). Bump this **only** when the
 * substance changes in a way a publisher should re-read — a typo fix is not a
 * bump. Bumping it stops every publisher at their next publish until they
 * accept again.
 *
 * Moved off `2026-07-28.1` on 2026-08-14 (AGL-1674). That string named the
 * July draft, which was never published and whose §8 said the publisher is the
 * seller of record. The published text says the opposite — Aglyn processes the
 * sale and remits transaction tax — so it is a different document in
 * substance, not a reissue, and re-asking is the point rather than a cost.
 */
export const PUBLISHER_AGREEMENT_VERSION = '2026-08-14.1'

export const PUBLISHER_AGREEMENT_TITLE = 'Marketplace Publisher Agreement'

/** Canonical document, on the marketing domain beside the other terms. */
export const PUBLISHER_AGREEMENT_URL =
  'https://aglyn.com/legal/marketplace-publisher-agreement'

/**
 * Whether that document can actually be read (AGL-1660).
 *
 * It could not, from the day this gate shipped until the day this check did:
 * the URL above 404ed, and the console still rendered it as "Read the full
 * Marketplace Publisher Agreement" above an Accept button. An acceptance
 * collected that way is a signature on a blank page — the same
 * publication-first principle the clickwrap snapshots are built on, failing in
 * the one place the text was never published at all.
 *
 * Derived, not a second flag: it reads `PUBLISHED_LEGAL_PATHS`, so the ONE
 * edit that adds the path when the page goes live is what re-opens acceptance
 * everywhere. There is no boolean to forget to flip, and no way for the link
 * and the gate to disagree.
 */
export function publisherAgreementIsPublished(
  url: string = PUBLISHER_AGREEMENT_URL,
): boolean {
  return isPublishedLegalUrl(url)
}

/**
 * What a publisher is told while the document has no page.
 *
 * Deliberately not "try again later" — it names the reason, because the fix is
 * ours and the publisher can do nothing about it. It must never read as though
 * accepting is something they merely have not got round to.
 */
export const PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE =
  `The ${PUBLISHER_AGREEMENT_TITLE} is not published yet, so there is ` +
  'nothing here for you to read — and we will not ask you to agree to a ' +
  'document we have not shown you. Acceptance is paused until it is ' +
  'available, which also means marketplace publishing is paused. Nothing is ' +
  'required of you in the meantime.'

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
    label: 'On paid listings we process the sale and take a fee',
    detail:
      'We process the purchase and pay your share into your own Stripe Connect account, less a platform fee that may change. We collect and remit sales tax on Marketplace sales; refunds, chargebacks and support on your Artifacts are yours.',
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

/**
 * What the acceptance UI may show (AGL-1660).
 *
 * The gate lives HERE rather than in the panel, for the reason every "check it
 * in the component" control eventually fails: the component is not the only
 * caller. The accept route consults the same function, so a client that skips
 * the UI entirely meets the same answer.
 *
 * `documentUrl` is null, not the URL, when the document is unpublished — the
 * console reads the link target from this, so an unreadable document is
 * structurally unable to reach an href.
 */
export interface PublisherAgreementPresentation {
  /** The document to link, or null when there is no page to link to. */
  documentUrl: string | null
  /** Whether the accept control may be offered at all. */
  canAccept: boolean
  /** Why acceptance is unavailable, or null when it is available. */
  unavailableNotice: string | null
}

export function publisherAgreementPresentation(
  state: PublisherAgreementState,
  published: boolean = publisherAgreementIsPublished(),
): PublisherAgreementPresentation {
  return {
    documentUrl: published ? PUBLISHER_AGREEMENT_URL : null,
    // Already current is not "cannot accept because unpublished" — it is
    // nothing left to do, and the panel says so separately.
    canAccept: published && state !== 'current',
    unavailableNotice: published ? null : PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
  }
}

/** The refusal a publisher sees, saying which of the two problems it is. */
export function publisherAgreementRefusal(
  state: PublisherAgreementState,
  published: boolean = publisherAgreementIsPublished(),
): string {
  // Sending someone to a control we have disabled is worse than saying
  // nothing: they go, find no button, and conclude the console is broken.
  if (!published) {
    return (
      `The ${PUBLISHER_AGREEMENT_TITLE} is not published yet, so it cannot ` +
      'be accepted and publishing is paused for everyone. This is on us, not ' +
      'on your organization.'
    )
  }
  return state === 'outdated'
    ? `The ${PUBLISHER_AGREEMENT_TITLE} has changed since your organization ` +
        'accepted it. Review and accept the current version in Marketplace → ' +
        'Publisher Profile, then publish.'
    : `Your organization has not accepted the ${PUBLISHER_AGREEMENT_TITLE}. ` +
        'Accept it in Marketplace → Publisher Profile, then publish.'
}
