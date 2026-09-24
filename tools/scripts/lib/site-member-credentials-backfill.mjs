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

// The decisions of the site-member credential migration (AGL-3308), kept
// apart from the script that reads and writes so every one of them is pinned
// by `site-member-credentials-backfill.test.mjs`.
//
// A site member's password hash moved off the profile every member of the
// site can read (`hosts/{hostId}/siteMembers/{id}`) onto a document no client
// reaches (`hosts/{hostId}/siteMemberCredentials/{id}`). The membership
// routes write the credential document from AGL-3308 on and fall back to the
// profile's copy for a member who has none. This moves each remaining copy
// across and deletes it from the profile — the one part of the fix rules
// cannot do, because a rule cannot hide a field of a readable document.
//
// The hash is copied VERBATIM, so a password-reset link minted before the
// move (bound to a fingerprint of the hash) still works after it.

/** The fields that belong on the credential document, never the profile. */
export const CREDENTIAL_FIELDS = ['passwordScrypt', 'passwordResetAt']

/** A usable hash: a non-empty string. */
const usableHash = (value) => typeof value === 'string' && value.length > 0

/** A value worth carrying: anything but absent. */
const present = (value) => value !== undefined && value !== null

/**
 * What one member needs, or `null` when the profile carries no credential
 * field at all — which is every member once the migration has converged.
 *
 * Three outcomes, and each deletes every credential field from the profile:
 *
 *  - `moved`: the profile's hash is copied to the credential document, with
 *    `passwordResetAt` when the credential document has none of its own.
 *  - `superseded`: the credential document already carries a hash. A live
 *    route wrote it after the promotion, so the profile's copy is the stale
 *    one and is dropped, never copied over the newer password.
 *  - `stripped`: the profile carries credential fields but no usable hash — a
 *    blank or non-string value, or a reset time with no hash. Such a member
 *    could not sign in before and cannot after; nothing is copied.
 *
 * @param {{ profile: Record<string, unknown> | null | undefined,
 *   credential: Record<string, unknown> | null | undefined }} input
 *   `credential` is the credential document's data, or null when it does not
 *   exist. Only the two credential fields of either document are ever read.
 */
export function planMemberCredentials({ profile, credential }) {
  const data = profile ?? {}
  const strip = CREDENTIAL_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(data, field),
  )
  if (!strip.length) return null
  if (usableHash(credential?.passwordScrypt)) {
    return { outcome: 'superseded', credentialPatch: null, strip }
  }
  if (!usableHash(data.passwordScrypt)) {
    return { outcome: 'stripped', credentialPatch: null, strip }
  }
  const credentialPatch = { passwordScrypt: data.passwordScrypt }
  if (present(data.passwordResetAt) && !present(credential?.passwordResetAt)) {
    credentialPatch.passwordResetAt = data.passwordResetAt
  }
  return { outcome: 'moved', credentialPatch, strip }
}

/**
 * One site's plan: the members to write and the counts a dry run reports.
 *
 * @param {{ members: Array<{ id: string, data: Record<string, unknown> }>,
 *   credentials: Map<string, Record<string, unknown>> }} input
 *   `credentials` holds the credential documents that exist, by member id.
 */
export function planSiteCredentials({ members, credentials }) {
  const writes = []
  const counts = { read: members.length, clean: 0, moved: 0, superseded: 0, stripped: 0 }
  for (const member of members) {
    const plan = planMemberCredentials({
      profile: member.data,
      credential: credentials.get(member.id) ?? null,
    })
    if (!plan) {
      counts.clean += 1
      continue
    }
    counts[plan.outcome] += 1
    writes.push({ id: member.id, ...plan })
  }
  return { writes, counts }
}

/**
 * Comments out, strings intact — a single left-to-right scan, so a `//`
 * inside a block comment or a `/*` inside a line comment cannot swallow the
 * text a precondition below exists to read.
 */
export function stripComments(source) {
  let out = ''
  let mode = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        i += 1
      } else if (char === '/' && next === '*') {
        mode = 'block'
        i += 1
      } else {
        if (char === "'" || char === '"' || char === '`') {
          mode = 'string'
          quote = char
        }
        out += char
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      } else if (char === '\n') out += char
    } else {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) mode = 'code'
    }
  }
  return out
}

/**
 * Whether sign-in in this checkout reads the credential document.
 *
 * Moving a hash off the profile is only safe under code that looks for it
 * where it went: sign-in that still read the profile alone would refuse every
 * migrated member. So `--apply` is refused on a checkout whose login route
 * does not ask `readMemberPasswordHash`, or whose helper does not address the
 * credential collection — the tell of a checkout older than the change.
 */
export function signInReadsCredentials({ loginSource, helperSource }) {
  const login = stripComments(loginSource ?? '')
  const helper = stripComments(helperSource ?? '')
  return (
    /\breadMemberPasswordHash\s*\(/.test(login) &&
    /\.collection\(\s*'siteMemberCredentials'\s*\)/.test(helper)
  )
}

/**
 * Whether the rules in this checkout keep every client off the credential
 * collection and off a profile's credential fields.
 *
 * The host catch-all must open all four of its statements with the
 * `siteMemberCredentials` refusal, and the `siteMembers` block must narrow a
 * client update to `suspended` alone.
 */
export function rulesDenyCredentials(rulesSource) {
  const code = stripComments(rulesSource ?? '')
  const catchAll = code.split('match /{subcollection}/{document=**} {')[1] ?? ''
  const statements = catchAll.split(';')
  const guarded = ['read', 'create', 'update', 'delete'].every((operation) => {
    const statement =
      statements.find((entry) => new RegExp(`\\ballow ${operation}\\b`).test(entry)) ?? ''
    return /allow \w+:\s*if subcollection != 'siteMemberCredentials' &&/.test(statement)
  })
  const narrowed =
    /match \/siteMembers\/\{memberId\} \{\s*allow update:[^;]*hasOnly\(\['suspended'\]\)/.test(
      code,
    )
  return guarded && narrowed
}
