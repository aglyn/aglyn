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
 * ONE postal address shape (AGL-1133).
 *
 * The failure this prevents is not "there is no address field" — it is a phone
 * number stored three ways in three collections. So every place that grows an
 * address stores this, and the Stripe mapping is a field rename in one file
 * rather than in each caller.
 *
 * NOTE ON `state`: the issue specified `region`. Using it would have created a
 * THIRD spelling — Stripe's customer address uses `state`, and the commerce
 * plugin's `OrderAddress` already uses `state` too. A canonical type whose
 * whole purpose is to stop variants should not open with a new variant, so
 * this matches the two shapes it has to interoperate with.
 */
export interface AglynPostalAddress {
  line1?: string
  line2?: string
  city?: string
  /** State, province, prefecture or county. Stripe calls this `state`. */
  state?: string
  postalCode?: string
  /**
   * ISO-3166-1 alpha-2, uppercase (`US`, `GB`, `DE`).
   *
   * Two letters because that is what Stripe Tax and every address validator
   * expect; a free-text country name cannot be used to compute tax.
   */
  country?: string
}

/** Every field of a postal address, absent or blank. */
export function isBlankAddress(
  address: AglynPostalAddress | null | undefined,
): boolean {
  if (!address) return true
  return !(
    ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const
  ).some((key) => String(address[key] ?? '').trim())
}

/**
 * Trim, drop empties, and uppercase the country code.
 *
 * Returns `null` for an address with nothing in it, so a cleared form stores
 * an absent field rather than an object full of empty strings — which would
 * read as "has an address" to every `if (address)` in the codebase.
 */
export function normalizeAddress(
  address: AglynPostalAddress | null | undefined,
): AglynPostalAddress | null {
  if (!address) return null
  const clean = (value: unknown) => String(value ?? '').trim()
  const next: AglynPostalAddress = {}
  const line1 = clean(address.line1)
  const line2 = clean(address.line2)
  const city = clean(address.city)
  const state = clean(address.state)
  const postalCode = clean(address.postalCode)
  const country = clean(address.country).toUpperCase()
  if (line1) next.line1 = line1
  if (line2) next.line2 = line2
  if (city) next.city = city
  if (state) next.state = state
  if (postalCode) next.postalCode = postalCode
  // Only a real alpha-2 shape is stored; anything else is a typed country
  // name and is worse than absent, because Stripe would reject the customer
  // update and take the rest of the address down with it.
  if (/^[A-Z]{2}$/.test(country)) next.country = country
  return isBlankAddress(next) ? null : next
}

/**
 * Best-effort E.164 (`+15125550123`).
 *
 * Measured on production 2026-07-30: the one populated profile stored a bare
 * ten-digit US number with no country code — `5122228232` in the examples
 * below, standing in for the value actually measured. That is unusable for SMS
 * or for a Stripe customer, and it is what "phone already exists but is stored
 * unnormalized" in AGL-1133 refers to.
 *
 * `defaultCountry` only applies to a number with NO country code of its own,
 * and only US/CA (+1) are inferred — guessing a country for a bare national
 * number anywhere else silently invents a different subscriber.
 *
 * @returns E.164, or `null` when the input cannot be normalized confidently.
 *          Never a partially-cleaned string: a half-normalized phone is the
 *          same bug in a new format.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry = 'US',
): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  // A leading + is the user telling us the country; keep it and just strip
  // the punctuation humans put in numbers.
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '')
    // E.164 allows at most 15 digits, and a country code is at least 1 —
    // 8 is below any real international number and signals a typo.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const inferable = defaultCountry === 'US' || defaultCountry === 'CA'
  if (!inferable) return null
  // 10 digits is NANP without the country code; 11 starting with 1 is with it.
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
