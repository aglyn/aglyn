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
 * The platform's list-search keys, for plain Node scripts (AGL-3321).
 *
 * A backfill cannot import `libs/aglyn/src/lib/app-utils/name-search.ts`, yet
 * it must stamp exactly the keys that library stamps: a list query asks
 * `array-contains` for the token the library makes of a typed word, so a
 * script that spelled a token differently would write records no search can
 * find. This file is the ONE script-side restatement. Every backfill that
 * stamps search keys imports it rather than carrying its own copy.
 *
 * Both sides are held to `name-search-tokens.fixtures.json`: the library's
 * `name-search.spec.ts` asserts it against the TypeScript functions, and
 * `name-search-tokens.test.mjs` (`npm run test:name-search-tokens`, run by
 * the guards) asserts it against these.
 */

/** `NAME_TOKEN_MAX_PREFIX`: the longest word prefix a token may be. */
export const NAME_TOKEN_MAX_PREFIX = 12

/** `NAME_TOKEN_LIMIT`: the most tokens one value contributes. */
export const NAME_TOKEN_LIMIT = 120

/** `SCOPED_SEARCH_JOIN`: what joins a scope token to a search prefix. */
export const SCOPED_SEARCH_JOIN = '~'

/**
 * `nameSearchKey`: lower-cased, trimmed, inner whitespace collapsed.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function nameSearchKey(name) {
  return (typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * `nameSearchTokens`: every prefix, up to the cap, of every word of the key.
 *
 * @param {unknown} name
 * @returns {string[]}
 */
export function nameSearchTokens(name) {
  const key = nameSearchKey(name)
  if (!key) return []
  const tokens = new Set()
  for (const word of key.split(' ')) {
    if (!word) continue
    // By codepoint, as the library does (AGL-3689): a UTF-16 slice splits an
    // emoji into a lone surrogate, which Firestore refuses to store.
    const capped = [...word].slice(0, NAME_TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end).join(''))
      if (tokens.size >= NAME_TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/**
 * `nameSearchReversed`: the key, character-reversed, for suffix matching.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function nameSearchReversed(name) {
  return [...nameSearchKey(name)].reverse().join('')
}

/**
 * `displayNameSearchFields`: the three keys a document named by
 * `displayName` carries. `displayName` itself is not returned.
 *
 * @param {unknown} displayName
 * @returns {{ nameLower: string, nameTokens: string[], nameReversed: string }}
 */
export function displayNameSearchFields(displayName) {
  const name = typeof displayName === 'string' ? displayName : ''
  return {
    nameLower: nameSearchKey(name),
    nameTokens: nameSearchTokens(name),
    nameReversed: nameSearchReversed(name),
  }
}

/**
 * `scopedSearchTokens`: every scope a record is visible to, joined to every
 * search prefix it carries, in scope order then token order, no duplicates.
 *
 * @param {unknown} visibleTo
 * @param {readonly string[]} tokens
 * @returns {string[]}
 */
export function scopedSearchTokens(visibleTo, tokens) {
  if (!Array.isArray(visibleTo)) return []
  const scopes = [
    ...new Set(visibleTo.filter((entry) => typeof entry === 'string' && entry.length > 0)),
  ]
  const words = [...new Set(tokens.filter((token) => typeof token === 'string' && token))]
  const scoped = []
  for (const scope of scopes) {
    for (const word of words) scoped.push(`${scope}${SCOPED_SEARCH_JOIN}${word}`)
  }
  return scoped
}

/**
 * Whether two stored token arrays hold the same tokens in the same order —
 * what a backfill compares before writing, so a re-run writes nothing.
 *
 * @param {unknown} stored
 * @param {readonly string[]} expected
 * @returns {boolean}
 */
export function sameSearchTokens(stored, expected) {
  return (
    Array.isArray(stored) &&
    stored.length === expected.length &&
    stored.every((token, index) => token === expected[index])
  )
}
