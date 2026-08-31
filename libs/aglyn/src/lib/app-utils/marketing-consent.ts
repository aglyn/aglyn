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
 * The READ side of marketing consent (`docs/specs/email-overhaul.md` §3f).
 *
 * `marketingConsent` has seven writers and, until this module, no reader on
 * any send path: `performCampaignSend` filtered on the suppression list and
 * on nothing else, so a recorded opt-in and a recorded opt-OUT reached the
 * same inbox. This is the join that makes the field mean something.
 *
 * ## A basis is DECLARED, never inferred
 *
 * Nothing here treats an act as consent. Submitting a form, buying, booking,
 * or holding an account are all things a person did for their own reasons,
 * and none of them is an opt-in to marketing email. The only input is a
 * stored `marketingConsent` written from a checkbox the person ticked. That
 * is why {@link readMarketingBasis} takes a document rather than a silo name:
 * there is no silo whose mere membership grants a basis.
 *
 * ## Three states, not two
 *
 * The field is written `true` by six capture paths and `false` by exactly one
 * (`POST /v1/contacts`), so absence is not refusal — it is the far commoner
 * case of a record captured before the checkbox existed. Collapsing absent
 * into refused is what would empty an existing audience overnight; collapsing
 * it into granted is what the product does today. Both are wrong, so the
 * split is carried through to the caller as three counts rather than a
 * boolean.
 *
 * ## A basis also records WHOSE act it was
 *
 * A basis an operator asserted over existing records — see
 * `tools/scripts/backfill-marketing-consent.mjs` — is mailable, because an
 * org that asserted it meant that data to be reachable. It is not, however,
 * the same fact as a checkbox somebody ticked, and two fields that store
 * only `true` and a date cannot tell the difference. So an asserted basis
 * carries {@link MARKETING_CONSENT_SOURCE_FIELD} naming who asserted it,
 * when, and why, and every reader gets that distinction back as
 * {@link MarketingConsentRecord.assertedBy}. Consent is only evidence for as
 * long as its origin survives with it.
 *
 * ## A basis also records WHICH BRAND it was given to
 *
 * Contacts are ORG-scoped and shared across every site in the org, which is
 * deliberate: an agency running many client brands out of one account keeps
 * one address book. Consent is not shareable on the same terms. It runs to a
 * controller — the brand named on the form, in the sender line and in the
 * privacy notice the person read — and not to the account that happens to
 * hold the row. One boolean per person cannot express that, so somebody who
 * opted in to one client's newsletter was mailable by every other client in
 * the agency, on a basis none of them was given.
 *
 * So a basis is stored per (person, host), under
 * {@link MARKETING_CONSENT_BY_HOST_FIELD}, and {@link readMarketingBasis}
 * takes the host it is being read FOR. The host argument is required and has
 * no default: a reader that has not said which brand is asking cannot
 * compile, which is the same guarantee `newResourceScopeFields` gives on the
 * write side of scoped resources.
 *
 * ## FIVE states, because collapsing any two of them is a bug in one
 * direction or the other
 *
 * "This host has no basis for this person" and "another host has one" and "a
 * grant exists that names no host at all" and "this person refused" are
 * different facts, and every pair of them collapses into either a leak or a
 * silent failure to mail somebody who did opt in. They are carried apart all
 * the way to the caller as {@link MarketingConsentReason}, and
 * {@link MarketingConsentSplit} counts them separately rather than reporting
 * one `withheld` total that cannot be explained to a merchant.
 *
 * ## A REFUSAL over-applies; a GRANT never does
 *
 * The pre-host field is still read, and asymmetrically. A stored
 * `marketingConsent: false` refuses for every host, because a refusal
 * recorded against nobody in particular is most safely honored against
 * everybody, and withholding mail is recoverable where sending it is not. A
 * stored `marketingConsent: true` grants to NO host: it is a claim with no
 * controller attached, and spreading it across an agency's unrelated clients
 * is precisely the defect this module exists to end. Such a record reports
 * {@link MarketingConsentRecord.otherGrant} as `'unscoped'` so a console can
 * say why somebody stopped being mailable, and so
 * `tools/scripts/backfill-consent-host.mjs` can find them.
 */

import {
  type ConsentGroup,
  soloConsentGroup,
} from './consent-groups'

/**
 * The document field carrying WHO asserted a stored basis, and why.
 *
 * `marketingConsent` on its own records only WHAT the basis is. A record
 * written by an operator and a record written from a checkbox a person
 * ticked are the same two fields with the same two values, so nothing
 * downstream — a console readout, an export, a regulator's question — can
 * tell them apart. That is the difference between consent that is evidence
 * and consent that is an assertion, so it is carried on the record itself
 * rather than left to be reconstructed from when a script happened to run.
 *
 * Absent on every record written from a capture surface, which is why
 * {@link readMarketingBasis} reads its absence as the person's own act: the
 * six checkbox writers are the norm and an operator assertion is the thing
 * that has to announce itself.
 */
export const MARKETING_CONSENT_SOURCE_FIELD = 'marketingConsentSource'

/**
 * The `kind` an operator backfill stamps. A named constant because the
 * script that writes it and the reader that finds it are in different
 * languages and cannot share a type.
 */
export const OPERATOR_BACKFILL_CONSENT_KIND = 'operator-backfill'

/**
 * The document field a LIST MEMBERSHIP carries beside `marketingConsent`,
 * naming which of the two ways in produced it.
 *
 * `list-members.ts` writes it, with `'contact-opt-in'` for a basis carried
 * across from the person's own record and
 * {@link OPERATOR_ATTESTED_CONSENT_BASIS} for one a console account asserted.
 * It is read here because a membership is a person record like any other to
 * every reader in the send path, and a reader that knew only about
 * {@link MARKETING_CONSENT_SOURCE_FIELD} would report an attestation as the
 * person's own act.
 */
export const MARKETING_CONSENT_BASIS_FIELD = 'marketingConsentBasis'

/**
 * The value of {@link MARKETING_CONSENT_BASIS_FIELD} that means an operator
 * stated they have this person's permission.
 *
 * A string literal shared by the writer and the reader rather than a type,
 * for the reason above: the enrollment path stores this on a document and
 * this module reads it back off one, and a document has no types.
 */
export const OPERATOR_ATTESTED_CONSENT_BASIS = 'operator-attested'

/**
 * The `kind` synthesized for an attested membership that carries no
 * {@link MARKETING_CONSENT_SOURCE_FIELD} of its own.
 *
 * The console's one-address add path stores the attesting account in
 * `marketingConsentByUid` and no provenance object, so the provenance a
 * reader can honestly report for those rows is exactly "an account attested
 * this" plus the account. Naming the kind rather than leaving the source
 * `null` is what lets a console readout say WHO, which is the whole reason
 * the attribution is stored.
 */
export const OPERATOR_ATTESTED_CONSENT_KIND = 'operator-attested'

/**
 * The boolean field a basis has always been stored in.
 *
 * Named rather than spelled out at each site because it now appears in two
 * positions — at the top of a person document, and again inside every entry
 * of {@link MARKETING_CONSENT_BY_HOST_FIELD} — and the second position is
 * only readable by the same parser as the first while both agree on the name.
 */
export const MARKETING_CONSENT_FIELD = 'marketingConsent'

/**
 * The map field holding one consent entry per host: `{ [hostId]: entry }`,
 * where an entry carries exactly the fields the top level carries.
 *
 * ## Why a map on the person document and not a subcollection
 *
 * The send path reads consent out of the audience sweep, while the person's
 * document is already in hand — that placement is what keeps the consent join
 * free. A subcollection would make it one extra read PER RECIPIENT PER
 * CAMPAIGN, on the one path in the product whose cost scales with the size of
 * a customer's list. The map rides along with a document that is being read
 * anyway.
 *
 * ## Why keyed by host id
 *
 * `entry = map[hostId]` is a lookup that has no way to return another host's
 * grant. A list of entries carrying a `hostId` field would have to be
 * searched, and a search is something a caller can get wrong — a `.find()`
 * whose predicate is dropped still returns a grant, just somebody else's.
 * There is no expression of this shape that reads host B's consent while
 * asking about host A.
 *
 * ## Why the entries repeat the top-level field names
 *
 * So that one parser reads both. Provenance, the attested-basis marker, the
 * attesting account and the timestamp all mean the same thing wherever they
 * sit, and a second set of names would be a second set of rules for the two
 * positions to disagree about — which is how the attested-membership case
 * came to be reported as a person's own act in the first place.
 */
export const MARKETING_CONSENT_BY_HOST_FIELD = 'marketingConsentByHost'

/**
 * The field naming every host that has CAPTURED a person record.
 *
 * Not consent, and deliberately not stored with it. Somebody captured by one
 * brand may go on to consent to two, or to none; conflating capture with
 * permission is how an act a person took for their own reasons — booking a
 * table, buying a thing — comes to be read as an opt-in. It is here because a
 * grandfathered basis is a claim about WHEN a record was captured, and that
 * claim only ever belonged to the brands that captured it.
 *
 * ## An ARRAY, and top-level, because it has to be a QUERY
 *
 * It serves both organizations from one field. An agency filters to "the
 * people MY site captured"; a business running three sites as one asks for
 * "everyone captured on A, B or C". Both are `array-contains-any` over this
 * field, which is why it is a top-level array of ids and not a label on a
 * detail page and not a map: Firestore can filter this shape and cannot
 * filter an array of objects.
 *
 * It GROWS. A person who fills in a second site's form is captured by that
 * site too, and the write is an `arrayUnion` on the merge branch as well as
 * on the create — which is exactly what the create-only `hostId` beside it
 * could never record.
 *
 * Read with the scalar `hostId` as a fallback on `contacts`, which has
 * stamped its FIRST capturing host under that name since the collection
 * existed. That is a strict subset of this fact under an older name, and a
 * reader that ignored it would report every existing contact as unattributed.
 */
export const CAPTURED_BY_HOST_FIELD = 'capturedByHostIds'

/**
 * The consent group a stored grant was given to, recorded ON THE ENTRY.
 *
 * The declaration lives on the org and can change; this is what was DISCLOSED
 * to this person at the moment they agreed. Reading pooling from the org's
 * current declaration instead would let adding a site to a group widen every
 * grant ever made, which is the leak with a configuration screen in front of
 * it. So the group travels with the grant, and a group that grows reaches
 * only the captures that come after it.
 */
export const CONSENT_GROUP_ID_FIELD = 'consentGroupId'

/**
 * The group's display name as the capture surface showed it.
 *
 * Stored beside the id because the id is not evidence: answering "what was
 * this person told" with a document key is answering a different question.
 * A group can also be renamed, and the name that matters is the one on the
 * screen they were looking at.
 */
export const CONSENT_GROUP_NAME_FIELD = 'consentGroupName'

/** The provenance stored alongside a basis somebody other than the person set. */
export interface MarketingConsentSource {
  /** What kind of assertion this is — {@link OPERATOR_BACKFILL_CONSENT_KIND}. */
  kind: string
  /** The operator who asserted it. Never blank on a well-formed record. */
  by: string
  /** When they asserted it. */
  atMs: number | null
  /** Why, in prose, for whoever audits this later. */
  reason: string
}

/** Whose act a stored basis represents. */
export type MarketingConsentAssertedBy = 'person' | 'operator'

/** What a person's stored consent record says, if anything. */
export type MarketingBasis =
  /** A checkbox was ticked and stored. Mailable under every policy. */
  | 'granted'
  /** A stored refusal. Never mailable, under every policy. */
  | 'declined'
  /** No consent field on the record at all — see {@link MarketingConsentPolicy}. */
  | 'unrecorded'

/**
 * A grant this host may not use, and which kind it is.
 *
 * Reported so that "nobody has ever consented for this person" and "somebody
 * consented, to a brand that is not the one asking" stay distinguishable. The
 * two produce the same verdict and must not produce the same explanation: the
 * first is a list that was never opted in, and the second is an agency's
 * client reaching for another client's audience.
 *
 * `'other-host'` outranks `'unscoped'` when both are true. Operationally they
 * are the same refusal, and the named host is the more useful half to show.
 */
export type MarketingConsentOtherGrant = 'none' | 'other-host' | 'unscoped'

/** One recipient's consent facts, as read off whichever silo produced them. */
export interface MarketingConsentRecord {
  /**
   * The host this record was read FOR. Every field below answers about this
   * host and no other.
   *
   * Carried on the record rather than remembered by the caller because a
   * consent map is built in one place and consumed in another —
   * {@link splitByMarketingConsent} refuses a map whose records were read for
   * a different host, and it can only do that if the records say.
   */
  hostId: string
  /**
   * The consent group the read was made against — the declared set of sites
   * that are ONE sender, or the site alone when nothing was declared.
   *
   * A grant is looked up under {@link hostId} alone, because pooling is
   * written forward at capture. A REFUSAL is honored across every site in
   * this group, because a person who unsubscribed from one of three sites
   * that present as one sender has left the sender, and asking them to do it
   * twice more is both hostile and wrong.
   */
  groupId: string
  /**
   * A grant that exists but is not this host's — see
   * {@link MarketingConsentOtherGrant}. `'none'` when there is no such grant,
   * which is the only value under which an absent basis may grandfather.
   */
  otherGrant: MarketingConsentOtherGrant
  /**
   * Every host that captured the underlying person record; empty when none
   * is attributed.
   *
   * Attribution, not permission. It is read here for exactly one decision:
   * a record grandfathers on its capture date, and a date another brand
   * earned is not this brand's to rely on. An EMPTY list is the honest
   * unattributed case and grandfathers, for the reason a missing capture
   * DATE does — the unknown leans toward reachable.
   */
  capturedByHostIds: string[]
  /**
   * Whether any of {@link capturedByHostIds} is a member of the group this
   * record was read for.
   *
   * Derived at read time, because the raw list is a fact about the person and
   * this is a fact about the relationship — and only the reader holds the
   * group's membership. It is the input to grandfathering: the argument that
   * a record predates enforcement belongs to whoever collected the address,
   * and three sites declared as one sender collected it together.
   */
  capturedByGroup: boolean
  basis: MarketingBasis
  /**
   * Whose act the basis represents, or `null` when there is no basis to
   * attribute. `'person'` for the capture surfaces, `'operator'` for a basis
   * an operator asserted on somebody's behalf.
   *
   * Not a second grade of mailability — {@link marketingConsentVerdict}
   * ignores it, because an org that asserted a basis for its own seed data
   * meant that data to be reachable. It exists so every surface that reports
   * consent can report which kind it has, instead of presenting an assertion
   * as evidence.
   */
  assertedBy: MarketingConsentAssertedBy | null
  /** The provenance behind an `'operator'` basis; `null` for a person's own. */
  source: MarketingConsentSource | null
  /** When the basis was recorded, when the writer stamped it. */
  basisAtMs: number | null
  /**
   * When the underlying person record was captured, when the silo stores it.
   *
   * `null` is the honest answer for a hand-typed address, which has no record
   * behind it at all, and it is treated as "captured before enforcement" for
   * the reason given on {@link MarketingConsentPolicy.enforceFromMs}.
   */
  capturedAtMs: number | null
}

/**
 * How strictly `unrecorded` is treated. `granted` and `declined` are not
 * affected by this: a stored refusal is honored under every mode, which is
 * the one piece of enforcement that is safe to switch on with no decision
 * from anyone.
 */
export interface MarketingConsentPolicy {
  /**
   * `'forward'` — NOT retroactive. A record captured on or after
   * {@link enforceFromMs} needs a recorded basis; one captured before it
   * stays reachable and is reported as grandfathered. Turning this on drops
   * nobody who is currently in an audience, which is what makes it the mode
   * a deployment with a real back catalog wants.
   *
   * `'strict'` — retroactive. Every recipient needs a recorded basis, and
   * nothing grandfathers. It can shrink an existing audience sharply,
   * possibly to near zero.
   *
   * `'strict'` is the current default; see
   * {@link DEFAULT_MARKETING_CONSENT_POLICY} for the pre-release condition
   * that makes a retroactive default safe, and for when it stops being so.
   */
  mode: 'forward' | 'strict'
  /**
   * The forward cutoff, in epoch millis.
   *
   * A record with no capture timestamp is treated as captured BEFORE this,
   * because the silos that omit one are the older ones — the direction of the
   * unknown is toward grandfathering, so a missing field can only ever leave
   * somebody reachable, never silently withhold their mail.
   */
  enforceFromMs: number
}

/**
 * The default forward cutoff: 2026-09-01T00:00:00Z.
 *
 * A date rather than a per-org stamp, so the rule has an answer on an org that
 * has never opened the setting.
 *
 * It divides the audience only under `'forward'`, where a record predating it
 * grandfathers and every capture from the checkbox-bearing surfaces onward
 * carries a basis or is withheld. Under `'strict'` it decides nothing, since
 * no record grandfathers at any date.
 *
 * An org may move it later (a longer grace period) or earlier (voluntarily
 * enforcing over more of its own back catalog) through
 * {@link resolveMarketingConsentPolicy}.
 */
export const MARKETING_CONSENT_ENFORCED_FROM_MS = Date.UTC(2026, 8, 1)

/**
 * The policy an org gets when it has never configured one.
 *
 * `'strict'` — every recipient needs a recorded basis, and nothing is
 * grandfathered. That is defensible because of WHEN it ships: the product is
 * pre-release with no real customers, so the population a retroactive rule
 * removes is test and seeded demo data. The usual objection to retroactive
 * enforcement — that it silently shrinks a live audience, sometimes to
 * nothing — has nobody here to injure.
 *
 * ⚠️ It stops being defensible the moment real addresses exist. A deployment
 * that has already collected an audience under the old rule sets `'forward'`
 * on its orgs rather than inheriting this, because flipping to strict over a
 * live back catalog withholds mail from people who were legitimately
 * reachable the day before.
 *
 * `enforceFromMs` stays populated and is still read: under `'strict'` it
 * decides nothing, but an org moving back to `'forward'` gets a real cutoff
 * rather than a missing field.
 */
export const DEFAULT_MARKETING_CONSENT_POLICY: MarketingConsentPolicy = {
  mode: 'strict',
  enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
}

/**
 * Reads an org's stored `marketingConsentPolicy` into a usable policy.
 *
 * Every unusable value falls back to the default rather than to "off": there
 * is no off. A malformed setting must not be a way to switch the join back
 * out, because the failure mode of that is mail to people who declined.
 *
 * The fallback is {@link DEFAULT_MARKETING_CONSENT_POLICY} itself rather than
 * a mode repeated here. This function is the ONLY path by which any send
 * reaches a policy, so a literal in it would be the real default and the
 * exported constant would be a decoration: changing the constant would move
 * what `marketing-consent.spec.ts` asserts and nothing that mails anybody.
 * Only the two modes a caller may actually store are honored, so a stored
 * value that means neither lands on the default with everything else.
 */
export function resolveMarketingConsentPolicy(
  stored: unknown,
): MarketingConsentPolicy {
  const value = (stored ?? {}) as Record<string, unknown>
  const mode =
    value['mode'] === 'strict'
      ? 'strict'
      : value['mode'] === 'forward'
        ? 'forward'
        : DEFAULT_MARKETING_CONSENT_POLICY.mode
  const enforceFromMs = Number(value['enforceFromMs'])
  return {
    mode,
    enforceFromMs: Number.isFinite(enforceFromMs)
      ? enforceFromMs
      : MARKETING_CONSENT_ENFORCED_FROM_MS,
  }
}

/**
 * Coerces the several shapes a timestamp arrives in — epoch millis, a
 * Firestore `Timestamp`, a `Date` — to millis, or `null`.
 *
 * `toMillis` is duck-typed rather than imported: this module is in the
 * client-bundled barrel and must not pull in `firebase-admin`, and the two
 * SDKs' `Timestamp` classes are different types with the same method anyway.
 */
function timestampMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis
  if (typeof toMillis === 'function') {
    const millis = Number(toMillis.call(value))
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

/**
 * Reads the consent facts off one person record from any silo.
 *
 * The field names differ by collection and the capture timestamp does too —
 * `contacts`, `leads` and `siteMembers` stamp `createdAt`, a list membership
 * stamps `addedAt` — so both are read from a small set of aliases rather than
 * one name per caller. A caller that has to remember which name its silo uses
 * is a caller that can read the wrong one and silently get `undefined`, which
 * is exactly how `siteMembers` came to be addressed by a blank merge tag.
 *
 * ## TWO fields can say "an operator asserted this", and both are read
 *
 * A backfilled CRM record announces itself with {@link
 * MARKETING_CONSENT_SOURCE_FIELD}; a LIST MEMBERSHIP announces itself with
 * {@link MARKETING_CONSENT_BASIS_FIELD} set to {@link
 * OPERATOR_ATTESTED_CONSENT_BASIS}, because the enrollment path stores what
 * KIND of basis a membership carries and stores the attesting account beside
 * it. Reading only the first would report every attested enrollment — every
 * address a merchant added by hand, and every address an import brings in —
 * as a checkbox the person ticked, which is precisely the conflation the
 * attribution exists to prevent. The send-time consent join reads a
 * membership through this function, so the wrong answer here is the wrong
 * answer in a compliance response.
 *
 * ## The basis comes from `hostId`'s ENTRY, and from nowhere else
 *
 * `entry = map[hostId]` — a lookup with no way to reach another host's grant.
 * The pre-host top-level field is consulted only for the asymmetry the module
 * note states: a `false` there refuses for every host, a `true` there grants
 * to none and reports itself as {@link MarketingConsentOtherGrant} `'unscoped'`
 * instead.
 *
 * @param record any silo's person document data, or `null` for an address
 *               with no record behind it (a hand-typed manual audience).
 * @param hostId the site asking. Required and undefaulted: a caller that has
 *               not said which brand wants to mail this person has not asked
 *               a question this function can answer.
 */
export function readMarketingBasis(
  record: Record<string, unknown> | null | undefined,
  group: ConsentGroup,
): MarketingConsentRecord {
  const { hostId } = group
  if (!record) {
    return {
      hostId,
      groupId: group.groupId,
      otherGrant: 'none',
      capturedByHostIds: [],
      capturedByGroup: false,
      basis: 'unrecorded',
      assertedBy: null,
      source: null,
      basisAtMs: null,
      capturedAtMs: null,
    }
  }
  const byHost = readConsentByHost(record)
  const entry = byHost[hostId] ?? null
  const capturedBy = readCapturedByHosts(record)
  /*
   * THE REFUSAL IS READ ACROSS THE WHOLE GROUP, AND THE GRANT IS NOT.
   *
   * A grant is written forward: at capture, every site the disclosure named
   * got its own entry, so `byHost[hostId]` is the complete answer and a group
   * that GROWS later cannot retroactively widen what somebody agreed to.
   *
   * A refusal has to run the other way. Three sites presenting as one sender
   * are one sender to the person unsubscribing from them, and making them do
   * it twice more is hostile and legally wrong; a site that JOINS the group
   * inherits the refusals already standing against its siblings. Reading the
   * current group is what delivers that, and it can only ever withhold.
   *
   * The pre-host top-level `false` is read the same way and for the same
   * reason: it names no controller, so it is honored against every one.
   */
  const refusedUnscoped = record[MARKETING_CONSENT_FIELD] === false
  const refusedInGroup = group.hostIds.find(
    (member) => byHost[member]?.[MARKETING_CONSENT_FIELD] === false,
  )
  const consent = entry?.[MARKETING_CONSENT_FIELD]
  const basis: MarketingBasis =
    refusedUnscoped || refusedInGroup !== undefined
      ? 'declined'
      : consent === true
        ? 'granted'
        : 'unrecorded'
  // Provenance is read off whichever position produced the basis, so a
  // refusal inherited from a sibling site or from the pre-host field is not
  // decorated with the attribution of some other host's grant.
  const fields = refusedUnscoped
    ? record
    : refusedInGroup !== undefined
      ? (byHost[refusedInGroup] ?? {})
      : (entry ?? {})
  const basisAtMs = timestampMs(fields['marketingConsentAtMs'])
  const source =
    readConsentSource(fields[MARKETING_CONSENT_SOURCE_FIELD]) ??
    readAttestedBasis(fields, basisAtMs)
  return {
    hostId,
    groupId: group.groupId,
    otherGrant: readOtherGrant(record, byHost, group),
    capturedByHostIds: capturedBy,
    capturedByGroup: capturedBy.some((id) => group.hostIds.includes(id)),
    basis,
    // A basis with no provenance is the person's own: the capture surfaces
    // write nothing here, so absence is the norm and an operator assertion
    // is what has to be stated. Attributing an absent basis to nobody keeps
    // `unrecorded` from reading as a person who declined to be attributed.
    assertedBy:
      basis === 'unrecorded' ? null : source !== null ? 'operator' : 'person',
    source,
    basisAtMs,
    capturedAtMs:
      timestampMs(record['createdAt']) ?? timestampMs(record['addedAt']),
  }
}

/**
 * The per-host consent map, as a plain object of entries.
 *
 * Anything that is not an object of objects reads as empty rather than
 * throwing. A malformed map must degrade to "no host has a basis", which
 * withholds; degrading toward a grant would make a corrupt value a way to
 * mail people.
 */
function readConsentByHost(
  record: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const raw = record[MARKETING_CONSENT_BY_HOST_FIELD]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries[key] = value as Record<string, unknown>
    }
  }
  return entries
}

/**
 * Which kind of grant this person holds that `hostId` may not use.
 *
 * Only GRANTS are reported. Another host's refusal is that host's preference
 * and says nothing about this one — treating it as a signal here would spread
 * an opt-out across an agency's unrelated clients, which is the same defect
 * as spreading an opt-in, pointed the other way.
 */
function readOtherGrant(
  record: Record<string, unknown>,
  byHost: Record<string, Record<string, unknown>>,
  group: ConsentGroup,
): MarketingConsentOtherGrant {
  for (const [key, entry] of Object.entries(byHost)) {
    if (group.hostIds.includes(key)) continue
    if (entry[MARKETING_CONSENT_FIELD] === true) return 'other-host'
  }
  return record[MARKETING_CONSENT_FIELD] === true ? 'unscoped' : 'none'
}

/**
 * The host that captured this record.
 *
 * {@link CAPTURED_BY_HOST_FIELD} first, then `hostId` — the older name for
 * the same fact on `contacts`. `leads` and `siteMembers` live under a host
 * and carry neither, which is why the absent case is a real answer rather
 * than an error: see {@link MarketingConsentReason} for what it decides.
 */
function readCapturedByHosts(record: Record<string, unknown>): string[] {
  const found = new Set<string>()
  const array = record[CAPTURED_BY_HOST_FIELD]
  if (Array.isArray(array)) {
    for (const value of array) {
      if (typeof value === 'string' && value) found.add(value)
    }
  }
  // The older scalar name on `contacts`, which holds the FIRST capturing
  // site. A subset of the same fact, so it is unioned rather than preferred.
  const legacy = record['hostId']
  if (typeof legacy === 'string' && legacy) found.add(legacy)
  return [...found]
}

/**
 * Every host that holds a GRANT for this person, sorted.
 *
 * The console readout and the API projection both need it, and the agency
 * handoff is the third caller: "which of these rows are this client's" is
 * this list intersected with one host.
 *
 * A refusal is not reported here. The question is which brands may mail this
 * person, and an unscoped refusal answers it for all of them at once — see
 * {@link readMarketingBasis}, which is where that asymmetry is decided.
 */
export function marketingConsentHostIds(
  record: Record<string, unknown> | null | undefined,
): string[] {
  if (!record || record[MARKETING_CONSENT_FIELD] === false) return []
  return Object.entries(readConsentByHost(record))
    .filter(([, entry]) => entry[MARKETING_CONSENT_FIELD] === true)
    .map(([hostId]) => hostId)
    .sort()
}

/**
 * The document fields that RECORD a basis for one host, as a spreadable
 * object to merge onto a person document.
 *
 * The one writer helper for eleven capture doors. They wrote
 * `{ marketingConsent: true, marketingConsentAtMs: … }` inline, eleven times,
 * and every one of those grants applied to every brand in the org. A helper
 * that takes the host is what makes the omission impossible: there is no
 * spelling of this call that records a grant without saying whose it is.
 *
 * ⛔ It writes a grant and never a refusal. An opt-out is not the inverse of
 * an opt-in — it belongs beside the site's suppression list, has to survive a
 * later capture that would otherwise overwrite it, and is recorded by
 * `declineMarketingConsentFields` instead.
 *
 * Nested rather than dot-pathed so it composes with a `{ merge: true }` set,
 * which deep-merges maps: writing one host's entry leaves every other host's
 * untouched. A dotted `update` would do the same but cannot be spread into
 * the object literals these doors already build, and cannot create the
 * document when it is new.
 *
 * @param atMs when the person gave it. Defaulted by the caller, not here: a
 *             clock read hidden in a helper is one a test cannot pin.
 */
export function marketingConsentFieldsForGroup(
  group: ConsentGroup,
  atMs: number,
  extra?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!group?.hostIds?.length) {
    throw new Error('[marketing-consent] a basis cannot be recorded for no host')
  }
  const entry = {
    [MARKETING_CONSENT_FIELD]: true,
    marketingConsentAtMs: atMs,
    /*
     * The disclosure, stored with the grant.
     *
     * A reader that resolved pooling from the org's CURRENT declaration would
     * let a site added to the group tomorrow inherit every grant made today,
     * on a disclosure those people never saw. Recording what was shown is
     * what makes pooling forward-only, and it is also the only honest answer
     * to "what was this person told" months later.
     */
    ...(group.declared
      ? {
          [CONSENT_GROUP_ID_FIELD]: group.groupId,
          [CONSENT_GROUP_NAME_FIELD]: group.name ?? '',
        }
      : {}),
    ...(extra ?? {}),
  }
  /*
   * ONE ENTRY PER DISCLOSED SITE, rather than one entry the reader has to
   * search for a group it belongs to.
   *
   * `byHost[hostId]` stays a lookup with no way to reach another controller's
   * grant, which is the guarantee the whole model rests on. A single entry
   * carrying a list of covered sites would make every read a search, and a
   * search is something a caller can get wrong in exactly one direction: a
   * dropped predicate still returns a grant, just somebody else's.
   */
  return {
    [MARKETING_CONSENT_BY_HOST_FIELD]: Object.fromEntries(
      group.hostIds.map((hostId) => [hostId, entry]),
    ),
  }
}

/**
 * The group-of-one convenience, for a writer that has a site and no org.
 *
 * Narrow by construction, which is the safe direction: a door that should
 * have pooled and did not withholds mail, where a door that pooled without a
 * disclosure sends it.
 */
export function marketingConsentFieldsForHost(
  hostId: string,
  atMs: number,
  extra?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return marketingConsentFieldsForGroup(soloConsentGroup(hostId), atMs, extra)
}

/**
 * The document fields that record a REFUSAL for one host.
 *
 * Separate from the grant helper because the two are not one function with a
 * boolean. A refusal is written by the unsubscribe path and by the API's
 * explicit `marketingConsent: false`, it carries no provenance a person
 * supplied, and — unlike a grant — the pre-host field is still honored
 * against every host, so the two are not symmetric anywhere in this module.
 */
export function declineMarketingConsentFields(
  hostId: string,
  atMs: number,
): Record<string, unknown> {
  if (!hostId) {
    throw new Error('[marketing-consent] a refusal cannot be recorded for no host')
  }
  /*
   * Written against the ONE site the person acted on, and read across
   * whatever group that site is in at send time — see
   * {@link readMarketingBasis}. Denormalizing a refusal the way a grant is
   * denormalized would freeze it to the group as it stood, so a site joining
   * the group later would mail somebody who had already left the sender.
   */
  return {
    [MARKETING_CONSENT_BY_HOST_FIELD]: {
      [hostId]: {
        [MARKETING_CONSENT_FIELD]: false,
        marketingConsentAtMs: atMs,
      },
    },
  }
}

/**
 * The provenance a list membership's own basis field carries, or `null`.
 *
 * `'contact-opt-in'` returns `null` deliberately and is not merely unhandled:
 * that value means the membership carries the PERSON's opt-in, passed through
 * with their own timestamp, so it is the strongest available statement that
 * nobody asserted anything on their behalf.
 *
 * `by` falls back to the empty string rather than refusing when the account
 * is missing. `readConsentSource` refuses an unattributed operator because
 * its field's only writer always fills one; here the fact being read is the
 * BASIS, which is unambiguous on its own, and losing the whole attestation
 * because the uid did not survive would report the row as a person's own
 * opt-in — the one direction this must never fail in.
 */
function readAttestedBasis(
  record: Record<string, unknown>,
  basisAtMs: number | null,
): MarketingConsentSource | null {
  if (record[MARKETING_CONSENT_BASIS_FIELD] !== OPERATOR_ATTESTED_CONSENT_BASIS)
    return null
  const by = record['marketingConsentByUid']
  return {
    kind: OPERATOR_ATTESTED_CONSENT_KIND,
    by: typeof by === 'string' ? by : '',
    atMs: basisAtMs,
    reason:
      typeof record['marketingConsentReason'] === 'string'
        ? (record['marketingConsentReason'] as string)
        : '',
  }
}

/**
 * Parses the provenance field, or `null` when there is none to parse.
 *
 * A malformed value reads as `null` — the person's own act — rather than as
 * a nameless operator assertion, because the only writer of this field is a
 * script that always fills `kind` and `by`. Inventing an unattributed
 * operator out of a corrupt value would put a claim in the audit trail that
 * nothing in the product ever made.
 */
function readConsentSource(value: unknown): MarketingConsentSource | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const kind = typeof source['kind'] === 'string' ? source['kind'] : ''
  const by = typeof source['by'] === 'string' ? source['by'] : ''
  if (!kind || !by) return null
  return {
    kind,
    by,
    atMs: timestampMs(source['atMs']),
    reason: typeof source['reason'] === 'string' ? source['reason'] : '',
  }
}

/** What a policy decided about one recipient. */
export type MarketingConsentVerdict =
  /** A recorded basis. Mailable. */
  | 'consented'
  /** No recorded basis, captured before the cutoff. Mailable, and reported. */
  | 'grandfathered'
  /** Not mailable: a stored refusal, or no basis under an enforcing policy. */
  | 'withheld'

/**
 * WHY a record landed on its verdict — the states that must not collapse.
 *
 * Three of these are `withheld`, and the whole point is that they are three.
 * A merchant told "412 withheld" cannot act; a merchant told which of these
 * 412 are their own un-opted-in list, which belong to a sister brand, and
 * which said no, can. And every pair of them, merged, is a defect: merge
 * `'other-host'` into `'granted'` and an agency's client mails another
 * client's subscribers; merge it into `'no-basis'` and nobody can see that
 * the leak was ever closed.
 */
export type MarketingConsentReason =
  /** This host holds a recorded basis. */
  | 'granted'
  /** No basis, captured before the cutoff by this host or by nobody. */
  | 'grandfathered'
  /** This host holds a recorded refusal, or an unscoped one does. */
  | 'declined'
  /** A grant exists, and it is not this host's. */
  | 'other-host'
  /** Nobody holds a basis for this person. */
  | 'no-basis'
  /** No basis, and the record's capture date falls under an enforcing rule. */
  | 'not-grandfathered'

/** One record's verdict and the reason behind it. */
export interface MarketingConsentDecision {
  verdict: MarketingConsentVerdict
  reason: MarketingConsentReason
}

/**
 * Applies a policy to one record. Pure, and the only place the rule lives.
 *
 * ## Grandfathering is a claim about a CAPTURE, so it belongs to the capturer
 *
 * Under `'forward'`, a record with no basis stays reachable because it
 * predates enforcement. That argument is made on behalf of the brand that
 * collected the address — it had a relationship with this person before there
 * was a checkbox to tick. A sister brand in the same agency has no such
 * history and inherits none by sharing an address book, so a record captured
 * by another host does not grandfather here. Where no host is attributed the
 * argument has nobody to belong to and nobody to exclude, so it holds: the
 * unknown leans toward reachable, exactly as a missing capture DATE does.
 *
 * ## A grant elsewhere ends grandfathering outright
 *
 * `otherGrant` is evidence that consent WAS collected for this person and
 * that this host is not who it was given to. Grandfathering on top of that
 * would let the agency case back in through the one door the policy leaves
 * open, which is the same leak in a longer sentence.
 */
export function marketingConsentDecision(
  record: MarketingConsentRecord,
  policy: MarketingConsentPolicy,
): MarketingConsentDecision {
  if (record.basis === 'granted') {
    return { verdict: 'consented', reason: 'granted' }
  }
  if (record.basis === 'declined') {
    return { verdict: 'withheld', reason: 'declined' }
  }
  if (record.otherGrant !== 'none') {
    return { verdict: 'withheld', reason: 'other-host' }
  }
  if (policy.mode === 'strict') {
    return { verdict: 'withheld', reason: 'no-basis' }
  }
  /*
   * A capture attributed only to sites outside this group. The
   * grandfathering argument belongs to whoever collected the address; a
   * sister brand inherits none of it by sharing an address book, while a
   * fellow member of a declared group collected it alongside. An EMPTY list
   * has nobody to belong to and nobody to exclude, so it falls through and
   * grandfathers — the same direction a missing capture date leans.
   */
  if (record.capturedByHostIds.length && !record.capturedByGroup) {
    return { verdict: 'withheld', reason: 'other-host' }
  }
  // `null` grandfathers: see MarketingConsentPolicy.enforceFromMs for why the
  // unknown leans toward reachable.
  if (record.capturedAtMs === null) {
    return { verdict: 'grandfathered', reason: 'grandfathered' }
  }
  return record.capturedAtMs >= policy.enforceFromMs
    ? { verdict: 'withheld', reason: 'not-grandfathered' }
    : { verdict: 'grandfathered', reason: 'grandfathered' }
}

/**
 * The verdict alone, for the callers that only decide whether to send.
 *
 * Delegated rather than reimplemented so there is one rule and not two that
 * agree today.
 */
export function marketingConsentVerdict(
  record: MarketingConsentRecord,
  policy: MarketingConsentPolicy,
): MarketingConsentVerdict {
  return marketingConsentDecision(record, policy).verdict
}

/** The split of one audience, kept as counts so a caller can display it. */
export interface MarketingConsentSplit {
  /** The addresses that may actually be mailed, in the order given. */
  mailable: string[]
  /** Of `mailable`, how many carry a recorded basis. */
  consented: number
  /**
   * Of `consented`, how many hold a basis an OPERATOR asserted rather than
   * one the person gave — see {@link MarketingConsentRecord.assertedBy}.
   *
   * A subset of `consented` and not a fourth population, because it is not a
   * different mailability. It is reported separately so a surface showing
   * "N consented" can avoid presenting a backfill as N opt-ins.
   */
  consentedByOperator: number
  /** Of `mailable`, how many are reachable only because of grandfathering. */
  grandfathered: number
  /** Refused by the consent rule, and therefore never metered or mailed. */
  withheld: number
  /**
   * Of `withheld`, how many hold a recorded refusal.
   *
   * The three counts below partition `withheld` — they exist because one
   * total cannot be acted on. A merchant looking at a short audience needs to
   * know whether they are looking at people who said no, people nobody ever
   * asked, or people who opted in to a DIFFERENT brand in the same account
   * and were correctly left alone.
   */
  withheldDeclined: number
  /** Of `withheld`, how many hold a grant that belongs to another brand. */
  withheldOtherHost: number
  /** Of `withheld`, how many hold no basis anywhere. */
  withheldNoBasis: number
}

/**
 * Splits an audience into who may be mailed and who may not, FOR ONE HOST.
 *
 * Returns counts rather than addresses for the reported populations: the
 * console surface that shows this figure is telling a merchant how their
 * audience divides, and handing back the withheld ADDRESSES would turn a
 * consent readout into a way to export the people who declined.
 *
 * ## The host argument, and why a mismatch throws
 *
 * A consent map is built where the person documents are read and consumed
 * somewhere else. Between those two points the host can be lost — a helper
 * that takes one hostId and passes another, a cached map reused for a second
 * site, a merge of two audiences. The result would be host A's grants
 * deciding host B's send, silently and with every count still adding up.
 *
 * So the host is stated at both ends and compared. A mismatch is a wiring
 * defect that no runtime value can produce, and it fails loudly rather than
 * mailing somebody on a basis they gave to a different company. This is the
 * same refusal `newResourceScopeFields` makes over an empty scope, for the
 * same reason: a caller that computed the wrong thing is worth a stack trace.
 *
 * @param emails    normalized, de-duplicated recipient addresses.
 * @param records   consent facts by address, every one read for `hostId`; a
 *                  missing entry reads as a record-less address.
 * @param hostId    the site sending. Every record must have been read for it.
 */
export function splitByMarketingConsent(
  emails: readonly string[],
  records: ReadonlyMap<string, MarketingConsentRecord>,
  policy: MarketingConsentPolicy,
  group: ConsentGroup,
): MarketingConsentSplit {
  const { hostId } = group
  const split: MarketingConsentSplit = {
    mailable: [],
    consented: 0,
    consentedByOperator: 0,
    grandfathered: 0,
    withheld: 0,
    withheldDeclined: 0,
    withheldOtherHost: 0,
    withheldNoBasis: 0,
  }
  for (const email of emails) {
    const record = records.get(email) ?? readMarketingBasis(null, group)
    if (record.hostId !== hostId || record.groupId !== group.groupId) {
      throw new Error(
        '[marketing-consent] a consent record read for ' +
          `${record.hostId}/${record.groupId} cannot decide a send from ` +
          `${hostId}/${group.groupId}`,
      )
    }
    const decision = marketingConsentDecision(record, policy)
    switch (decision.verdict) {
      case 'consented':
        split.mailable.push(email)
        split.consented += 1
        if (record.assertedBy === 'operator') split.consentedByOperator += 1
        break
      case 'grandfathered':
        split.mailable.push(email)
        split.grandfathered += 1
        break
      default:
        split.withheld += 1
        if (decision.reason === 'declined') split.withheldDeclined += 1
        else if (decision.reason === 'other-host') split.withheldOtherHost += 1
        else split.withheldNoBasis += 1
    }
  }
  return split
}
