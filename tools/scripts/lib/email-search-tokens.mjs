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
 * The address search keys, for plain Node scripts (AGL-3321).
 *
 * A backfill cannot import `emailSearchTokens`
 * (`libs/tenant/data/admin/src/lib/server/email-suppression.ts`) or
 * `listMemberSearchTokens` (`libs/tenant/data/admin/src/lib/server/list-members.ts`),
 * yet it must stamp exactly the tokens they stamp: a list's search asks
 * `array-contains` for the token a typed word becomes, so a script that
 * spelled one differently would write rows no search can find. This file is
 * the ONE script-side restatement of the two, built on the one restatement
 * of the name builders (`name-search-tokens.mjs`). Every backfill that stamps
 * address tokens imports it.
 *
 * Both sides are held to `email-search-tokens.fixtures.json`: the library
 * specs assert it against the TypeScript functions, and
 * `email-search-tokens.test.mjs` (`npm run test:email-search-tokens`) asserts
 * it against these.
 */
import { nameSearchTokens } from './name-search-tokens.mjs'

/**
 * `emailSearchTokens`: the word prefixes of the whole address, the domain,
 * the domain behind an `@`, and each piece of the local part and of the
 * domain.
 *
 * @param {unknown} email
 * @returns {string[]}
 */
export function emailSearchTokens(email) {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!address) return []
  const at = address.lastIndexOf('@')
  const local = at === -1 ? address : address.slice(0, at)
  const domain = at === -1 ? '' : address.slice(at + 1)
  const words = [
    address,
    ...(domain ? [domain, `@${domain}`] : []),
    ...local.split(/[._+-]+/),
    ...domain.split('.'),
  ]
  return nameSearchTokens(words.filter(Boolean).join(' '))
}

/**
 * `listMemberSearchTokens`: a list member's address tokens, then their
 * name's, without repeats.
 *
 * @param {unknown} email
 * @param {unknown} name
 * @returns {string[]}
 */
export function listMemberSearchTokens(email, name) {
  return [...new Set([...emailSearchTokens(email), ...nameSearchTokens(name)])]
}
