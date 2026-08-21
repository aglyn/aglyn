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
 * The profile fields an identity provider sent, from wherever it put them
 * (AGL-1131).
 *
 * AGL-1131 assumed mapping attributes in Google Workspace would be enough,
 * because "GCIP surfaces mapped SAML attributes on the token" and the JIT
 * path already reads `decoded['name']`. Measured after the mapping was
 * added: the tenant auth record still had `displayName: null`, on both the
 * account and its `saml.aglyn-workspace` provider entry, on a sign-in that
 * definitely happened.
 *
 * The reason is that a SAML assertion's attributes arrive under
 * `firebase.sign_in_attributes`, NOT as a top-level `name` claim. Nothing in
 * the codebase read that, so mapping attributes correctly still produced
 * nothing. OIDC providers do populate `name`, which is why the existing code
 * looked right.
 *
 * Deliberately generous about attribute naming, because the name is chosen
 * by the CUSTOMER's IdP admin, not by us. Workspace suggests `firstName`,
 * ADFS emits the full schema URIs, Okta commonly uses `given_name`. Guessing
 * wrong costs a blank name and a support ticket, so this checks all of them
 * rather than picking a house style nobody else follows.
 */

/** Attribute keys that hold a complete display name, best first. */
const FULL_NAME_KEYS = [
  'name',
  'displayName',
  'display_name',
  'cn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
]

const FIRST_NAME_KEYS = [
  'firstName',
  'first_name',
  'given_name',
  'givenName',
  'givenname',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
]

const LAST_NAME_KEYS = [
  'lastName',
  'last_name',
  'family_name',
  'familyName',
  'surname',
  'sn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
]

/**
 * A SAML attribute value may be a string or a single-element array — the
 * assertion permits repeats, and GCIP passes the shape through.
 */
function readAttribute(
  bag: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string {
  if (!bag) return ''
  for (const key of keys) {
    const raw = bag[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) return text
  }
  return ''
}

export interface IdpNameClaims {
  name?: unknown
  firebase?: { sign_in_attributes?: Record<string, unknown> } | unknown
  [claim: string]: unknown
}

/**
 * Where GCIP puts a SAML assertion's attributes. Guarded rather than cast:
 * this runs on EVERY interactive sign-in, including email/password accounts
 * that have no `firebase` claim at all.
 */
function signInAttributes(
  decoded: IdpNameClaims,
): Record<string, unknown> | undefined {
  const firebase = decoded.firebase
  if (!firebase || typeof firebase !== 'object') return undefined
  const attributes = (firebase as { sign_in_attributes?: unknown })
    .sign_in_attributes
  return attributes && typeof attributes === 'object'
    ? (attributes as Record<string, unknown>)
    : undefined
}

/**
 * Resolve a display name from a decoded ID token, or `''` when the provider
 * genuinely sent nothing.
 *
 * Empty rather than a placeholder: callers seed only ABSENT fields, and a
 * fabricated name would be indistinguishable from one the user chose and
 * would never be corrected.
 */
export function resolveIdpDisplayName(
  decoded: IdpNameClaims | null | undefined,
): string {
  if (!decoded) return ''
  // A top-level `name` wins — OIDC providers populate it, and it is the
  // provider's own idea of the whole name rather than our reassembly.
  const topLevel = typeof decoded.name === 'string' ? decoded.name.trim() : ''
  if (topLevel) return topLevel

  const attributes = signInAttributes(decoded)
  const full = readAttribute(attributes, FULL_NAME_KEYS)
  if (full) return full

  const first = readAttribute(attributes, FIRST_NAME_KEYS)
  const last = readAttribute(attributes, LAST_NAME_KEYS)
  // Either half alone is still better than nothing — a first name renders a
  // usable roster row, and demanding both would discard it.
  return [first, last].filter(Boolean).join(' ')
}

const PHOTO_KEYS = [
  'picture',
  'photoUrl',
  'photo_url',
  'photoURL',
  'thumbnailPhotoUrl',
]

const PHONE_KEYS = [
  'phoneNumber',
  'phone_number',
  'phone',
  'telephoneNumber',
  'mobile',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/mobilephone',
]

/**
 * Resolve an avatar URL from a decoded ID token, or `''`.
 *
 * Only `https:` survives. The value is written to the roster and rendered as
 * an `<img src>` for every member of the org, so an assertion carrying a
 * `javascript:` or `data:` URL would turn a mapped IdP attribute into stored
 * script that we hand to teammates. The IdP is trusted to say who someone is,
 * which is not the same as being trusted to supply markup.
 */
export function resolveIdpPhotoUrl(
  decoded: IdpNameClaims | null | undefined,
): string {
  if (!decoded) return ''
  const attributes = signInAttributes(decoded)
  const candidate =
    (typeof decoded['picture'] === 'string' ? decoded['picture'].trim() : '') ||
    readAttribute(attributes, PHOTO_KEYS)
  if (!candidate) return ''
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : ''
  } catch {
    // Not a URL at all — a relative path or free text.
    return ''
  }
}

/**
 * Resolve a phone number from a decoded ID token, or `''`.
 *
 * Returned verbatim rather than normalised to E.164: this is the number the
 * directory holds, and guessing a country code for a national-format string
 * invents digits. `normalizePhone` is applied where a user confirms it, not
 * here.
 */
export function resolveIdpPhone(
  decoded: IdpNameClaims | null | undefined,
): string {
  if (!decoded) return ''
  const topLevel =
    typeof decoded['phone_number'] === 'string'
      ? (decoded['phone_number'] as string).trim()
      : ''
  return topLevel || readAttribute(signInAttributes(decoded), PHONE_KEYS)
}

/**
 * Address attribute names, same generosity as the name keys and for the same
 * reason: the customer's IdP admin chooses these, not us.
 *
 * Google Workspace's SAML attribute mapping offers `Street address`,
 * `Locality`, `Region` and `Postal code` from the Directory and lets the admin
 * name each one; Okta and ADFS emit `streetAddress`/`l`/`st`/`postalCode` and
 * the full `schemas.xmlsoap.org` URIs respectively. LDAP's own short forms
 * (`l` for locality, `st` for state, `c` for country) are included because
 * both of those are ultimately reading a directory that spells them that way.
 */
const ADDRESS_LINE1_KEYS = [
  'streetAddress',
  'street_address',
  'addressLine1',
  'address_line1',
  'line1',
  'street',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/streetaddress',
]

const ADDRESS_LINE2_KEYS = [
  'addressLine2',
  'address_line2',
  'line2',
  'street_address_2',
  'streetAddress2',
]

const ADDRESS_CITY_KEYS = [
  'locality',
  'city',
  'l',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/locality',
]

const ADDRESS_STATE_KEYS = [
  'region',
  'state',
  'province',
  'st',
  'stateOrProvince',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/stateorprovince',
]

const ADDRESS_POSTAL_KEYS = [
  'postalCode',
  'postal_code',
  'postalcode',
  'zip',
  'zipCode',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/postalcode',
]

const ADDRESS_COUNTRY_KEYS = [
  'country',
  'countryCode',
  'country_code',
  'c',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/country',
]

/**
 * The postal address an identity provider sent, as loose parts (AGL-1963).
 *
 * Deliberately NOT an `AglynPostalAddress`, and this module deliberately does
 * not import one. `normalizeAddress` is what decides whether these parts add
 * up to an address at all — it drops blanks, rejects a country that is not
 * ISO-3166 alpha-2, and returns `null` when nothing survives. Returning a
 * half-populated object from here would hand the caller something that reads
 * as truthy to every `if (address)` while holding a city and no street, which
 * is exactly the shape AGL-1963 says must not exist.
 */
export interface IdpAddressParts {
  line1: string
  line2: string
  city: string
  state: string
  postalCode: string
  country: string
}

/**
 * OIDC's `address` claim is a JSON OBJECT, not a string (OpenID Connect Core
 * §5.1.1), with its own field names. SAML has no equivalent — its attributes
 * arrive flat in `sign_in_attributes` — so this is the OIDC-only half, read
 * for the same reason `resolveIdpDisplayName` prefers a top-level `name`.
 */
function oidcAddressClaim(
  decoded: IdpNameClaims,
): Record<string, unknown> | undefined {
  const address = decoded['address']
  return address && typeof address === 'object' && !Array.isArray(address)
    ? (address as Record<string, unknown>)
    : undefined
}

/**
 * Resolve a postal address from a decoded ID token.
 *
 * Every field independently optional: a directory that holds a city and no
 * street is a normal directory, and demanding a complete address would
 * discard the parts it does have. `normalizeAddress` downstream is what turns
 * "some parts" into either a stored address or `null`.
 *
 * `state`, never `region`, in the RESULT — that is the canonical spelling in
 * `AglynPostalAddress`, matching Stripe's customer address. `region` appears
 * only as an INPUT key, because that is what Google Workspace calls it.
 */
export function resolveIdpAddress(
  decoded: IdpNameClaims | null | undefined,
): IdpAddressParts {
  const empty: IdpAddressParts = {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }
  if (!decoded) return empty
  const attributes = signInAttributes(decoded)
  const oidc = oidcAddressClaim(decoded)
  // SAML attributes win a tie. An org that has mapped its directory into the
  // assertion has said what it wants us to use, and the OIDC claim is the
  // fallback for providers that send the standard object instead.
  const read = (keys: readonly string[], oidcKeys: readonly string[]) =>
    readAttribute(attributes, keys) || readAttribute(oidc, oidcKeys)
  return {
    line1: read(ADDRESS_LINE1_KEYS, ['street_address']),
    line2: read(ADDRESS_LINE2_KEYS, []),
    city: read(ADDRESS_CITY_KEYS, ['locality']),
    state: read(ADDRESS_STATE_KEYS, ['region']),
    postalCode: read(ADDRESS_POSTAL_KEYS, ['postal_code']),
    country: read(ADDRESS_COUNTRY_KEYS, ['country']),
  }
}
