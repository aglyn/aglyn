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
 * The team roster's list fields, for plain Node scripts (AGL-3321).
 *
 * `orgMemberListFields` in
 * `libs/tenant/data/admin/src/lib/server/org-member-list-fields.ts` stamps
 * `consoleUserType` and `searchTokens` on every `orgs/{orgId}/members/{uid}`
 * document the membership writes reach; a script cannot import it, and must
 * stamp exactly what it stamps or the roster's query would miss the member.
 * This is its one script-side twin, over the word-prefix tokens of
 * `./name-search-tokens.mjs` and the address words of
 * `./activity-search-tokens.mjs`.
 *
 * Held to `org-member-list-fields.fixtures.json`: the library's
 * `org-member-list-fields.spec.ts` asserts it against the TypeScript
 * function, and `backfill-org-member-list-fields.mjs --self-test` against
 * this one.
 */
import { addressSearchWords } from './activity-search-tokens.mjs'
import { nameSearchTokens } from './name-search-tokens.mjs'

const text = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * `isOrgWideMember`: owner and admin always; editor and viewer when
 * `allHosts` is true, or when the member predates the flag (neither
 * `allHosts` nor any `hostAccess`).
 *
 * @param {Record<string, unknown> | null | undefined} member
 * @returns {boolean}
 */
function isOrgWideMember(member) {
  if (!member) return false
  if (member.role === 'owner' || member.role === 'admin') return true
  if (member.allHosts === true) return true
  const scoping = member.hostAccess && typeof member.hostAccess === 'object' ? member.hostAccess : {}
  return member.allHosts === undefined && !Object.keys(scoping).length
}

/**
 * `orgMemberListFields`: the member's kind of console user, and the words the
 * roster's search finds them by (name, address, job title).
 *
 * @param {Record<string, unknown> | null | undefined} member
 * @returns {{ consoleUserType: 'manager' | 'collaborator', searchTokens: string[] }}
 */
export function orgMemberListFields(member) {
  return {
    consoleUserType: isOrgWideMember(member) ? 'manager' : 'collaborator',
    searchTokens: nameSearchTokens(
      [text(member?.displayName), ...addressSearchWords(member?.email), text(member?.title)]
        .filter(Boolean)
        .join(' '),
    ),
  }
}
