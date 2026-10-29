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
 * The marketplace publisher agreement, and the box a publisher ticks to agree
 * to it on every save (AGL-1077, AGL-4105).
 *
 * Deliberately NOT the per-version attestation (AGL-969). An attestation is
 * a statement about *specific bytes*. This is about the *relationship*: what
 * we may do with a listing, what the publisher warrants, indemnity, takedown,
 * payouts, what survives termination.
 *
 * It was accepted once per organization and version, in a dialog. Since
 * AGL-4105 it is agreed to on EVERY publisher save instead: a profile, a
 * listing's words and pictures, its price or visibility, a version, a
 * component, template or layout. Each save form carries an unticked
 * "I agree to the Marketplace Publisher Agreement" box above its button, the
 * request carries {@link PublisherAgreementConsent}, and the route refuses a
 * write without it and records the acceptance. The org's `publisherAgreement`
 * stays as a note of the last acceptance (staff read it on the review page);
 * it no longer gates anything.
 *
 * Shared like the attestation model is, and for the same reason: every
 * publisher route enforces it, the console and the apps send it, and the
 * review page shows staff which terms a publisher is under. Copies of a
 * version string would drift.
 */

import { LEGAL_ORIGIN, isPublishedLegalUrl } from '@aglyn/aglyn/app-utils/published-legal-pages'

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
 * taken anyway on the decision (2026-08-18), for a reason the rule does not
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
 * acceptance record and it is the own, so there is nobody to re-ask and the
 * bump would buy nothing. the decision, 2026-08-22.
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
 * to TRAVIS County (decided) — Williamson entered from the former
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
 * (`apps/console/constants/legal-documents.ts`) — decided: no v2
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
 * holding exactly one acceptance record which is the own.
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
 * bump `PUBLISHER_AGREEMENT_VERSION` and these two values together, and add
 * the version's entry to `PUBLISHER_AGREEMENT_CHANGES` below. Never
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
 * What each version changed from the one before it, in the words a publisher
 * re-accepting needs (AGL-3407).
 *
 * An org that accepted an older version is asked again, and "the terms
 * changed" with nothing more is a request to re-read thirteen sections to
 * find two edited clauses. Each entry names the sections that moved, read off
 * the archived snapshots beside this module (`legal/publisher-agreement/`) —
 * never written from memory of the edit, for the same reason a snapshot is
 * never hand-written.
 *
 * Oldest first. The last entry is always {@link PUBLISHER_AGREEMENT_VERSION}:
 * a bump adds its entry in the same change, and
 * `publisher-agreement-version.spec.ts` fails a bump that did not. The first
 * published version has no entry, because nothing preceded it that anyone
 * accepted.
 */
export const PUBLISHER_AGREEMENT_CHANGES: readonly {
  version: string
  changes: readonly string[]
}[] = [
  {
    version: '2026-08-18.1',
    changes: [
      '§1 names the marketplace and the End User License Agreement by their current names.',
      '§3(h), new: listing conduct — what an Artifact and its listing may not claim about the platform, its plans or its prices.',
      '§8.6, new: a paid Artifact, tier or license key must be sold through the Marketplace.',
      '§13.6, new: how you may use the platform’s names and marks.',
    ],
  },
  {
    version: '2026-08-24.1',
    changes: [
      '§13.3: venue moves to Travis County, Texas, and governing law now cites Terms of Service Section 18.6.',
    ],
  },
]

/**
 * The changes an org has not yet accepted, oldest first.
 *
 * Versions are dated strings (`YYYY-MM-DD.n`), so they order as text. An
 * acceptance of a version this list does not name — one older than the first
 * entry — gets every entry, which is the honest answer: all of it is new to
 * them. No acceptance at all gets none, because a first acceptance is of the
 * whole document, not a set of edits.
 */
export function publisherAgreementChangesSince(
  acceptedVersion: string | null | undefined,
  currentVersion: string = PUBLISHER_AGREEMENT_VERSION,
): readonly { version: string; changes: readonly string[] }[] {
  const accepted = typeof acceptedVersion === 'string' ? acceptedVersion.trim() : ''
  if (!accepted) return []
  return PUBLISHER_AGREEMENT_CHANGES.filter(
    (entry) => entry.version > accepted && entry.version <= currentVersion,
  )
}

/**
 * The org's last acceptance, as `publisherProfiles/{orgId}.publisherAgreement`
 * notes it: which version, of which exact bytes, by whom, when. Rewritten by
 * every save since AGL-4105, beside the append-only record of each one
 * ({@link PublisherAgreementAcceptanceRecord}).
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
 * Whether an org's last acceptance is of the version in force.
 *
 * A note since AGL-4105, not a gate: every save agrees again on its own
 * ({@link publisherAgreementConsentRefusal}). Read by the first-party starter
 * seeding script, which writes listings without a save form.
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

/*==========================================
 * AGREED TO ON EVERY SAVE (AGL-4105).
 *
 * Every publisher save — a profile, a listing's words, pictures, categories,
 * price or visibility, unpublishing or republishing it, a version, a
 * component, template, theme, layout, dataset schema or email, asking for the
 * Verified badge — carries {@link PublisherAgreementConsent}. The console and
 * the apps send it only while the person has ticked the box above the button,
 * and the box is unticked again after every save, so each save is its own
 * agreement. The routes refuse a write without it
 * ({@link publisherAgreementConsentRefusal}) and record who agreed, to which
 * version, for what, and from where.
 *=========================================*/

/** What a save sends while its box is ticked: the version it agrees to. */
export interface PublisherAgreementConsent {
  version: string
  accepted: true
}

/** The box's sentence; the agreement's title in it is the link to the document. */
export const PUBLISHER_AGREEMENT_CONSENT_LABEL = `I agree to the ${PUBLISHER_AGREEMENT_TITLE}`

/** What a save without the box ticked is told. */
export const PUBLISHER_AGREEMENT_CONSENT_REQUIRED = `Tick '${PUBLISHER_AGREEMENT_CONSENT_LABEL}' to save`

/** What a save that agreed to an older version is told: the page was open across a change. */
export const PUBLISHER_AGREEMENT_CONSENT_OUTDATED =
  `The ${PUBLISHER_AGREEMENT_TITLE} changed while this was open. Reload, read ` +
  'the current version and tick the box again to save.'

/** What a save sends once its box is ticked. */
export function publisherAgreementConsent(
  version: string = PUBLISHER_AGREEMENT_VERSION,
): PublisherAgreementConsent {
  return { version, accepted: true }
}

/**
 * Why a save's `agreement` does not count, or null when it does.
 *
 * `missing`: absent, not ticked, or not this shape. `outdated`: ticked for a
 * version that is no longer in force, which is a page left open across a
 * change, not a publisher who declined. `unavailable`: the document has no
 * published page, so nothing can be agreed to (AGL-1660) whatever was sent.
 */
export type PublisherAgreementConsentProblem = 'missing' | 'outdated' | 'unavailable'

export function publisherAgreementConsentProblem(
  raw: unknown,
  options: { currentVersion?: string; published?: boolean } = {},
): PublisherAgreementConsentProblem | null {
  const currentVersion = options.currentVersion ?? PUBLISHER_AGREEMENT_VERSION
  const published = options.published ?? publisherAgreementIsPublished()
  if (!published) return 'unavailable'
  const consent = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (consent['accepted'] !== true) return 'missing'
  const version = typeof consent['version'] === 'string' ? consent['version'].trim() : ''
  if (!version) return 'missing'
  return version === currentVersion ? null : 'outdated'
}

/**
 * The refusal a save without a counting `agreement` gets, or null when it may
 * go ahead. One answer for every publisher route.
 *
 * 428, like the per-version attestation (AGL-969): both say "tick the box in
 * the form in front of you". A version from before a change is 409, the
 * conflict-with-current-state answer the retired accept route gave the same
 * mismatch, and so is an unpublished document. `agreement` is the
 * machine-readable half, for a client that wants to point at the box.
 */
export function publisherAgreementConsentRefusal(
  raw: unknown,
  options: { currentVersion?: string; published?: boolean } = {},
): { status: number; body: Record<string, unknown> } | null {
  const problem = publisherAgreementConsentProblem(raw, options)
  if (!problem) return null
  const required = options.currentVersion ?? PUBLISHER_AGREEMENT_VERSION
  const agreement = { required, state: problem }
  if (problem === 'unavailable') {
    return { status: 409, body: { error: PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE, agreement } }
  }
  if (problem === 'outdated') {
    return { status: 409, body: { error: PUBLISHER_AGREEMENT_CONSENT_OUTDATED, agreement } }
  }
  return { status: 428, body: { error: PUBLISHER_AGREEMENT_CONSENT_REQUIRED, agreement } }
}

/**
 * What the box may show (AGL-1660, AGL-4105): the link, and whether it can be
 * ticked at all. The box reads its href from here, never from
 * {@link PUBLISHER_AGREEMENT_URL}, so an unpublished document cannot reach a
 * link and cannot be agreed to.
 */
export interface PublisherAgreementConsentPresentation {
  /** The document to link, or null when there is no page to link to. */
  documentUrl: string | null
  /** Whether the box may be ticked. */
  canAgree: boolean
  /** Why it cannot be, or null when it can. */
  unavailableNotice: string | null
}

export function publisherAgreementConsentPresentation(
  published: boolean = publisherAgreementIsPublished(),
): PublisherAgreementConsentPresentation {
  return {
    documentUrl: published ? PUBLISHER_AGREEMENT_URL : null,
    canAgree: published,
    unavailableNotice: published ? null : PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
  }
}

/**
 * Where an acceptance came from, as its record names it: one name per
 * publisher save. Closed, so a record can always be read back as an action.
 */
export const PUBLISHER_AGREEMENT_ACTIONS = [
  'save-profile',
  'publish-component',
  'publish-layout',
  'publish-template',
  'publish-starter',
  'publish-theme',
  'publish-dataset-schema',
  'publish-email-template',
  'publish-email-starter',
  'publish-plugin',
  'update-listing',
  'set-preview-image',
  'remove-preview-image',
  'set-visibility',
  'set-published',
  'request-verification',
  'withdraw-verification',
] as const

export type PublisherAgreementAction = (typeof PUBLISHER_AGREEMENT_ACTIONS)[number]

/**
 * One acceptance, as `orgs/{orgId}/publisherAgreementAcceptances/{id}` holds
 * it: append-only and server-written, with the evidence a signature's audit
 * keeps (the hardware terms' acceptance is the same shape, AGL-4038) — which
 * text, by whom, when, for which save, and from which device.
 */
export interface PublisherAgreementAcceptanceRecord {
  version: string
  /** The archived snapshot's pin (AGL-1678), so the record names the bytes as well as the label. */
  sha256: string
  bytes: number
  orgId: string
  uid: string
  /** Whether the person was acting as staff rather than as the publisher. */
  staff: boolean
  action: PublisherAgreementAction
  /** The listing, profile or source the save wrote, or null where it has none yet. */
  targetId: string | null
  ip: string | null
  userAgent: string | null
  atMs: number
}

/** A fresh acceptance of the agreement in force. */
export function publisherAgreementAcceptanceRecord(input: {
  orgId: string
  uid: string
  staff?: boolean
  action: PublisherAgreementAction
  targetId?: string | null
  ip?: string | null
  userAgent?: string | null
  atMs: number
}): PublisherAgreementAcceptanceRecord {
  const text = (value: string | null | undefined, max: number) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
  return {
    version: PUBLISHER_AGREEMENT_VERSION,
    sha256: PUBLISHER_AGREEMENT_SHA256,
    bytes: PUBLISHER_AGREEMENT_BYTES,
    orgId: input.orgId,
    uid: input.uid,
    staff: input.staff === true,
    action: input.action,
    targetId: text(input.targetId, 256),
    ip: text(input.ip, 100),
    userAgent: text(input.userAgent, 400),
    atMs: input.atMs,
  }
}
