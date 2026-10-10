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
 * ONE ANSWER TO "WHAT IS THIS ACCOUNT CALLED, AND WHAT DOES IT LOOK LIKE"
 * (AGL-3721).
 *
 * The defect this closes: an SSO account's Firebase Auth record carries no
 * `displayName` and no `photoURL` — GCIP leaves a SAML assertion's mapped
 * attributes under `firebase.sign_in_attributes` on the token, and the
 * provider entry is as blank as the record. The account menu never noticed,
 * because it reads the person's own profile document (`users/{uid}`), which
 * the sign-in seed fills from the IdP. The staff Users list and the staff
 * user page read the Auth record alone, so the same person showed a photo
 * and a name in the app bar and a grey initial and "—" on every staff
 * surface. Several surfaces, several precedences, one person.
 *
 * Pure, no Firebase, no React — every surface that shows ANOTHER account's
 * identity (staff list, staff user page, org rosters, the forum) hands this
 * whatever sources it can legitimately read, and gets the same answer.
 *
 * ## The order
 *
 *  1. The Auth record — what the account itself, or staff, last set.
 *  2. The profile document `users/{uid}` — what Manage Account edits and what
 *     the sign-in seed fills from the IdP (`firstName`/`lastName`, and
 *     `photoUrl` with that document's lowercase spelling).
 *  3. The Auth record's `providerData` entries — Google keeps its avatar
 *     there when the top-level field was never mirrored.
 *  4. Whatever the IdP sent at sign-in (SAML attributes / OIDC claims), as
 *     captured on the org roster row or resolved off a decoded token.
 *
 * A blank value never wins over a populated one further down: each field is
 * resolved independently, so an account with an Auth name and only a profile
 * photo gets both.
 */

export type AccountIdentitySource = 'auth' | 'profile' | 'provider' | 'idp'

export interface AccountIdentityAuthSource {
  displayName?: string | null
  photoURL?: string | null
  providerData?: ReadonlyArray<{
    displayName?: string | null
    photoURL?: string | null
  } | null | undefined> | null
}

export interface AccountIdentityProfileSource {
  firstName?: unknown
  lastName?: unknown
  /** Legacy single-string name, read only when first/last are both blank. */
  displayName?: unknown
  /** `users/{uid}` spells it `photoUrl`, not the roster's `photoURL`. */
  photoUrl?: unknown
}

export interface AccountIdentityIdpSource {
  displayName?: string | null
  /** Accepts either spelling, so a roster row can be passed as-is. */
  photoUrl?: string | null
  photoURL?: string | null
}

export interface AccountIdentitySources {
  auth?: AccountIdentityAuthSource | null
  profile?: AccountIdentityProfileSource | null
  idp?: AccountIdentityIdpSource | null
  /** Used only for `label` — an address is not a name. */
  email?: string | null
}

export interface ResolvedAccountIdentity {
  /** The person's name, or null when no source holds one. */
  displayName: string | null
  /** The avatar URL, or null — callers draw initials. */
  photoUrl: string | null
  /** What to print when there is no name: the name, else the email. */
  label: string | null
  displayNameSource: AccountIdentitySource | null
  photoUrlSource: AccountIdentitySource | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * A photo value safe to put in an `<img src>`: `https:`/`http:` URLs and
 * scheme-less paths (the media CDN stores `/media/...` paths) pass;
 * `javascript:`, `data:` and every other scheme do not. These values reach
 * other people's browsers, so a hostile one must not become stored script.
 */
export function sanitizeAccountPhotoUrl(value: unknown): string {
  const candidate = text(value)
  if (!candidate) return ''
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(candidate)
  if (!scheme) return candidate.startsWith('/') ? candidate : ''
  const name = (scheme[1] ?? '').toLowerCase()
  return name === 'https' || name === 'http' ? candidate : ''
}

function profileName(profile: AccountIdentityProfileSource | null | undefined): string {
  if (!profile) return ''
  const joined = [text(profile.firstName), text(profile.lastName)]
    .filter(Boolean)
    .join(' ')
  return joined || text(profile.displayName)
}

export function resolveAccountIdentity(
  sources: AccountIdentitySources,
): ResolvedAccountIdentity {
  const providers = (sources.auth?.providerData ?? []).filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry),
  )

  const nameCandidates: Array<[AccountIdentitySource, string]> = [
    ['auth', text(sources.auth?.displayName)],
    ['profile', profileName(sources.profile)],
    ['provider', providers.map((entry) => text(entry.displayName)).find(Boolean) ?? ''],
    ['idp', text(sources.idp?.displayName)],
  ]
  const photoCandidates: Array<[AccountIdentitySource, string]> = [
    ['auth', sanitizeAccountPhotoUrl(sources.auth?.photoURL)],
    ['profile', sanitizeAccountPhotoUrl(sources.profile?.photoUrl)],
    [
      'provider',
      providers.map((entry) => sanitizeAccountPhotoUrl(entry.photoURL)).find(Boolean) ?? '',
    ],
    [
      'idp',
      sanitizeAccountPhotoUrl(sources.idp?.photoUrl) ||
        sanitizeAccountPhotoUrl(sources.idp?.photoURL),
    ],
  ]

  const name = nameCandidates.find(([, value]) => value)
  const photo = photoCandidates.find(([, value]) => value)
  const displayName = name?.[1] ?? null
  return {
    displayName,
    photoUrl: photo?.[1] ?? null,
    label: displayName ?? (text(sources.email) || null),
    displayNameSource: name?.[0] ?? null,
    photoUrlSource: photo?.[0] ?? null,
  }
}

/**
 * Which of an Auth record's identity fields are blank and could be filled
 * from what the IdP sent, without overwriting anything (AGL-3721).
 *
 * Absent-only by construction: a field the record already holds is never in
 * the result, so a name or photo the person (or staff) set always survives.
 * `photoErased` is the profile's `photoUrlErasedAt` marker — a person who
 * removed their avatar has asked not to have the directory's put back.
 */
export function authIdentityFillFromIdp(input: {
  auth: { displayName?: string | null; photoURL?: string | null } | null | undefined
  idp: { displayName?: string | null; photoUrl?: string | null } | null | undefined
  photoErased?: boolean
}): { displayName?: string; photoURL?: string } {
  const fill: { displayName?: string; photoURL?: string } = {}
  const idpName = text(input.idp?.displayName)
  if (idpName && !text(input.auth?.displayName)) fill.displayName = idpName
  const idpPhoto = sanitizeAccountPhotoUrl(input.idp?.photoUrl)
  // An Auth record's photoURL must be an absolute URL; a CDN path is not one.
  if (
    idpPhoto &&
    /^https:\/\//i.test(idpPhoto) &&
    !input.photoErased &&
    !text(input.auth?.photoURL)
  ) {
    fill.photoURL = idpPhoto
  }
  return fill
}

export default resolveAccountIdentity
