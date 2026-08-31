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
 * WHERE THIS DEPLOYMENT FILES, resolved from two layers.
 *
 * Pure. No `process.env`, no Firestore, no clock beyond what a caller passes
 * in — the environment layer arrives as a plain record and the console layer
 * as a plain record, so the precedence rule below can be asserted without a
 * runtime. `utils/server/tax-filing-store.ts` supplies both.
 *
 * ## The precedence rule
 *
 * **The console wins; the environment is the bootstrap.** A setting an
 * operator stored through the staff console is in force, and an environment
 * variable fills in only where nothing is stored.
 *
 * The alternative — environment wins — was considered and is wrong for one
 * decisive reason: every deployment that needs this control already sets the
 * variables. Letting them win would make the console read-only on precisely
 * the installs it was added for, and an operator would change a value, see
 * the card update, and file under the old registration anyway.
 *
 * ## The one guard on top of it: identifiers do not outlive their authority
 *
 * Precedence is per FIELD, which by itself allows a combination that must
 * never exist: a console jurisdiction of `GB` sitting above an environment
 * `AGLYN_TAX_REGISTRATION_ID` issued by the Texas Comptroller, printed
 * together onto one return as though the British authority had issued it.
 *
 * So an environment identifier is in force only while the jurisdiction in
 * force is the jurisdiction those variables were configured for
 * (`AGLYN_TAX_JURISDICTION`, or its `US-TX` default). Move the jurisdiction in
 * the console and the environment's identifiers stop applying — the
 * registration reads "not configured" until the new authority's numbers are
 * entered, which is the true statement.
 *
 * ## Every field says where it came from
 *
 * A resolved field carries its {@link TaxFilingSource}, and an environment
 * value that is set but NOT in force is reported in {@link
 * ResolvedTaxFilingConfig.shadowed} with the reason. Both exist for one
 * failure: an operator edits `.env`, redeploys, sees nothing change, and has
 * no way to discover that a stored value outranked it. A precedence rule
 * nobody can observe is indistinguishable from a bug.
 */

import {
  DEFAULT_TAX_JURISDICTION,
  isTaxJurisdictionKey,
  normalizeTaxJurisdictionKey,
  TAX_FILING_ID_ENV,
  TAX_JURISDICTION_ENV,
  TAX_REGISTRATION_ID_ENV,
  taxFilingJurisdiction,
  type TaxFilingJurisdiction,
} from './tax-jurisdictions'

/**
 * Which layer a value in force came from.
 *
 * `none` covers two states that are the same fact from the operator's side —
 * nobody configured this — and read differently per field: for the
 * jurisdiction and the first taxable period it means the built-in default is
 * in force, and for an identifier it means there is nothing to file under.
 */
export type TaxFilingSource = 'console' | 'environment' | 'none'

/** One layer's raw contribution. Every field independently optional. */
export interface TaxFilingConfigLayer {
  jurisdiction?: string | null
  registrationId?: string | null
  filingId?: string | null
  /** Earliest filable period, `YYYY-QN` or `YYYY-MM`. Console layer only. */
  firstTaxablePeriod?: string | null
}

/** An environment value that is set and is NOT the value in force. */
export interface ShadowedTaxFilingValue {
  /** The environment variable's NAME. Names are not secrets; values are. */
  env: string
  /** Why it is not in force, in words an operator can act on. */
  reason: string
}

export interface ResolvedTaxFilingConfig {
  jurisdiction: TaxFilingJurisdiction
  jurisdictionSource: TaxFilingSource
  registrationId: string | null
  registrationIdSource: TaxFilingSource
  filingId: string | null
  filingIdSource: TaxFilingSource
  firstTaxablePeriod: string
  firstTaxablePeriodSource: TaxFilingSource
  /** Environment values that are set but outranked. Never their contents. */
  shadowed: ShadowedTaxFilingValue[]
  /** Whether a console record exists at all. */
  storedPresent: boolean
}

/**
 * The earliest period the picker offers when nothing is configured.
 *
 * A MONTH rather than a quarter, and the distinction is load-bearing: this
 * software's own first taxable sales date is 2026-09-01, so its quarter floor
 * is 2026 Q3 while its month floor is September. Expressed as `2026-Q3` the
 * menu would offer July and August, two months of a quarter in which nothing
 * was collectible. An unset setting must leave that deployment's menu exactly
 * as it was.
 */
export const DEFAULT_FIRST_TAXABLE_PERIOD = '2026-09'

/** A calendar quarter or a month, the two shapes the return route accepts. */
const TAXABLE_PERIOD = /^\d{4}-(?:Q[1-4]|(?:0[1-9]|1[0-2]))$/

/** Longest audited reason the console may attach to a change. */
export const TAX_FILING_NOTE_MAX = 280

/** Longest identifier accepted. Comfortably past any real VAT number. */
export const TAX_IDENTIFIER_MAX = 64

/** Trimmed, or null when there is nothing but whitespace. */
export function cleanTaxConfigValue(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : null
}

/** Whether `period` is a period the return route could actually range on. */
export function isTaxablePeriodKey(value: unknown): boolean {
  return typeof value === 'string' && TAXABLE_PERIOD.test(value.trim().toUpperCase())
}

/**
 * The two layers, resolved into the one configuration in force.
 *
 * `stored` is the console layer and `env` the environment layer; pass `null`
 * for `stored` when no console record exists, which is what makes the
 * environment the bootstrap rather than a permanent second opinion.
 */
export function resolveTaxFilingConfig(input: {
  stored: TaxFilingConfigLayer | null
  env: TaxFilingConfigLayer
}): ResolvedTaxFilingConfig {
  const stored = input.stored
  const env = input.env
  const shadowed: ShadowedTaxFilingValue[] = []

  const storedJurisdiction = normalizeTaxJurisdictionKey(stored?.jurisdiction)
  const envJurisdiction = normalizeTaxJurisdictionKey(env.jurisdiction)
  const jurisdictionCode =
    storedJurisdiction ?? envJurisdiction ?? DEFAULT_TAX_JURISDICTION
  const jurisdictionSource: TaxFilingSource = storedJurisdiction
    ? 'console'
    : envJurisdiction
      ? 'environment'
      : 'none'
  if (storedJurisdiction && envJurisdiction) {
    shadowed.push({
      env: TAX_JURISDICTION_ENV,
      reason:
        `set in the environment, but the console setting (${storedJurisdiction}) ` +
        'is in force. Clear the console setting to hand it back.',
    })
  }

  // The authority the environment's identifiers were issued by. An unset
  // `AGLYN_TAX_JURISDICTION` means Texas, the same default the report has
  // always used — so a deployment that set only the two numbers still has
  // them apply.
  const envIdentifierJurisdiction = envJurisdiction ?? DEFAULT_TAX_JURISDICTION
  // See the guard in the file header: environment identifiers belong to the
  // authority they were configured for and travel nowhere else.
  const envIdentifiersApply = envIdentifierJurisdiction === jurisdictionCode

  const resolveIdentifier = (
    storedValue: string | null,
    envValue: string | null,
    envName: string,
  ): { value: string | null; source: TaxFilingSource } => {
    if (storedValue) {
      if (envValue) {
        shadowed.push({
          env: envName,
          reason:
            'set in the environment, but the console holds a value for it and ' +
            'that value is in force.',
        })
      }
      return { value: storedValue, source: 'console' }
    }
    if (!envValue) return { value: null, source: 'none' }
    if (!envIdentifiersApply) {
      shadowed.push({
        env: envName,
        reason:
          `issued under ${envIdentifierJurisdiction}, and this deployment now ` +
          `files in ${jurisdictionCode}. One authority's number is never ` +
          'filed under another, so it is not in force.',
      })
      return { value: null, source: 'none' }
    }
    return { value: envValue, source: 'environment' }
  }

  const registration = resolveIdentifier(
    cleanTaxConfigValue(stored?.registrationId),
    cleanTaxConfigValue(env.registrationId),
    TAX_REGISTRATION_ID_ENV,
  )
  const filing = resolveIdentifier(
    cleanTaxConfigValue(stored?.filingId),
    cleanTaxConfigValue(env.filingId),
    TAX_FILING_ID_ENV,
  )

  const storedPeriod = cleanTaxConfigValue(stored?.firstTaxablePeriod)?.toUpperCase()
  const firstTaxablePeriod =
    storedPeriod && isTaxablePeriodKey(storedPeriod)
      ? storedPeriod
      : DEFAULT_FIRST_TAXABLE_PERIOD

  return {
    jurisdiction: taxFilingJurisdiction(jurisdictionCode),
    jurisdictionSource,
    registrationId: registration.value,
    registrationIdSource: registration.source,
    filingId: filing.value,
    filingIdSource: filing.source,
    firstTaxablePeriod,
    firstTaxablePeriodSource:
      storedPeriod && isTaxablePeriodKey(storedPeriod) ? 'console' : 'none',
    shadowed,
    storedPresent: Boolean(stored),
  }
}

/**
 * What the console may say about an identifier without saying the identifier.
 *
 * `configured` and, at most, a last-four. Never the value, never its length —
 * `utils/server-config-report.ts` states the principle for the env report and
 * it is the same principle here: a staff-gated screen is still a place a
 * credential can be photographed, pasted into a ticket, or read over a
 * shoulder, and the number of readers who need the whole thing on THIS screen
 * is zero. The one surface that needs it whole is the return itself, at the
 * moment of filing, and it already has it.
 */
export interface MaskedTaxIdentifier {
  configured: boolean
  source: TaxFilingSource
  /** Last four characters, or null when none may be shown. */
  hint: string | null
}

/**
 * Mask an identifier for the console.
 *
 * `reveal: 'last4'` is for the REGISTRATION number — the number the authority
 * knows the filer by, which is semi-public by design (the Texas Comptroller's
 * own taxpayer search returns it) and where a last-four is the difference
 * between "a number is set" and "the right number is set".
 *
 * `reveal: 'none'` is for the FILING credential. The Texas Webfile number is
 * six digits behind a fixed `RT` prefix and eSystems authenticates a profile
 * with it; a last-four of a six-digit secret narrows it to a hundred
 * candidates, which is not masking. Nothing about it is shown but presence.
 */
export function maskTaxIdentifier(
  value: string | null,
  source: TaxFilingSource,
  reveal: 'last4' | 'none',
): MaskedTaxIdentifier {
  const clean = cleanTaxConfigValue(value)
  if (!clean) return { configured: false, source: 'none', hint: null }
  // A short value is mostly revealed by its own last four, so it gets the
  // same treatment as a credential.
  const hint =
    reveal === 'last4' && clean.length >= 8 ? clean.slice(-4) : null
  return { configured: true, source, hint }
}

/** The whole configuration, safe to send to a browser. */
export interface TaxFilingConfigView {
  jurisdiction: string
  jurisdictionLabel: string
  jurisdictionRecognized: boolean
  jurisdictionSource: TaxFilingSource
  registrationIdLabel: string
  filingIdLabel: string
  filingIdRequired: boolean
  registration: MaskedTaxIdentifier
  filing: MaskedTaxIdentifier
  firstTaxablePeriod: string
  firstTaxablePeriodSource: TaxFilingSource
  shadowed: ShadowedTaxFilingValue[]
  storedPresent: boolean
  /** True when the return can be filed under what is configured. */
  configured: boolean
}

/**
 * The client's view of the resolved configuration.
 *
 * The ONLY function that produces a browser-bound payload from a resolved
 * config, so "no identifier reaches a client" is a property of one function
 * rather than of every caller's discipline. It has no code path that copies a
 * raw identifier into its result — the two go through {@link
 * maskTaxIdentifier} and nothing else is read from them.
 */
export function taxFilingConfigView(
  resolved: ResolvedTaxFilingConfig,
): TaxFilingConfigView {
  const jurisdiction = resolved.jurisdiction
  const registration = maskTaxIdentifier(
    resolved.registrationId,
    resolved.registrationIdSource,
    'last4',
  )
  const filing = maskTaxIdentifier(
    resolved.filingId,
    resolved.filingIdSource,
    'none',
  )
  return {
    jurisdiction: jurisdiction.code,
    jurisdictionLabel: jurisdiction.label,
    jurisdictionRecognized: jurisdiction.recognized,
    jurisdictionSource: resolved.jurisdictionSource,
    registrationIdLabel: jurisdiction.registrationIdLabel,
    filingIdLabel: jurisdiction.filingIdLabel,
    filingIdRequired: jurisdiction.filingIdRequired,
    registration,
    filing,
    firstTaxablePeriod: resolved.firstTaxablePeriod,
    firstTaxablePeriodSource: resolved.firstTaxablePeriodSource,
    shadowed: resolved.shadowed,
    storedPresent: resolved.storedPresent,
    // The same rule the return surfaces use: where the authority
    // authenticates filing with a second identifier it is BOTH or neither.
    configured: Boolean(
      registration.configured &&
        (filing.configured || !jurisdiction.filingIdRequired),
    ),
  }
}

/** Why a proposed change cannot be stored, or null when it can. */
export interface TaxFilingConfigProposal {
  jurisdiction: string
  registrationId: string | null
  filingId: string | null
  firstTaxablePeriod: string
}

/**
 * Validate a proposed change BEFORE it is stored.
 *
 * The jurisdiction key is the one that matters most. A code that cannot be a
 * `summary.byJurisdiction` key makes every figure on the return read `0.00`,
 * and the return page already reports that as a blocking finding — but
 * diagnosing it after a quarter of collection is the wrong end. Refused at the
 * input, it never becomes the configuration.
 *
 * The filing id is required alongside the registration id wherever the
 * authority authenticates filing with one, which today is `US-TX`: half a
 * Texas registration files nothing, so storing half of one is storing a
 * deployment that will discover the problem at the Comptroller.
 */
export interface TaxFilingProposalResult {
  /**
   * Non-null when the change cannot be stored, and the sentence to show for it.
   *
   * A nullable pair rather than a discriminated union because this app compiles
   * with `strictNullChecks: false`, where narrowing on an `ok` literal does not
   * hold and a caller reading `.error` off the success arm is a type error
   * rather than the guarded branch it looks like.
   */
  error: string | null
  /** The change to store. Null whenever `error` is set. */
  value: TaxFilingConfigProposal | null
}

export function validateTaxFilingProposal(input: {
  jurisdiction: unknown
  registrationId: unknown
  filingId: unknown
  firstTaxablePeriod?: unknown
}): TaxFilingProposalResult {
  const jurisdiction = normalizeTaxJurisdictionKey(input.jurisdiction)
  if (!jurisdiction) {
    return {
      value: null,
      error:
        'jurisdiction must be a country code with an optional subdivision — ' +
        'US-TX, US-CA, GB, DE. It is looked up as a key in the return’s own ' +
        'buckets, so a value that cannot be one files a page of zeros.',
    }
  }
  const registrationId = cleanTaxConfigValue(input.registrationId)
  const filingId = cleanTaxConfigValue(input.filingId)
  for (const [name, value] of [
    ['registrationId', registrationId],
    ['filingId', filingId],
  ] as const) {
    if (value && value.length > TAX_IDENTIFIER_MAX) {
      return {
        value: null,
        error: `${name} is longer than ${TAX_IDENTIFIER_MAX} characters`,
      }
    }
  }
  const filingJurisdiction = taxFilingJurisdiction(jurisdiction)
  if (registrationId && filingJurisdiction.filingIdRequired && !filingId) {
    return {
      value: null,
      error:
        `${filingJurisdiction.filingIdLabel} is required alongside the ` +
        `${filingJurisdiction.registrationIdLabel.toLowerCase()} for ` +
        `${jurisdiction} — a return filed with half a registration is not filable.`,
    }
  }
  const rawPeriod = cleanTaxConfigValue(input.firstTaxablePeriod)?.toUpperCase()
  const firstTaxablePeriod = rawPeriod ?? DEFAULT_FIRST_TAXABLE_PERIOD
  if (!isTaxablePeriodKey(firstTaxablePeriod)) {
    return {
      value: null,
      error: 'firstTaxablePeriod must be YYYY-Q[1-4] or YYYY-MM',
    }
  }
  return {
    error: null,
    value: { jurisdiction, registrationId, filingId, firstTaxablePeriod },
  }
}

/** Re-exported so a caller validating an input needs one import. */
export { isTaxJurisdictionKey }
