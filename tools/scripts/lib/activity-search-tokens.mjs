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
 * The activity logs' search keys, for plain Node scripts (AGL-3321).
 *
 * A script cannot import `libs/aglyn/src/lib/app-utils/activity-search.ts`,
 * yet a script that writes or backfills an activity entry must stamp exactly
 * the `searchTokens` that library stamps, or the logs' search would never find
 * the entry. This is the one script-side twin of `addressSearchWords` and
 * `activitySearchTokens`; the word-prefix tokens beneath them come from
 * `./name-search-tokens.mjs`, the twin of the name-search keys.
 *
 * Both sides are held to `activity-search-tokens.fixtures.json`: the
 * library's `activity-search.spec.ts` asserts it against the TypeScript
 * functions, and `backfill-activity-search-tokens.mjs --self-test` asserts it
 * against these.
 */
import { nameSearchTokens } from './name-search-tokens.mjs'

const text = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * `addressSearchWords`: the whole address, its local part, its domain, and
 * each run of letters and digits.
 *
 * @param {unknown} address
 * @returns {string[]}
 */
export function addressSearchWords(address) {
  const whole = text(address).toLowerCase()
  if (!whole) return []
  const at = whole.lastIndexOf('@')
  const halves = at > 0 ? [whole.slice(0, at), whole.slice(at + 1)] : []
  const runs = whole.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return [whole, ...halves, ...runs].filter(Boolean)
}

/**
 * `activitySearchTokens`: what one activity entry's search box can find it
 * by — the actor's address, the API key's name and the name of what changed.
 *
 * @param {{ actorEmail?: unknown, apiKeyName?: unknown, target?: { name?: unknown } | null } | null | undefined} entry
 * @returns {string[]}
 */
export function activitySearchTokens(entry) {
  const words = [
    ...addressSearchWords(entry?.actorEmail),
    text(entry?.apiKeyName),
    text(entry?.target?.name),
  ].filter(Boolean)
  return nameSearchTokens(words.join(' '))
}
