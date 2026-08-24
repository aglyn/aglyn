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

import { LEGAL_ORIGIN, isPublishedLegalUrl } from './published-legal-pages'

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
 *
 * Moved to `2026-08-18.1` on 2026-08-18 (AGL-1840 + AGL-1661). Two body-text
 * changes: §1 now says "the Aglyn marketplace" (the AGL-975 rename, and the
 * reason this snapshot must NOT need the AGL-975 naming-guard exemption that
 * the `2026-08-14.1` one still carries), and §1's cross-reference to
 * the "End User Licence Agreement"
 * becomes "License" to match the document that agreement actually is, which
 * was renamed on the same day.
 *
 * ⚠️ Read against the "a typo fix is not a bump" rule above, both edits are
 * closer to a typo than to substance, and the tension is real. The bump was
 * taken anyway on Zach's decision (2026-08-18), for a reason the rule does not
 * cover: the served page changed, so keeping `2026-08-14.1` would leave the
 * pin below asserting a hash for text nobody is shown any more — a FALSE
 * RECORD, which is the exact failure the pin exists to detect. The choice is
 * therefore between a bump and a broken pin, not between a bump and nothing.
 *
 * ## 2026-08-22 — the page changed and this string DELIBERATELY did not
 *
 * Three clauses were added on 2026-08-22 (§3(h) listing conduct, §8.6 sales
 * through the Marketplace, §13.6 marks) and the pin below moved with them, but
 * `2026-08-18.1` stayed. That is not the third option the paragraph above says
 * does not exist — it is the same choice with one input changed. A bump exists
 * to re-ask publishers who accepted the OLD text; production holds exactly one
 * acceptance record and it is Zach's own, so there is nobody to re-ask and the
 * bump would buy nothing. Zach's decision, 2026-08-22.
 *
 * The pin still had to move, for precisely the reason given above: the served
 * bytes changed, so leaving the old hash here would assert a document nobody
 * is shown. Version unchanged + pin re-captured is coherent ONLY while the
 * acceptance set is empty. The first real publisher acceptance ends that, and
 * from then on any body-text change costs a bump — see the same rule in
 * `apps/console/constants/legal-documents.ts`, where the clickwrap snapshots
 * collapsed back to `v1` on the identical argument.
 *
 * ## 2026-08-24 — `2026-08-24.1`, and why this one CANNOT be folded (AGL-1956)
 *
 * §13.3 changed twice in one sentence. The venue moved from Williamson County
 * to TRAVIS County (Zach, 2026-08-24) — Williamson entered from the former
 * Jarrell residential address, while every published Aglyn address is 5900
 * Balcones Dr STE 100, Austin, TX 78731, which is Travis. And the clause cited
 * "Terms of Service Section 19" for governing law and venue when those live at
 * §18.6; §19 is General. A wrong cross-reference in a forum-selection clause is
 * the kind of defect that gets argued about, so it was corrected in the same
 * pass.
 *
 * Unlike 2026-08-22, this one takes the bump rather than only re-pinning, and
 * the deciding reason is mechanical rather than editorial: THIS VERSION STRING
 * IS PUBLISHED IN THE DOCUMENT. The page at {@link PUBLISHER_AGREEMENT_URL}
 * serves `Agreement version: 2026-08-24.1` in its own second line, so the
 * capture below contains it, and `publisher-agreement-version.spec.ts` asserts
 * the snapshot contains `Agreement version: ${PUBLISHER_AGREEMENT_VERSION}`.
 * Holding the constant at `2026-08-18.1` against that text would need the page
 * republished to say so, and would otherwise record a publisher as having
 * accepted `2026-08-18.1` while naming bytes that call themselves
 * `2026-08-24.1`. That is a false record of exactly the shape the pin exists
 * to prevent.
 *
 * ⚠️ THIS IS THE ONE PLACE THE CLICKWRAP ARGUMENT DOES NOT REACH. The signup
 * clickwrap folded its 2026-08-24 corrections into `v1` and did not bump
 * (`apps/console/constants/legal-documents.ts`) — Zach, 2026-08-24: no v2
 * before launch. That works there because `v1` is a REPO-SIDE label: the
 * published Terms carry a "Last updated" date and no version string at all, so
 * the label can stay still while the text moves. Here the label is part of the
 * document a publisher reads. The two schemes are not the same kind of thing
 * and must not be reasoned about as one — that difference is the whole content
 * of this paragraph.
 *
 * On the merits it would have been a bump anyway: a forum-selection clause is
 * substance, not a typo — it names the court a publisher would have to travel
 * to. The 2026-08-22 cost argument is unchanged and still cheap, production
 * holding exactly one acceptance record which is Zach's own.
 *
 * §8.1 and §8.3 are UNTOUCHED and were already correct: they have said Aglyn is
 * merchant of record and determines, collects and remits transaction tax since
 * 2026-08-14. The Terms of Service moved TO them in this pass (new ToS §10.7),
 * not the other way around.
 */
export const PUBLISHER_AGREEMENT_VERSION = '2026-08-24.1'

export const PUBLISHER_AGREEMENT_TITLE = 'Marketplace Publisher Agreement'

/**
 * The snapshot pin for the version above (AGL-1678).
 *
 * A version string is a label we control and can reuse, so on its own it
 * proves nothing about what a publisher actually read. These two values pin
 * the archived snapshot at
 * `legal/publisher-agreement/{PUBLISHER_AGREEMENT_VERSION}/marketplace-publisher-agreement.txt`
 * (beside this module), captured FROM THE LIVE PAGE after publication — the
 * same publication-first machinery as the signup clickwrap
 * (`apps/console/constants/legal-documents.ts`, AGL-1497), and deliberately a
 * PARALLEL manifest rather than an entry in `LEGAL_DOCUMENTS`: ToS §19.1 makes
 * that set the entire signup agreement, and the publisher agreement is
 * deliberately not part of it. Mixing them would widen what a signup
 * acceptance covers.
 *
 * Both values go onto every acceptance record, so a record is self-contained
 * evidence of content and later tampering with the archive is detectable
 * rather than invisible. `publisher-agreement-version.spec.ts` re-hashes the
 * snapshot, so one version string can never come to mean two different
 * documents.
 *
 * Capture method (proven byte-for-byte against the clickwrap v4 hashes before
 * this snapshot was taken): fetch the live page, walk its HTML text nodes
 * skipping script/style, trim each, drop empties, take the document's content
 * block (first line `Last updated: …` through its closing `© …` line,
 * excluding site chrome and the table of contents), join with `\n`, and end
 * with a trailing newline. UTF-8 throughout.
 *
 * TO PUBLISH A CHANGE: publish the besigner edit first, confirm the live page
 * serves it, capture a new snapshot under the new version's directory, then
 * bump `PUBLISHER_AGREEMENT_VERSION` and these two values together. Never
 * hand-write a snapshot: it is evidence of what a publisher was shown, and a
 * snapshot of unpublished text is a false record.
 */
export const PUBLISHER_AGREEMENT_SHA256 =
  '2df6e940f037b4630e53c8f63bad8604ef4bf370374b89afcd4ea7f9fe8e8d63'

/** Byte length of the same snapshot — a cheap second check on the content. */
export const PUBLISHER_AGREEMENT_BYTES = 13730

/**
 * Canonical document, on the operator's legal origin beside the other terms.
 *
 * Built from `LEGAL_ORIGIN` (AGL-2196), which this module already depends on:
 * `publisherAgreementIsPublished` below calls `isPublishedLegalUrl`, and that
 * accepts ONLY `LEGAL_ORIGIN`. So the gate was operator-aware while the link
 * it gates was a bare `aglyn.com` literal — meaning on a self-host install
 * with `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` set, the gate rejected the very URL
 * this file handed it, and every publisher was blocked from accepting. One
 * origin for both closes that, and leaves Aglyn's own URL byte-identical.
 */
export const PUBLISHER_AGREEMENT_URL = `${LEGAL_ORIGIN}/legal/marketplace-publisher-agreement`

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

/**
 * A recorded acceptance: which version, of which exact bytes, by whom, when.
 *
 * `sha256`/`bytes` (AGL-1678) pin the acceptance to the archived snapshot of
 * the text the publisher was shown. Optional because records written before
 * the pin existed carry only the version string — absence means "accepted
 * before 2026-08-17", not "accepted nothing".
 */
export interface PublisherAgreementAcceptance {
  version?: string
  sha256?: string
  bytes?: number
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
