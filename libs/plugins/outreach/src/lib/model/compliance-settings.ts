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

/*==========================================
 * THE ORGANIZATION'S COMPLIANCE SETTINGS, AS DATA (AGL-2980).
 *
 * What the Compliance page edits and the settings route stores: the legal
 * name and postal address every email's footer prints, the brand name its
 * solicitation sentence uses, and the countries Outreach may send to at
 * all. Client-safe — the page validates as the person types with the same
 * function the route refuses a save with, so the two cannot disagree.
 *
 * Empty is allowed. An organization can save its countries before it has a
 * postal address; what an empty address stops is ACTIVATION
 * (`validateOutreachSequenceActivation`) and every send
 * (`composeOutreachFooter`), and the page says so beside the field.
 *==========================================*/

import { normalizeOutreachAllowedCountries } from '../engine/sequence-validation'
import {
  OUTREACH_DEFAULT_ALLOWED_COUNTRIES,
  type OutreachComplianceSettings,
  type OutreachComplianceSettingsDocument,
} from './outreach.types'

/** The longest legal name the footer prints. */
export const OUTREACH_LEGAL_NAME_MAX = 120

/** The longest brand name the solicitation sentence uses. */
export const OUTREACH_BRAND_NAME_MAX = 120

/** The longest postal address, all of its lines together. */
export const OUTREACH_POSTAL_ADDRESS_MAX = 300

/** The most lines a postal address is written over. */
export const OUTREACH_POSTAL_ADDRESS_MAX_LINES = 6

/**
 * Every ISO-3166-1 alpha-2 code assigned to a country or territory, sorted.
 *
 * A fixed list rather than whatever `Intl` can name: `Intl.DisplayNames`
 * also names `EU`, `UN`, `ZZ` and retired codes such as `YU`, none of which
 * a recipient's address can be in.
 */
export const OUTREACH_COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI ' +
  'BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN ' +
  'CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK ' +
  'FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
  'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
  'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ' +
  'ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP ' +
  'NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF ' +
  'TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
  'VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

const COUNTRY_CODES = new Set(OUTREACH_COUNTRY_CODES)

/** Whether `code` is an assigned country code, uppercase. */
export function isOutreachCountryCode(code: unknown): boolean {
  return typeof code === 'string' && COUNTRY_CODES.has(code)
}

let regionNames: Intl.DisplayNames | null | undefined

/**
 * A country's English name as a list shows it — "United States", "Canada" —
 * or the code where the runtime cannot name regions.
 */
export function outreachCountryLabel(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

/** One country as the picker offers it. */
export interface OutreachCountryOption {
  code: string
  name: string
}

/** Every country, by name, for the picker. */
export function outreachCountryOptions(): OutreachCountryOption[] {
  return OUTREACH_COUNTRY_CODES.map((code) => ({
    code,
    name: outreachCountryLabel(code),
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** One line: whitespace collapsed, ends trimmed. */
const oneLine = (value: unknown): string => text(value).replace(/\s+/g, ' ').trim()

/** The lines of an address, each settled, the empty ones dropped. */
function addressLines(value: unknown): string[] {
  return text(value)
    .split(/\r\n|\r|\n/)
    .map(oneLine)
    .filter(Boolean)
}

/**
 * A stored compliance document read into its shape, defaults applied: the
 * United States alone when no countries were ever saved. A list that was
 * saved is read as saved, codes that are not countries dropped, so an
 * emptied list reads as nobody rather than as the default.
 */
export function readOutreachComplianceSettings(
  raw: unknown,
): OutreachComplianceSettingsDocument {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const countries = data['allowedCountries']
  const updatedAtMs = Number(data['updatedAtMs'])
  return {
    legalName: oneLine(data['legalName']),
    brandName: oneLine(data['brandName']),
    postalAddress: addressLines(data['postalAddress']).join('\n'),
    allowedCountries: Array.isArray(countries)
      ? normalizeOutreachAllowedCountries(countries).filter(isOutreachCountryCode)
      : [...OUTREACH_DEFAULT_ALLOWED_COUNTRIES],
    updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : 0,
    updatedByUid:
      typeof data['updatedByUid'] === 'string' && data['updatedByUid']
        ? data['updatedByUid']
        : null,
  }
}

/** A field the Compliance page shows an issue beside. */
export type OutreachComplianceField =
  | 'legalName'
  | 'brandName'
  | 'postalAddress'
  | 'allowedCountries'

export interface OutreachComplianceIssue {
  field: OutreachComplianceField
  message: string
}

export interface OutreachComplianceValidation {
  /** The settings as they would be stored: trimmed, one-lined, codes uppercased. */
  settings: OutreachComplianceSettings
  /** Every reason the save is refused; empty when it may be saved. */
  issues: OutreachComplianceIssue[]
}

/**
 * What a save stores, and every reason it is refused — see the module note
 * for why an empty legal name or postal address is not one of them.
 */
export function validateOutreachComplianceSettings(
  input: unknown,
): OutreachComplianceValidation {
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const issues: OutreachComplianceIssue[] = []
  const issue = (field: OutreachComplianceField, message: string) =>
    issues.push({ field, message })

  const legalName = oneLine(data['legalName'])
  if (legalName.length > OUTREACH_LEGAL_NAME_MAX) {
    issue('legalName', `Keep the legal name under ${OUTREACH_LEGAL_NAME_MAX} characters.`)
  }
  const brandName = oneLine(data['brandName'])
  if (brandName.length > OUTREACH_BRAND_NAME_MAX) {
    issue('brandName', `Keep the brand name under ${OUTREACH_BRAND_NAME_MAX} characters.`)
  }
  const lines = addressLines(data['postalAddress'])
  const postalAddress = lines.join('\n')
  if (lines.length > OUTREACH_POSTAL_ADDRESS_MAX_LINES) {
    issue(
      'postalAddress',
      `Write the address on ${OUTREACH_POSTAL_ADDRESS_MAX_LINES} lines or fewer.`,
    )
  }
  if (postalAddress.length > OUTREACH_POSTAL_ADDRESS_MAX) {
    issue(
      'postalAddress',
      `Keep the address under ${OUTREACH_POSTAL_ADDRESS_MAX} characters.`,
    )
  }

  const rawCountries = data['allowedCountries']
  const allowedCountries = normalizeOutreachAllowedCountries(rawCountries)
  const unknown = (Array.isArray(rawCountries) ? rawCountries : [])
    .map((entry) => text(entry).trim().toUpperCase())
    .filter((code) => !isOutreachCountryCode(code))
  if (!Array.isArray(rawCountries) || !allowedCountries.length) {
    issue('allowedCountries', 'Choose at least one country Outreach may send to.')
  } else if (unknown.length) {
    issue(
      'allowedCountries',
      `${unknown.map((code) => `"${code}"`).join(', ')} ${unknown.length === 1 ? "isn't a country code" : "aren't country codes"}.`,
    )
  }

  return {
    settings: {
      legalName,
      brandName,
      postalAddress,
      allowedCountries: allowedCountries.filter(isOutreachCountryCode),
    },
    issues,
  }
}

/** Whether two settings say the same thing — what makes a save a change. */
export function outreachComplianceSettingsEqual(
  a: OutreachComplianceSettings,
  b: OutreachComplianceSettings,
): boolean {
  return (
    a.legalName === b.legalName &&
    a.brandName === b.brandName &&
    a.postalAddress === b.postalAddress &&
    a.allowedCountries.length === b.allowedCountries.length &&
    a.allowedCountries.every((code, index) => code === b.allowedCountries[index])
  )
}

/**
 * The countries a sequence may send to under its organization's ceiling:
 * the sequence's own, in its order, less any the organization does not allow.
 */
export function effectiveOutreachAllowedCountries(
  sequenceCountries: readonly string[] | null | undefined,
  orgCountries: readonly string[] | null | undefined,
): string[] {
  const allowed = new Set(orgCountries ?? [])
  return (sequenceCountries ?? []).filter((code) => allowed.has(code))
}
