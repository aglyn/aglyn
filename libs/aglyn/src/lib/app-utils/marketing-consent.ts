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
   * `'forward'` — the default, and NOT retroactive. A record captured on or
   * after {@link enforceFromMs} needs a recorded basis; one captured before
   * it stays reachable and is reported as grandfathered. Nobody currently in
   * an audience is dropped by turning this on.
   *
   * `'strict'` — retroactive. Every recipient needs a recorded basis. This
   * can shrink an existing audience sharply, possibly to near zero, so it is
   * the account owner's decision and never a default.
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
 * A date rather than a per-org stamp so the rule has an answer on an org that
 * has never opened the setting, and a FUTURE-facing one so it cannot reach
 * back over anybody already captured. Every address in the product on the day
 * this ships predates it and is therefore grandfathered; every capture from
 * the checkbox-bearing surfaces onward carries a basis or is withheld.
 *
 * An org may move it later (a longer grace period) or earlier (voluntarily
 * enforcing over its own back catalog) through
 * {@link resolveMarketingConsentPolicy}.
 */
export const MARKETING_CONSENT_ENFORCED_FROM_MS = Date.UTC(2026, 8, 1)

/** The policy an org gets when it has never configured one. */
export const DEFAULT_MARKETING_CONSENT_POLICY: MarketingConsentPolicy = {
  mode: 'forward',
  enforceFromMs: MARKETING_CONSENT_ENFORCED_FROM_MS,
}

/**
 * Reads an org's stored `marketingConsentPolicy` into a usable policy.
 *
 * Every unusable value falls back to the default rather than to "off": there
 * is no off. A malformed setting must not be a way to switch the join back
 * out, because the failure mode of that is mail to people who declined.
 */
export function resolveMarketingConsentPolicy(
  stored: unknown,
): MarketingConsentPolicy {
  const value = (stored ?? {}) as Record<string, unknown>
  const mode = value['mode'] === 'strict' ? 'strict' : 'forward'
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
  const source = readConsentSource(record[MARKETING_CONSENT_SOURCE_FIELD])
  return {
    basis,
    // A basis with no provenance is the person's own: the capture surfaces
    // write nothing here, so absence is the norm and an operator assertion
    // is what has to be stated. Attributing an absent basis to nobody keeps
    // `unrecorded` from reading as a person who declined to be attributed.
    assertedBy:
      basis === 'unrecorded' ? null : source !== null ? 'operator' : 'person',
    source,
    basisAtMs: timestampMs(record['marketingConsentAtMs']),
    capturedAtMs:
      timestampMs(record['createdAt']) ?? timestampMs(record['addedAt']),
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
