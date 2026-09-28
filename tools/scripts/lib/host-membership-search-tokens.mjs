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
 * The Sites list's fields on a site membership row, for plain Node scripts
 * (AGL-3321).
 *
 * `membershipRow` in `libs/tenant/data/admin/src/lib/server/host-memberships.ts`
 * stamps `searchTokens` and `hasCustomDomain` on every
 * `users/{uid}/hostMemberships/{hostId}` row it writes; a script that writes
 * or backfills those rows cannot import it, and must stamp exactly what it
 * stamps or the list's query would not find the row. This is the one
 * script-side twin of `hostMembershipSearchTokens` and `hasCustomDomain`,
 * over the word-prefix tokens of `./name-search-tokens.mjs`.
 *
 * Held to `host-membership-search-tokens.fixtures.json`: the library's
 * `host-memberships.spec.ts` asserts it against the TypeScript function, and
 * `backfill-host-memberships-list-fields.mjs --self-test` against this one.
 */
import { nameSearchKey, nameSearchTokens } from './name-search-tokens.mjs'

/** A tail of a word begins after any character that is not a letter or a digit. */
const WORD_SEPARATOR = /[^\p{L}\p{N}]/u

/** A word, and every tail of it that begins after a separator, by codepoint. */
function wordTails(word) {
  const chars = [...word]
  const tails = [word]
  for (let at = 1; at < chars.length; at += 1) {
    if (WORD_SEPARATOR.test(chars[at - 1]) && !WORD_SEPARATOR.test(chars[at])) {
      tails.push(chars.slice(at).join(''))
    }
  }
  return tails
}

/**
 * `hostMembershipSearchTokens`: the name, the subdomain and the custom domain,
 * each word with its tails, as word-prefix tokens.
 *
 * @param {{ displayName?: unknown, subdomain?: unknown, cname?: unknown } | null | undefined} meta
 * @returns {string[]}
 */
export function hostMembershipSearchTokens(meta) {
  const words = [meta?.displayName, meta?.subdomain, meta?.cname]
    .map((value) => nameSearchKey(value))
    .flatMap((key) => (key ? key.split(' ') : []))
    .flatMap(wordTails)
  return nameSearchTokens(words.join(' '))
}

/**
 * `hasCustomDomain`: a non-blank `cname`.
 *
 * @param {{ cname?: unknown } | null | undefined} meta
 * @returns {boolean}
 */
export function hasCustomDomain(meta) {
  return typeof meta?.cname === 'string' && meta.cname.trim() !== ''
}
