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
 */

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

/** One recipient's consent facts, as read off whichever silo produced them. */
export interface MarketingConsentRecord {
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
 * @param record any silo's person document data, or `null` for an address
 *               with no record behind it (a hand-typed manual audience).
 */
export function readMarketingBasis(
  record: Record<string, unknown> | null | undefined,
): MarketingConsentRecord {
  if (!record) {
    return {
      basis: 'unrecorded',
      assertedBy: null,
      source: null,
      basisAtMs: null,
      capturedAtMs: null,
    }
  }
  const consent = record['marketingConsent']
  const basis: MarketingBasis =
    consent === true ? 'granted' : consent === false ? 'declined' : 'unrecorded'
  const basisAtMs = timestampMs(record['marketingConsentAtMs'])
  const source =
    readConsentSource(record[MARKETING_CONSENT_SOURCE_FIELD]) ??
    readAttestedBasis(record, basisAtMs)
  return {
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

/** Applies a policy to one record. Pure, and the only place the rule lives. */
export function marketingConsentVerdict(
  record: MarketingConsentRecord,
  policy: MarketingConsentPolicy,
): MarketingConsentVerdict {
  if (record.basis === 'granted') return 'consented'
  if (record.basis === 'declined') return 'withheld'
  if (policy.mode === 'strict') return 'withheld'
  // `null` grandfathers: see MarketingConsentPolicy.enforceFromMs for why the
  // unknown leans toward reachable.
  if (record.capturedAtMs === null) return 'grandfathered'
  return record.capturedAtMs >= policy.enforceFromMs
    ? 'withheld'
    : 'grandfathered'
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
}

/**
 * Splits an audience into who may be mailed and who may not.
 *
 * Returns counts rather than addresses for the two reported populations: the
 * console surface that shows this figure is telling a merchant how their
 * audience divides, and handing back the withheld ADDRESSES would turn a
 * consent readout into a way to export the people who declined.
 *
 * @param emails    normalized, de-duplicated recipient addresses.
 * @param records   consent facts by address; a missing entry reads as a
 *                  record-less address, which grandfathers.
 */
export function splitByMarketingConsent(
  emails: readonly string[],
  records: ReadonlyMap<string, MarketingConsentRecord>,
  policy: MarketingConsentPolicy,
): MarketingConsentSplit {
  const split: MarketingConsentSplit = {
    mailable: [],
    consented: 0,
    consentedByOperator: 0,
    grandfathered: 0,
    withheld: 0,
  }
  for (const email of emails) {
    const record = records.get(email) ?? {
      basis: 'unrecorded' as const,
      assertedBy: null,
      source: null,
      basisAtMs: null,
      capturedAtMs: null,
    }
    switch (marketingConsentVerdict(record, policy)) {
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
    }
  }
  return split
}
