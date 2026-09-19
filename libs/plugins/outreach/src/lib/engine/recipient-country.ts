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
 * WHERE A RECIPIENT IS (AGL-2979).
 *
 * A cold email's legality turns on the recipient's country: the United
 * States allows one with an opt-out, while Canada, the United Kingdom and
 * most of the EU want a consent basis a cold email does not have. The CRM
 * rarely knows the country for certain, so the gate reads what it has in
 * order of how much it is worth:
 *
 * 1. the country on the contact's own address, as the sending site's facet
 *    records it;
 * 2. the country on the company the contact is filed under;
 * 3. the country an address's domain names — `.ca`, `.co.uk`, `.de` — which
 *    is evidence against sending rather than for it: a `.de` address is
 *    almost always in Germany, while a `.com` address says nothing at all.
 *
 * Only country-code domains that are used for their country are read.
 * `.io`, `.co`, `.ai`, `.me` and the rest that are sold as generic names are
 * not, because reading `.co` as Colombia would refuse half of the startups a
 * rep writes to for the wrong reason.
 *==========================================*/

import {
  type AglynPostalAddress,
  normalizeAddress,
} from '@aglyn/aglyn/foundation/definitions/contact.types'

/** How the country was learned — which of the three sources answered. */
export type OutreachCountrySource = 'contact' | 'company' | 'domain'

export interface OutreachRecipientCountry {
  /** ISO-3166-1 alpha-2, uppercase, or `null` when nothing names one. */
  country: string | null
  source: OutreachCountrySource | null
}

/**
 * Country-code top-level domains read as their country: the ones registries
 * reserve for, or that are overwhelmingly used by, people and companies in
 * that country. `.uk` is Great Britain's `GB`.
 */
const COUNTRY_CODE_DOMAINS: Readonly<Record<string, string>> = {
  us: 'US',
  ca: 'CA',
  mx: 'MX',
  br: 'BR',
  ar: 'AR',
  cl: 'CL',
  uk: 'GB',
  ie: 'IE',
  de: 'DE',
  at: 'AT',
  ch: 'CH',
  fr: 'FR',
  be: 'BE',
  nl: 'NL',
  lu: 'LU',
  es: 'ES',
  pt: 'PT',
  it: 'IT',
  gr: 'GR',
  se: 'SE',
  no: 'NO',
  dk: 'DK',
  fi: 'FI',
  pl: 'PL',
  cz: 'CZ',
  sk: 'SK',
  hu: 'HU',
  ro: 'RO',
  bg: 'BG',
  hr: 'HR',
  si: 'SI',
  ee: 'EE',
  lt: 'LT',
  lv: 'LV',
  mt: 'MT',
  cy: 'CY',
  ru: 'RU',
  ua: 'UA',
  tr: 'TR',
  il: 'IL',
  ae: 'AE',
  za: 'ZA',
  in: 'IN',
  cn: 'CN',
  jp: 'JP',
  kr: 'KR',
  sg: 'SG',
  hk: 'HK',
  au: 'AU',
  nz: 'NZ',
}

/** The country an address's domain names, or `null` for a generic one. */
export function countryFromEmailDomain(email: unknown): string | null {
  const value = String(email ?? '').trim().toLowerCase()
  const domain = value.slice(value.lastIndexOf('@') + 1).replace(/\.+$/, '')
  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  if (!domain.includes('.') || !tld) return null
  return COUNTRY_CODE_DOMAINS[tld] ?? null
}

function addressCountry(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null
  return normalizeAddress(address as AglynPostalAddress)?.country ?? null
}

/**
 * The recipient's country from the best source that names one — see the
 * module note for the order. `contactAddress` is the address on the sending
 * group's facet of the contact; `companyAddress` is the one on the company
 * the contact is filed under.
 */
export function resolveOutreachRecipientCountry(input: {
  email: string
  contactAddress?: unknown
  companyAddress?: unknown
}): OutreachRecipientCountry {
  const fromContact = addressCountry(input.contactAddress)
  if (fromContact) return { country: fromContact, source: 'contact' }
  const fromCompany = addressCountry(input.companyAddress)
  if (fromCompany) return { country: fromCompany, source: 'company' }
  const fromDomain = countryFromEmailDomain(input.email)
  if (fromDomain) return { country: fromDomain, source: 'domain' }
  return { country: null, source: null }
}

/** Countries whose English name is read with "the": "the United States". */
const DEFINITE_ARTICLE = new Set(['US', 'GB', 'NL', 'AE', 'PH', 'DO', 'BS', 'GM'])

let regionNames: Intl.DisplayNames | null | undefined

/**
 * A country's English name as a sentence says it — "the United States",
 * "Canada" — or the code itself where the runtime has no region names.
 */
export function outreachCountryName(code: string): string {
  const upper = String(code ?? '').toUpperCase()
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  let name: string
  try {
    name = regionNames?.of(upper) ?? upper
  } catch {
    // A code `Intl` rejects outright is printed as it came.
    name = upper
  }
  return DEFINITE_ARTICLE.has(upper) && name !== upper ? `the ${name}` : name
}
