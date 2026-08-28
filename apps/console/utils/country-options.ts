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
 * The country picker's options, DERIVED from the runtime's own region data.
 *
 * `Intl.supportedValuesOf` does not cover regions, so the list is obtained by
 * asking `Intl.DisplayNames` about every two-letter code and keeping the ones
 * it can name — a code it does not know is echoed back unchanged, which is the
 * test. Roughly 250 rows, computed once at module load.
 *
 * The alternative was a checked-in list of country codes, which is the same
 * mistake as a checked-in list of tax ID types in a slower-moving domain: it
 * is a table nobody maintains, and the version that goes stale silently omits
 * the country a customer is actually in.
 *
 * Stripe remains the validator. Anything this list gets wrong is refused by
 * Stripe with its own message, which the billing address card surfaces.
 */

/**
 * Two-letter codes ICU names that are not countries Stripe bills to.
 *
 * DEGRADE-SAFE by construction: a code missing from this deny-list shows one
 * extra row that Stripe would refuse with a clear message, so letting it go
 * stale costs a confusing option and never a wrong address.
 */
const NON_COUNTRY_REGIONS = new Set([
  'EU', // European Union
  'EZ', // Eurozone
  'UN', // United Nations
  'QO', // Outlying Oceania
  'XA', // pseudo-locale
  'XB', // pseudo-locale
  'ZZ', // Unknown Region
])

export interface CountryOption {
  /** ISO-3166-1 alpha-2, uppercase — the shape Stripe and Stripe Tax expect. */
  code: string
  /** The name a customer reads. */
  label: string
  /** Lowercased haystack: matches on the name and on the code. */
  searchText: string
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The region namer, or `null` on a runtime without full ICU. */
function regionNamer(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
}

function buildCountryOptions(): CountryOption[] {
  const regionNames = regionNamer()
  // An empty list is honest on a runtime that cannot name regions: the card
  // falls back to a plain two-letter field rather than showing a broken
  // picker with nothing in it.
  if (!regionNames) return []
  const options: CountryOption[] = []
  for (const first of ALPHABET) {
    for (const second of ALPHABET) {
      const code = `${first}${second}`
      if (NON_COUNTRY_REGIONS.has(code)) continue
      let label: string
      try {
        label = regionNames.of(code) ?? code
      } catch {
        continue
      }
      // ICU echoes an unknown code back unchanged — that is how a real region
      // is told from one of the 676 combinations that is not.
      if (!label || label === code) continue
      options.push({ code, label, searchText: `${label} ${code}`.toLowerCase() })
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

export const COUNTRY_OPTIONS: CountryOption[] = buildCountryOptions()

/** The option for an ISO code, or null when it names no region we know. */
export function countryOption(code: string | null | undefined): CountryOption | null {
  const wanted = String(code ?? '').trim().toUpperCase()
  if (!wanted) return null
  return COUNTRY_OPTIONS.find((option) => option.code === wanted) ?? null
}
