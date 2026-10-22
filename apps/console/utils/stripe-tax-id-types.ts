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

import {
  STRIPE_TAX_ID_TYPES,
  type StripeTaxIdType,
} from './stripe-tax-id-types.generated'

/**
 * Human labels for Stripe's tax ID types, DERIVED rather than listed.
 *
 * The codes themselves come from Stripe (see the generated module). The
 * labels are computed from them, which matters for the same reason the codes
 * are generated: a hand-written label table has to be extended by hand every
 * time Stripe adds a jurisdiction, and the version that is not extended shows
 * the customer a raw `zm_tin` in a dropdown of prose — or, worse, silently
 * omits the row.
 *
 * The derivation is `<country> <abbreviation>`: the prefix of every code is an
 * ISO-3166 alpha-2 region, which `Intl.DisplayNames` names without any table
 * of ours, and the remainder is the local identifier's abbreviation. So
 * `us_ein` reads "United States EIN" and a jurisdiction Stripe adds tomorrow
 * reads correctly the moment the generated list picks it up.
 */

/**
 * The two places the mechanical derivation reads badly, and one prefix that is
 * not a country at all.
 *
 * Every entry here is OPTIONAL BY CONSTRUCTION — a missing one degrades to the
 * mechanical label, never to a broken or absent row. That is the property that
 * keeps this map from becoming the hand-written list this module exists to
 * avoid: it may go stale without anything breaking.
 */
const REGION_OVERRIDES: Record<string, string> = {
  // Not a country. Stripe's `eu_vat` is the cross-border VAT number and
  // `eu_oss_vat` the One Stop Shop registration.
  eu: 'European Union',
}

const ABBREVIATION_OVERRIDES: Record<string, string> = {
  gst_hst: 'GST/HST',
  oss_vat: 'One Stop Shop VAT',
  pst_bc: 'PST (British Columbia)',
  pst_mb: 'PST (Manitoba)',
  pst_sk: 'PST (Saskatchewan)',
}

/**
 * `Intl.DisplayNames` needs a full-ICU runtime. Node ships one and every
 * browser we support has one, but a stripped build would throw on
 * construction — and a dropdown that throws is worse than one reading `US`.
 */
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()

function regionLabel(prefix: string): string {
  const override = REGION_OVERRIDES[prefix]
  if (override) return override
  const code = prefix.toUpperCase()
  try {
    // Returns the input unchanged for a region it does not know, which is
    // exactly the fallback wanted: `ZZ` beats an empty string.
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

function abbreviationLabel(rest: string): string {
  const override = ABBREVIATION_OVERRIDES[rest]
  if (override) return override
  return rest
    .split('_')
    .map((part) => part.toUpperCase())
    .join(' ')
}

export interface TaxIdTypeOption {
  /** The value Stripe expects, e.g. `us_ein`. */
  code: StripeTaxIdType
  /** What the customer reads, e.g. `United States EIN`. */
  label: string
  /** Lowercased haystack for the searchable dropdown. */
  searchText: string
}

/** The label for one Stripe tax ID type, e.g. `us_ein` → `United States EIN`. */
export function taxIdTypeLabel(code: string): string {
  const separator = code.indexOf('_')
  // A code with no separator cannot be split into region and abbreviation.
  // Show it verbatim rather than guessing — an unrecognized shape is a signal
  // that Stripe changed something, and inventing prose over it hides that.
  if (separator < 1) return code
  const region = regionLabel(code.slice(0, separator))
  const abbreviation = abbreviationLabel(code.slice(separator + 1))
  return `${region} ${abbreviation}`
}

/**
 * Every type Stripe accepts, labeled and sorted for the picker.
 *
 * Sorted by LABEL rather than by code so the list reads alphabetically by
 * country the way a customer scans it — `ca_qst` sits under Canada, not
 * between `ca_pst_sk` and `cd_nif`.
 *
 * `searchText` carries the raw code as well as the prose, so a customer who
 * knows they need `us_ein` can type that, and one who does not can type
 * "United States" or "EIN".
 */
export const TAX_ID_TYPE_OPTIONS: TaxIdTypeOption[] = STRIPE_TAX_ID_TYPES.map(
  (code) => {
    const label = taxIdTypeLabel(code)
    return { code, label, searchText: `${label} ${code}`.toLowerCase() }
  },
).sort((a, b) => a.label.localeCompare(b.label))

/** True when Stripe would recognize this string as a tax ID type at all. */
export function isStripeTaxIdType(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (STRIPE_TAX_ID_TYPES as readonly string[]).includes(value)
  )
}
