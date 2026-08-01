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
