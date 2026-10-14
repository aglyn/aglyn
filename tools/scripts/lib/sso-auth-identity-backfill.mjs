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

// The SSO Auth-record identity backfill's decisions (AGL-3721).
//
//   node --test tools/scripts/lib/sso-auth-identity-backfill.test.mjs
//
// Pure: given an Auth record, its `users/{uid}` profile and its roster rows,
// what (if anything) to write onto the record. The precedence after the
// record itself is the account-identity resolver's
// (`@aglyn/shared-util-tools/account-identity`): the profile document, then a
// provider entry, then what the IdP sent as a roster row captured it.

/** Providers that mark an account as SSO. */
export function isSsoUserRecord(record, tenantId) {
  if (tenantId) return true
  return (record?.providerData ?? []).some((provider) => {
    const id = String(provider?.providerId ?? '')
    return id.startsWith('saml.') || id.startsWith('oidc.')
  })
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** An Auth record's `photoURL` must be an absolute https URL. */
function httpsUrl(value) {
  const candidate = text(value)
  return /^https:\/\//i.test(candidate) ? candidate : ''
}

function profileName(profile) {
  if (!profile) return ''
  const joined = [text(profile.firstName), text(profile.lastName)].filter(Boolean).join(' ')
  return joined || text(profile.displayName)
}

/**
 * What to write onto one Auth record, or null when nothing is blank or
 * nothing can fill it. NEVER overwrites: a field the record holds is never in
 * the plan, and a removed avatar (`photoUrlErasedAt`) is never put back.
 *
 * @param {{
 *   record: { displayName?: string|null, photoURL?: string|null, providerData?: Array<{ displayName?: string|null, photoURL?: string|null }> },
 *   profile?: Record<string, unknown> | null,
 *   rosterRows?: Array<{ displayName?: unknown, photoURL?: unknown }>,
 * }} input
 * @returns {{ fill: { displayName?: string, photoURL?: string }, sources: Record<string, string> } | null}
 */
export function planAuthIdentityFill({ record, profile = null, rosterRows = [] }) {
  const providers = (record?.providerData ?? []).filter(Boolean)
  const rows = (rosterRows ?? []).filter(Boolean)
  const fill = {}
  const sources = {}

  if (!text(record?.displayName)) {
    const candidates = [
      ['profile', profileName(profile)],
      ['provider', providers.map((entry) => text(entry.displayName)).find(Boolean) ?? ''],
      ['roster', rows.map((row) => text(row.displayName)).find(Boolean) ?? ''],
    ]
    const found = candidates.find(([, value]) => value)
    if (found) {
      fill.displayName = found[1]
      sources.displayName = found[0]
    }
  }

  if (!text(record?.photoURL) && !profile?.photoUrlErasedAt) {
    const candidates = [
      ['profile', httpsUrl(profile?.photoUrl)],
      ['provider', providers.map((entry) => httpsUrl(entry.photoURL)).find(Boolean) ?? ''],
      ['roster', rows.map((row) => httpsUrl(row.photoURL)).find(Boolean) ?? ''],
    ]
    const found = candidates.find(([, value]) => value)
    if (found) {
      fill.photoURL = found[1]
      sources.photoURL = found[0]
    }
  }

  return Object.keys(fill).length ? { fill, sources } : null
}
