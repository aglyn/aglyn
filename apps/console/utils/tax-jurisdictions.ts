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
 * WHICH TAX AUTHORITY THIS DEPLOYMENT FILES WITH.
 *
 * The platform computes tax for whoever runs it. On a `mode: 'stripe'` store
 * the shopper's tax is computed against the PLATFORM's Stripe registrations —
 * Stripe reports it as `automatic_tax.liability: { type: "self" }` — and the
 * money settles into the platform's own balance. That is true of this software
 * wherever it runs, so a self-host operator collecting it is the marketplace
 * facilitator for those sales and owes the same remittance.
 *
 * The reporting half had one jurisdiction wired into it: two `TX_*` env vars,
 * a Texas Webfile exporter, and a page that named no jurisdiction at all. An
 * operator in California, the United Kingdom or Germany collected tax as
 * facilitator and was handed a Texas Comptroller CSV — a filing document for
 * an authority they have never registered with.
 *
 * This module is the registration IDENTITY, keyed by jurisdiction. Nothing
 * here touches what a shopper is charged: rates, registrations and liability
 * are Stripe's, computed at checkout, and this only decides which figures are
 * gathered onto a filing surface and under whose registration numbers.
 *
 * ## The jurisdiction key is the one the summary already speaks
 *
 * `taxReturnSummary` buckets every row as `COUNTRY-STATE` when the address
 * carries a state and `COUNTRY` when it does not — `US-TX`, `US-CA`, `GB`,
 * `DE`. The configured code is looked up in exactly that map, which is why it
 * must be written the same way and why a code that cannot be a key at all is
 * reported rather than quietly matching nothing. A jurisdiction key with no
 * bucket reads as `0.00` across the whole return, and a zero nobody questioned
 * is the failure mode this file is most concerned with.
 */

/**
 * Names the operator sets. Server-only: none of these may be `NEXT_PUBLIC_`.
 *
 * They are the BOOTSTRAP layer, not the control. A deployment that has never
 * opened the staff console files under these; the moment Platform Settings
 * stores a value, that value is in force and these fill in only where nothing
 * is stored. See `utils/tax-filing-config.ts` for the whole rule.
 */
export const TAX_JURISDICTION_ENV = 'AGLYN_TAX_JURISDICTION'
export const TAX_REGISTRATION_ID_ENV = 'AGLYN_TAX_REGISTRATION_ID'
export const TAX_FILING_ID_ENV = 'AGLYN_TAX_FILING_ID'

/**
 * The jurisdiction assumed when none is configured.
 *
 * Texas, because this software's own deployment files there and has done since
 * its first taxable sales date. An unset `AGLYN_TAX_JURISDICTION` must leave
 * that deployment behaving exactly as it did.
 */
export const DEFAULT_TAX_JURISDICTION = 'US-TX'

/** The jurisdiction key the Texas return is filed from. */
export const TX_JURISDICTION = 'US-TX'

/**
 * A key `byJurisdiction` could actually hold: an ISO 3166-1 alpha-2 country,
 * optionally with a subdivision.
 */
const JURISDICTION_KEY = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/

/**
 * Whether `code` could be a `summary.byJurisdiction` key at all.
 *
 * Exported so the console can refuse a bad key AT THE INPUT. The return page
 * still diagnoses one after the fact — a value can reach the deployment
 * through env, where nothing validates it — but a code typed into the control
 * never has to be discovered a quarter later as a page of zeros.
 */
export function isTaxJurisdictionKey(code: unknown): boolean {
  return typeof code === 'string' && JURISDICTION_KEY.test(code.trim().toUpperCase())
}

/**
 * `code` as a jurisdiction key, or null when it cannot be one.
 *
 * Trims and upper-cases first, because `us-tx` and `US-TX` are the same answer
 * and only one of them is a key.
 */
export function normalizeTaxJurisdictionKey(code: unknown): string | null {
  const raw = typeof code === 'string' ? code.trim().toUpperCase() : ''
  return raw && JURISDICTION_KEY.test(raw) ? raw : null
}

/** Which filing output a jurisdiction gets. */
export type TaxFilingForm = 'tx-webfile' | 'breakdown'

export interface TaxFilingJurisdiction {
  /** The key looked up in `summary.byJurisdiction`, e.g. `US-TX`. */
  code: string
  /** What a person calls it. The code itself where no name is known. */
  label: string
  /**
   * False when the configured code cannot be a jurisdiction key at all, so
   * every figure on the return will read zero. Surfaced, never corrected: a
   * guessed jurisdiction on a filing document is worse than a stated fault.
   */
  recognized: boolean
  /** Which exporter builds the filing output. */
  form: TaxFilingForm
  /** The figures card's own heading. */
  figuresHeader: string
  /** How the figures are referred to from a finding that excludes them. */
  figuresName: string
  /** What the authority calls the number it knows the filer by. */
  registrationIdLabel: string
  /** What it calls the filing-portal credential, where one exists. */
  filingIdLabel: string
  /**
   * True when a return cannot be filed without the filing credential.
   *
   * Texas needs both: eSystems attaches a taxpayer account to a profile with
   * the taxpayer number and the Webfile number together, so half a
   * registration files nothing. Most authorities issue no second identifier,
   * and demanding one there would leave a correctly configured deployment
   * reading "not configured" forever.
   */
  filingIdRequired: boolean
  /**
   * Env names that still configure this jurisdiction, deprecated.
   *
   * They stay because a live registration is not worth a rename: unsetting one
   * days before a filing obligation is a worse failure than the TX-only naming
   * it fixes.
   */
  legacyEnv: { registrationId: string; filingId: string } | null
  /** Leading part of the exported filename. */
  fileStem: string
}

const TEXAS: TaxFilingJurisdiction = {
  code: TX_JURISDICTION,
  label: 'Texas',
  recognized: true,
  form: 'tx-webfile',
  figuresHeader: 'Form 01-114 figures — Texas only',
  figuresName: 'Items 1–3',
  registrationIdLabel: 'Taxpayer number',
  filingIdLabel: 'Webfile number',
  filingIdRequired: true,
  legacyEnv: {
    registrationId: 'TX_TAXPAYER_NUMBER',
    filingId: 'TX_WEBFILE_NUMBER',
  },
  fileStem: 'aglyn-tx-sales-tax',
}

/**
 * Every other jurisdiction: a breakdown, named for itself.
 *
 * The label is the code rather than a country name. A lookup table of names
 * would be one more thing to be wrong about on a filing document, and the
 * operator typed this code themselves — echoing it back is the one label that
 * cannot misidentify the authority they file with.
 */
function breakdownJurisdiction(code: string): TaxFilingJurisdiction {
  return {
    code,
    label: code,
    recognized: JURISDICTION_KEY.test(code),
    form: 'breakdown',
    figuresHeader: `Return breakdown — ${code} only`,
    figuresName: 'the breakdown',
    registrationIdLabel: 'Registration number',
    filingIdLabel: 'Filing ID',
    filingIdRequired: false,
    legacyEnv: null,
    fileStem: `aglyn-${code.toLowerCase()}-sales-tax-breakdown`,
  }
}

/**
 * The configured jurisdiction, from whatever the operator wrote.
 *
 * Trimmed and upper-cased because `us-tx` and `US-TX` are the same answer and
 * only one of them is a key. Anything unset resolves to the default, so a
 * deployment that never heard of this setting keeps filing where it always
 * did.
 */
export function taxFilingJurisdiction(code: unknown): TaxFilingJurisdiction {
  const raw = typeof code === 'string' ? code.trim().toUpperCase() : ''
  const resolved = raw || DEFAULT_TAX_JURISDICTION
  return resolved === TX_JURISDICTION ? TEXAS : breakdownJurisdiction(resolved)
}

/**
 * What the working papers print where a registration number goes when the
 * deployment has not configured one.
 *
 * NOT an empty string, and NOT a placeholder that could be mistaken for a
 * number. This CSV is evidence someone files a return from; a blank cell reads
 * as "nobody filled it in yet" and a fake one reads as fact. Either can end up
 * transcribed onto a return signed under penalty of perjury, so the file says
 * what is actually true and names the fix.
 */
export const TAX_REGISTRATION_UNSET =
  'NOT CONFIGURED — set it in Platform settings or at bootstrap with ' +
  `${TAX_REGISTRATION_ID_ENV} / ${TAX_FILING_ID_ENV}`

/**
 * What the papers print for a filing credential the jurisdiction does not
 * require. "Not configured" would read as a fault on a deployment that has
 * nothing to configure.
 */
export function taxFilingIdUnsetNote(
  jurisdiction: TaxFilingJurisdiction,
): string {
  return jurisdiction.filingIdRequired
    ? TAX_REGISTRATION_UNSET
    : `NOT SET — ${TAX_FILING_ID_ENV} is optional for ${jurisdiction.code}`
}

/**
 * The unconfigured state, in words, naming where to set it.
 *
 * A surface that only says "not configured" sends the reader to a search;
 * naming the control makes the state actionable from the screen it appears on,
 * which is where someone notices it — minutes before filing.
 *
 * The console comes first because it is the control: it needs no deploy and it
 * is reachable from the screen this sentence is printed on. The variables are
 * named after it because they are still read as the bootstrap, and because a
 * deployment configured under them must not read this as "your registration
 * is gone".
 */
export function taxRegistrationSetupHint(
  jurisdiction: TaxFilingJurisdiction,
): string {
  const required = jurisdiction.filingIdRequired
    ? `${TAX_REGISTRATION_ID_ENV} and ${TAX_FILING_ID_ENV}`
    : TAX_REGISTRATION_ID_ENV
  const optional = jurisdiction.filingIdRequired
    ? ''
    : ` Add ${TAX_FILING_ID_ENV} if the filing portal issues one.`
  const legacy = jurisdiction.legacyEnv
    ? ` The deprecated ${jurisdiction.legacyEnv.registrationId} / ${jurisdiction.legacyEnv.filingId} are still read.`
    : ''
  return (
    `Registration not configured for ${jurisdiction.code} — set it in Staff → ` +
    `Platform settings, or at bootstrap with ${required}.${optional}${legacy}`
  )
}
